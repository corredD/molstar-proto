/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { LipidMembrane, LipidMembraneParams, registerLipidPatch } from '../lipids/membrane.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

/** Dawn's Node bindings (`pnpm native:install -- --webgpu`, run through `pnpm native:run`), else the test skips */
const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

const Size = 96;

describe.skipIf(!webgpu)('lipid membrane on WebGPU (Dawn)', () => {
  it('draws a wrapped sphere: its tiles merged and culled on the GPU, their transforms from the kernel', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, {
          ...PD.getDefaultValues(LipidMembraneParams),
          radius: 300,
          edge: 80,
          patch: 'dawn-patch',
          center: Vec3.zero(),
        })
        .commit();
      const cell = [...plugin.state.data.cells.values()].find((c) => c.transform.transformer === LipidMembrane)!;
      const repr = cell.obj!.data.repr;
      // one merged object of every variant's spheres, culled on the GPU
      expect(repr.renderObjects.length).toBe(1);
      plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
      const image = await plugin.getImageRaw({ width: Size, height: Size });
      // the sphere covers the middle of the image: lipids drawn where the CPU's transforms are zeros
      const at = (x: number, y: number) => Array.from(image.data.subarray((y * Size + x) * 4, (y * Size + x) * 4 + 3));
      const background = at(0, 0);
      let covered = 0;
      for (let y = Size / 4; y < (3 * Size) / 4; ++y) {
        for (let x = Size / 4; x < (3 * Size) / 4; ++x) if (at(x, y).join() !== background.join()) covered += 1;
      }
      // at its levels of detail (the default, balanced): a 512 stride level drew half of this (2026-11-08)
      expect(covered / (Size * Size * 0.25)).toBeGreaterThan(0.8);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });
});
