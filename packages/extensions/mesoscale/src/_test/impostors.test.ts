/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExtension } from '../prism-viewer.js';
import { TestParticleList, TestTargetList, setTestTargetStructure } from './fixtures.js';

// Far proteins as silhouettes or spheres (`mesoscale.impostors`; lod-impostor.md, apps/prism-me/_spec/ui.md §4 Graphics
// & Motion): a cellPACK-like list whose targets are 1CRN (data/examples), drawn as targets.

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

type Params = {
  type: {
    params: {
      structure: {
        lodImpostor?: boolean;
        lodImpostorBy?: string;
        lodImpostorPixels?: number;
        lodImpostorDistance?: number;
      };
    };
  };
};
const structures = (v: PrismViewer) =>
  v.plugin.managers.particles.hierarchy.current.lists[0].representations.map(
    (r) => (r.cell.transform.params as Params).type.params.structure,
  );
const impostors = (v: PrismViewer) =>
  v.plugin.managers.particles.hierarchy.current.lists[0].representations.map(
    (r) => (r.cell.transform.params as Params).type.params.structure.lodImpostor,
  );
const steps = (v: PrismViewer) => v.api.history.steps.value.length;

describe('far proteins as silhouettes or spheres (mesoscale.impostors)', () => {
  it('sets every structure target of the model, one step, one undo; the graphics state says so', async () => {
    const v = await viewer();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    // on by default (the representation's param)
    expect(impostors(v).every((x) => x !== false)).toBe(true);
    expect(v.api.mesoscale!.graphicsState(list).value?.impostors).toBe(true);
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.impostors', { on: false, particles: list }));
    expect(impostors(v)).toEqual(impostors(v).map(() => false));
    expect(steps(v)).toBe(before + 1);
    expect(v.api.mesoscale!.graphicsState(list).value?.impostors).toBe(false);
    expect(await v.api.run('mesoscale.impostors', { on: false, particles: list })).toMatchObject({
      ok: true,
      unchanged: true,
    });
    expectOk(await v.api.run('history.undo', {}));
    expect(impostors(v).every((x) => x !== false)).toBe(true);
    // every model where none is given
    expectOk(await v.api.run('mesoscale.impostors', { on: false }));
    expect(impostors(v).every((x) => x === false)).toBe(true);
  });

  it('says so where nothing is drawn by its structures (a spacefill)', async () => {
    const v = await viewer(TestParticleList, 'spacefill');
    expect(await v.api.run('mesoscale.impostors', { on: false })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('switches by size on screen or distance, its threshold, one step each; the graphics state says so', async () => {
    const v = await viewer();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expect(v.api.mesoscale!.graphicsState(list).value?.impostorSwitch).toMatchObject({
      by: 'size',
      pixels: 12,
      distance: 0,
    });
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.impostors', { particles: list, by: 'distance', distance: 5000 }));
    expect(steps(v)).toBe(before + 1);
    for (const s of structures(v)) {
      expect(s).toMatchObject({ lodImpostor: true, lodImpostorBy: 'distance', lodImpostorDistance: 5000 });
    }
    expect(v.api.mesoscale!.graphicsState(list).value?.impostorSwitch).toMatchObject({
      by: 'distance',
      pixels: 12,
      distance: 5000,
    });
    expectOk(await v.api.run('mesoscale.impostors', { particles: list, by: 'size', pixels: 24 }));
    for (const s of structures(v)) expect(s).toMatchObject({ lodImpostorBy: 'size', lodImpostorPixels: 24 });
    expectOk(await v.api.run('history.undo', {}));
    for (const s of structures(v)) expect(s).toMatchObject({ lodImpostorBy: 'distance', lodImpostorDistance: 5000 });
    // out of range
    expect(await v.api.run('mesoscale.impostors', { particles: list, pixels: 1000 })).toMatchObject({ ok: false });
  });
});
