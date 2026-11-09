/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { hash3 } from '@molstar/core/data/util/hash-functions';

/** A triangle mesh: xyz per vertex, 3 indices per triangle, counter-clockwise = outward. */
export interface TriMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface MeshStats {
  vertexCount: number;
  triangleCount: number;
  edgeMin: number;
  edgeMean: number;
  edgeMax: number;
  /** The smallest triangle angle of the mesh, in degrees. */
  minAngleDeg: number;
  /** The fraction of triangles whose smallest angle is below 30°. */
  angleBelow30Fraction: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  eulerCharacteristic: number;
}

// Hot loops below inline their vector arithmetic on plain numbers on purpose: no Vec3 allocated per vertex or per edge.

// ---------------------------------------------------------------------------------------------------------------------
// Icosphere

const Phi = (1 + Math.sqrt(5)) / 2;
const IcoVertices = [
  -1,
  Phi,
  0,
  1,
  Phi,
  0,
  -1,
  -Phi,
  0,
  1,
  -Phi,
  0,
  0,
  -1,
  Phi,
  0,
  1,
  Phi,
  0,
  -1,
  -Phi,
  0,
  1,
  -Phi,
  Phi,
  0,
  -1,
  Phi,
  0,
  1,
  -Phi,
  0,
  -1,
  -Phi,
  0,
  1,
];
const IcoFaces = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3,
  2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
/** The mean edge of k×k-split icosphere is about this × radius / k: the edge of 20k² equilateral triangles of the sphere's area. */
const IcoMeanEdge = Math.sqrt((16 * Math.PI) / (20 * Math.sqrt(3)));

function slerp(out: Float64Array, o: number, a: Float64Array, ia: number, b: Float64Array, ib: number, t: number) {
  const ax = a[ia],
    ay = a[ia + 1],
    az = a[ia + 2];
  const bx = b[ib],
    by = b[ib + 1],
    bz = b[ib + 2];
  const d = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const th = Math.acos(d);
  let wa = 1 - t,
    wb = t;
  if (th > 1e-9) {
    const s = Math.sin(th);
    wa = Math.sin((1 - t) * th) / s;
    wb = Math.sin(t * th) / s;
  }
  let x = wa * ax + wb * bx,
    y = wa * ay + wb * by,
    z = wa * az + wb * bz;
  const l = Math.hypot(x, y, z) || 1;
  x /= l;
  y /= l;
  z /= l;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
}

/**
 * An icosahedron with each face split into k×k triangles, k ≥ 1 chosen so the edge on the sphere is close to
 * `targetEdge`; points placed by spherical interpolation (more even edges than flat subdivision), shared along the
 * icosahedron's edges. Outward, counter-clockwise.
 */
export function icosphere(radius: number, targetEdge: number): TriMesh {
  const mean = radius * IcoMeanEdge;
  const k0 = Math.max(1, Math.floor(mean / targetEdge));
  const k = Math.abs(mean / k0 - targetEdge) <= Math.abs(mean / (k0 + 1) - targetEdge) ? k0 : k0 + 1;

  const vertexCount = 10 * k * k + 2;
  const unit = new Float64Array(vertexCount * 3);
  for (let i = 0; i < 12; i++) {
    const x = IcoVertices[3 * i],
      y = IcoVertices[3 * i + 1],
      z = IcoVertices[3 * i + 2];
    const l = Math.hypot(x, y, z);
    unit[3 * i] = x / l;
    unit[3 * i + 1] = y / l;
    unit[3 * i + 2] = z / l;
  }
  let next = 12;

  // The 30 edges, each with its k - 1 inner points, indexed once (from the lower corner to the higher).
  const edgeBase = new Map<number, number>();
  for (let f = 0; f < 20; f++) {
    for (let e = 0; e < 3; e++) {
      const u = IcoFaces[3 * f + e],
        w = IcoFaces[3 * f + ((e + 1) % 3)];
      const lo = Math.min(u, w),
        hi = Math.max(u, w);
      const key = lo * 12 + hi;
      if (edgeBase.has(key)) continue;
      edgeBase.set(key, next);
      for (let s = 1; s < k; s++) slerp(unit, 3 * next++, unit, 3 * lo, unit, 3 * hi, s / k);
    }
  }
  /** The point at step s of k along the edge from corner u to corner w. */
  const edgePoint = (u: number, w: number, s: number) => {
    if (s === 0) return u;
    if (s === k) return w;
    const base = edgeBase.get(Math.min(u, w) * 12 + Math.max(u, w))!;
    return u < w ? base + s - 1 : base + k - s - 1;
  };

  const indices = new Uint32Array(20 * k * k * 3);
  const local = new Int32Array(((k + 1) * (k + 2)) / 2);
  let t = 0;
  for (let f = 0; f < 20; f++) {
    let a = IcoFaces[3 * f],
      b = IcoFaces[3 * f + 1],
      c = IcoFaces[3 * f + 2];
    // Orient outward: the face normal along the face center.
    const ax = unit[3 * a],
      ay = unit[3 * a + 1],
      az = unit[3 * a + 2];
    const e1x = unit[3 * b] - ax,
      e1y = unit[3 * b + 1] - ay,
      e1z = unit[3 * b + 2] - az;
    const e2x = unit[3 * c] - ax,
      e2y = unit[3 * c + 1] - ay,
      e2z = unit[3 * c + 2] - az;
    const nx = e1y * e2z - e1z * e2y,
      ny = e1z * e2x - e1x * e2z,
      nz = e1x * e2y - e1y * e2x;
    if (nx * ax + ny * ay + nz * az < 0) {
      const s = b;
      b = c;
      c = s;
    }
    // Row i from a (0) to the edge bc (k); column j from the side ab (0) to the side ac (i).
    for (let i = 0; i <= k; i++) {
      const row = (i * (i + 1)) / 2;
      local[row] = edgePoint(a, b, i);
      if (i > 0) local[row + i] = edgePoint(a, c, i);
      if (i === k) {
        for (let j = 1; j < k; j++) local[row + j] = edgePoint(b, c, j);
      } else {
        for (let j = 1; j < i; j++) {
          slerp(unit, 3 * next, unit, 3 * local[row], unit, 3 * local[row + i], j / i);
          local[row + j] = next++;
        }
      }
    }
    for (let i = 0; i < k; i++) {
      const r0 = (i * (i + 1)) / 2,
        r1 = ((i + 1) * (i + 2)) / 2;
      for (let j = 0; j <= i; j++) {
        indices[t++] = local[r0 + j];
        indices[t++] = local[r1 + j];
        indices[t++] = local[r1 + j + 1];
        if (j < i) {
          indices[t++] = local[r0 + j];
          indices[t++] = local[r1 + j + 1];
          indices[t++] = local[r0 + j + 1];
        }
      }
    }
  }

  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = unit[i] * radius;
  return { positions, indices };
}

