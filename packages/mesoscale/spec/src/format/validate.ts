/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  type Abundance,
  type Arrangement,
  type Id,
  IdPattern,
  type Length,
  type Location,
  type MesoViewSpecDoc,
  type Population,
  type Superstructure,
} from './doc.js';
import { type Issue, type IssueCode, issue } from './issues.js';
import { parseMesoQL, type QType } from './mesoql.js';
import { ConcentrationToMolar, DensityToPerA2, isLengthUnit } from './units.js';

// Static validation (design.md §7.4, phase `static`): the document alone, no resource loaded, no resolver run. Every
// problem is an issue with a JSON pointer; nothing throws. A document with errors is not resolved; warnings are
// carried into the runtime's report.

export const SupportedMajor = 0;

type Kind =
  | 'frame'
  | 'alignment'
  | 'resource'
  | 'entity'
  | 'compartment'
  | 'population'
  | 'catalog'
  | 'relation'
  | 'model'
  | 'evidence'
  | 'activity'
  | 'view'
  | 'annotation'
  | 'superstructure'
  | 'tour'
  | 'instance';

const Sections: readonly [keyof MesoViewSpecDoc, Kind][] = [
  ['frames', 'frame'],
  ['alignments', 'alignment'],
  ['resources', 'resource'],
  ['entities', 'entity'],
  ['compartments', 'compartment'],
  ['populations', 'population'],
  ['instances', 'instance'],
  ['catalogs', 'catalog'],
  ['relations', 'relation'],
  ['models', 'model'],
  ['evidence', 'evidence'],
  ['activities', 'activity'],
  ['views', 'view'],
  ['superstructures', 'superstructure'],
  ['tours', 'tour'],
];

// the words a field takes (doc.ts): a typo is refused here, not met late as a resolver's unsupported case
const Locations: readonly Location[] = ['interior', 'membrane', 'outer-surface', 'inner-surface', 'exterior'];
const Details: readonly NonNullable<Population['detail']>[] = ['parts', 'entity'];
const ArrangementKinds: readonly Arrangement['kind'][] = ['random', 'lattice', 'fiber', 'bilayer'];

const InnerSections: readonly [keyof Superstructure, Kind][] = [
  ['entities', 'entity'],
  ['compartments', 'compartment'],
  ['populations', 'population'],
  ['models', 'model'],
  ['relations', 'relation'],
];

/**
 * A superstructure as a document of its own (design.md §3.9): its contents, the document's entities (and its own),
 * resources, evidence and activities, so its references resolve; no frames or views. The runtime resolves it with this.
 */
export function superstructureDoc(doc: MesoViewSpecDoc, ss: Superstructure): MesoViewSpecDoc {
  return {
    format: doc.format,
    version: doc.version,
    metadata: { title: ss.label },
    units: doc.units,
    resources: doc.resources,
    entities: [...doc.entities, ...(ss.entities ?? [])],
    superstructures: doc.superstructures,
    compartments: ss.compartments,
    populations: ss.populations,
    models: ss.models,
    relations: ss.relations,
    evidence: doc.evidence,
    activities: doc.activities,
  };
}

export interface DocIndex {
  readonly kinds: ReadonlyMap<Id, Kind>;
  readonly paths: ReadonlyMap<Id, string>;
}

/**
 * Every id of the document, by kind. `inner` (default) adds the superstructures' contents: MesoQL addresses them
 * (`(part Q p.inner)`); a structural reference (a population's compartment, a model's populations) sees only the
 * document's own sections (`inner` false), so a superstructure's contents stay its own (design.md §3.9).
 */
