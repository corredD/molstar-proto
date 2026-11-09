/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type CutterRegions, type CutterTable, cellEntry, cellSide } from './cutter.js';
import type { TriMesh } from './remesh.js';

// A membrane's far look (lipid-procedural round 4b; Ludo, 2026-11-08: "the bump should be colored like the spheres
// [...] the texture should be there as well, not below"): a surface a leaflet at its heads' plane, the mesh subdivided
// to about two lipid spacings, each vertex the species of the patch's nearest head where the cutter maps it (its
// triangle's region: plane, spin and offset), so the far look is the near look blurred. Built once a look, pure.

/**
 * A leaflet's head plane: the lowest of its conformers' outermost atoms' z (+ outer, − inner), Å. Every lipid's head at
 * or above it: drawn beneath the lipids (Both), it hides none close up (the gate, 2026-11-08: at the tops' mean it hid
 * 23 of the CHARMM-GUI patch's 40 outer conformers); 5.6 Å under that mean there, still at the heads
 */
export function headOffset(table: CutterTable, side: 'outer' | 'inner') {
  const f = side === 'outer' ? 1 : -1;
  let floor = Infinity;
  for (const m of table.members) {
    let top = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) top = Math.max(top, f * m.positions[i]);
    floor = Math.min(floor, top);
  }
  return table.members.length ? f * floor : 0;
}

/** The patch's nearest shown head on a grid (`cell` Å), a species index a cell (-1: none shown) */
function headGrid(table: CutterTable, shown: (species: number) => boolean, cell: number) {
  const [bx, by] = table.box;
  const nx = Math.max(1, Math.ceil(bx / cell));
  const ny = Math.max(1, Math.ceil(by / cell));
  const grid = new Int32Array(nx * ny).fill(-1);
  const heads: number[] = [];
  for (let m = 0; m < table.members.length; ++m) {
    const s = table.members[m].species;
    if (!shown(s)) continue;
    for (let l = table.memberStart[m]; l < table.memberStart[m + 1]; ++l) {
      heads.push(table.lipids[l * 4], table.lipids[l * 4 + 1], s);
    }
  }
  for (let j = 0; j < ny; ++j) {
    for (let i = 0; i < nx; ++i) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      let best = Infinity;
      for (let h = 0; h < heads.length; h += 3) {
        // periodic: the nearest image
        let dx = Math.abs(heads[h] - x) % bx;
        let dy = Math.abs(heads[h + 1] - y) % by;
        dx = Math.min(dx, bx - dx);
        dy = Math.min(dy, by - dy);
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          grid[j * nx + i] = heads[h + 2];
        }
      }
    }
  }
  return { grid, nx, ny, cell };
}

export interface FarSurface {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** per vertex its species (in the table), -1 where none is shown */
  readonly species: Int32Array;
}

/**
 * A leaflet's far surface over `mesh`, offset by `offset` along the mesh's vertex normals, facing `side`'s way (the inner
 * one's winding flipped), its triangles about `spacing` Å, at most about `maxVertices` vertices (the spacing grows past it)
 */
