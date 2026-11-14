/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { type State, type StateObjectCell } from '@molstar/core/state';
import { ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiFailure } from '@molstar/prism-viewer/api/area';
import { pickNamed } from '@molstar/prism-viewer/api/scope';
import { type ListMove, poseToScene, rotationsToListFrame } from './grow.js';
import { toListFrame } from './paint.js';

// A copy fitted to a density (progress/2026-11-13-density-fit.md; plans/2026-11-10-paint-on-density.md, D1): a mini
// envelope match. The copy's envelope (about 200 points of its own object) and a shell about it (about 100 points
// pushed out); the score is the mean density inside minus the mean in the shell, in σ of the map, signed by the
// contrast (Dark: the protein darker than its surroundings, as in a tomogram). A shift and a turn within a reach
// (a third of the copy's radius and 15° on paint), pulled back toward where it was put (the "slight bias": a flat map
// leaves it there), searched by Nelder-Mead over 6 parameters, then once more on a finer simplex.

/** Whether the object is darker (a tomogram's protein) or brighter than its surroundings */
export type FitContrast = 'dark' | 'bright';

/** A copy's envelope in its object's own frame, about its center (`ParticleTarget.getCenter`, where a copy is placed) */
export interface FitEnvelope {
  /** x, y, z a point: about 200 */
  readonly inside: Float32Array;
  /** Its points' farthest from the center, Å (the reach's scale) */
  readonly radius: number;
  /** The shells by the map's voxel, made once each */
  readonly shells: Map<number, Float32Array>;
}

/** A map to fit in: its density read at a point of the scene (Å) in σ about its mean, 0 outside it */
export interface FitMap {
  readonly grid: Grid;
  /** Its voxel's side, Å (its smallest) */
  readonly voxel: number;
  read(p: Vec3): number;
  /** Its layout read directly (a grid of strides, not periodic): the score's sums inline, no number boxed a read */
  readonly layout?: FitLayout;
}

/** A grid's layout as a fit reads it: the scene to grid matrix, its sizes and strides, its data, mean and σ */
export interface FitLayout {
  readonly toGrid: Mat4;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: ArrayLike<number>;
  readonly mean: number;
  readonly sigma: number;
}

/** A copy's pose in the scene: its center's position and its orientation */
export interface FitPose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** A fit: the pose, its score (σ), its shift (Å) and turn (°) from where it was put */
export interface FitResult extends FitPose {
  readonly score: number;
  readonly shift: number;
  readonly angle: number;
}

/** How far a fit goes: its shift at most (Å), its turn at most (°), the contrast, and the pull back */
export interface FitOptions {
  readonly reach: number;
  readonly turn: number;
  readonly contrast: FitContrast;
  /** The restraint at the reach's edge (σ a term); `FitPull` without */
  readonly pull?: number;
  /**
   * On a surface (a mesh painted or grown on): its unit normal at the copy, in the scene. The copy stays on it (its
   * shift in the tangent plane, its turn a spin about the normal and a tilt of `SurfaceTilt` at most) and its score's
   * shell is the shell's points along the normal only: a wall's contrast against either side of it, not against its
   * neighbours along it (a lattice's: as dark as the copy)
   */
  readonly normal?: Vec3;
}

/** The envelope's points (k-means'd from the object's) */
export const EnvelopePoints = 200;
/** The shell's points (one a direction) */
export const ShellPoints = 100;
/**
 * The restraint at the reach's edge, σ (`k·(d²/reach² + θ²/θmax²)`): weak enough that a copy 4 Å / 10° off a density's
 * site fits back within 1 Å / 3°, strong enough that a flat or a noisy map leaves it near where it was put
 */
export const FitPull = 0.1;
/** Paint's reach: a third of the copy's radius and 15° (Ludo, 2026-11-10, Decided 1) */
export const PaintReach = { shift: 1 / 3, turn: 15 } as const;
/** A grown copy's reach (its rule already says where it goes): half paint's */
export const GrowReach = { shift: 1 / 6, turn: 7.5 } as const;
/** On a surface, a copy's tilt off its normal at most (°): it stays upright on it */
export const SurfaceTilt = 5;
/** On a surface, the shell's points within 45° of the normal (either side) score it */
const AlongNormal = Math.SQRT1_2;

// --- The envelope ------------------------------------------------------------------------------------------------------

/** The most points of an object k-means'd: a larger object is subsampled first (every n-th point) */
const MaxSampled = 4000;
const KMeansRounds = 8;

