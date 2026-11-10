/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
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
      // Coarse's look (parallax the default since 2026-11-10: the atoms only down to 11 px, the relief below): its atoms by element as spheres
      expect((await v.api.mesoscale!.membraneDetail({ membrane, middle: 'coarse' } as never)).ok).toBe(true);
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

// Round 7 item 6 (Ludo, 2026-11-09): "the dynamic color should show the atomic color and residues color and membrane
// colors". By zoom with its default edges, a membrane far its colour (`colorLevels {far}`), its species' in the middle,
// each atom's by element close up (the tiles' too); each control changes its own level alone; the edges no rebuild.

/** the shares of the pixels drawn (not the background) that are blue, green, P or O (orange, red), carbon grey */
function shares(a: Uint8Array) {
  let drawn = 0;
  const n = { blue: 0, green: 0, heads: 0, grey: 0, yellow: 0 };
  for (let o = 0; o < a.length; o += 4) {
    const [r, g, b] = [a[o], a[o + 1], a[o + 2]];
    if (r === a[0] && g === a[1] && b === a[2]) continue;
    drawn += 1;
    if (b > r + 30 && b > g + 30) n.blue += 1;
    if (g > r + 30 && g > b + 30) n.green += 1;
    if (r > 150 && b < 60 && g < 150) n.heads += 1;
    if (r > 50 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) n.grey += 1;
    if (r > 120 && g > 120 && b < 60) n.yellow += 1;
  }
  const d = Math.max(1, drawn);
  return { blue: n.blue / d, green: n.green / d, heads: n.heads / d, grey: n.grey / d, yellow: n.yellow / d, drawn };
}

/** the share of the pixels drawn in `a` (not its background) that `b` draws otherwise */
function changedShare(a: Uint8Array, b: Uint8Array) {
  let drawn = 0;
  let other = 0;
  for (let o = 0; o < a.length; o += 4) {
    if (a[o] === a[0] && a[o + 1] === a[1] && a[o + 2] === a[2]) continue;
    drawn += 1;
    if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) other += 1;
  }
  return other / Math.max(1, drawn);
}

/** A viewer with a membrane wrapped by `method`, its species lime and By zoom on (default edges), far `far` alone */
async function levelsSetup(method: 'cutter' | 'tiles', patch: string, far?: string) {
  const options = { backend: 'webgpu' as const };
  const renderer = await HeadlessScreenshotHelper.create({ webgpu }, { width: Size, height: Size }, options);
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    plugin: (spec) => new HeadlessPluginContext({ webgpu }, spec, { width: Size, height: Size }, options, renderer),
  });
  registerLipidPatch(patch, syntheticPatchPdb().text);
  const plugin = v.plugin as HeadlessPluginContext;
  const canvas = plugin.canvas3d!;
  canvas.setProps({ camera: { ...canvas.props.camera, mode: 'perspective' } });
  const r = await v.api.mesoscale!.wrapMembrane({ radius: Radius, edge: 80, patch, method } as never);
  if (!r.ok) throw new Error(r.message);
  const membrane = r.changed!.nodes![0];
  // every species lime (one colour on all of it: its far colour too), then the far colour alone
  const style = await v.api.run('mesoscale.style', { particles: membrane, color: 'lime' });
  expect(style.ok, style.message).toBe(true);
  const on = await v.api.run('mesoscale.colorLevels', { particles: membrane, on: true, ...(far ? { far } : {}) });
  expect(on.ok, on.message).toBe(true);
  canvas.requestCameraReset({ durationMs: 0 });
  await plugin.getImageRaw({ width: Size, height: Size });
  const camera = canvas.camera;
  const whole = camera.getSnapshot();
  /** the camera on the +z axis where an atom at the outer heads (r + 22 Å) covers `px` pixels */
  const at = (px: number) => {
    const depth = ColorLevels.AtomSize / ((2 / (camera.projection[5] * Size)) * px);
    return {
      ...whole,
      target: Vec3.create(0, 0, 0),
      position: Vec3.create(0, 0, Radius + 22 + depth),
      up: Vec3.create(0, 1, 0),
    };
  };
  // the levels with the default edges (0.27, 2.2, 28.8 px an atom, a band of one octave): far under 0.19, species
  // from 0.38 (a membrane's chain its species: to 20), atoms from 40.7; the middle close enough that its surface fills
  // the view (a surface's level by its fragments' size on screen: its limbs, foreshortened, go far)
  // close: over the heads (P, O) and between the leaflets, along the mid-plane among the tails (carbons)
  const tails = {
    ...whole,
    target: Vec3.create(0, 60, Radius),
    position: Vec3.create(0, 0, Radius),
    up: Vec3.create(0, 0, 1),
  };
  const views = { far: at(0.1), middle: at(6), close: at(120), tails };
  const image = async (view: keyof typeof views) => {
    camera.setState(views[view], 0);
    await plugin.getImageRaw({ width: Size, height: Size });
    const a = (await plugin.getImageRaw({ width: Size, height: Size })).data as Uint8Array;
    if (process.env.LIPID_SHOTS) await writePng(`${process.env.LIPID_SHOTS}/r7-${method}-${view}.png`, Size, Size, a);
    return a;
  };
  const all = async () => ({
    far: await image('far'),
    middle: await image('middle'),
    close: await image('close'),
    tails: await image('tails'),
  });
  const dispose = () => {
    forgetLipidPatch(patch);
    v.dispose?.();
  };
  const repr = () =>
    (v.plugin.state.data.cells.get(membrane)!.obj!.data as { repr: { renderObjects: readonly unknown[] } }).repr;
  return { v, plugin, canvas, membrane, image, all, dispose, repr };
}

