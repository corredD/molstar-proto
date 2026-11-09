/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  abundanceToCount,
  type Arrangement,
  type Compartment,
  type Entity,
  hasErrors,
  type Id,
  issue,
  type Issue,
  LengthToAngstrom,
  type LengthUnit,
  type MesoViewSpecDoc,
  type Model,
  parseMesoQL,
  superstructureDoc,
  type TileManifest,
  toAngstrom,
  type Transform,
  validate,
  validateManifest,
  type View,
} from '@molstar/meso-spec/format';
import {
  contentHash,
  evaluateMesoQL,
  intersectRuns,
  type IR,
  type IRLook,
  type IRNode,
  type IRShape,
  type IRView,
  lociSphere,
  type MesoLoci,
  placementSets,
  type PlacementType,
  rotationOf,
  runsSize,
  typeRuns,
} from '@molstar/meso-spec/ir';
import { DefaultReaders, meshArea, readerFor } from './readers.js';
import { level0IR, type TileProvider } from './streaming.js';
import type {
  LoadedResource,
  MeshData,
  NormalizedArrangement,
  NormalizedCompartment,
  NormalizedPopulation,
  MaterializedSite,
  NormalizedRelation,
  Resolver,
  ResolveJob,
  ResolveOutput,
  ResourceReader,
} from './resolver.js';

// The runtime (_spec/runtime.md): validate, normalize, dispatch each model to its resolver, assemble the IR, derive the
// view. Results are keyed (_spec/ir.md): a model whose projection is unchanged is not resolved again, and its
// placement sets are the same objects as before, so an adapter can tell by identity that nothing moved.

export interface RuntimeOptions {
  readonly resolvers: readonly Resolver<any>[];
  readonly readers?: readonly ResourceReader[];
  /** Raw content of a resource (text, JSON, bytes); undefined when unavailable. Never the network in tests. */
  readonly load?: (resourceId: Id) => unknown | Promise<unknown>;
  /** The provider of a `meso-tiles` resource, by resource id; undefined: `stream.manifest` (unavailable). */
  readonly tiles?: (resource: Id) => TileProvider | undefined;
  /** Kept across compiles by the caller: the session's results by key. */
  readonly cache?: Map<string, ResolveOutput>;
}

export interface CompileStats {
  readonly resolverRuns: number;
  readonly cacheHits: number;
  readonly ms: {
    readonly validate: number;
    readonly normalize: number;
    readonly resolve: number;
    readonly assemble: number;
  };
  /** Per model: resolver, key, whether it came from the cache, ms spent resolving. */
  readonly models: readonly {
    readonly model: Id;
    readonly resolver: string;
    readonly key: string;
    readonly cached: boolean;
    readonly ms: number;
  }[];
}

export interface CompileResult {
  readonly ir?: IR;
  readonly issues: readonly Issue[];
  readonly stats: CompileStats;
  /** Copies asked for and placed, by population. */
  readonly counts: Readonly<Record<Id, { readonly requested?: number; readonly achieved: number }>>;
  readonly reports: Readonly<Record<Id, Readonly<Record<string, unknown>> | undefined>>;
}

