/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A bounding-sphere tree over a mesh's triangles, a tree a part (lipid-procedural round 6: the yeast cell's nine
// membranes, 1.08 M triangles in one mesh): a view's selection descends it and prunes what is out of view or reach
// (`procedural.ts`), and a ray's crossings of a closed part tell whether a point is inside it (the enclosed membranes,
// hidden while the eye is outside their encloser). Built once a mesh (cached by its indices), O(T log T).

/** A part of a mesh: its triangles `[start, end)` (a membrane of a cell wrapped whole), named */
export interface TrianglePart {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

export interface TriangleTree {
  /** per node its sphere: center x, y, z, radius */
  readonly spheres: Float64Array;
  /** per node its children (`a`, `b`), or a leaf's triangles `order[a, b)` (`leaf` 1) */
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly leaf: Uint8Array;
  /** the triangles by node */
  readonly order: Uint32Array;
  /** per part its root, -1 where it has no triangle */
  readonly roots: Int32Array;
  readonly parts: readonly TrianglePart[];
  /**
   * its deepest node's depth (a root's 0): a descent's stack holds depth + 2 nodes at most (round 10, the gate's N6: a
   * fixed stack dropped nodes silently)
   */
  readonly depth: number;
}

/** A leaf's triangles at most */
const Leaf = 8;

/** The whole mesh as one part */
export function wholePart(indices: ArrayLike<number>): TrianglePart[] {
  return [{ start: 0, end: indices.length / 3, name: '' }];
}

const trees = new WeakMap<object, TriangleTree>();

/** The tree of a mesh's parts, once a mesh (its `indices` the key) */
export function triangleTree(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  parts: readonly TrianglePart[] = wholePart(indices),
): TriangleTree {
  const cached = trees.get(indices as object);
  if (cached && cached.parts.length === parts.length) return cached;
  const tree = buildTree(positions, indices, parts);
  trees.set(indices as object, tree);
  return tree;
}

function buildTree(positions: ArrayLike<number>, indices: ArrayLike<number>, parts: readonly TrianglePart[]) {
  const T = indices.length / 3;
  // per triangle its centroid and its sphere's radius about it
  const c = new Float64Array(T * 3);
  const r = new Float64Array(T);
  for (let t = 0; t < T; ++t) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const d = indices[t * 3 + 2] * 3;
    for (let k = 0; k < 3; ++k) c[t * 3 + k] = (positions[a + k] + positions[b + k] + positions[d + k]) / 3;
    let m = 0;
    for (let k = 0; k < 3; ++k) {
      const v = indices[t * 3 + k] * 3;
      m = Math.max(
        m,
        Math.hypot(positions[v] - c[t * 3], positions[v + 1] - c[t * 3 + 1], positions[v + 2] - c[t * 3 + 2]),
      );
    }
    r[t] = m;
  }
  const order = new Uint32Array(T);
  for (let t = 0; t < T; ++t) order[t] = t;
  // a leaf holds Leaf / 2 triangles or more (a median split of over Leaf): under 4 T / Leaf nodes, a part one more
  const most = Math.max(1, 4 * Math.ceil(T / Leaf) + 2 * parts.length);
  const spheres = new Float64Array(most * 4);
  const na = new Int32Array(most);
  const nb = new Int32Array(most);
  const leaf = new Uint8Array(most);
  const roots = new Int32Array(parts.length).fill(-1);
  let nodes = 0;
  let depth = 0;
  // work: node, start, end, depth
  const work: number[] = [];
  for (let p = 0; p < parts.length; ++p) {
    if (parts[p].end <= parts[p].start) continue;
    roots[p] = nodes;
    work.push(nodes++, parts[p].start, parts[p].end, 0);
    while (work.length) {
      const level = work.pop()!;
      const end = work.pop()!;
      const start = work.pop()!;
      const node = work.pop()!;
      // its box over its triangles' spheres, and its centroids' box (the split's axis)
      let x0 = Infinity;
      let y0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let z1 = -Infinity;
      let cx0 = Infinity;
      let cy0 = Infinity;
      let cz0 = Infinity;
      let cx1 = -Infinity;
      let cy1 = -Infinity;
      let cz1 = -Infinity;
      for (let i = start; i < end; ++i) {
        const t = order[i];
        const x = c[t * 3];
        const y = c[t * 3 + 1];
        const z = c[t * 3 + 2];
        const s = r[t];
        x0 = Math.min(x0, x - s);
        y0 = Math.min(y0, y - s);
        z0 = Math.min(z0, z - s);
        x1 = Math.max(x1, x + s);
        y1 = Math.max(y1, y + s);
        z1 = Math.max(z1, z + s);
        cx0 = Math.min(cx0, x);
        cy0 = Math.min(cy0, y);
        cz0 = Math.min(cz0, z);
        cx1 = Math.max(cx1, x);
        cy1 = Math.max(cy1, y);
        cz1 = Math.max(cz1, z);
      }
      spheres[node * 4] = (x0 + x1) / 2;
      spheres[node * 4 + 1] = (y0 + y1) / 2;
      spheres[node * 4 + 2] = (z0 + z1) / 2;
      spheres[node * 4 + 3] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
      if (level > depth) depth = level;
      if (end - start <= Leaf) {
        leaf[node] = 1;
        na[node] = start;
        nb[node] = end;
        continue;
      }
      const ex = cx1 - cx0;
      const ey = cy1 - cy0;
      const ez = cz1 - cz0;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (start + end) >> 1;
      nthElement(order, start, end, mid, c, axis);
      na[node] = nodes;
      nb[node] = nodes + 1;
      work.push(nodes++, start, mid, level + 1);
      work.push(nodes++, mid, end, level + 1);
    }
  }
  return {
    spheres: spheres.subarray(0, nodes * 4),
    a: na.subarray(0, nodes),
    b: nb.subarray(0, nodes),
    leaf: leaf.subarray(0, nodes),
    order,
    roots,
    parts,
    depth,
  };
}

