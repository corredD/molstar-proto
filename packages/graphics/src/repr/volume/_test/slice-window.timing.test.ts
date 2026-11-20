/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect } from 'vitest';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { itWithin } from '@molstar/test-harness/timing';
import { createNullTexture, type Texture } from '@molstar/graphics/gl/texture';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { TextureImage } from '@molstar/graphics/gl/renderable/util';
import type { Grid } from '@molstar/model/model/volume';
import { SliceWindow, SliceWindowDepth } from '../slice-window.js';

// The slice window's steps on the CPU at the plane size of Ludo's tomogram (512 × 720, z): a step within the window
// under 2 ms, a step at its edge (a plane copied) under 5 ms, a jump (the plane shown) under 5 ms. The copy goes to a 3d
// texture on the CPU here (`set`), about what a queue write costs the main thread

const Dims: [number, number, number] = [512, 720, 48];

function grid(): Grid {
  const space = Tensor.Space(Dims, [2, 1, 0], Float32Array);
  const data = space.create();
  for (let i = 0; i < data.length; i += 97) data[i] = i % 13;
  return {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, data),
    stats: { min: 0, max: 12, mean: 6, sigma: 3 },
  };
}

function graphics() {
  return {
    capabilities: { texture3d: true },
    resources: {
      limits: { max3dTextureSize: 2048 },
      ownsTexture: () => true,
      texture: () => {
        let data = new Float32Array(0);
        let plane = 0;
        return {
          ...createNullTexture(),
          define(w: number, h: number, d = 1) {
            plane = w * h;
            data = new Float32Array(plane * d);
          },
          loadLayer(image: TextureImage<Float32Array>, layer: number) {
            data.set(image.array, layer * plane);
          },
        } as Texture;
      },
    },
  } as unknown as GraphicsContext;
}

describe('slice window steps at the size of a tomogram plane (512 × 720)', () => {
  itWithin('within the window, at its edge, a jump', (within) => {
    const g = grid();
    for (const axis of [2, 0, 1] as const) {
      const window = SliceWindow.create(graphics(), g, axis);
      const n = window.ring.count;
      SliceWindow.show(window, n >> 1);
      SliceWindow.fill(window);
      const copies = window.copies;
      within(2, () => SliceWindow.show(window, (n >> 1) + 1));
      expect(window.copies).toBe(copies);
      // past the band: a plane enters, copied in idle time (`fill`)
      const edge = (n >> 1) + (SliceWindowDepth >> 1) - (SliceWindowDepth >> 2);
      within(5, () => {
        SliceWindow.show(window, edge);
        SliceWindow.fill(window);
      });
      within(5, () => SliceWindow.show(window, 0));
      SliceWindow.destroy(window);
    }
  });
});
