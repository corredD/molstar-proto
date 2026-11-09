/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { forgetLipidPatch, LipidMembrane, LipidMembraneParams, registerLipidPatch } from '../lipids/membrane.js';
import { syntheticPatchPdb, writePng } from './lipid-fixtures.js';

// The switch between the spheres and the far surface (lipid-procedural round 4c item 7; Ludo: "the transition texture /
// spheres is not smooth yet"): the same view on both sides of the switch, its mean colour and luminance (Oklab) about
// the same. The patch's rare species stands tallest, as CHARMM-GUI's DSM: near the switch the coarse spheres show it
// over its neighbours, where the surface weighted every head alike (the cause, measured: progress file, round 4c).
// LIPID_SHOTS=<dir> writes the images.

const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

const Size = 256;
const Radius = 1500;

/** The mean Oklab of the image's middle third, its background (the first pixel's colour) left out */
function meanOklab(image: ArrayLike<number>) {
  const lab = Vec3();
  const sum = [0, 0, 0];
  let n = 0;
  const bg = [image[0], image[1], image[2]];
  for (let y = Math.round(Size / 3); y < Math.round((2 * Size) / 3); ++y) {
    for (let x = Math.round(Size / 3); x < Math.round((2 * Size) / 3); ++x) {
      const o = (y * Size + x) * 4;
      if (image[o] === bg[0] && image[o + 1] === bg[1] && image[o + 2] === bg[2]) continue;
      ColorLevels.toOklab(lab, Color.fromRgb(image[o], image[o + 1], image[o + 2]));
      for (let k = 0; k < 3; ++k) sum[k] += lab[k];
      n += 1;
    }
  }
  return { L: sum[0] / n, a: sum[1] / n, b: sum[2] / n, n };
}

describe.skipIf(!webgpu)('the switch between a membrane’s spheres and its far surface (Dawn)', () => {
  it('keeps the mean colour and luminance across the switch', { timeout: 120_000 }, async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      const canvas = plugin.canvas3d!;
      canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
      // the rare species tallest: POPC's heads 7 Å above the others'
      registerLipidPatch('dawn-switch', syntheticPatchPdb(12, 14, { POPC: 27, CHL1: 17 }).text);
      const params = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        radius: Radius,
        edge: 100,
        leaflets: 'outer' as const,
        patch: 'dawn-switch',
        center: Vec3.zero(),
      };
      const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
      const camera = canvas.camera;
      canvas.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      // above the sphere's top, looking down: a lipid about 0.4 px there (the coarsest level), and about 5 px (stride 8:
      // review M1, the switch's level was always the coarsest)
      const top = Radius + 20;
      for (const depth of [2300, 200]) {
        camera.setState(
          {
            ...camera.getSnapshot(),
            target: Vec3.create(0, 0, top),
            position: Vec3.create(0, 0, top + depth),
            up: Vec3.create(0, 1, 0),
          },
          0,
        );
        await plugin.getImageRaw({ width: Size, height: Size });
        // a lipid's size on screen at the top (`procedural.ts`: the patch's spacing over the Å a pixel covers there)
        const lipid = Math.sqrt((12 * 8 * (14 * 8 * 0.866)) / (12 * 14));
        const px = lipid / ((2 * depth) / (camera.projection[5] * Size));
        const at = async (name: string, spheresPx: number) => {
          await plugin
            .build()
            .to(node.ref)
            .update({ ...params, spheresPx })
            .commit();
          await plugin.getImageRaw({ width: Size, height: Size });
          const image = (await plugin.getImageRaw({ width: Size, height: Size })).data;
          if (process.env.LIPID_SHOTS)
            await writePng(`${process.env.LIPID_SHOTS}/r4c-switch-${depth}-${name}.png`, Size, Size, image);
          return image;
        };
        const repr = () =>
          plugin.state.data.cells.get(node.ref)!.obj!.data.repr as unknown as { pool: { live: number } };
        // just before the switch: the spheres; just past it: the surface, the camera where it was
        const spheres = await at('spheres', px / 1.3);
        expect(repr().pool.live).toBeGreaterThan(0);
        const surface = await at('surface', px * 1.3);
        expect(repr().pool.live).toBe(0);
        const s = meanOklab(spheres);
        const f = meanOklab(surface);
        if (process.env.LIPID_NUMBERS) console.log(JSON.stringify({ px, s, f }));
        expect(s.n).toBeGreaterThan(Size * Size * 0.1);
        expect(f.n).toBeGreaterThan(Size * Size * 0.1);
        // the pop: luminance and colour (Oklab's a, b) within a bound
        expect(Math.abs(s.L - f.L)).toBeLessThan(0.04);
        expect(Math.hypot(s.a - f.a, s.b - f.b)).toBeLessThan(0.02);
      }
      expect(canvas.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-switch');
      plugin.dispose();
    }
  });
});
