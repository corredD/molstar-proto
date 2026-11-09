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
import { MesoscaleExtension } from '../prism-viewer.js';

// The yeast cell viewer's organelle meshes (lipid-procedural round 6), on a synthetic two-mesh buffer in its format.

/** a buffer of meshes in the viewer's format: per mesh (membrane id, positions nm, indices) */
export function organelleBuffer(meshes: { membrane: number; positions: number[]; indices: number[] }[]) {
  let size = 4 + meshes.length * 12;
  for (const m of meshes) size += m.positions.length * 4 + m.indices.length * 4;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint32(0, meshes.length, true);
  let at = 4 + meshes.length * 12;
  meshes.forEach((m, i) => {
    view.setUint32(4 + i * 12, m.membrane, true);
    view.setUint32(8 + i * 12, m.positions.length / 3, true);
    view.setUint32(12 + i * 12, m.indices.length / 3, true);
    for (const p of m.positions) {
      view.setFloat32(at, p, true);
      at += 4;
    }
    for (const v of m.indices) {
      view.setUint32(at, v, true);
      at += 4;
    }
  });
  return new Uint8Array(view.buffer);
}

/** a tetrahedron of side about `s` nm at `c` (closed, outward) */
export function tetra(c: [number, number, number], s: number) {
  const [x, y, z] = c;
  return {
    positions: [x + s, y + s, z + s, x + s, y - s, z - s, x - s, y + s, z - s, x - s, y - s, z + s],
    indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2],
  };
}

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
});
