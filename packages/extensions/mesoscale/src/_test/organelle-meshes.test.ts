/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterAll, describe, expect, it } from 'vitest';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { forgetLipidPatch, LipidMembrane, registerLipidPatch } from '../lipids/membrane.js';
import { OrganelleMeshesProvider, parseOrganelleMeshes } from '../organelle-meshes.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';
import { organelleBuffer, tetra } from './organelle-fixtures.js';
import { MesoscaleExtension } from '../prism-viewer.js';

// The yeast cell viewer's organelle meshes (lipid-procedural round 6), on a synthetic two-mesh buffer in its format.

const two = () =>
  organelleBuffer([
    { membrane: 0, ...tetra([0, 0, 0], 100) },
    { membrane: 3, ...tetra([10, 0, 0], 20) },
  ]);

describe('organelle meshes (the yeast cell viewer’s organelle_meshes.bin)', () => {
  const viewers: PrismViewer[] = [];
  registerLipidPatch('organelle-patch', syntheticPatchPdb().text);
  afterAll(async () => {
    forgetLipidPatch('organelle-patch');
    for (const v of viewers.splice(0)) await v.dispose();
  });

  it('reads each mesh, named by its membrane, in Å', () => {
    const meshes = parseOrganelleMeshes(two());
    if (typeof meshes === 'string') expect.fail(meshes);
    expect(meshes.map((m) => m.name)).toEqual(['PM', 'VAC']);
    expect(meshes[0].positions[0]).toBeCloseTo(1000);
    expect(meshes[1].positions[0]).toBeCloseTo(300);
    expect(Array.from(meshes[1].indices)).toEqual(tetra([0, 0, 0], 1).indices);
  });

  it('says what is wrong with bytes that are not its format', () => {
    const bytes = two();
    expect(parseOrganelleMeshes(bytes.subarray(0, bytes.length - 4))).toMatch(/past the end/);
    expect(parseOrganelleMeshes(new Uint8Array(8))).toMatch(/bad header/);
    const bad = organelleBuffer([{ membrane: 0, positions: [0, 0, 0], indices: [0, 0, 1] }]);
    expect(parseOrganelleMeshes(bad)).toMatch(/past its 1/);
    expect(OrganelleMeshesProvider.isApplicable!({ ext: 'bin' } as never, bytes.subarray(0, bytes.length - 4))).toBe(
      false,
    );
    expect(OrganelleMeshesProvider.isApplicable!({ ext: 'bin' } as never, bytes)).toBe(true);
  });

  it('opens as a mesh a membrane, each named, ready to wrap', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const plugin = v.plugin;
    const data = await plugin.builders.data.rawData({ data: two(), label: 'organelle_meshes.bin' });
    const parsed = await OrganelleMeshesProvider.parse(plugin, data);
    await OrganelleMeshesProvider.visuals!(plugin, parsed);
    const shapes = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Provider));
    expect(shapes.map((c) => c.obj!.label)).toEqual(['PM', 'VAC']);
    expect(plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Representation3D)).length).toBe(2);
  });

  it('wraps all its meshes as one membrane in one step: a part a mesh, the inner one enclosed (round 6)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const plugin = v.plugin;
    const data = await plugin.builders.data.rawData({ data: two(), label: 'organelle_meshes.bin' });
    const parsed = await OrganelleMeshesProvider.parse(plugin, data);
    await OrganelleMeshesProvider.visuals!(plugin, parsed);
    const refs = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Provider)).map((c) => c.transform.ref);
    const steps = v.api.history.steps.value.length;
    const r = await v.api.mesoscale!.wrapMembrane({ meshes: refs.join(','), patch: 'organelle-patch' });
    if (!r.ok) expect.fail(r.error.message);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    const membranes = plugin.state.data.selectQ((q) => q.ofTransformer(LipidMembrane));
    expect(membranes.length).toBe(1);
    const source = (membranes[0].obj!.data as { sourceData: { parts?: { name: string }[]; enclosedBy?: Int32Array[] } })
      .sourceData;
    expect(source.parts!.map((p) => p.name)).toEqual(['PM', 'VAC']);
    // the VAC inside the PM, the PM inside nothing
    expect(source.enclosedBy!.map((e) => Array.from(e))).toEqual([[], [0]]);
    // the meshes hidden under it, as one mesh's
    for (const ref of refs) expect(plugin.state.data.cells.get(ref)!.state.isHidden).toBe(true);
  });

  it('shows, hides and colours each part with a particle list’s operations: one step each, the cut kept (round 7)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const plugin = v.plugin;
    const data = await plugin.builders.data.rawData({ data: two(), label: 'organelle_meshes.bin' });
    await OrganelleMeshesProvider.visuals!(plugin, await OrganelleMeshesProvider.parse(plugin, data));
    const refs = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Provider)).map((c) => c.transform.ref);
    const r = await v.api.mesoscale!.wrapMembrane({ meshes: refs.join(','), patch: 'organelle-patch' });
    if (!r.ok) expect.fail(r.error.message);
    const membrane = r.changed!.nodes![0];
    const cell = () => plugin.state.data.cells.get(membrane)!;
    const params = () => cell().transform.params as { hiddenParts: string[]; partColors: Record<string, number> };
    const source = (cell().obj!.data as { sourceData: unknown }).sourceData;
    const steps = () => v.api.history.steps.value.length;
    const run = async (id: string, p: Record<string, unknown>) => {
      const before = steps();
      const out = await v.api.run(id, { particles: membrane, ...p });
      expect(out.ok, `${id} ${out.message}`).toBe(true);
      expect(steps(), id).toBe(before + 1);
    };
    await run('mesoscale.style', { parts: 'VAC', visible: false });
    expect(params().hiddenParts).toEqual(['VAC']);
    await run('mesoscale.style', { parts: 'PM', color: 'tomato' });
    expect(params().partColors).toEqual({ PM: 0xff6347 });
    await run('mesoscale.colors', { parts: '', scheme: 'generate' });
    expect(Object.keys(params().partColors).sort()).toEqual(['PM', 'VAC']);
    await run('mesoscale.colors', { parts: 'PM,VAC', scheme: 'theme' });
    expect(params().partColors).toEqual({});
    // drawn again, never cut again: the same data
    expect((cell().obj!.data as { sourceData: unknown }).sourceData).toBe(source);
    // one undo, one step back: the colours generated again
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(Object.keys(params().partColors).sort()).toEqual(['PM', 'VAC']);
    // an unknown part is named; a list's options refused
    const unknown = await v.api.run('mesoscale.style', { particles: membrane, parts: 'NOPE', visible: false });
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain('NOPE');
    const glow = await v.api.run('mesoscale.style', { particles: membrane, parts: 'PM', emissive: 0.5 });
    expect(glow.ok).toBe(false);
  });

  it('follows its meshes’ colours through the state: a recolour, no new cut, an opacity nothing (round 9)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const plugin = v.plugin;
    const data = await plugin.builders.data.rawData({ data: two(), label: 'organelle_meshes.bin' });
    await OrganelleMeshesProvider.visuals!(plugin, await OrganelleMeshesProvider.parse(plugin, data));
    const refs = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Provider)).map((c) => c.transform.ref);
    const reps = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Representation3D)).map((c) => c.transform.ref);
    // the colour a part takes is its mesh's representation's (`cryoet.mesh` writes it there)
    for (const ref of reps) {
      expect(
        (plugin.state.data.cells.get(ref)!.transform.params as { coloring?: { name: string } }).coloring?.name,
      ).toBe('uniform');
    }
    const r = await v.api.mesoscale!.wrapMembrane({ meshes: refs.join(','), patch: 'organelle-patch' });
    if (!r.ok) expect.fail(r.error.message);
    const membrane = r.changed!.nodes![0];
    const cell = () => plugin.state.data.cells.get(membrane)!;
    const repr = () => (cell().obj!.data as { repr: { meshTints: readonly (number | undefined)[] } }).repr;
    const source = (cell().obj!.data as { sourceData: unknown }).sourceData;
    // the meshes' default grey (0x808080) is white normalised: no tint
    expect(repr().meshTints).toEqual([undefined, undefined]);
    const recolor = async (ref: string, color: number) => {
      const b = plugin.state.data.build();
      b.to(ref).update((p: any) => ({ ...p, coloring: { name: 'uniform', params: { color } } }));
      await b.commit();
    };
    // the VAC's mesh a dark red: normalised, a pure red
    await recolor(reps[1], 0x800000);
    expect(repr().meshTints).toEqual([undefined, 0xff0000]);
    expect((cell().obj!.data as { sourceData: unknown }).sourceData).toBe(source);
    // its opacity: no tint changed, nothing drawn again
    const objects = (cell().obj!.data as { repr: { renderObjects: unknown } }).repr.renderObjects;
    const b = plugin.state.data.build();
    b.to(reps[0]).update((p: any) => ({ ...p, alpha: 0.5 }));
    await b.commit();
    expect((cell().obj!.data as { repr: { renderObjects: unknown } }).repr.renderObjects).toBe(objects);
    // black and a mesh's own colours are no tint
    await recolor(reps[0], 0x000000);
    expect(repr().meshTints).toEqual([undefined, 0xff0000]);
    await recolor(reps[0], 0x336699);
    expect(repr().meshTints).toEqual([0x55aaff, 0xff0000]);
    // back to grey: no tint (the step and its undo through `cryoet.mesh`: the app's explorer tests)
    await recolor(reps[0], 0x808080);
    expect(repr().meshTints).toEqual([undefined, 0xff0000]);
    expect((cell().obj!.data as { sourceData: unknown }).sourceData).toBe(source);
  });

  it('leaves the parts as they were on a Reset of its species and on a category’s theme (Ludo, 2026-11-09; S5)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const plugin = v.plugin;
    const data = await plugin.builders.data.rawData({ data: two(), label: 'organelle_meshes.bin' });
    await OrganelleMeshesProvider.visuals!(plugin, await OrganelleMeshesProvider.parse(plugin, data));
    const refs = plugin.state.data.selectQ((q) => q.ofType(SO.Shape.Provider)).map((c) => c.transform.ref);
    const r = await v.api.mesoscale!.wrapMembrane({ meshes: refs.join(','), patch: 'organelle-patch' });
    if (!r.ok) expect.fail(r.error.message);
    const membrane = r.changed!.nodes![0];
    const params = () =>
      plugin.state.data.cells.get(membrane)!.transform.params as {
        hiddenParts: string[];
        partColors: Record<string, number>;
      };
    const ok = async (id: string, p: Record<string, unknown>) => {
      const out = await v.api.run(id, p);
      expect(out.ok, `${id} ${JSON.stringify(p)} ${out.message}`).toBe(true);
    };
    await ok('mesoscale.style', { particles: membrane, parts: 'VAC', visible: false });
    await ok('mesoscale.style', { particles: membrane, parts: 'PM', color: 'tomato' });
    const parts = () => ({ hiddenParts: params().hiddenParts, partColors: params().partColors });
    const want = { hiddenParts: ['VAC'], partColors: { PM: 0xff6347 } };
    expect(parts()).toEqual(want);
    // the species' Reset (a list's Reset: no parts given)
    await ok('mesoscale.style', { particles: membrane, color: 'gold' });
    await ok('mesoscale.style', { particles: membrane, reset: true });
    expect(parts()).toEqual(want);
    // a category's brush, every theme a membrane takes
    for (const theme of ['uniform', 'generate', 'entity', 'object', 'zoom']) {
      await ok('mesoscale.theme', { objects: [membrane], theme, color: 'teal' });
      expect(parts(), theme).toEqual(want);
    }
  });
});
