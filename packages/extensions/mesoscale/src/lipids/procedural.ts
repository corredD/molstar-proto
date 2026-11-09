/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { cellEntry, cellSide, type CutterRegions, emptyCut, triangleCut } from './cutter.js';

// A membrane made per view (lipid-procedural, its progress file's design; round 5: below the triangle): the cutter's
// lipids only on the units in view whose lipids are large enough on screen, nearest first within a pool of fixed capacity
// a member. A unit is a small triangle whole (its counts per member from the count pass, read back at the wrap) or a
// cell of a large one (its slots its kind's counts, `kindCounts`: a cell on the triangle's edge writes the lipids it does
// not own dead), so each member's live count and each unit's first slot are exact on the CPU without anything O(lipids):
// the GPU only writes the hits. Pure; nothing allocated per view.

/** How the far membrane looks: the lipids' sphere levels, the textured surface, or both (the levels, then the surface) */
export type MembraneFar = 'spheres' | 'texture' | 'both';

/** What a view selects by: a lipid's size on screen to take a triangle at (`enterPx`), kept down to `keep` of it */
export interface SelectionParams {
  /** a lipid's size, Å (the patch's spacing) */
  readonly lipidSize: number;
  readonly enterPx: number;
  /** hysteresis: a triangle taken stays down to `enterPx * keep` */
  readonly keep: number;
  /**
   * Only the units whose leaflet faces the camera (round 5: the leaflet behind the other and the far side of a body are
   * hidden), within this margin, Å; 0 off (a clip shows them)
   */
  readonly facing?: number;
}

/** The pixel size a far mode takes lipids at: its texture switch, or its spheres' last */
export function enterPx(far: MembraneFar, atomsPx: number, spheresPx: number) {
  return far === 'texture' ? atomsPx : spheresPx;
}

/**
 * Each member's capacity: its full total where the whole membrane fits `budget`, else its share of the budget (+10 %)
 * at most its total; per leaflet, per member
 */
export function poolCapacities(totals: readonly Uint32Array[], budget: number) {
  let sum = 0;
  for (const t of totals) for (const n of t) sum += n;
  const share = sum <= budget ? 1 : (budget / sum) * 1.1;
  return totals.map((t) => Uint32Array.from(t, (n) => (share >= 1 ? n : Math.min(n, Math.ceil(n * share - 1e-6)))));
}

/** Buckets of the nearest-first order: by depth, log-spaced (a counting sort; nothing allocated) */
const Buckets = 256;

/** A unit's `cx` where it is a whole triangle (its every cell, its exact counts), not one cell of it */
export const WholeTriangle = 0x7fffffff;

/**
 * Whether a triangle is cut whole rather than by cells: under `WholeCells` cells of area, where its edge cells' dead
 * slots would outweigh its lipids (a cell's slots are a whole cell's)
 */
export const WholeCells = 8;

