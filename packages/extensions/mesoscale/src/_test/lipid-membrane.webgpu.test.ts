/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import {
  LipidMembrane,
  LipidMembraneParams,
  LipidMembraneRepresentation,
  registerLipidPatch,
} from '../lipids/membrane.js';
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
      // one merged object of every variant's spheres, culled on the GPU (and the far surfaces: round 4b item 5)
      expect(repr.renderObjects.filter((o: { type: string }) => o.type === 'spheres').length).toBe(1);
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
      // custom levels by distance, the camera past the last’s start: 1 atom in 512, scaled, still a sheet
      const node = [...plugin.state.data.cells.values()].find((c) => c.transform.transformer === LipidMembrane)!;
      const levels = [
        { distance: 0, stride: 1, bias: 1 },
        { distance: 10, stride: 8, bias: 2 },
        { distance: 20, stride: 512, bias: 2 },
      ];
      await plugin
        .build()
        .to(node.transform.ref)
        .update((p) => ({ ...p, detail: 'custom', levels }))
        .commit();
      const coarse = await plugin.getImageRaw({ width: Size, height: Size });
      let coarseCovered = 0;
      for (let y = Size / 4; y < (3 * Size) / 4; ++y) {
        for (let x = Size / 4; x < (3 * Size) / 4; ++x) {
          const o = (y * Size + x) * 4;
          if (Array.from(coarse.data.subarray(o, o + 3)).join() !== background.join()) coarseCovered += 1;
        }
      }
      expect(coarseCovered / (Size * Size * 0.25)).toBeGreaterThan(0.8);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('gives tiles the cutter’s looks: the far surfaces at the heads, its species hidden lipid by lipid (round 4b item 5)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      const params = {
        ...PD.getDefaultValues(LipidMembraneParams),
        radius: 300,
        edge: 80,
        patch: 'dawn-patch',
        center: Vec3.zero(),
      };
      const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
      const repr = () => plugin.state.data.cells.get(node.ref)!.obj!.data.repr;
      const types = () => repr().renderObjects.map((o: { type: string }) => o.type);
      // Both (the default): a surface a leaflet beneath the tiles
      expect(types().filter((t: string) => t === 'mesh').length).toBe(2);
      const all = repr().groupCount;
      await plugin
        .build()
        .to(node.ref)
        .update({ ...params, far: 'spheres' })
        .commit();
      expect(types()).not.toContain('mesh');
      // a hidden species: its lipids out of every tile that has them (a tile mixes species)
      await plugin
        .build()
        .to(node.ref)
        .update({ ...params, far: 'spheres', hiddenSpecies: ['POPC'] })
        .commit();
      const without = repr().groupCount;
      expect(without).toBeLessThan(all * 0.9);
      expect(without).toBeGreaterThan(0);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('is cut by a clip in both looks and both methods: spheres and far surfaces (round 4b item 6)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      // a plane through the center, its normal y: one half of the image cut away
      const plane = {
        variant: 'pixel' as const,
        objects: [
          {
            type: 'plane' as const,
            invert: false,
            position: Vec3.zero(),
            rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
            scale: Vec3.create(1, 1, 1),
            transform: Mat4.identity(),
          },
        ],
      };
      /** the covered fraction of the image's top and bottom halves */
      const halves = async () => {
        const image = (await plugin.getImageRaw({ width: Size, height: Size })).data;
        const background = Array.from(image.subarray(0, 3)).join();
        const out = [0, 0];
        for (let y = 0; y < Size; ++y) {
          for (let x = 0; x < Size; ++x) {
            const o = (y * Size + x) * 4;
            if (Array.from(image.subarray(o, o + 3)).join() !== background) out[y < Size / 2 ? 0 : 1] += 1;
          }
        }
        return out.map((n) => n / ((Size * Size) / 2));
      };
      for (const [method, far, extra] of [
        ['cutter', 'spheres', {}],
        // the surfaces alone: no lipid is 16 px on screen whole
        ['cutter', 'texture', { atomsPx: 16 }],
        ['tiles', 'spheres', {}],
        ['tiles', 'both', {}],
      ] as const) {
        const params = {
          ...PD.getDefaultValues(LipidMembraneParams),
          method,
          far,
          ...extra,
          radius: 300,
          edge: 80,
          patch: 'dawn-patch',
          center: Vec3.zero(),
        };
        const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
        plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
        const whole = await halves();
        expect(Math.min(...whole), `${method} ${far} drawn`).toBeGreaterThan(0.2);
        const drawn = plugin.state.data.cells.get(node.ref)!.obj!.data.repr.renderObjects;
        await plugin
          .build()
          .to(node.ref)
          .update({ ...params, clip: plane })
          .commit();
        // a cut alone builds nothing again (a clip's handle previews at the pointer's rate)
        expect(plugin.state.data.cells.get(node.ref)!.obj!.data.repr.renderObjects).toBe(drawn);
        const cut = await halves();
        // one half gone, the other as it was
        expect(Math.min(...cut), `${method} ${far} cut`).toBeLessThan(0.05);
        expect(Math.max(...cut), `${method} ${far} kept`).toBeGreaterThan(0.2);
        await plugin.build().delete(node.ref).commit();
      }
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('changes its look without cutting again: no count pass for a new detail (review S5)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      const compute = plugin.canvas3d!.graphics.compute!;
      const created = vi.spyOn(compute, 'createKernel');
      const params = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        radius: 300,
        edge: 80,
        patch: 'dawn-patch',
        center: Vec3.zero(),
      };
      const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
      const counts = () => created.mock.calls.filter(([code]) => code.name === 'lipid-cut-count').length;
      expect(counts()).toBe(2);
      await plugin
        .build()
        .to(node.ref)
        .update({ ...params, detail: 'quality' })
        .commit();
      expect(counts()).toBe(2);
      // nor custom levels (Ludo tunes them in the properties, 2026-11-08)
      await plugin
        .build()
        .to(node.ref)
        .update({
          ...params,
          detail: 'custom',
          levels: [
            { distance: 0, stride: 1, bias: 1 },
            { distance: 500, stride: 16, bias: 2 },
          ],
        })
        .commit();
      expect(counts()).toBe(2);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('fails past the device’s buffers before it draws, and drops its objects on a new context (Ludo, 2026-11-08)', async () => {
    // the cutter at 27.7 M lipids said ok, then lost the WebGPU device; after the fall back to WebGL2 a texture past its
    // range was uploaded
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      const graphics = plugin.canvas3d!.graphics;
      const compute = graphics.compute! as { maxStorageBufferSize: number };
      const limit = compute.maxStorageBufferSize;
      const params = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        radius: 300,
        edge: 80,
        patch: 'dawn-patch',
        center: Vec3.zero(),
      };
      // a device whose storage buffers hold the count pass but not the culler's instances
      compute.maxStorageBufferSize = 64 * 1024;
      await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, params)
        .commit()
        .catch(() => {});
      const cell = [...plugin.state.data.cells.values()].find((c) => c.transform.transformer === LipidMembrane);
      expect(cell?.status).toBe('error');
      expect(cell?.errorText).toMatch(/GPU’s buffers/);
      compute.maxStorageBufferSize = limit;
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
      // within the limits it draws; a new context (a fall back to WebGL2: no compute) drops its objects
      await plugin.build().delete(cell!.transform.ref).commit();
      const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
      const repr = plugin.state.data.cells.get(node.ref)!.obj!.data.repr;
      // the cutter's lipids merged, and the far look's surfaces, one a leaflet
      expect(repr.renderObjects.length).toBe(3);
      repr.setGraphics!({ ...graphics, compute: undefined } as never);
      await repr.createOrUpdate().run();
      expect(repr.renderObjects.length).toBe(0);
      // a new context while a build waits on the GPU (its count pass): the stale build keeps nothing (review S1)
      const fresh = LipidMembraneRepresentation(graphics);
      const data = plugin.state.data.cells.get(node.ref)!.obj!.data.sourceData;
      const first = fresh.createOrUpdate(params, data).run();
      fresh.setGraphics!({ ...graphics, compute: undefined } as never);
      await fresh.createOrUpdate().run();
      await first.catch(() => {});
      expect(fresh.renderObjects.length).toBe(0);
      fresh.destroy();
    } finally {
      plugin.dispose();
    }
  });

  it('offers no cancel while it redraws a membrane already made (review X1: a cancel lost it)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-patch', syntheticPatchPdb().text);
      const params = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        radius: 300,
        edge: 80,
        patch: 'dawn-patch',
        center: Vec3.zero(),
      };
      const node = await plugin.build().toRoot().apply(LipidMembrane, params).commit();
      // every stage past the yield interval; a cancel asked at the first upload of the redraw
      let clock = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100));
      const tasks = plugin.managers.task;
      let asked = false;
      const sub = tasks.events.progress.subscribe((e) => {
        if (e.progress.root.progress.message.startsWith('Uploading')) {
          asked = true;
          tasks.requestAbort(e.progress);
        }
      });
      await plugin
        .build()
        .to(node.ref)
        .update({ ...params, detail: 'quality' })
        .commit({ revertOnError: true })
        .catch(() => {});
      sub.unsubscribe();
      expect(asked).toBe(true);
      const cell = plugin.state.data.cells.get(node.ref)!;
      expect(cell.status).toBe('ok');
      // the cutter's lipids merged, and the far look's surfaces, one a leaflet (lipid-procedural round 4b)
      expect(cell.obj?.data.repr.renderObjects.length).toBe(3);
    } finally {
      vi.restoreAllMocks();
      plugin.dispose();
    }
  });
});
