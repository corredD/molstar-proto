/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat3, type Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { fiberOffsetDirection, paintRandom, paintRotation } from './paint.js';

// Grow (apps/prism-me/progress/2026-11-11-grow.md; Ludo, 2026-11-11): copies of an instance by a rule, from its pose.
// Each mode gives the copies' poses (positions in Å, unit quaternions x, y, z, w) from the source's; the copies go
// exactly where the rule says, overlaps allowed. The source itself is never one of them.

/** The modes of round 1 (Symmetry is round 2) */
export const GrowModes = ['walk', 'helix', 'crystal', 'tiling', 'sphere'] as const;
export type GrowMode = (typeof GrowModes)[number];

/** A copy's place: its position and its orientation */
export interface GrowPose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** The copies' poses: x, y, z and x, y, z, w per copy */
export interface GrowPoses {
  readonly positions: number[];
  readonly rotations: number[];
}

/** A lattice in the source's frame: its cell (Å, °) and the cells along each axis (the source's counted) */
export interface CrystalParams {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly na: number;
  readonly nb: number;
  readonly nc: number;
}

/**
 * A planar tiling in the source's own plane: its pattern, the spacing between copies (Å) and its rings; on a surface,
 * its points (the source's counted; absent: the plane's for its rings)
 */
export interface TilingParams {
  readonly pattern: 'hex' | 'square';
  readonly spacing: number;
  readonly rings: number;
  readonly count?: number;
}

/** Copies uniform in a ball about the source (Å), turned at random or as the source */
export interface SphereParams {
  readonly count: number;
  readonly radius: number;
  readonly turn: 'random' | 'source';
}

/** A persistent random walk: its points, a rise apart, its direction turned at most `persistence` (°) a step */
export interface WalkParams {
  readonly steps: number;
  readonly persistence: number;
}

/**
 * A helix (grow-helix): Pitch (Å along its axis a turn), Turns, its Hand (right: turning counterclockwise seen from
 * where it goes) and Direction (up or down its axis from the source); in space, its Radius (Å)
 */
export interface HelixParams {
  readonly pitch: number;
  readonly turns: number;
  readonly hand: 'right' | 'left';
  readonly direction: 'up' | 'down';
  readonly radius: number;
}

/** The axis a helix winds about on a mesh (the scene's): a point of it and its unit direction, up */
export interface HelixLine {
  readonly center: Vec3;
  readonly direction: Vec3;
}

/** The axes a helix on a mesh may take: Auto (the mesh's longest), View (toward the viewer), X, Y, Z */
export const HelixAxes = ['auto', 'view', 'x', 'y', 'z'] as const;
export type HelixAxis = (typeof HelixAxes)[number];

/** What a grow did, kept with its stroke (`PaintStroke.grow`): its mode, its params, its seed and its source */
export interface GrowRecord {
  readonly mode: GrowMode;
  readonly params: Readonly<Record<string, number | string>>;
  readonly seed: number;
  /** The source's index in the list as drawn and its key */
  readonly source: { readonly index: number; readonly key: number };
  /** The mesh it grew on (its representation's state ref and file name), for the report: the copies stay without it */
  readonly mesh?: { readonly ref: string; readonly label: string };
  /** Which grow it was (paint-refine): a walk's own rise and twist are set by it (`mesoscale.grown-fiber`) */
  readonly id?: number;
}

/**
 * The cell's three vectors (Å): a along x, b in the xy plane, c to make the angles (the crystallographers'
 * convention); undefined for angles of no cell
 */
export function latticeVectors(p: Pick<CrystalParams, 'a' | 'b' | 'c' | 'alpha' | 'beta' | 'gamma'>) {
  const d = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(p.alpha * d), Math.cos(p.beta * d), Math.cos(p.gamma * d)];
  const sg = Math.sin(p.gamma * d);
  const cy = (ca - cb * cg) / sg;
  const cz2 = 1 - cb * cb - cy * cy;
  if (!(sg > 1e-6) || !(cz2 > 1e-9)) return undefined;
  return [
    Vec3.create(p.a, 0, 0),
    Vec3.create(p.b * cg, p.b * sg, 0),
    Vec3.create(p.c * cb, p.c * cy, p.c * Math.sqrt(cz2)),
  ] as const;
}

/** The integer offsets of n cells, the source's (0) among them: centered, one more after for an even n */
function cells(n: number): number[] {
  const from = -Math.floor((Math.max(1, Math.floor(n)) - 1) / 2);
  return Array.from({ length: Math.max(1, Math.floor(n)) }, (_, i) => from + i);
}

function push(out: GrowPoses, p: Vec3, q: Quat) {
  out.positions.push(p[0], p[1], p[2]);
  out.rotations.push(q[0], q[1], q[2], q[3]);
}

const _up = Vec3.create(0, 0, 1);
const _t = Vec3();
const _p = Vec3();

