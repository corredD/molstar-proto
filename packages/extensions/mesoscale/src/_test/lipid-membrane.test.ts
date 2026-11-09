/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  buildMembrane,
  cutBounds,
  LipidMembrane,
  membraneCounts,
  membraneLevels,
  registerLipidPatch,
  suitedVariants,
} from '../lipids/membrane.js';
import { type MesoGroup, mesoEntities, mesoGroups } from '../model.js';
import { compartmentSphere } from '../operations.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { cellpackLike } from './fixtures.js';
import { coveredFraction, placeCut, placeTiles, syntheticPatchPdb, thinLimbedBody } from './lipid-fixtures.js';

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}`);
}

const kinds = { edgeTypes: 1, vertexColors: 1, variants: 2, seed: 1 };
registerLipidPatch('test-patch', syntheticPatchPdb().text);

/** Every atom of a membrane on the CPU: its tiles and its cut lipids */
function membraneAtoms(data: Exclude<ReturnType<typeof buildMembrane>, string>) {
  const parts: Float32Array[] = [];
  for (const l of data.leaflets) {
    parts.push(placeTiles(data.kinds, data.edge, l.tileSet.variants, l.mesh, (t) => l.slots.variant[t]).atoms);
  }
  for (const l of data.cut) parts.push(placeCut(l.table, l.mesh, data.kinds.seed).atoms);
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('lipid membrane', () => {
  it('covers thin parts the remesh loses (Ludo’s second try, 2026-11-08: a cow’s legs showed the mesh)', () => {
    const body = thinLimbedBody();
    const data = buildMembrane({ mesh: body }, 'test-patch', 42, 'both', kinds);
    if (typeof data === 'string') expect.fail(data);
    // the legs (radius 15 Å under a 42 Å edge) are cut on their own triangles, the body tiled
    expect(data.cut.length).toBe(2);
    expect(coveredFraction(body, membraneAtoms(data))).toBeGreaterThan(0.97);
    // the cut lipids' bounds hold every lost triangle (the remesh's sphere left the legs out: review M1)
    for (const l of data.cut) {
      const b = cutBounds(l);
      const p = l.mesh.positions;
      for (const v of l.mesh.indices) {
        const d = Math.hypot(p[v * 3] - b.center[0], p[v * 3 + 1] - b.center[1], p[v * 3 + 2] - b.center[2]);
        expect(d).toBeLessThanOrEqual(b.radius);
      }
    }
  });

  it('draws at a sheet’s levels: strides 1, 8, 64, the coarser spheres keeping its area (review S7)', () => {
    for (const detail of ['quality', 'balanced', 'performance'] as const) {
      const { lodLevels, lodPixelSize } = membraneLevels(detail);
      expect(lodLevels.map((l) => l.stride)).toEqual([1, 8, 64]);
      // n / stride spheres of radius √stride cover the area of n (a volume's bias, ~3, thinned it into dots)
      expect(lodLevels.map((l) => l.scaleBias)).toEqual([1, 2, 2]);
      expect(lodPixelSize).toBeGreaterThan(0);
    }
  });

  it('takes custom levels from its properties in one step, without building again (Ludo, 2026-11-08)', async () => {
    // Ludo tunes the levels in the app to set their defaults: where each starts (Å from the camera), its stride, its bias
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 400, edge: 80, patch: 'test-patch' });
    expectOk(r);
    const ref = r.changed!.nodes![0];
    const data = v.plugin.state.data.cells.get(ref)!.obj!.data.sourceData;
    const levels = [
      { distance: 0, stride: 1, bias: 1 },
      { distance: 3000, stride: 16, bias: 2 },
      { distance: 9000, stride: 256, bias: 2.2 },
    ];
    expectOk(await v.api.run('mesoscale.membraneDetail', { membrane: ref, detail: 'custom', levels }));
    const cell = v.plugin.state.data.cells.get(ref)!;
    expect(cell.transform.params).toMatchObject({ detail: 'custom', levels });
    // the same membrane data: not cut, baked or remeshed again (as round 2's S5 for a detail)
    expect(cell.obj!.data.sourceData).toBe(data);
    // drawn by distance: each level from its start to the next's
    const { lodLevels, lodPixelSize } = membraneLevels('custom', levels);
    expect(lodPixelSize).toBe(0);
    expect(lodLevels.map((l) => [l.minDistance, l.maxDistance, l.stride, l.scaleBias])).toEqual([
      [0, 3000, 1, 1],
      [3000, 9000, 16, 2],
      [9000, 1e7, 256, 2.2],
    ]);
    // read back for the properties (the values Ludo sends us)
    expect(v.api.mesoscale!.membraneDetailState(ref).value).toEqual({ detail: 'custom', levels });
    expectOk(await v.api.history.undo({}));
    expect(v.plugin.state.data.cells.get(ref)!.transform.params).toMatchObject({ detail: 'balanced' });
  });

  it('says its stages while it wraps, and a cancel leaves the scene as it was (Ludo, 2026-11-08)', async () => {
    // "a progress bar so we know computation is happening and is not blocking": a task with readable stages, yielding
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const tasks = v.plugin.managers.task;
    const messages: string[] = [];
    const sub = tasks.events.progress.subscribe((e) => messages.push(e.progress.root.progress.message));
    // a patch not baked yet: its tiles baked in this wrap
    registerLipidPatch('progress-patch', syntheticPatchPdb().text);
    expectOk(await v.api.mesoscale!.wrapMembrane({ radius: 1500, edge: 60, patch: 'progress-patch' }));
    expect(messages.some((m) => /^Baking lipid tiles \(outer\) \d+\/\d+$/.test(m))).toBe(true);
    // cancelled while it bakes: no membrane, no step, nothing hidden
    registerLipidPatch('cancel-patch', syntheticPatchPdb().text);
    const cells = v.plugin.state.data.cells.size;
    const abort = tasks.events.progress.subscribe((e) => {
      if (e.progress.root.progress.message.startsWith('Baking')) tasks.requestAbort(e.progress);
    });
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 1500, edge: 60, patch: 'cancel-patch' });
    abort.unsubscribe();
    sub.unsubscribe();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/stopped/i);
    expect(v.plugin.state.data.cells.size).toBe(cells);
    // the history's last step is the first wrap's: undone, no membrane is left
    expectOk(await v.api.history.undo({}));
    expect([...v.plugin.state.data.cells.values()].some((c) => c.transform.transformer === LipidMembrane)).toBe(false);
  });

  it('cuts the mesh’s own triangles with the cutter: no remesh, every part covered', () => {
    const body = thinLimbedBody();
    const data = buildMembrane({ mesh: body }, 'test-patch', 0, 'both', kinds, 'cutter');
    if (typeof data === 'string') expect.fail(data);
    expect(data.leaflets.length).toBe(0);
    expect(data.cut.map((l) => l.name)).toEqual(['outer', 'inner']);
    expect(data.cut[0].mesh.indices).toBe(body.indices);
    expect(coveredFraction(body, membraneAtoms(data))).toBeGreaterThan(0.97);
  });

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
      -X,
      -Y,
      -Y,
      X,
      -Y,
      -Y,
      X,
      Y,
      -Y,
      -X,
      Y,
      -Y,
      -X,
      -Y,
      Y,
      X,
      -Y,
      Y,
      X,
      Y,
      Y,
      -X,
      Y,
      Y,
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

  it('bakes more interior variants for small tiles, fewer for large (a bake of about the same work)', () => {
    // Ludo's first try: two variants read as a repeated lattice; the bake costs variants × edge²
    expect(suitedVariants(42)).toBe(8);
    expect(suitedVariants(60)).toBe(8);
    expect(suitedVariants(100)).toBe(3);
    expect(suitedVariants(200)).toBe(2);
  });

  it('says a mesh too small for lipids: scale it first (a cow in cm is 12 Å long)', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    expect(buildMembrane({ mesh: { positions, indices } }, 'test-patch', 0, 'both', kinds)).toMatch(/scale it/);
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

  it('fetches a patch by its URL on the first wrap only (the app ships CHARMM-GUI’s as a static file)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const text = syntheticPatchPdb().text;
    const fetch = vi.fn(async () => new Response(text));
    vi.stubGlobal('fetch', fetch);
    const wrap = () =>
      v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'url-patch', patchUrl: 'patch.dat' });
    expectOk(await wrap());
    expectOk(await wrap());
    expect(fetch).toHaveBeenCalledTimes(1);
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
