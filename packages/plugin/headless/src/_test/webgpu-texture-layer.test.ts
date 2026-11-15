/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { createWebGPUContext, requestWebGPUDevice } from '@molstar/graphics/gl/webgpu/context';
import { asWebGPUTexture } from '@molstar/graphics/gl/webgpu/texture';
import { WebGPU } from './webgpu-module.js';

// `Texture.loadLayer` on WebGPU (Dawn): a plane written into one layer of a 3d texture, the other layers kept (a slice
// window's ring, graphics `repr/volume/slice-window.ts`)

const W = 64; // a row of 256 bytes: copied out without padding
const H = 3;
const D = 4;

async function readLayers(device: GPUDevice, texture: GPUTexture) {
  const buffer = device.createBuffer({
    size: W * H * D * 4,
    usage: 0x8 | 0x1 /* COPY_DST | MAP_READ: no globals in Node */,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow: W * 4, rowsPerImage: H },
    { width: W, height: H, depthOrArrayLayers: D },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(1 /* GPUMapMode.READ */);
  const out = new Float32Array(buffer.getMappedRange().slice(0));
  buffer.unmap();
  buffer.destroy();
  return out;
}

describe.skipIf(!WebGPU.module)('Texture.loadLayer on WebGPU', () => {
  it('writes one layer of a defined 3d texture, then another, keeping the rest', async () => {
    const gpu = WebGPU.module!.create([]);
    const device = await requestWebGPUDevice('default', gpu);
    if (!device) throw new Error('no WebGPU device');
    const graphics = createWebGPUContext(device, { width: 16, height: 16 });
    try {
      const texture = graphics.resources.texture('volume-float32', 'r', 'float', 'nearest');
      texture.define(W, H, D);
      const plane = (v: number) => ({ array: new Float32Array(W * H).fill(v), width: W, height: H });
      texture.loadLayer!(plane(2), 2);
      texture.loadLayer!(plane(1), 1);
      texture.loadLayer!(plane(3), 2);
      graphics.flush();
      const data = await readLayers(device, asWebGPUTexture(texture).getGPUTexture()!);
      const layer = (k: number) => Array.from(new Set(data.subarray(k * W * H, (k + 1) * W * H)));
      expect(layer(0)).toEqual([0]);
      expect(layer(1)).toEqual([1]);
      expect(layer(2)).toEqual([3]);
      expect(layer(3)).toEqual([0]);
      expect(() => texture.loadLayer!(plane(1), D)).toThrow();
      texture.destroy();
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      graphics.destroy();
    }
  });
});