/**
 * A crystal: X + R·(i·a + j·b + k·c) for na × nb × nc cells about the source (its cell skipped: na·nb·nc − 1 copies),
 * each turned as the source; undefined for angles of no cell
 */
export function crystalPoses(source: GrowPose, p: CrystalParams): GrowPoses | undefined {
  const v = latticeVectors(p);
  if (!v) return undefined;
  const out: GrowPoses = { positions: [], rotations: [] };
  for (const k of cells(p.nc)) {
    for (const j of cells(p.nb)) {
      for (const i of cells(p.na)) {
        if (!i && !j && !k) continue;
        Vec3.set(_t, 0, 0, 0);
        Vec3.scaleAndAdd(_t, _t, v[0], i);
        Vec3.scaleAndAdd(_t, _t, v[1], j);
        Vec3.scaleAndAdd(_t, _t, v[2], k);
        Vec3.add(_p, source.position, Vec3.transformQuat(_t, _t, source.rotation));
        push(out, _p, source.rotation);
      }
    }
  }
  return out;
}

/**
 * A tiling of the source's own plane (`normal`, in its frame: its axis), ring by ring: Hex, 1 + 3r(r+1) points with
 * r rings, Square, (2r+1)², the source's among them (not a copy); each a spacing from its neighbours, turned as the
 * source. On a surface (`on`), grown over it (`tilingOnSurface`); undefined for a source off it.
 */
export function tilingPoses(source: GrowPose, normal: Vec3, p: TilingParams): GrowPoses;
export function tilingPoses(
  source: GrowPose,
  normal: Vec3,
  p: TilingParams,
  on: GrowOn | undefined,
): GrowPoses | undefined;
export function tilingPoses(source: GrowPose, normal: Vec3, p: TilingParams, on?: GrowOn): GrowPoses | undefined {
  if (on) return tilingOnSurface(source, normal, p, on);
  const n = Vec3.normalize(Vec3(), normal);
  const u = fiberOffsetDirection(Vec3(), 'auto', n);
  const w = Vec3.cross(Vec3(), n, u);
  const hex = p.pattern === 'hex';
  // hex: the axial basis (u, u/2 + w·√3/2); square: (u, w)
  const e1 = u;
  const e2 = hex ? Vec3.scaleAndAdd(Vec3(), Vec3.scale(Vec3(), u, 0.5), w, Math.sqrt(3) / 2) : w;
  const out: GrowPoses = { positions: [], rotations: [] };
  const rings = Math.max(0, Math.floor(p.rings));
  for (let ring = 1; ring <= rings; ++ring) {
    for (let q = -ring; q <= ring; ++q) {
      for (let r = -ring; r <= ring; ++r) {
        const at = hex ? Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) : Math.max(Math.abs(q), Math.abs(r));
        if (at !== ring) continue;
        Vec3.scale(_t, e1, q * p.spacing);
        Vec3.scaleAndAdd(_t, _t, e2, r * p.spacing);
        Vec3.add(_p, source.position, Vec3.transformQuat(_t, _t, source.rotation));
        push(out, _p, source.rotation);
      }
    }
  }
  return out;
}

const _q = Quat();
const _zero = Vec3();

/**
 * `count` copies uniform in a ball of `radius` about the source (seeded), turned at random (seeded) or as the source.
 * On a surface (`on`), uniform on its part within the ball (`sphereOnSurface`); undefined for a source off it.
 */
export function spherePoses(source: GrowPose, p: SphereParams, seed: number): GrowPoses;
export function spherePoses(
  source: GrowPose,
  p: SphereParams,
  seed: number,
  on: GrowOn | undefined,
): GrowPoses | undefined;
export function spherePoses(source: GrowPose, p: SphereParams, seed: number, on?: GrowOn): GrowPoses | undefined {
  if (on) return sphereOnSurface(source, p, seed, on);
  const out: GrowPoses = { positions: [], rotations: [] };
  for (let i = 0; i < Math.max(0, Math.floor(p.count)); ++i) {
    const r = p.radius * Math.cbrt(paintRandom(seed, i, 10));
    const z = 2 * paintRandom(seed, i, 11) - 1;
    const phi = 2 * Math.PI * paintRandom(seed, i, 12);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    Vec3.set(_t, s * Math.cos(phi), s * Math.sin(phi), z);
    Vec3.scaleAndAdd(_p, source.position, _t, r);
    push(out, _p, p.turn === 'random' ? paintRotation(_q, _zero, 'random', seed, i) : source.rotation);
  }
  return out;
}

const _e1 = Vec3();
const _e2 = Vec3();

