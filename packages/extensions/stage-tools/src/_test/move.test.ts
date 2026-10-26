/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { dragMatrix, movedClipObject, movedRepresentationParams, placementWith, poseOf } from '../move.js';
import { applyToPlacement } from '@molstar/prism-viewer/sources/gizmos';
import { moveBetween } from '../move-gizmos.js';

const frame = { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), pixel: 2 };

describe('move', () => {
  it('moves in the screen plane by the drag (Å per pixel), up the screen when dragged up', () => {
    const m = dragMatrix('move', 10, -5, frame, Vec3.create(0, 0, 0));
    const p = Vec3.transformMat4(Vec3(), Vec3.create(1, 1, 1), m);
    expect(Array.from(p)).toEqual([21, 11, 1]);
  });

  it('turns about the center: the center stays, a point beside it turns about the screen up', () => {
    const center = Vec3.create(10, 0, 0);
    // across by 180 px: 90° about up
    const m = dragMatrix('rotate', 180, 0, frame, center);
    const c = Vec3.transformMat4(Vec3(), center, m);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(center[i], 6);
    const p = Vec3.transformMat4(Vec3(), Vec3.create(11, 0, 0), m);
    expect(p[0]).toBeCloseTo(10, 6);
    expect(Math.abs(p[2])).toBeCloseTo(1, 6);
  });

  it('places a clip object with what it cuts: moved, and turned with it', () => {
    const o = {
      type: 'plane' as const,
      invert: false,
      position: Vec3.create(0, 0, 0),
      rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
      scale: Vec3.create(1, 1, 1),
      transform: Mat4.identity(),
    };
    const turned = movedClipObject(o, Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1)));
    expect(turned.rotation.angle).toBeCloseTo(90, 4);
    expect(Math.abs(turned.rotation.axis[2])).toBeCloseTo(1, 4);
    const moved = movedClipObject(o, Mat4.fromTranslation(Mat4(), Vec3.create(0, 5, 0)));
    expect(Array.from(moved.position)).toEqual([0, 5, 0]);
  });
});

describe('move gizmos', () => {
  it("drags a placement rigidly, a mesh's scale kept under the turn; the move between two placements", () => {
    const from = { matrix: Mat4.fromScaling(Mat4(), Vec3.create(2, 2, 2)), center: Vec3.create(1, 0, 0), radius: 5 };
    // the move handle (in the screen's plane): 10 px right at 1 Å a px
    const handle = { kind: 'move' } as const;
    const frame = { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), perPixel: 1 };
    const next = applyToPlacement(from, handle, frame, 10, 0);
    // the scale stays
    expect(Mat4.getMaxScaleOnAxis(next.matrix)).toBeCloseTo(2, 6);
    const m = moveBetween(from, next);
    // the move is rigid (no scale of its own)
    expect(Mat4.getMaxScaleOnAxis(m)).toBeCloseTo(1, 6);
    // and makes `next` of `from`
    expect(Mat4.areEqual(Mat4.mul(Mat4(), m, from.matrix), next.matrix, 1e-6)).toBe(true);
  });

  it("reads an object's pose (its center where it is, its Euler turn) and makes a placement from one, a list's scale kept", () => {
    const center = Vec3.create(10, 0, 0);
    // turned 90° about z about the origin, then up 5, the positions scaled by 2 first
    const scale = 2;
    const rigid = Mat4.mul(
      Mat4(),
      Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 5)),
      Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1)),
    );
    const placement = { matrix: Mat4.mul(Mat4(), rigid, Mat4.fromUniformScaling(Mat4(), scale)), center, radius: 1 };
    const pose = poseOf(placement);
    // the center (10, 0, 0) scaled to (20, 0, 0), turned to (0, 20, 0), up 5
    pose.position.forEach((x, i) => expect(x).toBeCloseTo([0, 20, 5][i], 5));
    pose.euler.forEach((x, i) => expect(x).toBeCloseTo([0, 0, 90][i], 5));
    // the same pose back: the same matrix
    const back = placementWith(placement, pose);
    for (let i = 0; i < 16; i++) expect(back[i]).toBeCloseTo(placement.matrix[i], 5);
    // another: its center there, its turn that, its scale kept
    const next = placementWith(placement, { position: [1, 2, 3], euler: [30, -45, 120] });
    const c = Vec3.transformMat4(Vec3(), center, next);
    c.forEach((x, i) => expect(x).toBeCloseTo([1, 2, 3][i], 5));
    expect(Mat4.getMaxScaleOnAxis(next)).toBeCloseTo(scale, 5);
    const again = poseOf({ ...placement, matrix: next });
    again.euler.forEach((x, i) => expect(x).toBeCloseTo([30, -45, 120][i], 4));
  });

  it("moves what a representation places in the scene's space: its clips, a volume slice's plane", () => {
    // a quarter turn about z, then 10 along x
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(10, 0, 0)), Mat4.rotZ90);
    const plane = { point: Vec3.create(1, 0, 0), normal: Vec3.create(1, 0, 0) };
    const slice = { type: { name: 'slice', params: { mode: 'plane', plane, clip: { objects: [] } } } };
    const moved = movedRepresentationParams(slice, m)!;
    const p = moved.type.params.plane;
    expect(Array.from(p.point).map((x: number) => +x.toFixed(6) + 0)).toEqual([10, 1, 0]);
    expect(Array.from(p.normal).map((x: number) => +x.toFixed(6) + 0)).toEqual([0, 1, 0]);
    // a grid slice is in the volume's grid: nothing to move
    const grid = { type: { name: 'slice', params: { mode: 'grid', plane, clip: { objects: [] } } } };
    expect(movedRepresentationParams(grid, m)).toBeUndefined();
  });
});
