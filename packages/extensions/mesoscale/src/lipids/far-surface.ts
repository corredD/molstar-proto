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

/**
 * The patch's nearest shown head on a grid (`cell` Å), a species index a cell (-1: none shown): the heads bucketed (about
 * two a bucket), each cell searching rings of buckets outward until no nearer head can be (review N1: a scan of every
 * head for every cell grew as the patch's area squared)
 */
function headGrid(table: CutterTable, shown: (species: number) => boolean, cell: number) {
  const [bx, by] = table.box;
  const nx = Math.max(1, Math.ceil(bx / cell));
  const ny = Math.max(1, Math.ceil(by / cell));
  const grid = new Int32Array(nx * ny).fill(-1);
  let count = 0;
  for (let m = 0; m < table.members.length; ++m) {
    if (shown(table.members[m].species)) count += table.memberStart[m + 1] - table.memberStart[m];
  }
  if (count === 0) return { grid, nx, ny, cell };
  const size = Math.max(cell, Math.sqrt((2 * bx * by) / count));
  const kx = Math.max(1, Math.floor(bx / size));
  const ky = Math.max(1, Math.floor(by / size));
  const sx = bx / kx;
  const sy = by / ky;
  // heads by bucket (a counting sort): x, y, species
  const start = new Uint32Array(kx * ky + 1);
  const bucketOf = (x: number, y: number) =>
    Math.min(ky - 1, Math.max(0, Math.floor(y / sy))) * kx + Math.min(kx - 1, Math.max(0, Math.floor(x / sx)));
  const eachShown = (f: (x: number, y: number, s: number) => void) => {
    for (let m = 0; m < table.members.length; ++m) {
      const s = table.members[m].species;
      if (!shown(s)) continue;
      for (let l = table.memberStart[m]; l < table.memberStart[m + 1]; ++l)
        f(table.lipids[l * 4], table.lipids[l * 4 + 1], s);
    }
  };
  eachShown((x, y) => {
    start[bucketOf(x, y) + 1] += 1;
  });
  for (let b = 0; b < kx * ky; ++b) start[b + 1] += start[b];
  const fill = start.slice(0, kx * ky);
  const heads = new Float32Array(count * 3);
  eachShown((x, y, s) => {
    const o = fill[bucketOf(x, y)]++ * 3;
    heads[o] = x;
    heads[o + 1] = y;
    heads[o + 2] = s;
  });
  const rings = Math.ceil(Math.max(kx, ky) / 2) + 1;
  for (let j = 0; j < ny; ++j) {
    for (let i = 0; i < nx; ++i) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      const cx = Math.min(kx - 1, Math.floor(x / sx));
      const cy = Math.min(ky - 1, Math.floor(y / sy));
      let best = Infinity;
      for (let r = 0; r <= rings; ++r) {
        for (let v = -r; v <= r; ++v) {
          for (let u = -r; u <= r; ++u) {
            // ring r only: its border buckets
            if (Math.abs(u) !== r && Math.abs(v) !== r) continue;
            const b = ((((cy + v) % ky) + ky) % ky) * kx + ((((cx + u) % kx) + kx) % kx);
            for (let h = start[b] * 3; h < start[b + 1] * 3; h += 3) {
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
        // the next ring's buckets lie at least r buckets away
        const reach = r * Math.min(sx, sy);
        if (best <= reach * reach) break;
      }
    }
  }
  return { grid, nx, ny, cell };
}

/**
 * What the spheres draw where the far surface takes over (round 4c item 7): per member the atoms of the level drawn at
 * the switch (as `members[m].positions`: about its head, z from the bilayer's center), each sphere's radius, Å
 */
export interface SwitchSpheres {
  readonly atoms: readonly Float32Array[];
  readonly radius: number;
}

/**
 * The patch seen from its leaflet's side as `top` draws it (round 4c item 7: the spheres near the switch show the
 * species whose heads stand highest, a CHARMM-GUI patch's DSM 73 % at the coarsest level for its 13 % of the heads):
 * each cell of `g` the species of the highest sphere over it, periodic; a cell no sphere covers keeps its nearest head.
 * Returns the mean height of the spheres' tops over the cells they cover (from the bilayer's center, out of the
 * leaflet). O(lipids × level atoms × a sphere's cells)
 */
function topGrid(
  table: CutterTable,
  shown: (species: number) => boolean,
  side: 'outer' | 'inner',
  g: { grid: Int32Array; nx: number; ny: number; cell: number },
  top: SwitchSpheres,
) {
  const { grid, nx, ny, cell } = g;
  const height = new Float32Array(nx * ny).fill(-Infinity);
  const f = side === 'outer' ? 1 : -1;
  const r = top.radius;
  for (let m = 0; m < table.members.length; ++m) {
    const species = table.members[m].species;
    const atoms = top.atoms[m];
    if (!shown(species) || !atoms) continue;
    for (let l = table.memberStart[m]; l < table.memberStart[m + 1]; ++l) {
      const hx = table.lipids[l * 4];
      const hy = table.lipids[l * 4 + 1];
      const c = table.lipids[l * 4 + 2];
      const s = table.lipids[l * 4 + 3];
      for (let a = 0; a < atoms.length; a += 3) {
        const x = hx + c * atoms[a] - s * atoms[a + 1];
        const y = hy + s * atoms[a] + c * atoms[a + 1];
        const z = f * atoms[a + 2];
        for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); ++j) {
          const dy = (j + 0.5) * cell - y;
          for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); ++i) {
            const dx = (i + 0.5) * cell - x;
            const d = r * r - dx * dx - dy * dy;
            if (d < 0) continue;
            const k = (((j % ny) + ny) % ny) * nx + (((i % nx) + nx) % nx);
            const h = z + Math.sqrt(d);
            if (h > height[k]) {
              height[k] = h;
              grid[k] = species;
            }
          }
        }
      }
    }
  }
  let sum = 0;
  let n = 0;
  for (const h of height) {
    if (h === -Infinity) continue;
    sum += h;
    n += 1;
  }
  return n > 0 ? sum / n : undefined;
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
 * one's winding flipped): each triangle split in n × n, one n for the whole mesh and each edge's points shared by its two
 * triangles (welded: no crack at a crease, review S6), n from the mean edge over `spacing` and lowered until at most
 * `maxVertices` vertices (review S1; the mesh's own vertices at n = 1). A vertex on a shared edge or corner takes the
 * colour its first triangle maps it to. With `top` (a cut leaflet's switch, round 4c item 7) the surface takes over
 * from those spheres: each vertex the species they show there from above (`topGrid`), and the surface at their tops'
 * mean height in place of `offset` (no step where the spheres stop: the app's outline and shadows drew one as a line)
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
  top?: SwitchSpheres,
): FarSurface {
  const p = mesh.positions;
  const ix = mesh.indices;
  const T = ix.length / 3;
  const V = p.length / 3;
  // the mesh's vertex normals (area-weighted), its edges (each once, by its lower vertex), the mean edge
  const vn = new Float32Array(p.length);
  const edgeIds = new Map<number, number>();
  let edgeSum = 0;
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
    for (let k = 0; k < 3; ++k) {
      const v = ix[t * 3 + k] * 3;
      vn[v] += nx;
      vn[v + 1] += ny;
      vn[v + 2] += nz;
      const w = ix[t * 3 + ((k + 1) % 3)];
      const key = edgeKey(ix[t * 3 + k], w, V);
      if (!edgeIds.has(key)) {
        edgeIds.set(key, edgeIds.size);
        const o = w * 3;
        edgeSum += Math.hypot(p[o] - p[v], p[o + 1] - p[v + 1], p[o + 2] - p[v + 2]);
      }
    }
  }
  for (let v = 0; v < vn.length; v += 3) {
    const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2]) || 1;
    vn[v] /= l;
    vn[v + 1] /= l;
    vn[v + 2] /= l;
  }
  const E = edgeIds.size;
  const vertices = (n: number) => V + E * (n - 1) + (T * (n - 1) * (n - 2)) / 2;
  let n = Math.max(1, Math.round(edgeSum / Math.max(1, E) / spacing));
  while (n > 1 && vertices(n) > maxVertices) n -= 1;
  const count = vertices(n);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const species = new Int32Array(count);
  const made = new Uint8Array(count);
  const indices = new Uint32Array(T * n * n * 3);
  const g = headGrid(table, shown, Math.max(1, spacing / 4));
  const height = top ? topGrid(table, shown, side, g, top) : undefined;
  const lift = height !== undefined ? (side === 'outer' ? 1 : -1) * height : offset;
  const [bx, by] = table.box;
  const rg = regions.table;
  const cells = regions.cells;
  const cellC = cellSide(table.box);
  const f = side === 'outer' ? 1 : -1;
  const interior = V + E * (n - 1);
  const ids = new Uint32Array(((n + 1) * (n + 2)) / 2);
  let written = 0;
  for (let t = 0; t < T; ++t) {
    const corner = [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]];
    const ia = corner[0] * 3;
    const ib = corner[1] * 3;
    const ic = corner[2] * 3;
    const r = regions.regionOf[t] * 16;
    // vertex (i, j), i + j ≤ n, at barycentric (1 − u − v, u, v): its id, shared on the edges and corners
    let at = 0;
    for (let j = 0; j <= n; ++j) {
      for (let i = 0; i <= n - j; ++i, ++at) {
        const k = n - i - j;
        let id: number;
        if (i === 0 && j === 0) id = corner[0];
        else if (i === n) id = corner[1];
        else if (j === n) id = corner[2];
        else if (j === 0) id = edgePoint(edgeIds, corner[0], corner[1], i, n, V);
        else if (i === 0) id = edgePoint(edgeIds, corner[0], corner[2], j, n, V);
        else if (k === 0) id = edgePoint(edgeIds, corner[1], corner[2], j, n, V);
        else id = interior + t * (((n - 1) * (n - 2)) / 2) + interiorIndex(i, j, n);
        ids[at] = id;
        if (made[id]) continue;
        made[id] = 1;
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
        positions[id * 3] = x + nx * lift;
        positions[id * 3 + 1] = y + ny * lift;
        positions[id * 3 + 2] = z + nz * lift;
        normals[id * 3] = nx * f;
        normals[id * 3 + 1] = ny * f;
        normals[id * 3 + 2] = nz * f;
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
        const gi = Math.min(g.nx - 1, Math.floor(hx / g.cell));
        const gj = Math.min(g.ny - 1, Math.floor(hy / g.cell));
        species[id] = g.grid[gj * g.nx + gi];
      }
    }
    const local = (i: number, j: number) => ids[j * (n + 1) - (j * (j - 1)) / 2 + i];
    for (let j = 0; j < n; ++j) {
      for (let i = 0; i < n - j; ++i) {
        written = tri(indices, written, local(i, j), local(i + 1, j), local(i, j + 1), side);
        if (i + j < n - 1) written = tri(indices, written, local(i + 1, j), local(i + 1, j + 1), local(i, j + 1), side);
      }
    }
  }
  return { positions, normals, indices, species };
}