/** `d` (unit) turned at random within the cone of cosine `cosMax` about itself (uniform in it; draw `i` of `seed`) */
function turnInCone(d: Vec3, cosMax: number, seed: number, i: number) {
  const cos = 1 - paintRandom(seed, i, 13) * (1 - cosMax);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const phi = 2 * Math.PI * paintRandom(seed, i, 14);
  fiberOffsetDirection(_e1, 'auto', d);
  Vec3.cross(_e2, d, _e1);
  Vec3.scale(d, d, cos);
  Vec3.scaleAndAdd(d, d, _e1, sin * Math.cos(phi));
  Vec3.scaleAndAdd(d, d, _e2, sin * Math.sin(phi));
  Vec3.normalize(d, d);
}

/**
 * A persistent random walk from the source (a fiber's path): `steps` points a `rise` apart, the first a rise from the
 * source along its fiber axis (`axis`, in its frame), each step's direction turned from the one before by at most
 * `persistence` (uniform in that cone; seeded). On a surface (`on`), each step's direction kept in the tangent plane
 * and its point projected onto the surface (it ends where the surface does); undefined for a source off it.
 */
export function walkPath(source: GrowPose, axis: Vec3, rise: number, p: WalkParams, seed: number): number[];
export function walkPath(
  source: GrowPose,
  axis: Vec3,
  rise: number,
  p: WalkParams,
  seed: number,
  on: GrowOn | undefined,
  normals?: number[],
): number[] | undefined;
/** `normals`, on a surface: filled with its normal at each point (paint-refine round 2: the units' up follows it) */
export function walkPath(
  source: GrowPose,
  axis: Vec3,
  rise: number,
  p: WalkParams,
  seed: number,
  on?: GrowOn,
  normals?: number[],
): number[] | undefined {
  const out: number[] = [];
  const d = Vec3.normalize(Vec3(), Vec3.transformQuat(Vec3(), axis, source.rotation));
  const cosMax = Math.cos((Math.min(180, Math.max(0, p.persistence)) * Math.PI) / 180);
  const at = Vec3.copy(Vec3(), source.position);
  const n = Vec3();
  if (on) {
    if (!on.surface.project(_hit, source.position, _zero, on.reach)) return undefined;
    Vec3.copy(at, _hit.position);
    Vec3.copy(n, _hit.normal);
    // on the source's side (its axis along a surface: `on.axis`, else +z), not the file's winding: the units' up follows
    // it (round 2 review S7, round 3)
    if (Vec3.dot(n, Vec3.transformQuat(_t, on.axis ?? _up, source.rotation)) < -1e-3) Vec3.negate(n, n);
    if (!tangent(d, n)) fiberOffsetDirection(d, 'auto', n);
  }
  for (let i = 0; i < Math.max(0, Math.floor(p.steps)); ++i) {
    if (i > 0) {
      turnInCone(d, cosMax, seed, i);
      // on a surface, in its tangent plane (a projection turns it no more than the cone did)
      if (on) {
        Vec3.copy(_t, d);
        if (tangent(_t, n)) Vec3.copy(d, _t);
      }
    }
    Vec3.scaleAndAdd(at, at, d, rise);
    if (on) {
      // past an open edge the nearest point is the edge: a step it moves by more than a quarter rise ends the walk
      if (!on.surface.project(_hit, at, n, rise) || Vec3.distance(_hit.position, at) > 0.25 * rise) break;
      if (Vec3.dot(_hit.normal, n) < 0) Vec3.negate(_hit.normal, _hit.normal);
      Vec3.copy(at, _hit.position);
      Vec3.copy(n, _hit.normal);
      if (!tangent(d, n)) fiberOffsetDirection(d, 'auto', n);
    }
    out.push(at[0], at[1], at[2]);
    if (on) normals?.push(n[0], n[1], n[2]);
  }
  return out;
}

/** A helix's angle a point of its path: 5° (its chords within 0.1 % of its radius; `makeFiber` places its units) */
const HelixStep = Math.PI / 36;

const _foot = Vec3();
const _side = Vec3();
const _u = Vec3();

/**
 * A helix from the source (a fiber's path, grow-helix): about a line along `d` (unit; up, the way it advances) through
 * `foot` (the source's foot on it), the source at angle 0 (`e1`, unit, from the foot to the source), the angle turning
 * counterclockwise about `d` for Hand right, Pitch along `d` a turn; a point every 5°, Turns turns.
 * - In space (no `on`): about the source's Fiber Axis (`axis`, in its frame) a Radius away (along the axis's offset
 *   direction, `fiberOffsetDirection`), the points on that cylinder.
 * - On a surface (`on`): about `on.line` (the mesh's axis), from the source's point on the surface; each point brought
 *   onto it along its radial line (`GrowSurface.project`, from the point a radius as the one before away, within half
 *   that radius), its normal in `normals` (the source's side, then continuous). It ends where the surface does: no
 *   point on that line (an open edge, a pole: the nearest is off it by more than a quarter of a step), or one at the
 *   axis or past it.
 * The path starts a rise from the source along the helix (the source is on it, not one of its units). Undefined for a
 * source off the surface; empty for a source on the axis.
 */
