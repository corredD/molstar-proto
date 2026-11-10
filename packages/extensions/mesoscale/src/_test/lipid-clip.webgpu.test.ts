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
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { HeadlessScreenshotHelper } from '@molstar/plugin-headless/screenshot';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { forgetLipidPatch, registerLipidPatch } from '../lipids/membrane.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// Ludo, 2026-11-08 at 1354: "we still cant cut away". Prism's own clip (`clipping.add` on the membrane's node, as the
// right-click's Add clip… runs it) on a membrane drawn with WebGPU: what it cuts goes, in both methods.

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

describe.skipIf(!webgpu)('a lipid membrane clipped by Prism (Dawn)', () => {
  it('cuts away the near half with clipping.add on its node, both methods (round 4b item 6)', async () => {
    const options = { backend: 'webgpu' as const };
    const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
      plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
    });
    registerLipidPatch('dawn-clip', syntheticPatchPdb().text);
    try {
      const plugin = v.plugin as HeadlessPluginContext;
      const image = async () => Array.from((await plugin.getImageRaw({ width: Size, height: Size })).data);
      /** the fraction of the membrane's pixels (not background in `a`) that `b` draws otherwise */
      const changed = (a: number[], b: number[]) => {
        const background = a.slice(0, 3).join();
        let drawn = 0;
        let other = 0;
        for (let o = 0; o < a.length; o += 4) {
          if (a.slice(o, o + 3).join() === background) continue;
          drawn += 1;
          if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) other += 1;
        }
        return { drawn: drawn / (a.length / 4), other: other / Math.max(1, drawn) };
      };
      for (const method of ['cutter', 'tiles'] as const) {
        const r = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'dawn-clip', method } as never);
        if (!r.ok) throw new Error(r.message);
        const membrane = r.changed!.nodes![0];
        plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
        const whole = await image();
        const clip = await v.api.run('clipping.add', { shape: 'plane', node: `#${membrane}` });
        expect(clip.ok, `${method}: ${clip.message}`).toBe(true);
        // Prism's new plane faces the camera through the center: the near half cut away, the inside seen
        const { drawn, other } = changed(whole, await image());
        expect(drawn, `${method} drawn`).toBeGreaterThan(0.3);
        expect(other, `${method} cut`).toBeGreaterThan(0.5);
        expect((await v.api.run('state.remove', { node: membrane })).ok).toBe(true);
      }
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-clip');
      v.dispose?.();
    }
  });
  // round 8 (Ludo: "looking great at the same time with and without cut"): a clip through a membrane at the middle
  // distance, each middle look against the coarse spheres (test 5, the gate's M2): perspective as the app's camera,
  // after the clip the camera on the cut's ring (the plane z = 0 through the center), lipids about 5 px there; obliquely
  // (k = 0.7) as much drawn, face-on (k = 0.999) the cross-section's band (its dark interior) as much
  it('cuts each middle look as the coarse one: the cross-section at the ring (round 8, test 5)', {
    timeout: 240_000,
  }, async () => {
    const options = { backend: 'webgpu' as const };
    const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
      plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
    });
    registerLipidPatch('dawn-clip-middle', syntheticPatchPdb().text);
    try {
      const plugin = v.plugin as HeadlessPluginContext;
      const looks: Record<string, { coverage: number; band: number; L: number; a: number; b: number }> = {};
      let dragged = 0;
      for (const middle of ['coarse', 'parallax'] as const) {
        const r = await v.api.mesoscale!.wrapMembrane({
          radius: 300,
          edge: 80,
          patch: 'dawn-clip-middle',
          method: 'cutter',
        } as never);
        if (!r.ok) throw new Error(r.message);
        const membrane = r.changed!.nodes![0];
        expect((await v.api.mesoscale!.membraneDetail({ membrane, middle } as never)).ok).toBe(true);
        const canvas = plugin.canvas3d!;
        canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
        canvas.requestCameraReset({ durationMs: 0 });
        await plugin.getImageRaw({ width: Size, height: Size });
        // the middle distance: a lipid (7.4 Å) 5 px at `depth`
        const depth = (7.4 * Size * canvas.camera.projection[5]) / (2 * 5);
        canvas.camera.setState(
          { ...canvas.camera.getSnapshot(), target: Vec3.create(0, 0, 0), position: Vec3.create(0, 0, 300 + depth) },
          0,
        );
        expect((await v.api.run('clipping.add', { shape: 'plane', node: `#${membrane}` })).ok).toBe(true);
        const ring = async (k: number) => {
          canvas.camera.setState(
            {
              ...canvas.camera.getSnapshot(),
              target: Vec3.create(300, 0, 0),
              position: Vec3.create(300 + depth * Math.sqrt(1 - k * k), 0, depth * k),
              up: Vec3.create(0, 1, 0),
            },
            0,
          );
          await plugin.getImageRaw({ width: Size, height: Size });
          return (await plugin.getImageRaw({ width: Size, height: Size })).data;
        };
        const image = await ring(0.7);
        const bg = [image[0], image[1], image[2]];
        const lab = Vec3();
        const sum = [0, 0, 0];
        let n = 0;
        for (let o = 0; o < image.length; o += 4) {
          if (image[o] === bg[0] && image[o + 1] === bg[1] && image[o + 2] === bg[2]) continue;
          ColorLevels.toOklab(lab, Color.fromRgb(image[o], image[o + 1], image[o + 2]));
          for (let k = 0; k < 3; ++k) sum[k] += lab[k];
          n += 1;
        }
        // face-on: the cross-section's band, the bilayer's dark interior between its two leaflets
        const face = await ring(0.999);
        let band = 0;
        for (let o = 0; o < face.length; o += 4) {
          ColorLevels.toOklab(lab, Color.fromRgb(face[o], face[o + 1], face[o + 2]));
          if (lab[0] < 0.5) band += 1;
        }
        // a second clip change (a handle's drag, its commit): the fast path, nothing built again; the band follows the cut
        if (middle === 'parallax') {
          const repr = () =>
            (plugin.state.data.cells.get(membrane)?.obj?.data as { repr?: unknown })?.repr as {
              renderObjects: unknown[];
            };
          const objects = repr().renderObjects;
          // the camera first, on the ring the cut moves to (a still camera while the handle moves)
          const x = Math.sqrt(300 * 300 - 30 * 30);
          canvas.camera.setState(
            {
              ...canvas.camera.getSnapshot(),
              target: Vec3.create(x, 0, -30),
              position: Vec3.create(x + depth * Math.sqrt(1 - 0.49), 0, -30 + depth * 0.7),
              up: Vec3.create(0, 1, 0),
            },
            0,
          );
          await plugin.getImageRaw({ width: Size, height: Size });
          const moved = await v.api.run('clipping.update', { cut: 1, position: [0, 0, -30] });
          expect(moved.ok, moved.message).toBe(true);
          expect(repr().renderObjects).toBe(objects);
          await plugin.getImageRaw({ width: Size, height: Size });
          const after = (await plugin.getImageRaw({ width: Size, height: Size })).data;
          let drawn = 0;
          for (let o = 0; o < after.length; o += 4) {
            if (after[o] !== bg[0] || after[o + 1] !== bg[1] || after[o + 2] !== bg[2]) drawn += 1;
          }
          dragged = drawn / (after.length / 4);
        }
        looks[middle] = {
          coverage: n / (image.length / 4),
          band: band / (face.length / 4),
          L: sum[0] / n,
          a: sum[1] / n,
          b: sum[2] / n,
        };
        expect((await v.api.run('state.remove', { node: membrane })).ok).toBe(true);
      }
      if (process.env.LIPID_NUMBERS) console.log(JSON.stringify({ ...looks, dragged }));
      const coarse = looks.coarse;
      expect(coarse.coverage).toBeGreaterThan(0.2);
      expect(coarse.band).toBeGreaterThan(0.05);
      expect(dragged, 'parallax after the drag').toBeGreaterThanOrEqual(coarse.coverage - 0.05);
      for (const [middle, look] of Object.entries(looks)) {
        expect(look.coverage, `${middle} coverage`).toBeGreaterThanOrEqual(coarse.coverage - 0.05);
        expect(look.band, `${middle} band`).toBeGreaterThanOrEqual(coarse.band * 0.5);
      }
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-clip-middle');
      v.dispose?.();
    }
  });
  // the gate's S2: a middle look's switch is uniforms, a raster and a selection anew, not a build (`onlyMiddle`): the
  // Atoms down to px, and with a clip coarse and parallax both (their lipids' levels the same)
  it('switches a middle look without a build: the same render objects, another image (round 8 gate S2)', {
    timeout: 240_000,
  }, async () => {
    const options = { backend: 'webgpu' as const };
    const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
      plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
    });
    registerLipidPatch('dawn-clip-switch', syntheticPatchPdb().text);
    try {
      const plugin = v.plugin as HeadlessPluginContext;
      const r = await v.api.mesoscale!.wrapMembrane({
        radius: 300,
        edge: 80,
        patch: 'dawn-clip-switch',
        method: 'cutter',
      } as never);
      if (!r.ok) throw new Error(r.message);
      const membrane = r.changed!.nodes![0];
      const canvas = plugin.canvas3d!;
      canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
      canvas.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      // the near side's lipids 12 px: between 11 and 14
      const depth = (7.4 * Size * canvas.camera.projection[5]) / (2 * 12);
      canvas.camera.setState(
        { ...canvas.camera.getSnapshot(), target: Vec3.create(0, 0, 0), position: Vec3.create(0, 0, 300 + depth) },
        0,
      );
      const objects = () =>
        ((plugin.state.data.cells.get(membrane)?.obj?.data as { repr?: unknown })?.repr as { renderObjects: unknown[] })
          .renderObjects;
      const image = async () => {
        await plugin.getImageRaw({ width: Size, height: Size });
        return Array.from((await plugin.getImageRaw({ width: Size, height: Size })).data);
      };
      const differs = (a: number[], b: number[]) => {
        let n = 0;
        for (let o = 0; o < a.length; o += 4) {
          if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) n += 1;
        }
        return n / (a.length / 4);
      };
      const detail = async (p: object) => {
        const d = await v.api.mesoscale!.membraneDetail({ membrane, ...p } as never);
        expect(d.ok, d.message).toBe(true);
      };
      await detail({ middle: 'parallax' });
      const before = objects();
      const at11 = await image();
      await detail({ middlePx: 14 });
      expect(objects(), 'middlePx').toBe(before);
      expect(differs(at11, await image()), 'middlePx').toBeGreaterThan(0.01);
      // with a clip both looks keep the levels (the cut band): a switch without a build either way
      expect((await v.api.run('clipping.add', { shape: 'plane', node: `#${membrane}` })).ok).toBe(true);
      const clipped = objects();
      const parallax = await image();
      await detail({ middle: 'coarse' });
      expect(objects(), 'coarse').toBe(clipped);
      const coarse = await image();
      expect(differs(parallax, coarse), 'coarse').toBeGreaterThan(0.01);
      await detail({ middle: 'parallax' });
      expect(objects(), 'parallax').toBe(clipped);
      expect(differs(parallax, await image()), 'parallax again').toBeLessThan(0.01);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-clip-switch');
      v.dispose?.();
    }
  });
});