/** An undirected edge's key: its vertices, the lower first */
function edgeKey(a: number, b: number, V: number) {
  return a < b ? a * V + b : b * V + a;
}

/** The `k`-th of `n` points along edge (a, b) from a: its id among the edges' points, counted from the lower vertex */
function edgePoint(edges: Map<number, number>, a: number, b: number, k: number, n: number, V: number) {
  const e = edges.get(edgeKey(a, b, V))!;
  return V + e * (n - 1) + (a < b ? k : n - k) - 1;
}

/** An interior vertex (i, j) of a triangle split in n × n, its index among the (n − 1)(n − 2) / 2 */
function interiorIndex(i: number, j: number, n: number) {
  // rows j = 1 .. n − 2, each i = 1 .. n − 1 − j: the rows before j hold Σ (n − 1 − r), r < j
  return (j - 1) * (n - 1) - ((j - 1) * j) / 2 + i - 1;
}

/** A triangle into `out` at `o`, wound out of its leaflet (the inner one's flipped) */
function tri(out: Uint32Array, o: number, a: number, b: number, c: number, side: 'outer' | 'inner') {
  out[o] = a;
  out[o + 1] = side === 'inner' ? c : b;
  out[o + 2] = side === 'inner' ? b : c;
  return o + 3;
}
