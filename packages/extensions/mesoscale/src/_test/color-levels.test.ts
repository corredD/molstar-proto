/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList, TestPetworldTargetList, TestTargetList, setTestTargetStructure } from './fixtures.js';

// Colors that follow the zoom (`mesoscale.colorLevels`, `mesoscale.theme` by zoom; color-levels.md, apps/prism-me/_spec/
// ui.md §4 Look): a cellPACK-like list whose four targets are 1CRN (data/examples), drawn as targets.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer(list = TestTargetList, type = 'target') {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
  await v.plugin.build().toRoot().apply(list).commit();
  expectOk(await v.api.particles.representation({ type }));
  return v;
}

type Params = { colorTheme: { name: string }; type: { params: { structure: { colorLevels: unknown } } } };
const reps = (v: PrismViewer) =>
  v.plugin.managers.particles.hierarchy.current.lists[0].representations.map((r) => r.cell.transform.params as Params);
const levels = (v: PrismViewer) => reps(v).map((p) => p.type.params.structure.colorLevels);
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const off = { name: 'off', params: {} };

describe('colors that follow the zoom (mesoscale.colorLevels)', () => {
  it('turns on with the defaults, one step, one undo; the graphics state says so', async () => {
    const v = await viewer();
    expect(levels(v)).toEqual([off]);
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.colorLevels', { on: true }));
    expect(levels(v)).toEqual([{ name: 'on', params: ColorLevels.defaults }]);
    expect(steps(v)).toBe(before + 1);
    const ref = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expect(v.api.mesoscale!.graphicsState(ref).value?.colorLevels).toEqual(ColorLevels.defaults);
    expect(await v.api.run('mesoscale.colorLevels', { on: true })).toMatchObject({ ok: true, unchanged: true });
    expectOk(await v.api.run('history.undo', {}));
    expect(levels(v)).toEqual([off]);
  });

  it('an edge given turns them on and keeps the others; edges out of order change nothing', async () => {
    const v = await viewer();
    expectOk(await v.api.run('mesoscale.colorLevels', { chain: 12 }));
    expect(levels(v)).toEqual([{ name: 'on', params: { ...ColorLevels.defaults, chain: 12 } }]);
    expectOk(await v.api.run('mesoscale.colorLevels', { atom: 40 }));
    expect(levels(v)).toEqual([{ name: 'on', params: { ...ColorLevels.defaults, chain: 12, atom: 40 } }]);
    const r = await v.api.run('mesoscale.colorLevels', { entity: 50 });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(levels(v)).toEqual([{ name: 'on', params: { ...ColorLevels.defaults, chain: 12, atom: 40 } }]);
    expectOk(await v.api.run('mesoscale.colorLevels', { on: false }));
    expect(levels(v)).toEqual([off]);
  });

  it('says so where nothing is drawn by its structures (a spacefill), or a list has no entities per particle', async () => {
    const v = await viewer(TestParticleList, 'spacefill');
    expect(await v.api.run('mesoscale.colorLevels', { on: true })).toMatchObject({ ok: false, code: 'not-found' });
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expect(await v.api.run('mesoscale.theme', { objects: [list], theme: 'zoom' })).toMatchObject({ ok: false });
  });

  it('the theme by zoom: Particle Hierarchy and the levels on, one step', async () => {
    const v = await viewer();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.theme', { objects: [list], theme: 'zoom' }));
    expect(reps(v).map((p) => p.colorTheme.name)).toEqual(['particle-hierarchy']);
    expect(levels(v)).toEqual([{ name: 'on', params: ColorLevels.defaults }]);
    expect(steps(v)).toBe(before + 1);
  });

  it('another theme after By zoom turns the levels off, in the same step (review S6)', async () => {
    const v = await viewer();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.theme', { objects: [list], theme: 'zoom' }));
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.theme', { objects: [list], theme: 'entity' }));
    expect(reps(v).map((p) => p.colorTheme.name)).toEqual(['particle-entity']);
    expect(levels(v)).toEqual([off]);
    expect(steps(v)).toBe(before + 1);
  });

  it('says that the colors set in Look paint over the levels (review S7)', async () => {
    const v = await viewer();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await v.api.mesoscale!.colors({ scheme: 'generate', particles: list } as never));
    const r = await v.api.run('mesoscale.colorLevels', { on: true });
    expectOk(r);
    expect(r.did).toMatch(/Look/);
  });

  it('by zoom on a model without compartments (PetWorld): its entities, then chains and atoms (PetWorld HIV, the first example)', async () => {
    const v = await viewer(TestPetworldTargetList);
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.theme', { objects: [list], theme: 'zoom' }));
    expect(reps(v).map((p) => p.colorTheme.name)).toEqual(['particle-entity']);
    expect(levels(v)).toEqual([{ name: 'on', params: ColorLevels.defaults }]);
  });
});
