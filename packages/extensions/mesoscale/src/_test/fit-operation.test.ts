/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { sceneVolumes } from '../fit.js';
import { pluginCursorFit } from '../paint-host.js';
import { DefaultGrowSettings, growParams } from '../operations.js';
import { DefaultPaintSettings } from '../paint-mode.js';
import { paintRotation } from '../paint.js';
import { ParticleListPainted, type PaintStroke } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { angleBetween, crnAtoms, density, type Site, turn } from './density.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// Paint and Grow fitted to a volume (density-fit) on the cellPACK-like list of paint's tests (four 1CRN targets, drawn
// as targets; particle 2 is CA at (20, 0, 0)) and an MRC of 1CRN densities, Dark, with noise, made in memory.

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

const atoms = crnAtoms();

/** An MRC of 1CRN at the sites (Dark, noise 0.1 of its peak), its corner at the origin, a voxel 1.5 Å */
async function loadMap(v: PrismViewer, sites: readonly Site[], size: [number, number, number]) {
  const { grid, data } = density(atoms, sites, {
    origin: Vec3(),
    size,
    voxel: 1.5,
    blur: 1.5,
    noise: 0.1,
    seed: 3,
  });
  expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
  const volumes = sceneVolumes(v.plugin.state.data);
  expect(volumes.length).toBe(1);
  return volumes[0].ref;
}

const entry = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const strokes = (v: PrismViewer) => {
  const cell = Array.from(v.plugin.state.data.cells.values()).find(
    (c) => c.transform.transformer === ParticleListPainted,
  );
  return ((cell?.transform.params as { strokes: PaintStroke[] } | undefined)?.strokes ?? []) as PaintStroke[];
};
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const quat = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);

describe('mesoscale.paint with fit', () => {
  it('fits the copy onto the density near the click, one step; a session keeps it without the volume', async () => {
    const v = await viewer();
    const at = [60, 40, 40];
    // the copy as painted there without a fit: its turn (of its seed)
    const paint = { entity: 'CA', positions: at, seed: 5, orient: 'random' as const };
    expectOk(await v.api.run('mesoscale.paint', paint));
    const n = drawn(v).count - 1;
    const painted = quat(drawn(v), n);
    expectOk(await v.api.run('history.undo', {}));
    // its site 3 Å and 6° off
    const site = {
      position: Vec3.create(62, 41.5, 39),
      rotation: Quat.multiply(Quat(), turn(Vec3.create(0, 1, 1), 6), painted),
    };
    const volume = await loadMap(v, [site], [80, 60, 60]);
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.paint', { ...paint, fit: volume }));
    expect(steps(v)).toBe(before + 1);
    const copy = xyz(drawn(v), n);
    expect(Vec3.distance(copy, site.position)).toBeLessThan(1);
    expect(angleBetween(quat(drawn(v), n), site.rotation)).toBeLessThan(3);
    const s = strokes(v).at(-1)!;
    expect(s.fit?.volume).toBe('tomo.mrc');
    expect(s.fit?.score[0]).toBeGreaterThan(1);
    expect(s.fit?.shift[0]).toBeCloseTo(Vec3.distance(copy, Vec3.create(60, 40, 40)), 3);
    expect(s.fit?.angle[0]).toBeGreaterThan(0);
    // a session without the volume: the copy where it was fitted
    await v.plugin.build().delete(volume).commit();
    expect(sceneVolumes(v.plugin.state.data).length).toBe(0);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(entry(v).cell.transform.ref).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(Vec3.distance(xyz(drawn(v), n), copy)).toBeLessThan(1e-4);
  });

  it('is one undo step, and refuses a volume not in the scene', async () => {
    const v = await viewer();
    const volume = await loadMap(v, [{ position: Vec3.create(60, 40, 40), rotation: Quat.identity() }], [80, 60, 60]);
    const count = drawn(v).count;
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [61, 40, 40], seed: 1, fit: volume }));
    expect(drawn(v).count).toBe(count + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(count);
    const r = await v.api.run('mesoscale.paint', { entity: 'CA', positions: [61, 40, 40], fit: 'nothing' });
    expect(r.ok).toBe(false);
  });
});

describe('the copy under the pointer, fitted', () => {
  it('is where the click paints it', async () => {
    const v = await viewer();
    const volume = await loadMap(
      v,
      [{ position: Vec3.create(60, 40, 40), rotation: turn(Vec3.create(1, 0, 0), 30) }],
      [80, 60, 60],
    );
    const data = drawn(v);
    const fit = pluginCursorFit(v.plugin, () => data.targetMapping?.get(data.targets[2]), 10);
    // as the cursor turns the copy (Turn Random, the stroke's seed): its first copy's turn
    const rotation = paintRotation(Quat(), Vec3.create(0, 0, 1), 'random', 7, 0, {});
    const shown = fit.fit(Vec3.create(62, 41, 40), rotation, volume, DefaultPaintSettings.contrast)!;
    expect(shown.shift).toBeGreaterThan(0.5);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: 'CA',
        positions: [62, 41, 40],
        normals: [0, 0, 1],
        orient: 'random',
        seed: 7,
        fit: volume,
      }),
    );
    const n = drawn(v).count - 1;
    expect(Vec3.distance(xyz(drawn(v), n), shown.position)).toBeLessThan(1e-3);
    expect(angleBetween(quat(drawn(v), n), shown.rotation)).toBeLessThan(1e-2);
    fit.dispose();
  });
});

