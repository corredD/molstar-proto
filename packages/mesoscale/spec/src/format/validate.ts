/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Id, IdPattern, type MesoViewSpecDoc, type Length, type Selector, type Abundance } from './doc.js';
import { type Issue, type IssueCode, issue } from './issues.js';
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
  | 'annotation';

const Sections: readonly [keyof MesoViewSpecDoc, Kind][] = [
  ['frames', 'frame'],
  ['alignments', 'alignment'],
  ['resources', 'resource'],
  ['entities', 'entity'],
  ['compartments', 'compartment'],
  ['populations', 'population'],
  ['catalogs', 'catalog'],
  ['relations', 'relation'],
  ['models', 'model'],
  ['evidence', 'evidence'],
  ['activities', 'activity'],
  ['views', 'view'],
];

export interface DocIndex {
  readonly kinds: ReadonlyMap<Id, Kind>;
  readonly paths: ReadonlyMap<Id, string>;
}

export function indexDoc(doc: MesoViewSpecDoc): DocIndex {
  const kinds = new Map<Id, Kind>();
  const paths = new Map<Id, string>();
  for (const [section, kind] of Sections) {
    const xs = (doc[section] as readonly { id: Id }[] | undefined) ?? [];
    xs.forEach((x, i) => {
      if (!kinds.has(x.id)) {
        kinds.set(x.id, kind);
        paths.set(x.id, `/${section}/${i}`);
      }
    });
  }
  (doc.views ?? []).forEach((v, i) =>
    (v.annotations ?? []).forEach((a, j) => {
      if (!kinds.has(a.id)) {
        kinds.set(a.id, 'annotation');
        paths.set(a.id, `/views/${i}/annotations/${j}`);
      }
    }),
  );
  return { kinds, paths };
}

