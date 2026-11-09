/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { hashU32, random01 } from './assign.js';
import type { Leaflet } from './patch.js';

// The cookie cutter, cellPACKgpu's way (`PopulateLipids.compute`, `LipidWrapper1` and `CopyBuffer`; lipids.md §1),
// improved: on the mesh's own triangles (no remesh), by regions of the surface (`CutterRegions`): a region's plane turned
// by a random spin and moved to a random place of the periodic patch (cellPACKgpu computes both per triangle and never
// uses them: every triangle cut the same disc), each triangle taking the patch's lipids whose headgroup projects inside
// it, per leaflet (its atoms' z from the bilayer's center along the normal). No clash removal at region borders (as
// cellPACKgpu at every edge). A pure function of the triangle, its region and the patch: the TypeScript reference of
// `cutter-kernel.ts`, the order of its hits the kernel's.
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

/**
 * The regions of a mesh (Ludo, 2026-11-08: each triangle its own random offset left star-shaped holes and clashes, every
 * lipid an island on triangles smaller than a lipid). A region: the triangles whose centroid falls in one cell of
 * `RegionCell` Å and whose normal in one of 96 directions (a cube's faces, 4 × 4 each: a tilt from the region's plane
 * under about 16°, the lipids' density on a triangle the patch's times its cosine). A region cuts the patch once: one
 * plane (its triangles' area-weighted mean), one spin and offset (a hash of the region's key and the seed); each of its
 * triangles keeps the lipids whose headgroup projects inside it, so the patch's packing goes on across its triangles'
 * edges and seams lie only at region borders. Made on the CPU once a mesh, read by the reference and the kernel alike
 * (the same Float32 table: no region decided twice in two precisions).
 */
export interface CutterRegions {
  /** per triangle its region */
  readonly regionOf: Uint32Array;
  /** per region 16 floats: origin and spin's offset x (fraction of the box), e1 and offset y, e2 and cos, normal and sin */
  readonly table: Float32Array;
  readonly count: number;
}

/** A region's cell, Å: about two patch boxes, a few hundred lipids a leaflet (round 4's procedural unit) */
export const RegionCell = 200;

/** The normal's direction bin: a cube face (6) and a 4 × 4 cell of it */
function directionBin(nx: number, ny: number, nz: number) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = nx >= 0 ? 0 : 1;
    u = ny / ax;
    v = nz / ax;
  } else if (ay >= az) {
    face = ny >= 0 ? 2 : 3;
    u = nx / ay;
    v = nz / ay;
  } else {
    face = nz >= 0 ? 4 : 5;
    u = nx / az;
    v = ny / az;
  }
  const bu = Math.min(3, Math.floor((u + 1) * 2));
  const bv = Math.min(3, Math.floor((v + 1) * 2));
  return face * 16 + bu * 4 + bv;
}

