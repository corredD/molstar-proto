/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';

// A membrane made per view (lipid-procedural, its progress file's design): the cutter's lipids only on the triangles in
// view whose lipids are large enough on screen, nearest first within a pool of fixed capacity a member. The counts per
// (member, triangle) do not depend on the view (the cutter's count pass, read back once at the wrap), so each member's
// live count and each selected triangle's first slot are exact on the CPU: the GPU only writes the hits. Pure; nothing
// allocated per view.

/** How the far membrane looks: the lipids' sphere levels, the textured surface, or both (the levels, then the surface) */
export type MembraneFar = 'spheres' | 'texture' | 'both';

/** What a view selects by: a lipid's size on screen to take a triangle at (`enterPx`), kept down to `keep` of it */
export interface SelectionParams {
  /** a lipid's size, Å (the patch's spacing) */
  readonly lipidSize: number;
  readonly enterPx: number;
  /** hysteresis: a triangle taken stays down to `enterPx * keep` */
  readonly keep: number;
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

/** A leaflet's selection: its triangles' spheres, their regions' and the pool's accounting */
export interface LipidSelection {
  /** the selected triangles, in triangle order, `count` of them */
  readonly selected: Uint32Array;
  readonly count: number;
  /** per member and selected triangle its first slot: `bases[m * T + i]` */
  readonly bases: Uint32Array;
  /** per member its live lipids */
  readonly live: Uint32Array;
  /** per member whether it is shown (hidden: none generated) */
  readonly shown: Uint8Array;
  /** advances where the selection changed */
  readonly version: number;
  /** selects for a view; whether the selection changed */
  select: (
    cameraPlane: Plane3D,
    frustum: Frustum3D,
    depthScale: number,
    pixelSize: number,
    p: SelectionParams,
  ) => boolean;
  /** the triangle and the hit index (in the triangle's order of member `m`) of member `m`'s slot, or false */
  lipidAt: (m: number, slot: number, out: { triangle: number; index: number }) => boolean;
  /** forgets the selection (a shown species changed, the params changed): the next view selects anew */
  reset: () => void;
}

/**
 * The selection of a leaflet cut from `positions`, `indices` (its triangles grouped by `regionOf`), with the cutter's
 * `counts` (`m * T + t`) and each member's `capacity`
 */
export function createLipidSelection(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  regionOf: ArrayLike<number>,
  regionCount: number,
  counts: Uint32Array,
  capacity: Uint32Array,
): LipidSelection {
  const T = indices.length / 3;
  const M = capacity.length;
  // the triangles' spheres (the centroid, the farthest corner) and their regions' (the triangles by region)
  const spheres = new Float32Array(T * 4);
  const regionStart = new Uint32Array(regionCount + 1);
  for (let t = 0; t < T; ++t) {
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
    spheres.set([cx, cy, cz, r], t * 4);
    regionStart[regionOf[t] + 1] += 1;
  }
  for (let g = 0; g < regionCount; ++g) regionStart[g + 1] += regionStart[g];
  const regionTriangles = new Uint32Array(T);
  const fill = regionStart.slice(0, regionCount);
  for (let t = 0; t < T; ++t) regionTriangles[fill[regionOf[t]]++] = t;
  const regionSpheres = new Float32Array(regionCount * 4);
  for (let g = 0; g < regionCount; ++g) {
    const a = regionStart[g];
    const b = regionStart[g + 1];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = a; i < b; ++i) {
      const o = regionTriangles[i] * 4;
      cx += spheres[o] / (b - a);
      cy += spheres[o + 1] / (b - a);
      cz += spheres[o + 2] / (b - a);
    }
    let r = 0;
    for (let i = a; i < b; ++i) {
      const o = regionTriangles[i] * 4;
      r = Math.max(r, Math.hypot(spheres[o] - cx, spheres[o + 1] - cy, spheres[o + 2] - cz) + spheres[o + 3]);
    }
    regionSpheres.set([cx, cy, cz, r], g * 4);
  }

  // the triangles' totals over the shown members, and the state of a selection
  const taken = new Uint8Array(T);
  const next = new Uint8Array(T);
  const candidates = new Uint32Array(T);
  const bucketOf = new Uint8Array(T);
  const depth = new Float32Array(T);
  const bucketStart = new Uint32Array(Buckets + 1);
  const order = new Uint32Array(T);
  const selected = new Uint32Array(T);
  const bases = new Uint32Array(M * T);
  const live = new Uint32Array(M);
  const used = new Uint32Array(M);
  const shown = new Uint8Array(M).fill(1);
  let count = 0;
  let version = 0;