// ---------------------------------------------------------------------------------------------------------------------
// Offset and stats

/** Each vertex moved by `distance` along its area-weighted vertex normal; same indices. */
export function offsetSurface(mesh: TriMesh, distance: number): TriMesh {
  const { positions: p, indices: ix } = mesh;
  const n = new Float64Array(p.length);
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t],
      b = 3 * ix[t + 1],
      c = 3 * ix[t + 2];
    const e1x = p[b] - p[a],
      e1y = p[b + 1] - p[a + 1],
      e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a],
      e2y = p[c + 1] - p[a + 1],
      e2z = p[c + 2] - p[a + 2];
    // The cross product's length is twice the area: area-weighted.
    const nx = e1y * e2z - e1z * e2y,
      ny = e1z * e2x - e1x * e2z,
      nz = e1x * e2y - e1y * e2x;
    n[a] += nx;
    n[a + 1] += ny;
    n[a + 2] += nz;
    n[b] += nx;
    n[b + 1] += ny;
    n[b + 2] += nz;
    n[c] += nx;
    n[c + 1] += ny;
    n[c + 2] += nz;
  }
  const positions = new Float32Array(p.length);
  for (let v = 0; v < p.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]);
    const s = l > 0 ? distance / l : 0;
    positions[v] = p[v] + n[v] * s;
    positions[v + 1] = p[v + 1] + n[v + 1] * s;
    positions[v + 2] = p[v + 2] + n[v + 2] * s;
  }
  return { positions, indices: mesh.indices };
}