/** The regions of a mesh (`CutterRegions`): O(triangles), deterministic in the mesh and `seed` */
export function cutterRegions(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  seed: number,
  cell = RegionCell,
): CutterRegions {
  const T = indices.length / 3;
  const regionOf = new Uint32Array(T);
  const byKey = new Map<number, number>();
  const keys: number[] = [];
  // per region: area-weighted normal (3), area-weighted centroid (3), area
  const sums: number[] = [];
  const p = positions;
  for (let t = 0; t < T; ++t) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3;
    const cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    const bin = area > 0 ? directionBin(nx, ny, nz) : 0;
    // 15 bits a cell coordinate (± 0.33 mm at 200 Å), 7 the bin: exact in a double
    const key =
      ((Math.floor(cx / cell) + 16384) * 32768 + (Math.floor(cy / cell) + 16384)) * 32768 * 128 +
      (Math.floor(cz / cell) + 16384) * 128 +
      bin;
    let r = byKey.get(key);
    if (r === undefined) {
      r = keys.length;
      byKey.set(key, r);
      keys.push(key);
      sums.push(0, 0, 0, 0, 0, 0, 0);
    }
    regionOf[t] = r;
    const o = r * 7;
    sums[o] += nx / 2;
    sums[o + 1] += ny / 2;
    sums[o + 2] += nz / 2;
    sums[o + 3] += cx * area;
    sums[o + 4] += cy * area;
    sums[o + 5] += cz * area;
    sums[o + 6] += area;
  }
  const n = keys.length;
  const table = new Float32Array(n * 16);
  for (let r = 0; r < n; ++r) {
    const o = r * 7;
    let nx = sums[o];
    let ny = sums[o + 1];
    let nz = sums[o + 2];
    let nl = Math.hypot(nx, ny, nz);
    if (nl === 0) {
      nx = 0;
      ny = 0;
      nz = 1;
      nl = 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const area = sums[o + 6] || 1;
    // e1: the normal crossed with the axis least along it
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const [hx, hy, hz] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
    let ex = ny * hz - nz * hy;
    let ey = nz * hx - nx * hz;
    let ez = nx * hy - ny * hx;
    const el = Math.hypot(ex, ey, ez);
    ex /= el;
    ey /= el;
    ez /= el;
    const h = hashU32((keys[r] % 4294967296) ^ hashU32(Math.floor(keys[r] / 4294967296)));
    const theta = 2 * Math.PI * random01(seed, h * 3);
    const t = r * 16;
    table[t] = sums[o + 3] / area;
    table[t + 1] = sums[o + 4] / area;
    table[t + 2] = sums[o + 5] / area;
    table[t + 3] = random01(seed, h * 3 + 1);
    table[t + 4] = ex;
    table[t + 5] = ey;
    table[t + 6] = ez;
    table[t + 7] = random01(seed, h * 3 + 2);
    table[t + 8] = ny * ez - nz * ey;
    table[t + 9] = nz * ex - nx * ez;
    table[t + 10] = nx * ey - ny * ex;
    table[t + 11] = Math.cos(theta);
    table[t + 12] = nx;
    table[t + 13] = ny;
    table[t + 14] = nz;
    table[t + 15] = Math.sin(theta);
  }
  return { regionOf, table, count: n };
}

/**
 * A triangle's cut in its region's plane: its corners projected (and their vertex ids, for whose a lipid on a shared
 * edge is), the triangle's own plane (a lipid's head lifted onto it along the region's normal), the region's spin and
 * offset in the patch, the patch point its projected centroid falls on
 */
export interface TriangleCut {
  /** the region: origin, e1, e2, normal */
  o: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  rn: [number, number, number];
  /** the triangle: a corner, its unit normal, the normal's dot with the region's; its in-plane axes (e1 on it) */
  a: [number, number, number];
  n: [number, number, number];
  dn: number;
  t1: [number, number, number];
  t2: [number, number, number];
  /** corners in the region's frame: x0, y0, x1, y1, x2, y2; their vertex ids; the projection's orientation (±1) */
  corners: [number, number, number, number, number, number];
  ids: [number, number, number];
  orient: number;
  /** the projected centroid's patch point and the corners' farthest distance from it */
  px: number;
  py: number;
  radius: number;
  cos: number;
  sin: number;
  ox: number;
  oy: number;
}