export function validate(doc: MesoViewSpecDoc): Issue[] {
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

  const docUnit = doc.units?.length ?? 'nm';
  if (!isLengthUnit(docUnit)) err('unit.unknown', `units.length ${docUnit} is not A, nm or um`, '/units/length');

  // ids: pattern, unique across every section
  const seen = new Map<Id, string>();
  for (const [section] of Sections) {
    ((doc[section] as readonly { id: Id }[] | undefined) ?? []).forEach((x, i) => {
      const path = `/${section}/${i}/id`;
      if (typeof x.id !== 'string' || !IdPattern.test(x.id))
        return err('id.invalid', `id ${JSON.stringify(x.id)}`, path);
      const before = seen.get(x.id);
      if (before) err('id.duplicate', `id ${x.id} is also at ${before}`, path, [x.id]);
      else seen.set(x.id, path);
    });
  }
  const { kinds } = indexDoc(doc);
  const ref = (id: Id | undefined, want: Kind | readonly Kind[], path: string) => {
    if (id === undefined) return;
    const k = kinds.get(id);
    const wants = typeof want === 'string' ? [want] : want;
    if (!k) err('ref.missing', `${id} names nothing`, path, [id]);
    else if (!wants.includes(k)) err('ref.kind', `${id} is a ${k}, not a ${wants.join(' or ')}`, path, [id]);
  };
  const length = (l: Length | undefined, path: string, positive = true) => {
    if (l === undefined) return;
    const v = typeof l === 'number' ? l : l.value;
    if (typeof l === 'object' && !isLengthUnit(l.unit)) err('unit.unknown', `length unit ${l.unit}`, path);
    if (!Number.isFinite(v) || (positive && v <= 0)) err('value.range', `length ${v} must be positive`, path);
  };
  const evidence = (ids: readonly Id[] | undefined, path: string) =>
    (ids ?? []).forEach((e, i) => ref(e, 'evidence', `${path}/${i}`));

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
    ref(a.from, 'frame', `/alignments/${i}/from`);
    ref(a.to, 'frame', `/alignments/${i}/to`);
    ref(a.activity, 'activity', `/alignments/${i}/activity`);
    evidence(a.evidence, `/alignments/${i}/evidence`);
    const t = a.transform;
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
    else if (g.kind === 'ellipsoid') g.radii.forEach((r, j) => length(r, `${p}/geometry/radii/${j}`));
    else if (g.kind === 'box') g.size.forEach((r, j) => length(r, `${p}/geometry/size/${j}`));
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
    if (a?.kind === 'fiber') {
      length(a.rise, `${p}/arrangement/rise`);
      ref(a.path?.resource, 'resource', `${p}/arrangement/path/resource`);
      if (!a.path && !a.growth) err('value.range', 'a fiber has a path or a growth rule', `${p}/arrangement`, [pop.id]);
      if (a.growth) {
        length(a.growth.persistence, `${p}/arrangement/growth/persistence`);
        length(a.growth.length, `${p}/arrangement/growth/length`);
      }
    }
    (pop.constraints ?? []).forEach((k, j) => {
      if (k.kind === 'min-distance') {
        ref(k.to, ['population', 'compartment'], `${p}/constraints/${j}/to`);
        length(k.distance, `${p}/constraints/${j}/distance`);
      } else if (k.kind === 'placed-fraction' && !(k.min >= 0 && k.min <= 1))
        err('value.range', 'min is in [0, 1]', `${p}/constraints/${j}/min`);
    });
  });

  function abundance(a: Abundance, path: string) {
    if (!a || typeof a !== 'object') return err('ref.missing', 'abundance is required', path);
    if ('count' in a) {
      if (!(a.count >= 0)) err('value.range', 'count is not negative', `${path}/count`);
    } else if ('concentration' in a) {
      if (!(a.concentration.unit in ConcentrationToMolar))
        err('unit.unknown', `concentration unit ${a.concentration.unit}`, `${path}/concentration/unit`);
      if (!(a.concentration.value >= 0))
        err('value.range', 'concentration is not negative', `${path}/concentration/value`);
    } else if ('density' in a) {
      if (!(a.density.unit in DensityToPerA2))
        err('unit.unknown', `density unit ${a.density.unit}`, `${path}/density/unit`);
      if (!(a.density.value >= 0)) err('value.range', 'density is not negative', `${path}/density/value`);
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
    r.subjects.forEach((s, j) => ref(s, ['population', 'entity', 'compartment'], `/relations/${i}/subjects/${j}`));
    (r.objects ?? []).forEach((s, j) =>
      ref(s, ['population', 'entity', 'compartment'], `/relations/${i}/objects/${j}`),
    );
    evidence(r.evidence, `/relations/${i}/evidence`);
  });

  // models: each population realized by at most one; avoid without cycles
  const realizedBy = new Map<Id, Id>();
  const models = doc.models ?? [];
  models.forEach((m, i) => {
    const p = `/models/${i}`;
    m.populations.forEach((pid, j) => {
      ref(pid, 'population', `${p}/populations/${j}`);
      const by = realizedBy.get(pid);
      if (by) err('model.overlap', `${pid} is realized by ${by} and ${m.id}`, `${p}/populations/${j}`, [pid]);
      else realizedBy.set(pid, m.id);
    });
    (m.inputs ?? []).forEach((r, j) => ref(r, 'resource', `${p}/inputs/${j}`));
    (m.avoid ?? []).forEach((r, j) => ref(r, 'model', `${p}/avoid/${j}`));
    ref(m.activity, 'activity', `${p}/activity`);
    evidence(m.evidence, `${p}/evidence`);
  });
  const avoid = new Map(models.map((m) => [m.id, m.avoid ?? []]));
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
          `${pop.id} has no model: the default resolver for ${pop.arrangement?.kind ?? 'random'} arrangements places it`,
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

  // views
  const selector = (s: Selector | undefined, path: string) => {
    if (!s) return;
    (s.populations ?? []).forEach((x, j) => ref(x, 'population', `${path}/populations/${j}`));
    (s.entities ?? []).forEach((x, j) => ref(x, 'entity', `${path}/entities/${j}`));
    (s.compartments ?? []).forEach((x, j) => ref(x, 'compartment', `${path}/compartments/${j}`));
    (s.instances ?? []).forEach((x, j) => {
      const [pop, k] = x.split('#');
      ref(pop, 'population', `${path}/instances/${j}`);
      if (!/^\d+$/.test(k ?? '')) err('value.range', `instance ${x} is <population>#<n>`, `${path}/instances/${j}`);
    });
  };
  (doc.views ?? []).forEach((v, i) => {
    ref(v.frame, 'frame', `/views/${i}/frame`);
    (v.looks ?? []).forEach((l, j) => {
      selector(l.select, `/views/${i}/looks/${j}/select`);
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
    selector(v.selection, `/views/${i}/selection`);
    (v.annotations ?? []).forEach((a, j) => {
      if ('position' in a.target) return;
      selector(a.target, `/views/${i}/annotations/${j}/target`);
      evidence(a.evidence, `/views/${i}/annotations/${j}/evidence`);
    });
  });
  ref(doc.session?.view, 'view', '/session/view');
  return out;
}