/** The triangles cut whole (`WholeCells`), per triangle its index among them or -1; degenerate ones neither (-2) */
export function wholeTriangles(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  regions: CutterRegions,
  box: readonly [number, number],
) {
  const T = indices.length / 3;
  const C = cellSide(box);
  const wholeOf = new Int32Array(T);
  const cut = emptyCut();
  let W = 0;
  for (let t = 0; t < T; ++t) {
    if (!triangleCut(positions, indices, t, regions, box, cut)) {
      wholeOf[t] = -2;
      continue;
    }
    const [x0, y0, x1, y1, x2, y2] = cut.corners;
    const area = Math.abs((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) / 2;
    wholeOf[t] = area < WholeCells * C * C ? W++ : -1;
  }
  return { wholeOf, count: W };
}

/** The inputs of a leaflet's selection: its triangles, regions and patch box, and its units' counts */
export interface SelectionInput {
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly regions: CutterRegions;
  readonly box: readonly [number, number];
  /** members */
  readonly members: number;
  /** per cell kind and member a whole cell's lipids (`kindCounts`: `k * M + m`) */
  readonly kinds: Uint32Array;
  /** per triangle its index among the whole ones, -1 cut by cells, -2 none (`wholeTriangles`) */
  readonly wholeOf: Int32Array;
  /** per member and whole triangle its lipids (`m * W + w`) */
  readonly wholeCounts: Uint32Array;
  /** the leaflet's side of its triangles: outer +1 (along their normal), inner -1 */
  readonly side: number;
}

/** A leaflet's selection: its units in view, nearest first within each member's capacity */
export interface LipidSelection {
  /** the selected units, 3 each: triangle, cell x, cell y (`WholeTriangle`: the triangle whole), `count` of them */
  readonly units: Int32Array;
  readonly count: number;
  /** the units in view at the last selection (taken or not) */
  readonly inView: number;
  /** the units a selection holds at most */
  readonly maxUnits: number;
  /** per member and selected unit its first slot: `bases[m * maxUnits + i]` */
  readonly bases: Uint32Array;
  /** per member its live slots (a cell's dead ones among them) */
  readonly live: Uint32Array;
  /** per member whether it is shown (hidden: none generated) */
  readonly shown: Uint8Array;
  /** advances where the selection changed */
  readonly version: number;
  /** the CPU's time of the last selection, ms */
  readonly ms: number;
  /** selects for a view; whether the selection changed */
  select: (
    cameraPlane: Plane3D,
    frustum: Frustum3D,
    depthScale: number,
    pixelSize: number,
    p: SelectionParams,
  ) => boolean;
  /** forgets the selection (a shown species changed, the params changed): the next view selects anew */
  reset: () => void;
}

/** a unit's key, ordered by triangle, then cell (`|cx|, |cy| < 2^15` Å / cell: past it a cell is skipped) */
const unitKey = (t: number, cx: number, cy: number) =>
  cx === WholeTriangle ? t * 4294967296 + 4294967295 : t * 4294967296 + (cx + 32768) * 65536 + (cy + 32768);

/**
 * Per triangle: ok, the region's map (ox, oy, cos, sin), the plane map q → world (b, Ax, Ay), its edges, its sphere, its
 * normal
 */
const Stride = 1 + 4 + 9 + 9 + 4 + 3;

/** The slots every unit takes, per member (`unitSlots`): the capacity of a membrane drawn whole. O(cells): small ones */
export function unitSlots(input: SelectionInput) {
  const M = input.members;
  const out = new Float64Array(M);
  const { wholeOf, wholeCounts, kinds } = input;
  const W = wholeCounts.length / Math.max(1, M);
  const C = cellSide(input.box);
  const cut = emptyCut();
  for (let t = 0, T = input.indices.length / 3; t < T; ++t) {
    if (wholeOf[t] >= 0) {
      for (let m = 0; m < M; ++m) out[m] += wholeCounts[m * W + wholeOf[t]];
      continue;
    }
    if (wholeOf[t] === -2 || !triangleCut(input.positions, input.indices, t, input.regions, input.box, cut)) continue;
    for (let cx = Math.floor(cut.pmin[0] / C); cx <= Math.floor(cut.pmax[0] / C); ++cx) {
      for (let cy = Math.floor(cut.pmin[1] / C); cy <= Math.floor(cut.pmax[1] / C); ++cy) {
        if (!cellMeets(cut, cx, cy, C)) continue;
        const k = cellEntry(cut.region, cx, cy);
        for (let m = 0; m < M; ++m) out[m] += kinds[k * M + m];
      }
    }
  }
  return out;
}

/** Whether cell (`cx`, `cy`) of a cut's region may hold a lipid of its triangle: its disc meets the triangle */
function cellMeets(
  cut: { corners: ArrayLike<number>; orient: number; ox: number; oy: number; cos: number; sin: number },
  cx: number,
  cy: number,
  C: number,
) {
  const px = (cx + 0.5) * C - cut.ox;
  const py = (cy + 0.5) * C - cut.oy;
  const qx = cut.cos * px + cut.sin * py;
  const qy = -cut.sin * px + cut.cos * py;
  const r = (C * Math.SQRT2) / 2;
  const c = cut.corners;
  for (let k = 0; k < 3; ++k) {
    const k1 = (k + 1) % 3;
    const ex = c[k1 * 2] - c[k * 2];
    const ey = c[k1 * 2 + 1] - c[k * 2 + 1];
    const d = (cut.orient * (ex * (qy - c[k * 2 + 1]) - ey * (qx - c[k * 2]))) / Math.hypot(ex, ey);
    if (d < -r) return false;
  }
  return true;
}

/**
 * Per member the slots a pool may need (`poolCapacities`' totals): every unit's (`unitSlots`) where the membrane is
 * about the budget or under (so it fits whole), else an estimate by area (its share is all that is read)
 */
export function slotTotals(input: SelectionInput, budget: number) {
  const M = input.members;
  const out = new Uint32Array(M);
  if (estimateLipids(input) <= 4 * budget) {
    const slots = unitSlots(input);
    for (let m = 0; m < M; ++m) out[m] = Math.min(slots[m], 0xffffffff);
    return out;
  }
  const { kinds } = input;
  const K = kinds.length / Math.max(1, M);
  let all = 0;
  for (let i = 0; i < kinds.length; ++i) all += kinds[i];
  const total = estimateLipids(input);
  for (let m = 0; m < M; ++m) {
    let n = 0;
    for (let k = 0; k < K; ++k) n += kinds[k * M + m];
    out[m] = Math.min(Math.ceil((total * n) / Math.max(1, all)), 0xffffffff);
  }
  return out;
}

/**
 * The lipids a leaflet's cut holds, about (exact for its whole triangles, its cells' by area and the kinds' mean): the
 * membrane's count without a pass over its lipids
 */
export function estimateLipids(input: SelectionInput) {
  const M = input.members;
  const { wholeOf, wholeCounts, kinds } = input;
  const W = wholeCounts.length / Math.max(1, M);
  let mean = 0;
  for (let i = 0; i < kinds.length; ++i) mean += kinds[i];
  mean /= Math.max(1, kinds.length / Math.max(1, M));
  const C = cellSide(input.box);
  const cut = emptyCut();
  let sum = 0;
  for (let t = 0, T = input.indices.length / 3; t < T; ++t) {
    if (wholeOf[t] >= 0) {
      for (let m = 0; m < M; ++m) sum += wholeCounts[m * W + wholeOf[t]];
    } else if (wholeOf[t] === -1 && triangleCut(input.positions, input.indices, t, input.regions, input.box, cut)) {
      const [x0, y0, x1, y1, x2, y2] = cut.corners;
      sum += ((Math.abs((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) / 2) * mean) / (C * C);
    }
  }
  return Math.round(sum);
}

/** The apex of a perspective frustum (its right, left and bottom planes' point) in `out`; false for orthographic */
function apex(frustum: Frustum3D, out: Float64Array) {
  const a = frustum[0].normal;
  const b = frustum[1].normal;
  const c = frustum[2].normal;
  const da = -frustum[0].constant;
  const db = -frustum[1].constant;
  const dc = -frustum[2].constant;
  // Cramer: x = (da (b × c) + db (c × a) + dc (a × b)) / (a · (b × c))
  const bcx = b[1] * c[2] - b[2] * c[1];
  const bcy = b[2] * c[0] - b[0] * c[2];
  const bcz = b[0] * c[1] - b[1] * c[0];
  const det = a[0] * bcx + a[1] * bcy + a[2] * bcz;
  if (Math.abs(det) < 1e-9) return false;
  const cax = c[1] * a[2] - c[2] * a[1];
  const cay = c[2] * a[0] - c[0] * a[2];
  const caz = c[0] * a[1] - c[1] * a[0];
  const abx = a[1] * b[2] - a[2] * b[1];
  const aby = a[2] * b[0] - a[0] * b[2];
  const abz = a[0] * b[1] - a[1] * b[0];
  out[0] = (da * bcx + db * cax + dc * abx) / det;
  out[1] = (da * bcy + db * cay + dc * aby) / det;
  out[2] = (da * bcz + db * caz + dc * abz) / det;
  return true;
}

/**
 * The selection of a leaflet's cut (`input`) within each member's `capacity`: per view the triangles in view, nearest
 * first; a whole one a unit, a large one's cells within the frustum and the distance where a lipid is large enough on
 * screen (its plane clipped by them, then its cells' spheres tested), each a unit. CPU time O(units in view)
 */
export function createLipidSelection(input: SelectionInput, capacity: Uint32Array): LipidSelection {
  const { positions, indices, regions, box, kinds, wholeOf, wholeCounts } = input;
  const T = indices.length / 3;
  const M = capacity.length;
  const W = wholeCounts.length / Math.max(1, M);
  const C = cellSide(box);
  const cellR = (C * Math.SQRT2) / 2;
  // the units a selection holds at most: the capacity over the lightest kind's lipids (a cell takes its kind's slots)
  let lightest = Infinity;
  for (let k = 0; k < kinds.length / Math.max(1, M); ++k) {
    let n = 0;
    for (let m = 0; m < M; ++m) n += kinds[k * M + m];
    if (n > 0) lightest = Math.min(lightest, n);
  }
  let room = 0;
  for (let m = 0; m < M; ++m) room += capacity[m];
  const maxUnits = Math.max(64, Math.min(T + Math.ceil(room / (Number.isFinite(lightest) ? lightest : 1)), 1 << 22));
  // candidates past this are dropped (the triangles come nearest first): a wide view's reach, not the capacity
  const maxCandidates = Math.max(maxUnits * 4, 1 << 18);

  // per triangle (`Stride`): its cut's maps, edges and sphere, once
  const tri = new Float64Array(T * Stride);
  const cut = emptyCut();
  for (let t = 0; t < T; ++t) {
    const o = t * Stride;
    if (wholeOf[t] === -2 || !triangleCut(positions, indices, t, regions, box, cut)) continue;
    tri[o] = 1;
    tri[o + 1] = cut.ox;
    tri[o + 2] = cut.oy;
    tri[o + 3] = cut.cos;
    tri[o + 4] = cut.sin;
    // w(q) = o + qx e1 + qy e2 lifted along rn onto the triangle (`hitAffine`): b + qx Ax + qy Ay
    const an = (cut.a[0] - cut.o[0]) * cut.n[0] + (cut.a[1] - cut.o[1]) * cut.n[1] + (cut.a[2] - cut.o[2]) * cut.n[2];
    const e1n = cut.e1[0] * cut.n[0] + cut.e1[1] * cut.n[1] + cut.e1[2] * cut.n[2];
    const e2n = cut.e2[0] * cut.n[0] + cut.e2[1] * cut.n[1] + cut.e2[2] * cut.n[2];
    for (let k = 0; k < 3; ++k) {
      tri[o + 5 + k] = cut.o[k] + (an / cut.dn) * cut.rn[k];
      tri[o + 8 + k] = cut.e1[k] - (e1n / cut.dn) * cut.rn[k];
      tri[o + 11 + k] = cut.e2[k] - (e2n / cut.dn) * cut.rn[k];
    }
    // edges, inward unit normals in q: d = nx qx + ny qy + c ≥ 0 inside
    const c = cut.corners;
    for (let k = 0; k < 3; ++k) {
      const k1 = (k + 1) % 3;
      const ex = c[k1 * 2] - c[k * 2];
      const ey = c[k1 * 2 + 1] - c[k * 2 + 1];
      const l = Math.hypot(ex, ey);
      const nx = (-cut.orient * ey) / l;
      const ny = (cut.orient * ex) / l;
      tri[o + 14 + k * 3] = nx;
      tri[o + 15 + k * 3] = ny;
      tri[o + 16 + k * 3] = -(nx * c[k * 2] + ny * c[k * 2 + 1]);
    }
    // the sphere: the corners' centroid, the farthest corner
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; ++k) {
      const v = indices[t * 3 + k] * 3;
      cx += positions[v] / 3;
      cy += positions[v + 1] / 3;
      cz += positions[v + 2] / 3;
    }
    let r = 0;
    for (let k = 0; k < 3; ++k) {
      const v = indices[t * 3 + k] * 3;
      r = Math.max(r, Math.hypot(positions[v] - cx, positions[v + 1] - cy, positions[v + 2] - cz));
    }
    tri[o + 23] = cx;
    tri[o + 24] = cy;
    tri[o + 25] = cz;
    tri[o + 26] = r;
    tri[o + 27] = cut.n[0];
    tri[o + 28] = cut.n[1];
    tri[o + 29] = cut.n[2];
  }
  const side = input.side;
  // the camera's position (the apex of a perspective frustum's side planes), or none (orthographic: its direction)
  const eye = new Float64Array(3);

  // the state of a selection, preallocated: candidates (key, depth, kind), their order, the units taken
  const candKey = new Float64Array(maxCandidates);
  const candDepth = new Float32Array(maxCandidates);
  const candBucket = new Uint8Array(maxCandidates);
  const bucketStart = new Uint32Array(Buckets + 1);
  const order = new Uint32Array(maxCandidates);
  const triOrder = new Uint32Array(T);
  const triDepth = new Float32Array(T);
  const triBucket = new Uint8Array(T);
  const triList = new Uint32Array(T);
  const next = new Float64Array(maxUnits);
  let taken = new Float64Array(maxUnits);
  let takenCount = 0;
  let spare = new Float64Array(maxUnits);
  const units = new Int32Array(maxUnits * 3);
  const bases = new Uint32Array(M * maxUnits);
  const live = new Uint32Array(M);
  const used = new Float64Array(M);
  const shown = new Uint8Array(M).fill(1);
  // the clip of a triangle's plane, q (two buffers of up to 3 + 7 corners)
  let polyA = new Float64Array(24);
  let polyB = new Float64Array(24);
  let count = 0;
  let version = 0;
  let visible = 0;
  let ms = 0;
  let forced = false;

  const wasTaken = (key: number) => {
    let lo = 0;
    let hi = takenCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = taken[mid];
      if (v === key) return true;
      if (v < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };

  const outside = (frustum: Frustum3D, x: number, y: number, z: number, r: number) => {
    for (let i = 0; i < 6; ++i) {
      const { normal: n, constant } = frustum[i as 0];
      if (n[0] * x + n[1] * y + n[2] * z + constant < -r) return true;
    }
    return false;
  };

  /** clips the polygon (`n` corners in `polyA`) by a x + b y + c ≥ 0; its new corner count (in `polyA`) */
  const clip = (n: number, a: number, b: number, c: number) => {
    let k = 0;
    for (let i = 0; i < n; ++i) {
      const j = (i + 1) % n;
      const xi = polyA[i * 2];
      const yi = polyA[i * 2 + 1];
      const xj = polyA[j * 2];
      const yj = polyA[j * 2 + 1];
      const di = a * xi + b * yi + c;
      const dj = a * xj + b * yj + c;
      if (di >= 0) {
        polyB[k * 2] = xi;
        polyB[k * 2 + 1] = yi;
        k += 1;
      }
      if (di >= 0 !== dj >= 0) {
        const f = di / (di - dj);
        polyB[k * 2] = xi + f * (xj - xi);
        polyB[k * 2 + 1] = yi + f * (yj - yi);
        k += 1;
      }
    }
    const swap = polyA;
    polyA = polyB;
    polyB = swap;
    return k;
  };

  function select(cameraPlane: Plane3D, frustum: Frustum3D, depthScale: number, pixelSize: number, p: SelectionParams) {
    const t0 = performance.now();
    const cn = cameraPlane.normal;
    const cc = cameraPlane.constant;
    // a lipid's size on screen at depth d: D / (depthScale d) (perspective), D / pixelSize (orthographic)
    const px = (d: number) =>
      depthScale > 0
        ? p.lipidSize / (depthScale * Math.max(d, 1e-3))
        : pixelSize > 0
          ? p.lipidSize / pixelSize
          : Infinity;
    // the leaflet facing the camera: its side of a point w by eye − w (perspective) or −view direction (orthographic)
    const facing = p.facing ?? 0;
    const perspective = facing > 0 && apex(frustum, eye);
    const towards = (o: number, x: number, y: number, z: number) =>
      side *
      (perspective
        ? tri[o + 27] * (eye[0] - x) + tri[o + 28] * (eye[1] - y) + tri[o + 29] * (eye[2] - z)
        : -(tri[o + 27] * cn[0] + tri[o + 28] * cn[1] + tri[o + 29] * cn[2]) * 1e6);
    // the farthest depth a unit not taken (taken) may start at
    const depthFor = (enter: number) =>
      depthScale > 0 ? p.lipidSize / (depthScale * Math.max(enter, 1e-9)) : Infinity;
    const reach = depthFor(p.enterPx * p.keep);
    // the triangles in view, nearest first
    let nt = 0;
    let far = 1;
    for (let t = 0; t < T; ++t) {
      const o = t * Stride;
      if (tri[o] === 0) continue;
      const x = tri[o + 23];
      const y = tri[o + 24];
      const z = tri[o + 25];
      // a large triangle's cells reach past it by a cell's disc; a whole one's sphere is its own
      const r = tri[o + 26] + (wholeOf[t] >= 0 ? 0 : cellR);
      if (outside(frustum, x, y, z, r)) continue;
      const d = Math.max(cn[0] * x + cn[1] * y + cn[2] * z + cc - r, 1e-3);
      if (px(d) < p.enterPx * p.keep) continue;
      if (facing > 0) {
        // all three corners turned away: the plane is linear in them
        let most = -Infinity;
        for (let c = 0; c < 3; ++c) {
          const v = indices[t * 3 + c] * 3;
          most = Math.max(most, towards(o, positions[v], positions[v + 1], positions[v + 2]));
        }
        if (most < -facing) continue;
      }
      triList[nt++] = t;
      triDepth[t] = d;
      if (d > far) far = d;
    }
    let scale = (Buckets - 1) / Math.log2(far + 1);
    bucketStart.fill(0);
    for (let i = 0; i < nt; ++i) {
      const t = triList[i];
      const b = Math.min(Buckets - 1, Math.floor(Math.log2(triDepth[t] + 1) * scale));
      triBucket[t] = b;
      bucketStart[b + 1] += 1;
    }
    for (let b = 0; b < Buckets; ++b) bucketStart[b + 1] += bucketStart[b];
    for (let i = 0; i < nt; ++i) {
      const t = triList[i];
      triOrder[bucketStart[triBucket[t]]++] = t;
    }
    // the units: a whole triangle, or the cells of a large one's plane in the frustum and in reach
    let n = 0;
    visible = 0;
    far = 1;
    const consider = (key: number, d: number) => {
      visible += 1;
      if (px(d) < p.enterPx * (wasTaken(key) ? p.keep : 1)) return;
      if (n >= maxCandidates) return;
      candKey[n] = key;
      candDepth[n] = d;
      n += 1;
      if (d > far) far = d;
    };
    for (let i = 0; i < nt && n < maxCandidates; ++i) {
      const t = triOrder[i];
      const o = t * Stride;
      if (wholeOf[t] >= 0) {
        consider(unitKey(t, WholeTriangle, 0), triDepth[t]);
        continue;
      }
      // its plane: q → world b + qx Ax + qy Ay; a cell's sphere in world (the lift stretches q by up to 2)
      const bx = tri[o + 5];
      const by = tri[o + 6];
      const bz = tri[o + 7];
      const ax = tri[o + 8];
      const ay = tri[o + 9];
      const az = tri[o + 10];
      const vx = tri[o + 11];
      const vy = tri[o + 12];
      const vz = tri[o + 13];
      // the map's largest stretch (σ of its Gram matrix): a cell's disc in q, a sphere in world, a lipid's length more
      const aa = ax * ax + ay * ay + az * az;
      const ab = ax * vx + ay * vy + az * vz;
      const bb = vx * vx + vy * vy + vz * vz;
      const stretch = Math.sqrt((aa + bb) / 2 + Math.sqrt(((aa - bb) / 2) ** 2 + ab * ab));
      const rw = cellR * stretch + p.lipidSize * 4;
      // the triangle in q, clipped by the frustum's planes and the reach (each moved out by a cell's sphere)
      const triangleIndex = t * 3;
      let k = 3;
      for (let c = 0; c < 3; ++c) {
        const v = indices[triangleIndex + c] * 3;
        const dx = positions[v] - tri[o + 5];
        const dy = positions[v + 1] - tri[o + 6];
        const dz = positions[v + 2] - tri[o + 7];
        // the corner's q: least squares on the plane map (exact: the corner is on it)
        const ra = ax * dx + ay * dy + az * dz;
        const rb = vx * dx + vy * dy + vz * dz;
        const det = aa * bb - ab * ab;
        polyA[c * 2] = (ra * bb - rb * ab) / det;
        polyA[c * 2 + 1] = (rb * aa - ra * ab) / det;
      }
      for (let f = 0; f < 7 && k > 0; ++f) {
        if (f < 6) {
          const { normal: fn, constant } = frustum[f as 0];
          const a = fn[0] * ax + fn[1] * ay + fn[2] * az;
          const b = fn[0] * vx + fn[1] * vy + fn[2] * vz;
          k = clip(k, a, b, fn[0] * bx + fn[1] * by + fn[2] * bz + constant + rw);
        } else if (Number.isFinite(reach)) {
          const a = -(cn[0] * ax + cn[1] * ay + cn[2] * az);
          const b = -(cn[0] * vx + cn[1] * vy + cn[2] * vz);
          k = clip(k, a, b, reach + rw - (cn[0] * bx + cn[1] * by + cn[2] * bz + cc));
        }
      }
      if (k === 0) continue;
      // its cells: the clipped polygon's bounds in the patch's plane (p = off + Rz(θ) q)
      const ox = tri[o + 1];
      const oy = tri[o + 2];
      const cos = tri[o + 3];
      const sin = tri[o + 4];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let c = 0; c < k; ++c) {
        const qx = polyA[c * 2];
        const qy = polyA[c * 2 + 1];
        const pxp = ox + cos * qx - sin * qy;
        const pyp = oy + sin * qx + cos * qy;
        x0 = Math.min(x0, pxp);
        y0 = Math.min(y0, pyp);
        x1 = Math.max(x1, pxp);
        y1 = Math.max(y1, pyp);
      }
      const cx0 = Math.floor((x0 - cellR) / C);
      const cx1 = Math.floor((x1 + cellR) / C);
      const cy0 = Math.floor((y0 - cellR) / C);
      const cy1 = Math.floor((y1 + cellR) / C);
      for (let cx = cx0; cx <= cx1 && n < maxCandidates; ++cx) {
        if (cx <= -32768 || cx >= 32767) continue;
        for (let cy = cy0; cy <= cy1; ++cy) {
          if (cy <= -32768 || cy >= 32767) continue;
          const ux = (cx + 0.5) * C - ox;
          const uy = (cy + 0.5) * C - oy;
          const qx = cos * ux + sin * uy;
          const qy = -sin * ux + cos * uy;
          // the cell's disc meets the triangle
          if (
            tri[o + 14] * qx + tri[o + 15] * qy + tri[o + 16] < -cellR ||
            tri[o + 17] * qx + tri[o + 18] * qy + tri[o + 19] < -cellR ||
            tri[o + 20] * qx + tri[o + 21] * qy + tri[o + 22] < -cellR
          )
            continue;
          const wx = bx + qx * ax + qy * vx;
          const wy = by + qx * ay + qy * vy;
          const wz = bz + qx * az + qy * vz;
          if (outside(frustum, wx, wy, wz, rw)) continue;
          if (facing > 0 && towards(o, wx, wy, wz) < -facing - rw) continue;
          consider(unitKey(t, cx, cy), Math.max(cn[0] * wx + cn[1] * wy + cn[2] * wz + cc - rw, 1e-3));
        }
      }
    }
    // nearest first: a counting sort by log depth
    bucketStart.fill(0);
    scale = (Buckets - 1) / Math.log2(far + 1);
    for (let i = 0; i < n; ++i) {
      const b = Math.min(Buckets - 1, Math.floor(Math.log2(candDepth[i] + 1) * scale));
      candBucket[i] = b;
      bucketStart[b + 1] += 1;
    }
    for (let b = 0; b < Buckets; ++b) bucketStart[b + 1] += bucketStart[b];
    for (let i = 0; i < n; ++i) order[bucketStart[candBucket[i]]++] = i;
    // within each member's capacity, nearest first; the first that does not fit ends the selection
    used.fill(0);
    let k = 0;
    for (let i = 0; i < n && k < maxUnits; ++i) {
      const key = candKey[order[i]];
      const t = Math.floor(key / 4294967296);
      const low = key - t * 4294967296;
      let fits = true;
      if (low === 4294967295) {
        const w = wholeOf[t];
        for (let m = 0; m < M && fits; ++m) if (shown[m]) fits = used[m] + wholeCounts[m * W + w] <= capacity[m];
        if (!fits) break;
        for (let m = 0; m < M; ++m) if (shown[m]) used[m] += wholeCounts[m * W + w];
      } else {
        const kind = cellEntry(regions.regionOf[t], Math.floor(low / 65536) - 32768, (low % 65536) - 32768) * M;
        for (let m = 0; m < M && fits; ++m) if (shown[m]) fits = used[m] + kinds[kind + m] <= capacity[m];
        if (!fits) break;
        for (let m = 0; m < M; ++m) if (shown[m]) used[m] += kinds[kind + m];
      }
      next[k++] = key;
    }
    // in key order: slots the same for the same set
    const list = next.subarray(0, k).sort();
    let same = k === takenCount && version > 0 && !forced;
    for (let i = 0; i < k && same; ++i) same = list[i] === taken[i];
    ms = performance.now() - t0;
    if (same) return false;
    forced = false;
    const swap = taken;
    taken = spare;
    spare = swap;
    taken.set(list);
    takenCount = k;
    count = k;
    for (let m = 0; m < M; ++m) live[m] = 0;
    for (let i = 0; i < count; ++i) {
      const key = taken[i];
      const t = Math.floor(key / 4294967296);
      const low = key - t * 4294967296;
      units[i * 3] = t;
      if (low === 4294967295) {
        units[i * 3 + 1] = WholeTriangle;
        units[i * 3 + 2] = 0;
        const w = wholeOf[t];
        for (let m = 0; m < M; ++m) {
          bases[m * maxUnits + i] = live[m];
          if (shown[m]) live[m] += wholeCounts[m * W + w];
        }
      } else {
        const cx = Math.floor(low / 65536) - 32768;
        const cy = (low % 65536) - 32768;
        units[i * 3 + 1] = cx;
        units[i * 3 + 2] = cy;
        const kind = cellEntry(regions.regionOf[t], cx, cy) * M;
        for (let m = 0; m < M; ++m) {
          bases[m * maxUnits + i] = live[m];
          if (shown[m]) live[m] += kinds[kind + m];
        }
      }
    }
    version += 1;
    ms = performance.now() - t0;
    return true;
  }

  return {
    units,
    get count() {
      return count;
    },
    get inView() {
      return visible;
    },
    maxUnits,
    bases,
    live,
    shown,
    get version() {
      return version;
    },
    get ms() {
      return ms;
    },
    select,
    reset: () => {
      // the version goes on (a writer's uploads are keyed by it: review nit)
      takenCount = 0;
      count = 0;
      forced = true;
    },
  };
}