/** Edge lengths, angles and topology of a mesh. */
export function meshStats(mesh: TriMesh): MeshStats {
  const { positions: p, indices: ix } = mesh;
  const vertexCount = p.length / 3;
  const triangleCount = ix.length / 3;
  const edgeFaces = new Map<number, number>();
  let edgeMin = Infinity,
    edgeMax = 0,
    edgeSum = 0;
  let minAngle = Math.PI,
    below30 = 0;
  const cos30 = Math.cos(Math.PI / 6);
  for (let t = 0; t < ix.length; t += 3) {
    let triMin = Math.PI;
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e],
        b = ix[t + ((e + 1) % 3)],
        c = ix[t + ((e + 2) % 3)];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const count = edgeFaces.get(key);
      if (count === undefined) {
        const l = Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
        edgeMin = Math.min(edgeMin, l);
        edgeMax = Math.max(edgeMax, l);
        edgeSum += l;
      }
      edgeFaces.set(key, (count ?? 0) + 1);
      // The angle at a.
      const ux = p[3 * b] - p[3 * a],
        uy = p[3 * b + 1] - p[3 * a + 1],
        uz = p[3 * b + 2] - p[3 * a + 2];
      const vx = p[3 * c] - p[3 * a],
        vy = p[3 * c + 1] - p[3 * a + 1],
        vz = p[3 * c + 2] - p[3 * a + 2];
      const d = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
      const cos = d > 0 ? (ux * vx + uy * vy + uz * vz) / d : 1;
      triMin = Math.min(triMin, Math.acos(Math.min(1, Math.max(-1, cos))));
    }
    minAngle = Math.min(minAngle, triMin);
    if (Math.cos(triMin) > cos30) below30++;
  }
  let boundaryEdges = 0,
    nonManifoldEdges = 0;
  for (const c of edgeFaces.values()) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
  }
  const edgeCount = edgeFaces.size;
  return {
    vertexCount,
    triangleCount,
    edgeMin: edgeCount ? edgeMin : 0,
    edgeMean: edgeCount ? edgeSum / edgeCount : 0,
    edgeMax,
    minAngleDeg: triangleCount ? (minAngle * 180) / Math.PI : 0,
    angleBelow30Fraction: triangleCount ? below30 / triangleCount : 0,
    boundaryEdges,
    nonManifoldEdges,
    eulerCharacteristic: vertexCount - edgeCount + triangleCount,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Closest point on the input surface: a uniform grid built once

/** Ericson, Real-Time Collision Detection §5.1.5; writes the point into `out`, returns the squared distance. */
function closestOnTriangle(
  px: number,
  py: number,
  pz: number,
  p: Float64Array,
  a: number,
  b: number,
  c: number,
  out: Float64Array,
) {
  const ax = p[a],
    ay = p[a + 1],
    az = p[a + 2];
  const abx = p[b] - ax,
    aby = p[b + 1] - ay,
    abz = p[b + 2] - az;
  const acx = p[c] - ax,
    acy = p[c + 1] - ay,
    acz = p[c + 2] - az;
  let x: number, y: number, z: number;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz,
    d2 = acx * apx + acy * apy + acz * apz;
  const bpx = px - p[b],
    bpy = py - p[b + 1],
    bpz = pz - p[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz,
    d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = px - p[c],
    cpy = py - p[c + 1],
    cpz = pz - p[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz,
    d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2,
    vb = d5 * d2 - d1 * d6,
    va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) {
    x = ax;
    y = ay;
    z = az;
  } else if (d3 >= 0 && d4 <= d3) {
    x = p[b];
    y = p[b + 1];
    z = p[b + 2];
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    x = ax + v * abx;
    y = ay + v * aby;
    z = az + v * abz;
  } else if (d6 >= 0 && d5 <= d6) {
    x = p[c];
    y = p[c + 1];
    z = p[c + 2];
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    x = ax + w * acx;
    y = ay + w * acy;
    z = az + w * acz;
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    x = p[b] + w * (p[c] - p[b]);
    y = p[b + 1] + w * (p[c + 1] - p[b + 1]);
    z = p[b + 2] + w * (p[c + 2] - p[b + 2]);
  } else {
    const den = 1 / (va + vb + vc);
    const v = vb * den,
      w = vc * den;
    x = ax + abx * v + acx * w;
    y = ay + aby * v + acy * w;
    z = az + abz * v + acz * w;
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
}

interface SurfaceGrid {
  closest(x: number, y: number, z: number, out: Float64Array): void;
}

function surfaceGrid(mesh: TriMesh): SurfaceGrid {
  const p = Float64Array.from(mesh.positions);
  const ix = mesh.indices;
  const nt = ix.length / 3;
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    z0 = Math.min(z0, p[i + 2]);
    x1 = Math.max(x1, p[i]);
    y1 = Math.max(y1, p[i + 1]);
    z1 = Math.max(z1, p[i + 2]);
  }
  let edgeSum = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t],
      b = 3 * ix[t + 1];
    edgeSum += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
  }
  // Cells about a triangle's size, but never more than ~4 cells a triangle.
  const ex = x1 - x0,
    ey = y1 - y0,
    ez = z1 - z0;
  const volume = Math.max(ex, 1e-6) * Math.max(ey, 1e-6) * Math.max(ez, 1e-6);
  const cell = Math.max(edgeSum / Math.max(1, nt), Math.cbrt(volume / (4 * Math.max(1, nt))), 1e-6);
  const nx = Math.max(1, Math.ceil(ex / cell) + 1),
    ny = Math.max(1, Math.ceil(ey / cell) + 1),
    nz = Math.max(1, Math.ceil(ez / cell) + 1);
  const cellOf = (v: number, o: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - o) / cell)));

  // Counting sort of (cell, triangle) pairs over the cells each triangle's box overlaps.
  const counts = new Int32Array(nx * ny * nz + 1);
  const box = new Int32Array(6 * nt);
  for (let t = 0; t < nt; t++) {
    const a = 3 * ix[3 * t],
      b = 3 * ix[3 * t + 1],
      c = 3 * ix[3 * t + 2];
    const o = 6 * t;
    box[o] = cellOf(Math.min(p[a], p[b], p[c]), x0, nx);
    box[o + 1] = cellOf(Math.min(p[a + 1], p[b + 1], p[c + 1]), y0, ny);
    box[o + 2] = cellOf(Math.min(p[a + 2], p[b + 2], p[c + 2]), z0, nz);
    box[o + 3] = cellOf(Math.max(p[a], p[b], p[c]), x0, nx);
    box[o + 4] = cellOf(Math.max(p[a + 1], p[b + 1], p[c + 1]), y0, ny);
    box[o + 5] = cellOf(Math.max(p[a + 2], p[b + 2], p[c + 2]), z0, nz);
    for (let k = box[o + 2]; k <= box[o + 5]; k++)
      for (let j = box[o + 1]; j <= box[o + 4]; j++)
        for (let i = box[o]; i <= box[o + 3]; i++) counts[(k * ny + j) * nx + i + 1]++;
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const cellTris = new Int32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, counts.length - 1);
  for (let t = 0; t < nt; t++) {
    const o = 6 * t;
    for (let k = box[o + 2]; k <= box[o + 5]; k++)
      for (let j = box[o + 1]; j <= box[o + 4]; j++)
        for (let i = box[o]; i <= box[o + 3]; i++) cellTris[fill[(k * ny + j) * nx + i]++] = t;
  }

  const seen = new Int32Array(nt);
  let stamp = 0;
  const tmp = new Float64Array(3);
  const maxRing = Math.max(nx, ny, nz);
  return {
    closest(x, y, z, out) {
      stamp++;
      const ci = cellOf(x, x0, nx),
        cj = cellOf(y, y0, ny),
        ck = cellOf(z, z0, nz);
      let best = Infinity;
      // Rings of cells around the point's cell; ring r + 1 is at least r cells away.
      for (let r = 0; r <= maxRing; r++) {
        for (let k = Math.max(0, ck - r); k <= Math.min(nz - 1, ck + r); k++) {
          for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++) {
            for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
              if (Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
              const c = (k * ny + j) * nx + i;
              for (let q = counts[c]; q < counts[c + 1]; q++) {
                const t = cellTris[q];
                if (seen[t] === stamp) continue;
                seen[t] = stamp;
                const d = closestOnTriangle(x, y, z, p, 3 * ix[3 * t], 3 * ix[3 * t + 1], 3 * ix[3 * t + 2], tmp);
                if (d < best) {
                  best = d;
                  out[0] = tmp[0];
                  out[1] = tmp[1];
                  out[2] = tmp[2];
                }
              }
            }
          }
        }
        if (best <= r * cell * (r * cell)) return;
      }
      if (best === Infinity) {
        out[0] = x;
        out[1] = y;
        out[2] = z;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Isotropic remeshing (Botsch & Kobbelt 2004)

const next = (h: number) => (h % 3 === 2 ? h - 2 : h + 1);
const prev = (h: number) => (h % 3 === 0 ? h + 2 : h - 1);

/**
 * A corner table: halfedge h = 3·face + corner goes from V[h] to V[next(h)]; O[h] is its opposite (-1 on a boundary).
 * A deleted face has V = -1 at its corners, a deleted vertex VH = -1.
 */
class Corners {
  readonly P: number[] = [];
  readonly V: number[] = [];
  readonly O: number[] = [];
  /** One outgoing halfedge a vertex. */
  readonly VH: number[] = [];
  /** Boundary vertices stay fixed. */
  readonly B: number[] = [];

  constructor(mesh: TriMesh) {
    const { positions, indices } = mesh;
    const nv = positions.length / 3;
    for (let i = 0; i < positions.length; i++) this.P.push(positions[i]);
    for (let v = 0; v < nv; v++) {
      this.VH.push(-1);
      this.B.push(0);
    }
    const open = new Map<number, number>();
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t],
        b = indices[t + 1],
        c = indices[t + 2];
      if (a === b || b === c || a === c) continue;
      this.V.push(a, b, c);
      this.O.push(-1, -1, -1);
    }
    const V = this.V,
      O = this.O;
    for (let h = 0; h < V.length; h++) {
      const a = V[h],
        b = V[next(h)];
      const twin = open.get(b * nv + a);
      if (twin !== undefined) {
        O[h] = twin;
        O[twin] = h;
        open.delete(b * nv + a);
      } else if (!open.has(a * nv + b)) {
        open.set(a * nv + b, h);
      }
      this.VH[a] = h;
    }
    for (let h = 0; h < V.length; h++) {
      if (O[h] >= 0) continue;
      this.B[V[h]] = 1;
      this.B[V[next(h)]] = 1;
    }
    // Vertices used by no face are not moved.
    for (let v = 0; v < nv; v++) if (this.VH[v] < 0) this.B[v] = 1;
  }

  get vertexCount() {
    return this.VH.length;
  }

  len2(a: number, b: number) {
    const P = this.P;
    const dx = P[3 * a] - P[3 * b],
      dy = P[3 * a + 1] - P[3 * b + 1],
      dz = P[3 * a + 2] - P[3 * b + 2];
    return dx * dx + dy * dy + dz * dz;
  }

  /** The outgoing halfedges of v, one a face, in `out`. */
  ring(v: number, out: number[]) {
    out.length = 0;
    const h0 = this.VH[v];
    if (h0 < 0) return out;
    const O = this.O;
    let h = h0;
    for (let guard = 0; guard < 4096; guard++) {
      out.push(h);
      const t = O[prev(h)];
      if (t < 0) {
        // Open fan: walk back the other way from the start.
        let g = h0;
        for (let back = 0; back < 4096; back++) {
          const o = O[g];
          if (o < 0) break;
          g = next(o);
          if (g === h0) break;
          out.push(g);
        }
        return out;
      }
      h = t;
      if (h === h0) return out;
    }
    return out;
  }

  link(a: number, b: number) {
    if (a >= 0) this.O[a] = b;
    if (b >= 0) this.O[b] = a;
  }

  addVertex(x: number, y: number, z: number) {
    this.P.push(x, y, z);
    this.VH.push(-1);
    this.B.push(0);
    return this.VH.length - 1;
  }

  /** Split the edge of h at its midpoint: (v0, v1, a) → (v0, m, a) + (m, v1, a), and the same on the other side. */
  split(h: number) {
    const { V, P } = this;
    const o = this.O[h];
    const hn = next(h),
      hp = prev(h),
      on = next(o),
      op = prev(o);
    const v0 = V[h],
      v1 = V[hn],
      a = V[hp],
      b = V[op];
    const A1 = this.O[hn],
      B0 = this.O[on];
    const m = this.addVertex(
      (P[3 * v0] + P[3 * v1]) / 2,
      (P[3 * v0 + 1] + P[3 * v1 + 1]) / 2,
      (P[3 * v0 + 2] + P[3 * v1 + 2]) / 2,
    );
    const e = V.length,
      d = e + 3;
    V.push(m, v1, a, m, v0, b);
    this.O.push(-1, -1, -1, -1, -1, -1);
    V[hn] = m;
    V[on] = m;
    this.link(h, d);
    this.link(o, e);
    this.link(e + 1, A1);
    this.link(hn, e + 2);
    this.link(d + 1, B0);
    this.link(on, d + 2);
    this.VH[m] = hn;
    this.VH[v1] = e + 1;
    this.VH[v0] = d + 1;
    this.VH[a] = hp;
    this.VH[b] = op;
  }
}

