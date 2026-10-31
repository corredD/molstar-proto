/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Mesh } from './mesh.js';

// The triangle of a mesh under a pick (.v6/plans/gl/triangle-picking.md). The GPU pick gives the object, the instance,
// the group and the depth point; a group may be a whole material or one vertex, so the triangle is found on the CPU:
// the exact ray through the pointer against the triangles near the depth point. A grid of the triangles by their
// centroids, built on the first pick of a mesh and kept while its buffers are the same, finds them without a scan.

/** A triangle picked on a mesh: its index, the barycentric weights of its second and third vertices at the point */
export interface MeshTrianglePick {
  index: number;
  u: number;
  v: number;
}

export function MeshTrianglePick(): MeshTrianglePick {
  return { index: -1, u: 0, v: 0 };
}

/** The triangles of a mesh, by where they are */
export interface MeshTriangleLookup {
  readonly triangleCount: number;
  /** The largest distance from a triangle's centroid to its vertices */
  readonly maxRadius: number;
  /** Bytes it holds (the triangles sorted by cell, the cells' starts), the mesh's own buffers aside */
  readonly byteCount: number;
  /** How many triangles the last pick tested (what a pick costs; for tests and measurements) */
  readonly lastVisited: number;
  /**
   * The triangle `ray` hits nearest to `near` within `tolerance` of it (the mesh's space); when the ray hits none
   * there (the pick's depth point is a pixel off an edge), the triangle nearest to `near` within `tolerance`, at its
   * point nearest to it. False when there is none.
   */
  pick(out: MeshTrianglePick, ray: Ray3D, near: Vec3, tolerance: number): boolean;
}

interface Cached {
  readonly vertices: number;
  readonly indices: number;
  readonly triangleCount: number;
  readonly lookup: MeshTriangleLookup;
}

const cache = new WeakMap<Mesh, Cached>();

/** The mesh's triangle lookup: built at the first call, again only after its vertices or triangles changed */
export function getMeshTriangleLookup(mesh: Mesh): MeshTriangleLookup {
  const vertices = mesh.vertexBuffer.ref.version;
  const indices = mesh.indexBuffer.ref.version;
  const c = cache.get(mesh);
  if (c && c.vertices === vertices && c.indices === indices && c.triangleCount === mesh.triangleCount) {
    return c.lookup;
  }
  const lookup = createLookup(mesh.vertexBuffer.ref.value, mesh.indexBuffer.ref.value, mesh.triangleCount);
  cache.set(mesh, { vertices, indices, triangleCount: mesh.triangleCount, lookup });
  return lookup;
}

const a = Vec3();
const b = Vec3();
const c = Vec3();
const hit = Vec3();
const q = Vec3();
const uvt = Vec3();
const closest = { u: 0, v: 0 };

/** At most this many grid cells a triangle (the cells' starts are kept: half a cell a triangle, 2 bytes) */
const CellsPerTriangle = 0.5;

/**
 * Triangles are graded by size, each grade a grid of its own (a loose grid hierarchy): a grade holds the triangles
 * whose reach (centroid to farthest vertex) is within a factor `GradeFactor`, the grades counted in steps of it from a
 * typical reach (the median, which a share of wide triangles below half does not move). A pick looks in each grade as
 * far as that grade's widest triangle reaches, so wide triangles (a floor under a patch, long slivers) cost their own
 * cells, not a wide look into the fine ones. A mesh of one size has one or two grades.
 */
const GradeFactor = 4;
/** Grades on each side of the typical one; wider or finer triangles share the end grades (slower, still right) */
const GradeSteps = 16;
/** How many reaches the typical one is the median of (evenly spread over the mesh) */
const TypicalSamples = 4097;
/** A grid of some triangles, by the cell of their centroid (a counting sort: `sorted` cell after cell, `starts`) */
interface Grade {
  readonly min: Vec3;
  readonly inv: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly starts: Uint32Array;
  readonly sorted: Uint32Array;
  /** The widest reach of its triangles from their centroids */
  readonly reach: number;
}