describe.skipIf(!webgpu)('a membrane coloured by zoom on three levels, each its control (Dawn, round 7 item 6)', () => {
  for (const method of ['cutter', 'tiles'] as const) {
    it(`${method}: far its own colour (\`colorLevels {far}\`), its species' beneath`, {
      timeout: 120_000,
    }, async () => {
      const s = await levelsSetup(method, `dawn-far-${method}`, 'blue');
      try {
        const f = shares(await s.image('far'));
        const m = shares(await s.image('middle'));
        expect(f.drawn, 'far drawn').toBeGreaterThan(50);
        expect(f.blue, `far ${JSON.stringify(f)}`).toBeGreaterThan(0.6);
        expect(m.green, `middle ${JSON.stringify(m)}`).toBeGreaterThan(0.6);
        expect(s.canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      } finally {
        s.dispose();
      }
    });

    it(`${method}: its species' in the middle, its atoms' by element close (the default edges)`, {
      timeout: 120_000,
    }, async () => {
      const s = await levelsSetup(method, `dawn-three-${method}`);
      try {
        const m = shares(await s.image('middle'));
        const c = shares(await s.image('close'));
        const t = shares(await s.image('tails'));
        expect(m.green, `middle ${JSON.stringify(m)}`).toBeGreaterThan(0.6);
        expect(c.heads, `close ${JSON.stringify(c)}`).toBeGreaterThan(0.1);
        expect(t.grey, `tails ${JSON.stringify(t)}`).toBeGreaterThan(0.3);
        expect(s.canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      } finally {
        s.dispose();
      }
    });

    it(`${method}: the far colour, a species' colour and the atoms' scheme each change their level alone, one step each`, {
      timeout: 120_000,
    }, async () => {
      const s = await levelsSetup(method, `dawn-each-${method}`);
      try {
        const params = () => s.v.plugin.state.data.cells.get(s.membrane)!.transform.params as Record<string, unknown>;
        let before = await s.all();
        type Look = 'far' | 'middle' | 'close' | 'tails';
        // each step: its level changed, the others kept (the atoms deeper than the close view's first ones are at the
        // species' level: a species' colour changes them too)
        const steps: [string, Record<string, unknown>, Look, Look[]][] = [
          ['mesoscale.style', { entities: 'POPC', color: 'yellow' }, 'middle', ['far']],
          ['mesoscale.colorLevels', { far: 'red' }, 'far', ['middle', 'close', 'tails']],
          ['mesoscale.colorLevels', { atoms: 'carbon-species' }, 'tails', ['far', 'middle']],
        ];
        for (const [id, given, level, kept] of steps) {
          const was = JSON.stringify(params());
          const run = await s.v.api.run(id, { particles: s.membrane, ...given });
          expect(run.ok, `${id} ${run.message}`).toBe(true);
          expect(JSON.stringify(params()), `${id} ${JSON.stringify(given)} changed the params`).not.toBe(was);
          const after = await s.all();
          const at = (look: Look) =>
            `${id} ${JSON.stringify(given)} at ${look}: ${changedShare(before[look], after[look])}`;
          expect(changedShare(before[level], after[level]), at(level)).toBeGreaterThan(0.15);
          for (const look of kept) expect(changedShare(before[look], after[look]), at(look)).toBeLessThan(0.05);
          // one history step: undone, the params as they were
          const undo = await s.v.api.history.undo({});
          expect(undo.ok, undo.message).toBe(true);
          expect(JSON.stringify(params()), `${id} undone`).toBe(was);
          const redo = await s.v.api.history.redo({});
          expect(redo.ok, redo.message).toBe(true);
          before = await s.all();
        }
        expect(s.canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      } finally {
        s.dispose();
      }
    });

    it(`${method}: a clip keeps the atoms' colours close up (round 7 review S3)`, { timeout: 120_000 }, async () => {
      const s = await levelsSetup(method, `dawn-clip-close-${method}`);
      try {
        // a plane through the center facing +x (Prism's new plane faces the camera): the x > 0 half cut away, the close
        // view over the top heads (on the plane) half drawn
        const camera = s.canvas.camera;
        const snapshot = camera.getSnapshot();
        const d = Vec3.distance(snapshot.position, snapshot.target);
        camera.setState({ ...snapshot, position: Vec3.create(d, 0, 0), up: Vec3.create(0, 0, 1) }, 0);
        const clip = await s.v.api.run('clipping.add', { shape: 'plane', node: `#${s.membrane}` });
        expect(clip.ok, clip.message).toBe(true);
        const c = shares(await s.image('close'));
        expect(c.drawn, `close ${JSON.stringify(c)}`).toBeGreaterThan(50);
        // the atoms by element, not the species' lime: heads (P, O) and, through the cut, the tails' carbons
        expect(c.heads + c.grey, `close ${JSON.stringify(c)}`).toBeGreaterThan(0.3);
        expect(s.canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      } finally {
        s.dispose();
      }
    });

    it(`${method}: the levels' edges move without a rebuild (the same objects, drawn anew)`, {
      timeout: 120_000,
    }, async () => {
      const s = await levelsSetup(method, `dawn-edges-${method}`);
      try {
        const objects = [...s.repr().renderObjects];
        const close = await s.image('close');
        // the atoms from 200 px an atom: the close view (60 px) its species', lime
        const run = await s.v.api.run('mesoscale.colorLevels', { particles: s.membrane, chain: 150, atom: 200 });
        expect(run.ok, run.message).toBe(true);
        const after = await s.image('close');
        expect(s.repr().renderObjects.length).toBe(objects.length);
        s.repr().renderObjects.forEach((o, i) => expect(o === objects[i], `object ${i} kept`).toBe(true));
        expect(changedShare(close, after)).toBeGreaterThan(0.3);
        expect(shares(after).green).toBeGreaterThan(0.6);
        expect(s.canvas.graphics.takeErrors?.() ?? []).toEqual([]);
      } finally {
        s.dispose();
      }
    });
  }
});
