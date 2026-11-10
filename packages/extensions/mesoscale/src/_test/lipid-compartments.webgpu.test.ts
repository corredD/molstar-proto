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
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import {
  buildMembraneSteps,
  concatMeshes,
  forgetLipidPatch,
  LipidMembraneParams,
  LipidMembraneRepresentation,
  type MembraneData,
  type MeshTints,
  registerLipidPatch,
  runSteps,
  tint,
} from '../lipids/membrane.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A colour multiplier per compartment, its mesh's colour (lipid-procedural round 9), on Dawn, read from the colour data
// the GPU draws (the merged spheres' and the surfaces'), no image: a mito IM and an LD, each its mesh's tint.

const webgpu = await (async () => {
  try {
    const path = createRequire(import.meta.url).resolve('webgpu');
    const module = await import(pathToFileURL(path).href);
    return (await module.create([]).requestAdapter()) ? module : undefined;
  } catch {
    return undefined;
  }
})();

const Size = 64;
const Red = Color(0xff0000);
const Green = Color(0x00ff00);
const Kinds = { edgeTypes: 1, vertexColors: 1, variants: 1, seed: 1 };

type Values = Record<string, { ref: { value: any; version: number } }>;

/** the colour data of what a membrane draws: its merged spheres' (group, far, near) and its surfaces' colours */
function colors(repr: { renderObjects: readonly { type: string; values: unknown }[] }) {
  const group: number[] = [];
  const far: number[] = [];
  const near: number[] = [];
  const surfaces: number[] = [];
  let synced = 0;
  for (const o of repr.renderObjects) {
    const v = o.values as Values;
    if (o.type === 'mesh') {
      surfaces.push(Color.fromNormalizedArray(v.uColor.ref.value, 0));
      continue;
    }
    // a merged object's data are its members' arrays as parts (`SegmentedArray`), each part's version advanced where
    // the merged object read its member's again (`sync`): what the GPU gets
    const read = (cell: Values[string] | undefined, out: number[]) => {
      const parts = cell?.ref.value.array?.parts as { array: Uint8Array; count: number; version: number }[] | undefined;
      for (const part of parts ?? []) {
        synced += part.version;
        for (let i = 0; i < part.count; i += 4) out.push(Color.fromArray(part.array, i));
      }
    };
    read(v.tColor, group);
    if (v.dColorLevels?.ref.value) {
      read(v.tColorFar, far);
      read(v.tColorNear, near);
    }
  }
  return { group, far, near, surfaces, synced };
}

/** the colours alone (not the parts' versions) */
const drawn = ({ synced: _, ...c }: ReturnType<typeof colors>) => c;

/** how many of `after` are `before`'s, and how many `before`'s times `t` (and not the same) */
function tinted(before: readonly number[], after: readonly number[], t: Color) {
  expect(after.length).toBe(before.length);
  let same = 0;
  let times = 0;
  for (let i = 0; i < before.length; ++i) {
    if (after[i] === before[i]) same += 1;
    else if (after[i] === tint(before[i] as Color, t)) times += 1;
  }
  return { same, times, other: before.length - same - times };
}

