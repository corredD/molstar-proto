/**
 * Copyright (c) 2021-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { createRenderObject } from '../render-object.js';
import { Scene } from '../scene.js';
import { getGLContext, tryGetGLContext } from './gl.js';
import { setDebugMode } from '@molstar/core/util/debug';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { DirectVolume } from '@molstar/graphics/geo/geometry/direct-volume/direct-volume';

export function createDirectVolume(params: Partial<PD.Values<DirectVolume.Params>> = {}) {
  const directVolume = DirectVolume.createEmpty();
  const props = { ...PD.getDefaultValues(DirectVolume.Params), ...params };
  const values = DirectVolume.Utils.createValuesSimple(directVolume, props, ColorNames.orange, 1);
  const state = DirectVolume.Utils.createRenderableState(props);
  return createRenderObject('direct-volume', values, state, -1);
}

describe('direct-volume', () => {
  const ctx = tryGetGLContext(32, 32);

  (ctx ? it : it.skip)('basic', { tags: ['medium'] }, async () => {
    const ctx = getGLContext(32, 32);
    const scene = Scene.create(ctx);
    const directVolume = createDirectVolume();
    scene.add(directVolume);
    setDebugMode(true);
    expect(() => scene.commit()).not.toThrow();
    setDebugMode(false);
    ctx.destroy();
  });

  (ctx ? it : it.skip)('draws volumetric lighting as local on WebGL (no compute)', { tags: ['medium'] }, async () => {
    const ctx = getGLContext(32, 32);
    const scene = Scene.create(ctx);
    const directVolume = createDirectVolume({ lighting: 'volumetric' });
    scene.add(directVolume);
    scene.commit();
    const [renderable] = scene.renderables;
    expect(directVolume.values.dLighting.ref.value).toBe('volumetric');
    expect(renderable.values.dLighting.ref.value).toBe('local');
    renderable.update();
    expect(renderable.values.dLighting.ref.value).toBe('local');
    ctx.destroy();
  });
});
