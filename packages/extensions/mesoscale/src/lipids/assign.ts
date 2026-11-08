/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The per-triangle assignment of lipid tiles (progress/2026-11-08-lipid-tiles.md, Design: Assignment): local, the same
// function here and in WGSL (`assign-kernel.ts`): vertex colour, edge type and orientation, variant, and the affine map
// of the template triangle onto the triangle. No global pass: each triangle reads its three vertices' ids and positions.

/**
 * lowbias32 (C. Wellons' hash prospector): a u32 hash with 32-bit wrapping, bit for bit as WGSL's u32 arithmetic.
 * `@molstar/core`'s `hash1` sums in floats past 32 bits, which a shader would not reproduce.
 */
export function hashU32(x: number) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** A number in [0, 1) from `seed` and a counter: the baker's random draws, reproducible */
export function random01(seed: number, i: number) {
  return hashU32((seed + Math.imul(i, 0x9e3779b9)) >>> 0) / 4294967296;
}

/** The kinds of tiles: edge types (n), vertex colours (C), interior variants (V) */
export interface TileKinds {
  readonly edgeTypes: number;
  readonly vertexColors: number;
  readonly variants: number;
  readonly seed: number;
}

/** The number of tile variants: C³ × (2n)³ × V */
export function variantCount(k: TileKinds) {
  const e = 2 * k.edgeTypes;
  return k.vertexColors ** 3 * e ** 3 * k.variants;
}

/**
 * The variant of corner colours `c`, edge codes `e` (type × 2, + 1 where reversed: Ē) and interior variant `v`: the
 * index of the tile set's variants (`TileSet.variants`)
 */
export function variantIndex(
  k: TileKinds,
  c0: number,
  c1: number,
  c2: number,
  e0: number,
  e1: number,
  e2: number,
  v: number,
) {
  const C = k.vertexColors;
  const E = 2 * k.edgeTypes;
  return ((((c0 * C + c1) * C + c2) * E + e0) * E + e1) * E * k.variants + e2 * k.variants + v;
}

/** The colour of vertex `id` */
export const vertexColor = (k: TileKinds, id: number) => hashU32((id ^ k.seed) >>> 0) % k.vertexColors;

/** The code of the edge from vertex `a` to `b` as a triangle runs it: its type × 2, + 1 where it runs it from the larger */
export function edgeCode(k: TileKinds, a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const type = hashU32((hashU32((lo ^ k.seed) >>> 0) ^ hi) >>> 0) % k.edgeTypes;
  return type * 2 + (a < b ? 0 : 1);
}

/** The variant of triangle `t` with vertices `a`, `b`, `c` (counter-clockwise, outward) */
export function triangleVariant(k: TileKinds, t: number, a: number, b: number, c: number) {
  const v = hashU32((t ^ hashU32(k.seed)) >>> 0) % k.variants;
  return variantIndex(
    k,
    vertexColor(k, a),
    vertexColor(k, b),
    vertexColor(k, c),
    edgeCode(k, a, b),
    edgeCode(k, b, c),
    edgeCode(k, c, a),
    v,
  );
}

/**
 * The affine map of the template triangle (A at the origin, B = (L, 0, 0), C = (L/2, L√3/2, 0), z its normal) onto the
 * triangle `p0 p1 p2` (counter-clockwise from outside), z onto its unit normal, written column-major at `out[o..o+16)`:
 * [p1 − p0, p2 − p0, n̂] · [B − A, C − A, ẑ]⁻¹, translated to p0. Both tiles of an edge map it through its endpoints,
 * so their bands meet exactly.
 */
export function triangleAffine(
  L: number,
  p: ArrayLike<number>,
  i0: number,
  i1: number,
  i2: number,
  out: Float32Array | number[],
  o: number,
) {
  const x0 = p[i0 * 3];
  const y0 = p[i0 * 3 + 1];
  const z0 = p[i0 * 3 + 2];
  const ux = p[i1 * 3] - x0;
  const uy = p[i1 * 3 + 1] - y0;
  const uz = p[i1 * 3 + 2] - z0;
  const vx = p[i2 * 3] - x0;
  const vy = p[i2 * 3 + 1] - y0;
  const vz = p[i2 * 3 + 2] - z0;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  // [B − A, C − A]⁻¹ in the plane: B − A = (L, 0), C − A = (L/2, h): x = (1/L, 0), y = (−1/(2h), 1/h)
  const h = (L * Math.sqrt(3)) / 2;
  const ix = 1 / L;
  const jx = -1 / (2 * h);
  const jy = 1 / h;
  // column x: u · ix; column y: u · jx + v · jy
  out[o] = ux * ix;
  out[o + 1] = uy * ix;
  out[o + 2] = uz * ix;
  out[o + 3] = 0;
  out[o + 4] = ux * jx + vx * jy;
  out[o + 5] = uy * jx + vy * jy;
  out[o + 6] = uz * jx + vz * jy;
  out[o + 7] = 0;
  out[o + 8] = nx;
  out[o + 9] = ny;
  out[o + 10] = nz;
  out[o + 11] = 0;
  out[o + 12] = x0;
  out[o + 13] = y0;
  out[o + 14] = z0;
  out[o + 15] = 1;
}

/**
 * The CPU's half of the assignment (Design: why the CPU knows the variant): each triangle's variant, the triangles per
 * variant and each triangle's slot among its variant's (in triangle order), in two passes, O(triangles)
 */
export interface TriangleSlots {
  readonly variant: Uint32Array;
  readonly slot: Uint32Array;
  readonly counts: Uint32Array;
  /** the triangles of each variant in slot order, variant after variant (`starts` into it) */
  readonly order: Uint32Array;
  readonly starts: Uint32Array;
}

export function assignSlots(k: TileKinds, indices: Uint32Array): TriangleSlots {
  const n = indices.length / 3;
  const variants = variantCount(k);
  const variant = new Uint32Array(n);
  const slot = new Uint32Array(n);
  const counts = new Uint32Array(variants);
  for (let t = 0; t < n; ++t) {
    const v = triangleVariant(k, t, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
    variant[t] = v;
    slot[t] = counts[v]++;
  }
  const starts = new Uint32Array(variants + 1);
  for (let v = 0; v < variants; ++v) starts[v + 1] = starts[v] + counts[v];
  const order = new Uint32Array(n);
  for (let t = 0; t < n; ++t) order[starts[variant[t]] + slot[t]] = t;
  return { variant, slot, counts, order, starts };
}

/** The reference of the kernel: per triangle its affine at its variant's start plus its slot (16 floats a tile) */
export function assignReference(
  k: TileKinds,
  L: number,
  positions: Float32Array,
  indices: Uint32Array,
  slots: TriangleSlots,
) {
  const out = new Float32Array((indices.length / 3) * 16);
  for (let t = 0, tl = indices.length / 3; t < tl; ++t) {
    const o = (slots.starts[slots.variant[t]] + slots.slot[t]) * 16;
    triangleAffine(L, positions, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2], out, o);
  }
  return out;
}
