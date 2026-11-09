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

// A membrane made per view on Dawn (lipid-procedural): a camera path whole → close → whole over a sphere cut by the
// cutter. What it generates follows the view (few triangles whole, the ones in view close), nothing is selected or
// written again while the camera rests, and the same path gives the same lipids. LIPID_NUMBERS=1 prints the numbers.

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

describe.skipIf(!webgpu)('a lipid membrane made per view (Dawn)', () => {
  it('generates what the view shows: whole → close → whole, nothing again at rest, the same path the same lipids', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-procedural', syntheticPatchPdb().text);
      const node = await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, {
          ...PD.getDefaultValues(LipidMembraneParams),
          method: 'cutter',
          radius: 600,
          edge: 100,
          patch: 'dawn-procedural',
          center: Vec3.zero(),
        })
        .commit();
      const repr = plugin.state.data.cells.get(node.ref)!.obj!.data.repr as unknown as {
        cutLipids: number;
        pool: { live: number; triangles: number; inView: number; selects: number; regenerations: number };
      };
      const canvas = plugin.canvas3d!;
      const camera = canvas.camera;
      canvas.requestCameraReset({ durationMs: 0 });
      const whole = camera.getSnapshot();
      const close = camera.getFocus(Vec3.create(0, 0, 600), 120);
      const numbers: Record<string, unknown>[] = [];
      const at = async (name: string, snapshot: typeof whole) => {
        camera.setState(snapshot, 0);
        const t0 = performance.now();
        const image = await plugin.getImageRaw({ width: Size, height: Size });
        const ms = performance.now() - t0;
        const pool = { ...repr.pool };
        numbers.push({ name, ms: Math.round(ms), ...pool });
        return { image: image.data, pool };
      };
      // the texture's switch: lipids from 2 px (a 256 px view of a 1200 Å sphere: under 2 px whole)
      await plugin
        .build()
        .to(node.ref)
        .update((p) => ({ ...p, far: 'texture' }))
        .commit();
      const a = await at('whole', whole);
      const b = await at('close', close);
      const c = await at('whole again', whole);
      const d = await at('close again', close);
      expect(repr.cutLipids).toBeGreaterThan(0);
      expect(a.pool.live).toBe(0);
      // close: the triangles in view
      expect(b.pool.live).toBeGreaterThan(0);
      expect(b.pool.live).toBeLessThan(repr.cutLipids);
      expect(b.pool.triangles).toBeLessThanOrEqual(b.pool.inView);
      expect(c.pool.live).toBe(a.pool.live);
      // the same path from the same start: the same lipids, drawn the same
      expect(d.pool.live).toBe(b.pool.live);
      expect(d.pool.triangles).toBe(b.pool.triangles);
      expect(Array.from(d.image)).toEqual(Array.from(b.image));
      // at rest: no selection, no regeneration
      const rest = { ...repr.pool };
      for (let i = 0; i < 3; ++i) await plugin.getImageRaw({ width: Size, height: Size });
      expect(repr.pool.selects).toBe(rest.selects);
      expect(repr.pool.regenerations).toBe(rest.regenerations);
      expect(canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      if (process.env.LIPID_NUMBERS) console.log(JSON.stringify({ full: repr.cutLipids, numbers }, null, 1));
    } finally {
      plugin.dispose();
    }
  });
});
