/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet } from '@molstar/core/data/int';
import { ChunkedArray } from '@molstar/core/data/util';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ColorNames } from '@molstar/core/util/color/names';
import { ValueCell } from '@molstar/core/util';
import { Loci } from '@molstar/model/model/loci';
import { ShapeGroup } from '@molstar/model/model/shape';
import * as ShapeUtils from '../../../shape/shape.js';
import { Mesh } from '../mesh.js';
import { MeshBuilder } from '../mesh-builder.js';
import { closestPointOnTriangle, getMeshTriangleLookup, MeshTrianglePick } from '../triangle-pick.js';

/** Two unit squares of two triangles each, one over the other (z 0 and z 1), all in group 0 (one material) */
function layers(): Mesh {
  const state = MeshBuilder.createState(8, 4);
  for (const z of [0, 1]) {
    ChunkedArray.add3(state.vertices, 0, 0, z);
    ChunkedArray.add3(state.vertices, 1, 0, z);
    ChunkedArray.add3(state.vertices, 1, 1, z);
    ChunkedArray.add3(state.vertices, 0, 1, z);
  }
  for (let i = 0; i < 8; i++) {
    ChunkedArray.add3(state.normals, 0, 0, 1);
    ChunkedArray.add(state.groups, 0);
  }
  for (const o of [0, 4]) {
    ChunkedArray.add3(state.indices, o, o + 1, o + 2);
    ChunkedArray.add3(state.indices, o, o + 2, o + 3);
  }
  return MeshBuilder.getMesh(state);
}

const down = (x: number, y: number) => Ray3D.create(Vec3.create(x, y, 5), Vec3.create(0, 0, -1));

describe('mesh triangle lookup', () => {
  it('finds the triangle the ray hits nearest to the depth point, not the first along the ray', () => {
    const lookup = getMeshTriangleLookup(layers());
    const out = MeshTrianglePick();
    // the ray crosses both layers at (0.7, 0.2): the lower triangle of each square (0: z 0, 2: z 1)
    expect(lookup.pick(out, down(0.7, 0.2), Vec3.create(0.7, 0.2, 1), 0.1)).toBe(true);
    expect(out.index).toBe(2);
    // the depth point on the lower layer (the upper one cut away): its triangle
    expect(lookup.pick(out, down(0.7, 0.2), Vec3.create(0.7, 0.2, 0), 0.1)).toBe(true);
    expect(out.index).toBe(0);
    // (0.7, 0.2) = a + u (b - a) + v (c - a) for a (0, 0), b (1, 0), c (1, 1): u 0.5, v 0.2
    expect(out.u).toBeCloseTo(0.5);
    expect(out.v).toBeCloseTo(0.2);
    // the other triangle of the square
    expect(lookup.pick(out, down(0.2, 0.7), Vec3.create(0.2, 0.7, 0), 0.1)).toBe(true);
    expect(out.index).toBe(1);
  });

  it('takes the triangle nearest to the depth point when the ray misses (a pick a pixel off an edge)', () => {
    const lookup = getMeshTriangleLookup(layers());
    const out = MeshTrianglePick();
    expect(lookup.pick(out, down(1.05, 0.2), Vec3.create(1.03, 0.2, 0), 0.1)).toBe(true);
    expect(out.index).toBe(0);
    // too far: none
    expect(lookup.pick(out, down(2, 2), Vec3.create(2, 2, 0), 0.1)).toBe(false);
  });

  it('is built once while the mesh is the same, again when its vertices change', () => {
    const mesh = layers();
    const lookup = getMeshTriangleLookup(mesh);
    expect(getMeshTriangleLookup(mesh)).toBe(lookup);
    ValueCell.update(mesh.vertexBuffer, mesh.vertexBuffer.ref.value);
    expect(getMeshTriangleLookup(mesh)).not.toBe(lookup);
  });

  it('leaves out triangles with a NaN or infinite vertex (a broken file) and picks the others', () => {
    const mesh = layers();
    const vb = mesh.vertexBuffer.ref.value;
    // the upper square's first vertex NaN, its third infinite: its triangles 2 and 3 are out
    vb[4 * 3] = Number.NaN;
    vb[6 * 3 + 1] = Number.POSITIVE_INFINITY;
    ValueCell.update(mesh.vertexBuffer, vb);
    const lookup = getMeshTriangleLookup(mesh);
    const out = MeshTrianglePick();
    expect(lookup.pick(out, down(0.7, 0.2), Vec3.create(0.7, 0.2, 0), 0.1)).toBe(true);
    expect(out.index).toBe(0);
    expect(lookup.pick(out, down(0.2, 0.7), Vec3.create(0.2, 0.7, 0), 0.1)).toBe(true);
    expect(out.index).toBe(1);
  });

  it('a mesh of only broken triangles picks nothing', () => {
    const mesh = layers();
    mesh.vertexBuffer.ref.value.fill(Number.NaN);
    ValueCell.update(mesh.vertexBuffer, mesh.vertexBuffer.ref.value);
    expect(getMeshTriangleLookup(mesh).pick(MeshTrianglePick(), down(0.7, 0.2), Vec3.create(0.7, 0.2, 0), 0.1)).toBe(
      false,
    );
  });

  it('closest point on a triangle: inside, on an edge, at a vertex', () => {
    const a = Vec3.create(0, 0, 0);
    const b = Vec3.create(1, 0, 0);
    const c = Vec3.create(0, 1, 0);
    const out = Vec3();
    const uv = { u: 0, v: 0 };
    closestPointOnTriangle(out, uv, Vec3.create(0.25, 0.25, 3), a, b, c);
    expect([...out]).toEqual([0.25, 0.25, 0]);
    expect(uv).toEqual({ u: 0.25, v: 0.25 });
    closestPointOnTriangle(out, uv, Vec3.create(0.5, -1, 0), a, b, c);
    expect([...out]).toEqual([0.5, 0, 0]);
    closestPointOnTriangle(out, uv, Vec3.create(2, -1, 0), a, b, c);
    expect([...out]).toEqual([1, 0, 0]);
    expect(uv).toEqual({ u: 1, v: 0 });
  });
});