/** `count` cluster centers of points (x, y, z each), deterministic (seeded by an even stride) */
function kMeans(xyz: Float32Array, count: number): Float32Array {
  const n = xyz.length / 3;
  if (n <= count) return xyz;
  const centers = new Float32Array(count * 3);
  for (let c = 0; c < count; ++c) {
    const i = Math.floor(((c + 0.5) * n) / count);
    centers[c * 3] = xyz[i * 3];
    centers[c * 3 + 1] = xyz[i * 3 + 1];
    centers[c * 3 + 2] = xyz[i * 3 + 2];
  }
  const sums = new Float64Array(count * 3);
  const sizes = new Int32Array(count);
  for (let round = 0; round < KMeansRounds; ++round) {
    sums.fill(0);
    sizes.fill(0);
    for (let i = 0; i < n; ++i) {
      const x = xyz[i * 3];
      const y = xyz[i * 3 + 1];
      const z = xyz[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < count; ++c) {
        const dx = x - centers[c * 3];
        const dy = y - centers[c * 3 + 1];
        const dz = z - centers[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      sums[best * 3] += x;
      sums[best * 3 + 1] += y;
      sums[best * 3 + 2] += z;
      sizes[best]++;
    }
    for (let c = 0; c < count; ++c) {
      if (!sizes[c]) continue;
      centers[c * 3] = sums[c * 3] / sizes[c];
      centers[c * 3 + 1] = sums[c * 3 + 1] / sizes[c];
      centers[c * 3 + 2] = sums[c * 3 + 2] / sizes[c];
    }
  }
  return centers;
}

/** Points about a center, subsampled to `MaxSampled` at most, as read by `each` (n points) */
function sampled(n: number, center: Vec3, each: (i: number, out: Vec3) => void): Float32Array {
  const stride = Math.max(1, Math.ceil(n / MaxSampled));
  const out = new Float32Array(Math.ceil(n / stride) * 3);
  const p = Vec3();
  let k = 0;
  for (let i = 0; i < n; i += stride) {
    each(i, p);
    out[k++] = p[0] - center[0];
    out[k++] = p[1] - center[1];
    out[k++] = p[2] - center[2];
  }
  return out.subarray(0, k);
}

/** Points uniform in a ball (a shape's or an unknown object's envelope), deterministic */
function ball(radius: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; ++i) {
    // radii by the cube root (uniform in volume), directions on a Fibonacci sphere
    const r = radius * Math.cbrt((i + 0.5) / count);
    const z = 1 - (2 * (i + 0.5)) / count;
    const s = Math.sqrt(1 - z * z);
    const t = golden * i * 7;
    out[i * 3] = r * s * Math.cos(t);
    out[i * 3 + 1] = r * s * Math.sin(t);
    out[i * 3 + 2] = r * z;
  }
  return out;
}

export function envelopeOfPoints(points: Float32Array): FitEnvelope {
  let r2 = 0;
  for (let i = 0; i < points.length; i += 3) {
    r2 = Math.max(r2, points[i] * points[i] + points[i + 1] * points[i + 1] + points[i + 2] * points[i + 2]);
  }
  return { inside: kMeans(points, EnvelopePoints), radius: Math.sqrt(r2), shells: new Map() };
}

const envelopes = new WeakMap<object, FitEnvelope>();
const balls = new Map<number, FitEnvelope>();

/**
 * A copy's envelope, made once an object: a structure's atoms, a `sites` target's sites, a `volume` target's voxels
 * above 1σ (an average is an envelope), each about its center and k-means'd to `EnvelopePoints`; a shape (or no
 * object) a ball of `radius`
 */
export function envelopeOf(target: ParticleTarget | undefined, radius: number): FitEnvelope {
  // a center the target gives is its own (two of one structure may differ: review S7)
  const own = target && 'center' in target ? target.center : undefined;
  const key =
    own ??
    (target?.kind === 'structure'
      ? target.structure
      : target?.kind === 'sites'
        ? target.sites
        : target?.kind === 'volume'
          ? target.volume
          : undefined);
  if (!key || !target || target.kind === 'shape') {
    const r = Math.max(radius, 1);
    let e = balls.get(r);
    if (!e) balls.set(r, (e = envelopeOfPoints(ball(r, EnvelopePoints))));
    return e;
  }
  const kept = envelopes.get(key);
  if (kept) return kept;
  const center = ParticleTarget.getCenter(target) ?? Vec3();
  let points: Float32Array;
  if (target.kind === 'structure') {
    const xyz: number[] = [];
    const p = Vec3();
    for (const u of target.structure.units) {
      for (let i = 0; i < u.elements.length; ++i) {
        u.conformation.position(u.elements[i], p);
        xyz.push(p[0], p[1], p[2]);
      }
    }
    points = sampled(xyz.length / 3, center, (i, out) => Vec3.fromArray(out, xyz, i * 3));
  } else if (target.kind === 'sites') {
    const s = target.sites;
    points = sampled(s.count, center, (i, out) => Vec3.fromArray(out, s.positions, i * 3));
  } else {
    const grid = target.volume.grid;
    const { space, data } = grid.cells;
    const [nx, ny, nz] = space.dimensions;
    const level = grid.stats.mean + grid.stats.sigma;
    const g2c = Grid.getGridToCartesianTransform(grid);
    const above: number[] = [];
    for (let k = 0; k < nz; ++k)
      for (let j = 0; j < ny; ++j)
        for (let i = 0; i < nx; ++i) if (space.get(data, i, j, k) > level) above.push(i, j, k);
    points = sampled(above.length / 3, center, (i, out) =>
      Vec3.transformMat4(out, Vec3.set(out, above[i * 3], above[i * 3 + 1], above[i * 3 + 2]), g2c),
    );
  }
  const e = points.length >= 3 ? envelopeOfPoints(points) : envelopeOfPoints(ball(Math.max(radius, 1), EnvelopePoints));
  envelopes.set(key, e);
  return e;
}

/**
 * The shell about an envelope for a map's voxel: for each of `ShellPoints` directions (a Fibonacci sphere), the
 * envelope's point farthest along it pushed out along it by 1.5 voxels and 2 Å (a point is an atom's center, or a
 * cluster's)
 */
export function shellOf(envelope: FitEnvelope, voxel: number): Float32Array {
  const kept = envelope.shells.get(voxel);
  if (kept) return kept;
  const out = new Float32Array(ShellPoints * 3);
  const pad = 1.5 * voxel + 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const { inside } = envelope;
  for (let d = 0; d < ShellPoints; ++d) {
    const z = 1 - (2 * (d + 0.5)) / ShellPoints;
    const s = Math.sqrt(1 - z * z);
    const x = s * Math.cos(golden * d);
    const y = s * Math.sin(golden * d);
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < inside.length; i += 3) {
      const t = inside[i] * x + inside[i + 1] * y + inside[i + 2] * z;
      if (t > bestDot) {
        bestDot = t;
        best = i;
      }
    }
    out[d * 3] = inside[best] + pad * x;
    out[d * 3 + 1] = inside[best + 1] + pad * y;
    out[d * 3 + 2] = inside[best + 2] + pad * z;
  }
  envelope.shells.set(voxel, out);
  return out;
}

