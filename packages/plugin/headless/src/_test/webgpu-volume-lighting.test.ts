/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec2, Vec3 } from '@molstar/core/math/linear-algebra';
import { now } from '@molstar/core/util/now';
import { Color } from '@molstar/core/util/color';
import { DirectVolumeRepresentationProvider } from '@molstar/graphics/repr/volume/direct-volume';
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
import { Ccp4Provider } from '@molstar/plugin/state/formats/volume/ccp4';
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

  it('volumetric: a dense cube darkens the slab behind it along the light, not the side toward the light', async () => {
    const lit = await renderSlabAndCube(['volumetric', 'local']);
    // light from the right: A (left of the cube) is behind it; from the left, B (right of it). Measured on Dawn (M1):
    // 0.49 and 0.57; local 0.97
    const fromRight = lit.volumetric[0];
    const fromLeft = lit.volumetric[1];
    expect(fromRight.a / fromRight.b).toBeLessThan(0.7);
    expect(fromLeft.b / fromLeft.a).toBeLessThan(0.7);
    // the gradient shading of the flat slab is the same on both sides of the cube
    for (const { a, b } of lit.local) expect(Math.abs(a / b - 1)).toBeLessThan(0.05);
  }, 60_000);
});

/**
 * A 64³ CCP4 map (1 Å cells, values in [0, 1]): a thin slab (value 0.4) facing the camera, a dense cube (0.8) through
 * its middle
 */
function createSlabAndCube() {
  const N = 64;
  const buffer = new ArrayBuffer(1024 + N * N * N * 4);
  const view = new DataView(buffer);
  const int = (word: number, value: number) => view.setInt32(word * 4, value, true);
  const float = (word: number, value: number) => view.setFloat32(word * 4, value, true);
  const values = new Float32Array(buffer, 1024, N * N * N);
  const inside = (p: number[], lo: number[], hi: number[]) => p.every((v, i) => v >= lo[i] && v < hi[i]);
  for (let z = 0; z < N; ++z) {
    for (let y = 0; y < N; ++y) {
      for (let x = 0; x < N; ++x) {
        const p = [x, y, z];
        values[(z * N + y) * N + x] = inside(p, [28, 24, 16], [36, 40, 48])
          ? 0.8
          : inside(p, [4, 8, 30], [60, 56, 34])
            ? 0.4
            : 0;
      }
    }
  }
  for (let i = 0; i < 3; ++i) {
    int(i, N); // NC, NR, NS
    int(7 + i, N); // NX, NY, NZ
    float(10 + i, N); // cell lengths
    float(13 + i, 90); // cell angles
    int(16 + i, i + 1); // MAPC, MAPR, MAPS
  }
  int(3, 2); // MODE: float32
  float(19, 0);
  float(20, 1);
  float(21, 0.1);
  int(22, 1); // ISPG
  [...'MAP '].forEach((c, i) => view.setUint8(52 * 4 + i, c.charCodeAt(0)));
  view.setUint8(53 * 4, 68);
  view.setUint8(53 * 4 + 1, 65);
  return new Uint8Array(buffer);
}

const Size = 128;

/**
 * The luminance of the slab at A (20, 32) and B (44, 32), either side of the cube, per `lighting` and for the key light
 * from the front at 45° to the right (+x), then to the left (view space: the camera looks down -z), on black
 */
async function renderSlabAndCube(lightings: ('local' | 'volumetric')[]) {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
  const out: Record<string, { a: number; b: number }[]> = {};
  try {
    await plugin.init();
    const canvas = plugin.canvas3d!;
    canvas.setProps({
      multiSample: { ...canvas.props.multiSample, mode: 'off' },
      postprocessing: {
        ...canvas.props.postprocessing,
        occlusion: { name: 'off', params: {} },
        outline: { name: 'off', params: {} },
        shadow: { name: 'off', params: {} },
      },
      renderer: { ...canvas.props.renderer, ambientIntensity: 0.3, backgroundColor: Color(0x000000) },
    });
    const data = await plugin.builders.data.rawData({ data: createSlabAndCube(), label: 'slab and cube.ccp4' });
    const volume = (await Ccp4Provider.parse(plugin, data)).volume.data!;
    const { themes } = plugin.representation.volume;
    const repr = DirectVolumeRepresentationProvider.factory(
      { graphics: canvas.graphics, ...themes },
      DirectVolumeRepresentationProvider.getParams,
    );
    // opacities per cell as transfer functions of maps have them: the slab thin (0.1), the cube dense (0.3: 94 %
    // over its 8 cells)
    const controlPoints = [
      Vec2.create(0.3, 0),
      Vec2.create(0.35, 0.1),
      Vec2.create(0.45, 0.1),
      Vec2.create(0.5, 0),
      Vec2.create(0.7, 0),
      Vec2.create(0.75, 0.3),
      Vec2.create(0.85, 0.3),
      Vec2.create(0.9, 0),
    ];
    const themeCtx = { volume };
    repr.setTheme({
      color: themes.colorThemeRegistry.create('uniform', themeCtx, { value: Color(0xffffff) }),
      size: themes.sizeThemeRegistry.create('uniform', themeCtx),
    });
    for (const lighting of lightings) {
      await repr.createOrUpdate({ controlPoints, lighting }, volume).run();
      canvas.add(repr);
      canvas.requestCameraReset({ durationMs: 0 });
      out[lighting] = [];
      for (const azimuth of [180, 0]) {
        canvas.setProps({
          renderer: {
            ...canvas.props.renderer,
            light: [{ inclination: 135, azimuth, color: Color(0xffffff), intensity: 1 }],
          },
        });
        for (let i = 0; i < 3; ++i) {
          canvas.commit(true);
          canvas.requestDraw();
          canvas.tick(now(), { isSynchronous: true });
          await canvas.graphics.resources.pending.whenReady();
        }
        const image = await plugin.getImageRaw({ width: Size, height: Size });
        const luminance = (p: Vec3) => {
          const q = Vec3.transformMat4(Vec3(), p, canvas.camera.projectionView);
          const x = Math.round((q[0] * 0.5 + 0.5) * image.width);
          const y = Math.round((0.5 - q[1] * 0.5) * image.height);
          const i = (y * image.width + x) * 4;
          return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
        };
        out[lighting].push({ a: luminance(Vec3.create(20, 32, 32)), b: luminance(Vec3.create(44, 32, 32)) });
      }
      expect(canvas.graphics.takeErrors()).toEqual([]);
    }
    repr.destroy();
    return out;
  } finally {
    plugin.dispose();
  }
}