/** Triangle `t`'s cut (`cutter-kernel.ts`: the same in WGSL); false for a degenerate one or one edge-on to its region */
export function triangleCut(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  t: number,
  regions: CutterRegions,
  box: readonly [number, number],
  out: TriangleCut,
) {
  const g = regions.table;
  const r = regions.regionOf[t] * 16;
  for (let k = 0; k < 3; ++k) {
    out.o[k] = g[r + k];
    out.e1[k] = g[r + 4 + k];
    out.e2[k] = g[r + 8 + k];
    out.rn[k] = g[r + 12 + k];
  }
  out.ox = g[r + 3] * box[0];
  out.oy = g[r + 7] * box[1];
  out.cos = g[r + 11];
  out.sin = g[r + 15];
  const p = positions;
  const ia = indices[t * 3];
  const ib = indices[t * 3 + 1];
  const ic = indices[t * 3 + 2];
  const a = ia * 3;
  const b = ib * 3;
  const c = ic * 3;
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
  if (nl === 0) return false;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const dn = nx * out.rn[0] + ny * out.rn[1] + nz * out.rn[2];
  // under about 16° from its region's plane by the bins; an edge-on one would stretch its lipids
  if (dn < 0.5) return false;
  out.n = [nx, ny, nz];
  out.dn = dn;
  out.a = [p[a], p[a + 1], p[a + 2]];
  // the triangle's in-plane axes: the region's e1 on it
  const d1 = out.e1[0] * nx + out.e1[1] * ny + out.e1[2] * nz;
  let tx = out.e1[0] - d1 * nx;
  let ty = out.e1[1] - d1 * ny;
  let tz = out.e1[2] - d1 * nz;
  const tl = Math.hypot(tx, ty, tz);
  tx /= tl;
  ty /= tl;
  tz /= tl;
  out.t1 = [tx, ty, tz];
  out.t2 = [ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx];
  // corners in the region's frame: each vertex by the same expression in every triangle that has it
  const ids = [ia, ib, ic];
  let qx = 0;
  let qy = 0;
  for (let k = 0; k < 3; ++k) {
    const i = ids[k] * 3;
    const dx = p[i] - out.o[0];
    const dy = p[i + 1] - out.o[1];
    const dz = p[i + 2] - out.o[2];
    const x = dx * out.e1[0] + dy * out.e1[1] + dz * out.e1[2];
    const y = dx * out.e2[0] + dy * out.e2[1] + dz * out.e2[2];
    out.corners[k * 2] = x;
    out.corners[k * 2 + 1] = y;
    out.ids[k] = ids[k];
    qx += x / 3;
    qy += y / 3;
  }
  const [x0, y0, x1, y1, x2, y2] = out.corners;
  const area2 = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (area2 === 0) return false;
  out.orient = area2 > 0 ? 1 : -1;
  let radius = 0;
  for (let k = 0; k < 3; ++k) {
    radius = Math.max(radius, Math.hypot(out.corners[k * 2] - qx, out.corners[k * 2 + 1] - qy));
  }
  out.radius = radius;
  // region → patch: p = o + Rz(θ) q
  out.px = out.ox + out.cos * qx - out.sin * qy;
  out.py = out.oy + out.sin * qx + out.cos * qy;
  return true;
}

export function emptyCut(): TriangleCut {
  return {
    o: [0, 0, 0],
    e1: [0, 0, 0],
    e2: [0, 0, 0],
    rn: [0, 0, 0],
    a: [0, 0, 0],
    n: [0, 0, 0],
    dn: 1,
    t1: [0, 0, 0],
    t2: [0, 0, 0],
    corners: [0, 0, 0, 0, 0, 0],
    ids: [0, 0, 0],
    orient: 1,
    px: 0,
    py: 0,
    radius: 0,
    cos: 1,
    sin: 0,
    ox: 0,
    oy: 0,
  };
}

/**
 * Whether the triangle owns a point of its region's plane: inside its three edges, each evaluated from its lower vertex
 * id to its higher (two triangles of an edge compute the same value, of opposite sign for them), a point on an edge the
 * one triangle's whose interior is on the edge's positive side: each lipid kept once
 */
function owns(cut: TriangleCut, qx: number, qy: number) {
  const c = cut.corners;
  for (let k = 0; k < 3; ++k) {
    const k1 = (k + 1) % 3;
    const forward = cut.ids[k] < cut.ids[k1];
    const lo = forward ? k : k1;
    const hi = forward ? k1 : k;
    const e = (c[hi * 2] - c[lo * 2]) * (qy - c[lo * 2 + 1]) - (c[hi * 2 + 1] - c[lo * 2 + 1]) * (qx - c[lo * 2]);
    const sign = forward ? cut.orient : -cut.orient;
    const v = sign * e;
    if (v < 0 || (v === 0 && sign < 0)) return false;
  }
  return true;
}

