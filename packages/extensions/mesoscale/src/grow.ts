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

/** A planar tiling in the source's own plane: its pattern, the spacing between copies (Å) and its rings */
export interface TilingParams {
  readonly pattern: 'hex' | 'square';
  readonly spacing: number;
  readonly rings: number;
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
 * source
 */
export function tilingPoses(source: GrowPose, normal: Vec3, p: TilingParams): GrowPoses {
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

/** `count` copies uniform in a ball of `radius` about the source (seeded), turned at random (seeded) or as the source */
export function spherePoses(source: GrowPose, p: SphereParams, seed: number): GrowPoses {
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

/**
 * A persistent random walk from the source (a fiber's path): `steps` points a `rise` apart, the first a rise from the
 * source along its fiber axis (`axis`, in its frame), each step's direction turned from the one before by at most
 * `persistence` (uniform in that cone; seeded)
 */
export function walkPath(source: GrowPose, axis: Vec3, rise: number, p: WalkParams, seed: number): number[] {
  const out: number[] = [];
  const d = Vec3.normalize(Vec3(), Vec3.transformQuat(Vec3(), axis, source.rotation));
  const cosMax = Math.cos((Math.min(180, Math.max(0, p.persistence)) * Math.PI) / 180);
  const at = Vec3.copy(Vec3(), source.position);
  for (let i = 0; i < Math.max(0, Math.floor(p.steps)); ++i) {
    if (i > 0) {
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
    Vec3.scaleAndAdd(at, at, d, rise);
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
