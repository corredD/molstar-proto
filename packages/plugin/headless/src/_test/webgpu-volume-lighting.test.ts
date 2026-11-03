/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { fromHalfFloat, toHalfFloat } from '@molstar/core/util/number-conversion';
import {
  createExtinctionPyramid,
  getExtinctionPyramidSize,
  isVolumeLightingSupported,
  VolumeLightingLevels,
  VolumeLightingMaxAlpha,
} from '@molstar/graphics/gl/compute/volume-lighting';
import { BufferUsage, MapMode } from '@molstar/graphics/gl/webgpu/constants';
import type { WebGPUContext } from '@molstar/graphics/gl/webgpu/context';
import { asWebGPUTexture } from '@molstar/graphics/gl/webgpu/texture';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

/** A seeded generator (mulberry32), the same grids every run */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f16 = (x: number) => fromHalfFloat(toHalfFloat(x));

/**
 * The pyramid's levels as `volume-lighting.md` §A1 defines them, in f64 from level 1's cells, each level from the f16
 * values of the level below (what the GPU stores and reads)
 */
function referenceLevels(grid: Uint8Array, dim: Vec3, transfer: Uint8Array, alpha: number) {
  const sigma = (v: number) => {
    const x = Math.min(Math.max(v * 256 - 0.5, 0), 255);
    const i = Math.floor(x);
    const tf = (transfer[i] + (transfer[Math.min(i + 1, 255)] - transfer[i]) * (x - i)) / 255;
    return -Math.log(1 - Math.min(Math.min(Math.max(tf * alpha, 0), 1), VolumeLightingMaxAlpha));
  };
  const [gx, gy, gz] = dim;
  const size = getExtinctionPyramidSize(Vec3(), dim);
  const levels: Float64Array[] = [];
  let [w, h, d] = size;
  let below = (x: number, y: number, z: number) =>
    x < gx && y < gy && z < gz ? sigma(grid[x + gx * (y + gy * z)] / 255) : 0;
  for (let level = 0; level < VolumeLightingLevels; ++level) {
    const out = new Float64Array(w * h * d);
    for (let z = 0; z < d; ++z) {
      for (let y = 0; y < h; ++y) {
        for (let x = 0; x < w; ++x) {
          let sum = 0;
          for (let k = 0; k < 8; ++k) sum += below(2 * x + (k & 1), 2 * y + ((k >> 1) & 1), 2 * z + (k >> 2));
          out[x + w * (y + h * z)] = sum / 8;
        }
      }
    }
    levels.push(out);
    const [lw, lh] = [w, h];
    below = (x, y, z) => f16(out[x + lw * (y + lh * z)]);
    [w, h, d] = [w >> 1, h >> 1, d >> 1];
  }
  return { size, levels };
}

/** The f16 texels of mip `level` of a 3d `r16float` texture, rows unpadded */
async function readLevel(graphics: WebGPUContext, texture: GPUTexture, level: number) {
  const [w, h, d] = [texture.width >> level, texture.height >> level, texture.depthOrArrayLayers >> level];
  const bytesPerRow = Math.ceil((w * 2) / 256) * 256;
  const { device } = graphics;
  const buffer = device.createBuffer({ size: bytesPerRow * h * d, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, mipLevel: level },
    { buffer, bytesPerRow, rowsPerImage: h },
    { width: w, height: h, depthOrArrayLayers: d },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(MapMode.READ);
  const rows = new Uint16Array(buffer.getMappedRange().slice(0));
  buffer.destroy();
  const out = new Float32Array(w * h * d);
  for (let z = 0; z < d; ++z) {
    for (let y = 0; y < h; ++y) {
      for (let x = 0; x < w; ++x) out[x + w * (y + h * z)] = fromHalfFloat(rows[(z * h + y) * (bytesPerRow / 2) + x]);
    }
  }
  return out;
}

describe.skipIf(!WebGPU.module)('volume lighting on WebGPU', () => {
  it('builds the extinction pyramid: each level the mean of its children, to f16', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: 16, height: 16 },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      const graphics = plugin.canvas3d!.graphics as WebGPUContext;
      expect(isVolumeLightingSupported(graphics)).toBe(true);
      if (!isVolumeLightingSupported(graphics)) return;
      const rand = random(7);
      const transfer = Uint8Array.from({ length: 256 }, (_, i) => (i < 40 ? 0 : Math.floor(rand() * 256)));
      // a power of two, and odd sizes padded to multiples of 32 (cells beyond the grid count as 0)
      for (const dim of [Vec3.create(32, 32, 32), Vec3.create(33, 20, 17)]) {
        const [gx, gy, gz] = dim;
        const grid = Uint8Array.from({ length: gx * gy * gz }, () => Math.floor(rand() * 256));
        const gridTexture = graphics.resources.texture('volume-uint8', 'r', 'ubyte', 'linear');
        gridTexture.load({ array: grid, width: gx, height: gy, depth: gz });
        const pyramid = createExtinctionPyramid(graphics);
        pyramid.build({ gridTexture, gridDim: dim, transfer, alpha: 0.8, packedGroup: false });
        graphics.flush();

        const { size, levels } = referenceLevels(grid, dim, transfer, 0.8);
        const texture = asWebGPUTexture(pyramid.texture).getGPUTexture()!;
        expect([texture.width, texture.height, texture.depthOrArrayLayers, texture.mipLevelCount]).toEqual([
          ...size,
          VolumeLightingLevels,
        ]);
        for (let level = 0; level < VolumeLightingLevels; ++level) {
          const gpu = await readLevel(graphics, texture, level);
          const ref = levels[level];
          expect(gpu.length).toBe(ref.length);
          let worst = 0;
          for (let i = 0; i < ref.length; ++i) {
            // within half an f16 step of the f64 mean (plus f32 rounding)
            const tolerance = Math.max(2 ** -24, Math.abs(ref[i]) * 2 ** -10);
            worst = Math.max(worst, Math.abs(gpu[i] - ref[i]) / tolerance);
          }
          expect(worst, `level ${level + 1} of ${dim.join('×')}`).toBeLessThanOrEqual(1);
          // not all zero: the means are of something
          expect(ref.some((v) => v > 0)).toBe(true);
        }
        expect(graphics.takeErrors()).toEqual([]);
        pyramid.destroy();
        gridTexture.destroy();
      }
    } finally {
      plugin.dispose();
    }
  }, 60_000);
});
