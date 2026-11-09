/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { LipidMembrane, LipidMembraneParams, membraneSpecies, registerLipidPatch } from '../lipids/membrane.js';
import { syntheticPatchPdb, writePng } from './lipid-fixtures.js';

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
      await plugin.getImageRaw({ width: Size, height: Size });
      const whole = camera.getSnapshot();
      // close: 250 Å above the sphere's top, looking at it (the clipping radius the whole view's, as a zoom keeps it)
      const close = {
        ...whole,
        target: Vec3.create(0, 0, 600),
        position: Vec3.create(0, 0, 850),
        up: Vec3.create(0, 1, 0),
      };
      const numbers: Record<string, unknown>[] = [];
      const at = async (name: string, snapshot: typeof whole) => {
        camera.setState(snapshot, 0);
        const t0 = performance.now();
        const image = await plugin.getImageRaw({ width: Size, height: Size });
        const ms = performance.now() - t0;
        const pool = { ...repr.pool };
        if (process.env.LIPID_SHOTS) {
          await writePng(`${process.env.LIPID_SHOTS}/${name.replace(/ /g, '-')}.png`, Size, Size, image.data);
        }
        numbers.push({ name, ms: Math.round(ms), ...pool });
        return { image: image.data, pool };
      };
      // the texture's switch: lipids from 2 px (a 256 px view of a 1200 Å sphere: under 2 px whole)
      await plugin
        .build()
        .to(node.ref)
        .update((p) => ({ ...p, far: (process.env.LIPID_FAR as never) ?? 'texture' }))
        .commit();
      const a = await at('whole', whole);
      const b = await at('close', close);
      const c = await at('whole again', whole);
      const d = await at('close again', close);
      if (process.env.LIPID_NUMBERS) console.log(JSON.stringify({ full: repr.cutLipids, numbers }));
      expect(repr.cutLipids).toBeGreaterThan(0);
      expect(a.pool.live).toBe(0);
      // no lipids whole, but the textured surface: the sphere's middle covered (no gap at any distance)
      const covered = (image: Uint8Array | Uint8ClampedArray) => {
        const bg = Array.from(image.subarray(0, 3)).join();
        let n = 0;
        let all = 0;
        for (let y = Math.round(Size / 3); y < Math.round((2 * Size) / 3); ++y) {
          for (let x = Math.round(Size / 3); x < Math.round((2 * Size) / 3); ++x) {
            const o = (y * Size + x) * 4;
            if (Array.from(image.subarray(o, o + 3)).join() !== bg) n += 1;
            all += 1;
          }
        }
        return n / all;
      };
      expect(covered(a.image)).toBeGreaterThan(0.95);
      // two surfaces, one a leaflet at its heads, in the species' colours, not one mean brown (round 4b, Ludo)
      const surfaces = (
        plugin.state.data.cells.get(node.ref)!.obj!.data.repr as { renderObjects: { type: string }[] }
      ).renderObjects.filter((o) => o.type === 'mesh');
      // and beneath the lipids, near, one a leaflet (round 4c)
      expect(surfaces.length).toBe(4);
      const colors = new Set<string>();
      for (let o = 0; o < a.image.length; o += 4 * 97) colors.add(`${a.image[o]},${a.image[o + 1]},${a.image[o + 2]}`);
      expect(colors.size).toBeGreaterThan(20);
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
    } finally {
      plugin.dispose();
    }
  });
  it('draws what its particle-system properties say: a species hidden, its colour, the atoms’ size', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-procedural-props', syntheticPatchPdb().text);
      const node = await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, {
          ...PD.getDefaultValues(LipidMembraneParams),
          method: 'cutter',
          radius: 600,
          edge: 100,
          patch: 'dawn-procedural-props',
          center: Vec3.zero(),
        })
        .commit();
      const cell = () => plugin.state.data.cells.get(node.ref)!;
      const repr = () => cell().obj!.data.repr as unknown as { pool: { live: number } };
      const species = membraneSpecies(cell().obj!.data.sourceData as never);
      expect(species.length).toBeGreaterThan(1);
      const camera = plugin.canvas3d!.camera;
      plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      camera.setState(
        {
          ...camera.getSnapshot(),
          target: Vec3.create(0, 0, 600),
          position: Vec3.create(0, 0, 850),
          up: Vec3.create(0, 1, 0),
        },
        0,
      );
      const look = async (patch: Record<string, unknown>) => {
        await plugin
          .build()
          .to(node.ref)
          .update((p) => ({ ...p, ...patch }))
          .commit();
        const image = Array.from((await plugin.getImageRaw({ width: Size, height: Size })).data);
        return { image, live: repr().pool.live };
      };
      const all = await look({});
      const hidden = await look({ hiddenSpecies: [species[0]] });
      expect(hidden.live).toBeLessThan(all.live);
      expect(hidden.image).not.toEqual(all.image);
      const shown = await look({ hiddenSpecies: [] });
      expect(shown.live).toBe(all.live);
      expect(shown.image).toEqual(all.image);
      const colored = await look({ speciesColors: { [species[0]]: 0x000000 } });
      expect(colored.image).not.toEqual(all.image);
      const larger = await look({ speciesColors: {}, sizeFactor: 3 });
      expect(larger.image).not.toEqual(all.image);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('selects anew where a clip comes or goes, the camera still (review M4: the leaflet behind shows)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-procedural-clip', syntheticPatchPdb().text);
      const node = await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, {
          ...PD.getDefaultValues(LipidMembraneParams),
          method: 'cutter',
          radius: 600,
          edge: 100,
          patch: 'dawn-procedural-clip',
          center: Vec3.zero(),
        })
        .commit();
      const repr = plugin.state.data.cells.get(node.ref)!.obj!.data.repr as unknown as {
        pool: { live: number; selects: number };
        createOrUpdate: (p: unknown) => { run: () => Promise<void> };
      };
      const camera = plugin.canvas3d!.camera;
      plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      camera.setState(
        {
          ...camera.getSnapshot(),
          target: Vec3.create(0, 0, 600),
          position: Vec3.create(0, 0, 850),
          up: Vec3.create(0, 1, 0),
        },
        0,
      );
      await plugin.getImageRaw({ width: Size, height: Size });
      await plugin.getImageRaw({ width: Size, height: Size });
      const facing = { ...repr.pool };
      expect(facing.live).toBeGreaterThan(0);
      // a plane far behind the sphere: it cuts nothing in view, but turns the facing test off
      const plane = {
        type: 'plane',
        invert: false,
        position: Vec3.create(0, 0, -5000),
        rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
        scale: Vec3.create(1, 1, 1),
        transform: Mat4.identity(),
      };
      await repr.createOrUpdate({ clip: { variant: 'pixel', objects: [plane] } }).run();
      await plugin.getImageRaw({ width: Size, height: Size });
      await plugin.getImageRaw({ width: Size, height: Size });
      const clipped = { ...repr.pool };
      expect(clipped.selects).toBeGreaterThan(facing.selects);
      // both leaflets' units in view: more lipids than the facing one's
      expect(clipped.live).toBeGreaterThan(facing.live);
      // and back: the facing leaflet's again
      await repr.createOrUpdate({ clip: { variant: 'pixel', objects: [] } }).run();
      await plugin.getImageRaw({ width: Size, height: Size });
      await plugin.getImageRaw({ width: Size, height: Size });
      expect(repr.pool.selects).toBeGreaterThan(clipped.selects);
      expect(repr.pool.live).toBe(facing.live);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  it('keeps its patch textures while drawn, destroys them two builds on and when removed (review M2, M3)', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-procedural-textures', syntheticPatchPdb().text);
      // the patch textures a build makes: the patch and the surfaces' tables
      const resources = plugin.canvas3d!.graphics.resources;
      const texture = resources.texture.bind(resources);
      let made: { destroyed: boolean }[] = [];
      resources.texture = ((...args: Parameters<typeof texture>) => {
        const t = texture(...args);
        // made by the membrane (the culler's own textures aside)
        const patch = new Error().stack?.includes('lipids/membrane.ts');
        if (patch) {
          const record = { destroyed: false };
          made.push(record);
          const destroy = t.destroy.bind(t);
          t.destroy = () => {
            record.destroyed = true;
            destroy();
          };
        }
        return t;
      }) as typeof texture;
      made = [];
      const node = (
        await plugin
          .build()
          .toRoot()
          .apply(LipidMembrane, {
            ...PD.getDefaultValues(LipidMembraneParams),
            method: 'cutter',
            radius: 600,
            edge: 100,
            patch: 'dawn-procedural-textures',
            center: Vec3.zero(),
          })
          .commit()
      ).ref;
      const a = made;
      const cell = plugin.state.data.cells.get(node)!.obj!.data;
      const repr = cell.repr as unknown as { createOrUpdate: (p: unknown, d: unknown) => { run: () => Promise<void> } };
      // a rebuild that does not reuse the GPU's cutters (new data, as after a new context): the last build's objects
      // may draw once more (a frame before the canvas swaps them), its textures kept
      const build = async () => {
        made = [];
        await repr.createOrUpdate({}, { ...(cell.sourceData as object) }).run();
        return made;
      };
      await plugin.getImageRaw({ width: Size, height: Size });
      // a patch and two surfaces' tables a leaflet
      expect(a.length).toBeGreaterThanOrEqual(3);
      const b = await build();
      expect(b.length).toBe(a.length);
      expect(a.every((t) => !t.destroyed)).toBe(true);
      // the next: A's go, B's stay
      const c = await build();
      expect(a.every((t) => t.destroyed)).toBe(true);
      expect(b.every((t) => !t.destroyed)).toBe(true);
      expect(c.every((t) => !t.destroyed)).toBe(true);
      // removed: every one of them (M2)
      await plugin.build().delete(node).commit();
      expect([...b, ...c].every((t) => t.destroyed)).toBe(true);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });

  // medium (review S5: tens of seconds on Dawn); its quick representative the camera path above
  it('flies over a billion lipids (round 5: the model at x600, a sphere of its triangles): cells near, nothing far', {
    timeout: 300_000,
    tags: ['medium'],
  }, async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      registerLipidPatch('dawn-x600', syntheticPatchPdb().text);
      // 2,880 triangles of about 6,000 Å over a sphere of 50,000 Å: the model's triangles and area at x600
      const R = 50000;
      const t0 = performance.now();
      const node = await plugin
        .build()
        .toRoot()
        .apply(LipidMembrane, {
          ...PD.getDefaultValues(LipidMembraneParams),
          method: 'cutter',
          radius: R,
          edge: (R * 1.2) / 12,
          patch: 'dawn-x600',
          center: Vec3.zero(),
        })
        .commit();
      const wrapMs = performance.now() - t0;
      const repr = plugin.state.data.cells.get(node.ref)!.obj!.data.repr as unknown as {
        cutLipids: number;
        pool: {
          live: number;
          triangles: number;
          inView: number;
          selectMs: number;
          selects: number;
          regenerations: number;
        };
      };
      expect(repr.cutLipids).toBeGreaterThan(5e8);
      const canvas = plugin.canvas3d!;
      const camera = canvas.camera;
      canvas.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      const whole = camera.getSnapshot();
      const above = (h: number) => ({
        ...whole,
        target: Vec3.create(0, 0, R),
        position: Vec3.create(0, 0, R + h),
        up: Vec3.create(0, 1, 0),
      });
      const numbers: Record<string, unknown>[] = [{ wrapMs: Math.round(wrapMs), full: repr.cutLipids }];
      const at = async (name: string, snapshot: typeof whole) => {
        camera.setState(snapshot, 0);
        const t = performance.now();
        const image = await plugin.getImageRaw({ width: Size, height: Size });
        const ms = performance.now() - t;
        const pool = { ...repr.pool };
        numbers.push({ name, ms: Math.round(ms), ...pool });
        // a second frame: the occlusion culling reads the frame before (another view's on the first)
        const settled = await plugin.getImageRaw({ width: Size, height: Size });
        if (process.env.LIPID_SHOTS) {
          await writePng(`${process.env.LIPID_SHOTS}/r5-x600-${name.replace(/ /g, '-')}.png`, Size, Size, settled.data);
        }
        expect(repr.pool.selects).toBe(pool.selects);
        return { image: settled.data, pool, first: image.data };
      };
      const a = await at('whole', whole);
      const b = await at('middle', above(20000));
      const c = await at('close', above(300));
      const d = await at('whole again', whole);
      const e = await at('close again', above(300));
      if (process.env.LIPID_NUMBERS) console.log(JSON.stringify(numbers));
      // whole and middle: the texture alone; close: cells of the leaflet facing the camera, a few hundred thousand lipids
      expect(a.pool.live).toBe(0);
      expect(b.pool.live).toBe(0);
      expect(c.pool.live).toBeGreaterThan(1000);
      expect(c.pool.live).toBeLessThan(1_000_000);
      expect(c.pool.triangles).toBeGreaterThan(4);
      expect(d.pool.live).toBe(0);
      // the same view from the same start: the same lipids, drawn the same
      expect(e.pool.live).toBe(c.pool.live);
      let diff = 0;
      for (let o = 0; o < c.image.length; o += 4)
        if (c.image[o] !== e.image[o] || c.image[o + 1] !== e.image[o + 1]) diff += 1;
      // the same cells and slots; a few pixels apart (3 of 65,536 here: the frame before differs, middle or whole)
      expect(e.pool.triangles).toBe(c.pool.triangles);
      expect(diff / (Size * Size), 'pixels').toBeLessThan(1e-3);
      // close: covered (lipids and the surface beneath: no hole), in more than the surface's colours
      const bg = Array.from(c.image.subarray(0, 3)).join();
      let drawn = 0;
      const colors = new Set<string>();
      for (let o = 0; o < c.image.length; o += 4) {
        const k = `${c.image[o]},${c.image[o + 1]},${c.image[o + 2]}`;
        if (k !== bg) drawn += 1;
        if (o % (4 * 13) === 0) colors.add(k);
      }
      expect(drawn / (Size * Size)).toBeGreaterThan(0.95);
      expect(colors.size).toBeGreaterThan(50);
      // at rest: no selection, no regeneration
      const rest = { ...repr.pool };
      for (let i = 0; i < 3; ++i) await plugin.getImageRaw({ width: Size, height: Size });
      expect(repr.pool.selects).toBe(rest.selects);
      expect(repr.pool.regenerations).toBe(rest.regenerations);
      expect(canvas.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });
});