/** `order[start, end)` partitioned about its `k`-th by the centroids' `axis` (quickselect, Hoare) */
function nthElement(order: Uint32Array, start: number, end: number, k: number, c: Float64Array, axis: number) {
  let lo = start;
  let hi = end - 1;
  while (hi > lo) {
    const pivot = c[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (c[order[i] * 3 + axis] < pivot) ++i;
      while (c[order[j] * 3 + axis] > pivot) --j;
      if (i <= j) {
        const s = order[i];
        order[i] = order[j];
        order[j] = s;
        ++i;
        --j;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** A ray's direction off every axis and diagonal (a crossing on an edge or a vertex, unlikely) */
const Dx = 0.5731;
const Dy = 0.6113;
const Dz = 0.5459;
// normalized once (review S3: `Math.hypot` a call allocated, 56 B a test)
const DirL = Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
const DirX = Dx / DirL;
const DirY = Dy / DirL;
const DirZ = Dz / DirL;

/**
 * Whether the point at `point[at..at + 2]` is inside part `p` (closed: an odd count of its triangles crossed by a ray
 * from the point); `stack` a scratch of 64 or more. Nothing allocated (`lipid-selection.quick.ts`, round 7 review S3)
 */
export function insidePart(
  tree: TriangleTree,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  p: number,
  point: ArrayLike<number>,
  at: number,
  stack: Int32Array,
) {
  const x = point[at];
  const y = point[at + 1];
  const z = point[at + 2];
  const root = tree.roots[p];
  if (root < 0) return false;
  const dx = DirX;
  const dy = DirY;
  const dz = DirZ;
  const { spheres, a, b, leaf, order } = tree;
  let crossings = 0;
  let top = 0;
  stack[top++] = root;
  while (top > 0) {
    const node = stack[--top];
    const o = node * 4;
    // the ray misses its sphere: behind it, or past its radius
    const mx = spheres[o] - x;
    const my = spheres[o + 1] - y;
    const mz = spheres[o + 2] - z;
    const rr = spheres[o + 3];
    const along = mx * dx + my * dy + mz * dz;
    if (along < -rr) continue;
    if (mx * mx + my * my + mz * mz - along * along > rr * rr) continue;
    if (!leaf[node]) {
      if (top + 2 > stack.length) return false;
      stack[top++] = a[node];
      stack[top++] = b[node];
      continue;
    }
    for (let i = a[node]; i < b[node]; ++i) {
      const t = order[i];
      const i0 = indices[t * 3] * 3;
      const i1 = indices[t * 3 + 1] * 3;
      const i2 = indices[t * 3 + 2] * 3;
      // Möller–Trumbore
      const e1x = positions[i1] - positions[i0];
      const e1y = positions[i1 + 1] - positions[i0 + 1];
      const e1z = positions[i1 + 2] - positions[i0 + 2];
      const e2x = positions[i2] - positions[i0];
      const e2y = positions[i2 + 1] - positions[i0 + 1];
      const e2z = positions[i2 + 2] - positions[i0 + 2];
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = x - positions[i0];
      const ty = y - positions[i0 + 1];
      const tz = z - positions[i0 + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) crossings += 1;
    }
  }
  return (crossings & 1) === 1;
}

/** Vertices of a part tested against another to call it enclosed (all inside), besides one a component */
const EnclosureSamples = 16;

/**
 * A part's sample vertices: `EnclosureSamples` spread over its triangles and one a connected component (review S2: a
 * small component outside its encloser is sampled too)
 */
function partSamples(indices: ArrayLike<number>, start: number, end: number) {
  // union-find over the part's vertices (by their first triangle's corner), a map from vertex to its slot
  const slot = new Map<number, number>();
  const parent: number[] = [];
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = start; t < end; ++t) {
    let first = -1;
    for (let k = 0; k < 3; ++k) {
      const v = indices[t * 3 + k];
      let s = slot.get(v);
      if (s === undefined) {
        s = parent.length;
        slot.set(v, s);
        parent.push(s);
      }
      if (first < 0) first = find(s);
      else {
        const r = find(s);
        if (r !== first) parent[r] = first;
      }
    }
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (let t = start; t < end; ++t) {
    const v = indices[t * 3];
    const root = find(slot.get(v)!);
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(v);
  }
  for (let s = 0; s < EnclosureSamples; ++s)
    out.push(indices[(start + Math.floor(((end - start) * s) / EnclosureSamples)) * 3]);
  return out;
}

/**
 * Per part the parts that enclose it: every sample vertex of it (`partSamples`) is inside the other. Not transitive by
 * itself: a cell's mitochondrion's IM is enclosed by its OM and by the PM
 */
export function enclosures(tree: TriangleTree, positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const { parts } = tree;
  const stack = new Int32Array(128);
  const out: number[][] = parts.map(() => []);
  for (let q = 0; q < parts.length; ++q) {
    const { start, end } = parts[q];
    if (end <= start) continue;
    const samples = partSamples(indices, start, end);
    for (let p = 0; p < parts.length; ++p) {
      if (p === q || tree.roots[p] < 0) continue;
      let all = true;
      for (let i = 0; i < samples.length && all; ++i) {
        const v = samples[i] * 3;
        all = insidePart(tree, positions, indices, p, positions, v, stack);
      }
      if (all) out[q].push(p);
    }
  }
  return out.map((e) => Int32Array.from(e));
}