// --- The map -----------------------------------------------------------------------------------------------------------

const maps = new WeakMap<Grid, FitMap | null>();

/** A grid as a map to fit in (made once a grid); undefined for a flat one (σ 0: nothing to fit to) */
export function fitMapOf(grid: Grid): FitMap | undefined {
  const kept = maps.get(grid);
  if (kept !== undefined) return kept ?? undefined;
  const { mean, sigma } = grid.stats;
  if (!(sigma > 0) || Grid.isEmpty(grid)) {
    maps.set(grid, null);
    return undefined;
  }
  const m = Grid.getGridToCartesianTransform(grid);
  const voxel = Math.min(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
  const strides = Tensor.strides(grid.cells.space);
  const [nx, ny, nz] = grid.cells.space.dimensions;
  const layout: FitLayout | undefined =
    strides && grid.periodicity !== 'xyz' && nx > 1 && ny > 1 && nz > 1
      ? {
          toGrid: Mat4.invert(Mat4(), m),
          nx,
          ny,
          nz,
          sx: strides[0],
          sy: strides[1],
          sz: strides[2],
          data: grid.cells.data,
          mean,
          sigma,
        }
      : undefined;
  const raw = Grid.makeGetTrilinearlyInterpolated(grid, 'none');
  const read = (p: Vec3) => {
    const v = raw(p);
    // outside the grid: its mean
    return Number.isNaN(v) ? 0 : (v - mean) / sigma;
  };
  const map: FitMap = { grid, voxel, read, ...(layout ? { layout } : {}) };
  maps.set(grid, map);
  return map;
}

// --- The score and the search ------------------------------------------------------------------------------------------

const _w = Vec3();
const _m = new Float64Array(9);

/** A unit quaternion's rotation matrix, column-major (as `Mat3`) */
function rotationMatrix(out: Float64Array, q: Quat) {
  const [x, y, z, w] = q;
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[3] = 2 * (x * y - z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z + x * w);
  out[6] = 2 * (x * z + y * w);
  out[7] = 2 * (y * z - x * w);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

const means = new Float64Array(2);

/** The mean of the map at points of a frame put at a pose, into `means[slot]` */
function meanAt(
  map: FitMap,
  points: Float32Array,
  position: Vec3,
  rotation: Quat,
  slot: number,
  length = points.length,
) {
  const m = rotationMatrix(_m, rotation);
  const px = position[0];
  const py = position[1];
  const pz = position[2];
  const L = map.layout;
  let sum = 0;
  for (let i = 0; i < length; i += 3) {
    const x0 = points[i];
    const y0 = points[i + 1];
    const z0 = points[i + 2];
    const wx = m[0] * x0 + m[3] * y0 + m[6] * z0 + px;
    const wy = m[1] * x0 + m[4] * y0 + m[7] * z0 + py;
    const wz = m[2] * x0 + m[5] * y0 + m[8] * z0 + pz;
    if (!L) {
      Vec3.set(_w, wx, wy, wz);
      sum += map.read(_w);
      continue;
    }
    // trilinear in the grid's own layout, 0 (its mean) outside it
    const g = L.toGrid;
    const x = g[0] * wx + g[4] * wy + g[8] * wz + g[12];
    const y = g[1] * wx + g[5] * wy + g[9] * wz + g[13];
    const z = g[2] * wx + g[6] * wy + g[10] * wz + g[14];
    if (!(x >= 0 && y >= 0 && z >= 0 && x <= L.nx - 1 && y <= L.ny - 1 && z <= L.nz - 1)) continue;
    const a = Math.min(Math.floor(x), L.nx - 2);
    const b = Math.min(Math.floor(y), L.ny - 2);
    const c = Math.min(Math.floor(z), L.nz - 2);
    const u = x - a;
    const v = y - b;
    const w = z - c;
    const { sx, sy, sz, data } = L;
    const o = a * sx + b * sy + c * sz;
    const c00 = data[o] * (1 - u) + data[o + sx] * u;
    const c10 = data[o + sy] * (1 - u) + data[o + sx + sy] * u;
    const c01 = data[o + sz] * (1 - u) + data[o + sx + sz] * u;
    const c11 = data[o + sy + sz] * (1 - u) + data[o + sx + sy + sz] * u;
    sum += ((c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w - L.mean) / L.sigma;
  }
  // into `means` (a number returned from a call is boxed: one a call, some 700 a fit)
  means[slot] = length ? sum / (length / 3) : 0;
}

/** The shell's points used (`shellAlong`): all of them, or those along a surface's normal; made once */
const _shell = new Float32Array(ShellPoints * 3);
const _n = Vec3();
const _inv = Quat();

/**
 * The shell's points scoring a pose turned by `rotation`: all of them, or on a surface (`normal`, in the scene) those
 * whose direction from the copy is within 45° of it, either side (into `_shell`); their length (3 numbers a point)
 */
function shellAlong(envelope: FitEnvelope, voxel: number, rotation: Quat, normal: Vec3 | undefined): number {
  const shell = shellOf(envelope, voxel);
  if (!normal) {
    _shell.set(shell);
    return shell.length;
  }
  // the normal in the copy's own frame
  Vec3.transformQuat(_n, normal, Quat.conjugate(_inv, rotation));
  const golden = Math.PI * (3 - Math.sqrt(5));
  let k = 0;
  for (let d = 0; d < ShellPoints; ++d) {
    // the shell's direction d (`shellOf`'s)
    const z = 1 - (2 * (d + 0.5)) / ShellPoints;
    const s = Math.sqrt(1 - z * z);
    const t = s * Math.cos(golden * d) * _n[0] + s * Math.sin(golden * d) * _n[1] + z * _n[2];
    if (Math.abs(t) < AlongNormal) continue;
    _shell[k++] = shell[d * 3];
    _shell[k++] = shell[d * 3 + 1];
    _shell[k++] = shell[d * 3 + 2];
  }
  return k;
}

/**
 * A pose's score: the mean inside minus the mean in the shell, in σ, signed by the contrast (Dark: inside darker); on a
 * surface (`normal`), the shell along it only (`FitOptions.normal`)
 */
export function fitScore(
  map: FitMap,
  envelope: FitEnvelope,
  pose: FitPose,
  contrast: FitContrast,
  normal?: Vec3,
): number {
  const length = shellAlong(envelope, map.voxel, pose.rotation, normal);
  meanAt(map, envelope.inside, pose.position, pose.rotation, 0);
  meanAt(map, _shell, pose.position, pose.rotation, 1, length);
  const d = means[0] - means[1];
  return contrast === 'dark' ? -d : d;
}

const N = 6;
const NelderMeadEvals = 240;
const RefineEvals = 120;
const _x = new Float64Array(N);
const _omega = Vec3();
const _turn = Quat();
const _pos = Vec3();
const _rot = Quat();
/** The simplex (7 vertices of 6), its values, the centroid and the trial points: made once */
const simplex = Array.from({ length: N + 1 }, () => new Float64Array(N));
const values = new Float64Array(N + 1);
const centroid = new Float64Array(N);
const xr = new Float64Array(N);
const xe = new Float64Array(N);
const xc = new Float64Array(N);

/**
 * The parameters' frame (`objective.frame`, column-major, as `Mat3`): x, y, z in space; on a surface two tangents and
 * the normal (its third axis)
 */
const _frame = new Float64Array(9);
const _shift = Vec3();

/** Its frame: the scene's axes, or a surface's two tangents and its normal */
function frameOf(out: Float64Array, normal: Vec3 | undefined) {
  out.fill(0);
  if (!normal) {
    out[0] = out[4] = out[8] = 1;
    return;
  }
  const [nx, ny, nz] = normal;
  // a tangent: the normal crossed with the axis least along it
  const ax = Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz) ? 1 : 0;
  const ay = !ax && Math.abs(ny) <= Math.abs(nz) ? 1 : 0;
  const az = !ax && !ay ? 1 : 0;
  let tx = ny * az - nz * ay;
  let ty = nz * ax - nx * az;
  let tz = nx * ay - ny * ax;
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  tx /= l;
  ty /= l;
  tz /= l;
  out[0] = tx;
  out[1] = ty;
  out[2] = tz;
  out[3] = ny * tz - nz * ty;
  out[4] = nz * tx - nx * tz;
  out[5] = nx * ty - ny * tx;
  out[6] = nx;
  out[7] = ny;
  out[8] = nz;
}

/**
 * Parameters kept in their unit balls (the shift's within the reach, the turn's within its most); on a surface
 * (`objective.surface`), no shift along the normal (its third) and a tilt (the turn's first two) of `objective.tilt`
 * (of the most turn) at most
 */
function project(x: Float64Array) {
  const o = objective;
  if (o.surface) x[2] = 0;
  // not Math.hypot: its arguments are allocated a call
  const s = Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
  if (s > 1) for (let i = 0; i < 3; ++i) x[i] /= s;
  if (o.surface) {
    const tilt = Math.sqrt(x[3] * x[3] + x[4] * x[4]);
    if (tilt > o.tilt) for (let i = 3; i < 5; ++i) x[i] *= o.tilt / tilt;
    if (Math.abs(x[5]) > 1) x[5] = Math.sign(x[5]);
    return;
  }
  const t = Math.sqrt(x[3] * x[3] + x[4] * x[4] + x[5] * x[5]);
  if (t > 1) for (let i = 3; i < 6; ++i) x[i] /= t;
}

/** `v` (3 of `x` from `at`) in the scene, from the parameters' frame, scaled */
function inFrame(out: Vec3, x: Float64Array, at: number, scale: number) {
  const f = objective.frame;
  const a = x[at] * scale;
  const b = x[at + 1] * scale;
  const c = x[at + 2] * scale;
  return Vec3.set(out, f[0] * a + f[3] * b + f[6] * c, f[1] * a + f[4] * b + f[7] * c, f[2] * a + f[5] * b + f[8] * c);
}

/** The pose of parameters (shift / reach, rotation vector / most turn, in their frame) from a pose */
function poseOf(x: Float64Array, from: FitPose, reach: number, turn: number, position: Vec3, rotation: Quat) {
  Vec3.add(position, from.position, inFrame(_shift, x, 0, reach));
  inFrame(_omega, x, 3, turn);
  const angle = Vec3.magnitude(_omega);
  if (angle > 1e-12) Quat.setAxisAngle(_turn, Vec3.scale(_omega, _omega, 1 / angle), angle);
  else Quat.setIdentity(_turn);
  // turned about the copy's center, in the scene's frame
  Quat.normalize(rotation, Quat.multiply(rotation, _turn, from.rotation));
}

/** The search's objective, set by `fitPose` (module-level: nothing allocated a fit) */
const objective = {
  map: undefined as FitMap | undefined,
  inside: new Float32Array(0) as Float32Array,
  shell: new Float32Array(0) as Float32Array,
  from: undefined as FitPose | undefined,
  reach: 0,
  turn: 0,
  sign: 1,
  pull: 0,
  /** The shell's points used (of `shell`: 3 numbers a point) */
  shellLength: 0,
  /** On a surface: the shift tangent, the tilt at most `tilt` (of the most turn) */
  surface: false,
  tilt: 1,
  frame: _frame,
};

/** The score minus the pull back of parameters (the objective's) */
function f(x: Float64Array): number {
  const o = objective;
  poseOf(x, o.from!, o.reach, o.turn, _pos, _rot);
  meanAt(o.map!, o.inside, _pos, _rot, 0);
  meanAt(o.map!, o.shell, _pos, _rot, 1, o.shellLength);
  const d = means[0] - means[1];
  return -o.sign * d + o.pull * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2] + x[3] * x[3] + x[4] * x[4] + x[5] * x[5]);
}

