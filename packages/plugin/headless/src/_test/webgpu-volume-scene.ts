/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect } from 'vitest';
import { Vec2, Vec3 } from '@molstar/core/math/linear-algebra';
import { now } from '@molstar/core/util/now';
import { Color } from '@molstar/core/util/color';
import { DirectVolumeRepresentationProvider } from '@molstar/graphics/repr/volume/direct-volume';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { Ccp4Provider } from '@molstar/plugin/state/formats/volume/ccp4';
import { WebGPU } from './webgpu-module.js';

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
export async function renderSlabAndCube(lightings: ('local' | 'volumetric' | 'neural')[]) {
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
