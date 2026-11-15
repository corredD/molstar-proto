/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec2, Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import * as Shape from '@molstar/graphics/geo/shape/shape';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { ImpostorAtlas } from '@molstar/graphics/geo/geometry/impostor-atlas';
import { ShapeRepresentation } from '@molstar/graphics/repr/shape/representation';
import type { SpheresValues } from '@molstar/graphics/gl/renderable/spheres';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

// The last level of spheres as octahedral impostors (`lod-impostor.md`) on WebGPU (Dawn): two copies of a rod of spheres,
// the left one in front, overlapping; drawn as impostors they occlude each other as their spheres do (the depth each
// writes), and picking gives the copy.

const Size = 128;
/** per copy (instance) its color: the left one in front */
const Colors = [0xd04040, 0x4060d0];
const Transforms = [
  Mat4.fromTranslation(Mat4(), Vec3.create(-10, 0, 10)),
  Mat4.mul(
    Mat4(),
    Mat4.fromTranslation(Mat4(), Vec3.create(12, 0, 0)),
    Mat4.fromRotation(Mat4(), 0.4, Vec3.create(0, 1, 0)),
  ),
];

/** a rod of spheres along x, 30 Å long */
function rod() {
  const builder = SpheresBuilder.create(64, 1);
  let g = 0;
  for (let x = -15; x <= 15; x += 1.5) {
    for (const [y, z] of [
      [0, 0],
      [2, 0],
      [0, 2],
    ]) {
      builder.add(x, y, z, g++);
    }
  }
  return { spheres: builder.getSpheres(), count: g };
}

async function setup() {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
  await plugin.init();
  const canvas = plugin.canvas3d!;
  const postprocessing = {
    enabled: true,
    occlusion: { name: 'off', params: {} },
    shadow: { name: 'off', params: {} },
    outline: { name: 'off', params: {} },
  } as any;
  canvas.setProps({
    renderer: { ...canvas.props.renderer, backgroundColor: Color(0xffffff) },
    multiSample: { ...canvas.props.multiSample, mode: 'off' },
    camera: { ...canvas.props.camera, mode: 'perspective' },
    postprocessing,
  } as any);
  (plugin as any).renderer.imagePass.setProps({ multiSample: { ...canvas.props.multiSample, mode: 'off' } });
  const { spheres, count } = rod();
  const shape = Shape.create(
    'rod',
    {},
    spheres,
    (_g, i) => Color(Colors[i]),
    () => 1.5,
    () => 'rod',
    Transforms,
    count,
  );
  const repr = ShapeRepresentation(() => shape, Spheres.Utils, { graphics: canvas.graphics });
  // two levels by distance: all spheres within 1 Å, then the impostors (the camera is farther)
  const lodLevels = [
    { minDistance: 0, maxDistance: 1, overlap: 0, stride: 1, scaleBias: 1 },
    { minDistance: 1, maxDistance: 1e7, overlap: 0, stride: 1000, scaleBias: 3 },
  ];
  await repr.createOrUpdate({ ...PD.getDefaultValues(Spheres.Params), ignoreLight: true } as any, {}).run();
  const object = repr.renderObjects[0];
  const values = object.values as unknown as SpheresValues;
  canvas.add(repr);
  canvas.requestCameraReset({ durationMs: 0 });
  canvas.commit(true);
  const graphics = canvas.graphics;

  const draw = async () => {
    canvas.update(repr);
    canvas.commit(true);
    // the canvas' own frames (what picking reads), then the image
    for (let i = 0; i < 6; ++i) {
      canvas.requestDraw();
      canvas.tick(0 as any, { isSynchronous: true } as any);
      await graphics.resources.pending.whenReady();
    }
    let image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
    for (let i = 0; i < 10; ++i) {
      await graphics.resources.pending.whenReady();
      image = (await plugin.getImageRaw({ width: Size, height: Size }, postprocessing)).data;
    }
    expect(graphics.takeErrors?.() ?? []).toEqual([]);
    return image;
  };
  /** the impostors on: the levels above, the atlas of the rod and its entry */
  const impostors = async () => {
    await repr
      .createOrUpdate({ ...PD.getDefaultValues(Spheres.Params), ignoreLight: true, lodLevels } as any, {})
      .run();
    const atlas = ImpostorAtlas.create([ImpostorAtlas.getItem(values, 64)!], 4096);
    ImpostorAtlas.setValues(values, atlas);
    spheres.shaderData.update({ lodImpostor: atlas.codes[0] });
    expect(values.dLodImpostor.ref.value).toBe(true);
  };
  return { plugin, canvas, draw, impostors };
}

/** per pixel, which copy's color it has (0, 1), -1 for neither */
function copies(pixels: ArrayLike<number>) {
  const out = new Int8Array(pixels.length / 4).fill(-1);
  for (let i = 0; i < out.length; ++i) {
    for (let c = 0; c < Colors.length; ++c) {
      const [r, g, b] = [(Colors[c] >> 16) & 255, (Colors[c] >> 8) & 255, Colors[c] & 255];
      if (
        Math.abs(pixels[i * 4] - r) < 40 &&
        Math.abs(pixels[i * 4 + 1] - g) < 40 &&
        Math.abs(pixels[i * 4 + 2] - b) < 40
      ) {
        out[i] = c;
      }
    }
  }
  return out;
}

describe.skipIf(!WebGPU.module)('impostors (WebGPU)', () => {
  it('occlude each other as their spheres do, and pick the copy', { tags: ['medium'] }, async () => {
    const { plugin, canvas, draw, impostors } = await setup();
    try {
      const fullImage = await draw();
      const full = copies(fullImage);
      await impostors();
      const imp = copies(await draw());
      let a = 0;
      let b = 0;
      let same = 0;
      let wrong = 0;
      for (let i = 0; i < full.length; ++i) {
        if (full[i] === 0) a++;
        if (full[i] === 1) b++;
        if (full[i] >= 0 && imp[i] === full[i]) same++;
        // the back copy where the front one is: the depth not written, or not tested
        if (full[i] === 0 && imp[i] === 1) wrong++;
      }
      expect(a).toBeGreaterThan(100);
      expect(b).toBeGreaterThan(100);
      // the silhouettes as the spheres', the back copy hidden where the front one is
      expect(same / (a + b)).toBeGreaterThan(0.8);
      expect(wrong).toBeLessThan(0.02 * a);

      // the pick at each copy's pixels' center gives that copy
      for (const c of [0, 1]) {
        let x = 0;
        let y = 0;
        let n = 0;
        for (let i = 0; i < imp.length; ++i) {
          if (imp[i] !== c) continue;
          x += i % Size;
          y += Math.floor(i / Size);
          n++;
        }
        const ratio = canvas.graphics.pixelRatio;
        // rows bottom-up in the image (`getImageRaw`) or top-down: the copies lie side by side, the middle row is both
        const pick = await canvas.asyncIdentify(Vec2.create(x / n / ratio, Size / 2 / ratio))?.wait();
        expect(pick?.id.instanceId).toBe(c);
      }
    } finally {
      plugin.dispose();
    }
  });
});
