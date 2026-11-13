/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import {
  ParticleListOffsets,
  ParticleListTargetsFromAttribute,
  ParticleListTransform,
} from '@molstar/plugin/state/transforms/particles/ops';
import { ParticleListPainted, type PaintStroke } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// `mesoscale.grow` (progress/2026-11-11-grow.md, Tests: the operation) on the cellPACK-like list of paint's tests (four
// 1CRN targets, drawn as targets; particle 2 is CA at (20, 0, 0), its compartment a surface): one step a grow, the
// copies the source's list's painted copies, of its target, entity and compartment.

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
const painted = (v: PrismViewer) =>
  Array.from(v.plugin.state.data.cells.values()).filter((c) => c.transform.transformer === ParticleListPainted);
const strokes = (v: PrismViewer) => (painted(v)[0].transform.params as { strokes: PaintStroke[] }).strokes;
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const quat = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);

describe('mesoscale.grow', () => {
  it("grows a crystal as one step: the source's target, entity and compartment; undo removes it, redo brings it back", async () => {
    const v = await viewer();
    const before = { count: drawn(v).count, steps: steps(v) };
    const ref = entry(v).cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 2,
      mode: 'crystal',
      a: 30,
      b: 30,
      c: 30,
      na: 3,
      nb: 1,
      nc: 1,
    });
    expectOk(r);
    expect(r.value).toMatchObject({ count: 2, mode: 'crystal' });
    expect(steps(v)).toBe(before.steps + 1);
    const list = drawn(v);
    expect(list.count).toBe(before.count + 2);
    expect(Array.from(list.targets.slice(7))).toEqual([1, 1]);
    expect(Array.from(list.entities!.slice(7))).toEqual([1, 1]);
    expect(Array.from(list.compartments!.slice(7))).toEqual([1, 1]);
    expect(Array.from(xyz(list, 7)).map((x) => +x.toFixed(3))).toEqual([-10, 0, 0]);
    expect(Array.from(xyz(list, 8)).map((x) => +x.toFixed(3))).toEqual([50, 0, 0]);
    expect(strokes(v)[0].grow).toMatchObject({ mode: 'crystal', source: { index: 2, key: 2 } });

    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(before.count);
    expectOk(await v.api.run('history.redo', {}));
    expect(drawn(v).count).toBe(before.count + 2);
  });

  it('puts the copies by the source as drawn in a list moved, scaled and offset: a lattice of a in Å, the source a point of it', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0)), Mat4.rotY90);
    await v.plugin.build().to(ref).insert(ParticleListTransform, { transform: m, scale: 2 }).commit();
    const move = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => c.transform.transformer === ParticleListTransform,
    )!;
    // all of CA's kind 5 Å along their own z, after the move (Offset all like it)
    await v.plugin
      .build()
      .to(move.transform.ref)
      .insert(ParticleListOffsets, {
        offsets: [{ targets: [1], translation: Vec3.create(0, 0, 5), euler: Vec3() }],
        instances: [],
      })
      .commit();
    const src = xyz(drawn(v), 2);
    const turn = quat(drawn(v), 2);
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'crystal',
        a: 30,
        b: 30,
        c: 30,
        na: 3,
        nb: 1,
        nc: 1,
      }),
    );
    const list = drawn(v);
    expect(list.count).toBe(9);
    // the drawn copies at the drawn source ∓ a along its own x (Å, not list units), turned as it
    const ax = Vec3.transformQuat(Vec3(), Vec3.create(30, 0, 0), turn);
    expect(Vec3.distance(xyz(list, 7), Vec3.sub(Vec3(), src, ax))).toBeLessThan(1e-3);
    expect(Vec3.distance(xyz(list, 8), Vec3.add(Vec3(), src, ax))).toBeLessThan(1e-3);
    expect(Quat.dot(quat(list, 7), turn)).toBeCloseTo(1, 5);
    // a source not at the origin: the move's turn and scale both count
    expect(Vec3.distance(xyz(list, 7), xyz(list, 8))).toBeCloseTo(60, 3);
  });

  it('tiles, fills a sphere (seeded) and walks a fiber of Steps points from the source', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'tiling',
        pattern: 'hex',
        spacing: 20,
        rings: 2,
      }),
    );
    expect(drawn(v).count).toBe(7 + 18);
    expectOk(await v.api.run('history.undo', {}));

    const sphere = { particles: ref, index: 6, mode: 'sphere', count: 12, radius: 40, seed: 4 };
    expectOk(await v.api.run('mesoscale.grow', sphere));
    const a = Array.from(drawn(v).coordinates.slice(21));
    expect(a.length).toBe(36);
    for (let i = 7; i < 19; ++i) expect(Vec3.distance(xyz(drawn(v), i), Vec3.create(60, 0, 0))).toBeLessThan(40.001);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.grow', sphere));
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(a);
    expectOk(await v.api.run('history.undo', {}));

    const fibers = drawn(v).fibers?.count ?? 0;
    // NC without fibers or settings (no radii): 10 Å a point
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 3,
      mode: 'walk',
      steps: 12,
      persistence: 20,
      seed: 2,
    });
    expectOk(r);
    const list = drawn(v);
    expect(list.count).toBe(7 + 12);
    expect(list.fibers!.count).toBe(fibers + 1);
    expect(Vec3.distance(xyz(list, 7), xyz(list, 3))).toBeCloseTo(10, 3);
    for (let i = 8; i < 19; ++i) expect(Vec3.distance(xyz(list, i), xyz(list, i - 1))).toBeCloseTo(10, 3);
    expect(Array.from(list.entities!.slice(7))).toEqual(new Array(12).fill(2));
  });

  it('grows from the source where it is drawn after Move this instance (review S1)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    await v.plugin
      .build()
      .to(ref)
      .insert(ParticleListOffsets, {
        offsets: [],
        instances: [{ index: 2, translation: Vec3.create(0, 50, 0), euler: Vec3() }],
      })
      .commit();
    expect(Array.from(xyz(drawn(v), 2)).map((x) => +x.toFixed(3))).toEqual([20, 50, 0]);
    expectOk(
      await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'crystal', a: 30, na: 3, nb: 1, nc: 1 }),
    );
    expect(Array.from(xyz(drawn(v), 7)).map((x) => +x.toFixed(3))).toEqual([-10, 50, 0]);
    expect(Array.from(xyz(drawn(v), 8)).map((x) => +x.toFixed(3))).toEqual([50, 50, 0]);
  });

  it('refuses a grow of no copy: no step (review S2), and a walk of one point (review N1)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const s = steps(v);
    const one = { particles: ref, index: 2, mode: 'crystal', na: 1, nb: 1, nc: 1 };
    expect(await v.api.run('mesoscale.grow', one)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'tiling', rings: 0 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'walk', steps: 1 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(steps(v)).toBe(s);
    expect(painted(v).length).toBe(0);
  });

  it("walks along the entity's Fiber axis when it is set (review S6)", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'x' }));
    expectOk(
      await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'walk', steps: 3, persistence: 0, seed: 1 }),
    );
    // the source unturned (no rotations): its x along the scene's
    const d = Vec3.sub(Vec3(), xyz(drawn(v), 8), xyz(drawn(v), 7));
    expect(Vec3.dot(Vec3.normalize(d, d), Vec3.create(1, 0, 0))).toBeCloseTo(1, 5);
  });

  it("refuses a bank's unit as a source; a bank fiber painted keeps the source before it (review S3)", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', bank: 'dna' }));
    expectOk(
      await v.api.run('mesoscale.paint', { entity: 'NC', positions: [0, 0, 0, 20, 0, 0], fiber: true, seed: 1 }),
    );
    const unit = drawn(v).count - 1;
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: unit, mode: 'sphere' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    const m = v.api.mesoscale!;
    m.growSource.set({ particles: ref, index: 2 });
    (m as unknown as { growFromLast(list: string): void }).growFromLast(ref);
    expect(m.growSource.value).toEqual({ particles: ref, index: 2 });
  });

  it('keeps a grow in a saved state: opened again, the copies are there', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 5, seed: 1 }));
    const grown = Array.from(drawn(v).coordinates.slice(21));
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(entry(v).cell.transform.ref).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(drawn(v).count).toBe(12);
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(grown);
  });

  it('refuses a particle that is not there, sizes of no copy, too many copies, and a list whose targets come from a class', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'crystal', ...p });
    expect(await grow({ index: 7 })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await grow({ index: -1 })).toMatchObject({ ok: false });
    expect(await grow({ a: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ alpha: 10, beta: 10, gamma: 170 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ na: 100, nb: 100, nc: 100 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ mode: 'tiling', spacing: -1 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ mode: 'sphere', radius: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(painted(v).length).toBe(0);
    await v.plugin.build().to(entry(v).cell).apply(ParticleListTargetsFromAttribute, { attribute: 'class' }).commit();
    expect(await grow({})).toMatchObject({ ok: false, code: 'invalid' });
    expect(painted(v).length).toBe(0);
  });
});
