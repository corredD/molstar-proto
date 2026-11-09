/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { random01 } from './assign.js';
import type { Leaflet } from './patch.js';

// The cookie cutter, cellPACKgpu's way (`PopulateLipids.compute`, `LipidWrapper1` and `CopyBuffer`; lipids.md §1),
// improved: on the mesh's own triangles (no remesh), each triangle flattened in its frame, turned by a random spin and
// moved to a random place of the periodic patch (cellPACKgpu computes both and never uses them: every triangle cut the
// same disc), takes the patch's lipids whose headgroup falls inside it, per leaflet (its atoms' z from the bilayer's
// center along the normal). No clash removal across triangles (as cellPACKgpu). The TypeScript reference of
// `cutter-kernel.ts`: the same function per triangle, the order of its hits the kernel's.
//
// A lipid is an instance of a conformer of its species (a member of the merged object): up to `conformers` of the
// patch's own lipids per species, each patch lipid drawn as the conformer of its index, turned to its azimuth and put at
// its headgroup. Why not a member per patch lipid (cellPACKgpu's residue): about 700 members a leaflet, each a render
// object, its textures and its indirect records at every level; conformers keep the members near the tiles' (~50).

/** A leaflet's patch as the cutter reads it: members (conformers) and, by member, the lipids they draw */
export interface CutterTable {
  /** the leaflet's species names, a member's species its index here */
  readonly species: readonly string[];
  /** per member: its species, and its atoms relative to its headgroup (z from the bilayer's center) */
  readonly members: readonly { readonly species: number; readonly positions: Float32Array }[];
  /** the patch's lipids by member: member m's are `memberStart[m]` to `memberStart[m + 1]` */
  readonly memberStart: Uint32Array;
  /** per lipid (by member): its headgroup's x and y in the box, cos and sin of its turn from its conformer */
  readonly lipids: Float32Array;
  readonly box: readonly [number, number];
}

/** The lipids' in-plane direction: from the headgroup to the mean of its atoms, radians */
function azimuth(leaflet: Leaflet, l: number) {
  const h = leaflet.lipidHead[l] * 3;
  const p = leaflet.positions;
  let x = 0;
  let y = 0;
  for (let a = leaflet.lipidAtomStart[l]; a < leaflet.lipidAtomStart[l + 1]; ++a) {
    x += p[a * 3] - p[h];
    y += p[a * 3 + 1] - p[h + 1];
  }
  return Math.atan2(y, x);
}

/** The cutter's table of a leaflet: `conformers` members a species at most, O(lipids) */
export function cutterTable(leaflet: Leaflet, conformers = 4): CutterTable {
  const n = leaflet.lipidSpecies.length;
  const bySpecies: number[][] = leaflet.species.map(() => []);
  for (let l = 0; l < n; ++l) bySpecies[leaflet.lipidSpecies[l]].push(l);
  const members: { species: number; positions: Float32Array }[] = [];
  const memberOf = new Uint32Array(n);
  const templateAzimuth: number[] = [];
  for (let s = 0; s < bySpecies.length; ++s) {
    const list = bySpecies[s];
    const k = Math.min(conformers, list.length);
    for (let c = 0; c < k; ++c) {
      const t = list[Math.floor((c * list.length) / k)];
      const h = leaflet.lipidHead[t] * 3;
      const start = leaflet.lipidAtomStart[t];
      const end = leaflet.lipidAtomStart[t + 1];
      const positions = new Float32Array((end - start) * 3);
      for (let a = start; a < end; ++a) {
        positions[(a - start) * 3] = leaflet.positions[a * 3] - leaflet.positions[h];
        positions[(a - start) * 3 + 1] = leaflet.positions[a * 3 + 1] - leaflet.positions[h + 1];
        positions[(a - start) * 3 + 2] = leaflet.positions[a * 3 + 2] + leaflet.offset;
      }
      templateAzimuth.push(azimuth(leaflet, t));
      members.push({ species: s, positions });
    }
    for (let i = 0; i < list.length; ++i) memberOf[list[i]] = members.length - k + (i % k);
  }
  const memberStart = new Uint32Array(members.length + 1);
  for (let l = 0; l < n; ++l) memberStart[memberOf[l] + 1] += 1;
  for (let m = 0; m < members.length; ++m) memberStart[m + 1] += memberStart[m];
  const fill = memberStart.slice(0, members.length);
  const lipids = new Float32Array(n * 4);
  for (let l = 0; l < n; ++l) {
    const m = memberOf[l];
    const o = fill[m]++ * 4;
    const h = leaflet.lipidHead[l] * 3;
    const turn = azimuth(leaflet, l) - templateAzimuth[m];
    lipids[o] = leaflet.positions[h];
    lipids[o + 1] = leaflet.positions[h + 1];
    lipids[o + 2] = Math.cos(turn);
    lipids[o + 3] = Math.sin(turn);
  }
  return { species: leaflet.species, members, memberStart, lipids, box: leaflet.box };
}