/** A point on the line through `a` and `b` (`a + t·(b − a)`), projected */
function point(out: Float64Array, a: Float64Array, b: Float64Array, t: number) {
  for (let k = 0; k < N; ++k) out[k] = a[k] + t * (b[k] - a[k]);
  project(out);
}

/**
 * Nelder-Mead from the simplex as set, at most `evals` evaluations of `f` (each parameter vector projected first, so
 * every vertex stays within the bounds); the best vertex's index
 */
function nelderMead(evals: number) {
  for (let i = 0; i <= N; ++i) {
    project(simplex[i]);
    values[i] = f(simplex[i]);
  }
  let used = N + 1;
  while (used < evals) {
    // the best, the worst and the second worst
    let best = 0;
    let worst = 0;
    for (let i = 1; i <= N; ++i) {
      if (values[i] < values[best]) best = i;
      if (values[i] > values[worst]) worst = i;
    }
    let second = best;
    for (let i = 0; i <= N; ++i) if (i !== worst && values[i] > values[second]) second = i;
    if (values[worst] - values[best] < 1e-7) break;
    centroid.fill(0);
    for (let i = 0; i <= N; ++i) if (i !== worst) for (let k = 0; k < N; ++k) centroid[k] += simplex[i][k] / N;
    // reflect
    point(xr, centroid, simplex[worst], -1);
    const fr = f(xr);
    ++used;
    if (fr < values[best]) {
      point(xe, centroid, simplex[worst], -2);
      const fe = f(xe);
      ++used;
      if (fe < fr) {
        simplex[worst].set(xe);
        values[worst] = fe;
      } else {
        simplex[worst].set(xr);
        values[worst] = fr;
      }
      continue;
    }
    if (fr < values[second]) {
      simplex[worst].set(xr);
      values[worst] = fr;
      continue;
    }
    // contract (outside the reflected point when it is better than the worst, else inside)
    const outside = fr < values[worst];
    point(xc, centroid, simplex[worst], outside ? -0.5 : 0.5);
    const fc = f(xc);
    ++used;
    if (fc < (outside ? fr : values[worst])) {
      simplex[worst].set(xc);
      values[worst] = fc;
      continue;
    }
    // shrink toward the best
    for (let i = 0; i <= N; ++i) {
      if (i === best) continue;
      point(simplex[i], simplex[best], simplex[i], 0.5);
      values[i] = f(simplex[i]);
      ++used;
    }
  }
  let b = 0;
  for (let i = 1; i <= N; ++i) if (values[i] < values[b]) b = i;
  return b;
}