/** A grade's grid over `members` (indices of triangles with finite centroids) */
function createGrade(
  members: Uint32Array,
  cx: Float32Array,
  cy: Float32Array,
  cz: Float32Array,
  radiusSq: Float32Array,
): Grade {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let maxR = 0;
  let sumR = 0;
  const n = members.length;
  for (let m = 0; m < n; ++m) {
    const t = members[m];
    const x = cx[t];
    const y = cy[t];
    const z = cz[t];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    if (radiusSq[t] > maxR) maxR = radiusSq[t];
    sumR += radiusSq[t];
  }
  const min = Vec3.create(minX, minY, minZ);
  const extent = Vec3.create(maxX - minX, maxY - minY, maxZ - minZ);
  // cells about two of its triangles wide, fewer when the box would hold too many
  let size = Math.max(2 * Math.sqrt(sumR / n), 1e-6, Math.max(extent[0], extent[1], extent[2]) * 1e-6);
  const cap = Math.max(64, Math.ceil(n * CellsPerTriangle));
  let nx = 1;
  let ny = 1;
  let nz = 1;
  // bounded: each round grows the cells by at least 1 %, a few rounds reach the cap
  for (let round = 0; round < 100; ++round) {
    nx = Math.floor(extent[0] / size) + 1;
    ny = Math.floor(extent[1] / size) + 1;
    nz = Math.floor(extent[2] / size) + 1;
    if (nx * ny * nz <= cap) break;
    size *= Math.max(1.01, Math.cbrt((nx * ny * nz) / cap));
  }
  const inv = 1 / size;
  const cells = nx * ny * nz;
  const starts = new Uint32Array(cells + 1);
  // each member's cell, until sorted (the build's own)
  const cellOf = new Uint32Array(n);
  for (let m = 0; m < n; ++m) {
    const t = members[m];
    const i = Math.min(nx - 1, Math.floor((cx[t] - minX) * inv));
    const j = Math.min(ny - 1, Math.floor((cy[t] - minY) * inv));
    const k = Math.min(nz - 1, Math.floor((cz[t] - minZ) * inv));
    const cell = (k * ny + j) * nx + i;
    cellOf[m] = cell;
    starts[cell + 1]++;
  }
  for (let i = 0; i < cells; ++i) starts[i + 1] += starts[i];
  const fill = starts.slice(0, cells);
  const sorted = new Uint32Array(n);
  for (let m = 0; m < n; ++m) sorted[fill[cellOf[m]]++] = members[m];
  return { min, inv, nx, ny, nz, starts, sorted, reach: Math.sqrt(maxR) };
}

/**
 * The grades of a mesh's triangles (`GradeFactor`), each sorted by the grid cell of its triangles' centroids (a
 * counting sort), and the widest reach; undefined when no triangle is whole. Its own function: what it holds for the
 * build (centroids, reaches: about 24 bytes a triangle at most, with the grades' own sorting) is let go after it, never
 * kept by the lookup's closures. Arithmetic inline: millions of triangles (AGENTS.md, a hot loop on purpose).
 */
