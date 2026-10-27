/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Scene } from '@molstar/graphics/gl/scene';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { DebugRegistry } from './debug-registry.js';
import { CameraHelper, CameraHelperParams } from './camera-helper.js';
import { HandleHelper, HandleHelperParams } from './handle-helper.js';
import { PointerHelper, PointerHelperParams } from './pointer-helper.js';

export const HelperParams = {
  camera: PD.Group({
    helper: PD.Group(CameraHelperParams),
  }),
  handle: PD.Group(HandleHelperParams),
  pointer: PD.Group(PointerHelperParams),
};
export const DefaultHelperProps = PD.getDefaultValues(HelperParams);
export type HelperProps = PD.Values<typeof HelperParams>;

export class Helper {
  readonly debug: DebugRegistry;
  readonly camera: CameraHelper;
  readonly handle: HandleHelper;
  readonly pointer: PointerHelper;
  /**
   * The representations drawn on top of the scene (`Canvas3D.setOnTop`): after it, with a depth of their own, so they
   * show through what is in front of them; picked after it the same way, so a pick on them wins. Their marking is their
   * material color (as the other helpers'), not the marking pass's
   */
  readonly onTop: Scene;

  constructor(graphics: GraphicsContext, scene: Scene, props: Partial<HelperProps> = {}) {
    const p = { ...DefaultHelperProps, ...props };

    this.debug = new DebugRegistry(graphics, scene);
    this.camera = new CameraHelper(graphics, p.camera.helper);
    this.handle = new HandleHelper(graphics, p.handle);
    this.pointer = new PointerHelper(graphics, p.pointer);
    this.onTop = Scene.create(graphics, 'blended');
  }
}