/**
 * The simplex about `x0`: it and a step along each parameter; on a surface (no shift along the normal, the third) that
 * step is one back along both tangents instead, so the 6 vertices still span the 5 parameters left
 */
function startAt(x0: Float64Array, step: number) {
  for (let i = 0; i <= N; ++i) {
    simplex[i].set(x0);
    if (i === 3 && objective.surface) {
      simplex[i][0] -= step;
      simplex[i][1] -= step;
    } else if (i) simplex[i][i - 1] += step;
  }
}

/** A fit written in place (`fitPose`'s `out`: the copy under the pointer's, a frame) */
export interface FitOut {
  readonly position: Vec3;
  readonly rotation: Quat;
  score: number;
  shift: number;
  angle: number;
}

/**
 * A copy fitted to a map from its pose: the best shift and turn within the reach by the score minus the pull back
 * (`k·(d²/reach² + θ²/θmax²)`), Nelder-Mead from the pose and once more on a finer simplex. A flat map (none):
 * the pose as it is, score 0. Into `out` when given (nothing allocated)
 */
export function fitPose(
  map: FitMap | undefined,
  envelope: FitEnvelope,
  from: FitPose,
  o: FitOptions,
  out: FitOut = { position: Vec3(), rotation: Quat(), score: 0, shift: 0, angle: 0 },
): FitResult {
  const turn = (o.turn * Math.PI) / 180;
  if (!map || !(o.reach > 0) || !(turn > 0)) {
    Vec3.copy(out.position, from.position);
    Quat.copy(out.rotation, from.rotation);
    out.score = map ? fitScore(map, envelope, from, o.contrast, o.normal) : 0;
    out.shift = 0;
    out.angle = 0;
    return out;
  }
  const g = objective;
  g.map = map;
  g.inside = envelope.inside;
  // on a surface, the shell along its normal (as the copy is put: its tilt is a few degrees)
  g.shellLength = shellAlong(envelope, map.voxel, from.rotation, o.normal);
  g.shell = _shell;
  g.surface = !!o.normal;
  g.tilt = Math.min(1, SurfaceTilt / o.turn);
  frameOf(g.frame, o.normal);
  g.from = from;
  g.reach = o.reach;
  g.turn = turn;
  g.sign = o.contrast === 'dark' ? -1 : 1;
  g.pull = o.pull ?? FitPull;
  _x.fill(0);
  startAt(_x, 0.5);
  let b = nelderMead(NelderMeadEvals);
  _x.set(simplex[b]);
  startAt(_x, 0.1);
  b = nelderMead(RefineEvals);
  const x = simplex[b];
  poseOf(x, from, o.reach, turn, out.position, out.rotation);
  out.score = fitScore(map, envelope, out, o.contrast, o.normal);
  out.shift = o.reach * Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
  out.angle = o.turn * Math.sqrt(x[3] * x[3] + x[4] * x[4] + x[5] * x[5]);
  g.map = undefined;
  g.from = undefined;
  return out;
}

