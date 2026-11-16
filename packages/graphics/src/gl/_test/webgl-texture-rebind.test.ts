/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import { ValueCell } from '@molstar/core/util/value-cell';
import { getGLContext, tryGetGLContext } from './gl.js';
import { Scene } from '../scene.js';
import { createTextureImage } from '../renderable/util.js';
import { asGLTexture } from '../webgl/texture.js';
import { createDirectVolume } from './direct-volume.test.js';

// A texture owned outside the render items (kind 'texture': a slice window's planes, a direct volume's grid) set to
// another texture object between commits is the one drawn, as on WebGPU (whose items compare the cells per draw): a
// slice's switch from its binned planes to the full ones happens on a timer, no scene update after it

describe('WebGL render items, a texture of kind texture replaced', () => {
  const available = tryGetGLContext(32, 32);
  (available ? it : it.skip)('binds the new texture at the next draw without an update', { tags: ['medium'] }, () => {
    const ctx = getGLContext(32, 32);
    const scene = Scene.create(ctx);
    const volume = createDirectVolume();
    scene.add(volume);
    scene.commit();
    const [renderable] = scene.renderables;
    (renderable.getProgram('color') as unknown as { finalize(force: boolean): boolean }).finalize(true);
    const next = ctx.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
    next.load(createTextureImage(4, 4, Uint8Array));
    const bind = vi.spyOn(asGLTexture(next), 'bind');
    ValueCell.update(volume.values.tGridTex, next);
    ctx.beginRenderPass('drawing-buffer');
    renderable.render('color' as never);
    ctx.endRenderPass();
    expect(bind).toHaveBeenCalled();
    ctx.destroy();
  });
});