/** The default resolver for populations no model realizes, by arrangement. */
export const DefaultResolverByArrangement: Readonly<Record<Arrangement['kind'], string>> = {
  random: 'meso.pack',
  lattice: 'meso.lattice',
  fiber: 'meso.fiber',
  bilayer: 'meso.bilayer',
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** How deep superstructures may nest (a virus of capsids of pentamers of proteins is 3). */
export const MaxSuperstructureDepth = 8;

export async function compile(doc: MesoViewSpecDoc, o: RuntimeOptions, depth = 0): Promise<CompileResult> {
  const t0 = now();
  const issues: Issue[] = validate(doc, depth > 0);
  const t1 = now();
  const empty = (ms: Partial<CompileStats['ms']> = {}): CompileResult => ({
    issues,
    stats: {
      resolverRuns: 0,
      cacheHits: 0,
      ms: { validate: t1 - t0, normalize: 0, resolve: 0, assemble: 0, ...ms },
      models: [],
    },
    counts: {},
    reports: {},
  });
  if (hasErrors(issues)) return empty();
  doc = withInstances(doc);

  const unit: LengthUnit = doc.units?.length ?? 'nm';
  const A = (l: Parameters<typeof toAngstrom>[0]) => toAngstrom(l, unit)!;
  const readers = o.readers ?? DefaultReaders;
  const resolvers = new Map(o.resolvers.map((r) => [r.id, r]));

  // ---- frames: each frame's raw coordinates to world Å ----
  const frameToWorld = frameMatrices(doc, unit);

  // ---- resources, loaded once ----
  const loaded = new Map<Id, LoadedResource>();
  const loadResource = async (id: Id): Promise<LoadedResource | undefined> => {
    if (loaded.has(id)) return loaded.get(id);
    const resource = (doc.resources ?? []).find((r) => r.id === id);
    if (!resource) return undefined;
    const raw = o.load ? await o.load(id) : undefined;
    if (raw === undefined) {
      issues.push(
        issue(
          'resource.unavailable',
          'error',
          'load',
          `${id} (${resource.format}${resource.uri ? `, ${resource.uri}` : ''}) could not be loaded`,
          { ids: [id] },
        ),
      );
      return undefined;
    }
    const reader = readerFor(readers, resource);
    if (!reader) {
      issues.push(
        issue('resource.unavailable', 'error', 'load', `${id}: no reader for format ${resource.format}`, { ids: [id] }),
      );
      return undefined;
    }
    let content: unknown;
    try {
      content = reader.read(raw, resource);
    } catch (e) {
      issues.push(
        issue(
          'resource.unavailable',
          'error',
          'load',
          `${id}: ${resource.format} could not be read (${(e as Error).message})`,
          { ids: [id] },
        ),
      );
      return undefined;
    }
    const lr: LoadedResource = {
      resource,
      content,
      contentKey:
        resource.checksum ??
        contentHash(typeof raw === 'string' ? raw : raw instanceof Uint8Array ? raw : JSON.stringify(raw)),
      toWorld: resource.frame ? frameToWorld.get(resource.frame) : undefined,
    };
    loaded.set(id, lr);
    return lr;
  };

  // ---- compartments: shapes in world Å, volumes and areas ----
  const children = new Map<Id, Id[]>();
  for (const c of doc.compartments) if (c.parent) children.set(c.parent, [...(children.get(c.parent) ?? []), c.id]);
  const comps = new Map<Id, NormalizedCompartment>();
  for (const c of doc.compartments)
    comps.set(c.id, await normalizeCompartment(c, children.get(c.id) ?? [], A, loadResource));
  for (const [id, c] of comps) {
    if (c.volume === undefined) continue;
    let free = c.volume;
    for (const k of c.children) {
      const kv = comps.get(k)?.volume;
      if (kv !== undefined) free -= kv;
    }
    comps.set(id, { ...c, freeVolume: Math.max(0, free) });
  }

  // ---- superstructures (_spec/format.md): each resolved once, as a document of its own, with the session's cache ----
  const ents = new Map(doc.entities.map((e) => [e.id, e]));
  const ssById = new Map((doc.superstructures ?? []).map((x) => [x.id, x]));
  const templates = new Map<Id, { result: CompileResult; radius: number }>();
  const envelope = new Map<Id, number>();
  for (const ss of ssById.values()) {
    const env = ss.compartments.find((c) => !c.parent);
    const g = env?.geometry;
    const r =
      g?.kind === 'sphere'
        ? A(g.radius)
        : g?.kind === 'ellipsoid'
          ? Math.max(...g.radii.map((x) => A(x)))
          : g?.kind === 'box'
            ? Math.hypot(...g.size.map((x) => A(x))) / 2
            : undefined;
    if (r !== undefined)
      envelope.set(ss.id, r + (env?.membrane?.thickness !== undefined ? A(env.membrane.thickness) / 2 : 0));
  }
  const partsWanted = new Set<Id>();
  for (const p of doc.populations) {
    const ss = ents.get(p.entity)?.superstructure;
    if (ss && (p.detail ?? 'parts') === 'parts') partsWanted.add(ss);
  }
  for (const id of partsWanted) {
    const ss = ssById.get(id)!;
    if (depth >= MaxSuperstructureDepth) {
      issues.push(
        issue(
          'superstructure.depth',
          'error',
          'resolve',
          `${id}: superstructures nest deeper than ${MaxSuperstructureDepth}`,
          { ids: [id] },
        ),
      );
      continue;
    }
    const result = await compile(superstructureDoc(doc, ss), o, depth + 1);
    // its static warnings the outer validation reported; a static error (a refused template) is never dropped
    for (const i of result.issues)
      if (i.phase !== 'static' || i.severity === 'error')
        issues.push({ ...i, message: `[${id}] ${i.message}`, ids: [id, ...(i.ids ?? [])] });
    templates.set(id, { result, radius: envelope.get(id) ?? 0 });
  }

  // ---- populations: counts and Å ----
  const pops = new Map<Id, NormalizedPopulation>();
  doc.populations.forEach((p, i) => {
    const c = comps.get(p.compartment)!;
    const parent = c.parent ? comps.get(c.parent) : undefined;
    const ctx =
      p.location === 'interior'
        ? { volume: c.freeVolume }
        : p.location === 'exterior'
          ? { volume: parent?.freeVolume }
          : { area: c.area };
    const counted = abundanceToCount(p.abundance, ctx);
    const why = counted.why;
    // a bilayer's density is per leaflet: both leaflets are asked for
    const count = counted.count !== undefined && p.arrangement?.kind === 'bilayer' ? 2 * counted.count : counted.count;
    if (count === undefined)
      issues.push(
        issue('constraint.unmet', 'warning', 'resolve', `${p.id}: no count (${why})`, {
          path: `/populations/${i}/abundance`,
          ids: [p.id],
        }),
      );
    const e = ents.get(p.entity)!;
    const ssRadius = e.superstructure ? envelope.get(e.superstructure) : undefined;
    pops.set(p.id, {
      id: p.id,
      entity: e,
      compartment: p.compartment,
      location: p.location,
      requested: count,
      countWhy: why,
      minFraction: p.constraints?.find((k) => k.kind === 'placed-fraction')?.min ?? 1,
      radius: e.radius !== undefined ? A(e.radius) : ssRadius,
      arrangement: normalizeArrangement(p.arrangement, A),
      minDistances: (p.constraints ?? []).flatMap((k) =>
        k.kind === 'min-distance' ? [{ to: k.to, distance: A(k.distance) }] : [],
      ),
    });
  });
  for (const cat of doc.catalogs ?? [])
    issues.push(
      issue(
        'catalog.unexpanded',
        'warning',
        'resolve',
        `catalog ${cat.id}: no catalog expander in this runtime; its populations are not placed`,
        { ids: [cat.id] },
      ),
    );

  // ---- models: the document's, then the default ones for what no model realizes ----
  const models: Model[] = [...(doc.models ?? [])];
  const realized = new Set(models.flatMap((m) => m.populations));
  // the subjects of a relation on a fiber (HU bending DNA) are placed by the fiber's resolver, on the strand
  const fiberPops = new Set(doc.populations.filter((p) => p.arrangement?.kind === 'fiber').map((p) => p.id));
  const onStrand = new Set(
    (doc.relations ?? [])
      .filter((x) => ['binds', 'bends'].includes(x.kind) && (x.objects ?? []).some((o) => fiberPops.has(o)))
      .flatMap((x) => x.subjects),
  );
  const byDefault = new Map<string, Id[]>();
  for (const p of doc.populations) {
    if (realized.has(p.id)) continue;
    const r = onStrand.has(p.id) ? 'meso.fiber' : DefaultResolverByArrangement[p.arrangement?.kind ?? 'random'];
    byDefault.set(r, [...(byDefault.get(r) ?? []), p.id]);
  }
  for (const [method, ps] of byDefault)
    models.push({
      id: `default:${method}`,
      kind: 'procedural',
      method,
      populations: ps,
      seed: 1,
      ...(doc.instances?.length ? { avoid: [InstancesModel] } : {}),
    });
  const t2 = now();

  // ---- relations: sites materialized (_spec/format.md) ----
  const siteOf = (q: string | undefined): { site?: MaterializedSite; why?: string } => {
    if (!q) return {};
    const p = parseMesoQL(q);
    const e = p.expr;
    if (!e || e.symbol.name !== 'site') return { why: `${q} is not a site address` };
    const [entity, id] = e.args as [string, string];
    const site = ents.get(entity)?.sites?.find((x) => x.id === id);
    if (!site) return { why: `${entity} has no site ${id}` };
    if (!site.position)
      return {
        why: `site ${entity}/${id} is given by residues (${site.at}); materializing it needs the structure loaded`,
      };
    const v = (x: readonly number[]) => [x[0], x[1], x[2]] as [number, number, number];
    return { site: { position: v(site.position), axis: site.axis ? v(site.axis) : undefined } };
  };
  const relations: NormalizedRelation[] = (doc.relations ?? []).map((x) => {
    const entry = siteOf(x.entry);
    const exit = siteOf(x.exit);
    return {
      id: x.id,
      kind: x.kind,
      subjects: x.subjects,
      objects: x.objects ?? [],
      entry: entry.site,
      exit: exit.site,
      angle: x.angle !== undefined ? (x.angle * Math.PI) / 180 : undefined,
      spacing: x.spacing !== undefined ? A(x.spacing) : undefined,
      unresolved: entry.why ?? exit.why,
    };
  });

  // ---- resolve, in `avoid` order ----
  const cache = o.cache ?? new Map<string, ResolveOutput>();
  // a refined model's result is replaced by its refiner's: its constraints are checked there (_spec/runtime.md)
  const refinedBy = new Map(models.filter((m) => m.refines).map((m) => [m.refines!, m.id]));
  // a stream model is no resolver's: its level 0 is built below, its tiles are the session's
  const order = topoOrder(models, refinedBy).filter((m) => !m.stream);
  const outputs = new Map<
    Id,
    { key: string; out: ResolveOutput; cached: boolean; resolver: Resolver; input: unknown }
  >();
  const statsModels: { model: Id; resolver: string; key: string; cached: boolean; ms: number }[] = [];
  let runs = 0;
  let hits = 0;
  const counts: Record<Id, { requested?: number; achieved: number }> = {};
  const reports: Record<Id, Readonly<Record<string, unknown>> | undefined> = {};
  const placed = new Map<Id, readonly NormalizedPopulation[]>();
  /** A model and the models it refines, up to the head of its chain. */
  const chainOf = (m: Model): Model[] => {
    const out = [m];
    for (let x = m; x.refines; ) {
      const up = models.find((y) => y.id === x.refines);
      if (!up || out.includes(up)) break;
      out.push((x = up));
    }
    return out;
  };
  const realizes = (m: Model): readonly Id[] => chainOf(m).at(-1)!.populations;
  for (const m of order) {
    const resolver = resolvers.get(m.method);
    const popsOf = realizes(m)
      .map((id) => pops.get(id)!)
      .filter(Boolean);
    for (const p of popsOf) counts[p.id] = { requested: p.requested, achieved: 0 };
    if (!resolver) {
      issues.push(
        issue(
          'resolver.unknown',
          'error',
          'resolve',
          `${m.id}: no resolver ${m.method}; ${m.populations.join(', ')} not placed`,
          { ids: [m.id, ...m.populations] },
        ),
      );
      continue;
    }
    const unsupported = popsOf.filter(
      (p) => !resolver.arrangements.includes(p.arrangement.kind) || !resolver.locations.includes(p.location),
    );
    for (const p of unsupported)
      issues.push(
        issue(
          'resolver.unsupported',
          'error',
          'resolve',
          `${m.method} cannot place ${p.id} (${p.arrangement.kind}, ${p.location})`,
          { ids: [p.id, m.id] },
        ),
      );
    const inputs = new Map<Id, LoadedResource>();
    let missing = false;
    for (const id of m.inputs ?? []) {
      const lr = await loadResource(id);
      if (lr) inputs.set(id, lr);
      else missing = true;
    }
    const upstream = m.refines ? outputs.get(m.refines) : undefined;
    // a refine stage avoids what every model up its chain avoids
    const avoids = new Set<Id>();
    for (const x of chainOf(m)) for (const a of x.avoid ?? []) avoids.add(a);
    // a refined model is avoided through the result that replaces it (its last refine stage that resolved)
    const avoided = [...avoids].map((a) => outputs.get(resultOf(a, refinedBy, m.id, (x) => outputs.has(x))));
    if (missing || avoided.some((a) => !a) || (m.refines && !upstream)) {
      issues.push(
        issue(
          'resolver.failed',
          'error',
          'resolve',
          `${m.id} not resolved: ${missing ? 'an input is unavailable' : m.refines && !upstream ? `the model it refines (${m.refines}) failed` : 'a model it avoids failed'}`,
          { ids: [m.id, ...m.populations] },
        ),
      );
      continue;
    }
    const job: ResolveJob = {
      model: m,
      populations: popsOf.filter((p) => !unsupported.includes(p) && p.requested !== undefined),
      compartments: comps,
      inputs,
      obstacles: avoided.flatMap((a) => a!.out.sets),
      seed: m.seed ?? 1,
      relations: relations.filter((x) => [...x.subjects, ...x.objects].some((id) => realizes(m).includes(id))),
      upstream: upstream?.out,
    };
    const tr = now();
    let input: unknown;
    let key: string;
    try {
      input = resolver.project(job);
      key = `${m.id}@${contentHash({ resolver: resolver.id, version: resolver.version, input, avoid: avoided.map((a) => a!.key), refines: upstream?.key })}`;
    } catch (e) {
      issues.push(
        issue(
          'resolver.failed',
          'error',
          'resolve',
          `${m.id}: ${resolver.id} could not read its input (${(e as Error).message})`,
          { ids: [m.id] },
        ),
      );
      continue;
    }
    let out = cache.get(key);
    const cached = !!out;
    if (out) hits++;
    else {
      try {
        const raw = await resolver.resolve(input, job);
        // the key is the runtime's: sets are stamped with it so an adapter can tell them apart
        out = { ...raw, sets: raw.sets.map((s) => ({ ...s, key: `${key}#${raw.sets.indexOf(s)}`, model: m.id })) };
        runs++;
        cache.set(key, out);
      } catch (e) {
        issues.push(
          issue('resolver.failed', 'error', 'resolve', `${m.id}: ${resolver.id} threw (${(e as Error).message})`, {
            ids: [m.id],
          }),
        );
        continue;
      }
    }
    statsModels.push({ model: m.id, resolver: resolver.id, key, cached, ms: now() - tr });
    outputs.set(m.id, { key, out, cached, resolver, input });
    reports[m.id] = out.report;
    for (const i of out.issues ?? []) issues.push(i);
    placed.set(m.id, job.populations);
  }
  // counts and constraints on the result that stands: a refined model's are checked at its refiner, unless the
  // refiner failed and the refined result is what is drawn
  for (const m of order) {
    const pops = placed.get(m.id);
    const out = outputs.get(m.id)?.out;
    const by = refinedBy.get(m.id);
    if (!pops || !out || (by && outputs.has(by))) continue;
    for (const p of pops) {
      const achieved = out.achieved[p.id] ?? 0;
      counts[p.id] = { requested: p.requested, achieved };
      const need = Math.ceil((p.requested ?? 0) * p.minFraction);
      if (achieved < need)
        issues.push(
          issue(
            'constraint.unmet',
            p.minFraction < 1 || achieved === 0 ? 'error' : 'warning',
            'resolve',
            `${p.id}: ${achieved} of ${p.requested} placed`,
            {
              ids: [p.id, m.id],
              constraint: {
                kind: 'placed-fraction',
                requested: p.requested ?? 0,
                achieved,
                reason: out.shortfall?.[p.id],
              },
            },
          ),
        );
    }
  }
  for (const p of pops.values())
    if (p.minDistances.length)
      issues.push(
        issue(
          'resolver.unsupported',
          'warning',
          'resolve',
          `${p.id}: min-distance constraints are not honoured by this prototype's resolvers`,
          { ids: [p.id] },
        ),
      );
  for (const r of doc.relations ?? []) {
    const honoured = [...outputs.values()].some((x) => x.resolver.honours?.includes(r.kind));
    if (!honoured)
      issues.push(
        issue(
          'relation.ignored',
          'info',
          'resolve',
          `relation ${r.id} (${r.kind}) is the document's statement; no resolver here honours it`,
          { ids: [r.id] },
        ),
      );
  }
  const t3 = now();

  for (const [, t] of templates) for (const [k, v] of Object.entries(t.result.counts)) counts[k] = v;
  for (const [, t] of templates) {
    runs += t.result.stats.resolverRuns;
    hits += t.result.stats.cacheHits;
    statsModels.push(...t.result.stats.models);
  }

  // ---- streams (_spec/streaming.md): level 0 from the manifest, no placement set ----
  const streams: IRNode[] = [];
  for (const m of models.filter((x) => x.stream)) {
    const failed = (why: string, severity: 'error' | 'warning' = 'error') =>
      issues.push(issue('stream.manifest', severity, 'load', `${m.id}: ${why}`, { ids: [m.id] }));
    const zero = (id: Id) => (counts[id] = { requested: pops.get(id)?.requested, achieved: 0 });
    const provider = o.tiles?.(m.stream!.resource);
    let manifest: TileManifest | undefined;
    try {
      manifest = await provider?.manifest();
    } catch (e) {
      failed(`manifest ${m.stream!.resource} could not be read (${(e as Error).message})`);
    }
    if (!manifest) {
      if (!provider) failed(`no provider for ${m.stream!.resource}: the manifest is unavailable`);
      m.populations.forEach(zero);
      continue;
    }
    const bad = validateManifest(manifest, m, doc);
    issues.push(...bad);
    if (hasErrors(bad)) {
      m.populations.forEach(zero);
      continue;
    }
    const types: PlacementType[] = manifest.populations.map((id, index) => {
      const p = pops.get(id)!;
      return {
        index,
        population: id,
        entity: p.entity.id,
        label: p.entity.label,
        compartment: p.compartment,
        radius: p.radius ?? 10,
      };
    });
    for (const t of types)
      counts[t.population] = {
        requested: pops.get(t.population)?.requested,
        achieved: manifest.tiles.reduce((a, x) => a + (x.counts[t.population] ?? 0), 0),
      };
    streams.push({
      ref: `${m.id}/stream`,
      kind: 'stream',
      origin: [m.id, ...m.populations],
      params: {
        model: m.id,
        resource: m.stream!.resource,
        key: `${m.id}@${contentHash({ manifest, types })}`,
        levels: manifest.levels,
        bounds: manifest.bounds,
        types,
        tiles: manifest.tiles,
      },
    });
  }

  // ---- assemble ----
  const root = assemble(doc, comps, frameToWorld, outputs, models, templates, ents, streams);
  const view = deriveView(doc, root);
  const t4 = now();
  return {
    ir: { root, view },
    issues,
    stats: {
      resolverRuns: runs,
      cacheHits: hits,
      ms: { validate: t1 - t0, normalize: t2 - t1, resolve: t3 - t2, assemble: t4 - t3 },
      models: statsModels,
    },
    counts,
    reports,
  };
}

/** What an edit touches (_spec/views.md): `view` when only views, tours, session or metadata differ (no resolution). */
export function classifyEdit(prev: MesoViewSpecDoc, next: MesoViewSpecDoc): 'none' | 'view' | 'model' {
  // the revision is the committer's label, not content (format/patch.ts)
  const strip = ({ views: _v, tours: _t, session: _s, metadata: _m, revision: _r, ...rest }: MesoViewSpecDoc) => rest;
  const bare = ({ revision: _r, ...rest }: MesoViewSpecDoc) => rest;
  if (contentHash(bare(prev)) === contentHash(bare(next))) return 'none';
  return contentHash(strip(prev)) === contentHash(strip(next)) ? 'view' : 'model';
}

/** A view-only edit: the same IR tree, a new view (O(types), no resolver, no placement touched). */
export function updateView(doc: MesoViewSpecDoc, ir: IR): IR {
  // the title is the document's metadata: a new root object only when it changed (the tree below is the same)
  const p = ir.root.params as { title?: string };
  const root =
    ir.root.kind === 'scene' && p.title !== doc.metadata.title
      ? ({ ...ir.root, params: { ...p, title: doc.metadata.title } } as IRNode)
      : ir.root;
  return { root, view: deriveView(doc, root) };
}

// ---- normalization ----

async function normalizeCompartment(
  c: Compartment,
  children: Id[],
  A: (l: number | { value: number; unit: LengthUnit }) => number,
  load: (id: Id) => Promise<LoadedResource | undefined>,
): Promise<NormalizedCompartment> {
  const g = c.geometry;
  const center = (v?: readonly number[]) => (v ? v.map((x) => A(x)) : [0, 0, 0]);
  let shape: IRShape;
  let mesh: MeshData | undefined;
  let meshKey: string | undefined;
  let volume: number | undefined;
  let area: number | undefined;
  if (g.kind === 'sphere') {
    const r = A(g.radius);
    shape = { kind: 'sphere', center: center(g.center), radius: r };
    volume = (4 / 3) * Math.PI * r ** 3;
    area = 4 * Math.PI * r * r;
  } else if (g.kind === 'ellipsoid') {
    const radii = g.radii.map((x) => A(x));
    shape = { kind: 'ellipsoid', center: center(g.center), radii };
    volume = (4 / 3) * Math.PI * radii[0] * radii[1] * radii[2];
    const p = 1.6075;
    area =
      4 *
      Math.PI *
      (((radii[0] * radii[1]) ** p + (radii[0] * radii[2]) ** p + (radii[1] * radii[2]) ** p) / 3) ** (1 / p);
  } else if (g.kind === 'box') {
    const size = g.size.map((x) => A(x));
    shape = { kind: 'box', center: center(g.center), size };
    volume = size[0] * size[1] * size[2];
    area = 2 * (size[0] * size[1] + size[0] * size[2] + size[1] * size[2]);
  } else if (g.kind === 'mesh') {
    const lr = await load(g.resource);
    const raw = lr?.content as MeshData | undefined;
    if (raw) {
      mesh = transformMesh(raw, lr!.toWorld);
      meshKey = lr!.contentKey + (lr!.toWorld ? contentHash(lr!.toWorld) : '');
      const m = meshArea(mesh);
      volume = m.volume;
      area = m.area;
      shape = {
        kind: 'mesh',
        resource: g.resource,
        vertexCount: mesh.positions.length / 3,
        triangleCount: mesh.indices.length / 3,
      };
    } else shape = { kind: 'implicit', description: `mesh ${g.resource} unavailable` };
  } else if (g.kind === 'segmentation') {
    shape = {
      kind: 'implicit',
      description: `segmentation ${g.resource}${g.label !== undefined ? ` label ${g.label}` : ''}: surface extraction is not in this prototype`,
    };
  } else shape = { kind: 'implicit', description: g.description };
  return {
    id: c.id,
    label: c.label,
    parent: c.parent,
    children,
    shape,
    mesh,
    meshKey,
    volume,
    area,
    membrane: c.membrane ? { thickness: c.membrane.thickness !== undefined ? A(c.membrane.thickness) : 40 } : undefined,
  };
}

function transformMesh(m: MeshData, M?: readonly number[]): MeshData {
  if (!M) return m;
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = m.positions[i],
      y = m.positions[i + 1],
      z = m.positions[i + 2];
    p[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    p[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    p[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  }
  return { positions: p, indices: m.indices };
}

function normalizeArrangement(a: Arrangement | undefined, A: (l: any) => number): NormalizedArrangement {
  if (!a || a.kind === 'random') return { kind: 'random' };
  if (a.kind === 'lattice')
    return { kind: 'lattice', lattice: a.lattice, spacing: A(a.spacing), vacancy: a.defects?.vacancy ?? 0 };
  if (a.kind === 'bilayer') return { kind: 'bilayer' };
  return {
    kind: 'fiber',
    rise: A(a.rise),
    twist: a.twist ?? 0,
    path: a.path?.points?.map((p) => [A(p[0]), A(p[1]), A(p[2])] as [number, number, number]),
    growth: a.growth
      ? { persistence: A(a.growth.persistence), length: A(a.growth.length), count: a.growth.count }
      : undefined,
  };
}

// ---- frames (_spec/format.md) ----

const Identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major product a·b. */
export function mat4Mul(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[4 * c + r] += a[4 * k + r] * b[4 * c + k];
  return o;
}

function invertSimilarity(m: readonly number[]): number[] {
  // R·s and t: inverse is Rᵀ/s and -Rᵀt/s
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const o = [
    m[0] / s2,
    m[4] / s2,
    m[8] / s2,
    0,
    m[1] / s2,
    m[5] / s2,
    m[9] / s2,
    0,
    m[2] / s2,
    m[6] / s2,
    m[10] / s2,
    0,
    0,
    0,
    0,
    1,
  ];
  for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
  return o;
}

/** A transform acting on Å coordinates; the translation is in the document's length unit. */
export function transformMatrix(t: Transform, unit: LengthUnit): number[] {
  if (t.matrix) {
    const m = [...t.matrix];
    for (let r = 0; r < 3; r++) m[12 + r] *= LengthToAngstrom[unit];
    return m;
  }
  const [x, y, z, w] = t.rotation ?? [0, 0, 0, 1];
  const s = t.scale ?? 1;
  const tr = (t.translation ?? [0, 0, 0]).map((v) => v * LengthToAngstrom[unit]);
  return [
    s * (1 - 2 * (y * y + z * z)),
    s * 2 * (x * y + z * w),
    s * 2 * (x * z - y * w),
    0,
    s * 2 * (x * y - z * w),
    s * (1 - 2 * (x * x + z * z)),
    s * 2 * (y * z + x * w),
    0,
    s * 2 * (x * z + y * w),
    s * 2 * (y * z - x * w),
    s * (1 - 2 * (x * x + y * y)),
    0,
    tr[0],
    tr[1],
    tr[2],
    1,
  ];
}

/** Each frame's raw coordinates (its unit, or voxels) to world Å, through the alignments (either direction). */
/** The model that places the document's instances. */
export const InstancesModel = 'default:meso.instances';

/**
 * The document's instances (_spec/format.md) as what the runtime already resolves: each a population of one copy under
 * its own id, all placed by one `meso.precomputed` model from an inline table in world Å; every procedural model avoids
 * them. Their ids are population ids from here on, so looks, relations, superstructure expansion and MesoQL need nothing new.
 */
export function withInstances(doc: MesoViewSpecDoc): MesoViewSpecDoc {
  const xs = doc.instances ?? [];
  if (!xs.length) return doc;
  const unit: LengthUnit = doc.units?.length ?? 'nm';
  const frames = frameMatrices(doc, unit);
  const positions: number[] = [];
  const rotations: number[] = [];
  for (const x of xs) {
    // the pose in its frame's raw coordinates (or the document's unit), then the frame to world Å
    const T = transformMatrix(x.pose, x.frame ? 'A' : unit);
    const M = x.frame ? mat4Mul(frames.get(x.frame) ?? Identity, T) : T;
    positions.push(M[12], M[13], M[14]);
    rotations.push(...rotationOf(M));
  }
  const ids = xs.map((x) => x.id);
  return {
    ...doc,
    populations: [
      ...doc.populations,
      ...xs.map((x) => ({
        id: x.id,
        entity: x.entity,
        compartment: x.compartment,
        location: x.location ?? 'interior',
        abundance: { count: 1 },
        ...(x.detail ? { detail: x.detail } : {}),
        ...(x.evidence ? { evidence: x.evidence } : {}),
      })),
    ],
    models: [
      {
        id: InstancesModel,
        kind: 'precomputed',
        method: 'meso.precomputed',
        populations: ids,
        params: { placements: { positions, rotations, populations: ids } },
      },
      ...(doc.models ?? []).map((m) =>
        m.kind === 'procedural' && !m.refines ? { ...m, avoid: [...(m.avoid ?? []), InstancesModel] } : m,
      ),
    ],
  };
}

export function frameMatrices(doc: MesoViewSpecDoc, unit: LengthUnit): Map<Id, number[]> {
  const frames = doc.frames ?? [];
  const scaleOf = (id: Id) => {
    const f = frames.find((x) => x.id === id);
    if (!f) return 1;
    if (f.voxelSize !== undefined) return toAngstrom(f.voxelSize, unit) ?? 1;
    return LengthToAngstrom[f.units] ?? 1;
  };
  const scaleM = (s: number) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  // aligned Å space of each frame to world Å
  const toWorldA = new Map<Id, number[]>();
  for (const w of frames.filter((f) => f.kind === 'world')) toWorldA.set(w.id, Identity);
  const als = doc.alignments ?? [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of als) {
      const T = transformMatrix(a.transform, unit);
      if (toWorldA.has(a.to) && !toWorldA.has(a.from)) {
        toWorldA.set(a.from, mat4Mul(toWorldA.get(a.to)!, T));
        changed = true;
      } else if (toWorldA.has(a.from) && !toWorldA.has(a.to)) {
        toWorldA.set(a.to, mat4Mul(toWorldA.get(a.from)!, invertSimilarity(T)));
        changed = true;
      }
    }
  }
  const out = new Map<Id, number[]>();
  for (const [id, m] of toWorldA) out.set(id, mat4Mul(m, scaleM(scaleOf(id))));
  return out;
}

/**
 * The model whose result stands for `id`'s: the last refine stage after it (_spec/runtime.md), stopping before `self`
 * (a stage never stands in for what it refines from its own point of view) and at the first stage `ok` refuses.
 */
function resultOf(id: Id, refinedBy: ReadonlyMap<Id, Id>, self: Id, ok: (id: Id) => boolean = () => true): Id {
  const seen = new Set([id]);
  for (let next = refinedBy.get(id); next && next !== self && !seen.has(next) && ok(next); next = refinedBy.get(id)) {
    id = next;
    seen.add(id);
  }
  return id;
}

/** Models after what they avoid (through its refine stages) and what they refine. */
function topoOrder(models: readonly Model[], refinedBy: ReadonlyMap<Id, Id>): Model[] {
  const by = new Map(models.map((m) => [m.id, m]));
  const out: Model[] = [];
  const done = new Set<Id>();
  const visit = (m: Model, stack: Set<Id>) => {
    if (done.has(m.id) || stack.has(m.id)) return;
    stack.add(m.id);
    for (const a of [...(m.avoid ?? []).map((x) => resultOf(x, refinedBy, m.id)), ...(m.refines ? [m.refines] : [])]) {
      const d = by.get(a);
      if (d) visit(d, stack);
    }
    done.add(m.id);
    out.push(m);
  };
  for (const m of models) visit(m, new Set());
  return out;
}

// ---- assembly (_spec/ir.md) ----

function assemble(
  doc: MesoViewSpecDoc,
  comps: ReadonlyMap<Id, NormalizedCompartment>,
  frames: ReadonlyMap<Id, number[]>,
  outputs: ReadonlyMap<Id, { key: string; out: ResolveOutput; cached: boolean; resolver: Resolver; input: unknown }>,
  models: readonly Model[],
  templates: ReadonlyMap<Id, { result: CompileResult; radius: number }>,
  ents: ReadonlyMap<Id, Entity>,
  streams: readonly IRNode[],
): IRNode {
  const detailOf = new Map(doc.populations.map((p) => [p.id, p.detail ?? 'parts']));
  const templateSets = new Map<Id, string[]>();
  for (const [id, t] of templates)
    templateSets.set(
      id,
      t.result.ir
        ? placementSets(t.result.ir)
            .filter((s) => !isUnderSuperstructure(t.result.ir!, s.key))
            .map((s) => s.key)
        : [],
    );
  const compNode = (id: Id): IRNode => {
    const c = comps.get(id)!;
    const kids: IRNode[] = [];
    if (c.membrane)
      kids.push({
        ref: `${id}/membrane`,
        kind: 'membrane',
        params: { compartment: id, thickness: c.membrane.thickness },
        origin: [id],
      });
    for (const k of c.children) kids.push(compNode(k));
    return {
      ref: id,
      kind: 'compartment',
      params: { compartment: id, shape: c.shape, volume: c.freeVolume, area: c.area },
      origin: [id],
      children: kids,
    };
  };
  const tops = doc.compartments.filter((c) => !c.parent).map((c) => compNode(c.id));
  const resolves: IRNode[] = [];
  const refiner = new Map(models.filter((m) => m.refines).map((m) => [m.refines!, m.id]));
  for (const m of models) {
    const o = outputs.get(m.id);
    if (!o) continue;
    // a refined model keeps its resolve node (its key, its input) but not its sets: the refiner's replace them (when
    // the refiner resolved; a failed refiner leaves the refined result drawn)
    const by = refiner.get(m.id);
    const superseded = by && outputs.has(by) ? by : undefined;
    resolves.push({
      ref: `${m.id}/resolve`,
      kind: 'resolve',
      origin: m.id.startsWith('default:') ? [...m.populations] : [m.id, ...m.populations],
      params: {
        model: m.id,
        resolver: o.resolver.id,
        version: o.resolver.version,
        key: o.key,
        input: summarizeInput(o.input),
        cached: o.cached,
        ...(m.refines ? { refines: m.refines } : {}),
        ...(superseded ? { refinedBy: superseded } : {}),
      },
      children: (superseded ? [] : o.out.sets).map((set, i) => {
        const instances: IRNode[] = set.typeTable.flatMap((t): IRNode[] => {
          const ss = ents.get(t.entity)?.superstructure;
          if (!ss) return [];
          const detail = (detailOf.get(t.population) ?? 'parts') as 'parts' | 'entity';
          let n = 0;
          for (let k = 0; k < set.count; k++) if (set.types[k] === t.index) n++;
          return [
            {
              ref: `${m.id}/placements/${i}/instances/${t.index}`,
              kind: 'instances',
              origin: [t.population, ss],
              params: {
                type: t.index,
                entity: t.entity,
                superstructure: ss,
                detail,
                instances: n,
                templates: detail === 'parts' ? (templateSets.get(ss) ?? []) : [],
              },
            },
          ];
        });
        return {
          ref: `${m.id}/placements/${i}`,
          kind: 'placements',
          params: { set },
          origin: [...new Set(set.typeTable.map((t) => t.population))],
          ...(instances.length ? { children: instances } : {}),
        };
      }),
    });
  }
  const frameNodes: IRNode[] = [...frames]
    .filter(([id]) => (doc.frames ?? []).find((f) => f.id === id)?.kind !== 'world')
    .map(([id, matrix]) => ({
      ref: `frame:${id}`,
      kind: 'frame',
      params: { frame: id, matrix, via: (doc.alignments ?? []).find((a) => a.from === id || a.to === id)?.id },
      origin: [id],
    }));
  // superstructures: their resolved trees, refs prefixed with their id (one tree per superstructure, however many copies)
  const ssNodes: IRNode[] = [...templates].map(([id, t]) => {
    const inner = t.result.ir?.root.children?.[0]?.children ?? [];
    const prefix = (n: IRNode): IRNode =>
      ({ ...n, ref: `${id}/${n.ref}`, ...(n.children ? { children: n.children.map(prefix) } : {}) }) as IRNode;
    const copies = t.result.ir ? placementSets(t.result.ir).reduce((x, s) => x + s.count, 0) : 0;
    return {
      ref: `superstructure:${id}`,
      kind: 'superstructure',
      origin: [id],
      params: { superstructure: id, radius: t.radius, copies },
      children: inner.map(prefix),
    };
  });
  const world = (doc.frames ?? []).find((f) => f.kind === 'world')?.id ?? 'world';
  return {
    ref: 'scene',
    kind: 'scene',
    params: { units: 'A', title: doc.metadata.title },
    children: [
      {
        ref: `frame:${world}`,
        kind: 'frame',
        params: { frame: world, matrix: Identity },
        origin: [world],
        children: [...tops, ...resolves, ...streams, ...ssNodes, ...frameNodes],
      },
    ],
  };
}

/** Whether a set sits inside a superstructure node of the tree (a template, in its own frame). */
export function isUnderSuperstructure(ir: IR, key: string): boolean {
  const visit = (n: IRNode, inside: boolean): boolean => {
    if (n.kind === 'placements' && n.params.set.key === key) return inside;
    for (const c of n.children ?? []) if (visit(c, inside || n.kind === 'superstructure')) return true;
    return false;
  };
  return visit(ir.root, false);
}

/** Typed arrays never go into the IR's input summaries: counts instead. */
function summarizeInput(x: unknown): unknown {
  if (ArrayBuffer.isView(x)) return `<${x.constructor.name} ${(x as unknown as { length: number }).length}>`;
  if (Array.isArray(x)) return x.length > 64 ? `<${x.length} items>` : x.map(summarizeInput);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, summarizeInput(v)]));
  return x;
}

