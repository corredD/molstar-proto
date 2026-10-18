/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Clip } from '@molstar/core/util/clip';
import { addCylinder } from '@molstar/graphics/geo/geometry/mesh/builder/cylinder';
import { addSphere } from '@molstar/graphics/geo/geometry/mesh/builder/sphere';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import { Box } from '@molstar/graphics/geo/primitive/box';
import { Circle } from '@molstar/graphics/geo/primitive/circle';

// Cuts (apps/prism-me/_spec/features.md, "Stage tools"), after the design of Stories Untold's cuts and their guides
// (`designs/clip-guides`, David Sehnal and Ludovic Autin; written anew here, no code copied): a plane, a sphere or a box that cuts what a target draws, as
// Mol*'s clip objects on its representations; where a new one goes (facing the camera, a window on the near side);
// and its guide, the shape drawn so the cut can be seen.

export type CutShape = 'plane' | 'sphere' | 'box';

/** A cut, in world space */
export interface Cut {
  readonly shape: CutShape;
  /** A plane's point, a sphere's or a box's center */
  readonly center: readonly [number, number, number];
  /** A plane's normal (it cuts away the side it points to), a box's third axis */
  readonly normal: readonly [number, number, number];
  /** A sphere's radius, a box's first edge; a plane's guide reaches this far */
  readonly radius: number;
  /** A box's edges */
  readonly size: readonly [number, number, number];
  /** Keep the inside instead (a sphere or box shows only what is in it; a plane the other side) */
  readonly invert: boolean;
}

const Up = Vec3.create(0, 1, 0);

/** The rotation turning up (0, 1, 0) onto `normal`: about up × normal, a half turn about x against up */
export function rotationTo(normal: Vec3): Clip.Rotation {
  const n = Vec3.normalize(Vec3(), normal);
  const axis = Vec3.cross(Vec3(), Up, n);
  if (Vec3.magnitude(axis) < 1e-6) {
    return { axis: Vec3.create(1, 0, 0), angle: Vec3.dot(Up, n) < 0 ? 180 : 0 };
  }
  return { axis: Vec3.normalize(axis, axis), angle: (Vec3.angle(Up, n) * 180) / Math.PI };
}

/** The cut as one of Mol*'s clip objects */
export function clipObjectOf(cut: Cut): Clip.Props['objects'][number] {
  const center = Vec3.create(cut.center[0], cut.center[1], cut.center[2]);
  const normal = Vec3.create(cut.normal[0], cut.normal[1], cut.normal[2]);
  const rotation = rotationTo(normal);
  switch (cut.shape) {
    case 'plane':
      return {
        type: 'plane',
        invert: cut.invert,
        position: center,
        rotation,
        scale: Vec3.create(1, 1, 1),
        transform: Mat4.identity(),
      };
    case 'sphere':
      return {
        type: 'sphere',
        invert: cut.invert,
        position: center,
        rotation,
        scale: Vec3.create(2 * cut.radius, 2 * cut.radius, 2 * cut.radius),
        transform: Mat4.identity(),
      };
    case 'box':
      return {
        type: 'cube',
        invert: cut.invert,
        position: center,
        rotation,
        scale: Vec3.create(cut.size[0], cut.size[1], cut.size[2]),
        transform: Mat4.identity(),
      };
  }
}

/**
 * Where a new cut goes on a target (its bounding sphere), seen along `view` (from the camera to the target): a plane
 * through the target's center facing the camera, cutting away the near half; a sphere or a box, a window on the side
 * facing the camera (centered on the target's surface there: at its center a hollow shell would show nothing cut).
 */
export function defaultCut(shape: CutShape, bounds: Sphere3D, view: Vec3): Cut {
  const toCamera = Vec3.normalize(Vec3(), Vec3.negate(Vec3(), view));
  const r = Math.max(bounds.radius, 1);
  const c = bounds.center;
  if (shape === 'plane') {
    return { shape, center: [c[0], c[1], c[2]], normal: tuple(toCamera), radius: r, size: [r, r, r], invert: false };
  }
  const near = Vec3.scaleAndAdd(Vec3(), c, toCamera, r * 0.9);
  const w = r * 0.6;
  return { shape, center: tuple(near), normal: tuple(toCamera), radius: w, size: [w, w, w], invert: false };
}