describe('a mesh shape picked by triangle', () => {
  const shapeOf = (transforms?: Mat4[]) =>
    ShapeUtils.enableTrianglePicking(
      ShapeUtils.create(
        'layers',
        {},
        layers(),
        () => ColorNames.red,
        () => 1,
        () => 'Material',
        transforms,
        1,
      ),
    );
  const groupLoci = (shape: ReturnType<typeof shapeOf>, instance = 0) =>
    ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(0), instance }]);

  it('narrows a group pick to the triangle and its point, in a moved and scaled instance', () => {
    // instance 1: scaled 10 times, moved 100 along x
    const m = Mat4.mul(
      Mat4(),
      Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0)),
      Mat4.fromScaling(Mat4(), Vec3.create(10, 10, 10)),
    );
    const shape = shapeOf([Mat4.identity(), m]);
    const ray = Ray3D.create(Vec3.create(107, 2, 50), Vec3.create(0, 0, -1));
    const loci = shape.getTriangleLoci!(groupLoci(shape, 1), ray, Vec3.create(107, 2, 10), 0.5);
    expect(loci.triangles).toEqual([{ instance: 1, index: 2, uv: [expect.closeTo(0.5), expect.closeTo(0.2)] }]);
    // its group kept
    expect(OrderedSet.toArray(loci.groups[0].ids)).toEqual([0]);
    // the point measured is the picked point, in the scene
    const sphere = Loci.getBoundingSphere(loci)!;
    expect(sphere.center[0]).toBeCloseTo(107);
    expect(sphere.center[1]).toBeCloseTo(2);
    expect(sphere.center[2]).toBeCloseTo(10);
    // reaching its vertices: (100, 0), (110, 0), (110, 10) at z 10, the farthest the last
    expect(sphere.radius).toBeCloseTo(Math.hypot(3, 8));
  });

  it("gives the found triangle's own group, not the GPU's (a neighbour material, a vertex group)", () => {
    // the upper square in group 1
    const mesh = layers();
    const gb = mesh.groupBuffer.ref.value;
    for (let i = 4; i < 8; i++) gb[i] = 1;
    ValueCell.update(mesh.groupBuffer, gb);
    const shape = ShapeUtils.enableTrianglePicking(
      ShapeUtils.create('layers', {}, mesh, () => ColorNames.red, () => 1, (g) => `Material ${g}`, undefined, 2),
    );
    // the GPU said group 0; the ray's hit nearest the depth point is triangle 2, of group 1
    const loci = shape.getTriangleLoci!(groupLoci(shape as never), down(0.7, 0.2), Vec3.create(0.7, 0.2, 1), 0.1);
    expect(loci.triangles?.[0].index).toBe(2);
    expect(OrderedSet.toArray(loci.groups[0].ids)).toEqual([1]);
    expect(Loci.areEqual(loci, ShapeUtils.triangleLoci(shape, { instance: 0, index: 2 }))).toBe(true);
  });

  it('keeps the group pick when no triangle is near', () => {
    const shape = shapeOf();
    const loci = groupLoci(shape);
    expect(shape.getTriangleLoci!(loci, down(5, 5), Vec3.create(5, 5, 0), 0.1)).toBe(loci);
  });

  it('a triangle made from its index is in its group, at its centroid without a point', () => {
    const shape = shapeOf();
    const loci = ShapeUtils.triangleLoci(shape, { instance: 0, index: 1 });
    expect(OrderedSet.toArray(loci.groups[0].ids)).toEqual([0]);
    const c = Loci.getBoundingSphere(loci)!.center;
    expect([c[0], c[1], c[2]].map((x) => +x.toFixed(4))).toEqual([0.3333, 0.6667, 0]);
  });
});