describe('mesoscale.grow with fit', () => {
  it('keeps only the tiles on a site of the density, half of them empty; Count counts kept copies', async () => {
    const v = await viewer();
    const list = entry(v).cell.transform.ref;
    // the source: a copy painted at the first site, its turn the sites'
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [40, 40, 45], seed: 2, orient: 'random' }));
    const index = drawn(v).count - 1;
    const rotation = quat(drawn(v), index);
    const spacing = 32;
    // a square tiling in the source's plane: its principal axis's normal plane; every other site filled
    const tiles = await v.api.run('mesoscale.grow', {
      particles: list,
      index,
      mode: 'tiling',
      pattern: 'square',
      spacing,
      rings: 1,
      seed: 1,
    });
    expectOk(tiles);
    const grown = drawn(v);
    const sites: Site[] = [{ position: xyz(grown, index), rotation }];
    const empty: Vec3[] = [];
    for (let i = index + 1; i < grown.count; ++i) {
      const k = i - index;
      if (k % 2 === 0) sites.push({ position: xyz(grown, i), rotation: quat(grown, i) });
      else empty.push(xyz(grown, i));
    }
    expectOk(await v.api.run('history.undo', {}));
    const volume = await loadMap(v, sites, [80, 80, 80]);
    const before = steps(v);
    const r = await v.api.run('mesoscale.grow', {
      particles: list,
      index,
      mode: 'tiling',
      pattern: 'square',
      spacing,
      rings: 1,
      seed: 1,
      fit: volume,
    });
    expectOk(r);
    expect(steps(v)).toBe(before + 1);
    const after = drawn(v);
    expect(after.count - 1 - index).toBe(sites.length - 1);
    for (let i = index + 1; i < after.count; ++i) {
      const p = xyz(after, i);
      expect(Math.min(...sites.map((s) => Vec3.distance(p, s.position)))).toBeLessThan(1.5);
      for (const e of empty) expect(Vec3.distance(p, e)).toBeGreaterThan(spacing / 2);
    }
    const s = strokes(v).at(-1)!;
    expect(s.fit?.score.length).toBe(sites.length - 1);
    expect(s.grow?.params.threshold).toBe(0.6);
    // a threshold above every copy's: none kept, refused
    const none = await v.api.run('mesoscale.grow', {
      particles: list,
      index,
      mode: 'tiling',
      pattern: 'square',
      spacing,
      rings: 1,
      fit: volume,
      threshold: 50,
    });
    expect(none.ok).toBe(false);
  });

  it("carries the section's Fit to, Contrast and Threshold to the grow (none without), made again in place", async () => {
    const src = { particles: 'list', index: 3 };
    const plain = growParams(src, { ...DefaultGrowSettings, mode: 'tiling' });
    expect(plain.fit).toBeUndefined();
    expect(plain.threshold).toBeUndefined();
    const fitted = growParams(src, {
      ...DefaultGrowSettings,
      mode: 'tiling',
      fit: 'v',
      contrast: 'bright',
      threshold: 0.4,
    });
    expect([fitted.fit, fitted.contrast, fitted.threshold]).toEqual(['v', 'bright', 0.4]);
    // the last grow made again with another Threshold: one stroke, in place
    const v = await viewer();
    const list = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [60, 60, 60], seed: 2, orient: 'random' }));
    const index = drawn(v).count - 1;
    const volume = await loadMap(
      v,
      [{ position: xyz(drawn(v), index), rotation: quat(drawn(v), index) }],
      [80, 80, 80],
    );
    const params = { particles: list, index, mode: 'sphere', count: 4, radius: 40, seed: 4, fit: volume, threshold: 0 };
    const r = await v.api.run('mesoscale.grow', params);
    expectOk(r);
    const id = (r.value as { id: number }).id;
    expectOk(await v.api.run('mesoscale.grow', { ...params, count: 2, replace: id }));
    expect(strokes(v).length).toBe(2);
    expect(strokes(v)[1].positions.length).toBe(6);
    expect(strokes(v)[1].grow?.params.fit).toBe(volume);
  });

  it('Sphere: Count counts kept copies, prefix-stable', async () => {
    const v = await viewer();
    const list = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [60, 60, 60], seed: 2, orient: 'random' }));
    const index = drawn(v).count - 1;
    // the source on a site; copies at random about it kept at a score of 0 or more (about half of them on noise)
    const volume = await loadMap(
      v,
      [{ position: xyz(drawn(v), index), rotation: quat(drawn(v), index) }],
      [80, 80, 80],
    );
    const grow = (count: number) =>
      v.api.run('mesoscale.grow', {
        particles: list,
        index,
        mode: 'sphere',
        count,
        radius: 45,
        turn: 'source',
        seed: 4,
        fit: volume,
        threshold: 0,
      });
    expectOk(await grow(3));
    const three = Array.from(drawn(v).coordinates.slice((index + 1) * 3));
    expect(three.length).toBe(9);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await grow(6));
    const six = Array.from(drawn(v).coordinates.slice((index + 1) * 3));
    expect(six.length).toBe(18);
    expect(six.slice(0, 9)).toEqual(three);
  });
});