export function helixPath(source: GrowPose, axis: Vec3, rise: number, p: HelixParams): number[];
export function helixPath(
  source: GrowPose,
  axis: Vec3,
  rise: number,
  p: HelixParams,
  on: (GrowOn & { readonly line: HelixLine }) | undefined,
  normals?: number[],
): number[] | undefined;
export function helixPath(
  source: GrowPose,
  axis: Vec3,
  rise: number,
  p: HelixParams,
  on?: GrowOn & { readonly line: HelixLine },
  normals?: number[],
): number[] | undefined {
  const start = Vec3.copy(Vec3(), source.position);
  const n = Vec3();
  const d = Vec3();
  if (on) {
    if (!on.surface.project(_hit, source.position, _zero, on.reach)) return undefined;
    Vec3.copy(start, _hit.position);
    Vec3.copy(n, _hit.normal);
    // on the source's side, as the walk's (its axis along a surface: `on.axis`, else +z)
    if (Vec3.dot(n, Vec3.transformQuat(_t, on.axis ?? _up, source.rotation)) < -1e-3) Vec3.negate(n, n);
    Vec3.normalize(d, on.line.direction);
    Vec3.sub(_t, start, on.line.center);
    Vec3.scaleAndAdd(_foot, on.line.center, d, Vec3.dot(_t, d));
  } else {
    Vec3.normalize(d, Vec3.transformQuat(d, axis, source.rotation));
    const local = Vec3.normalize(Vec3(), axis);
    Vec3.transformQuat(_t, fiberOffsetDirection(_t, 'auto', local), source.rotation);
    Vec3.scaleAndAdd(_foot, start, _t, p.radius);
  }
  if (p.direction === 'down') Vec3.negate(d, d);
  const e1 = Vec3.sub(Vec3(), start, _foot);
  let radius = Vec3.magnitude(e1);
  if (!(radius > 1e-6 * Math.max(1, p.pitch))) return [];
  Vec3.scale(e1, e1, 1 / radius);
  Vec3.cross(_side, d, e1);
  // the hand its own: right turns counterclockwise about the way it advances, whichever way that is
  const sense = p.hand === 'left' ? -1 : 1;
  const end = Math.max(0, p.turns) * 2 * Math.PI;
  // in space, from a rise along the helix (its arc a radian is the same throughout); on a surface, from the source,
  // then a rise cut off its path
  const from = on ? 0 : rise / Math.hypot(radius, p.pitch / (2 * Math.PI));
  if (from >= end) return [];
  const all: number[] = [];
  const ns: number[] | undefined = on ? [] : undefined;
  for (let i = 0; ; ++i) {
    const theta = Math.min(from + i * HelixStep, end);
    Vec3.scale(_u, e1, Math.cos(theta));
    Vec3.scaleAndAdd(_u, _u, _side, sense * Math.sin(theta));
    // the axis's point at this height
    Vec3.scaleAndAdd(_c, _foot, d, (p.pitch * theta) / (2 * Math.PI));
    Vec3.scaleAndAdd(_p, _c, _u, radius);
    if (on && i > 0) {
      const chord = radius * HelixStep;
      if (!on.surface.project(_hit, _p, _u, 0.5 * radius)) break;
      // off the radial line: the surface's nearest point (an edge, past a pole), not on the line
      Vec3.sub(_w, _hit.position, _p);
      const along = Vec3.dot(_w, _u);
      if (Vec3.magnitude(Vec3.scaleAndAdd(_w, _w, _u, -along)) > 0.25 * chord) break;
      const r = radius + along;
      // at the axis or past it
      if (!(r > 1e-3 * radius)) break;
      radius = r;
      Vec3.copy(_p, _hit.position);
      if (Vec3.dot(_hit.normal, n) < 0) Vec3.negate(_hit.normal, _hit.normal);
      Vec3.copy(n, _hit.normal);
    }
    all.push(_p[0], _p[1], _p[2]);
    ns?.push(n[0], n[1], n[2]);
    if (theta >= end) break;
  }
  return on ? trimStart(all, ns, rise, normals) : all;
}

/**
 * The path from a `length` along it (arc length; the point there interpolated), its values (3 a point) likewise into
 * `valuesOut`; empty when it is shorter
 */
function trimStart(path: number[], values: number[] | undefined, length: number, valuesOut?: number[]): number[] {
  let walked = 0;
  for (let i = 1; i < path.length / 3; ++i) {
    const len = Math.hypot(
      path[i * 3] - path[i * 3 - 3],
      path[i * 3 + 1] - path[i * 3 - 2],
      path[i * 3 + 2] - path[i * 3 - 1],
    );
    if (walked + len < length) {
      walked += len;
      continue;
    }
    const t = len > 0 ? (length - walked) / len : 0;
    const lerp = (xs: number[]) => [0, 1, 2].map((c) => xs[i * 3 - 3 + c] * (1 - t) + xs[i * 3 + c] * t);
    // the first point the one there, the next ones the path's after it (not stacked on it)
    const next = t >= 1 - 1e-9 ? i + 1 : i;
    const out = [...lerp(path), ...path.slice(next * 3)];
    if (values && valuesOut) valuesOut.push(...lerp(values), ...values.slice(next * 3));
    return out;
  }
  return [];
}

