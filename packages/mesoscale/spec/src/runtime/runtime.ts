/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type {
  Arrangement,
  Compartment,
  Id,
  LengthUnit,
  MesoViewSpecDoc,
  Model,
  Selector,
  Transform,
  View,
} from '../format/doc.js';
import { hasErrors, issue, type Issue } from '../format/issues.js';
import { abundanceToCount, LengthToAngstrom, toAngstrom } from '../format/units.js';
import { validate } from '../format/validate.js';
import { contentHash } from '../ir/hash.js';
import type { IR, IRLook, IRNode, IRShape, IRView } from '../ir/ir.js';
import { meshArea } from '../resolvers/geometry.js';
import { DefaultReaders, readerFor } from './readers.js';
import type {
  LoadedResource,
  MeshData,
  NormalizedArrangement,
  NormalizedCompartment,
  NormalizedPopulation,
  Resolver,
  ResolveJob,
  ResolveOutput,
  ResourceReader,
} from './resolver.js';

// The runtime (design.md §6.1): validate, normalize, dispatch each model to its resolver, assemble the IR, derive the
// view. Results are keyed (design.md §7.2): a model whose projection is unchanged is not resolved again, and its
// placement sets are the same objects as before, so an adapter can tell by identity that nothing moved.

export interface RuntimeOptions {
  readonly resolvers: readonly Resolver<any>[];
  readonly readers?: readonly ResourceReader[];
  /** Raw content of a resource (text, JSON, bytes); undefined when unavailable. Never the network in tests. */
  readonly load?: (resourceId: Id) => unknown | Promise<unknown>;
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

export async function compile(doc: MesoViewSpecDoc, o: RuntimeOptions): Promise<CompileResult> {
  const t0 = now();
  const issues: Issue[] = validate(doc);
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

  // ---- populations: counts and Å ----
  const ents = new Map(doc.entities.map((e) => [e.id, e]));
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
    pops.set(p.id, {
      id: p.id,
      entity: e,
      compartment: p.compartment,
      location: p.location,
      requested: count,
      countWhy: why,
      minFraction: p.constraints?.find((k) => k.kind === 'placed-fraction')?.min ?? 1,
      radius: e.radius !== undefined ? A(e.radius) : undefined,
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
  const byDefault = new Map<string, Id[]>();
  for (const p of doc.populations) {
    if (realized.has(p.id)) continue;
    const r = DefaultResolverByArrangement[p.arrangement?.kind ?? 'random'];
    byDefault.set(r, [...(byDefault.get(r) ?? []), p.id]);
  }
  for (const [method, ps] of byDefault)
    models.push({ id: `default:${method}`, kind: 'procedural', method, populations: ps, seed: 1 });
  const t2 = now();

  // ---- resolve, in `avoid` order ----
  const cache = o.cache ?? new Map<string, ResolveOutput>();
  const order = topoOrder(models);
  const outputs = new Map<
    Id,
    { key: string; out: ResolveOutput; cached: boolean; resolver: Resolver; input: unknown }
  >();
  const statsModels: { model: Id; resolver: string; key: string; cached: boolean; ms: number }[] = [];
  let runs = 0;
  let hits = 0;
  const counts: Record<Id, { requested?: number; achieved: number }> = {};
  const reports: Record<Id, Readonly<Record<string, unknown>> | undefined> = {};
  for (const m of order) {
    const resolver = resolvers.get(m.method);
    const popsOf = m.populations.map((id) => pops.get(id)!).filter(Boolean);
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
    const avoided = (m.avoid ?? []).map((a) => outputs.get(a));
    if (missing || avoided.some((a) => !a)) {
      issues.push(
        issue(
          'resolver.failed',
          'error',
          'resolve',
          `${m.id} not resolved: ${missing ? 'an input is unavailable' : 'a model it avoids failed'}`,
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
    };
    const tr = now();
    let input: unknown;
    let key: string;
    try {
      input = resolver.project(job);
      key = `${m.id}@${contentHash({ resolver: resolver.id, version: resolver.version, input, avoid: avoided.map((a) => a!.key) })}`;
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
    for (const p of job.populations) {
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

  // ---- assemble ----
  const root = assemble(doc, comps, frameToWorld, outputs, models);
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

/** What an edit touches (design.md §7.2): `view` when only views, session or metadata differ (no resolution needed). */
export function classifyEdit(prev: MesoViewSpecDoc, next: MesoViewSpecDoc): 'none' | 'view' | 'model' {
  const strip = ({ views: _v, session: _s, metadata: _m, ...rest }: MesoViewSpecDoc) => rest;
  if (contentHash(prev) === contentHash(next)) return 'none';
  return contentHash(strip(prev)) === contentHash(strip(next)) ? 'view' : 'model';
}

/** A view-only edit: the same IR tree, a new view (O(types), no resolver, no placement touched). */
export function updateView(doc: MesoViewSpecDoc, ir: IR): IR {
  return { root: ir.root, view: deriveView(doc, ir.root) };
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
  if (a.kind === 'lattice') return { kind: 'lattice', lattice: a.lattice, spacing: A(a.spacing) };
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

// ---- frames (design.md §3.4) ----

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

function topoOrder(models: readonly Model[]): Model[] {
  const by = new Map(models.map((m) => [m.id, m]));
  const out: Model[] = [];
  const done = new Set<Id>();
  const visit = (m: Model, stack: Set<Id>) => {
    if (done.has(m.id) || stack.has(m.id)) return;
    stack.add(m.id);
    for (const a of m.avoid ?? []) {
      const d = by.get(a);
      if (d) visit(d, stack);
    }
    done.add(m.id);
    out.push(m);
  };
  for (const m of models) visit(m, new Set());
  return out;
}

// ---- assembly (design.md §4.1) ----

function assemble(
  doc: MesoViewSpecDoc,
  comps: ReadonlyMap<Id, NormalizedCompartment>,
  frames: ReadonlyMap<Id, number[]>,
  outputs: ReadonlyMap<Id, { key: string; out: ResolveOutput; cached: boolean; resolver: Resolver; input: unknown }>,
  models: readonly Model[],
): IRNode {
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
  for (const m of models) {
    const o = outputs.get(m.id);
    if (!o) continue;
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
      },
      children: o.out.sets.map((set, i) => ({
        ref: `${m.id}/placements/${i}`,
        kind: 'placements',
        params: { set },
        origin: [...new Set(set.typeTable.map((t) => t.population))],
      })),
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
        children: [...tops, ...resolves, ...frameNodes],
      },
    ],
  };
}

/** Typed arrays never go into the IR's input summaries: counts instead. */
function summarizeInput(x: unknown): unknown {
  if (ArrayBuffer.isView(x)) return `<${x.constructor.name} ${(x as unknown as { length: number }).length}>`;
  if (Array.isArray(x)) return x.length > 64 ? `<${x.length} items>` : x.map(summarizeInput);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, summarizeInput(v)]));
  return x;
}

// ---- views (design.md §5) ----

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
  const unit = doc.units?.length ?? 'nm';
  const popComp = new Map(doc.populations.map((p) => [p.id, p.compartment]));
  const matches = (s: Selector, population: string, entity: string) =>
    (s.populations?.includes(population) ?? false) ||
    (s.entities?.includes(entity) ?? false) ||
    (s.compartments?.includes(popComp.get(population) ?? '') ?? false);
  const looks: IRLook[] = [];
  const selection: { set: string; type: number; ordinals?: number[] }[] = [];
  const stack: IRNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children ?? []) stack.push(c);
    if (n.kind !== 'placements') continue;
    const set = n.params.set;
    for (const t of set.typeTable) {
      let color = defaultColor(t.population);
      let visible = true;
      let transparency: number | undefined;
      let representation: IRLook['representation'];
      for (const l of view?.looks ?? []) {
        if (!matches(l.select, t.population, t.entity)) continue;
        if (l.color) color = parseInt(l.color.slice(1), 16);
        if (l.visible !== undefined) visible = l.visible;
        if (l.transparency !== undefined) transparency = l.transparency;
        if (l.representation !== undefined) representation = l.representation;
      }
      looks.push({
        set: set.key,
        types: [t.index],
        color,
        visible,
        transparency,
        ...(representation ? { representation } : {}),
      });
      const sel = view?.selection;
      if (sel) {
        if (matches(sel, t.population, t.entity)) selection.push({ set: set.key, type: t.index });
        const ords = (sel.instances ?? [])
          .filter((x) => x.split('#')[0] === t.population)
          .map((x) => Number(x.split('#')[1]));
        if (ords.length) selection.push({ set: set.key, type: t.index, ordinals: ords });
      }
    }
  }
  looks.sort((a, b) => (a.set < b.set ? -1 : a.set > b.set ? 1 : a.types[0] - b.types[0]));
  const f = LengthToAngstrom[unit];
  const cam = view?.camera;
  return {
    id: view?.id ?? 'default',
    camera: cam
      ? {
          position: cam.position.map((x) => x * f),
          target: cam.target.map((x) => x * f),
          up: [...(cam.up ?? [0, 1, 0])],
          fov: cam.fov,
        }
      : undefined,
    looks,
    selection: selection.length ? selection : undefined,
    annotations: view?.annotations?.map((a) => ({
      id: a.id,
      text: a.text,
      position: 'position' in a.target ? a.target.position.map((x) => x * f) : undefined,
    })),
  };
}
