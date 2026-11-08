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
import { type MesoGroup, mesoEntities, mesoGroups } from '../model.js';
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

  it('suits the tiles to the mesh by default: a long thin body keeps its shape (Ludo’s cow, 2026-11-08)', () => {
    // a 1,000 × 120 × 120 Å box: at the old fixed 200 Å edge it remeshed to a few chords inside the body
    const [X, Y] = [500, 60];
    const positions = new Float32Array([
      -X, -Y, -Y, X, -Y, -Y, X, Y, -Y, -X, Y, -Y, -X, -Y, Y, X, -Y, Y, X, Y, Y, -X, Y, Y,
    ]);
    const indices = new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]);
    const data = buildMembrane({ mesh: { positions, indices } }, 'test-patch', 0, 'outer', kinds);
    if (typeof data === 'string') expect.fail(data);
    expect(data.edge).toBeGreaterThanOrEqual(40);
    expect(data.edge).toBeLessThanOrEqual(60);
    // the outer leaflet's surface stays about the box's (8.6e4 Å² … ): area within 15 %
    const m = data.leaflets[0].mesh;
    let area = 0;
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [3 * m.indices[t], 3 * m.indices[t + 1], 3 * m.indices[t + 2]];
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    const box = 4 * (2 * X) * (2 * Y) + 2 * (2 * Y) * (2 * Y);
    expect(area / box).toBeGreaterThan(0.85);
  });

  it('says an unknown patch', () => {
    expect(buildMembrane({ radius: 400 }, 'nope', 80, 'both', kinds)).toMatch(/No lipid patch/);
  });

  it('fits a sphere to a compartment', () => {
    const fit = compartmentSphere(cellpackLike(), 'root')!;
    expect(fit.radius).toBeGreaterThan(0);
    expect(compartmentSphere(cellpackLike(), 'nowhere')).toBeUndefined();
  });

  it('fits a sphere to every compartment group the tree shows (its rows’ paths; review X1)', () => {
    const data = cellpackLike();
    const paths: string[] = [];
    const walk = (g: MesoGroup) => {
      if (g.path) paths.push(g.path);
      for (const c of g.groups) walk(c);
    };
    walk(mesoGroups(data, mesoEntities(data), 'compartment'));
    expect(paths.length).toBeGreaterThan(1);
    for (const path of paths) expect(compartmentSphere(data, path), path).toBeDefined();
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