// ---- views (_spec/views.md) ----

/** A deterministic palette: the same population, the same color, in every session. */
export function defaultColor(population: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < population.length; i++) h = Math.imul(h ^ population.charCodeAt(i), 0x01000193);
  const hue = ((h >>> 0) % 360) / 360;
  const [r, g, b] = hsl(hue, 0.55, 0.62);
  return (r << 16) | (g << 8) | b;
}

function hsl(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export function deriveView(doc: MesoViewSpecDoc, root: IRNode): IRView {
  const view: View | undefined = (doc.views ?? []).find((v) => v.id === doc.session?.view) ?? doc.views?.[0];
  const ir = { root, view: { id: '', looks: [] } } as IR;
  const issues: Issue[] = [];
  const materialize = materializer(doc, ir, issues);
  const sets = placementSets(ir);
  // whole-type looks: one per (set, type), the defaults overridden by every look that covers the whole type, in order;
  // a look that covers part of a type (a few copies) becomes a partial look with its runs, applied after
  const whole = new Map<string, IRLook>();
  for (const s of sets)
    for (const t of s.typeTable)
      whole.set(`${s.key}#${t.index}`, {
        set: s.key,
        types: [t.index],
        color: defaultColor(t.population),
        visible: true,
      });
  const partial: IRLook[] = [];
  for (const [at, l] of (view?.looks ?? []).entries()) {
    const loci = materialize(l.select);
    const props = {
      ...(l.color ? { color: parseInt(l.color.slice(1), 16) } : {}),
      ...(l.visible !== undefined ? { visible: l.visible, visibleAt: at } : {}),
      ...(l.transparency !== undefined ? { transparency: l.transparency } : {}),
      ...(l.emissive !== undefined ? { emissive: l.emissive } : {}),
      ...(l.representation !== undefined ? { representation: l.representation } : {}),
    };
    for (const s of sets) {
      const runs = loci.get(s.key);
      if (!runs) continue;
      const tr = typeRuns(s);
      for (const t of s.typeTable) {
        const inter = intersectRuns(tr[t.index], runs);
        if (!inter.length) continue;
        const key = `${s.key}#${t.index}`;
        if (runsSize(inter) === runsSize(tr[t.index])) whole.set(key, { ...whole.get(key)!, ...props });
        else partial.push({ set: s.key, types: [t.index], runs: inter, ...props });
      }
    }
    // copies inside particular superstructure instances (`part`): virtual sets `<instance set>@<i>><template>`, kept as
    // partial looks for the instancing step to place (runtime/instancing.ts)
    for (const [k, runs] of loci) {
      if (!/@\d+>/.test(k)) continue;
      const tpl = sets.find((x) => x.key === k.slice(k.lastIndexOf('>') + 1));
      // every type the runs cover (one run can span two populations written one after the other)
      const types = tpl
        ? tpl.typeTable.filter((t) => intersectRuns(typeRuns(tpl)[t.index], runs).length).map((t) => t.index)
        : [];
      partial.push({ set: k, types, runs, ...props });
    }
  }
  const looks = [...whole.values()].sort((a, b) => (a.set < b.set ? -1 : a.set > b.set ? 1 : a.types[0] - b.types[0]));
  const selection = view?.selection
    ? [...materialize(view.selection)].map(([set, runs]) => ({ set, runs }))
    : undefined;
  // the camera reads level 0 of a stream, never the loaded tiles (_spec/streaming.md), through its own loci cache: the
  // addresses are the same strings, the loci are not (they name the proxy set)
  const l0 = level0IR(ir);
  const camera = deriveCamera(doc, view, l0, l0 === ir ? materialize : materializer(doc, l0, issues, false));
  const place = viewFrame(doc, view).place;
  return {
    id: view?.id ?? 'default',
    camera,
    looks: [...looks, ...partial],
    selection: selection?.length ? selection : undefined,
    annotations: view?.annotations?.map((a) => ({
      id: a.id,
      text: a.text,
      position: typeof a.target === 'string' ? lociSphere(materialize(a.target), ir)?.center : place(a.target.position),
    })),
    ...(view?.cutaway ? { cutaway: [...materialize(view.cutaway)].map(([set, runs]) => ({ set, runs })) } : {}),
    ...(issues.length ? { issues } : {}),
  };
}

/** MesoQL addresses materialized over `ir`, cached by address string; `issues` collects what they report. */
function materializer(doc: MesoViewSpecDoc, ir: IR, issues: Issue[], parseIssues = true) {
  const parsed = new Map<string, MesoLoci>();
  return (q: string): MesoLoci => {
    let l = parsed.get(q);
    if (l) return l;
    const p = parseMesoQL(q);
    if (parseIssues) issues.push(...p.issues);
    if (!p.expr) l = new Map();
    else {
      const e = evaluateMesoQL(p.expr, { doc, ir });
      issues.push(...e.issues);
      l = e.loci;
    }
    parsed.set(q, l);
    return l;
  };
}

/** Points (`place`) and directions (`turn`) of a view, from its frame to world Å. */
function viewFrame(doc: MesoViewSpecDoc, view: View | undefined) {
  const unit = doc.units?.length ?? 'nm';
  const f = LengthToAngstrom[unit];
  const M = view?.frame ? frameMatrices(doc, unit).get(view.frame) : undefined;
  return {
    // a frame matrix takes the frame's own units (or voxels) to world Å; without one, the document's unit
    place: (p: readonly number[]) =>
      M ? [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]) : p.map((x) => x * f),
    // a direction, turned into the world (the frame's scale does not matter once normalized)
    turn: (v: readonly number[]) =>
      M ? [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2]) : [...v],
  };
}

