/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { type CutterRegions, regionKey } from './cutter.js';
import type { TriMesh } from './remesh.js';
import { triangleTree } from './triangle-tree.js';

// A cut leaflet's shell band (lipid-procedural round 8 §2; Ludo, 2026-11-09: "the best lipid wrapper capable of scaling
// up to human cell size"): the far surface's triangles where a lipid is between the middle look's px, per view, drawn
// as N shells (an instance each). Only those triangles: the cost is the screen's, not the cell's (a whole far surface ×
// N was hundreds of ms on the yeast cell). Grow-only arrays, a preallocated stack: nothing allocated a view.

/** The band's triangles at most (its groups, the band's regions, as many: the object's marker texture sized once) */
export const BandCap = 65536;

/** A patch surface (`patchSurface`): three vertices a triangle, its region its group, its vertices' shifts */
export interface BandSource {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly shifts: Float32Array;
}

export interface ShellBand {
  /** the band's triangles, by the far surface's */
  readonly count: number;
  /** the arrays, `count` triangles written (grow-only: their length the capacity) */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly groups: Float32Array;
  readonly indices: Uint32Array;
  /** the band's regions (16 floats each, renumbered, each with its key as `patchTableArray`), then the cells, then the shifts */
  readonly table: Float32Array;
  /** the cells' first texel in `table` (`uPatch.w`) */
  readonly cellsTexel: number;
  /** written since the last view (a version: the object's upload) */
  readonly version: number;
  /**
   * The triangles in `frustum` where a lipid of `size` Å is from `loPx` to `hiPx` px (the far surface's lipid px: size
   * over depth × `depthScale`, or `pixelSize` orthographic); written when they changed. True when they did
   */
  select(
    cameraPlane: Plane3D,
    frustum: Frustum3D,
    depthScale: number,
    pixelSize: number,
    loPx: number,
    hiPx: number,
  ): boolean;
}

/** The patch table's width (`MeshSchema.tPatchTable`: rows of 1,024 texels) */
const TableWidth = 1024;