// --- On a surface (progress/2026-11-13-grow-mesh.md) -------------------------------------------------------------------

/** A point of a surface and its unit normal there */
export interface SurfaceHit {
  readonly position: Vec3;
  readonly normal: Vec3;
}

export function SurfaceHit(): SurfaceHit {
  return { position: Vec3(), normal: Vec3() };
}

/**
 * A surface the copies grow on, in the frame of the poses (the scene's, Å): a mesh's (`meshSurface`); a mask's level
 * later. Its normals are its own side's (a file's winding): the growth keeps them on the source's side.
 */
export interface GrowSurface {
  /**
   * `p` on the surface: where the line through it along `along` (unit) meets the surface nearest to `p` within `reach`,
   * else (or with `along` zero) the surface's point nearest to `p` within `reach`; false when none is within `reach`
   */
  project(out: SurfaceHit, p: Vec3, along: Vec3, reach: number): boolean;
  /** The triangles within `radius` of `center`: their vertices and vertex normals, 9 numbers a triangle each */
  triangles(
    center: Vec3,
    radius: number,
  ): { readonly positions: ArrayLike<number>; readonly normals: ArrayLike<number> };
}

/** A surface to grow on; `reach`, how far from it the source may be (Å); `axis`, the copies' axis in their frame */
export interface GrowOn {
  readonly surface: GrowSurface;
  readonly reach: number;
  readonly axis?: Vec3;
}

/** The points of the plane's tiling with `rings` rings, the source's counted */
export function tilingTotal(pattern: TilingParams['pattern'], rings: number): number {
  const r = Math.max(0, Math.floor(rings));
  return pattern === 'hex' ? 1 + 3 * r * (r + 1) : (2 * r + 1) ** 2;
}

/** `v` in the plane of normal `n` (unit), unit; false when it is along `n` */
function tangent(v: Vec3, n: Vec3): boolean {
  Vec3.scaleAndAdd(v, v, n, -Vec3.dot(v, n));
  if (Vec3.squaredMagnitude(v) < 1e-12) return false;
  Vec3.normalize(v, v);
  return true;
}

/**
 * The source on the surface: its nearest point there, the normal on the side of its axis `a` (the scene's, unit) and
 * its turn with that axis along the normal (its spin kept); undefined when the surface is beyond `on.reach`
 */
function sourceOn(on: GrowOn, source: GrowPose, a: Vec3) {
  const hit = SurfaceHit();
  if (!on.surface.project(hit, source.position, _zero, on.reach)) return undefined;
  const flipped = Vec3.dot(hit.normal, a) < 0;
  if (flipped) Vec3.negate(hit.normal, hit.normal);
  const rotation = Quat.multiply(Quat(), Quat.rotationTo(Quat(), a, hit.normal), source.rotation);
  return { hit, rotation, flipped };
}

/** A hash of a grid cell (collisions only merge cells: distances are checked) */
const cellKey = (i: number, j: number, k: number) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);

/**
 * Points kept apart (TomoNet's rule: a point closer than `min` to one kept is dropped), on a grid of cells of `min`:
 * a point's neighbours within `min` are in its cell's 27
 */
function apartGrid(min: number) {
  const cells = new Map<number, number[]>();
  const points: number[] = [];
  const at = (x: number) => Math.floor(x / min);
  return {
    crowded(p: Vec3) {
      const [i, j, k] = [at(p[0]), at(p[1]), at(p[2])];
      for (let di = -1; di <= 1; ++di) {
        for (let dj = -1; dj <= 1; ++dj) {
          for (let dk = -1; dk <= 1; ++dk) {
            for (const o of cells.get(cellKey(i + di, j + dj, k + dk)) ?? []) {
              const dx = points[o] - p[0];
              const dy = points[o + 1] - p[1];
              const dz = points[o + 2] - p[2];
              if (dx * dx + dy * dy + dz * dz < min * min) return true;
            }
          }
        }
      }
      return false;
    },
    add(p: Vec3) {
      const key = cellKey(at(p[0]), at(p[1]), at(p[2]));
      const list = cells.get(key);
      if (list) list.push(points.length);
      else cells.set(key, [points.length]);
      points.push(p[0], p[1], p[2]);
    },
  };
}

const _hit = SurfaceHit();
const _c = Vec3();
const _w = Vec3();

