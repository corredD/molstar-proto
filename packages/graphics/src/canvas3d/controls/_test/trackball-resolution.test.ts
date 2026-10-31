/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ButtonsType, type DragInput, InputObserver, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import type { Subject } from 'rxjs';
import { Camera } from '../../camera.js';
import { Viewport } from '../../camera/util.js';
import type { Scene } from '../../../gl/scene.js';
import { TrackballControls } from '../trackball.js';

/**
 * The camera after a drag of 30 CSS pixels to the right (and 10 down) with `button`, at `resolution` of the drawing
 * buffer, or starting at full resolution and switching to `resolution` within the drag (as when the camera starts moving)
 */
function drag(button: number, resolution: number, switchWithin = false) {
  const input = InputObserver.create();
  const camera = new Camera();
  // the drawing buffer at `r` of a 2x display: the input's pixel ratio and the viewport with it
  const setResolution = (r: number) => {
    (input as { pixelRatio: number }).pixelRatio = 2 * r;
    (input as { width: number }).width = 800 * 2 * r;
    (input as { height: number }).height = 600 * 2 * r;
    Viewport.set(camera.viewport, 0, 0, 800 * 2 * r, 600 * 2 * r);
    camera.update();
  };
  setResolution(switchWithin ? 1 : resolution);
  camera.setState({ position: Vec3.create(0, 0, 50), target: Vec3.create(0, 0, 0), up: Vec3.create(0, 1, 0) }, 0);
  camera.update();
  const scene = { boundingSphereVisible: Sphere3D.create(Vec3(), 10) } as unknown as Scene;
  const controls = TrackballControls.create(input, camera, scene);
  Viewport.copy(controls.viewport, camera.viewport);
  controls.setResolutionScale(switchWithin ? 1 : resolution);
  const events = input.drag as Subject<DragInput>;
  const at = (x: number, y: number, isStart: boolean) =>
    events.next({
      x,
      y,
      dx: 0,
      dy: 0,
      pageX: x,
      pageY: y,
      buttons: button,
      button,
      modifiers: ModifiersKeys.create(),
      isStart,
      useDelta: false,
    });
  controls.start(1);
  at(200, 150, true);
  controls.update(17);
  at(215, 155, false);
  controls.update(33);
  if (switchWithin) {
    setResolution(resolution);
    Viewport.copy(controls.viewport, camera.viewport);
    controls.setResolutionScale(resolution);
  }
  at(230, 160, false);
  controls.update(49);
  controls.dispose();
  return Vec3.clone(camera.position);
}

describe('trackball at a lower resolution of the drawing buffer (Canvas3D motion)', () => {
  it('rotates and pans by a drag as at full resolution, also switching within the drag', () => {
    for (const button of [ButtonsType.Flag.Primary, ButtonsType.Flag.Secondary]) {
      const full = drag(button, 1);
      const half = drag(button, 0.5);
      const switched = drag(button, 0.5, true);
      expect(Vec3.distance(full, Vec3.create(0, 0, 50))).toBeGreaterThan(0.1);
      expect(Vec3.distance(half, full)).toBeLessThan(1e-4);
      // no jump where the resolution changes within the drag
      expect(Vec3.distance(switched, full)).toBeLessThan(1e-4);
    }
  });
});