  const outside = (frustum: Frustum3D, x: number, y: number, z: number, r: number) => {
    for (let i = 0; i < 6; ++i) {
      const { normal: n, constant } = frustum[i as 0];
      if (n[0] * x + n[1] * y + n[2] * z + constant < -r) return true;
    }
    return false;
  };

  function select(cameraPlane: Plane3D, frustum: Frustum3D, depthScale: number, pixelSize: number, p: SelectionParams) {
    const cn = cameraPlane.normal;
    const cc = cameraPlane.constant;
    // a lipid's size on screen at depth d: D / (depthScale d) (perspective), D / pixelSize (orthographic)
    const px = (d: number) =>
      depthScale > 0
        ? p.lipidSize / (depthScale * Math.max(d, 1e-3))
        : pixelSize > 0
          ? p.lipidSize / pixelSize
          : Infinity;
    let n = 0;
    let far = 1;
    for (let g = 0; g < regionCount; ++g) {
      const o = g * 4;
      if (outside(frustum, regionSpheres[o], regionSpheres[o + 1], regionSpheres[o + 2], regionSpheres[o + 3]))
        continue;
      for (let i = regionStart[g]; i < regionStart[g + 1]; ++i) {
        const t = regionTriangles[i];
        const q = t * 4;
        const x = spheres[q];
        const y = spheres[q + 1];
        const z = spheres[q + 2];
        const r = spheres[q + 3];
        if (outside(frustum, x, y, z, r)) continue;
        const d = Math.max(cn[0] * x + cn[1] * y + cn[2] * z + cc - r, 1e-3);
        if (px(d) < p.enterPx * (taken[t] ? p.keep : 1)) continue;
        candidates[n++] = t;
        depth[t] = d;
        if (d > far) far = d;
      }
    }
    // nearest first: a counting sort by log depth
    bucketStart.fill(0);
    const scale = (Buckets - 1) / Math.log2(far + 1);
    for (let i = 0; i < n; ++i) {
      const t = candidates[i];
      const b = Math.min(Buckets - 1, Math.floor(Math.log2(depth[t] + 1) * scale));
      bucketOf[t] = b;
      bucketStart[b + 1] += 1;
    }
    for (let b = 0; b < Buckets; ++b) bucketStart[b + 1] += bucketStart[b];
    for (let i = 0; i < n; ++i) {
      const t = candidates[i];
      order[bucketStart[bucketOf[t]]++] = t;
    }
    // within each member's capacity, nearest first; the first that does not fit ends the selection
    next.fill(0);
    used.fill(0);
    for (let i = 0; i < n; ++i) {
      const t = order[i];
      let fits = true;
      for (let m = 0; m < M && fits; ++m) if (shown[m]) fits = used[m] + counts[m * T + t] <= capacity[m];
      if (!fits) break;
      for (let m = 0; m < M; ++m) if (shown[m]) used[m] += counts[m * T + t];
      next[t] = 1;
    }
    // in triangle order: slots the same for the same set
    let changed = false;
    for (let t = 0; t < T; ++t) {
      if (next[t] !== taken[t]) {
        changed = true;
        break;
      }
    }
    if (!changed && version > 0) return false;
    taken.set(next);
    count = 0;
    for (let t = 0; t < T; ++t) if (taken[t]) selected[count++] = t;
    for (let m = 0; m < M; ++m) {
      let sum = 0;
      for (let i = 0; i < count; ++i) {
        bases[m * T + i] = sum;
        if (shown[m]) sum += counts[m * T + selected[i]];
      }
      live[m] = sum;
    }
    version += 1;
    return true;
  }

  return {
    selected,
    get count() {
      return count;
    },
    bases,
    live,
    shown,
    get version() {
      return version;
    },
    select,
    lipidAt: (m, slot, out) => {
      if (m < 0 || m >= M || slot < 0 || slot >= live[m]) return false;
      // the last selected triangle whose first slot is at most `slot`
      let lo = 0;
      let hi = count - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bases[m * T + mid] <= slot) lo = mid;
        else hi = mid - 1;
      }
      out.triangle = selected[lo];
      out.index = slot - bases[m * T + lo];
      return true;
    },
    reset: () => {
      taken.fill(0);
      version = 0;
    },
  };
}
