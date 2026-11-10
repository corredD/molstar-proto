/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Column } from '@molstar/core/data/db';
import { OrderedSet } from '@molstar/core/data/int';
import { hash3 } from '@molstar/core/data/util/hash-functions';
import { Clipping } from '@molstar/graphics/theme/clipping';
import { Mat3, Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { PrincipalAxes } from '@molstar/core/math/linear-algebra/matrix/principal-axes';
import { type FiberBank, FiberBankLetters, FiberUnitKeys, fiberUnitSites } from './fiber-units.js';
import { type State, type StateObjectCell, StateTransformer } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { CustomProperties } from '@molstar/model/model/custom-property';
import {
  getParticleEntityGroups,
  getParticleTargetGroups,
  Particle,
  type ParticleAttribute,
  type ParticleList,
  type ParticleTarget,
} from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { isMembranePath } from './pick-surface.js';

// Paint v1 (apps/prism-me/_spec/features.md, "Paint"; progress/2026-11-08-paint.md, Design 1): copies of an existing
// target painted onto a surface. A decorator appends each stroke's particles to the list it takes, so a session keeps
// them and an undo removes a stroke. A painted copy reuses a target (its object): `targetMapping` is kept.

/** One stroke: copies of one target, their positions (Å) and orientations (unit quaternions x, y, z, w) */
export interface PaintStroke {
  readonly target: number;
  /** The copies' entity (`entityInfo`), -1 for none: written only where the list has entities per particle */
  readonly entity: number;
  /** The copies' compartment (`compartmentInfo`), -1 for none: written only where the list has compartments */
  readonly compartment: number;
  readonly positions: readonly number[];
  readonly rotations: readonly number[];
  /**
   * The copies are the points of a new fibre, in order (Round 2, Decided 4): one polyline added to the list's `fibers`.
   * Its `positions` are the fibre's path (Round 3): its points are made from it by the brush's `FiberSettings` (every
   * rise along it, turned by the twist), its `rotations` not read
   */
  readonly fiber?: boolean;
  /** A fibre's jitter's seed (Round 3, Decided 2): the same turns each time the fibre is made */
  readonly seed?: number;
  /**
   * A fibre's sequence (Round 5): with its entity's bank, point i the unit of letter `start + i` (1-based, `end`
   * inclusive; the range repeated along a longer fibre). Absent: the bank's units at random (of the seed)
   */
  readonly sequence?: PaintSequence;
}

/** A fibre's sequence or a range of it (Round 5): one-letter codes, 1-based, `end` inclusive */
export interface PaintSequence {
  readonly residues: string;
  readonly start?: number;
  readonly end?: number;
}

/** The unit's own axis that follows a fibre's path (Round 4): `auto`, its fibres' axis, else its principal axis */
export const FiberAxes = ['auto', 'x', 'y', 'z'] as const;
export type FiberAxis = (typeof FiberAxes)[number];

/**
 * How a brush's painted fibres are made (Round 3; progress/2026-11-08-paint.md): a point every `rise` (Å) along the
 * path, each turned about the fibre by `twist` (°) from the one before, plus a random amount within ±`jitter` (°).
 * Round 4: the unit's `axis` along the path (`auto` without), and each point moved `offset` (Å, 0 without) along a
 * perpendicular of that axis, turned with the unit (`fiberOffsetDirection`)
 */
export interface FiberSettings {
  readonly rise: number;
  readonly twist: number;
  readonly jitter: number;
  readonly axis?: FiberAxis;
  readonly offset?: number;
  /** Round 5: the units its painted fibres switch between by their sequences (`fiber-units.ts`); none without */
  readonly bank?: FiberBank;
}

/** A brush's settings in effect: every one set */
export type FiberSettingsIn = Required<FiberSettings>;

/** A brush's settings by its id (`brushIdOf`), as `ParticleListPainted` keeps them */
export type FiberSettingsMap = Readonly<Record<string, FiberSettings>>;

/** A stroke's brush: its entity on a list with entities, else its target (`fiberOfBrush`'s) */
export function brushIdOf(list: ParticleList, stroke: Pick<PaintStroke, 'entity' | 'target'>): number {
  return list.entityInfo?.size ? stroke.entity : stroke.target;
}

/** The radius of a target's first particle (0 without radii) */
function targetRadius(list: ParticleList, target: number): number {
  if (!list.radii) return 0;
  const groups = getParticleTargetGroups(list);
  const set = groups.sets[groups.groupOfTarget.get(target) ?? -1];
  return set && OrderedSet.size(set) ? list.radii[OrderedSet.start(set)] : 0;
}

/**
 * A brush's fibre settings in effect: the ones given, else its own fibres' (`fiberConventionOf`: their step and twist,
 * no jitter), else points that touch (its diameter, 10 Å without radii) and no twist
 */
export function fiberSettingsOf(
  list: ParticleList,
  id: number,
  target: number,
  given?: FiberSettingsMap,
): FiberSettingsIn {
  const set = given?.[id];
  if (set) return { axis: 'auto', offset: 0, bank: 'none', ...set };
  const c = fiberConventionOf(list, id);
  if (c && c.step > 0) return { rise: c.step, twist: c.twist, jitter: 0, axis: 'auto', offset: 0, bank: 'none' };
  return { rise: 2 * targetRadius(list, target) || 10, twist: 0, jitter: 0, axis: 'auto', offset: 0, bank: 'none' };
}

/** Points every `step` along a path (x, y, z each), by arc length from its first point; the path itself for no step */
export function resamplePath(path: ArrayLike<number>, step: number): number[] {
  const k = Math.floor(path.length / 3);
  if (!(step > 0) || k < 2) return Array.from(path).slice(0, k * 3);
  const out = [path[0], path[1], path[2]];
  // how far along the current segment the next point is
  let next = step;
  let walked = 0;
  for (let i = 1; i < k; ++i) {
    const ax = path[i * 3 - 3];
    const ay = path[i * 3 - 2];
    const az = path[i * 3 - 1];
    const dx = path[i * 3] - ax;
    const dy = path[i * 3 + 1] - ay;
    const dz = path[i * 3 + 2] - az;
    const len = Math.hypot(dx, dy, dz);
    // a tolerance: a path drawn a step a point keeps its last point
    while (next <= walked + len + 1e-6 * step) {
      const t = len > 0 ? Math.min(1, (next - walked) / len) : 0;
      out.push(ax + dx * t, ay + dy * t, az + dz * t);
      next += step;
    }
    walked += len;
  }
  return out;
}

const UnitAxes = { x: Vec3.create(1, 0, 0), y: Vec3.create(0, 1, 0), z: Vec3.create(0, 0, 1) } as const;

/**
 * The way a fibre's points are moved by its offset, in the unit's frame (Round 4): a perpendicular of its axis that
 * follows the path; x's is y, y's z, z's x; another axis's (`auto`), the one of the three least along it, made
 * perpendicular
 */
export function fiberOffsetDirection(out: Vec3, axis: FiberAxis, along: Vec3): Vec3 {
  if (axis === 'x') return Vec3.copy(out, UnitAxes.y);
  if (axis === 'y') return Vec3.copy(out, UnitAxes.z);
  if (axis === 'z') return Vec3.copy(out, UnitAxes.x);
  const a = Vec3.normalize(Vec3(), along);
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const e = ax <= ay && ax <= az ? UnitAxes.x : ay <= az ? UnitAxes.y : UnitAxes.z;
  Vec3.scaleAndAdd(out, e, a, -Vec3.dot(e, a));
  return Vec3.normalize(out, out);
}

/**
 * A fibre stroke's points and their orientations, made from its path by the settings: the unit's axis along the path
 * (the settings' own, else `axis`, the brush's), each point then moved by the offset (`fiberOffsetDirection`, turned)
 */
export function makeFiber(
  path: ArrayLike<number>,
  settings: FiberSettings,
  axis: Vec3,
  seed: number,
): { positions: number[]; rotations: number[] } {
  const kind = settings.axis ?? 'auto';
  const along = kind === 'auto' ? axis : UnitAxes[kind];
  const positions = resamplePath(path, settings.rise);
  const rotations = fiberRotations(positions, { axis: along, twist: settings.twist, jitter: settings.jitter }, seed);
  const offset = settings.offset ?? 0;
  if (offset) {
    const dir = fiberOffsetDirection(Vec3(), kind, along);
    const q = Quat();
    const d = Vec3();
    for (let i = 0; i < positions.length / 3; ++i) {
      Quat.set(q, rotations[i * 4], rotations[i * 4 + 1], rotations[i * 4 + 2], rotations[i * 4 + 3]);
      Vec3.transformQuat(d, dir, q);
      positions[i * 3] += offset * d[0];
      positions[i * 3 + 1] += offset * d[1];
      positions[i * 3 + 2] += offset * d[2];
    }
  }
  return { positions, rotations };
}

/**
 * The particles of `list` with the strokes' copies after them: keys after the input's largest, targets, entities and
 * compartments extended, orientations (identity for an input without), radii (each copy its target's first particle's),
 * attributes not present for the copies, fibres untouched. No stroke (or none with a copy): the list itself.
 */
export function paintParticles(
  list: ParticleList,
  painted: readonly PaintStroke[],
  fibers?: FiberSettingsMap,
): ParticleList {
  const strokes = makeFibers(list, painted, fibers);
  const units = withUnits(list, strokes);
  let added = 0;
  for (const s of strokes) added += Math.floor(s.positions.length / 3);
  if (!added) return list;
  const n = list.count;
  const count = n + added;

  let maxKey = -1;
  for (let i = 0; i < n; ++i) if (list.keys[i] > maxKey) maxKey = list.keys[i];
  const keys = new Int32Array(count);
  keys.set(list.keys);
  const targets = new Int32Array(count);
  targets.set(list.targets);
  const coordinates = new Float32Array(count * 3);
  coordinates.set(list.coordinates);
  const rotations = new Float32Array(count * 4);
  if (list.rotations) rotations.set(list.rotations);
  else for (let i = 0; i < n; ++i) rotations[i * 4 + 3] = 1;
  const entities = list.entities ? new Int32Array(count) : undefined;
  entities?.set(list.entities!);
  const compartments = list.compartments ? new Int32Array(count) : undefined;
  compartments?.set(list.compartments!);
  const radii = list.radii ? new Float32Array(count) : undefined;
  radii?.set(list.radii!);
  const groups = radii ? getParticleTargetGroups(list) : undefined;

  let at = n;
  /** The fibre strokes' first copy and count, in order */
  const newFibers: number[] = [];
  for (const s of strokes) {
    const k = Math.floor(s.positions.length / 3);
    // a fibre of two points or more: a click (one) is a copy (review S4)
    if (s.fiber && k >= 2) newFibers.push(at, k);
    const set = groups?.sets[groups.groupOfTarget.get(s.target) ?? -1];
    const radius = set && OrderedSet.size(set) ? list.radii![OrderedSet.start(set)] : 0;
    const of = s.units ? units.idOf(s) : undefined;
    for (let j = 0; j < k; ++j, ++at) {
      keys[at] = ++maxKey;
      targets[at] = of ? of[j] : s.target;
      coordinates[at * 3] = s.positions[j * 3];
      coordinates[at * 3 + 1] = s.positions[j * 3 + 1];
      coordinates[at * 3 + 2] = s.positions[j * 3 + 2];
      for (let c = 0; c < 4; ++c) rotations[at * 4 + c] = s.rotations[j * 4 + c] ?? (c === 3 ? 1 : 0);
      if (entities) entities[at] = s.entity;
      if (compartments) compartments[at] = s.compartment;
      if (radii) radii[at] = of ? unitRadius(s.units![j]) : radius;
    }
  }

  const label = list.getParticleLabel;
  const name = (i: number) => {
    const e = entities?.[i] ?? list.targetInfo.get(targets[i])?.entity;
    return (e !== undefined && list.entityInfo?.get(e)?.name) || list.targetInfo.get(targets[i])?.name || 'Particle';
  };
  return {
    ...list,
    count,
    keys,
    targets,
    coordinates,
    rotations,
    ...(entities ? { entities } : {}),
    ...(compartments ? { compartments } : {}),
    ...(radii ? { radii } : {}),
    ...(list.attributes ? { attributes: extendAttributes(list.attributes, n, count) } : {}),
    ...(newFibers.length ? { fibers: withFibers(list.fibers, newFibers) } : {}),
    targetMapping: units.targetMapping,
    targetInfo: units.targetInfo,
    getParticleLabel: (i) => (i < n ? label(i) : `${name(i)} · painted ${i - n + 1}${units.letterOf(i - n)}`),
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

/**
 * The strokes with each fibre stroke's points made (`makeFiber`) by its brush's settings (`fiberSettingsOf`) about its
 * brush's fibre axis (its own fibres', else its target's principal axis); the others as they are
 */
function makeFibers(list: ParticleList, strokes: readonly PaintStroke[], given?: FiberSettingsMap): MadeStroke[] {
  const axes = new Map<number, Vec3>();
  return strokes.map((s) => {
    if (!s.fiber || s.positions.length < 6) return s;
    const id = brushIdOf(list, s);
    let axis = axes.get(id);
    if (!axis) {
      axis = fiberConventionOf(list, id)?.axis ?? principalAxisOf(list.targetMapping?.get(s.target));
      axes.set(id, axis);
    }
    const settings = fiberSettingsOf(list, id, s.target, given);
    const made = makeFiber(s.positions, settings, axis, s.seed ?? 0);
    // a bank's units only where the brush is an entity (a list without: its targets are its brushes)
    const bank = list.entityInfo?.size && settings.bank !== 'none' ? settings.bank : undefined;
    return { ...s, ...made, ...(bank ? fiberUnits(bank, s.sequence, made.positions.length / 3, s.seed ?? 0) : {}) };
  });
}

/** A made stroke: a fibre's units a point (`fiberUnits`) and their letters */
type MadeStroke = PaintStroke & { readonly units?: readonly string[]; readonly letters?: string };

/**
 * A fibre's `count` units of `bank` (Round 5): its sequence's letters from `start` to `end` (1-based, inclusive),
 * repeated; a letter not in the bank, or no sequence, a unit at random (of the seed and the point)
 */
export function fiberUnits(
  bank: Exclude<FiberBank, 'none'>,
  sequence: PaintSequence | undefined,
  count: number,
  seed: number,
): { units: string[]; letters: string } {
  const table = FiberBankLetters[bank];
  const keys = Object.keys(table);
  const residues = sequence?.residues.replace(/\s+/g, '').toUpperCase() ?? '';
  const from = Math.max(0, (sequence?.start ?? 1) - 1);
  const to = Math.min(residues.length, sequence?.end ?? residues.length);
  const range = residues.slice(from, Math.max(from, to));
  const units: string[] = [];
  let letters = '';
  for (let i = 0; i < count; ++i) {
    let letter = range ? range[i % range.length] : '';
    if (!table[letter]) letter = keys[Math.min(keys.length - 1, Math.floor(paintRandom(seed, i, 5) * keys.length))];
    units.push(table[letter]);
    letters += letter;
  }
  return { units, letters };
}

/** A unit's radius: its sites' farthest reach from its origin (a painted point's, for the culling and the picking) */
const unitRadii = new Map<string, number>();
function unitRadius(key: string): number {
  let r = unitRadii.get(key);
  if (r !== undefined) return r;
  const sites = fiberUnitSites(key);
  r = 0;
  if (sites) {
    const p = sites.positions;
    for (let i = 0; i < sites.count; ++i) {
      r = Math.max(r, Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) + sites.radii[i]);
    }
  }
  unitRadii.set(key, r);
  return r;
}

/** The maps a list's painted units extend, by the input's maps and the units used (the same maps for the same) */
const unitMaps = new WeakMap<
  object,
  { key: string; mapping: ParticleList['targetMapping']; info: ParticleList['targetInfo'] }
>();

/**
 * The targets of the strokes' units (Round 5): a target a unit and an entity (`targetInfo` says a target's entity),
 * its id after the list's largest, of the unit's place and the entity (stable: the same each time the list is made);
 * the list's own maps without one, the same maps again for the same units
 */
function withUnits(list: ParticleList, strokes: readonly MadeStroke[]) {
  const used = new Map<string, number>();
  let base = 0;
  for (const t of list.targetInfo.keys()) if (t >= base) base = t + 1;
  if (list.targetMapping) for (const t of list.targetMapping.keys()) if (t >= base) base = t + 1;
  const idOfUnit = (entity: number, key: string) => base + entity * FiberUnitKeys.length + FiberUnitKeys.indexOf(key);
  for (const s of strokes) {
    if (!s.units) continue;
    for (const u of s.units) used.set(`${s.entity}:${u}`, idOfUnit(s.entity, u));
  }
  const offsets: number[] = [];
  let at = 0;
  for (const s of strokes) {
    offsets.push(at);
    at += Math.floor(s.positions.length / 3);
  }
  const letterOf = (i: number) => {
    // a painted point's letter and its place in its fibre (`· A12`)
    let k = 0;
    while (k + 1 < offsets.length && offsets[k + 1] <= i) ++k;
    const letters = strokes[k]?.letters;
    const j = i - (offsets[k] ?? 0);
    return letters ? ` · ${letters[j]}${(strokes[k].sequence?.start ?? 1) + j}` : '';
  };
  const idOf = (s: MadeStroke) => s.units!.map((u) => idOfUnit(s.entity, u));
  if (!used.size) return { targetMapping: list.targetMapping, targetInfo: list.targetInfo, idOf, letterOf };
  const key = [...used.keys()].sort().join(',');
  const owner = (list.targetMapping ?? list.targetInfo) as object;
  const kept = unitMaps.get(owner);
  if (kept?.key === key) return { targetMapping: kept.mapping, targetInfo: kept.info, idOf, letterOf };
  const mapping = new Map(list.targetMapping ?? []);
  const info = new Map(list.targetInfo);
  for (const [k, id] of used) {
    const [entity, unit] = [Number(k.slice(0, k.indexOf(':'))), k.slice(k.indexOf(':') + 1)];
    mapping.set(id, { kind: 'sites', sites: fiberUnitSites(unit)! });
    info.set(id, { name: unit, entity });
  }
  unitMaps.set(owner, { key, mapping, info });
  return { targetMapping: mapping, targetInfo: info, idOf, letterOf };
}

/** `fibers` (or none) with a polyline per (first, count) pair of `added` after them: its particles in order */
function withFibers(fibers: ParticleList['fibers'], added: readonly number[]): NonNullable<ParticleList['fibers']> {
  const old = fibers?.count ?? 0;
  const oldIndices = fibers?.indices.length ?? 0;
  let total = oldIndices;
  for (let f = 1; f < added.length; f += 2) total += added[f];
  const count = old + added.length / 2;
  const offsets = new Int32Array(count + 1);
  if (fibers) offsets.set(fibers.offsets.subarray(0, old + 1));
  const indices = new Int32Array(total);
  if (fibers) indices.set(fibers.indices);
  let at = oldIndices;
  for (let f = 0; f < added.length; f += 2) {
    for (let j = 0; j < added[f + 1]; ++j) indices[at++] = added[f] + j;
    offsets[old + f / 2 + 1] = at;
  }
  return { count, offsets, indices };
}

/** The attributes over `count` particles: the first `n` as they were, the rest not present */
function extendAttributes(
  attributes: ReadonlyMap<string, ParticleAttribute>,
  n: number,
  count: number,
): ReadonlyMap<string, ParticleAttribute> {
  const out = new Map<string, ParticleAttribute>();
  for (const [key, a] of attributes) {
    const c = a.column;
    const column = Column.ofLambda({
      value: (i: number) => (i < n ? c.value(i) : 0),
      rowCount: count,
      schema: c.schema,
      valueKind: (i: number) => (i < n ? c.valueKind(i) : Column.ValueKinds.NotPresent),
    });
    out.set(key, { ...a, column });
  }
  return out;
}

/** The list a decorator last took (as plugin core's particle decorators: what is above it may change it) */
type InputCache = { input?: ParticleList };

export { ParticleListPainted };
type ParticleListPainted = typeof ParticleListPainted;
/**
 * Copies of a list's targets painted onto a surface (`mesoscale.paint`): each stroke's particles appended to the list,
 * in its frame (under its move and scale). A decorator: what is under it takes the painted list.
 */
const ParticleListPainted = PluginStateTransform.BuiltIn({
  name: 'mesoscale-particle-list-painted',
  display: { name: 'Painted', description: 'Copies of the targets painted onto a surface.' },
  isDecorator: true,
  from: SO.Particle.List,
  to: SO.Particle.List,
  params: {
    strokes: PD.Value<PaintStroke[]>([], { description: 'The strokes, in the order painted', isHidden: true }),
    fibers: PD.Value<FiberSettingsMap>(
      {},
      {
        description: "The brushes' fibre settings (rise, twist, jitter) by brush id: their fibres made by them",
        isHidden: true,
      },
    ),
  },
})({
  apply({ a, params, cache }) {
    (cache as InputCache).input = a.data;
    return new SO.Particle.List(paintParticles(a.data, params.strokes, params.fibers), {
      label: a.label,
      description: a.description,
    });
  },
  update({ a, b, newParams, oldParams, cache }) {
    const c = cache as InputCache;
    const changed = c.input !== a.data;
    c.input = a.data;
    if (!changed && sameStrokes(newParams.strokes, oldParams.strokes) && newParams.fibers === oldParams.fibers) {
      return StateTransformer.UpdateResult.Unchanged;
    }
    b.data = paintParticles(a.data, newParams.strokes, newParams.fibers);
    b.label = a.label;
    b.description = a.description;
    return StateTransformer.UpdateResult.Updated;
  },
});

/** Whether two stroke lists are the same strokes (a stroke is never edited in place: compared by reference) */
function sameStrokes(a: readonly PaintStroke[], b: readonly PaintStroke[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
  return true;
}

// --- Orientation (Decided 2, Ludo 2026-11-08) ------------------------------------------------------------------------

/**
 * How each copy is turned: `normal`, its local +z along the surface's normal (a membrane protein: cellPACK's surface
 * ingredients have their mid-plane at z = 0, +z out); `axis`, its principal axis along the normal; `view`, its +z
 * toward the viewer; `random`, any orientation. Every one but `random` spins the copy about that axis at random.
 */
export const PaintOrients = ['normal', 'axis', 'view', 'random'] as const;
export type PaintOrient = (typeof PaintOrients)[number];

/** A random number in [0, 1) of a seed, a copy and a draw: the same each time (a redo, a test) */
export function paintRandom(seed: number, i: number, k: number): number {
  // the Wang hash of the three (Clipping's stable random): hash3 alone mixes its top bits poorly
  return Clipping.random(hash3(seed | 0, i, k));
}

const _z = Vec3.create(0, 0, 1);
const _n = Vec3();
const _a = Vec3();
const _q = Quat();
const _spin = Quat();
const _v = Vec3();

/**
 * The orientation of each copy (x, y, z, w per copy) from the normals at its point (unit or not; `normal`, `axis`,
 * `view`: the direction to align with). `axis` is the target's own principal axis (its frame); `spin`, degrees about
 * that axis for every copy, else random. `random` ignores the normals.
 */
export function paintRotations(
  normals: ArrayLike<number>,
  orient: PaintOrient,
  seed: number,
  options: { readonly axis?: Vec3; readonly spin?: number } = {},
): number[] {
  const k = Math.floor(normals.length / 3);
  const out: number[] = new Array(k * 4);
  for (let i = 0; i < k; ++i) {
    Vec3.set(_v, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    paintRotation(_q, _v, orient, seed, i, options);
    out[i * 4] = _q[0];
    out[i * 4 + 1] = _q[1];
    out[i * 4 + 2] = _q[2];
    out[i * 4 + 3] = _q[3];
  }
  return out;
}

/**
 * The orientation of copy `i` of a stroke (`paintRotations`, one copy, nothing allocated): the copy under the pointer
 * is drawn with it before it is painted (Round 2), the same as the stroke's first copy of that seed
 */
export function paintRotation(
  out: Quat,
  normal: Vec3,
  orient: PaintOrient,
  seed: number,
  i: number,
  options: { readonly axis?: Vec3; readonly spin?: number } = {},
): Quat {
  if (orient === 'random') {
    // Shoemake's uniform random rotation
    const u1 = paintRandom(seed, i, 0);
    const u2 = paintRandom(seed, i, 1) * 2 * Math.PI;
    const u3 = paintRandom(seed, i, 2) * 2 * Math.PI;
    const s1 = Math.sqrt(1 - u1);
    const s2 = Math.sqrt(u1);
    return Quat.set(out, s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3));
  }
  const from = orient === 'axis' && options.axis ? Vec3.normalize(_a, options.axis) : _z;
  Vec3.copy(_n, normal);
  if (Vec3.squaredMagnitude(_n) === 0) Vec3.copy(_n, from);
  Vec3.normalize(_n, _n);
  const angle = ((options.spin ?? paintRandom(seed, i, 3) * 360) * Math.PI) / 180;
  // spun about its own axis first, then that axis turned onto the normal
  Quat.setAxisAngle(_spin, from, angle);
  Quat.rotationTo(out, from, _n);
  Quat.multiply(out, out, _spin);
  return Quat.normalize(out, out);
}

// --- Fibres (Round 2, Decided 4) --------------------------------------------------------------------------------------

/**
 * How a brush's fibres are built, read from one of the list's fibres of it: the target's own axis that follows the
 * fibre (its first segment's direction in the first point's frame), the turn about it from one point to the next (°;
 * a helix's twist), and the mean step between points (Å)
 */
export interface FiberConvention {
  readonly axis: Vec3;
  readonly twist: number;
  readonly step: number;
}

const _r = Quat();
const _q0 = Quat();
const _q1 = Quat();
const _ax = Vec3();
const _p0 = Vec3();
const _p1 = Vec3();

function quatOf(out: Quat, list: ParticleList, i: number) {
  const r = list.rotations;
  return r ? Quat.set(out, r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]) : Quat.set(out, 0, 0, 0, 1);
}

function pointOf(out: Vec3, list: ParticleList, i: number) {
  return Vec3.set(out, list.coordinates[i * 3], list.coordinates[i * 3 + 1], list.coordinates[i * 3 + 2]);
}

/** The first fibre of the brush `id` (an entity, or a target on a list without entities) with two points or more */
function fiberOfBrush(list: ParticleList, id: number): [number, number] | undefined {
  const f = list.fibers;
  if (!f) return undefined;
  const byEntity = !!list.entityInfo?.size;
  for (let k = 0; k < f.count; ++k) {
    const s = f.offsets[k];
    const e = f.offsets[k + 1];
    if (e - s < 2) continue;
    const i = f.indices[s];
    if (byEntity ? Particle.entityOf(list, i) === id : list.targets[i] === id) return [s, e];
  }
  return undefined;
}

/** Whether the brush `id` makes fibres: one of its particles is a point of a fibre of the list */
export function isFiberBrush(list: ParticleList, id: number): boolean {
  return !!fiberOfBrush(list, id);
}

/** The convention of the brush's fibres (`FiberConvention`); undefined when it has none */
export function fiberConventionOf(list: ParticleList, id: number): FiberConvention | undefined {
  const range = fiberOfBrush(list, id);
  if (!range) return undefined;
  const [s, e] = range;
  const { indices } = list.fibers!;
  let sum = 0;
  for (let j = s + 1; j < e; ++j) {
    sum += Vec3.distance(pointOf(_p0, list, indices[j - 1]), pointOf(_p1, list, indices[j]));
  }
  const i0 = indices[s];
  const i1 = indices[s + 1];
  // the first segment in the first point's frame: the target's axis along the fibre
  Vec3.sub(_ax, pointOf(_p1, list, i1), pointOf(_p0, list, i0));
  Quat.conjugate(_q0, quatOf(_q0, list, i0));
  const axis = Vec3.normalize(Vec3(), Vec3.transformQuat(Vec3(), _ax, _q0));
  // the turn from the first point to the second, in the first's frame, about that axis
  Quat.multiply(_r, _q0, quatOf(_q1, list, i1));
  // the shorter way (q and -q are one turn: `getAxisAngle` reads 2·acos(w), past π for w < 0; review S5)
  if (_r[3] < 0) Quat.set(_r, -_r[0], -_r[1], -_r[2], -_r[3]);
  const angle = Quat.getAxisAngle(_ax, _r);
  // its part about the axis (a fibre point turns about the fibre)
  const twist = (angle * Vec3.dot(_ax, axis) * 180) / Math.PI;
  return { axis, twist: Number.isFinite(twist) ? twist : 0, step: sum / (e - s - 1) };
}

/**
 * The orientations of a new fibre's points (x, y, z, w each): the convention's axis along the way (each point toward
 * the next, the last from the one before), turned by its twist a point, plus a random amount within ±`jitter` a step
 * (of the seed and the step: the same each time)
 */
export function fiberRotations(
  positions: ArrayLike<number>,
  c: Pick<FiberConvention, 'axis' | 'twist'> & { readonly jitter?: number },
  seed = 0,
): number[] {
  const k = Math.floor(positions.length / 3);
  const out: number[] = new Array(k * 4);
  const axis = Vec3.normalize(_a, c.axis);
  const jitter = c.jitter ?? 0;
  let turn = 0;
  for (let i = 0; i < k; ++i) {
    if (i > 0) turn += c.twist + (jitter ? jitter * (2 * paintRandom(seed, i, 4) - 1) : 0);
    const a = k < 2 ? i : i < k - 1 ? i : i - 1;
    const b = k < 2 ? i : a + 1;
    Vec3.set(
      _n,
      positions[b * 3] - positions[a * 3],
      positions[b * 3 + 1] - positions[a * 3 + 1],
      positions[b * 3 + 2] - positions[a * 3 + 2],
    );
    if (Vec3.squaredMagnitude(_n) === 0) Vec3.copy(_n, axis);
    Vec3.normalize(_n, _n);
    Quat.setAxisAngle(_spin, axis, (turn * Math.PI) / 180);
    Quat.rotationTo(_q, axis, _n);
    Quat.multiply(_q, _q, _spin);
    Quat.normalize(_q, _q);
    out[i * 4] = _q[0];
    out[i * 4 + 1] = _q[1];
    out[i * 4 + 2] = _q[2];
    out[i * 4 + 3] = _q[3];
  }
  return out;
}

// --- The operation's helpers (`mesoscale.paint`) ---------------------------------------------------------------------

/** What a brush paints: a target, the entity and compartment of the particle it was read from */
export interface PaintBrush {
  readonly target: number;
  readonly entity: number;
  readonly compartment: number;
  /** Whether that compartment is a membrane or its surface (`isMembranePath`): +z along the normal */
  readonly surface: boolean;
}

/**
 * The brush of an entity (a list with entities) or a target (one without: its targets are its entities), read from its
 * first particle; undefined when no particle has it
 */
export function brushOf(list: ParticleList, id: number): PaintBrush | undefined {
  const set = list.entityInfo?.size
    ? getParticleEntityGroups(list).get(id)
    : (() => {
        const g = getParticleTargetGroups(list);
        return g.sets[g.groupOfTarget.get(id) ?? -1];
      })();
  if (!set || OrderedSet.size(set) === 0) return undefined;
  const i = OrderedSet.start(set);
  const compartment = list.compartments?.[i] ?? -1;
  const name = list.compartmentInfo?.get(compartment)?.name ?? '';
  return {
    target: list.targets[i],
    entity: list.entityInfo?.size ? Particle.entityOf(list, i) : -1,
    compartment,
    surface: isMembranePath(name),
  };
}

const axes = new WeakMap<object, Vec3>();
/** A structure target's principal axis (its atoms' first moment axis, in its frame); +z for any other kind */
export function principalAxisOf(target: ParticleTarget | undefined): Vec3 {
  if (target?.kind !== 'structure') return Vec3.create(0, 0, 1);
  const s = target.structure;
  const kept = axes.get(s);
  if (kept) return kept;
  const xyz: number[] = [];
  const p = Vec3();
  for (const u of s.units) {
    const { elements, conformation } = u;
    for (let i = 0; i < elements.length; ++i) {
      conformation.position(elements[i], p);
      xyz.push(p[0], p[1], p[2]);
    }
  }
  const axis = xyz.length >= 6 ? Vec3.clone(PrincipalAxes.ofPositions(xyz).momentsAxes.dirA) : Vec3.create(0, 0, 1);
  Vec3.normalize(axis, axis);
  axes.set(s, axis);
  return axis;
}

/** The decorator of `transformer` in the chain of decorators under a cell (a particle list's), if any */
export function decoratorUnder(state: State, ref: string, transformer: StateTransformer): StateObjectCell | undefined {
  const { cells, tree } = state;
  for (let at = ref; ; ) {
    const next = tree.children
      .get(at)
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator);
    if (!next) return undefined;
    if (next.transform.transformer === transformer) return next;
    at = next.transform.ref;
  }
}

/**
 * Points and directions of the scene in a list's own frame (before its move and scale, `ParticleListTransform`, where
 * the painted decorator sits: right under the list), in place: a later move carries the strokes with the list
 */
export function toListFrame(
  transform: { readonly transform: Mat4; readonly scale?: number } | undefined,
  positions: number[],
  normals: number[] | undefined,
) {
  if (!transform) return;
  const scale = transform.scale ?? 1;
  const inverse = Mat4.invert(Mat4(), transform.transform);
  const turn = Mat3.fromMat4(Mat3(), inverse);
  const p = Vec3();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    Vec3.set(p, positions[i], positions[i + 1], positions[i + 2]);
    Vec3.transformMat4(p, p, inverse);
    Vec3.scale(p, p, 1 / scale);
    positions[i] = p[0];
    positions[i + 1] = p[1];
    positions[i + 2] = p[2];
  }
  if (!normals) return;
  for (let i = 0; i + 2 < normals.length; i += 3) {
    Vec3.set(p, normals[i], normals[i + 1], normals[i + 2]);
    Vec3.transformMat3(p, p, turn);
    normals[i] = p[0];
    normals[i + 1] = p[1];
    normals[i + 2] = p[2];
  }
}