/**
 * Each hit of member `m`'s lipids in a triangle's cut, in the kernel's order (lipids, then images by x, then y): `hit`
 * gets the lipid (by member) and its point in the region's frame
 */
export function eachHit(
  table: CutterTable,
  cut: TriangleCut,
  m: number,
  hit: (lipid: number, x: number, y: number) => void,
) {
  const [bx, by] = table.box;
  const r = cut.radius;
  for (let l = table.memberStart[m]; l < table.memberStart[m + 1]; ++l) {
    const hx = table.lipids[l * 4];
    const hy = table.lipids[l * 4 + 1];
    const i0 = Math.ceil((cut.px - r - hx) / bx);
    const i1 = Math.floor((cut.px + r - hx) / bx);
    const j0 = Math.ceil((cut.py - r - hy) / by);
    const j1 = Math.floor((cut.py + r - hy) / by);
    for (let i = i0; i <= i1; ++i) {
      for (let j = j0; j <= j1; ++j) {
        // patch → region: q = Rz(−θ)(p − o)
        const px = hx + i * bx - cut.ox;
        const py = hy + j * by - cut.oy;
        const qx = cut.cos * px + cut.sin * py;
        const qy = -cut.sin * px + cut.cos * py;
        if (owns(cut, qx, qy)) hit(l, qx, qy);
      }
    }
  }
}

/**
 * A hit's affine (16 floats, column-major at `o`): its conformer's atoms turned to the lipid's azimuth and the region's
 * spin in the triangle's plane, its normal the triangle's, its head the region's point lifted onto the triangle
 */
export function hitAffine(
  table: CutterTable,
  cut: TriangleCut,
  lipid: number,
  qx: number,
  qy: number,
  out: Float32Array,
  o: number,
) {
  // the turn: Rz(Δ − θ)
  const dc = table.lipids[lipid * 4 + 2];
  const ds = table.lipids[lipid * 4 + 3];
  const c = dc * cut.cos + ds * cut.sin;
  const s = ds * cut.cos - dc * cut.sin;
  const { t1, t2, n, rn, e1, e2 } = cut;
  // the point on the region's plane, then along the region's normal onto the triangle's plane
  const x = cut.o[0] + qx * e1[0] + qy * e2[0];
  const y = cut.o[1] + qx * e1[1] + qy * e2[1];
  const z = cut.o[2] + qx * e1[2] + qy * e2[2];
  const lift = ((cut.a[0] - x) * n[0] + (cut.a[1] - y) * n[1] + (cut.a[2] - z) * n[2]) / cut.dn;
  for (let k = 0; k < 3; ++k) {
    out[o + k] = c * t1[k] + s * t2[k];
    out[o + 4 + k] = -s * t1[k] + c * t2[k];
    out[o + 8 + k] = n[k];
  }
  out[o + 3] = 0;
  out[o + 7] = 0;
  out[o + 11] = 0;
  out[o + 12] = x + lift * rn[0];
  out[o + 13] = y + lift * rn[1];
  out[o + 14] = z + lift * rn[2];
  out[o + 15] = 1;
}

/** The cutter's counts on the CPU (the kernel's count pass): per member, per triangle (`m * T + t`) */
export function cutterCounts(
  table: CutterTable,
  positions: Float32Array,
  indices: Uint32Array,
  regions: CutterRegions,
) {
  const T = indices.length / 3;
  const M = table.members.length;
  const counts = new Uint32Array(M * T);
  const cut = emptyCut();
  let k = 0;
  const count = () => {
    k += 1;
  };
  for (let t = 0; t < T; ++t) {
    if (!triangleCut(positions, indices, t, regions, table.box, cut)) continue;
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
  regions: CutterRegions,
  m: number,
  total: number,
) {
  const out = new Float32Array(total * 16);
  const cut = emptyCut();
  let k = 0;
  for (let t = 0, T = indices.length / 3; t < T; ++t) {
    if (!triangleCut(positions, indices, t, regions, table.box, cut)) continue;
    eachHit(table, cut, m, (l, x, y) => hitAffine(table, cut, l, x, y, out, k++ * 16));
  }
  return out;
}
