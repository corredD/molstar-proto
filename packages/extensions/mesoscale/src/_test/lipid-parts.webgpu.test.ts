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
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import {
  buildMembraneSteps,
  concatMeshes,
  forgetLipidPatch,
  LipidMembraneParams,
  LipidMembraneRepresentation,
  registerLipidPatch,
  runSteps,
} from '../lipids/membrane.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A cell's membranes, each part its eye and colour (lipid-procedural round 7 item 2) and its mix (item 3), on Dawn: a
// mito IM and an LD side by side.

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
const MixSpecies = ['CHL1', 'POPC', 'DOPC', 'POPE', 'PLPE', 'POPI', 'POPS', 'DOPA', 'SSM'];

/** the share of the pixels drawn in `a` (not its background) that `b` draws otherwise */
function changed(a: Uint8Array, b: Uint8Array) {
  let drawn = 0;
  let other = 0;
  for (let o = 0; o < a.length; o += 4) {
    if (a[o] === a[0] && a[o + 1] === a[1] && a[o + 2] === a[2]) continue;
    drawn += 1;
    if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) other += 1;
  }
  return other / Math.max(1, drawn);
}

describe.skipIf(!webgpu)('a cell’s membranes, each part its eye, colour and mix (Dawn, round 7)', () => {
  it('hides a part’s lipids and surfaces, colours it in both looks, draws the LD one leaflet', {
    timeout: 120_000,
  }, async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    registerLipidPatch('dawn-parts', syntheticPatchPdb(12, 14, {}, MixSpecies).text);
    try {
      await plugin.init();
      const at = (m: TriMesh, x: number): TriMesh => ({
        positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v)),
        indices: m.indices,
      });
      const { mesh, parts } = concatMeshes([icosphere(400, 80), at(icosphere(300, 80), 900)], ['MITO_IM', 'LD']);
      const data = await runSteps(
        buildMembraneSteps(
          { mesh, parts },
          'dawn-parts',
          0,
          'both',
          { edgeTypes: 1, vertexColors: 1, variants: 1, seed: 1 },
          'cutter',
        ),
        SyncRuntimeContext,
      );
      if (typeof data === 'string') expect.fail(data);
      expect(data.unmixed).toEqual([]);
      const base = { ...PD.getDefaultValues(LipidMembraneParams), method: 'cutter' as const, patch: 'dawn-parts' };
      const repr = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      const look = async (p: Partial<typeof base>) => {
        await repr.createOrUpdate({ ...base, ...p }, data).run();
        await plugin.getImageRaw({ width: Size, height: Size });
      };
      await look({});
      plugin.canvas3d!.add(repr as never);
      const pool = () => (repr as unknown as { pool: { live: number } }).pool;
      const surfaces = () => repr.renderObjects.filter((o) => o.type === 'mesh').length;
      // the members' groups (their atoms by their pools' capacities): the merged spheres' content
      const spheres = () => repr.groupCount;
      const camera = plugin.canvas3d!.camera;
      plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
      await plugin.getImageRaw({ width: Size, height: Size });
      const whole = camera.getSnapshot();
      // close over the IM's top: its lipids drawn (the LD's out of reach)
      const close = {
        ...whole,
        position: Vec3.create(0, 0, 520),
        target: Vec3.create(0, 0, 400),
        up: Vec3.create(0, 1, 0),
      };
      const image = async (view: typeof whole) => {
        camera.setState(view, 0);
        await plugin.getImageRaw({ width: Size, height: Size });
        return (await plugin.getImageRaw({ width: Size, height: Size })).data as Uint8Array;
      };
      // the IM two leaflets, the LD one (a monolayer): a near and a far surface each
      expect(surfaces()).toBe(6);
      const closeImage = await image(close);
      expect(pool().live).toBeGreaterThan(0);
      const before = { close: closeImage, whole: await image(whole) };
      const objects = spheres();

      // the IM hidden: its lipids and surfaces gone, the LD's kept
      await look({ hiddenParts: ['MITO_IM'] });
      expect(surfaces()).toBe(2);
      expect(spheres()).toBeLessThan(objects);
      const hidden = await image(close);
      expect(pool().live).toBe(0);
      expect(changed(before.close, hidden)).toBeGreaterThan(0.3);
      await look({ hiddenParts: [] });

      // its colour, By zoom off: all of it, close up and far
      await look({ partColors: { MITO_IM: 0x00ff00 } });
      expect(changed(before.close, await image(close))).toBeGreaterThan(0.3);
      expect(changed(before.whole, await image(whole))).toBeGreaterThan(0.1);
      // By zoom on (far the membrane's colour until a lipid's atom is 100 px: the whole view), its colour far, its
      // species and atoms close (review D1: By zoom kept)
      const levels = {
        colorLevels: {
          name: 'on' as const,
          params: { entity: 100, chain: 150, atom: 190, band: 1, chainHue: 90 } as never,
        },
      };
      await look(levels);
      const zoomed = { close: await image(close), whole: await image(whole) };
      await look({ ...levels, partColors: { MITO_IM: 0x00ff00 } });
      expect(changed(zoomed.whole, await image(whole))).toBeGreaterThan(0.1);
      // By zoom's own edges (atoms by element from 28.8 px an atom, species from 0.27): close up the atoms' colours
      // stay (review D1: a part's colour does not turn By zoom off, as a uniform theme would)
      const own = {
        colorLevels: {
          name: 'on' as const,
          params: { entity: 0.27, chain: 2.2, atom: 28.8, band: 1, chainHue: 90 } as never,
        },
      };
      await look(own);
      const atoms = await image(close);
      await look({ ...own, partColors: { MITO_IM: 0x00ff00 } });
      expect(changed(atoms, await image(close))).toBeLessThan(0.1);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-parts');
      plugin.dispose();
    }
  });
});
