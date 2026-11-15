/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { createNullTexture, type Texture } from '@molstar/graphics/gl/texture';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { TextureImage } from '@molstar/graphics/gl/renderable/util';
import type { Grid } from '@molstar/model/model/volume';
import { SliceRing, SliceWindow, SliceWindowBudget, SliceWindowDepth } from '../slice-window.js';

describe('SliceRing', () => {
  it('holds index i at layer i mod N', () => {
    const ring = SliceRing.create(200, 32);
    expect(ring.depth).toBe(32);
    SliceRing.move(ring, 100);
    for (let i = ring.start; i < ring.start + ring.depth; ++i) {
      expect(SliceRing.has(ring, i)).toBe(true);
      expect(SliceRing.layer(ring, i)).toBe(i % 32);
    }
    expect(SliceRing.has(ring, ring.start - 1)).toBe(false);
    expect(SliceRing.has(ring, ring.start + ring.depth)).toBe(false);
  });

  it('fills all of it on the first move, centered', () => {
    const ring = SliceRing.create(200, 32);
    const entered = SliceRing.move(ring, 100);
    expect(entered.length).toBe(32);
    expect(ring.start).toBe(84);
    expect(SliceRing.has(ring, 100)).toBe(true);
  });

  it('moves within its band without a copy', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    for (const i of [92, 93, 100, 107, 92]) expect(SliceRing.move(ring, i)).toEqual([]);
    expect(ring.start).toBe(84);
  });

  it('near an edge, replaces only the slices that left by those that entered, plane by plane', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    // the band is [start + 8, start + 24): 108 is one past it
    expect(SliceRing.move(ring, 108)).toEqual([116]);
    expect(ring.start).toBe(85);
    expect(SliceRing.move(ring, 111)).toEqual([117, 118, 119]);
    expect(ring.start).toBe(88);
    // the other way
    expect(SliceRing.move(ring, 96)).toEqual([]);
    expect(SliceRing.move(ring, 94)).toEqual([86, 87]);
    expect(ring.start).toBe(86);
    // the layers of the entered slices are those the left ones held
    for (let i = ring.start; i < ring.start + 32; ++i) expect(SliceRing.layer(ring, i)).toBe(i % 32);
  });

  it('a jump far away refills it', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    const entered = SliceRing.move(ring, 20);
    expect(entered.length).toBe(32);
    expect(ring.start).toBe(4);
  });

  it('stays at the ends of the axis', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 0);
    expect(ring.start).toBe(0);
    expect(SliceRing.move(ring, 3)).toEqual([]);
    SliceRing.move(ring, 199);
    expect(ring.start).toBe(168);
    expect(SliceRing.move(ring, 197)).toEqual([]);
  });

  it('an axis shorter than N is filled once, never copied again', () => {
    const ring = SliceRing.create(20, 32);
    expect(ring.depth).toBe(20);
    expect(SliceRing.move(ring, 5).length).toBe(20);
    for (const i of [0, 19, 7, 12]) expect(SliceRing.move(ring, i)).toEqual([]);
  });

  it('reset empties it: the next move refills', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    SliceRing.reset(ring);
    expect(SliceRing.move(ring, 100).length).toBe(32);
  });
});

describe('SliceWindow memory', () => {
  it('holds fewer planes where 32 would pass its byte budget, at least 4; none past that', () => {
    expect(SliceWindow.getDepth(512 * 720, 225)).toBe(SliceWindowDepth);
    // a 2048² plane of floats is 16 MB: 8 planes in 128 MB
    expect(SliceWindow.getDepth(2048 * 2048, 500)).toBe(8);
    expect(SliceWindow.getDepth(2048 * 2048, 5)).toBe(5);
    expect(SliceWindow.getDepth(8192 * 8192, 500)).toBe(0);
    expect(SliceWindowBudget).toBe(128 * 1024 * 1024);
  });
});

describe('SliceWindow tiled (a plane wider or taller than the 3d texture limit: a tilt series of 3000²)', () => {
  function stub(max3d: number) {
    const textures: { data: Float32Array; w: number; h: number; d: number }[] = [];
    const graphics = {
      capabilities: { texture3d: true },
      resources: {
        limits: { max3dTextureSize: max3d },
        ownsTexture: () => true,
        texture: () => {
          const t = { data: new Float32Array(0), w: 0, h: 0, d: 0 };
          textures.push(t);
          return {
            ...createNullTexture(),
            define(w: number, h: number, d = 1) {
              Object.assign(t, { w, h, d, data: new Float32Array(w * h * d) });
            },
            loadLayer(image: TextureImage<Float32Array>, layer: number) {
              if (image.width !== t.w || image.height !== t.h || layer >= t.d) throw new Error('outside');
              t.data.set(image.array, layer * t.w * t.h);
            },
          } as Texture;
        },
      },
    } as unknown as GraphicsContext;
    return { graphics, textures };
  }
  function grid(dims: [number, number, number]): Grid {
    const space = Tensor.Space(dims, [2, 1, 0], Float32Array);
    const data = space.create();
    for (let i = 0; i < data.length; ++i) data[i] = i;
    return {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(space, data),
      stats: { min: 0, max: data.length - 1, mean: 0, sigma: 1 },
    };
  }

  it('supported where a tile fits; each layer a tile, the tiles holding the plane', () => {
    const g = grid([7, 5, 10]);
    const { graphics, textures } = stub(4);
    expect(SliceWindow.isSupported(graphics, g, 2)).toBe(true);
    const window = SliceWindow.create(graphics, g, 2);
    // 7 × 5 in tiles of at most 4: 2 × 2 tiles of 4 × 3
    expect(window.tiles).toEqual([4, 3, 2, 2]);
    const layer = SliceWindow.show(window, 6);
    const t = textures[0];
    expect([t.w, t.h, t.d]).toEqual([4, 3, window.ring.depth * 4]);
    const plane = SliceWindow.getPlane(window, 6);
    for (let row = 0; row < 5; ++row) {
      for (let column = 0; column < 7; ++column) {
        const tile = Math.floor(row / 3) * 2 + Math.floor(column / 4);
        const at = (layer * 4 + tile) * 12 + (row % 3) * 4 + (column % 4);
        expect(t.data[at], `${row} ${column}`).toBe(plane[row * 7 + column]);
      }
    }
  });

  it('a plane of 36 MB (3000² floats) gets the planes the budget holds, at least one', () => {
    expect(SliceWindow.getDepth(3000 * 3000, 41)).toBe(3);
    expect(SliceWindow.getDepth(6000 * 6000, 41)).toBe(0);
  });
});