function buildGrades(vb: Float32Array, ib: Uint32Array, T: number): { grades: Grade[]; maxRadius: number } | undefined {
  const cx = new Float32Array(T);
  const cy = new Float32Array(T);
  const cz = new Float32Array(T);
  // a triangle's centroid-to-vertex distance, squared; NaN when the triangle is left out
  const radiusSq = new Float32Array(T);
  let maxRadiusSq = 0;
  // the triangles whose centroid and reach are finite as stored (32-bit): a NaN, an infinity or an overflow (a broken
  // file, an index past the vertices, a vertex at 1e20) is left out
  let valid = 0;
  for (let t = 0; t < T; ++t) {
    const i0 = ib[3 * t] * 3;
    const i1 = ib[3 * t + 1] * 3;
    const i2 = ib[3 * t + 2] * 3;
    const ax = vb[i0],
      ay = vb[i0 + 1],
      az = vb[i0 + 2];
    const bx = vb[i1],
      by = vb[i1 + 1],
      bz = vb[i1 + 2];
    const qx = vb[i2],
      qy = vb[i2 + 1],
      qz = vb[i2 + 2];
    const x = Math.fround((ax + bx + qx) / 3);
    const y = Math.fround((ay + by + qy) / 3);
    const z = Math.fround((az + bz + qz) / 3);
    const da = (ax - x) * (ax - x) + (ay - y) * (ay - y) + (az - z) * (az - z);
    const db = (bx - x) * (bx - x) + (by - y) * (by - y) + (bz - z) * (bz - z);
    const dc = (qx - x) * (qx - x) + (qy - y) * (qy - y) + (qz - z) * (qz - z);
    const r = Math.fround(da > db ? (da > dc ? da : dc) : db > dc ? db : dc);
    if (!Number.isFinite(x + y + z + r)) {
      cx[t] = Number.NaN;
      radiusSq[t] = Number.NaN;
      continue;
    }
    radiusSq[t] = r;
    valid++;
    cx[t] = x;
    cy[t] = y;
    cz[t] = z;
    if (r > maxRadiusSq) maxRadiusSq = r;
  }
  if (valid === 0) return undefined;

  // the typical reach: the median of an even spread of the triangles'
  const step = Math.max(1, Math.floor(T / TypicalSamples));
  const samples: number[] = [];
  for (let t = 0; t < T; t += step) if (!Number.isNaN(radiusSq[t])) samples.push(radiusSq[t]);
  samples.sort((p, q) => p - q);
  const typicalSq = samples.length ? samples[samples.length >> 1] : maxRadiusSq;
  const logTypical = Math.log(Math.max(typicalSq, 1e-30));
  const logStep = 2 * Math.log(GradeFactor);
  /** A triangle's grade: 0 for the finest, `GradeSteps` for those within a factor of the typical reach */
  const gradeOf = (r: number) => {
    const g = r > 0 ? Math.floor((Math.log(r) - logTypical) / logStep) + GradeSteps : 0;
    return g < 0 ? 0 : g > 2 * GradeSteps ? 2 * GradeSteps : g;
  };
  const counts = new Uint32Array(2 * GradeSteps + 1);
  for (let t = 0; t < T; ++t) if (!Number.isNaN(cx[t])) counts[gradeOf(radiusSq[t])]++;
  const members = Array.from(counts, (n) => new Uint32Array(n));
  const filled = new Uint32Array(counts.length);
  for (let t = 0; t < T; ++t) {
    if (Number.isNaN(cx[t])) continue;
    const g = gradeOf(radiusSq[t]);
    members[g][filled[g]++] = t;
  }
  const grades: Grade[] = [];
  for (const m of members) if (m.length) grades.push(createGrade(m, cx, cy, cz, radiusSq));
  return { grades, maxRadius: Math.sqrt(maxRadiusSq) };
}

/**
 * The lookup: the triangles' grades (`buildGrades`). Not Mol*'s `GridLookup3D`, on purpose: it keeps the centroids and
 * its buckets (about 20 bytes a triangle, and 12 times slower to build: measured, .v6/plans/gl/triangle-picking.md);
 * this keeps 4 bytes a triangle and 2 for the cells, a pick reading the vertices of the few triangles near it from the
 * mesh's buffers. A surface fills few cells of its box: the cells are capped by the triangle count.
 */