export function indexDoc(doc: MesoViewSpecDoc, inner = true): DocIndex {
  const kinds = new Map<Id, Kind>();
  const paths = new Map<Id, string>();
  for (const [section, kind] of Sections) {
    const xs = arrayOr(doc[section] as readonly ({ id: Id } | null)[] | undefined);
    xs.forEach((x, i) => {
      if (x && !kinds.has(x.id)) {
        kinds.set(x.id, kind);
        paths.set(x.id, `/${section}/${i}`);
      }
    });
  }
  // a superstructure's contents share the document's id namespace (MesoQL addresses them by id)
  if (inner)
    (doc.superstructures ?? []).forEach((ss, i) => {
      for (const [section, kind] of InnerSections)
        arrayOr(ss?.[section] as readonly ({ id: Id } | null)[] | undefined).forEach((x, j) => {
          if (x && !kinds.has(x.id)) {
            kinds.set(x.id, kind);
            paths.set(x.id, `/superstructures/${i}/${section}/${j}`);
          }
        });
    });
  arrayOr(doc.views).forEach((v, i) =>
    arrayOr(v?.annotations).forEach((a, j) => {
      if (a && !kinds.has(a.id)) {
        kinds.set(a.id, 'annotation');
        paths.set(a.id, `/views/${i}/annotations/${j}`);
      }
    }),
  );
  return { kinds, paths };
}

const arrayOr = <T>(xs: readonly T[] | null | undefined): readonly T[] => (Array.isArray(xs) ? xs : []);