class Remesher {
  readonly m: Corners;
  private readonly r0: number[] = [];
  private readonly r1: number[] = [];
  private readonly r2: number[] = [];
  private mark: number[] = [];
  private stamp = 0;
  private valence: number[] = [];

  private readonly grid: SurfaceGrid;
  private readonly high2: number;
  private readonly low2: number;

  constructor(mesh: TriMesh, grid: SurfaceGrid, targetEdge: number) {
    this.m = new Corners(mesh);
    this.grid = grid;
    this.high2 = ((4 / 3) * targetEdge) ** 2;
    this.low2 = ((4 / 5) * targetEdge) ** 2;
  }

  /** Split the long edges, longest first (longest-edge bisection keeps the angles), those present at the start. */
  splitLong() {
    const m = this.m;
    const { V, O } = m;
    const candidates: number[] = [];
    for (let h = 0; h < V.length; h++) {
      if (V[h] < 0 || O[h] < h) continue;
      if (m.len2(V[h], V[next(h)]) > this.high2) candidates.push(h);
    }
    const length = new Float64Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) length[i] = m.len2(V[candidates[i]], V[next(candidates[i])]);
    const order = new Int32Array(candidates.length);
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((i, j) => length[j] - length[i] || candidates[i] - candidates[j]);
    let count = 0;
    for (let i = 0; i < order.length; i++) {
      const h = candidates[order[i]];
      // A split earlier in the pass may have moved this halfedge to another edge.
      if (O[h] < h || m.len2(V[h], V[next(h)]) <= this.high2) continue;
      m.split(h);
      count++;
    }
    return count;
  }

  collapseShort() {
    const m = this.m;
    let count = 0;
    for (let h = 0; h < m.V.length; h++) {
      const o = m.O[h];
      if (m.V[h] < 0 || o < 0) continue;
      const v0 = m.V[h],
        v1 = m.V[next(h)];
      if (m.B[v0] || m.B[v1]) continue;
      if (m.len2(v0, v1) >= this.low2) continue;
      if (this.tryCollapse(h)) count++;
    }
    return count;
  }

  private faceNormalCheck(ring: number[], from: number, f0: number, f1: number, x: number, y: number, z: number) {
    const { V, P } = this.m;
    for (const g of ring) {
      const f = g - (g % 3);
      if (f === f0 || f === f1) continue;
      const b = V[next(g)],
        c = V[prev(g)];
      const bx = P[3 * b],
        by = P[3 * b + 1],
        bz = P[3 * b + 2];
      const cx = P[3 * c],
        cy = P[3 * c + 1],
        cz = P[3 * c + 2];
      const ox = P[3 * from],
        oy = P[3 * from + 1],
        oz = P[3 * from + 2];
      // Old normal (b - o) × (c - o), new normal (b - p) × (c - p).
      let ux = bx - ox,
        uy = by - oy,
        uz = bz - oz,
        vx = cx - ox,
        vy = cy - oy,
        vz = cz - oz;
      const n0x = uy * vz - uz * vy,
        n0y = uz * vx - ux * vz,
        n0z = ux * vy - uy * vx;
      ux = bx - x;
      uy = by - y;
      uz = bz - z;
      vx = cx - x;
      vy = cy - y;
      vz = cz - z;
      const n1x = uy * vz - uz * vy,
        n1y = uz * vx - ux * vz,
        n1z = ux * vy - uy * vx;
      const l0 = Math.hypot(n0x, n0y, n0z),
        l1 = Math.hypot(n1x, n1y, n1z);
      if (l1 < 1e-12 * (l0 + 1e-30)) return false;
      if (n0x * n1x + n0y * n1y + n0z * n1z < 0.2 * l0 * l1) return false;
    }
    return true;
  }

  /** Collapse h's start v0 into its end v1, moved to the edge's midpoint; false if rejected. */
  private tryCollapse(h: number) {
    const m = this.m;
    const { V, O, P } = m;
    const o = O[h];
    const v0 = V[h],
      v1 = V[next(h)],
      a = V[prev(h)],
      b = V[prev(o)];
    if (a === b) return false;
    const r0 = m.ring(v0, this.r0);
    const r1 = m.ring(v1, this.r1);
    // Link condition: v0 and v1 share exactly the two neighbors a and b.
    const s = this.nextStamp();
    for (const g of r0) this.mark[V[next(g)]] = s;
    let shared = 0;
    for (const g of r1) {
      const w = V[next(g)];
      if (w !== v0 && this.mark[w] === s) shared++;
    }
    if (shared !== 2) return false;
    // a and b keep a valence of 3 at least (never below a tetrahedron).
    if (m.ring(a, this.r2).length <= 3 || m.ring(b, this.r2).length <= 3) return false;
    const x = (P[3 * v0] + P[3 * v1]) / 2,
      y = (P[3 * v0 + 1] + P[3 * v1 + 1]) / 2,
      z = (P[3 * v0 + 2] + P[3 * v1 + 2]) / 2;
    // No edge longer than the split bound.
    for (let pass = 0; pass < 2; pass++) {
      for (const g of pass ? r1 : r0) {
        const w = V[next(g)];
        if (w === v0 || w === v1) continue;
        const dx = P[3 * w] - x,
          dy = P[3 * w + 1] - y,
          dz = P[3 * w + 2] - z;
        if (dx * dx + dy * dy + dz * dz > this.high2) return false;
      }
    }
    const f = h - (h % 3),
      g = o - (o % 3);
    if (!this.faceNormalCheck(r0, v0, f, g, x, y, z) || !this.faceNormalCheck(r1, v1, f, g, x, y, z)) return false;

    const hn = next(h),
      hp = prev(h),
      on = next(o),
      op = prev(o);
    const X = O[hn],
      Y = O[hp],
      Z = O[on],
      W = O[op];
    for (const e of r0) V[e] = v1;
    m.link(X, Y);
    m.link(Z, W);
    for (let i = 0; i < 3; i++) {
      V[f + i] = -1;
      O[f + i] = -1;
      V[g + i] = -1;
      O[g + i] = -1;
    }
    m.VH[v0] = -1;
    m.VH[v1] = Y;
    m.VH[a] = X;
    m.VH[b] = Z;
    P[3 * v1] = x;
    P[3 * v1 + 1] = y;
    P[3 * v1 + 2] = z;
    return true;
  }

  private nextStamp() {
    const n = this.m.vertexCount;
    while (this.mark.length < n) this.mark.push(0);
    return ++this.stamp;
  }

  /** Flip edges that bring the valences of their four vertices toward 6 (4 on a boundary). */
  equalizeValences() {
    const m = this.m;
    const { V, O, P, B } = m;
    const val = this.valence;
    val.length = 0;
    for (let v = 0; v < m.vertexCount; v++) val.push(0);
    for (let h = 0; h < V.length; h++) {
      if (V[h] < 0 || (O[h] >= 0 && O[h] < h)) continue;
      val[V[h]]++;
      val[V[next(h)]]++;
    }
    let count = 0;
    for (let h = 0; h < V.length; h++) {
      const o = O[h];
      if (V[h] < 0 || o < h) continue;
      const v0 = V[h],
        v1 = V[next(h)],
        a = V[prev(h)],
        b = V[prev(o)];
      if (a === b || val[v0] <= 3 || val[v1] <= 3) continue;
      const t0 = B[v0] ? 4 : 6,
        t1 = B[v1] ? 4 : 6,
        ta = B[a] ? 4 : 6,
        tb = B[b] ? 4 : 6;
      const before = Math.abs(val[v0] - t0) + Math.abs(val[v1] - t1) + Math.abs(val[a] - ta) + Math.abs(val[b] - tb);
      const after =
        Math.abs(val[v0] - 1 - t0) + Math.abs(val[v1] - 1 - t1) + Math.abs(val[a] + 1 - ta) + Math.abs(val[b] + 1 - tb);
      if (after >= before) continue;
      // The edge a-b must not exist yet.
      let exists = false;
      for (const g of m.ring(a, this.r0)) {
        if (V[next(g)] === b || V[prev(g)] === b) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      // The new triangles (v0, b, a) and (b, v1, a) keep the side of the old pair.
      const n0 = triNormalDot(P, v0, v1, a, v1, v0, b, v0, b, a);
      const n1 = triNormalDot(P, v0, v1, a, v1, v0, b, b, v1, a);
      if (n0 <= 0 || n1 <= 0) continue;

      const f = h - (h % 3),
        g = o - (o % 3);
      const A0 = O[prev(h)],
        A1 = O[next(h)],
        B0 = O[next(o)],
        B1 = O[prev(o)];
      V[f] = v0;
      V[f + 1] = b;
      V[f + 2] = a;
      V[g] = b;
      V[g + 1] = v1;
      V[g + 2] = a;
      m.link(f, B0);
      m.link(f + 1, g + 2);
      m.link(f + 2, A0);
      m.link(g, B1);
      m.link(g + 1, A1);
      m.VH[v0] = f;
      m.VH[b] = f + 1;
      m.VH[a] = f + 2;
      m.VH[v1] = g + 1;
      val[v0]--;
      val[v1]--;
      val[a]++;
      val[b]++;
      count++;
    }
    return count;
  }

  /** Move each free vertex to the area-weighted center of its neighbors, within its tangent plane. */
  tangentialSmoothing() {
    const m = this.m;
    const { V, P, B } = m;
    const n = m.vertexCount;
    const area = new Float64Array(n);
    const normal = new Float64Array(3 * n);
    for (let f = 0; f < V.length; f += 3) {
      const a = V[f];
      if (a < 0) continue;
      const b = V[f + 1],
        c = V[f + 2];
      const ux = P[3 * b] - P[3 * a],
        uy = P[3 * b + 1] - P[3 * a + 1],
        uz = P[3 * b + 2] - P[3 * a + 2];
      const vx = P[3 * c] - P[3 * a],
        vy = P[3 * c + 1] - P[3 * a + 1],
        vz = P[3 * c + 2] - P[3 * a + 2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const A = Math.hypot(nx, ny, nz) / 6;
      for (let i = 0; i < 3; i++) {
        const v = V[f + i];
        area[v] += A;
        normal[3 * v] += nx;
        normal[3 * v + 1] += ny;
        normal[3 * v + 2] += nz;
      }
    }
    const moved = new Float64Array(3 * n);
    for (let v = 0; v < n; v++) {
      const px = P[3 * v],
        py = P[3 * v + 1],
        pz = P[3 * v + 2];
      moved[3 * v] = px;
      moved[3 * v + 1] = py;
      moved[3 * v + 2] = pz;
      if (B[v] || m.VH[v] < 0) continue;
      let sx = 0,
        sy = 0,
        sz = 0,
        sw = 0;
      for (const g of m.ring(v, this.r0)) {
        const w = V[next(g)];
        const a = area[w];
        sx += a * P[3 * w];
        sy += a * P[3 * w + 1];
        sz += a * P[3 * w + 2];
        sw += a;
      }
      if (sw <= 0) continue;
      let dx = sx / sw - px,
        dy = sy / sw - py,
        dz = sz / sw - pz;
      const nl = Math.hypot(normal[3 * v], normal[3 * v + 1], normal[3 * v + 2]);
      if (nl > 0) {
        const nx = normal[3 * v] / nl,
          ny = normal[3 * v + 1] / nl,
          nz = normal[3 * v + 2] / nl;
        const d = dx * nx + dy * ny + dz * nz;
        dx -= d * nx;
        dy -= d * ny;
        dz -= d * nz;
      }
      moved[3 * v] = px + dx;
      moved[3 * v + 1] = py + dy;
      moved[3 * v + 2] = pz + dz;
    }
    for (let i = 0; i < 3 * n; i++) P[i] = moved[i];
  }

  /** Every free vertex back onto the input surface. */
  project() {
    const m = this.m;
    const P = m.P;
    const out = new Float64Array(3);
    for (let v = 0; v < m.vertexCount; v++) {
      if (m.B[v] || m.VH[v] < 0) continue;
      this.grid.closest(P[3 * v], P[3 * v + 1], P[3 * v + 2], out);
      P[3 * v] = out[0];
      P[3 * v + 1] = out[1];
      P[3 * v + 2] = out[2];
    }
  }

  /** The live faces and the vertices they use, renumbered in first-use order. */
  toMesh(): TriMesh {
    const { V, P } = this.m;
    const map = new Int32Array(this.m.vertexCount).fill(-1);
    let nv = 0,
      nt = 0;
    for (let h = 0; h < V.length; h += 3) {
      if (V[h] < 0) continue;
      nt++;
      for (let i = 0; i < 3; i++) if (map[V[h + i]] < 0) map[V[h + i]] = nv++;
    }
    const positions = new Float32Array(3 * nv);
    const indices = new Uint32Array(3 * nt);
    let t = 0;
    for (let h = 0; h < V.length; h += 3) {
      if (V[h] < 0) continue;
      for (let i = 0; i < 3; i++) {
        const v = V[h + i],
          w = map[v];
        indices[t++] = w;
        positions[3 * w] = P[3 * v];
        positions[3 * w + 1] = P[3 * v + 1];
        positions[3 * w + 2] = P[3 * v + 2];
      }
    }
    return { positions, indices };
  }
}

/** The sign of (normal of the new triangle n) · (sum of the old triangles' normals o1 + o2). */
function triNormalDot(
  P: number[],
  a1: number,
  b1: number,
  c1: number,
  a2: number,
  b2: number,
  c2: number,
  a: number,
  b: number,
  c: number,
) {
  const n = (i: number, j: number, k: number, out: number[]) => {
    const ux = P[3 * j] - P[3 * i],
      uy = P[3 * j + 1] - P[3 * i + 1],
      uz = P[3 * j + 2] - P[3 * i + 2];
    const vx = P[3 * k] - P[3 * i],
      vy = P[3 * k + 1] - P[3 * i + 1],
      vz = P[3 * k + 2] - P[3 * i + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
  };
  n(a1, b1, c1, N1);
  n(a2, b2, c2, N2);
  n(a, b, c, N3);
  return N3[0] * (N1[0] + N2[0]) + N3[1] * (N1[1] + N2[1]) + N3[2] * (N1[2] + N2[2]) - 0.2;
}
const N1 = [0, 0, 0],
  N2 = [0, 0, 0],
  N3 = [0, 0, 0];

/**
 * The mesh with its vertices at the same position (within `tolerance`, Å) merged and the triangles this collapses
 * dropped: OBJ and STL exports duplicate a vertex per normal or per face, which leaves every edge a boundary. One pass,
 * a hash of the quantized position chained in typed arrays (no allocation a vertex).
 */
export function weldVertices(mesh: TriMesh, tolerance = 1e-3): TriMesh {
  const { positions: p, indices: ix } = mesh;
  const n = p.length / 3;
  const heads = new Map<number, number>();
  const next = new Int32Array(n).fill(-1);
  const remap = new Uint32Array(n);
  const kept = new Int32Array(n);
  let count = 0;
  const q = 1 / tolerance;
  for (let v = 0; v < n; ++v) {
    const x = p[3 * v],
      y = p[3 * v + 1],
      z = p[3 * v + 2];
    const key = hash3(Math.round(x * q), Math.round(y * q), Math.round(z * q));
    let w = heads.get(key) ?? -1;
    while (w >= 0) {
      const k = kept[w];
      if (
        Math.abs(p[3 * k] - x) <= tolerance &&
        Math.abs(p[3 * k + 1] - y) <= tolerance &&
        Math.abs(p[3 * k + 2] - z) <= tolerance
      )
        break;
      w = next[w];
    }
    if (w < 0) {
      w = count++;
      kept[w] = v;
      next[w] = heads.get(key) ?? -1;
      heads.set(key, w);
    }
    remap[v] = w;
  }
  if (count === n) return mesh;
  const positions = new Float32Array(count * 3);
  for (let w = 0; w < count; ++w) positions.set(p.subarray(3 * kept[w], 3 * kept[w] + 3), 3 * w);
  const out = new Uint32Array(ix.length);
  let m = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = remap[ix[t]],
      b = remap[ix[t + 1]],
      c = remap[ix[t + 2]];
    if (a === b || b === c || c === a) continue;
    out[m++] = a;
    out[m++] = b;
    out[m++] = c;
  }
  return { positions, indices: out.slice(0, m) };
}

/**
 * Isotropic remeshing toward edge length `targetEdge` (Botsch & Kobbelt 2004): per iteration, split edges over 4/3 L,
 * collapse edges under 4/5 L, flip edges toward valence 6, smooth tangentially (area-weighted), project back onto the
 * input surface, its duplicate vertices welded first (`weldVertices`). Boundary edges and vertices are kept fixed.
 * Keeps the input's orientation; the output has no unused vertices.
 */
export function isotropicRemesh(input: TriMesh, targetEdge: number, options?: { iterations?: number }): TriMesh {
  const steps = isotropicRemeshSteps(input, targetEdge, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** `isotropicRemesh` a pass at a time: yields its iteration (of `iterations`) after each pass (a task yields there) */
export function* isotropicRemeshSteps(
  input: TriMesh,
  targetEdge: number,
  options?: { iterations?: number },
): Generator<number, TriMesh> {
  const iterations = options?.iterations ?? 5;
  const mesh = weldVertices(input);
  const grid = surfaceGrid(mesh);
  const r = new Remesher(mesh, grid, targetEdge);
  yield 0;
  for (let it = 0; it < iterations; it++) {
    for (let pass = 0; pass < 64 && r.splitLong() > 0; pass++) yield it;
    for (let pass = 0; pass < 8 && r.collapseShort() > 0; pass++) yield it;
    for (let pass = 0; pass < 4 && r.equalizeValences() > 0; pass++) yield it;
    r.tangentialSmoothing();
    yield it;
    r.project();
    yield it;
  }
  return r.toMesh();
}

/**
 * The triangles of `input` whose center lies farther than `distance` from `surface` (a remesh of it): the parts a remesh
 * lost (a limb thinner than its edge), O(triangles) through a surface grid. Their indices, as a mesh of `input`'s
 * positions
 */
export function farTriangles(input: TriMesh, surface: TriMesh, distance: number): TriMesh {
  const grid = surfaceGrid(surface);
  const p = input.positions;
  const ix = input.indices;
  const at = new Float64Array(3);
  const kept: number[] = [];
  const d2 = distance * distance;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    const x = (p[a] + p[b] + p[c]) / 3;
    const y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    grid.closest(x, y, z, at);
    if ((at[0] - x) ** 2 + (at[1] - y) ** 2 + (at[2] - z) ** 2 > d2) kept.push(ix[t], ix[t + 1], ix[t + 2]);
  }
  return { positions: p, indices: Uint32Array.from(kept) };
}