export function createShellBand(mesh: TriMesh, regions: CutterRegions, source: BandSource, size: number): ShellBand {
  const tree = triangleTree(mesh.positions, mesh.indices);
  const { spheres, a: childA, b: childB, leaf, order, roots } = tree;
  const p = mesh.positions;
  const ix = mesh.indices;
  const stack = new Int32Array(256);
  // the triangles chosen this view and the last
  let chosen = new Uint32Array(1024);
  let last = new Uint32Array(1024);
  let lastCount = -1;
  // per region its band index (-1: none), the regions used
  const regionMap = new Int32Array(regions.count).fill(-1);
  const used = new Int32Array(BandCap);
  const cells = regions.cells;
  let capacity = 0;
  const band = {
    count: 0,
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    groups: new Float32Array(0),
    indices: new Uint32Array(0),
    table: new Float32Array(0),
    cellsTexel: 0,
    version: 0,
    select,
  };

  function grow(n: number) {
    if (n <= capacity) return;
    capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(n)));
    band.positions = new Float32Array(capacity * 9);
    band.normals = new Float32Array(capacity * 9);
    band.groups = new Float32Array(capacity * 3);
    band.indices = new Uint32Array(capacity * 3);
    for (let i = 0; i < capacity * 3; ++i) band.indices[i] = i;
    // the regions (as many as triangles at most), the 4,096 cells, two shifts a texel
    const texels = capacity * 4 + cells.length / 4 + Math.ceil((capacity * 6) / 4);
    band.table = new Float32Array(TableWidth * Math.ceil(texels / TableWidth) * 4);
  }

  function select(
    cameraPlane: Plane3D,
    frustum: Frustum3D,
    depthScale: number,
    pixelSize: number,
    loPx: number,
    hiPx: number,
  ) {
    const cn = cameraPlane.normal;
    const cc = cameraPlane.constant;
    // the depths where a lipid is hiPx (nearest) and loPx (farthest); orthographic: all or none
    const flat = depthScale > 0 ? 0 : pixelSize > 0 ? size / pixelSize : Infinity;
    const near = depthScale > 0 ? size / (depthScale * hiPx) : flat >= loPx && flat < hiPx ? 0 : Infinity;
    const far =
      depthScale > 0 ? size / (depthScale * Math.max(loPx, 1e-9)) : flat >= loPx && flat < hiPx ? Infinity : -1;
    let n = 0;
    if (roots[0] >= 0 && far > near) {
      let top = 0;
      stack[top++] = roots[0];
      while (top > 0) {
        const node = stack[--top];
        const o = node * 4;
        const r = spheres[o + 3];
        let culled = false;
        for (let f = 0; f < 6 && !culled; ++f) {
          const { normal: fn, constant } = frustum[f as 0];
          culled = fn[0] * spheres[o] + fn[1] * spheres[o + 1] + fn[2] * spheres[o + 2] + constant < -r;
        }
        if (culled) continue;
        const d = cn[0] * spheres[o] + cn[1] * spheres[o + 1] + cn[2] * spheres[o + 2] + cc;
        if (d - r > far || d + r < near) continue;
        if (!leaf[node]) {
          if (top + 2 > stack.length) continue;
          stack[top++] = childA[node];
          stack[top++] = childB[node];
          continue;
        }
        for (let li = childA[node]; li < childB[node] && n < BandCap; ++li) {
          const t = order[li];
          // the triangle's depths: its corners'
          let lo = Infinity;
          let hi = -Infinity;
          for (let c = 0; c < 3; ++c) {
            const v = ix[t * 3 + c] * 3;
            const dv = cn[0] * p[v] + cn[1] * p[v + 1] + cn[2] * p[v + 2] + cc;
            if (dv < lo) lo = dv;
            if (dv > hi) hi = dv;
          }
          if (lo > far || hi < near) continue;
          if (n >= chosen.length) {
            const next = new Uint32Array(chosen.length * 2);
            next.set(chosen);
            chosen = next;
          }
          chosen[n++] = t;
        }
      }
    }
    // the same triangles as the last view: nothing written
    if (n === lastCount) {
      let same = true;
      for (let i = 0; i < n && same; ++i) same = chosen[i] === last[i];
      if (same) return false;
    }
    write(n);
    [chosen, last] = [last, chosen];
    lastCount = n;
    return true;
  }

  function write(n: number) {
    grow(n);
    const { positions, normals, groups, table } = band;
    const rt = regions.table;
    let regionCount = 0;
    for (let i = 0; i < n; ++i) {
      const t = chosen[i];
      const r = regions.regionOf[t];
      let g = regionMap[r];
      if (g < 0) {
        g = regionMap[r] = regionCount;
        used[regionCount++] = r;
        table.set(rt.subarray(r * 16, r * 16 + 16), g * 16);
        table[g * 16 + 12] = regionKey(regions, r);
      }
      positions.set(source.positions.subarray(t * 9, t * 9 + 9), i * 9);
      normals.set(source.normals.subarray(t * 9, t * 9 + 9), i * 9);
      groups[i * 3] = groups[i * 3 + 1] = groups[i * 3 + 2] = g;
    }
    for (let k = 0; k < regionCount; ++k) regionMap[used[k]] = -1;
    // the cells after the regions, then the shifts (`patchShift`: after the cells, `uPatch.w` the cells' first texel)
    const cellsAt = regionCount * 16;
    table.set(cells, cellsAt);
    const shiftsAt = cellsAt + cells.length;
    for (let i = 0; i < n; ++i) {
      const t = chosen[i];
      table.set(source.shifts.subarray(t * 6, t * 6 + 6), shiftsAt + i * 6);
    }
    band.count = n;
    band.cellsTexel = regionCount * 4;
    band.version += 1;
  }

  return band;
}
