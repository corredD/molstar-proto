/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { HeadlessScreenshotHelper } from '@molstar/plugin-headless/screenshot';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { forgetLipidPatch, registerLipidPatch } from '../lipids/membrane.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { syntheticPatchPdb, writePng } from './lipid-fixtures.js';

// Ludo, 2026-11-08: "color quickly (all residues / the object) it should follow same coloring as particles (by zoom,
// etc..)". A membrane coloured through a particle list's operations (round 4c item 8): each changes what is drawn, its
// spheres close up and (the cutter) its far surface far away.

const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

const Size = 128;
const Radius = 300;

describe.skipIf(!webgpu)('a lipid membrane coloured as a particle list (Dawn)', () => {
  it('takes the colour operations in both looks, both methods (round 4c item 8)', { timeout: 120_000 }, async () => {
    const options = { backend: 'webgpu' as const };
    const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
      plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
    });
    registerLipidPatch('dawn-colors', syntheticPatchPdb().text);
    try {
      const plugin = v.plugin as HeadlessPluginContext;
      const canvas = plugin.canvas3d!;
      canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
      const camera = canvas.camera;
      /** the share of the pixels drawn in `a` (not its background) that `b` draws otherwise */
      const changed = (a: Uint8Array, b: Uint8Array) => {
        let drawn = 0;
        let other = 0;
        for (let o = 0; o < a.length; o += 4) {
          if (a[o] === a[0] && a[o + 1] === a[1] && a[o + 2] === a[2]) continue;
          drawn += 1;
          if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) other += 1;
        }
        return other / Math.max(1, drawn);
      };
      for (const method of ['cutter', 'tiles'] as const) {
        const r = await v.api.mesoscale!.wrapMembrane({
          radius: Radius,
          edge: 80,
          patch: 'dawn-colors',
          method,
        } as never);
        if (!r.ok) throw new Error(r.message);
        const membrane = r.changed!.nodes![0];
        canvas.requestCameraReset({ durationMs: 0 });
        await plugin.getImageRaw({ width: Size, height: Size });
        const whole = camera.getSnapshot();
        const close = {
          ...whole,
          target: Vec3.create(0, 0, Radius),
          position: Vec3.create(0, 0, Radius + 150),
          up: Vec3.create(0, 1, 0),
        };
        // the cutter's far look: its surface from a lipid of 8 px (whole, every lipid under it)
        if (method === 'cutter') {
          const d = await v.api.run('mesoscale.membraneDetail', { membrane, spheresPx: 8 });
          expect(d.ok, d.message).toBe(true);
        }
        const looks = method === 'cutter' ? { close, whole } : { close };
        const images = async () => {
          const out: Record<string, Uint8Array> = {};
          for (const [name, view] of Object.entries(looks)) {
            camera.setState(view, 0);
            await plugin.getImageRaw({ width: Size, height: Size });
            out[name] = (await plugin.getImageRaw({ width: Size, height: Size })).data as Uint8Array;
          }
          return out;
        };
        const start = await images();
        let before = start;
        const steps: [string, Record<string, unknown>][] = [
          ['mesoscale.style', { particles: membrane, color: 'tomato' }],
          ['mesoscale.colors', { particles: membrane, scheme: 'generate', shift: 40 }],
          ['mesoscale.colors', { particles: membrane, scheme: 'uniform', color: 'dodgerblue' }],
          ['mesoscale.colors', { particles: membrane, scheme: 'theme' }],
          // by zoom: far the membrane's colour until a lipid's atom is 100 px: everything here
          ['mesoscale.colorLevels', { particles: membrane, on: true, entity: 100, chain: 150, atom: 190 }],
          ['mesoscale.colorLevels', { particles: membrane, on: false }],
        ];
        for (const [id, params] of steps) {
          const run = await v.api.run(id, params);
          expect(run.ok, `${method} ${id}: ${run.message}`).toBe(true);
          const after = await images();
          for (const look of Object.keys(looks)) {
            expect(
              changed(before[look], after[look]),
              `${method} ${id} ${JSON.stringify(params)} ${look}`,
            ).toBeGreaterThan(0.3);
          }
          before = after;
        }
        // the theme back: as it was drawn first
        for (const look of Object.keys(looks)) expect(changed(start[look], before[look]), look).toBeLessThan(0.02);
        expect((await v.api.run('state.remove', { node: membrane })).ok).toBe(true);
      }
      expect(canvas.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-colors');
      v.dispose?.();
    }
  });

  it('colours a cut membrane by zoom on three levels: its colour far, its species, its atoms by element (round 5)', {
    timeout: 120_000,
  }, async () => {
    const options = { backend: 'webgpu' as const };
    const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
      plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
    });
    registerLipidPatch('dawn-levels', syntheticPatchPdb().text);
    try {
      const plugin = v.plugin as HeadlessPluginContext;
      const canvas = plugin.canvas3d!;
      canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
      const r = await v.api.mesoscale!.wrapMembrane({
        radius: Radius,
        edge: 80,
        patch: 'dawn-levels',
        method: 'cutter',
      } as never);
      if (!r.ok) throw new Error(r.message);
      const membrane = r.changed!.nodes![0];
      canvas.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      canvas.camera.setState(
        {
          ...canvas.camera.getSnapshot(),
          target: Vec3.create(0, 0, Radius),
          position: Vec3.create(0, 0, Radius + 150),
          up: Vec3.create(0, 1, 0),
        },
        0,
      );
      /** the image at the levels' edges, and the share of its pixels in Mol*'s P and O colours (orange, red) */
      const look = async (edges: Record<string, number>) => {
        const run = await v.api.run('mesoscale.colorLevels', { particles: membrane, on: true, ...edges });
        expect(run.ok, run.message).toBe(true);
        await plugin.getImageRaw({ width: Size, height: Size });
        const a = (await plugin.getImageRaw({ width: Size, height: Size })).data as Uint8Array;
        if (process.env.LIPID_SHOTS) {
          await writePng(`${process.env.LIPID_SHOTS}/r5-levels-${edges.entity}-${edges.atom}.png`, Size, Size, a);
        }
        let drawn = 0;
        let heads = 0;
        for (let o = 0; o < a.length; o += 4) {
          if (a[o] === a[0] && a[o + 1] === a[1] && a[o + 2] === a[2]) continue;
          drawn += 1;
          if (a[o] > 150 && a[o + 2] < 60 && a[o + 1] < 150) heads += 1;
        }
        return { heads: heads / Math.max(1, drawn), image: a };
      };
      const differ = (a: Uint8Array, b: Uint8Array) => {
        let n = 0;
        for (let o = 0; o < a.length; o += 4) {
          if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) n += 1;
        }
        return n / (a.length / 4);
      };
      // the synthetic patch's lipids: a P (or O) head over carbons; the levels where their edges put them
      const atoms = await look({ entity: 0.1, chain: 0.2, atom: 0.3 });
      const species = await look({ entity: 0.1, chain: 150, atom: 200 });
      const far = await look({ entity: 100, chain: 150, atom: 200 });
      expect(atoms.heads).toBeGreaterThan(0.3);
      expect(species.heads).toBeLessThan(atoms.heads / 2);
      expect(differ(atoms.image, species.image)).toBeGreaterThan(0.3);
      expect(differ(far.image, species.image)).toBeGreaterThan(0.3);
      expect(canvas.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-levels');
      v.dispose?.();
    }
  });
});