/**
 * A tiling grown over a surface (D2b), ring by ring (breadth first) from the source's point: each kept point's
 * neighbours a spacing away in its tangent plane (Hex: six at 60°; Square: four, and four diagonals at √2 spacings, so
 * its rings are the plane's), projected onto the surface along its normal. A neighbour is dropped when the projection
 * moved it more than half a spacing (another sheet) or when it is closer than 0.8 × Spacing to a point kept (TomoNet's
 * rule: a closed surface fills without piling up). The lattice's first direction is carried from point to point in
 * the tangent planes (the plane's at the source, so a flat mesh gives the plane's tiling). Each copy is the source
 * turned with its axis along the normal at the source, then by the least turn from that normal to its own; it stops at
 * Count points, the source's counted.
 */
function tilingOnSurface(source: GrowPose, axis: Vec3, p: TilingParams, on: GrowOn): GrowPoses | undefined {
  const local = Vec3.normalize(Vec3(), axis);
  const a = Vec3.transformQuat(Vec3(), local, source.rotation);
  const start = sourceOn(on, source, a);
  if (!start) return undefined;
  const n0 = start.hit.normal;
  const u0 = Vec3.transformQuat(Vec3(), fiberOffsetDirection(Vec3(), 'auto', local), source.rotation);
  if (!tangent(u0, n0)) fiberOffsetDirection(u0, 'auto', n0);
  const hex = p.pattern === 'hex';
  const dirs: (readonly [number, number, number])[] = [];
  for (let k = 0; k < (hex ? 6 : 4); ++k) {
    const t = (k * Math.PI) / (hex ? 3 : 2);
    dirs.push([Math.cos(t), Math.sin(t), 1]);
  }
  if (!hex) {
    for (let k = 0; k < 4; ++k) {
      const t = Math.PI / 4 + (k * Math.PI) / 2;
      dirs.push([Math.cos(t), Math.sin(t), Math.SQRT2]);
    }
  }
  const s = p.spacing;
  const limit = Math.floor(p.count ?? tilingTotal(p.pattern, p.rings)) - 1;
  const apart = apartGrid(0.8 * s);
  // the points kept (the source's first): position, normal, the lattice's first direction
  const kept: number[] = [];
  const keep = (x: Vec3, n: Vec3, u: Vec3) => {
    kept.push(x[0], x[1], x[2], n[0], n[1], n[2], u[0], u[1], u[2]);
    apart.add(x);
  };
  keep(start.hit.position, n0, u0);
  const out: GrowPoses = { positions: [], rotations: [] };
  const P = Vec3();
  const N = Vec3();
  const U = Vec3();
  for (let head = 0; head * 9 < kept.length && out.positions.length / 3 < limit; ++head) {
    Vec3.fromArray(P, kept, head * 9);
    Vec3.fromArray(N, kept, head * 9 + 3);
    Vec3.fromArray(U, kept, head * 9 + 6);
    Vec3.cross(_w, N, U);
    for (const [cos, sin, len] of dirs) {
      Vec3.scaleAndAdd(_c, P, U, s * len * cos);
      Vec3.scaleAndAdd(_c, _c, _w, s * len * sin);
      if (!on.surface.project(_hit, _c, N, s)) continue;
      if (Vec3.distance(_hit.position, _c) > 0.5 * s) continue;
      if (apart.crowded(_hit.position)) continue;
      if (Vec3.dot(_hit.normal, N) < 0) Vec3.negate(_hit.normal, _hit.normal);
      Vec3.copy(_t, U);
      if (!tangent(_t, _hit.normal)) fiberOffsetDirection(_t, 'auto', _hit.normal);
      keep(_hit.position, _hit.normal, _t);
      Quat.multiply(_q, Quat.rotationTo(_q, n0, _hit.normal), start.rotation);
      push(out, _hit.position, _q);
      if (out.positions.length / 3 >= limit) break;
    }
  }
  return out;
}

/** The draws a copy of Sphere on a surface takes at most to land within the ball */
const SphereDraws = 64;
/** Sphere's pieces of triangles: split until their longest edge is under this share of its Radius (review S1) */
const SpherePiece = 0.25;

/** The ball (`center`, `radius`) misses triangle `a`, `b`, `c`: its centroid further than the ball and its reach */
function missesBall(a: Vec3, b: Vec3, c: Vec3, center: Vec3, radius: number) {
  Vec3.scale(_c, Vec3.add(_c, Vec3.add(_c, a, b), c), 1 / 3);
  const reach = Math.sqrt(
    Math.max(Vec3.squaredDistance(a, _c), Vec3.squaredDistance(b, _c), Vec3.squaredDistance(c, _c)),
  );
  return Vec3.distance(_c, center) - reach > radius;
}

/**
 * The triangles' normals turned to one side (review S2: a file's winding may change from one triangle to the next):
 * a triangle's sign makes its normal (its vertices' mean) agree with its neighbour's (a triangle sharing a vertex),
 * from the triangle nearest `at`, which agrees with `normal`; a piece apart from it agrees with `normal`
 */
