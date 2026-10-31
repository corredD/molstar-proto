/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag heavy

import { describe, expect, it } from 'vitest';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { ValueCell } from '@molstar/core/util';
import { Mesh } from '../mesh.js';
import { getMeshTriangleLookup, MeshTrianglePick } from '../triangle-pick.js';

// The triangle lookup's cost by size (.v6/plans/gl/triangle-picking.md): its build at n and 4n triangles about linear,
// its bytes about linear and a fraction of the mesh's own, a pick's time flat. A segmentation's surface: a closed
// sphere of `n` triangles (a membrane's shape and density), as a tomogram's segmentation gives.

/** A UV sphere of radius 500 Å with about `n` triangles, indexed (as a file's mesh) */
function sphere(n: number): Mesh {
  const nv = Math.round(Math.sqrt(n / 4));
  const nu = 2 * nv;
  const vb = new Float32Array((nv + 1) * nu * 3);
  for (let j = 0, k = 0; j <= nv; j++) {
    for (let i = 0; i < nu; i++, k += 3) {
      const th = (j / nv) * Math.PI;
      const ph = (i / nu) * 2 * Math.PI;
      vb[k] = 500 * Math.sin(th) * Math.cos(ph);
      vb[k + 1] = 500 * Math.sin(th) * Math.sin(ph);
      vb[k + 2] = 500 * Math.cos(th);
    }
  }
  const ib = new Uint32Array(nv * nu * 6);
  for (let j = 0, k = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++, k += 6) {
      const a = j * nu + i;
      const b = j * nu + ((i + 1) % nu);
      const c = (j + 1) * nu + ((i + 1) % nu);
      const d = (j + 1) * nu + i;
      ib.set([a, b, c, a, c, d], k);
    }
  }
  const vertexCount = vb.length / 3;
  return Mesh.create(vb, ib, new Float32Array(vb.length), new Float32Array(vertexCount), vertexCount, ib.length / 3);
}

/**
 * The sphere with a floor of `k` wide triangles across its middle (z = 0), each about 50 typical triangles wide: a
 * mesh of mixed sizes (a membrane over a slab)
 */
function withFloor(mesh: Mesh, k: number): Mesh {
  const quads = Math.ceil(Math.sqrt(k / 2));
  const w = 1000 / quads;
  const vb0 = mesh.vertexBuffer.ref.value.subarray(0, mesh.vertexCount * 3);
  const ib0 = mesh.indexBuffer.ref.value.subarray(0, mesh.triangleCount * 3);
  const v0 = mesh.vertexCount;
  const vb = new Float32Array(vb0.length + quads * quads * 12);
  const ib = new Uint32Array(ib0.length + quads * quads * 6);
  vb.set(vb0);
  ib.set(ib0);
  let v = v0;
  let o = vb0.length;
  let t = ib0.length;
  for (let y = 0; y < quads; y++) {
    for (let x = 0; x < quads; x++, v += 4, o += 12, t += 6) {
      const [x0, y0] = [-500 + w * x, -500 + w * y];
      vb.set([x0, y0, 0, x0 + w, y0, 0, x0 + w, y0 + w, 0, x0, y0 + w, 0], o);
      ib.set([v, v + 1, v + 2, v, v + 2, v + 3], t);
    }
  }
  return Mesh.create(vb, ib, new Float32Array(vb.length), new Float32Array(v), v, ib.length / 3);
}

/** The fastest of a few runs (ms) */
function fastest(f: () => void, runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** Rays from outside onto the sphere, each toward a point of it */
function picks(count: number) {
  const out: { ray: Ray3D; near: Vec3 }[] = [];
  for (let i = 0; i < count; i++) {
    const th = Math.acos(1 - (2 * (i + 0.5)) / count);
    const ph = i * 2.399963;
    const dir = Vec3.create(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
    const near = Vec3.scale(Vec3(), dir, 499.9);
    const origin = Vec3.scale(Vec3(), dir, 2000);
    out.push({ ray: Ray3D.create(origin, Vec3.negate(Vec3(), dir)), near });
  }
  return out;
}

function measure(n: number, floor = 0) {
  const mesh = floor ? withFloor(sphere(n), floor) : sphere(n);
  const meshBytes =
    mesh.vertexBuffer.ref.value.byteLength +
    mesh.normalBuffer.ref.value.byteLength +
    mesh.groupBuffer.ref.value.byteLength +
    mesh.indexBuffer.ref.value.byteLength;
  let lookup = getMeshTriangleLookup(mesh);
  const build = fastest(() => {
    // a new version of the vertices: built again
    ValueCell.update(mesh.vertexBuffer, mesh.vertexBuffer.ref.value);
    lookup = getMeshTriangleLookup(mesh);
  });
  const rays = picks(2000);
  const out = MeshTrianglePick();
  const times: number[] = [];
  const visits: number[] = [];
  let hits = 0;
  for (const { ray, near } of rays) {
    const t = performance.now();
    if (lookup.pick(out, ray, near, 2)) hits++;
    times.push(performance.now() - t);
    visits.push(lookup.lastVisited);
  }
  times.sort((a, b) => a - b);
  visits.sort((a, b) => a - b);
  return {
    triangles: mesh.triangleCount,
    build,
    bytes: lookup.byteCount,
    meshBytes,
    p50: times[times.length >> 1],
    p95: times[Math.floor(times.length * 0.95)],
    visitsP95: visits[Math.floor(visits.length * 0.95)],
    hits,
  };
}

describe('mesh triangle lookup, by size', () => {
  it('builds about linearly, holds a fraction of the mesh, picks in a flat time', () => {
    const n = Number(process.env.TRIANGLE_PICK_N) || 250_000;
    const small = measure(n);
    const large = measure(4 * n);
    console.log('triangle lookup', JSON.stringify({ small, large }));
    // every pick finds its triangle
    expect(small.hits).toBe(2000);
    expect(large.hits).toBe(2000);
    // linear: 4×, under 8× (a quadratic reads 16×)
    expect(large.build / small.build).toBeLessThan(8);
    expect(large.bytes / small.bytes).toBeLessThan(5);
    // about 6 bytes a triangle, under the mesh's own (about 26)
    expect(large.bytes).toBeLessThan(large.meshBytes);
    // a pick costs the same at 4×, well under a millisecond
    expect(large.p95).toBeLessThan(1);
  }, 120_000);

  it('stays local with many wide triangles (a floor of n / 1000 across the sphere), at n and 4n', () => {
    const n = Number(process.env.TRIANGLE_PICK_N) || 250_000;
    const small = measure(n, n / 1000);
    const large = measure(4 * n, (4 * n) / 1000);
    console.log('triangle lookup with a floor', JSON.stringify({ small, large }));
    expect(small.hits).toBe(2000);
    expect(large.hits).toBe(2000);
    expect(large.build / small.build).toBeLessThan(8);
    // a pick tests about as many triangles at 4n: what is near it, not the floor's reach into the fine grid
    expect(large.visitsP95).toBeLessThan(2 * small.visitsP95 + 10);
    expect(large.p95).toBeLessThan(1);
  }, 120_000);

  it('the ratio bound catches a quadratic (the guard control)', () => {
    const quadratic = (m: number) =>
      fastest(() => {
        let s = 0;
        for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) s += i ^ j;
        if (s < 0) throw new Error('unreachable');
      });
    expect(quadratic(8000) / quadratic(2000)).toBeGreaterThan(8);
  }, 120_000);
});
