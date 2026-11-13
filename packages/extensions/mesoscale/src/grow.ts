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
export const GrowModes = ['walk', 'crystal', 'tiling', 'sphere'] as const;
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

/** What a grow did, kept with its stroke (`PaintStroke.grow`): its mode, its params, its seed and its source */
export interface GrowRecord {
  readonly mode: GrowMode;
  readonly params: Readonly<Record<string, number | string>>;
  readonly seed: number;
  /** The source's index in the list as drawn and its key */
  readonly source: { readonly index: number; readonly key: number };
  /** The mesh it grew on (its representation's state ref and file name), for the report: the copies stay without it */
  readonly mesh?: { readonly ref: string; readonly label: string };
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
): number[] | undefined;
export function walkPath(
  source: GrowPose,
  axis: Vec3,
  rise: number,
  p: WalkParams,
  seed: number,
  on?: GrowOn,
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
  }
  return out;
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

/**
 * Sphere on a surface: `count` points uniform by area on the surface's triangles within `radius` of the source (a
 * triangle drawn by its area, a point uniform in it; drawn again when outside the ball; seeded), each turned with the
 * copy's axis (`on.axis`) along the normal there: at random about it, or as the source (turned with its axis along the
 * normal at the source, then by the least turn to the copy's). Fewer when a copy finds no place in its draws.
 */
function sphereOnSurface(source: GrowPose, p: SphereParams, seed: number, on: GrowOn): GrowPoses | undefined {
  const local = Vec3.normalize(Vec3(), on.axis ?? Vec3.create(0, 0, 1));
  const a = Vec3.transformQuat(Vec3(), local, source.rotation);
  const start = sourceOn(on, source, a);
  if (!start) return undefined;
  const sign = start.flipped ? -1 : 1;
  const { positions: v, normals: vn } = on.surface.triangles(source.position, p.radius);
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
        Vec3.scaleAndAdd(normal, normal, Vec3.fromArray(A, vn, lo * 9 + k * 3), w[k] * sign);
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
