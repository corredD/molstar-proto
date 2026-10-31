/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet } from '@molstar/core/data/int';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Loci } from '../loci.js';
import { lociLabel } from '../label.js';
import { Shape, ShapeGroup } from '../shape.js';

// A triangle of a mesh shape in a group loci (ShapeGroup.Loci `triangles`): its own identity, bounds and label, the
// group's when no triangle is given

function shape() {
  const s = Shape.create(
    'mesh',
    {},
    { kind: 'mesh', boundingSphere: Sphere3D.create(Vec3(), 10) },
    () => 0 as never,
    () => 1,
    (g) => `Material ${g}`,
    2,
  );
  s.getGroupBoundingSphere = (_, out) => Sphere3D.set(out ?? Sphere3D(), Vec3.create(5, 5, 5), 5);
  s.getTriangleBoundingSphere = (triangles, out) =>
    Sphere3D.set(out ?? Sphere3D(), Vec3.create(triangles[0].index, 0, 0), 1);
  return s;
}

const group = (s: Shape, triangles?: ShapeGroup.Triangle[]) =>
  ShapeGroup.Loci(s, [{ ids: OrderedSet.ofSingleton(1), instance: 0 }], triangles);

describe('ShapeGroup.Loci with triangles', () => {
  it('is the same loci for the same triangles (its picked point aside), another for others', () => {
    const s = shape();
    const t3 = group(s, [{ instance: 0, index: 3, uv: [0.2, 0.3] }]);
    expect(Loci.areEqual(t3, group(s, [{ instance: 0, index: 3, uv: [0.5, 0.1] }]))).toBe(true);
    expect(Loci.areEqual(t3, group(s, [{ instance: 0, index: 4 }]))).toBe(false);
    expect(Loci.areEqual(t3, group(s, [{ instance: 1, index: 3 }]))).toBe(false);
    // a triangle is not its group
    expect(Loci.areEqual(t3, group(s))).toBe(false);
    expect(Loci.areEqual(group(s), group(s))).toBe(true);
  });

  it("is bounded by its triangles' sphere, its group's without", () => {
    const s = shape();
    expect(Loci.getBoundingSphere(group(s, [{ instance: 0, index: 7 }]))!.center).toEqual(Vec3.create(7, 0, 0));
    expect(Loci.getBoundingSphere(group(s))!.center).toEqual(Vec3.create(5, 5, 5));
  });

  it('is labelled by its group and its triangle', () => {
    const s = shape();
    expect(lociLabel(group(s, [{ instance: 0, index: 7 }]))).toBe('Material 1 | Triangle 7');
    expect(lociLabel(group(s))).toBe('Material 1');
  });

  it('becomes the whole shape at the structure granularity', () => {
    const s = shape();
    expect(Shape.isLoci(Loci.normalize(group(s, [{ instance: 0, index: 7 }]), 'structure'))).toBe(true);
  });
});