/**
 * A view's camera in world Å (_spec/views.md). Numeric: its position and target moved by the view frame's matrix (a
 * camera written in a tomogram's frame lands where the tomogram is), its up turned by it. Semantic: the focus address
 * materialized, its bounding sphere framed from the given direction (turned by the view frame) at the framing's
 * distance. Either way the up is made perpendicular to the view direction.
 */
function deriveCamera(
  doc: MesoViewSpecDoc,
  view: View | undefined,
  ir: IR,
  materialize: (q: string) => MesoLoci,
): IRView['camera'] {
  const cam = view?.camera;
  if (!cam) return undefined;
  const { place, turn } = viewFrame(doc, view);
  const fov = cam.fov ?? 45;
  const upIn = cam.up ? turn(cam.up) : [0, 1, 0];
  if (cam.focus) {
    const sphere = lociSphere(materialize(cam.focus), ir);
    if (sphere) {
      let dir: number[];
      if (cam.from === 'outside') {
        // from beyond the scene's centre, through the focus
        const all = lociSphere(
          new Map(
            placementSets(ir)
              .filter((x) => !isUnderSuperstructure(ir, x.key))
              .map((x) => [x.key, [0, x.count]]),
          ),
          ir,
        );
        const c = all?.center ?? [0, 0, 0];
        dir = sphere.center.map((v, k) => v - c[k]);
        if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-6) dir = [0, 0, 1];
      } else if (Array.isArray(cam.from)) dir = turn(cam.from);
      else if (cam.position && cam.target) {
        const [p, t] = [place(cam.position), place(cam.target)];
        dir = p.map((v, k) => v - t[k]);
      } else dir = [0, 0, 1];
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const scale = cam.framing === 'close' ? 0.6 : cam.framing === 'context' ? 2.5 : 1.1;
      const d = (sphere.radius / Math.sin(((fov / 2) * Math.PI) / 180)) * scale;
      return {
        position: sphere.center.map((v, k) => v + (dir[k] / l) * d),
        target: [...sphere.center],
        up: upAcross(upIn, dir),
        fov,
        ...(cam.transition !== undefined ? { transition: cam.transition } : {}),
        focus: { radius: sphere.radius },
      };
    }
  }
  if (!cam.position || !cam.target) return undefined;
  const position = place(cam.position);
  const target = place(cam.target);
  return {
    position,
    target,
    up: upAcross(
      upIn,
      position.map((v, k) => v - target[k]),
    ),
    fov: cam.fov,
    ...(cam.transition !== undefined ? { transition: cam.transition } : {}),
  };
}

/**
 * `up` made perpendicular to the view direction `dir` (unit length). When `up` is nearly along `dir` (a camera looking
 * along its own up: no roll is defined), the world axis least along `dir` stands in for it.
 */
function upAcross(up: readonly number[], dir: readonly number[]): number[] {
  const unit = (v: readonly number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return l > 0 ? v.map((x) => x / l) : v.map(() => 0);
  };
  const d = unit(dir);
  const across = (u: readonly number[]) => {
    const n = unit(u);
    const k = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    return n.map((x, i) => x - k * d[i]);
  };
  if (!d.some((x) => x)) return unit(up);
  let u = across(up);
  if (Math.hypot(u[0], u[1], u[2]) < 0.1) {
    const axes = [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ];
    const least = axes.reduce((a, b) =>
      Math.abs(a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) <= Math.abs(b[0] * d[0] + b[1] * d[1] + b[2] * d[2]) ? a : b,
    );
    u = across(least);
  }
  return unit(u);
}
