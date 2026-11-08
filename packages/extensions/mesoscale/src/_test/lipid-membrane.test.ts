/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { buildMembrane, LipidMembrane, membraneCounts, registerLipidPatch } from '../lipids/membrane.js';
import { compartmentSphere } from '../operations.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { cellpackLike } from './fixtures.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}`);
}

const kinds = { edgeTypes: 1, vertexColors: 1, variants: 2, seed: 1 };
registerLipidPatch('test-patch', syntheticPatchPdb().text);

describe('lipid membrane', () => {
  it('builds both leaflets of a sphere, the outer leaflet larger, every triangle a tile', () => {
    const data = buildMembrane({ radius: 400 }, 'test-patch', 80, 'both', kinds);
    if (typeof data === 'string') expect.fail(data);
    const [outer, inner] = data.leaflets;
    expect(outer.tileSet.offset).toBeGreaterThan(0);
    expect(inner.tileSet.offset).toBeLessThan(0);
    const r = (m: Float32Array) => Math.hypot(m[0], m[1], m[2]);
    expect(r(outer.mesh.positions)).toBeGreaterThan(r(inner.mesh.positions));
    for (const l of data.leaflets) {
      expect(l.slots.order.length).toBe(l.mesh.indices.length / 3);
      expect(l.slots.counts.reduce((a, b) => a + b, 0)).toBe(l.mesh.indices.length / 3);
    }
    const { tiles, lipids } = membraneCounts(data);
    expect(tiles).toBe(outer.slots.order.length + inner.slots.order.length);
    // about the sphere's two leaflets' area at the patch's density
    const area = 4 * Math.PI * 400 * 400;
    expect(lipids / ((2 * area) / outer.tileSet.areaPerLipid)).toBeGreaterThan(0.85);
    expect(lipids / ((2 * area) / outer.tileSet.areaPerLipid)).toBeLessThan(1.15);
  });

  it('says an unknown patch', () => {
    expect(buildMembrane({ radius: 400 }, 'nope', 80, 'both', kinds)).toMatch(/No lipid patch/);
  });

  it('fits a sphere to a compartment', () => {
    const fit = compartmentSphere(cellpackLike(), 'root')!;
    expect(fit.radius).toBeGreaterThan(0);
    expect(compartmentSphere(cellpackLike(), 'nowhere')).toBeUndefined();
  });

  it('wraps a sphere in one step, not drawn without WebGPU (said), undone in one step', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 400, edge: 80, patch: 'test-patch' });
    expectOk(r);
    expect(r.did).toMatch(/not drawn: WebGPU only/);
    const cells = [...v.plugin.state.data.cells.values()].filter((c) => c.transform.transformer === LipidMembrane);
    expect(cells.length).toBe(1);
    expect(SO.Shape.Representation3D.is(cells[0].obj)).toBe(true);
    expect(cells[0].obj!.data.repr.renderObjects.length).toBe(0);
    expectOk(await v.api.history.undo({}));
    expect([...v.plugin.state.data.cells.values()].some((c) => c.transform.transformer === LipidMembrane)).toBe(false);
  });

  it('fails, adding nothing, when its transform fails (an unknown patch, a ref that is not a mesh)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const membranes = () =>
      [...v.plugin.state.data.cells.values()].filter((c) => c.transform.transformer === LipidMembrane).length;
    const unknown = await v.api.mesoscale!.wrapMembrane({ radius: 400, edge: 80, patch: 'no-such-patch' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/No lipid patch named no-such-patch/);
    expect(membranes()).toBe(0);
    const root = v.plugin.state.data.tree.root.ref;
    const notMesh = await v.api.mesoscale!.wrapMembrane({ mesh: root, edge: 80, patch: 'test-patch' });
    expect(notMesh.ok).toBe(false);
    expect(membranes()).toBe(0);
  });
});