// --- Grown copies ------------------------------------------------------------------------------------------------------

/** Grown copies fitted and kept (`fitGrown`): their poses and each one's fit */
export interface FittedCopies {
  readonly positions: number[];
  readonly rotations: number[];
  readonly fit: CopiesFit;
}

/** Each copy's fit, as a stroke keeps it (`PaintStroke.fit`): its score (σ), shift (Å) and turn (°) */
export interface CopiesFit {
  readonly score: number[];
  readonly shift: number[];
  readonly angle: number[];
}

const cellKey = (i: number, j: number, k: number) => `${i},${j},${k}`;

/**
 * Grown copies (their poses in the scene, in their rule's order) each fitted within `o`'s reach, kept when their score
 * is at least `threshold` and their center farther than `apart` from every copy kept before (and from `from`, the
 * source: two copies in one site are one), until `count` are kept (none: all of them). Each copy fitted from its rule's
 * pose alone: the first kept are the same whatever the count (prefix-stable). On a surface, `normals` (its normal at
 * each copy, x, y, z each; 0, 0, 0 for none): each kept on it (`FitOptions.normal`)
 */
export function fitGrown(
  map: FitMap,
  envelope: FitEnvelope,
  poses: { readonly positions: ArrayLike<number>; readonly rotations: ArrayLike<number> },
  o: FitOptions & {
    readonly threshold: number;
    readonly apart: number;
    readonly count?: number;
    readonly from?: Vec3;
    readonly normals?: ArrayLike<number>;
  },
): FittedCopies {
  const out: FittedCopies = { positions: [], rotations: [], fit: { score: [], shift: [], angle: [] } };
  const cell = Math.max(o.apart, 1e-3);
  const grid = new Map<string, number[]>();
  const add = (p: Vec3) => {
    const key = cellKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    let at = grid.get(key);
    if (!at) grid.set(key, (at = []));
    at.push(p[0], p[1], p[2]);
  };
  const crowded = (p: Vec3) => {
    const i0 = Math.floor(p[0] / cell);
    const j0 = Math.floor(p[1] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = i0 - 1; i <= i0 + 1; ++i)
      for (let j = j0 - 1; j <= j0 + 1; ++j)
        for (let k = k0 - 1; k <= k0 + 1; ++k) {
          const at = grid.get(cellKey(i, j, k));
          if (!at) continue;
          for (let m = 0; m < at.length; m += 3) {
            if (Math.hypot(at[m] - p[0], at[m + 1] - p[1], at[m + 2] - p[2]) < o.apart) return true;
          }
        }
    return false;
  };
  if (o.from) add(o.from);
  const position = Vec3();
  const rotation = Quat();
  const pose = { position, rotation };
  const normal = Vec3();
  const n = Math.floor(poses.positions.length / 3);
  for (let i = 0; i < n && (o.count === undefined || out.positions.length / 3 < o.count); ++i) {
    Vec3.set(position, poses.positions[i * 3], poses.positions[i * 3 + 1], poses.positions[i * 3 + 2]);
    Quat.set(
      rotation,
      poses.rotations[i * 4] ?? 0,
      poses.rotations[i * 4 + 1] ?? 0,
      poses.rotations[i * 4 + 2] ?? 0,
      poses.rotations[i * 4 + 3] ?? 1,
    );
    const on = !!o.normals && normalAt(normal, o.normals, i);
    const r = fitPose(map, envelope, pose, on ? { ...o, normal } : { ...o, normal: undefined });
    if (!(r.score >= o.threshold) || crowded(r.position)) continue;
    add(r.position);
    out.positions.push(r.position[0], r.position[1], r.position[2]);
    out.rotations.push(r.rotation[0], r.rotation[1], r.rotation[2], r.rotation[3]);
    out.fit.score.push(r.score);
    out.fit.shift.push(r.shift);
    out.fit.angle.push(r.angle);
  }
  return out;
}

