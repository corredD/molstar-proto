/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import { Mat4, Vec2, Vec3 } from '@molstar/core/math/linear-algebra';
import { Clip } from '@molstar/core/util/clip';
import { ValueCell } from '@molstar/core/util/value-cell';
import { packStorageClipObjects } from '@molstar/graphics/gl/clip-storage';
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
import { volume_lighting_wgsl } from '@molstar/graphics/gl/webgpu/shader/direct-volume.wgsl';
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
function referenceLevels(
  grid: Uint8Array,
  dim: Vec3,
  transfer: Uint8Array,
  alpha: number,
  clipped: (x: number, y: number, z: number) => boolean = () => false,
) {
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
    x < gx && y < gy && z < gz && !clipped(x, y, z) ? sigma(grid[x + gx * (y + gy * z)] / 255) : 0;
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

  it('counts the cells the clip objects remove as 0 in the pyramid (§A1), the others as before', async () => {
    const plugin = await createPlugin();
    try {
      const graphics = plugin.canvas3d!.graphics as WebGPUContext;
      if (!isVolumeLightingSupported(graphics)) throw new Error('volume lighting not supported');
      const rand = random(11);
      const transfer = Uint8Array.from({ length: 256 }, (_, i) => (i < 40 ? 0 : Math.floor(rand() * 256)));
      const dim = Vec3.create(64, 64, 64);
      const grid = Uint8Array.from({ length: 64 ** 3 }, () => Math.floor(rand() * 256));
      const gridTexture = graphics.resources.texture('volume-uint8', 'r', 'ubyte', 'linear');
      gridTexture.load({ array: grid, width: 64, height: 64, depth: 64 });
      // the plane x = 31.5 of model space removing x > 31.5 (between cell centers), the cells shifted by 10 in x
      // (model x = cell x + 10): the cells from 22 on clipped
      const objects = clipObjects([PlaneX(31.5)]);
      const cellToModel = Mat4.fromTranslation(Mat4(), Vec3.create(10, 0, 0));
      const pyramid = createExtinctionPyramid(graphics);
      pyramid.build({
        gridTexture,
        gridDim: dim,
        transfer,
        alpha: 0.8,
        packedGroup: false,
        clip: { count: 1, objects, cellToModel },
      });
      graphics.flush();
      const clipped = referenceLevels(grid, dim, transfer, 0.8, (x) => x + 10 > 31.5).levels;
      const whole = referenceLevels(grid, dim, transfer, 0.8).levels;
      const texture = asWebGPUTexture(pyramid.texture).getGPUTexture()!;
      for (let level = 0; level < VolumeLightingLevels; ++level) {
        const gpu = await readLevel(graphics, texture, level);
        const ref = clipped[level];
        let worst = 0;
        for (let i = 0; i < ref.length; ++i) {
          const tolerance = Math.max(2 ** -24, Math.abs(ref[i]) * 2 ** -10);
          worst = Math.max(worst, Math.abs(gpu[i] - ref[i]) / tolerance);
        }
        expect(worst, `level ${level + 1}`).toBeLessThanOrEqual(1);
      }
      // level 1: texels of x < 11 (cells < 22) as without the clip, those of x >= 11 0
      const level1 = await readLevel(graphics, texture, 0);
      const w = texture.width;
      for (const [x, expected] of [
        [5, whole[0][5 + w * (16 + w * 16)]],
        [10, whole[0][10 + w * (16 + w * 16)]],
        [11, 0],
        [20, 0],
      ] as const) {
        expect(level1[x + w * (16 + w * 16)], `level 1 at x ${x}`).toBeCloseTo(expected, 2);
      }
      expect(whole[0][10 + w * (16 + w * 16)]).toBeGreaterThan(0.1);
      expect(graphics.takeErrors()).toEqual([]);
      pyramid.destroy();
      gridTexture.destroy();
    } finally {
      plugin.dispose();
    }
  }, 60_000);

  it('volumetric: a clipped part shadows nothing, the volume lit as one without that part (§A1)', async () => {
    // the cube of the slab and cube clipped away (a cube clip object about it) against the same map without the cube
    // and the slab's cells in it, no clip: the same pyramid, the same level-0 reads toward the light
    const cut = await renderVolume(createSlabAndCube(), { clip: CubeClip });
    const oracle = await renderVolume(
      createCcp4(64, (x, y, z) =>
        inBox([x, y, z], [28, 24, 16], [36, 40, 48]) ? 0 : inBox([x, y, z], [4, 8, 30], [60, 56, 34]) ? 0.4 : 0,
      ),
    );
    const whole = await renderVolume(createSlabAndCube());
    // the slab behind the cube along the light (light from the right): A, and A next to the cube, B the other side
    const points = [Vec3.create(20, 32, 32), Vec3.create(26, 32, 32), Vec3.create(44, 32, 32)];
    const shade = (r: RenderedVolume) => points.map((p) => luminanceAt(r.plugin, r.image, p));
    const [cutA, cutA1, cutB] = shade(cut);
    const [oracleA, oracleA1, oracleB] = shade(oracle);
    const [wholeA] = shade(whole);
    for (const r of [cut, oracle, whole]) r.plugin.dispose();
    // measured on Dawn (M1): cut 69, 60, 72; the oracle 69, 58, 72; the whole map 35 at A (the cube's shadow), as was
    // the cut one before the clip reached the pyramid
    expect(wholeA / oracleA).toBeLessThan(0.7);
    expect(Math.abs(cutA / oracleA - 1)).toBeLessThan(0.05);
    expect(Math.abs(cutA1 / oracleA1 - 1)).toBeLessThan(0.05);
    expect(Math.abs(cutB / oracleB - 1)).toBeLessThan(0.05);
  }, 60_000);

  it('rebuilds the pyramid when the clip objects move, not in frames where nothing changed', async () => {
    const plugin = await createPlugin();
    try {
      const canvas = plugin.canvas3d!;
      const builds = vi.spyOn(canvas.graphics.compute!, 'beginComputePass');
      const count = () => builds.mock.calls.filter(([o]) => o?.label === 'extinction pyramid').length;
      const volume = await addDirectVolume(plugin, createSlabAndCube());
      await volume.update('volumetric', { clip: { variant: 'pixel', objects: [PlaneX(40.5)] } });
      canvas.requestCameraReset({ durationMs: 0 });
      await frames(plugin);
      const first = count();
      expect(first).toBeGreaterThan(0);
      // frames, the camera turned, the same props again: no build
      await frames(plugin);
      const position = Vec3.clone(canvas.camera.state.position);
      canvas.camera.setState({ position: Vec3.add(position, position, Vec3.create(1, 0, 0)) }, 0);
      await frames(plugin);
      await volume.update('volumetric', { clip: { variant: 'pixel', objects: [PlaneX(40.5)] } });
      await frames(plugin);
      expect(count()).toBe(first);
      // the plane moved: one build
      await volume.update('volumetric', { clip: { variant: 'pixel', objects: [PlaneX(30.5)] } });
      await frames(plugin);
      expect(count()).toBe(first + 1);
      // the clip removed: one build
      await volume.update('volumetric', { clip: { variant: 'pixel', objects: [] } });
      await frames(plugin);
      expect(count()).toBe(first + 2);
      expect(canvas.graphics.takeErrors()).toEqual([]);
      volume.repr.destroy();
    } finally {
      plugin.dispose();
    }
  }, 60_000);

  it('illumination: a volumetric volume shadows the traced molecules behind it along the light, a local one not', async () => {
    const plugin = await createPlugin();
    try {
      const canvas = plugin.canvas3d!;
      const data = await plugin.builders.data.rawData({ data: Atoms, label: 'atoms' });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(trajectory);
      const structure = await plugin.builders.structure.createStructure(model);
      await plugin.builders.structure.representation.addRepresentation(structure, {
        type: 'spacefill',
        color: 'uniform',
        colorParams: { value: Color(0xffffff) },
      });
      // a dense slab (x 40 to 48) between the atoms and the key light, in front and to the right (the camera looks
      // down -z, the atoms are left of the slab, not behind it)
      const volume = await addDirectVolume(
        plugin,
        createCcp4(64, (x) => (x >= 40 && x < 48 ? 0.8 : 0)),
      );
      await volume.update('local');
      canvas.setProps({
        illumination: { ...canvas.props.illumination, enabled: true },
        renderer: {
          ...canvas.props.renderer,
          light: [{ inclination: 135, azimuth: 180, color: Color(0xffffff), intensity: 1 }],
        },
      });
      // the image pass takes the illumination props of its own
      plugin.renderer.imagePass.setProps({ illumination: { ...canvas.props.illumination, enabled: true } });
      canvas.requestCameraReset({ durationMs: 0 });
      await frames(plugin);
      const atom = Vec3.create(24, 32, 35);
      const shade = async () => luminanceAt(plugin, await plugin.getImageRaw({ width: Size, height: Size }), atom);
      const local = await shade();
      await volume.update('volumetric');
      await frames(plugin);
      const volumetric = await shade();
      // one light (§D2): the trace and the volume read the renderer's; from the left the slab is no longer in the way
      canvas.setProps({
        renderer: {
          ...canvas.props.renderer,
          light: [{ inclination: 135, azimuth: 0, color: Color(0xffffff), intensity: 1 }],
        },
      });
      await frames(plugin);
      const fromLeft = await shade();
      canvas.setProps({
        renderer: {
          ...canvas.props.renderer,
          light: [{ inclination: 135, azimuth: 180, color: Color(0xffffff), intensity: 1 }],
        },
      });
      canvas.remove(volume.repr);
      await frames(plugin);
      const none = await shade();
      expect(canvas.graphics.takeErrors()).toEqual([]);
      expect(none).toBeGreaterThan(20);
      // the trace's program of before with a local volume (no \`dVolumeShadow\`)
      expect(Math.abs(local - none)).toBeLessThanOrEqual(2);
      // measured on Dawn (M1): none 247, local 248, volumetric 82
      expect(volumetric / local).toBeLessThan(0.8);
      // (0.89: the atoms lit from the other side, unshadowed)
      expect(fromLeft / local).toBeGreaterThan(0.8);
      volume.repr.destroy();
    } finally {
      plugin.dispose();
    }
  }, 60_000);

  it('illumination: a volume recreated keeps shadowing (the trace binds the new pyramid)', async () => {
    const plugin = await createPlugin();
    try {
      const canvas = plugin.canvas3d!;
      const data = await plugin.builders.data.rawData({ data: Atoms, label: 'atoms' });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(trajectory);
      const structure = await plugin.builders.structure.createStructure(model);
      await plugin.builders.structure.representation.addRepresentation(structure, {
        type: 'spacefill',
        color: 'uniform',
        colorParams: { value: Color(0xffffff) },
      });
      // the trace's quality at its minimum: no change of its adapted props calls its \`update\` (which would take a new
      // pyramid with it, hiding a missed one)
      const pinned = {
        ...canvas.props.illumination,
        enabled: true,
        steps: 1,
        refineSteps: 1,
        rendersPerFrame: [1, 1] as [number, number],
      };
      const slab = () => createCcp4(64, (x) => (x >= 40 && x < 48 ? 0.8 : 0));
      const first = await addDirectVolume(plugin, slab());
      await first.update('volumetric');
      canvas.setProps({
        illumination: pinned,
        renderer: {
          ...canvas.props.renderer,
          light: [{ inclination: 135, azimuth: 180, color: Color(0xffffff), intensity: 1 }],
        },
      });
      plugin.renderer.imagePass.setProps({ illumination: pinned });
      canvas.requestCameraReset({ durationMs: 0 });
      await frames(plugin);
      const atom = Vec3.create(24, 32, 35);
      const shade = async () => luminanceAt(plugin, await plugin.getImageRaw({ width: Size, height: Size }), atom);
      const before = await shade();
      canvas.remove(first.repr);
      first.repr.destroy();
      const second = await addDirectVolume(plugin, slab());
      await second.update('volumetric');
      await frames(plugin);
      const after = await shade();
      expect(canvas.graphics.takeErrors()).toEqual([]);
      expect(before).toBeLessThan(150);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
      second.repr.destroy();
    } finally {
      plugin.dispose();
    }
  }, 60_000);

  it('illumination: a clipped volume casts no shadow on the traced molecules from its clipped part', async () => {
    const plugin = await createPlugin();
    try {
      const canvas = plugin.canvas3d!;
      const data = await plugin.builders.data.rawData({ data: Atoms, label: 'atoms' });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(trajectory);
      const structure = await plugin.builders.structure.createStructure(model);
      await plugin.builders.structure.representation.addRepresentation(structure, {
        type: 'spacefill',
        color: 'uniform',
        colorParams: { value: Color(0xffffff) },
      });
      // the slab of the shadow test (x 40 to 48) between the atoms and the light
      const volume = await addDirectVolume(
        plugin,
        createCcp4(64, (x) => (x >= 40 && x < 48 ? 0.8 : 0)),
      );
      await volume.update('volumetric');
      canvas.setProps({
        illumination: { ...canvas.props.illumination, enabled: true },
        renderer: {
          ...canvas.props.renderer,
          light: [{ inclination: 135, azimuth: 180, color: Color(0xffffff), intensity: 1 }],
        },
      });
      plugin.renderer.imagePass.setProps({ illumination: { ...canvas.props.illumination, enabled: true } });
      canvas.requestCameraReset({ durationMs: 0 });
      await frames(plugin);
      const atom = Vec3.create(24, 32, 35);
      const shade = async () => luminanceAt(plugin, await plugin.getImageRaw({ width: Size, height: Size }), atom);
      const shadowed = await shade();
      // the slab clipped away (the plane x = 36.5 removing x > 36.5): no shadow
      await volume.update('volumetric', { clip: { variant: 'pixel', objects: [PlaneX(36.5)] } });
      await frames(plugin);
      const clipped = await shade();
      canvas.remove(volume.repr);
      await frames(plugin);
      const none = await shade();
      expect(canvas.graphics.takeErrors()).toEqual([]);
      // measured on Dawn (M1): shadowed 82, clipped 248 (82 before the clip reached the pyramid), none 247
      expect(shadowed / none).toBeLessThan(0.8);
      expect(Math.abs(clipped - none)).toBeLessThanOrEqual(3);
      volume.repr.destroy();
    } finally {
      plugin.dispose();
    }
  }, 60_000);

  it('reads the descriptors of §A2: a uniform grid its extinction at every level, a half-filled one the ramp', async () => {
    const plugin = await createPlugin();
    try {
      const graphics = plugin.canvas3d!.graphics as WebGPUContext;
      // opacity 0.2 a cell where the value is 1: the transfer function's bytes, and the shader's alike
      const transfer = Uint8Array.from({ length: 256 }, (_, i) => (i >= 128 ? 51 : 0));
      const sigma = -Math.log(1 - 0.2);
      const N = 64;
      const dim = Vec3.create(N, N, N);
      const describe = async (filled: (x: number) => boolean, x: Vec3, light: Vec3, clipX?: number) => {
        const grid = Uint8Array.from({ length: N * N * N }, (_, i) => (filled(i % N) ? 255 : 0));
        const gridTexture = graphics.resources.texture('volume-uint8', 'r', 'ubyte', 'linear');
        gridTexture.load({ array: grid, width: N, height: N, depth: N });
        const pyramid = createExtinctionPyramid(graphics);
        pyramid.build({ gridTexture, gridDim: dim, transfer, alpha: 1, packedGroup: false });
        graphics.flush();
        const out = await runDescriptors(graphics, gridTexture, pyramid.texture, x, light, dim, clipX);
        pyramid.destroy();
        gridTexture.destroy();
        return out;
      };
      const close = (a: number[], b: number[]) =>
        a.forEach((v, i) => expect(v, `descriptor ${i}`).toBeCloseTo(b[i], 2));

      // uniform: around and toward the light (within the box) all its extinction; the cosine passed through
      const uniform = await describe(() => true, Vec3.create(32, 32, 32), Vec3.create(1, 0, 0));
      close(uniform, [...Array(12).fill(sigma), 0.5]);

      // the half x < 32 filled, from x = 24 toward +x: filled at 1, 2, 4 cells, half at 8 (its boundary at the level of
      // 8-cell texels), empty at 16 and 32 (the centers of empty texels, and beyond)
      const half = await describe((x) => x < 32, Vec3.create(24, 32, 32), Vec3.create(1, 0, 0));
      close(half.slice(6, 12), [sigma, sigma, sigma, sigma / 2, 0, 0]);
      // at the boundary, the levels 1 to 5 around half filled
      const boundary = await describe((x) => x < 32, Vec3.create(32, 32, 32), Vec3.create(0, 1, 0));
      close(boundary.slice(1, 6), Array(5).fill(sigma / 2));
      // the level-0 read toward the light in the part \`volumeClipped\` removes (x > 32.5): 0, the sample's own kept
      const clipped = await describe(() => true, Vec3.create(32, 32, 32), Vec3.create(1, 0, 0), 32.5);
      close(clipped.slice(0, 1), [sigma]);
      close(clipped.slice(6, 7), [0]);
      expect(graphics.takeErrors()).toEqual([]);
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

/** A CCP4 map of `N`³ cells of 1 Å at the origin, the value of each cell `value(x, y, z)` in [0, 1] */
function createCcp4(N: number, value: (x: number, y: number, z: number) => number) {
  const buffer = new ArrayBuffer(1024 + N * N * N * 4);
  const view = new DataView(buffer);
  const int = (word: number, v: number) => view.setInt32(word * 4, v, true);
  const float = (word: number, v: number) => view.setFloat32(word * 4, v, true);
  const values = new Float32Array(buffer, 1024, N * N * N);
  for (let z = 0; z < N; ++z) {
    for (let y = 0; y < N; ++y) {
      for (let x = 0; x < N; ++x) values[(z * N + y) * N + x] = value(x, y, z);
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

const inBox = (p: number[], lo: number[], hi: number[]) => p.every((v, i) => v >= lo[i] && v < hi[i]);

/**
 * A 64³ map: a thin slab (value 0.4) facing the camera, a dense cube (0.8) through its middle
 */
function createSlabAndCube() {
  return createCcp4(64, (x, y, z) =>
    inBox([x, y, z], [28, 24, 16], [36, 40, 48]) ? 0.8 : inBox([x, y, z], [4, 8, 30], [60, 56, 34]) ? 0.4 : 0,
  );
}

/** Opacities per cell as transfer functions of maps have them: 0.4 thin (0.1 a cell), 0.8 dense (0.3: 94 % over 8) */
const ControlPoints = [
  Vec2.create(0.3, 0),
  Vec2.create(0.35, 0.1),
  Vec2.create(0.45, 0.1),
  Vec2.create(0.5, 0),
  Vec2.create(0.7, 0),
  Vec2.create(0.75, 0.3),
  Vec2.create(0.85, 0.3),
  Vec2.create(0.9, 0),
];

/** A clip object plane at x = \`x\` (model space) removing x > \`x\`: its normal, \`y\` of its frame, turned to +x */
function PlaneX(x: number) {
  return {
    type: 'plane' as const,
    invert: false,
    position: Vec3.create(x, 0, 0),
    rotation: { axis: Vec3.create(0, 0, 1), angle: -90 },
    scale: Vec3.create(1, 1, 1),
    transform: Mat4.identity(),
  };
}

/** The cube of \`createSlabAndCube\` (cells 28 to 35, 24 to 39, 16 to 47) as a cube clip object, its faces between cells */
const CubeClip: Clip.Props = {
  variant: 'pixel',
  objects: [
    {
      type: 'cube',
      invert: false,
      position: Vec3.create(31.5, 31.5, 31.5),
      rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
      scale: Vec3.create(8.4, 16.4, 32.4),
      transform: Mat4.identity(),
    },
  ],
};

/** \`objects\` packed for the kernels (\`packStorageClipObjects\`) */
function clipObjects(objects: Clip.Props['objects']) {
  const clip = Clip.getClip({ variant: 'pixel', objects });
  const out = new Float32Array(Clip.MaxObjectCount * 20);
  packStorageClipObjects(
    {
      dClipObjects: ValueCell.create(true),
      dClipVariant: ValueCell.create('pixel'),
      dClipping: ValueCell.create(false),
      uClipObjectCount: ValueCell.create(clip.objects.count),
      uClipObjectFrame: ValueCell.create(clip.objects.frame),
      uClipObjectShape: ValueCell.create(clip.objects.shape),
    },
    out,
  );
  return out;
}

interface RenderedVolume {
  plugin: HeadlessPluginContext;
  image: { data: ArrayLike<number>; width: number; height: number };
}

/** \`ccp4\` lit volumetric with \`props\`, the key light from the front at 45° to the right (+x); the caller disposes */
async function renderVolume(ccp4: Uint8Array, props: object = {}): Promise<RenderedVolume> {
  const plugin = await createPlugin();
  const canvas = plugin.canvas3d!;
  const volume = await addDirectVolume(plugin, ccp4);
  await volume.update('volumetric', props);
  canvas.setProps({
    renderer: {
      ...canvas.props.renderer,
      light: [{ inclination: 135, azimuth: 180, color: Color(0xffffff), intensity: 1 }],
    },
  });
  // the camera of the whole box, the same for every map: the box's bounding sphere
  canvas.requestCameraReset({ durationMs: 0 });
  await frames(plugin);
  const image = await plugin.getImageRaw({ width: Size, height: Size });
  expect(canvas.graphics.takeErrors()).toEqual([]);
  return { plugin, image };
}

async function addDirectVolume(plugin: HeadlessPluginContext, ccp4: Uint8Array) {
  const canvas = plugin.canvas3d!;
  const data = await plugin.builders.data.rawData({ data: ccp4, label: 'test.ccp4' });
  const volume = (await Ccp4Provider.parse(plugin, data)).volume.data!;
  const { themes } = plugin.representation.volume;
  const repr = DirectVolumeRepresentationProvider.factory(
    { graphics: canvas.graphics, ...themes },
    DirectVolumeRepresentationProvider.getParams,
  );
  const themeCtx = { volume };
  repr.setTheme({
    color: themes.colorThemeRegistry.create('uniform', themeCtx, { value: Color(0xffffff) }),
    size: themes.sizeThemeRegistry.create('uniform', themeCtx),
  });
  return {
    repr,
    update: async (lighting: 'local' | 'volumetric', props: object = {}) => {
      await repr.createOrUpdate({ controlPoints: ControlPoints, lighting, ...props }, volume).run();
      canvas.add(repr);
    },
  };
}

async function frames(plugin: HeadlessPluginContext, count = 3) {
  const canvas = plugin.canvas3d!;
  for (let i = 0; i < count; ++i) {
    canvas.commit(true);
    canvas.requestDraw();
    canvas.tick(now(), { isSynchronous: true });
    await canvas.graphics.resources.pending.whenReady();
  }
}

/** The mean of the r, g, b of `image` at `p` (model space) */
function luminanceAt(
  plugin: HeadlessPluginContext,
  image: { data: ArrayLike<number>; width: number; height: number },
  p: Vec3,
) {
  const q = Vec3.transformMat4(Vec3(), p, plugin.canvas3d!.camera.projectionView);
  const x = Math.round((q[0] * 0.5 + 0.5) * image.width);
  const y = Math.round((0.5 - q[1] * 0.5) * image.height);
  const i = (y * image.width + x) * 4;
  return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
}

const Size = 128;

/** A WebGPU plugin of `Size`² on black, without multi-sampling or post-processing, the ambient light at 0.3 */
async function createPlugin() {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
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
  return plugin;
}

/** 7 atoms about (24, 32, 32) */
const Atoms = `${[
  [24, 32, 32],
  [22.5, 32, 32],
  [25.5, 32, 32],
  [24, 30.5, 32],
  [24, 33.5, 32],
  [24, 32, 30.5],
  [24, 32, 33.5],
]
  .map(([x, y, z], i) => {
    const f = (v: number) => v.toFixed(3).padStart(8);
    return `ATOM  ${String(i + 1).padStart(5)}  CA  ALA A${String(i + 1).padStart(4)}    ${f(x)}${f(y)}${f(z)}  1.00  0.00           C`;
  })
  .join('\n')}\nEND\n`;

/**
 * The luminance of the slab at A (20, 32) and B (44, 32), either side of the cube, per `lighting` and for the key light
 * from the front at 45° to the right (+x), then to the left (view space: the camera looks down -z), on black
 */
async function renderSlabAndCube(lightings: ('local' | 'volumetric')[]) {
  const plugin = await createPlugin();
  const out: Record<string, { a: number; b: number }[]> = {};
  try {
    const canvas = plugin.canvas3d!;
    const volume = await addDirectVolume(plugin, createSlabAndCube());
    for (const lighting of lightings) {
      await volume.update(lighting);
      canvas.requestCameraReset({ durationMs: 0 });
      out[lighting] = [];
      for (const azimuth of [180, 0]) {
        canvas.setProps({
          renderer: {
            ...canvas.props.renderer,
            light: [{ inclination: 135, azimuth, color: Color(0xffffff), intensity: 1 }],
          },
        });
        await frames(plugin);
        const image = await plugin.getImageRaw({ width: Size, height: Size });
        out[lighting].push({
          a: luminanceAt(plugin, image, Vec3.create(20, 32, 32)),
          b: luminanceAt(plugin, image, Vec3.create(44, 32, 32)),
        });
      }
      expect(canvas.graphics.takeErrors()).toEqual([]);
    }
    volume.repr.destroy();
    return out;
  } finally {
    plugin.dispose();
  }
}

/**
 * The 13 descriptors of `volumeDescriptors` (the direct volume's chunk, as the ray marcher calls it) at `x` (texel
 * coordinates) toward `light` (cells), by a compute pipeline of its own: the chunk with stand-ins for what the program
 * gives it (the grid read, a transfer function of 0.2 above 0.5, alpha 1), the cosine set to 0.5
 */
async function runDescriptors(
  graphics: WebGPUContext,
  grid: import('@molstar/graphics/gl/texture').Texture,
  extinction: import('@molstar/graphics/gl/texture').Texture,
  x: Vec3,
  light: Vec3,
  gridDim: Vec3,
  /** \`volumeClipped\` of the stand-ins: the texel coordinates beyond it in x clipped */
  clipX = 1e6,
) {
  const { device } = graphics;
  const f = (v: Vec3) => `vec3<f32>(${v[0]}, ${v[1]}, ${v[2]})`;
  const code = /* wgsl */ `
@group(0) @binding(0) var tGridTex: texture_3d<f32>;
@group(0) @binding(1) var tExtinction: texture_3d<f32>;
@group(0) @binding(2) var sLinear: sampler;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
struct Material { uAlpha: f32 };
const uMaterial = Material(1.0);
// for \`volumetricLight\`, not called
struct Global { uLightColor: array<vec3<f32>, 1>, uAmbientColor: vec3<f32> };
const uGlobal = Global(array<vec3<f32>, 1>(vec3<f32>(1.0)), vec3<f32>(0.0));
const oLightCount = 1;
const GridDim = ${f(gridDim)};
fn textureVal(pos: vec3<f32>) -> vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, textureSampleLevel(tGridTex, sLinear, pos + vec3<f32>(0.5) / GridDim, 0.0).r);
}
fn transferFunction(value: f32) -> f32 {
    return select(0.0, 0.2, value > 0.5);
}
fn volumeClipped(x: vec3<f32>) -> bool {
    return x.x > ${clipX.toFixed(2)};
}
${volume_lighting_wgsl}
@compute @workgroup_size(1)
fn main() {
    let x = ${f(x)};
    let d = volumeDescriptors(x, cellExtinction(textureVal((x - 0.5) / GridDim).a), ${f(light)}, 0.5, GridDim);
    let v = array<f32, 13>(d.around0.x, d.around0.y, d.around0.z, d.around1.x, d.around1.y, d.around1.z,
        d.light0.x, d.light0.y, d.light0.z, d.light1.x, d.light1.y, d.light1.z, d.cosine);
    for (var i = 0; i < 13; i++) {
        out[i] = v[i];
    }
}`;
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
  const buffer = device.createBuffer({ size: 13 * 4, usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: 13 * 4, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: asWebGPUTexture(grid).getView()! },
      { binding: 1, resource: asWebGPUTexture(extinction).getView()! },
      { binding: 2, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
      { binding: 3, resource: { buffer } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(buffer, 0, read, 0, 13 * 4);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(MapMode.READ);
  const values = Array.from(new Float32Array(read.getMappedRange().slice(0)));
  buffer.destroy();
  read.destroy();
  return values;
}
