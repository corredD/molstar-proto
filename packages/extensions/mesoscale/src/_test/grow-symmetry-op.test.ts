/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { symmetryContact } from '../grow-symmetry.js';
import { DefaultGrowSettings, growParams } from '../operations.js';
import { ParticleListPainted, type PaintStroke } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// `mesoscale.grow` mode `symmetry` (progress/2026-11-13-symmetry.md) on paint's test list (particle 2, CA of 1CRN at
// (20, 0, 0)): one step a grow, |G| − 1 copies on a sphere of Radius, n live through `replace`.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
  await v.plugin.build().toRoot().apply(TestTargetList).commit();
  expectOk(await v.api.particles.representation({ type: 'target' }));
  return v;
}

const entry = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const strokes = (v: PrismViewer) =>
  (
    Array.from(v.plugin.state.data.cells.values()).find((c) => c.transform.transformer === ParticleListPainted)!
      .transform.params as { strokes: PaintStroke[] }
  ).strokes;
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);

/** The points' center: the mean of a whole orbit is the center of a point group */
function centerOf(ps: Vec3[]) {
  const c = Vec3();
  for (const p of ps) Vec3.add(c, c, p);
  return Vec3.scale(c, c, 1 / ps.length);
}

describe('mesoscale.grow symmetry', () => {
  it('I: 59 copies of 1CRN as one step, the source and they on a sphere of Radius; undo removes them', async () => {
    const v = await viewer();
    const before = { count: drawn(v).count, steps: steps(v) };
    const ref = entry(v).cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 2,
      mode: 'symmetry',
      group: 'i',
      symmetryRadius: 120,
    });
    expectOk(r);
    expect(r.value).toMatchObject({ count: 59, mode: 'symmetry' });
    expect(steps(v)).toBe(before.steps + 1);
    const list = drawn(v);
    expect(list.count).toBe(before.count + 59);
    const ps = [xyz(list, 2)];
    for (let i = before.count; i < list.count; ++i) ps.push(xyz(list, i));
    const c = centerOf(ps);
    for (const p of ps) expect(Vec3.distance(p, c)).toBeCloseTo(120, 3);
    expect(strokes(v)[0].grow).toMatchObject({
      mode: 'symmetry',
      params: { group: 'i', radius: 120, side: 'inside', axis: 'auto' },
    });

    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(before.count);
  });

  it('Radius unset: the copies touching, their nearest two a diameter apart', async () => {
    const v = await viewer();
    const before = drawn(v).count;
    const r = await v.api.run('mesoscale.grow', {
      particles: entry(v).cell.transform.ref,
      index: 2,
      mode: 'symmetry',
      group: 'c',
      n: 6,
    });
    expectOk(r);
    const radius = strokes(v)[0].grow!.params.radius as number;
    const list = drawn(v);
    const ps = [xyz(list, 2)];
    for (let i = before; i < list.count; ++i) ps.push(xyz(list, i));
    expect(ps.length).toBe(6);
    let min = Infinity;
    for (let i = 0; i < 6; ++i) for (let j = i + 1; j < 6; ++j) min = Math.min(min, Vec3.distance(ps[i], ps[j]));
    expect(min).toBeCloseTo(radius * symmetryContact('c', 6), 3);
    // C6's contact is its side: Radius
    expect(min).toBeCloseTo(radius, 3);
  });

  it('n live: the grow made again with another n in place, one step, its id kept', async () => {
    const v = await viewer();
    const before = drawn(v).count;
    const ref = entry(v).cell.transform.ref;
    const c6 = { particles: ref, index: 2, mode: 'symmetry', group: 'c', n: 6, symmetryRadius: 60 };
    const r = await v.api.run('mesoscale.grow', c6);
    expectOk(r);
    const id = (r.value as { id: number }).id;
    const s = steps(v);
    const again = await v.api.run('mesoscale.grow', { ...c6, n: 8, replace: id });
    expectOk(again);
    expect(again.value).toMatchObject({ count: 7, id });
    expect(steps(v)).toBe(s + 1);
    expect(drawn(v).count).toBe(before + 7);
    expect(strokes(v).length).toBe(1);
    // D8: 15
    expectOk(await v.api.run('mesoscale.grow', { ...c6, group: 'd', n: 8, replace: id }));
    expect(drawn(v).count).toBe(before + 15);
  });

  it('about a chosen axis (X): a ring in the plane across x through the source', async () => {
    const v = await viewer();
    const before = drawn(v).count;
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: entry(v).cell.transform.ref,
        index: 2,
        mode: 'symmetry',
        group: 'c',
        n: 5,
        symmetryRadius: 40,
        symmetryAxis: 'x',
      }),
    );
    const list = drawn(v);
    const x = xyz(list, 2)[0];
    for (let i = before; i < list.count; ++i) expect(xyz(list, i)[0]).toBeCloseTo(x, 3);
  });

  it('refuses a Radius of 0', async () => {
    const v = await viewer();
    const r = await v.api.run('mesoscale.grow', {
      particles: entry(v).cell.transform.ref,
      index: 2,
      mode: 'symmetry',
      symmetryRadius: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("growParams: Symmetry's own settings, its axis kept in space", () => {
    const src = { particles: 'p', index: 2 } as Parameters<typeof growParams>[0];
    expect(
      growParams(src, {
        ...DefaultGrowSettings,
        mode: 'symmetry',
        group: 'd',
        n: 7,
        symmetryAxis: 'x',
        side: 'outside',
      }),
    ).toMatchObject({ mode: 'symmetry', group: 'd', n: 7, symmetryAxis: 'x', side: 'outside' });
  });
});