/** The unit normal `i` of normals (x, y, z each) into `out`; false for none there (0, 0, 0 or not given) */
function normalAt(out: Vec3, normals: ArrayLike<number>, i: number): boolean {
  if (normals.length < i * 3 + 3) return false;
  Vec3.set(out, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  const l = Vec3.magnitude(out);
  if (!(l > 1e-9)) return false;
  Vec3.scale(out, out, 1 / l);
  return true;
}

/** A stroke's copies' fit (`PaintStroke.fit`): each copy's, and the volume's name (the copies stay without it) */
export interface StrokeFit extends CopiesFit {
  readonly volume: string;
}

/**
 * Copies of a list's frame (positions, rotations: a stroke's) each fitted in the scene (the list's move and scale put
 * them where they are drawn), in place, back in the list's frame; their fit. On a surface, `normals` (in the scene, x,
 * y, z a copy): each kept on it (`FitOptions.normal`)
 */
export function fitCopies(
  map: FitMap | undefined,
  envelope: FitEnvelope,
  move: ListMove | undefined,
  positions: number[],
  rotations: number[],
  o: FitOptions,
  normals?: ArrayLike<number>,
): CopiesFit {
  const out: CopiesFit = { score: [], shift: [], angle: [] };
  const p = [0, 0, 0];
  const q = [0, 0, 0, 1];
  const normal = Vec3();
  for (let i = 0; i < positions.length / 3; ++i) {
    const pose = poseToScene(move, {
      position: Vec3.fromArray(Vec3(), positions, i * 3),
      rotation: Quat.fromArray(Quat(), rotations, i * 4),
    });
    const on = !!normals && normalAt(normal, normals, i);
    const r = fitPose(map, envelope, pose, on ? { ...o, normal } : { ...o, normal: undefined });
    Vec3.toArray(r.position, p, 0);
    Quat.toArray(r.rotation, q, 0);
    toListFrame(move, p, undefined);
    rotationsToListFrame(move, q);
    for (let c = 0; c < 3; ++c) positions[i * 3 + c] = p[c];
    for (let c = 0; c < 4; ++c) rotations[i * 4 + c] = q[c];
    out.score.push(r.score);
    out.shift.push(r.shift);
    out.angle.push(r.angle);
  }
  return out;
}

// --- Slices ------------------------------------------------------------------------------------------------------------

const gridToScene = new WeakMap<Grid, Mat4>();
const _g = Vec3();
const _a = Vec3();
const _b = Vec3();

/** A slice's plane in the scene: a point of it and its unit normal */
export interface SlicePlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/**
 * The plane a slice representation draws (its props: `mode` grid, an index along x, y or z, absolute or relative; or
 * plane, its point and normal) in the grid it takes (a moved volume's), into `out`; undefined for a frame slice
 */
export function slicePlane(
  grid: Grid,
  props: {
    readonly mode?: string;
    readonly dimension?: { readonly name: string; readonly params: number };
    readonly plane?: { readonly point: Vec3; readonly normal: Vec3 };
  },
  out: SlicePlane = { point: Vec3(), normal: Vec3() },
): SlicePlane | undefined {
  const mode = props.mode ?? 'grid';
  if (mode === 'plane' && props.plane) {
    Vec3.normalize(out.normal, props.plane.normal);
    Vec3.copy(out.point, props.plane.point);
    return Vec3.magnitude(out.normal) > 0 ? out : undefined;
  }
  if (mode !== 'grid' || !props.dimension) return undefined;
  const name = props.dimension.name;
  const axis = name.endsWith('X') || name === 'x' ? 0 : name.endsWith('Y') || name === 'y' ? 1 : 2;
  const dims = grid.cells.space.dimensions;
  const index = name.startsWith('relative')
    ? Math.round(props.dimension.params * (dims[axis] - 1))
    : props.dimension.params;
  let m = gridToScene.get(grid);
  if (!m) gridToScene.set(grid, (m = Grid.getGridToCartesianTransform(grid)));
  Vec3.set(_g, 0, 0, 0);
  _g[axis] = index;
  Vec3.transformMat4(out.point, _g, m);
  // the plane of the two other axes: its normal their cross product (any grid, skewed too)
  const i = ((axis + 1) % 3) * 4;
  const j = ((axis + 2) % 3) * 4;
  Vec3.set(_a, m[i], m[i + 1], m[i + 2]);
  Vec3.set(_b, m[j], m[j + 1], m[j + 2]);
  Vec3.normalize(out.normal, Vec3.cross(out.normal, _a, _b));
  return out;
}

/** Where a ray meets a plane (false: along it, or behind the ray's origin) */
export function rayOnPlane(out: Vec3, origin: Vec3, direction: Vec3, plane: SlicePlane): boolean {
  const d = Vec3.dot(direction, plane.normal);
  if (Math.abs(d) < 1e-9) return false;
  const t = (Vec3.dot(plane.point, plane.normal) - Vec3.dot(origin, plane.normal)) / d;
  if (!(t >= 0)) return false;
  Vec3.scaleAndAdd(out, origin, direction, t);
  return true;
}

// --- In the scene ------------------------------------------------------------------------------------------------------

/** A volume of the scene: its state ref, its name, and the volume as drawn (its last decorator's: a moved one's grid) */
export interface SceneVolume {
  readonly ref: string;
  readonly label: string;
  readonly volume: Volume;
}

/** The last of a cell's decorators (what its representations take), else itself */
function lastDecorator(state: State, cell: StateObjectCell): StateObjectCell {
  for (let at = cell; ; ) {
    const next = state.tree.children
      .get(at.transform.ref)
      .toArray()
      .map((c) => state.cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator);
    if (!next) return at;
    at = next;
  }
}

/** The volumes of the scene (a decorator's not one of its own) */
export function sceneVolumes(state: State): SceneVolume[] {
  const out: SceneVolume[] = [];
  for (const cell of state.cells.values()) {
    if (cell.state.isGhost || !SO.Volume.Data.is(cell.obj)) continue;
    if (cell.transform.transformer.definition.isDecorator) continue;
    const drawn = lastDecorator(state, cell).obj;
    const volume = SO.Volume.Data.is(drawn) ? drawn.data : cell.obj.data;
    out.push({ ref: cell.transform.ref, label: cell.obj.label, volume });
  }
  return out;
}

/** A volume of the scene by its state ref or its name */
export function sceneVolume(state: State, name: string): SceneVolume | ApiFailure {
  return pickNamed(sceneVolumes(state), name, {
    what: 'volume',
    ids: (v) => [v.ref],
    names: (v) => [v.label],
    describe: (v) => `${v.label} (${v.ref})`,
    none: { message: 'No volume is loaded.', hint: 'Open a tomogram or a map (MRC).' },
  });
}

/** The volume of the scene a drawn volume (a pick's, `Volume.Loci`'s) is, if it is one */
export function sceneVolumeOf(state: State, drawn: Volume): SceneVolume | undefined {
  return sceneVolumes(state).find((v) => v.volume === drawn || v.volume.grid === drawn.grid);
}

/** A fit's report: "fit 2.4σ, 3.1 Å, 8°" */
export function fitLabel(r: Pick<FitResult, 'score' | 'shift' | 'angle'>): string {
  return `fit ${r.score.toFixed(1)}σ, ${r.shift.toFixed(1)} Å, ${Math.round(r.angle)}°`;
}