function createLookup(vb: Float32Array, ib: Uint32Array, triangleCount: number): MeshTriangleLookup {
  const T = triangleCount;
  const built = buildGrades(vb, ib, T);
  if (!built) return { triangleCount: 0, maxRadius: 0, byteCount: 0, lastVisited: 0, pick: () => false };
  const { grades, maxRadius } = built;
  let byteCount = 0;
  for (const g of grades) byteCount += g.starts.byteLength + g.sorted.byteLength;

  const vertexOf = (out: Vec3, t: number, k: number) => Vec3.fromArray(out, vb, ib[3 * t + k] * 3);

  /** Calls `f` with the triangles of `g` whose centroid's cell is within `r` of `at` */
  const eachNear = (g: Grade, at: Vec3, r: number, f: (t: number) => void) => {
    const { min, inv, nx, ny, nz, starts, sorted } = g;
    const i0 = Math.max(0, Math.floor((at[0] - r - min[0]) * inv));
    const j0 = Math.max(0, Math.floor((at[1] - r - min[1]) * inv));
    const k0 = Math.max(0, Math.floor((at[2] - r - min[2]) * inv));
    const i1 = Math.min(nx - 1, Math.floor((at[0] + r - min[0]) * inv));
    const j1 = Math.min(ny - 1, Math.floor((at[1] + r - min[1]) * inv));
    const k1 = Math.min(nz - 1, Math.floor((at[2] + r - min[2]) * inv));
    for (let k = k0; k <= k1; ++k) {
      for (let j = j0; j <= j1; ++j) {
        const row = (k * ny + j) * nx;
        for (let i = i0; i <= i1; ++i) {
          const cell = row + i;
          for (let s = starts[cell], e = starts[cell + 1]; s < e; ++s) f(sorted[s]);
        }
      }
    }
  };

  // the state of a pick, set by its visits (no closure made a pick)
  let best = -1;
  let bestD = 0;
  let visited = 0;
  let pickRay: Ray3D;
  let pickNear: Vec3;
  let pickOut: MeshTrianglePick;
  /** Keeps `t` if nearer, or as near and of a lower index: the same pick whatever the grades' order */
  const keep = (t: number, d: number, u: number, v: number) => {
    if (d < bestD || (d === bestD && (best < 0 || t < best))) {
      bestD = d;
      best = t;
      pickOut.u = u;
      pickOut.v = v;
    }
  };
  const visitHit = (t: number) => {
    visited++;
    vertexOf(a, t, 0);
    vertexOf(b, t, 1);
    vertexOf(c, t, 2);
    if (!Ray3D.intersectTriangle(uvt, pickRay, a, b, c)) return;
    Vec3.scaleAndAdd(hit, pickRay.origin, pickRay.direction, uvt[2]);
    keep(t, Vec3.squaredDistance(hit, pickNear), uvt[0], uvt[1]);
  };
  const visitNearest = (t: number) => {
    visited++;
    vertexOf(a, t, 0);
    vertexOf(b, t, 1);
    vertexOf(c, t, 2);
    closestPointOnTriangle(q, closest, pickNear, a, b, c);
    keep(t, Vec3.squaredDistance(q, pickNear), closest.u, closest.v);
  };

  return {
    triangleCount: T,
    maxRadius,
    byteCount,
    get lastVisited() {
      return visited;
    },
    pick(out, ray, near, tolerance) {
      pickRay = ray;
      pickNear = near;
      pickOut = out;
      visited = 0;
      // the ray's hit nearest to the depth point (not the first along the ray: a clipped or cut-away front is not
      // what the pick saw), in every grade as far as its widest triangle reaches
      best = -1;
      bestD = tolerance * tolerance;
      for (const g of grades) eachNear(g, near, tolerance + g.reach, visitHit);
      if (best < 0) {
        // no hit near the depth point: the triangle nearest to it
        bestD = tolerance * tolerance;
        for (const g of grades) eachNear(g, near, tolerance + g.reach, visitNearest);
      }
      if (best < 0) return false;
      out.index = best;
      return true;
    },
  };
}

const ab = Vec3();
const ac = Vec3();
const ap = Vec3();
const bp = Vec3();
const cp = Vec3();

/**
 * The point of triangle `a`, `b`, `c` nearest to `pt` (Ericson, Real-Time Collision Detection, 5.1.5), and its
 * barycentric weights of `b` and `c` in `uv`
 */
export function closestPointOnTriangle(out: Vec3, uv: { u: number; v: number }, pt: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  Vec3.sub(ab, b, a);
  Vec3.sub(ac, c, a);
  Vec3.sub(ap, pt, a);
  const d1 = Vec3.dot(ab, ap);
  const d2 = Vec3.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return setUV(out, uv, a, 0, 0);
  Vec3.sub(bp, pt, b);
  const d3 = Vec3.dot(ab, bp);
  const d4 = Vec3.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return setUV(out, uv, a, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return setUV(out, uv, a, d1 / (d1 - d3), 0);
  Vec3.sub(cp, pt, c);
  const d5 = Vec3.dot(ab, cp);
  const d6 = Vec3.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return setUV(out, uv, a, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return setUV(out, uv, a, 0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return setUV(out, uv, a, 1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  return setUV(out, uv, a, vb * denom, vc * denom);
}

/** `out` = a + u (b - a) + v (c - a), with `ab`, `ac` already set */
function setUV(out: Vec3, uv: { u: number; v: number }, a: Vec3, u: number, v: number) {
  uv.u = u;
  uv.v = v;
  Vec3.scaleAndAdd(out, a, ab, u);
  return Vec3.scaleAndAdd(out, out, ac, v);
}