/** A triangle's cut: its frame (center, e1, e2, normal), its corners in the frame, its spin and offset in the patch */
export interface TriangleCut {
  cx: number;
  cy: number;
  cz: number;
  e1: [number, number, number];
  e2: [number, number, number];
  n: [number, number, number];
  /** corners in the frame: x0, y0, x1, y1, x2, y2 */
  corners: [number, number, number, number, number, number];
  radius: number;
  cos: number;
  sin: number;
  ox: number;
  oy: number;
}

/** Triangle `t`'s cut (`cutter-kernel.ts`: the same in WGSL); false for a degenerate triangle */
export function triangleCut(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  t: number,
  seed: number,
  box: readonly [number, number],
  out: TriangleCut,
) {
  const a = indices[t * 3] * 3;
  const b = indices[t * 3 + 1] * 3;
  const c = indices[t * 3 + 2] * 3;
  const p = positions;
  const cx = (p[a] + p[b] + p[c]) / 3;
  const cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
  const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  const ux = p[b] - p[a];
  const uy = p[b + 1] - p[a + 1];
  const uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a];
  const vy = p[c + 1] - p[a + 1];
  const vz = p[c + 2] - p[a + 2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz);
  let ex = p[a] - cx;
  let ey = p[a + 1] - cy;
  let ez = p[a + 2] - cz;
  const el = Math.hypot(ex, ey, ez);
  if (nl === 0 || el === 0) return false;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  ex /= el;
  ey /= el;
  ez /= el;
  out.cx = cx;
  out.cy = cy;
  out.cz = cz;
  out.n = [nx, ny, nz];
  out.e1 = [ex, ey, ez];
  out.e2 = [ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex];
  let radius = 0;
  for (let k = 0; k < 3; ++k) {
    const i = [a, b, c][k];
    const dx = p[i] - cx;
    const dy = p[i + 1] - cy;
    const dz = p[i + 2] - cz;
    const x = dx * out.e1[0] + dy * out.e1[1] + dz * out.e1[2];
    const y = dx * out.e2[0] + dy * out.e2[1] + dz * out.e2[2];
    out.corners[k * 2] = x;
    out.corners[k * 2 + 1] = y;
    radius = Math.max(radius, Math.hypot(x, y));
  }
  out.radius = radius;
  const theta = 2 * Math.PI * random01(seed, t * 3);
  out.cos = Math.cos(theta);
  out.sin = Math.sin(theta);
  out.ox = random01(seed, t * 3 + 1) * box[0];
  out.oy = random01(seed, t * 3 + 2) * box[1];
  return true;
}

export function emptyCut(): TriangleCut {
  return {
    cx: 0,
    cy: 0,
    cz: 0,
    e1: [0, 0, 0],
    e2: [0, 0, 0],
    n: [0, 0, 0],
    corners: [0, 0, 0, 0, 0, 0],
    radius: 0,
    cos: 1,
    sin: 0,
    ox: 0,
    oy: 0,
  };
}

/**
 * Each hit of member `m`'s lipids in a triangle's cut, in the kernel's order (lipids, then images by x, then y): `hit`
 * gets the lipid (by member) and its point in the triangle's frame
 */