describe.skipIf(!webgpu)('a colour multiplier per compartment, its mesh’s colour (Dawn, round 9)', () => {
  it('tints each part by its mesh, recoloured in place, round 7 with the switch off', {
    timeout: 180_000,
  }, async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    registerLipidPatch('dawn-compartments', syntheticPatchPdb(12, 14).text);
    try {
      await plugin.init();
      const at = (m: TriMesh, x: number): TriMesh => ({
        positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v)),
        indices: m.indices,
      });
      const { mesh, parts } = concatMeshes([icosphere(400, 80), at(icosphere(300, 80), 900)], ['MITO_IM', 'LD']);
      const made = async (surface: Parameters<typeof buildMembraneSteps>[0], method: 'cutter' | 'tiles') => {
        const d = await runSteps(
          buildMembraneSteps(surface, 'dawn-compartments', 0, 'both', Kinds, method),
          SyncRuntimeContext,
        );
        if (typeof d === 'string') expect.fail(d);
        return d as MembraneData;
      };
      const data = await made({ mesh, parts }, 'cutter');
      const base = {
        ...PD.getDefaultValues(LipidMembraneParams),
        method: 'cutter' as const,
        patch: 'dawn-compartments',
      };
      const draw = async (repr: ReturnType<typeof LipidMembraneRepresentation>) => {
        plugin.canvas3d!.add(repr as never);
        plugin.canvas3d!.requestCameraReset({ durationMs: 0 });
        await plugin.getImageRaw({ width: Size, height: Size });
      };
      const repr = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      const look = async (p: Partial<typeof base>, tints: MeshTints) => {
        repr.setMeshTints(tints);
        await repr.createOrUpdate({ ...base, ...p }, data).run();
        await plugin.getImageRaw({ width: Size, height: Size });
      };
      await look({}, [undefined, undefined]);
      await draw(repr);
      const plain = colors(repr);
      // each cut leaflet a near and a far surface, in its part's colour (`part`: by part, 0 the IM, 1 the LD)
      const surfaces = (part: (p: number) => number) => data.cut.flatMap((l) => [part(l.part!), part(l.part!)]);
      const leaflets = (p: number) => data.cut.filter((l) => l.part === p).length;
      expect(plain.surfaces.length).toBe(2 * data.cut.length);
      const objects = repr.renderObjects;
      const raster = () => (repr as unknown as { rasters: number }).rasters;

      // the IM's mesh red: its colours times red, the LD's as they were; nothing built again, the IM's two leaflets
      // rastered again only
      let rastered = raster();
      await look({}, [Red, undefined]);
      expect(repr.renderObjects).toBe(objects);
      expect(raster() - rastered).toBe(leaflets(0));
      const red = colors(repr);
      const t = tinted(plain.group, red.group, Red);
      expect(t.times).toBeGreaterThan(0);
      expect(t.same).toBeGreaterThan(0);
      expect(t.other).toBe(0);
      // the merged spheres read their members' colours again: the GPU's
      expect(red.synced).toBeGreaterThan(plain.synced);
      const color = base.color;
      expect(red.surfaces).toEqual(surfaces((p) => (p === 0 ? tint(color, Red) : color)));

      // and the LD's green: two parts coloured apart, the LD's one leaflet rastered again
      rastered = raster();
      await look({}, [Red, Green]);
      expect(repr.renderObjects).toBe(objects);
      expect(raster() - rastered).toBe(leaflets(1));
      const both = colors(repr);
      expect(tinted(red.group, both.group, Green).times).toBeGreaterThan(0);
      expect(tinted(red.group, both.group, Green).other).toBe(0);
      expect(both.surfaces).toEqual(surfaces((p) => tint(color, p === 0 ? Red : Green)));

      // the same look again (a mesh's opacity: its dependency's update): nothing drawn again
      const version = repr.geometryVersion;
      await look({}, [Red, Green]);
      expect(repr.geometryVersion).toBe(version);

      // the switch off: round 7's colours, as a build without tints makes them
      await look({ meshColors: false }, [Red, Green]);
      expect(repr.renderObjects).toBe(objects);
      expect(drawn(colors(repr))).toEqual(drawn(plain));
      // and round 7's part colour, its far colour (By zoom off: all of it), the meshes' left out
      await look({ meshColors: false, partColors: { LD: 0x0000ff } }, [Red, Green]);
      const own = colors(repr).surfaces;
      expect(own).toEqual(surfaces((p) => (p === 0 ? color : 0x0000ff)));
      // the switch on again: the meshes', the part colour left out
      await look({ meshColors: true, partColors: { LD: 0x0000ff } }, [Red, Green]);
      expect(drawn(colors(repr))).toEqual(drawn(both));
      // review S2, S4a (the coordinator's decision, for Ludo): a part's own colour where its mesh's tint is neutral (a
      // grey, a VTP's, a session saved before round 9 with its part colours), its mesh's where it is not
      await look({ meshColors: true, partColors: { LD: 0x0000ff } }, [undefined, undefined]);
      expect(colors(repr).surfaces).toEqual(surfaces((p) => (p === 0 ? color : 0x0000ff)));
      await look({ meshColors: true, partColors: { LD: 0x0000ff } }, [Red, undefined]);
      expect(colors(repr).surfaces).toEqual(surfaces((p) => (p === 0 ? tint(color, Red) : 0x0000ff)));

      // By zoom: far times the tint; atoms by element not tinted, carbons by species tinted
      const levels = {
        colorLevels: {
          name: 'on' as const,
          params: { entity: 0.27, chain: 2.2, atom: 28.8, band: 1, chainHue: 90 } as never,
        },
      };
      await look(levels, [undefined, undefined]);
      const zoom = colors(repr);
      expect(zoom.far.length).toBeGreaterThan(0);
      await look(levels, [Red, undefined]);
      const zoomRed = colors(repr);
      expect(tinted(zoom.far, zoomRed.far, Red).times).toBeGreaterThan(0);
      expect(tinted(zoom.far, zoomRed.far, Red).other).toBe(0);
      expect(zoomRed.near).toEqual(zoom.near);
      await look({ ...levels, atomColors: 'carbon-species' }, [undefined, undefined]);
      const carbons = colors(repr);
      await look({ ...levels, atomColors: 'carbon-species' }, [Red, undefined]);
      const carbonsRed = colors(repr);
      expect(tinted(carbons.near, carbonsRed.near, Red).times).toBeGreaterThan(0);
      expect(tinted(carbons.near, carbonsRed.near, Red).other).toBe(0);
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
      plugin.canvas3d!.remove(repr as never);
      repr.destroy();

      // a membrane with no mesh (a sphere): no tint, the switch nothing
      const sphere = await made({ center: Vec3.zero(), radius: 400 }, 'cutter');
      const lone = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      lone.setMeshTints([]);
      await lone.createOrUpdate({ ...base, meshColors: false }, sphere).run();
      await draw(lone);
      const off = colors(lone);
      await lone.createOrUpdate({ ...base, meshColors: true }, sphere).run();
      expect(drawn(colors(lone))).toEqual(drawn(off));
      plugin.canvas3d!.remove(lone as never);
      lone.destroy();

      // tiles on one mesh: all of it its mesh's tint, its far surface too
      const tiles = await made({ mesh: icosphere(300, 60) }, 'tiles');
      const tiled = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      tiled.setMeshTints([undefined]);
      await tiled.createOrUpdate({ ...base, method: 'tiles' }, tiles).run();
      await draw(tiled);
      const flat = colors(tiled);
      const before = tiled.renderObjects;
      tiled.setMeshTints([Red]);
      await tiled.createOrUpdate({ ...base, method: 'tiles' }, tiles).run();
      expect(tiled.renderObjects).toBe(before);
      const tiledRed = colors(tiled);
      const all = tinted(flat.group, tiledRed.group, Red);
      expect(all.same + all.other).toBe(0);
      expect(tiledRed.surfaces).toEqual(flat.surfaces.map((c) => tint(c as Color, Red)));
      plugin.canvas3d!.remove(tiled as never);
      tiled.destroy();
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      forgetLipidPatch('dawn-compartments');
      plugin.dispose();
    }
  });

  // review S1: one colour a member (colorBy uniform, or round 7's part colour without By zoom) was drawn uniform, and the
  // merged spheres of two parts kept the first one's: each part's colour by group, a recolour still in place
  it('two parts coloured apart, one colour each, keep their colours merged', { timeout: 180_000 }, async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    registerLipidPatch('dawn-apart', syntheticPatchPdb(12, 14).text);
    try {
      await plugin.init();
      const at = (m: TriMesh, x: number): TriMesh => ({
        positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v)),
        indices: m.indices,
      });
      const { mesh, parts } = concatMeshes([icosphere(400, 80), at(icosphere(300, 80), 900)], ['MITO_IM', 'LD']);
      const data = await runSteps(
        buildMembraneSteps({ mesh, parts }, 'dawn-apart', 0, 'both', Kinds, 'cutter'),
        SyncRuntimeContext,
      );
      if (typeof data === 'string') expect.fail(data);
      const base = { ...PD.getDefaultValues(LipidMembraneParams), method: 'cutter' as const, patch: 'dawn-apart' };
      const repr = LipidMembraneRepresentation(plugin.canvas3d!.graphics);
      const look = async (p: Partial<typeof base>, tints: MeshTints) => {
        repr.setMeshTints(tints);
        await repr.createOrUpdate({ ...base, ...p }, data as MembraneData).run();
        await plugin.getImageRaw({ width: Size, height: Size });
      };
      const spheres = () => repr.renderObjects.filter((o) => o.type === 'spheres');
      const granularity = () => new Set(spheres().map((o) => (o.values as Values).dColorType.ref.value));
      const drawnColors = () => new Set(colors(repr).group);
      const color = base.color;
      // the meshes' colours: colorBy uniform, two tints
      await look({ colorBy: 'uniform' }, [Red, Green]);
      plugin.canvas3d!.add(repr as never);
      await plugin.getImageRaw({ width: Size, height: Size });
      expect(granularity().has('uniform')).toBe(false);
      expect(drawnColors()).toEqual(new Set([tint(color, Red), tint(color, Green)]));
      const objects = repr.renderObjects;
      await look({ colorBy: 'uniform' }, [Green, Red]);
      expect(repr.renderObjects).toBe(objects);
      expect(drawnColors()).toEqual(new Set([tint(color, Green), tint(color, Red)]));
      // round 7's: the switch off, each part its own colour, By zoom off
      await look({ meshColors: false, partColors: { MITO_IM: 0xff0000, LD: 0x0000ff } }, [Green, Red]);
      expect(granularity().has('uniform')).toBe(false);
      expect(drawnColors()).toEqual(new Set([0xff0000, 0x0000ff]));
      expect(plugin.canvas3d!.graphics.takeErrors?.() ?? []).toEqual([]);
      plugin.canvas3d!.remove(repr as never);
      repr.destroy();
    } finally {
      forgetLipidPatch('dawn-apart');
      plugin.dispose();
    }
  });
});