export function farSurface(
  mesh: TriMesh,
  regions: CutterRegions,
  table: CutterTable,
  side: 'outer' | 'inner',
  offset: number,
  shown: (species: number) => boolean,
  spacing: number,
  maxVertices = 1_000_000,
): FarSurface {
  const p = mesh.positions;
  const ix = mesh.indices;
  const T = ix.length / 3;
  // the mesh's vertex normals (area-weighted)
  const vn = new Float32Array(p.length);
  let area = 0;
  for (let t = 0; t < T; ++t) {
    const a = ix[t * 3] * 3;
    const b = ix[t * 3 + 1] * 3;
    const c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    for (const v of [a, b, c]) {
      vn[v] += nx;
      vn[v + 1] += ny;
      vn[v + 2] += nz;
    }
  }
  for (let v = 0; v < vn.length; v += 3) {
    const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2]) || 1;
    vn[v] /= l;
    vn[v + 1] /= l;
    vn[v + 2] /= l;
  }
  // the spacing such that the subdivided vertices stay under the cap (about area / (0.43 s²) of them)
  const s = Math.max(spacing, Math.sqrt(area / (0.43 * maxVertices)));
  const g = headGrid(table, shown, Math.max(1, spacing / 4));
  const [bx, by] = table.box;
  const pos: number[] = [];
  const nor: number[] = [];
  const ind: number[] = [];
  const spe: number[] = [];
  const rg = regions.table;
  const cells = regions.cells;
  const cellC = cellSide(table.box);
  for (let t = 0; t < T; ++t) {
    const ia = ix[t * 3] * 3;
    const ib = ix[t * 3 + 1] * 3;
    const ic = ix[t * 3 + 2] * 3;
    const edge = Math.max(
      Math.hypot(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]),
      Math.hypot(p[ic] - p[ib], p[ic + 1] - p[ib + 1], p[ic + 2] - p[ib + 2]),
      Math.hypot(p[ia] - p[ic], p[ia + 1] - p[ic + 1], p[ia + 2] - p[ic + 2]),
    );
    const n = Math.max(1, Math.ceil(edge / s));
    const r = regions.regionOf[t] * 16;
    const base = pos.length / 3;
    // vertex (i, j), i + j ≤ n, at barycentric (1 - u - v, u, v)
    for (let j = 0; j <= n; ++j) {
      for (let i = 0; i <= n - j; ++i) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        let nx = w * vn[ia] + u * vn[ib] + v * vn[ic];
        let ny = w * vn[ia + 1] + u * vn[ib + 1] + v * vn[ic + 1];
        let nz = w * vn[ia + 2] + u * vn[ib + 2] + v * vn[ic + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const x = w * p[ia] + u * p[ib] + v * p[ic];
        const y = w * p[ia + 1] + u * p[ib + 1] + v * p[ic + 1];
        const z = w * p[ia + 2] + u * p[ib + 2] + v * p[ic + 2];
        pos.push(x + nx * offset, y + ny * offset, z + nz * offset);
        const f = side === 'outer' ? 1 : -1;
        nor.push(nx * f, ny * f, nz * f);
        // where the cutter puts this point in the patch: the region's frame, turned and moved (`triangleCut`), then its
        // cell's spin and offset (`eachHit`)
        const dx = x - rg[r];
        const dy = y - rg[r + 1];
        const dz = z - rg[r + 2];
        const qx = dx * rg[r + 4] + dy * rg[r + 5] + dz * rg[r + 6];
        const qy = dx * rg[r + 8] + dy * rg[r + 9] + dz * rg[r + 10];
        const c = rg[r + 11];
        const sn = rg[r + 15];
        const px = c * qx - sn * qy + rg[r + 3] * bx;
        const py = sn * qx + c * qy + rg[r + 7] * by;
        const cx = Math.floor(px / cellC);
        const cy = Math.floor(py / cellC);
        const e = cellEntry(regions.regionOf[t], cx, cy) * 4;
        const rx = px - (cx + 0.5) * cellC;
        const ry = py - (cy + 0.5) * cellC;
        const ec = cells[e + 2];
        const es = cells[e + 3];
        const hx = (((cells[e] * bx + ec * rx - es * ry) % bx) + bx) % bx;
        const hy = (((cells[e + 1] * by + es * rx + ec * ry) % by) + by) % by;
        const ci = Math.min(g.nx - 1, Math.floor(hx / g.cell));
        const cj = Math.min(g.ny - 1, Math.floor(hy / g.cell));
        spe.push(g.grid[cj * g.nx + ci]);
      }
    }
    const at = (i: number, j: number) => base + j * (n + 1) - (j * (j - 1)) / 2 + i;
    for (let j = 0; j < n; ++j) {
      for (let i = 0; i < n - j; ++i) {
        const tri = [at(i, j), at(i + 1, j), at(i, j + 1)];
        if (side === 'inner') tri.reverse();
        ind.push(...tri);
        if (i + j < n - 1) {
          const q = [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
          if (side === 'inner') q.reverse();
          ind.push(...q);
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    indices: new Uint32Array(ind),
    species: Int32Array.from(spe),
  };
}