function tuple(v: Vec3): [number, number, number] {
  return [v[0], v[1], v[2]];
}

/** The cut moved along its normal by `distance` */
export function slideCut(cut: Cut, distance: number): Cut {
  const n = Vec3.normalize(Vec3(), Vec3.create(cut.normal[0], cut.normal[1], cut.normal[2]));
  const c = Vec3.scaleAndAdd(Vec3(), Vec3.create(cut.center[0], cut.center[1], cut.center[2]), n, distance);
  return { ...cut, center: tuple(c) };
}

/** The cut facing the other way (a plane cuts away the other side; a sphere or a box keeps its inside) */
export function flipCut(cut: Cut): Cut {
  return cut.shape === 'plane'
    ? { ...cut, normal: [-cut.normal[0], -cut.normal[1], -cut.normal[2]] }
    : { ...cut, invert: !cut.invert };
}

/**
 * The guide of a cut, a mesh: a plane's disk as far as it reaches with an arrow on the side cut away, a sphere, a box.
 * Drawn translucent and never clipped, so the cut can be seen where it is.
 */
export function cutGuideMesh(cut: Cut, mesh?: Mesh): Mesh {
  const state = MeshBuilder.createState(512, 256, mesh);
  state.currentGroup = 0;
  const center = Vec3.create(cut.center[0], cut.center[1], cut.center[2]);
  const normal = Vec3.normalize(Vec3(), Vec3.create(cut.normal[0], cut.normal[1], cut.normal[2]));
  const rotation = rotationTo(normal);
  const q = Quat.setAxisAngle(Quat(), rotation.axis, (rotation.angle * Math.PI) / 180);
  const placed = (scale: Vec3) => {
    const t = Mat4.fromQuat(Mat4(), q);
    Mat4.scale(t, t, scale);
    return Mat4.setTranslation(t, center);
  };
  if (cut.shape === 'plane') {
    const disk = Circle({ radius: 1, segments: 64 });
    const t = placed(Vec3.create(cut.radius, cut.radius, cut.radius));
    MeshBuilder.addPrimitive(state, t, disk);
    MeshBuilder.addPrimitiveFlipped(state, t, disk);
    // the arrow points to the side cut away
    const tip = Vec3.scaleAndAdd(Vec3(), center, normal, cut.radius * 0.3);
    const w = Math.max(cut.radius * 0.015, 0.2);
    addCylinder(state, center, tip, 1, {
      radiusTop: w,
      radiusBottom: w,
      radialSegments: 8,
      topCap: true,
      bottomCap: true,
    });
  } else if (cut.shape === 'sphere') {
    addSphere(state, center, cut.radius, 3);
  } else {
    const t = placed(Vec3.create(cut.size[0], cut.size[1], cut.size[2]));
    MeshBuilder.addPrimitive(state, t, Box());
  }
  return MeshBuilder.getMesh(state);
}

/** The cut read back from a clip object (the inverse of `clipObjectOf`), if it is one this extension makes */
export function cutOf(o: Clip.Props['objects'][number], reach: number): Cut | undefined {
  const q = Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), o.rotation.axis), (o.rotation.angle * Math.PI) / 180);
  const n = Vec3.transformQuat(Vec3(), Up, q);
  const normal: [number, number, number] = [n[0], n[1], n[2]];
  const center = tuple(o.position);
  if (o.type === 'plane')
    return { shape: 'plane', center, normal, radius: reach, size: [reach, reach, reach], invert: o.invert };
  if (o.type === 'sphere') {
    const r = o.scale[0] / 2;
    return { shape: 'sphere', center, normal, radius: r, size: [r, r, r], invert: o.invert };
  }
  if (o.type === 'cube')
    return { shape: 'box', center, normal, radius: o.scale[0], size: tuple(o.scale), invert: o.invert };
}
