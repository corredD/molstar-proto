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
  ParticleListTargetsFromAttribute,
  ParticleListTransform,
} from '@molstar/plugin/state/transforms/particles/ops';
import { ParticleListPainted } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// `mesoscale.paint` (progress/2026-11-08-paint.md, Tests: operation) on a cellPACK-like list whose four targets are 1CRN
// (data/examples), drawn as targets: a stroke is one history step, its copies drawn as instances of their target.

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
const instances = (v: PrismViewer) =>
  (
    (entry(v).representations[0].cell.obj!.data as unknown as { repr: { renderObjects: { values: any }[] } }).repr
      .renderObjects ?? []
  ).reduce((n, ro) => n + ro.values.instanceCount.ref.value, 0);
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const painted = (v: PrismViewer) =>
  Array.from(v.plugin.state.data.cells.values()).filter((c) => c.transform.transformer === ParticleListPainted);
const zOf = (list: ParticleList, i: number) =>
  Vec3.transformQuat(
    Vec3(),
    Vec3.create(0, 0, 1),
    Quat.create(
      list.rotations![i * 4],
      list.rotations![i * 4 + 1],
      list.rotations![i * 4 + 2],
      list.rotations![i * 4 + 3],
    ),
  );

describe('mesoscale.paint', () => {
  it('paints a stroke as one step: copies drawn, upright on a surface; undo removes it, redo brings it back', async () => {
    const v = await viewer();
    const before = { count: drawn(v).count, instances: instances(v), steps: steps(v) };
    expect(before.count).toBe(7);
    // CA: its compartment a surface (root.envelope.capsid.surface): +z along the normal
    const r = await v.api.run('mesoscale.paint', {
      entity: 'CA',
      positions: [0, 50, 0, 10, 50, 0, 20, 50, 0],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      seed: 1,
    });
    expectOk(r);
    expect(r.value).toEqual({ count: 3, orient: 'normal' });
    expect(steps(v)).toBe(before.steps + 1);
    const list = drawn(v);
    expect(list.count).toBe(10);
    expect(Array.from(list.targets.slice(7))).toEqual([1, 1, 1]);
    expect(Array.from(list.compartments!.slice(7))).toEqual([1, 1, 1]);
    for (let i = 7; i < 10; ++i) expect(Vec3.distance(zOf(list, i), Vec3.create(0, 1, 0))).toBeLessThan(1e-5);
    expect(instances(v)).toBe(before.instances + 3);
    expect(painted(v).length).toBe(1);

    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(7);
    expect(instances(v)).toBe(before.instances);
    expect(painted(v).length).toBe(0);
    expectOk(await v.api.run('history.redo', {}));
    expect(drawn(v).count).toBe(10);
    expect(instances(v)).toBe(before.instances + 3);
  });

  it('appends a second stroke to the same decorator, one more step; undo takes the second only', async () => {
    const v = await viewer();
    expectOk(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [0, 50, 0], normals: [0, 1, 0], seed: 1 }));
    const s = steps(v);
    expectOk(await v.api.run('mesoscale.paint', { entity: 'NC', positions: [0, 60, 0, 5, 60, 0], seed: 2 }));
    expect(steps(v)).toBe(s + 1);
    expect(painted(v).length).toBe(1);
    expect(drawn(v).count).toBe(10);
    expect(Array.from(drawn(v).targets.slice(7))).toEqual([1, 2, 2]);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(8);
  });

  it('paints a fibre as one step: its points copies, one new fibre through them, turned along it; undo removes both', async () => {
    const v = await viewer();
    const before = { count: drawn(v).count, fibers: drawn(v).fibers?.count ?? 0, steps: steps(v) };
    const r = await v.api.run('mesoscale.paint', {
      entity: 'NC',
      positions: [0, 0, 0, 10, 0, 0, 10, 10, 0],
      fiber: true,
    });
    expectOk(r);
    expect((r.value as { orient: string }).orient).toBe('fiber');
    expect(steps(v)).toBe(before.steps + 1);
    const list = drawn(v);
    expect(list.count).toBe(before.count + 3);
    expect(list.fibers!.count).toBe(before.fibers + 1);
    const f = list.fibers!;
    const last = Array.from(f.indices.slice(f.offsets[f.count - 1], f.offsets[f.count]));
    expect(last).toEqual([before.count, before.count + 1, before.count + 2]);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(before.count);
    expect(drawn(v).fibers?.count ?? 0).toBe(before.fibers);
  });

  it("sets an entity's fibre rise and twist as one step: every painted fibre of it made again; undo puts them back", async () => {
    const v = await viewer();
    const base = drawn(v).count;
    // NC without fibres or settings (the list has no radii): 10 Å a point, no twist
    const st = v.api.mesoscale!.fiberState(entry(v).cell.transform.ref, 2);
    const sub = st.subscribe(() => {});
    expect(st.value).toEqual({ rise: 10, twist: 0, jitter: 0, axis: 'auto', offset: 0, bank: 'none', fibers: false });
    for (const y of [0, 30]) {
      expectOk(await v.api.run('mesoscale.paint', { entity: 'NC', positions: [0, y, 0, 20, y, 0], fiber: true }));
    }
    expect(drawn(v).count).toBe(base + 6);
    const before = steps(v);
    const r = await v.api.run('mesoscale.fiber', { entity: 'NC', rise: 5, twist: 34.3 });
    expectOk(r);
    expect(steps(v)).toBe(before + 1);
    // both painted fibres again: 5 points each (20 Å at 5); the file's fibres as they were
    expect(drawn(v).count).toBe(base + 10);
    expect(st.value).toEqual({ rise: 5, twist: 34.3, jitter: 0, axis: 'auto', offset: 0, bank: 'none', fibers: true });
    // the jitter alone: the rise and twist kept
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', jitter: 180 }));
    expect(st.value).toEqual({
      rise: 5,
      twist: 34.3,
      jitter: 180,
      axis: 'auto',
      offset: 0,
      bank: 'none',
      fibers: true,
    });
    // the axis and the offset (Round 4): the points 4 Å off the path, as many
    const r4 = await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'x', offset: 4 });
    expectOk(r4);
    expect(r4.ok && r4.did).toContain('x axis');
    expect(st.value).toEqual({ rise: 5, twist: 34.3, jitter: 180, axis: 'x', offset: 4, bank: 'none', fibers: true });
    expect(drawn(v).count).toBe(base + 10);
    const c = drawn(v).coordinates;
    const at = drawn(v).count - 5;
    expect(Math.hypot(c[at * 3 + 1] - 30, c[at * 3 + 2])).toBeCloseTo(4, 3);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(base + 6);
    expect(st.value).toEqual({ rise: 10, twist: 0, jitter: 0, axis: 'auto', offset: 0, bank: 'none', fibers: false });
    const bad = await v.api.run('mesoscale.fiber', { entity: 'NC' });
    expect(bad.ok).toBe(false);
    sub.unsubscribe();
  });

  it("switches an entity's painted fibre between a bank's units by its sequence (Round 5), one step each", async () => {
    const v = await viewer();
    const base = drawn(v).count;
    const st = v.api.mesoscale!.fiberState(entry(v).cell.transform.ref, 2);
    const sub = st.subscribe(() => {});
    // the DNA bank: its helix (3.38 Å, 36°, z forward) unless given
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', bank: 'dna' }));
    expect(st.value).toMatchObject({ rise: 3.38, twist: 36, axis: 'z', offset: 0, bank: 'dna' });
    const r = await v.api.run('mesoscale.paint', {
      entity: 'NC',
      positions: [0, 0, 0, 3.38 * 5, 0, 0],
      fiber: true,
      sequence: 'ccATGCcc',
      start: 3,
      end: 6,
    });
    expectOk(r);
    const d = drawn(v);
    expect(d.count).toBe(base + 6);
    const units = Array.from(d.targets.slice(base)).map((t) => {
      const target = d.targetMapping?.get(t);
      return target?.kind === 'sites' ? target.sites.label : t;
    });
    expect(units).toEqual(['dna:AT', 'dna:TA', 'dna:GC', 'dna:CG', 'dna:AT', 'dna:TA']);
    expect(d.getParticleLabel(base + 1)).toContain('T4');
    // RNA now: the same fibre's letters read again as nucleotides (T is not one: at random)
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', bank: 'rna' }));
    expect(drawn(v).targetMapping?.get(drawn(v).targets[base])).toMatchObject({ sites: { label: 'rna:A' } });
    // none: the entity's own target again
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', bank: 'none' }));
    expect(Array.from(drawn(v).targets.slice(base)).every((t) => t === 2)).toBe(true);
    sub.unsubscribe();
  });

  it('turns a copy of an entity not on a surface at random, repeatably by its seed', async () => {
    const v = await viewer();
    const r = await v.api.run('mesoscale.paint', { entity: 'loose', positions: [0, 0, 0, 1, 1, 1], seed: 5 });
    expectOk(r);
    expect((r.value as { orient: string }).orient).toBe('random');
    const a = Array.from(drawn(v).rotations!.slice(28));
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.paint', { entity: 'loose', positions: [0, 0, 0, 1, 1, 1], seed: 5 }));
    expect(Array.from(drawn(v).rotations!.slice(28))).toEqual(a);
  });

  it('puts the copies at the scene points of a list moved and scaled before', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0)), Mat4.rotY90);
    await v.plugin.build().to(ref).insert(ParticleListTransform, { transform: m, scale: 2 }).commit();
    expectOk(
      await v.api.run('mesoscale.paint', { entity: 'CA', positions: [10, 20, 30], normals: [1, 0, 0], seed: 1 }),
    );
    const list = drawn(v);
    const p = Vec3.fromArray(Vec3(), list.coordinates, 7 * 3);
    expect(Vec3.distance(p, Vec3.create(10, 20, 30))).toBeLessThan(1e-3);
    expect(Vec3.distance(zOf(list, 7), Vec3.create(1, 0, 0))).toBeLessThan(1e-5);
    // the painted decorator under the list, above its move
    const cell = painted(v)[0];
    expect(cell.transform.parent).toBe(ref);
  });

  it('keeps the strokes in a saved state: opened again, the copies are there, where they were painted', async () => {
    const v = await viewer();
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: 'CA',
        positions: [0, 50, 0, 10, 50, 0],
        normals: [0, 1, 0, 0, 1, 0],
        seed: 1,
      }),
    );
    const painted = Array.from(drawn(v).coordinates.slice(21));
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(entry(v).cell.transform.ref).commit();
    expect(v.plugin.managers.particles.hierarchy.current.lists.length).toBe(0);
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(drawn(v).count).toBe(9);
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(painted);
  });

  it('paints a target of a list without entities; refuses one whose targets come from a class (not built yet)', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const star =
      'data_particles\n\nloop_\n_rlnCoordinateX #1\n_rlnCoordinateY #2\n_rlnCoordinateZ #3\n_rlnClassNumber #4\n10 0 0 1\n20 0 0 2\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'particles.star')] }));
    const list = entry(v);
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 0, 0], seed: 1 }));
    expect(list.cell.obj!.data.count).toBe(2);
    expectOk(await v.api.run('history.undo', {}));
    await v.plugin.build().to(list.cell).apply(ParticleListTargetsFromAttribute, { attribute: 'class' }).commit();
    const r = await v.api.run('mesoscale.paint', { entity: 'Class 1', positions: [0, 0, 0], seed: 1 });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(painted(v).length).toBe(0);
  });

  it('ends its paint mode with the viewer', async () => {
    const v = await viewer();
    const mode = v.api.mesoscale!.paintMode;
    let stopped = 0;
    const stop = mode.stop.bind(mode);
    mode.stop = () => {
      stopped++;
      stop();
    };
    mode.brush.set({ particles: entry(v).cell.transform.ref, entity: 1, name: 'CA' });
    await v.dispose();
    viewers.splice(viewers.indexOf(v), 1);
    expect(stopped).toBe(1);
    expect(mode.brush.value).toBeUndefined();
  });

  it('refuses no positions, unpaired normals, an unknown or missing entity', async () => {
    const v = await viewer();
    expect(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [] })).toMatchObject({ ok: false });
    expect(await v.api.run('mesoscale.paint', { entity: 'CA', positions: [0, 0, 0], normals: [0, 1] })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await v.api.run('mesoscale.paint', { entity: 'nope', positions: [0, 0, 0] })).toMatchObject({ ok: false });
    expect(await v.api.run('mesoscale.paint', { entity: '', positions: [0, 0, 0] })).toMatchObject({ ok: false });
    expect(painted(v).length).toBe(0);
  });
});