function orientTriangles(v: ArrayLike<number>, vn: ArrayLike<number>, at: Vec3, normal: Vec3): Int8Array {
  const T = v.length / 9;
  const mean = new Float64Array(T * 3);
  const byVertex = new Map<string, number[]>();
  let first = -1;
  let nearest = Infinity;
  for (let t = 0; t < T; ++t) {
    for (let c = 0; c < 3; ++c) mean[t * 3 + c] = vn[t * 9 + c] + vn[t * 9 + 3 + c] + vn[t * 9 + 6 + c];
    let d = 0;
    for (let k = 0; k < 3; ++k) {
      const o = t * 9 + k * 3;
      const key = `${v[o].toFixed(3)} ${v[o + 1].toFixed(3)} ${v[o + 2].toFixed(3)}`;
      const list = byVertex.get(key);
      if (list) list.push(t);
      else byVertex.set(key, [t]);
      // the sum of its vertices' squared distances to `at`
      for (let c = 0; c < 3; ++c) d += (v[o + c] - at[c]) ** 2;
    }
    if (d < nearest) {
      nearest = d;
      first = t;
    }
  }
  const keysOf = (t: number) =>
    [0, 1, 2].map((k) => {
      const o = t * 9 + k * 3;
      return `${v[o].toFixed(3)} ${v[o + 1].toFixed(3)} ${v[o + 2].toFixed(3)}`;
    });
  const dot = (t: number, x: ArrayLike<number>, xo: number) =>
    mean[t * 3] * x[xo] + mean[t * 3 + 1] * x[xo + 1] + mean[t * 3 + 2] * x[xo + 2];
  const sign = new Int8Array(T);
  const queue: number[] = [];
  const visit = (root: number) => {
    sign[root] = dot(root, normal, 0) < 0 ? -1 : 1;
    queue.push(root);
    while (queue.length) {
      const t = queue.pop()!;
      for (const key of keysOf(t)) {
        for (const u of byVertex.get(key)!) {
          if (sign[u]) continue;
          sign[u] = dot(u, mean, t * 3) * sign[t] < 0 ? -1 : 1;
          queue.push(u);
        }
      }
    }
  };
  if (first >= 0) visit(first);
  for (let t = 0; t < T; ++t) if (!sign[t]) visit(t);
  return sign;
}

/**
 * Sphere on a surface: `count` points uniform by area on the surface within `radius` of the source (its triangles
 * near the ball split into pieces of a quarter Radius and less, those that miss the ball dropped; a piece drawn by
 * its area, a point uniform in it, drawn again when outside the ball; seeded), each turned with the copy's axis
 * (`on.axis`) along the normal there, the triangles' normals turned to the source's side (`orientTriangles`): at
 * random about it, or as the source (turned with its axis along the normal at the source, then by the least turn to
 * the copy's). Fewer when a copy finds no place in its draws.
 */