export function eachHit(
  table: CutterTable,
  cut: TriangleCut,
  m: number,
  hit: (lipid: number, x: number, y: number) => void,
) {
  const [bx, by] = table.box;
  const [x0, y0, x1, y1, x2, y2] = cut.corners;
  const r = cut.radius;
  for (let l = table.memberStart[m]; l < table.memberStart[m + 1]; ++l) {
    const hx = table.lipids[l * 4];
    const hy = table.lipids[l * 4 + 1];
    const i0 = Math.ceil((cut.ox - r - hx) / bx);
    const i1 = Math.floor((cut.ox + r - hx) / bx);
    const j0 = Math.ceil((cut.oy - r - hy) / by);
    const j1 = Math.floor((cut.oy + r - hy) / by);
    for (let i = i0; i <= i1; ++i) {
      for (let j = j0; j <= j1; ++j) {
        // patch → triangle: q = Rz(−θ)(p − o)
        const px = hx + i * bx - cut.ox;
        const py = hy + j * by - cut.oy;
        const qx = cut.cos * px + cut.sin * py;
        const qy = -cut.sin * px + cut.cos * py;
        if (
          (x1 - x0) * (qy - y0) - (y1 - y0) * (qx - x0) >= 0 &&
          (x2 - x1) * (qy - y1) - (y2 - y1) * (qx - x1) >= 0 &&
          (x0 - x2) * (qy - y2) - (y0 - y2) * (qx - x2) >= 0
        ) {
          hit(l, qx, qy);
        }
      }
    }
  }
}

/** A hit's affine (16 floats, column-major at `o`): its conformer's atoms turned to the lipid's azimuth, then the spin */
export function hitAffine(
  table: CutterTable,
  cut: TriangleCut,
  lipid: number,
  qx: number,
  qy: number,
  out: Float32Array,
  o: number,
) {
  // the turn in the triangle's frame: Rz(Δ − θ)
  const dc = table.lipids[lipid * 4 + 2];
  const ds = table.lipids[lipid * 4 + 3];
  const c = dc * cut.cos + ds * cut.sin;
  const s = ds * cut.cos - dc * cut.sin;
  const { e1, e2, n } = cut;
  for (let k = 0; k < 3; ++k) {
    out[o + k] = c * e1[k] + s * e2[k];
    out[o + 4 + k] = -s * e1[k] + c * e2[k];
    out[o + 8 + k] = n[k];
  }
  out[o + 3] = 0;
  out[o + 7] = 0;
  out[o + 11] = 0;
  out[o + 12] = cut.cx + qx * e1[0] + qy * e2[0];
  out[o + 13] = cut.cy + qx * e1[1] + qy * e2[1];
  out[o + 14] = cut.cz + qx * e1[2] + qy * e2[2];
  out[o + 15] = 1;
}

/** The cutter's counts on the CPU (the kernel's count pass): per member, per triangle (`m * T + t`) */
export function cutterCounts(table: CutterTable, positions: Float32Array, indices: Uint32Array, seed: number) {
  const T = indices.length / 3;
  const M = table.members.length;
  const counts = new Uint32Array(M * T);
  const cut = emptyCut();
  let k = 0;
  const count = () => {
    k += 1;
  };
  for (let t = 0; t < T; ++t) {
    if (!triangleCut(positions, indices, t, seed, table.box, cut)) continue;
    for (let m = 0; m < M; ++m) {
      k = 0;
      eachHit(table, cut, m, count);
      counts[m * T + t] = k;
    }
  }
  return counts;
}

/** Per member its instance count, and per (member, triangle) its first instance among the member's (exclusive sums) */
export function cutterBases(counts: Uint32Array, members: number) {
  const T = counts.length / Math.max(1, members);
  const bases = new Uint32Array(counts.length);
  const totals = new Uint32Array(members);
  for (let m = 0; m < members; ++m) {
    let sum = 0;
    for (let t = 0; t < T; ++t) {
      bases[m * T + t] = sum;
      sum += counts[m * T + t];
    }
    totals[m] = sum;
  }
  return { bases, totals };
}

/** The reference of the write pass: member `m`'s instances' affines (16 floats each), in the kernel's order */
export function cutterReference(
  table: CutterTable,
  positions: Float32Array,
  indices: Uint32Array,
  seed: number,
  m: number,
  total: number,
) {
  const out = new Float32Array(total * 16);
  const cut = emptyCut();
  let k = 0;
  for (let t = 0, T = indices.length / 3; t < T; ++t) {
    if (!triangleCut(positions, indices, t, seed, table.box, cut)) continue;
    eachHit(table, cut, m, (l, x, y) => hitAffine(table, cut, l, x, y, out, k++ * 16));
  }
  return out;
}
