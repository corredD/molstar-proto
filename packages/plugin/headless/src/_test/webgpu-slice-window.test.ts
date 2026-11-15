/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ColorTheme } from '@molstar/graphics/theme/color';
import { SizeTheme } from '@molstar/graphics/theme/size';
import { UniformColorTheme, UniformColorThemeParams } from '@molstar/graphics/theme/color/uniform';
import { VolumeValueColorTheme, VolumeValueColorThemeParams } from '@molstar/graphics/theme/color/volume-value';
import type { Theme } from '@molstar/graphics/theme/theme';
import { SliceRepresentationProvider, type SliceProps } from '@molstar/graphics/repr/volume/slice';
import { SliceWindowConfig } from '@molstar/graphics/repr/volume/slice-window';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

/** a volume (the model package is not this one's dependency) */
type Volume = Parameters<typeof SliceRepresentationProvider.isApplicable>[0];

// A grid slice from a window of its planes (graphics repr/volume/slice-window.ts) draws the image the CPU path draws
// (Dawn): the same pixels within a gray level or two (the CPU image's colors are 8-bit, the window's computed from the
// float values), along x, y and z, nearest and cubic, the uniform and volume-value themes, an iso level cutting

const Size = 96;
const Dims: [number, number, number] = [48, 40, 36];

function volume(): Volume {
  const space = Tensor.Space(Dims, [2, 1, 0], Float32Array);
  const data = space.create();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; ++i) {
    // smooth and varied: no aliasing between paths at the pixel scale
    const [x, y, z] = space.getCoords(i, [0, 0, 0]);
    data[i] = Math.sin(x * 0.3) * 4 + Math.cos(y * 0.23) * 3 + z * 0.1;
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
    sum += data[i];
  }
  const mean = sum / data.length;
  return {
    grid: {
      transform: { kind: 'matrix', matrix: Mat4.fromScaling(Mat4(), Vec3.create(1, 1, 1)) },
      cells: Tensor.create(space, data),
      stats: { min, max, mean, sigma: (max - min) / 6 },
    },
    instances: [{ transform: Mat4.identity() }],
    sourceData: { kind: 'test', name: 'test', data: {} } as any,
    customProperties: {
      get: () => undefined,
      set: () => {},
      add: () => {},
      has: () => false,
      all: [],
      dispose: () => {},
    } as any,
    _propertyData: Object.create(null),
    _localPropertyData: Object.create(null),
  };
}

function themes(v: Volume): [string, Theme][] {
  const value = PD.getDefaultValues(VolumeValueColorThemeParams);
  return [
    [
      'uniform',
      {
        color: UniformColorTheme({}, { ...PD.getDefaultValues(UniformColorThemeParams), value: Color(0x66ccff) }),
        size: SizeTheme.Empty,
      },
    ],
    [
      'volume value',
      {
        color: VolumeValueColorTheme(
          { volume: v },
          {
            ...value,
            domain: { name: 'custom', params: [-3, 4] },
            colorList: { kind: 'interpolate', colors: [[Color(0x000000), 0] as any, [Color(0xffffff), 1] as any] },
          },
        ),
        size: SizeTheme.Empty,
      },
    ],
  ];
}

describe.skipIf(!WebGPU.module)('grid slice from a window of planes, as the CPU path draws it (WebGPU)', () => {
  it('the same pixels along x, y, z: nearest and cubic, uniform and volume value, an iso level', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    await plugin.init();
    const canvas = plugin.canvas3d!;
    const postprocessing = {
      enabled: false,
      occlusion: { name: 'off', params: {} },
      shadow: { name: 'off', params: {} },
      outline: { name: 'off', params: {} },
    } as any;
    canvas.setProps({
      renderer: { ...canvas.props.renderer, backgroundColor: Color(0xff00ff) },
      multiSample: { ...canvas.props.multiSample, mode: 'off' },
      camera: { ...canvas.props.camera, mode: 'orthographic' },
    } as any);
    (plugin as any).renderer.imagePass.setProps({ multiSample: { ...canvas.props.multiSample, mode: 'off' } });
    const graphics = canvas.graphics;
    const v = volume();
    const ctx = {
      graphics,
      colorThemeRegistry: ColorTheme.createRegistry(),
      sizeThemeRegistry: SizeTheme.createRegistry(),
    };

    const draw = async (theme: Theme, props: Partial<SliceProps>, gpu: boolean) => {
      SliceWindowConfig.enabled = gpu;
      const repr = SliceRepresentationProvider.factory(ctx, SliceRepresentationProvider.getParams);
      repr.setTheme(theme);
      await repr
        .createOrUpdate(
          { ...PD.getDefaultValues(SliceRepresentationProvider.getParams(ctx as any, v)), ...props } as any,
          v,
        )
        .run();
      expect(repr.renderObjects[0].values.dSliceWindow.ref.value).toBe(gpu);
      canvas.add(repr);
      canvas.commit(true);
      // looking down the slice's axis, at the volume's center
      const axis = props.dimension!.name;
      const dir = Vec3.create(axis === 'x' ? -1 : 0, axis === 'y' ? -1 : 0, axis === 'z' ? -1 : 0);
      const up = axis === 'y' ? Vec3.create(0, 0, 1) : Vec3.create(0, 1, 0);
      const center = Vec3.create(Dims[0] / 2, Dims[1] / 2, Dims[2] / 2);
      canvas.camera.focus(center, Math.max(...Dims) / 2, 0, up, dir);
      let image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
      for (let i = 0; i < 6; ++i) {
        await graphics.resources.pending.whenReady();
        image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
      }
      canvas.remove(repr);
      canvas.commit(true);
      repr.destroy();
      return image;
    };

    try {
      for (const [tName, theme] of themes(v)) {
        for (const interpolation of ['nearest', 'bspline'] as const) {
          for (const [name, index] of [
            ['z', 20],
            ['x', 7],
            ['y', 31],
          ] as const) {
            for (const iso of [undefined, 0.4]) {
              const at = `${tName} ${interpolation} ${name} ${index} iso ${iso}`;
              const props: Partial<SliceProps> = {
                interpolation,
                dimension: { name, params: index },
                ...(iso !== undefined ? { isoValue: { kind: 'absolute', absoluteValue: iso } } : {}),
              };
              const cpu = await draw(theme, props, false);
              const gpu = await draw(theme, props, true);
              let drawn = 0;
              let worst = 0;
              let far = 0;
              for (let i = 0; i < cpu.length; i += 4) {
                if (cpu[i] !== 255 || cpu[i + 1] !== 0 || cpu[i + 2] !== 255) drawn++;
                const d = Math.max(
                  Math.abs(cpu[i] - gpu[i]),
                  Math.abs(cpu[i + 1] - gpu[i + 1]),
                  Math.abs(cpu[i + 2] - gpu[i + 2]),
                );
                worst = Math.max(worst, d);
                if (d > 3) far++;
              }
              expect(drawn, at).toBeGreaterThan(Size * Size * 0.1);
              // at most a few pixels at the iso level's edge (8-bit vs float values at the cut)
              expect(far, `${at}: worst ${worst}`).toBeLessThanOrEqual(iso === undefined ? 0 : Size);
            }
          }
        }
      }
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      SliceWindowConfig.enabled = true;
      plugin.dispose();
    }
  }, 120_000);
});