function sphereOnSurface(source: GrowPose, p: SphereParams, seed: number, on: GrowOn): GrowPoses | undefined {
  const local = Vec3.normalize(Vec3(), on.axis ?? Vec3.create(0, 0, 1));
  const a = Vec3.transformQuat(Vec3(), local, source.rotation);
  const start = sourceOn(on, source, a);
  if (!start) return undefined;
  const { positions: tv, normals: tn } = on.surface.triangles(source.position, p.radius);
  const sign = orientTriangles(tv, tn, start.hit.position, start.hit.normal);
  // the pieces: positions and normals (turned), 9 numbers a piece each
  const v: number[] = [];
  const vn: number[] = [];
  const limit = SpherePiece * p.radius;
  const split = (P: Vec3[], N: Vec3[], depth: number) => {
    if (missesBall(P[0], P[1], P[2], source.position, p.radius)) return;
    const longest = Math.max(Vec3.distance(P[0], P[1]), Vec3.distance(P[1], P[2]), Vec3.distance(P[2], P[0]));
    if (longest <= limit || depth >= 16) {
      for (let k = 0; k < 3; ++k) {
        v.push(P[k][0], P[k][1], P[k][2]);
        vn.push(N[k][0], N[k][1], N[k][2]);
      }
      return;
    }
    const mid = (x: Vec3[], i: number, j: number) => Vec3.scale(Vec3(), Vec3.add(Vec3(), x[i], x[j]), 0.5);
    const [p01, p12, p20] = [mid(P, 0, 1), mid(P, 1, 2), mid(P, 2, 0)];
    const [n01, n12, n20] = [mid(N, 0, 1), mid(N, 1, 2), mid(N, 2, 0)];
    split([P[0], p01, p20], [N[0], n01, n20], depth + 1);
    split([p01, P[1], p12], [n01, N[1], n12], depth + 1);
    split([p20, p12, P[2]], [n20, n12, N[2]], depth + 1);
    split([p01, p12, p20], [n01, n12, n20], depth + 1);
  };
  for (let t = 0; t < tv.length / 9; ++t) {
    const P = [0, 1, 2].map((k) => Vec3.fromArray(Vec3(), tv, t * 9 + k * 3));
    const N = [0, 1, 2].map((k) => Vec3.scale(Vec3(), Vec3.fromArray(Vec3(), tn, t * 9 + k * 3), sign[t]));
    split(P, N, 0);
  }
  const T = v.length / 9;
  const cumulative = new Float64Array(T);
  let total = 0;
  const A = Vec3();
  const B = Vec3();
  const C = Vec3();
  for (let t = 0; t < T; ++t) {
    Vec3.fromArray(A, v, t * 9);
    Vec3.sub(B, Vec3.fromArray(B, v, t * 9 + 3), A);
    Vec3.sub(C, Vec3.fromArray(C, v, t * 9 + 6), A);
    total += Vec3.magnitude(Vec3.cross(_c, B, C)) / 2;
    cumulative[t] = total;
  }
  const out: GrowPoses = { positions: [], rotations: [] };
  if (!(total > 0)) return out;
  const point = Vec3();
  const normal = Vec3();
  for (let i = 0; i < Math.max(0, Math.floor(p.count)); ++i) {
    for (let draw = 0; draw < SphereDraws; ++draw) {
      const salt = 20 + 3 * draw;
      const x = paintRandom(seed, i, salt) * total;
      let lo = 0;
      let hi = T - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      const r1 = Math.sqrt(paintRandom(seed, i, salt + 1));
      const r2 = paintRandom(seed, i, salt + 2);
      const w = [1 - r1, r1 * (1 - r2), r1 * r2];
      Vec3.set(point, 0, 0, 0);
      Vec3.set(normal, 0, 0, 0);
      for (let k = 0; k < 3; ++k) {
        Vec3.scaleAndAdd(point, point, Vec3.fromArray(A, v, lo * 9 + k * 3), w[k]);
        Vec3.scaleAndAdd(normal, normal, Vec3.fromArray(A, vn, lo * 9 + k * 3), w[k]);
      }
      if (Vec3.distance(point, source.position) > p.radius) continue;
      Vec3.normalize(normal, normal);
      if (p.turn === 'random') paintRotation(_q, normal, 'axis', seed, i, { axis: local });
      else Quat.multiply(_q, Quat.rotationTo(_q, start.hit.normal, normal), start.rotation);
      push(out, point, _q);
      break;
    }
  }
  return out;
}

// --- Frames ------------------------------------------------------------------------------------------------------------

/** A list's move and scale (`ParticleListTransform`'s params) */
export interface ListMove {
  readonly transform: Mat4;
  readonly scale?: number;
}

/** The turn of a move as a unit quaternion (as `ParticleListTransform` turns orientations) */
export function moveTurn(move: ListMove | undefined): Quat {
  if (!move) return Quat.identity();
  return Quat.normalize(Quat(), Quat.fromMat3(Quat(), Mat3.fromMat4(Mat3(), move.transform)));
}

/** A pose of a list's frame in the scene's (Å): scaled, then moved and turned (as `ParticleListTransform`) */
export function poseToScene(move: ListMove | undefined, pose: GrowPose): GrowPose {
  if (!move) return pose;
  const position = Vec3.scale(Vec3(), pose.position, move.scale ?? 1);
  Vec3.transformMat4(position, position, move.transform);
  return { position, rotation: Quat.multiply(Quat(), moveTurn(move), pose.rotation) };
}

/**
 * A pose moved in its own frame by an offset (a particle's Move this instance: along its axes, then turned about them);
 * the translation divided by `scale` (an offset of the scene's Å on a pose of a scaled list's frame)
 */
export function offsetPose(
  pose: GrowPose,
  offset: { readonly translation: Vec3; readonly turn: Quat } | undefined,
  scale = 1,
): GrowPose {
  if (!offset) return pose;
  const shift = Vec3.transformQuat(Vec3(), offset.translation, pose.rotation);
  return {
    position: Vec3.scaleAndAdd(Vec3(), pose.position, shift, 1 / scale),
    rotation: Quat.multiply(Quat(), pose.rotation, offset.turn),
  };
}

/** Orientations of the scene in a list's frame, in place (its positions: `toListFrame`) */
export function rotationsToListFrame(move: ListMove | undefined, rotations: number[]) {
  if (!move) return;
  const back = Quat.conjugate(Quat(), moveTurn(move));
  for (let i = 0; i + 3 < rotations.length; i += 4) {
    Quat.set(_q, rotations[i], rotations[i + 1], rotations[i + 2], rotations[i + 3]);
    Quat.multiply(_q, back, _q);
    rotations[i] = _q[0];
    rotations[i + 1] = _q[1];
    rotations[i + 2] = _q[2];
    rotations[i + 3] = _q[3];
  }
}