/** `nested`: a superstructure checked as a document of its own, whose superstructures the outer check covers. */
export function validate(doc: MesoViewSpecDoc, nested = false): Issue[] {
  const out: Issue[] = [];
  const err = (code: IssueCode, message: string, path: string, ids?: Id[]) =>
    out.push(issue(code, 'error', 'static', message, { path, ids }));
  const warn = (code: IssueCode, message: string, path: string, ids?: Id[]) =>
    out.push(issue(code, 'warning', 'static', message, { path, ids }));

  if (doc?.format !== 'meso_view_spec') {
    err('format.version', `format is ${JSON.stringify(doc?.format)}, not "meso_view_spec"`, '/format');
    return out;
  }
  const major = Number(String(doc.version ?? '').split('.')[0]);
  if (!Number.isInteger(major) || major > SupportedMajor) {
    err('format.version', `version ${doc.version} is newer than this runtime reads (${SupportedMajor}.x)`, '/version');
  }
  for (const s of ['entities', 'compartments', 'populations'] as const) {
    if (!Array.isArray(doc[s])) err('ref.missing', `${s} is required (an array)`, `/${s}`);
  }
  if (out.length) return out;
  // the shape the checks below read: lists are lists of objects (a malformed document is issues, never a throw)
  const objects = (xs: unknown, path: string, required = false) => {
    if (xs == null) return required ? err('value.missing', 'a list is required here', path) : undefined;
    if (!Array.isArray(xs)) return err('value.missing', 'a list is expected here', path);
    xs.forEach((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x))
        err('value.missing', 'an object is expected here', `${path}/${i}`);
    });
  };
  for (const [section] of Sections) objects(doc[section], `/${section}`);
  arrayOr(doc.superstructures).forEach((ss, i) => {
    if (!ss || typeof ss !== 'object') return;
    objects(ss.compartments, `/superstructures/${i}/compartments`, true);
    objects(ss.populations, `/superstructures/${i}/populations`, true);
    for (const [section] of InnerSections) objects(ss[section], `/superstructures/${i}/${section}`);
  });
  arrayOr(doc.views).forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    objects(v.looks, `/views/${i}/looks`);
    objects(v.annotations, `/views/${i}/annotations`);
  });
  arrayOr(doc.tours).forEach((t, i) => {
    if (t && typeof t === 'object') objects(t.steps, `/tours/${i}/steps`, true);
  });
  if (out.length) return out;
  const need = (v: unknown, what: string, path: string) => {
    if (v == null) err('value.missing', `${what} is required`, path);
  };
  const oneOf = (v: unknown, words: readonly string[], what: string, path: string) => {
    if (v !== undefined && !words.includes(v as string))
      err('value.range', `${what} ${JSON.stringify(v)} is ${words.join(', ')}`, path);
  };

  const docUnit = doc.units?.length ?? 'nm';
  if (!isLengthUnit(docUnit)) err('unit.unknown', `units.length ${docUnit} is not A, nm or um`, '/units/length');

  // ids: pattern, unique across every section
  const seen = new Map<Id, string>();
  const id = (x: { id: Id }, path: string) => {
    if (typeof x.id !== 'string' || !IdPattern.test(x.id)) return err('id.invalid', `id ${JSON.stringify(x.id)}`, path);
    const before = seen.get(x.id);
    if (before) err('id.duplicate', `id ${x.id} is also at ${before}`, path, [x.id]);
    else seen.set(x.id, path);
  };
  for (const [section] of Sections)
    ((doc[section] as readonly { id: Id }[] | undefined) ?? []).forEach((x, i) => id(x, `/${section}/${i}/id`));
  // annotations are nodes too (indexDoc names them)
  (doc.views ?? []).forEach((v, i) =>
    (v.annotations ?? []).forEach((a, j) => id(a, `/views/${i}/annotations/${j}/id`)),
  );
  if (!nested)
    (doc.superstructures ?? []).forEach((ss, i) => {
      for (const [section] of InnerSections)
        ((ss[section] as readonly { id: Id }[] | undefined) ?? []).forEach((x, j) => {
          const path = `/superstructures/${i}/${section}/${j}/id`;
          const before = seen.get(x.id);
          if (before) err('id.duplicate', `id ${x.id} is also at ${before}`, path, [x.id]);
          else seen.set(x.id, path);
        });
    });
  // MesoQL sees the superstructures' contents; a structural reference only the document's own sections
  const { kinds } = indexDoc(doc);
  const own = indexDoc(doc, false).kinds;
  const ref = (id: Id | undefined, want: Kind | readonly Kind[], path: string) => {
    if (id === undefined) return;
    const k = own.get(id);
    const wants = typeof want === 'string' ? [want] : want;
    if (!k) err('ref.missing', `${id} names nothing`, path, [id]);
    else if (!wants.includes(k))
      err('ref.kind', `${id} is ${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k}, not ${wants.join(' or ')}`, path, [id]);
  };
  const length = (l: Length | undefined, path: string, positive = true) => {
    if (l === undefined) return;
    if (l === null || (typeof l !== 'number' && typeof l !== 'object'))
      return err('value.missing', 'a length is a number or a quantity (value unit)', path);
    const v = typeof l === 'number' ? l : l.value;
    if (typeof l === 'object' && !isLengthUnit(l.unit)) err('unit.unknown', `length unit ${l.unit}`, path);
    if (!Number.isFinite(v) || (positive && v <= 0)) err('value.range', `length ${v} must be positive`, path);
  };
  // MesoQL addresses (design.md §3.8): parsed and their ids checked against the document
  // (the slot says the type: a selection to draw or frame, a site to attach at, residues to resolve)
  const sites = new Map<Id, readonly string[]>();
  for (const e of [...doc.entities, ...arrayOr(doc.superstructures).flatMap((x) => arrayOr(x.entities))])
    if (e && !sites.has(e.id))
      sites.set(
        e.id,
        arrayOr(e.sites).flatMap((x) => (x ? [x.id] : [])),
      );
  const address = (q: string | undefined, path: string, want: QType, required = false) => {
    if (q == null) return required ? err('value.missing', 'an address is required', path) : undefined;
    if (typeof q !== 'string') return err('mesoql.syntax', 'an address is a MesoQL string, (entity e.x)', path);
    for (const i of parseMesoQL(q, { kinds, sites }, path, want).issues) out.push(i);
  };
  const evidence = (ids: readonly Id[] | undefined, path: string) =>
    arrayOr(ids).forEach((e, i) => ref(e, 'evidence', `${path}/${i}`));
  const triple = (xs: readonly Length[] | undefined, path: string) => {
    if (!Array.isArray(xs) || xs.length !== 3) return err('value.missing', 'three lengths [x y z]', path);
    xs.forEach((r, j) => length(r, `${path}/${j}`));
  };

  // frames and alignments
  const frames = doc.frames ?? [];
  const worlds = frames.filter((f) => f.kind === 'world');
  if (frames.length && worlds.length !== 1)
    err('frame.world', `${worlds.length} world frames; a document with frames has exactly one`, '/frames');
  frames.forEach((f, i) => {
    if (!isLengthUnit(f.units)) err('unit.unknown', `frame units ${f.units}`, `/frames/${i}/units`);
    if (!f.handedness) warn('frame.handedness', `frame ${f.id} does not say its handedness`, `/frames/${i}`, [f.id]);
    length(f.voxelSize, `/frames/${i}/voxelSize`);
  });
  const aligned = new Set(worlds.map((w) => w.id));
  // a frame is aligned when a chain of alignments reaches the world (either direction)
  const als = doc.alignments ?? [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of als) {
      if (aligned.has(a.to) && !aligned.has(a.from)) changed = !!aligned.add(a.from);
      else if (aligned.has(a.from) && !aligned.has(a.to)) changed = !!aligned.add(a.to);
    }
  }
  als.forEach((a, i) => {
    need(a.from, 'from', `/alignments/${i}/from`);
    need(a.to, 'to', `/alignments/${i}/to`);
    ref(a.from, 'frame', `/alignments/${i}/from`);
    ref(a.to, 'frame', `/alignments/${i}/to`);
    ref(a.activity, 'activity', `/alignments/${i}/activity`);
    evidence(a.evidence, `/alignments/${i}/evidence`);
    const t = a.transform;
    if (!t) return err('value.missing', 'an alignment has a transform', `/alignments/${i}/transform`);
    if (t.matrix && t.matrix.length !== 16)
      err('value.range', 'matrix has 16 numbers', `/alignments/${i}/transform/matrix`);
    if (t.rotation && Math.abs(Math.hypot(...t.rotation) - 1) > 1e-3)
      err('value.range', 'rotation is not a unit quaternion', `/alignments/${i}/transform/rotation`);
    length(a.residual, `/alignments/${i}/residual`, false);
  });

  // resources
  (doc.resources ?? []).forEach((r, i) => {
    ref(r.frame, 'frame', `/resources/${i}/frame`);
    if (!r.uri && !r.accession)
      warn('resource.unavailable', `resource ${r.id} has neither a uri nor an accession`, `/resources/${i}`, [r.id]);
    if (r.frame && frames.length && !aligned.has(r.frame))
      warn(
        'frame.unaligned',
        `resource ${r.id} is in frame ${r.frame}, which no alignment ties to the world`,
        `/resources/${i}/frame`,
        [r.id],
      );
  });

  // entities
  doc.entities.forEach((e, i) => {
    ref(e.structure?.resource, 'resource', `/entities/${i}/structure/resource`);
    length(e.radius, `/entities/${i}/radius`);
    evidence(e.evidence, `/entities/${i}/evidence`);
  });

  // compartments: references, geometry, containment without cycles
  const comps = new Map(doc.compartments.map((c) => [c.id, c]));
  doc.compartments.forEach((c, i) => {
    const p = `/compartments/${i}`;
    ref(c.parent, 'compartment', `${p}/parent`);
    evidence(c.evidence, `${p}/evidence`);
    const g = c.geometry;
    if (!g) return err('ref.missing', 'geometry is required', `${p}/geometry`);
    if (g.kind === 'sphere') length(g.radius, `${p}/geometry/radius`);
    else if (g.kind === 'ellipsoid') triple(g.radii, `${p}/geometry/radii`);
    else if (g.kind === 'box') triple(g.size, `${p}/geometry/size`);
    else if (g.kind === 'mesh' || g.kind === 'segmentation') ref(g.resource, 'resource', `${p}/geometry/resource`);
    else if (g.kind !== 'implicit')
      err('value.range', `geometry kind ${(g as { kind: string }).kind}`, `${p}/geometry/kind`);
    length(c.membrane?.thickness, `${p}/membrane/thickness`);
    ref(c.membrane?.leaflets?.inner, 'entity', `${p}/membrane/leaflets/inner`);
    ref(c.membrane?.leaflets?.outer, 'entity', `${p}/membrane/leaflets/outer`);
    const chain = new Set<Id>([c.id]);
    for (let q = c.parent ? comps.get(c.parent) : undefined; q; q = q.parent ? comps.get(q.parent) : undefined) {
      if (chain.has(q.id)) {
        err('compartment.cycle', `${c.id} is inside itself through ${[...chain].join(' > ')}`, `${p}/parent`, [c.id]);
        break;
      }
      chain.add(q.id);
    }
  });

  // populations
  doc.populations.forEach((pop, i) => {
    const p = `/populations/${i}`;
    need(pop.entity, 'entity', `${p}/entity`);
    need(pop.compartment, 'compartment', `${p}/compartment`);
    need(pop.location, 'location', `${p}/location`);
    oneOf(pop.location, Locations, 'location', `${p}/location`);
    oneOf(pop.detail, Details, 'detail', `${p}/detail`);
    oneOf(pop.arrangement?.kind, ArrangementKinds, 'arrangement', `${p}/arrangement/kind`);
    ref(pop.entity, 'entity', `${p}/entity`);
    ref(pop.compartment, 'compartment', `${p}/compartment`);
    evidence(pop.evidence, `${p}/evidence`);
    const c = comps.get(pop.compartment);
    const onMembrane = pop.location === 'membrane' || pop.arrangement?.kind === 'bilayer';
    if (c && onMembrane && !c.membrane)
      err('location.membrane', `${pop.id} is in ${c.id}'s membrane, which ${c.id} does not declare`, `${p}/location`, [
        pop.id,
      ]);
    abundance(pop.abundance, `${p}/abundance`);
    const a = pop.arrangement;
    if (a?.kind === 'lattice') length(a.spacing, `${p}/arrangement/spacing`);
    if (a?.kind === 'lattice' && a.defects?.vacancy !== undefined && !(a.defects.vacancy >= 0 && a.defects.vacancy < 1))
      err('value.range', 'vacancy is in [0, 1)', `${p}/arrangement/defects/vacancy`);
    if (a?.kind === 'fiber') {
      length(a.rise, `${p}/arrangement/rise`);
      ref(a.path?.resource, 'resource', `${p}/arrangement/path/resource`);
      if (!a.path && !a.growth) err('value.range', 'a fiber has a path or a growth rule', `${p}/arrangement`, [pop.id]);
      if (a.growth) {
        length(a.growth.persistence, `${p}/arrangement/growth/persistence`);
        length(a.growth.length, `${p}/arrangement/growth/length`);
      }
    }
    arrayOr(pop.constraints).forEach((k, j) => {
      if (k?.kind === 'min-distance') {
        ref(k.to, ['population', 'compartment'], `${p}/constraints/${j}/to`);
        length(k.distance, `${p}/constraints/${j}/distance`);
      } else if (k?.kind === 'placed-fraction' && !(k.min >= 0 && k.min <= 1))
        err('value.range', 'min is in [0, 1]', `${p}/constraints/${j}/min`);
    });
  });

  function abundance(a: Abundance, path: string) {
    if (!a || typeof a !== 'object') return err('ref.missing', 'abundance is required', path);
    if ('count' in a) {
      if (!(a.count >= 0)) err('value.range', 'count is not negative', `${path}/count`);
    } else if ('concentration' in a) {
      if (!(a.concentration?.unit in ConcentrationToMolar))
        err('unit.unknown', `concentration unit ${a.concentration?.unit}`, `${path}/concentration/unit`);
      if (!(a.concentration?.value >= 0))
        err('value.range', 'concentration is not negative', `${path}/concentration/value`);
    } else if ('density' in a) {
      if (!(a.density?.unit in DensityToPerA2))
        err('unit.unknown', `density unit ${a.density?.unit}`, `${path}/density/unit`);
      if (!(a.density?.value >= 0)) err('value.range', 'density is not negative', `${path}/density/value`);
    } else if ('volumeFraction' in a) {
      if (!(a.volumeFraction >= 0 && a.volumeFraction < 1))
        err('value.range', 'volumeFraction is in [0, 1)', `${path}/volumeFraction`);
    } else err('value.range', 'abundance is a count, concentration, density or volumeFraction', path);
  }

  (doc.catalogs ?? []).forEach((c, i) => {
    ref(c.resource, 'resource', `/catalogs/${i}/resource`);
    evidence(c.evidence, `/catalogs/${i}/evidence`);
  });
  (doc.relations ?? []).forEach((r, i) => {
    for (const k of ['entry', 'exit'] as const) {
      address(r[k], `/relations/${i}/${k}`, 'site');
    }
    if (r.angle !== undefined && !(r.angle >= 0 && r.angle <= 180))
      err('value.range', 'angle is in [0, 180] degrees', `/relations/${i}/angle`, [r.id]);
    length(r.spacing, `/relations/${i}/spacing`);
    arrayOr(r.contacts).forEach((c, j) => {
      for (const k of ['a', 'b'] as const) address(c?.[k], `/relations/${i}/contacts/${j}/${k}`, 'residues', true);
    });
    if (!Array.isArray(r.subjects)) err('value.missing', 'a relation has subjects', `/relations/${i}/subjects`, [r.id]);
    arrayOr(r.subjects).forEach((s, j) =>
      ref(s, ['population', 'instance', 'entity', 'compartment'], `/relations/${i}/subjects/${j}`),
    );
    arrayOr(r.objects).forEach((s, j) =>
      ref(s, ['population', 'instance', 'entity', 'compartment'], `/relations/${i}/objects/${j}`),
    );
    evidence(r.evidence, `/relations/${i}/evidence`);
  });

  // models: each population realized by at most one; avoid without cycles
  const realizedBy = new Map<Id, Id>();
  // a refiner replaces the result it refines: two refiners of one model would both draw its populations
  const refinedBy = new Map<Id, Id>();
  const models = doc.models ?? [];
  models.forEach((m, i) => {
    const p = `/models/${i}`;
    need(m.method, 'method', `${p}/method`);
    if (!Array.isArray(m.populations))
      err('value.missing', 'a model lists its populations ([] for a refiner)', `${p}/populations`, [m.id]);
    arrayOr(m.populations).forEach((pid, j) => {
      ref(pid, 'population', `${p}/populations/${j}`);
      const by = realizedBy.get(pid);
      if (by) err('model.overlap', `${pid} is realized by ${by} and ${m.id}`, `${p}/populations/${j}`, [pid]);
      else realizedBy.set(pid, m.id);
    });
    (m.inputs ?? []).forEach((r, j) => ref(r, 'resource', `${p}/inputs/${j}`));
    (m.avoid ?? []).forEach((r, j) => ref(r, 'model', `${p}/avoid/${j}`));
    ref(m.refines, 'model', `${p}/refines`);
    if (m.refines) {
      const by = refinedBy.get(m.refines);
      if (by)
        err('model.overlap', `${m.refines} is refined by ${by} and ${m.id}; one refiner a model`, `${p}/refines`, [
          by,
          m.id,
        ]);
      else refinedBy.set(m.refines, m.id);
    }
    if (m.refines && m.populations?.length)
      warn(
        'value.range',
        `${m.id} refines ${m.refines}: it realizes that model's populations; its own list is ignored`,
        `${p}/populations`,
        [m.id],
      );
    ref(m.activity, 'activity', `${p}/activity`);
    evidence(m.evidence, `${p}/evidence`);
  });
  const avoid = new Map(models.map((m) => [m.id, [...arrayOr(m.avoid), ...(m.refines ? [m.refines] : [])]]));
  const state = new Map<Id, 1 | 2>();
  const visit = (id: Id, trail: Id[]): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) {
      err('model.cycle', `models avoid each other in a cycle: ${[...trail, id].join(' > ')}`, '/models', trail);
      return true;
    }
    state.set(id, 1);
    for (const n of avoid.get(id) ?? []) if (visit(n, [...trail, id])) return true;
    state.set(id, 2);
    return false;
  };
  for (const m of models) if (visit(m.id, [])) break;
  doc.populations.forEach((pop, i) => {
    if (!realizedBy.has(pop.id))
      out.push(
        issue(
          'model.unrealized',
          'info',
          'static',
          `${pop.id} has no model: a default resolver places it (by its arrangement; on a strand, the strand's resolver)`,
          { path: `/populations/${i}`, ids: [pop.id] },
        ),
      );
  });

  // evidence and provenance
  (doc.evidence ?? []).forEach((e, i) => ref(e.source?.resource, 'resource', `/evidence/${i}/source/resource`));
  (doc.activities ?? []).forEach((a, i) => {
    (a.used ?? []).forEach((r, j) => ref(r, 'resource', `/activities/${i}/used/${j}`));
    (a.generated ?? []).forEach((r, j) =>
      ref(r, ['resource', 'model', 'alignment'], `/activities/${i}/generated/${j}`),
    );
  });

  doc.entities.forEach((e, i) =>
    arrayOr(e.sites).forEach((s, j) => {
      const p = `/entities/${i}/sites/${j}`;
      if (!s?.at && !s?.position) err('value.range', `site ${s?.id} needs residues (:at) or a position`, p, [e.id]);
      address(s?.at, `${p}/at`, 'residues');
      if (s?.axis && Math.abs(Math.hypot(...s.axis) - 1) > 1e-3)
        err('value.range', 'a site axis is a unit vector', `${p}/axis`);
    }),
  );
  (doc.views ?? []).forEach((v, i) => {
    ref(v.frame, 'frame', `/views/${i}/frame`);
    const cam = v.camera;
    if (cam) {
      if (!cam.focus && !(cam.position && cam.target))
        err('value.range', 'a camera has a focus or a position and a target', `/views/${i}/camera`, [v.id]);
      address(cam.focus, `/views/${i}/camera/focus`, 'selection');
    }
    address(v.cutaway, `/views/${i}/cutaway`, 'selection');
    (v.looks ?? []).forEach((l, j) => {
      address(l.select, `/views/${i}/looks/${j}/select`, 'selection', true);
      if (l.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(l.color))
        err('value.range', `color ${l.color} is #rrggbb`, `/views/${i}/looks/${j}/color`);
      if (l.representation !== undefined && !['spheres', 'structure', 'surface'].includes(l.representation))
        err(
          'value.range',
          `representation ${l.representation} is spheres, structure or surface`,
          `/views/${i}/looks/${j}/representation`,
        );
      if (l.transparency !== undefined && !(l.transparency >= 0 && l.transparency <= 1))
        err('value.range', 'transparency is in [0, 1]', `/views/${i}/looks/${j}/transparency`);
    });
    address(v.selection, `/views/${i}/selection`, 'selection');
    (v.annotations ?? []).forEach((a, j) => {
      evidence(a.evidence, `/views/${i}/annotations/${j}/evidence`);
      if (typeof a.target === 'string') address(a.target, `/views/${i}/annotations/${j}/target`, 'selection');
    });
  });
  ref(doc.session?.view, 'view', '/session/view');
  ref(doc.session?.tour, 'tour', '/session/tour');
  (doc.tours ?? []).forEach((t, i) =>
    arrayOr(t.steps).forEach((st, j) => {
      need(st.view, 'view', `/tours/${i}/steps/${j}/view`);
      ref(st.view, 'view', `/tours/${i}/steps/${j}/view`);
    }),
  );

  // superstructures: each checked as a document of its own (its sections' issues, under its path); no cycles
  const ssById = new Map((doc.superstructures ?? []).map((x) => [x.id, x]));
  const entSs = new Map<Id, Id>();
  for (const e of [...doc.entities, ...(doc.superstructures ?? []).flatMap((x) => x.entities ?? [])])
    if (e.superstructure) entSs.set(e.id, e.superstructure);
  doc.entities.forEach((e, i) => ref(e.superstructure, 'superstructure', `/entities/${i}/superstructure`));
  // instances: what they are, where they sit, and a pose that is a pose
  (doc.instances ?? []).forEach((x, i) => {
    const p = `/instances/${i}`;
    need(x.entity, 'entity', `${p}/entity`);
    need(x.compartment, 'compartment', `${p}/compartment`);
    oneOf(x.location, Locations, 'location', `${p}/location`);
    oneOf(x.detail, Details, 'detail', `${p}/detail`);
    const c = comps.get(x.compartment);
    if (c && x.location === 'membrane' && !c.membrane)
      err('location.membrane', `${x.id} is in ${c.id}'s membrane, which ${c.id} does not declare`, `${p}/location`, [
        x.id,
      ]);
    ref(x.entity, 'entity', `${p}/entity`);
    ref(x.compartment, 'compartment', `${p}/compartment`);
    ref(x.frame, 'frame', `${p}/frame`);
    evidence(x.evidence, `${p}/evidence`);
    const t = x.pose?.translation;
    if (!x.pose || (!x.pose.matrix && !(t && t.length === 3 && t.every(Number.isFinite))))
      err('value.range', `${x.id}: a pose needs a translation [x y z] (or a matrix)`, `${p}/pose`, [x.id]);
    const q = x.pose?.rotation;
    if (q && (q.length !== 4 || Math.abs(Math.hypot(...q) - 1) > 1e-3))
      err('value.range', `${x.id}: the rotation is a unit quaternion [x y z w]`, `${p}/pose/rotation`, [x.id]);
    if (x.detail && !entSs.has(x.entity))
      warn('value.range', `${x.id} sets a detail but ${x.entity} has no superstructure`, `${p}/detail`, [x.id]);
  });
  doc.populations.forEach((p, i) => {
    if (p.detail && !entSs.has(p.entity))
      warn('value.range', `${p.id} sets a detail but ${p.entity} has no superstructure`, `/populations/${i}/detail`, [
        p.id,
      ]);
  });
  if (nested) return out;
  (doc.superstructures ?? []).forEach((ss, i) => {
    if (!ss.compartments?.length)
      err('ref.missing', `superstructure ${ss.id} has no envelope compartment`, `/superstructures/${i}/compartments`, [
        ss.id,
      ]);
    // re-pathed under the superstructure; what is the document's (its entities, resources, evidence, ids across the
    // namespace) the outer check reports itself
    const n = doc.entities.length;
    for (const x of validate(superstructureDoc(doc, ss), true)) {
      if (x.code === 'id.duplicate' || !x.path) continue;
      const e = /^\/entities\/(\d+)(.*)$/.exec(x.path);
      if (e) {
        if (+e[1] >= n) out.push({ ...x, path: `/superstructures/${i}/entities/${+e[1] - n}${e[2]}` });
      } else if (/^\/(compartments|populations|models|relations)(\/|$)/.test(x.path))
        out.push({ ...x, path: `/superstructures/${i}${x.path}` });
    }
  });
  const contains = (id: Id, trail: Id[]): boolean => {
    if (trail.includes(id)) {
      err(
        'superstructure.cycle',
        `superstructures contain each other: ${[...trail, id].join(' > ')}`,
        '/superstructures',
        trail,
      );
      return true;
    }
    for (const p of ssById.get(id)?.populations ?? []) {
      const inner = entSs.get(p.entity);
      if (inner && contains(inner, [...trail, id])) return true;
    }
    return false;
  };
  for (const id of ssById.keys()) if (contains(id, [])) break;
  return out;
}
