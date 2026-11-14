/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { decoratorUnder, type PaintStroke, ParticleListPainted } from '../paint.js';
import type { PaintGroup } from '../paint-group.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// The group operations (progress/2026-11-13-paint-group.md): make a group of instances, paint it, grow from a copy of
// it, nest it, ungroup a copy; each one step, kept in a session.

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
const ref = (v: PrismViewer) => entry(v).cell.transform.ref;
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const params = (v: PrismViewer) =>
  decoratorUnder(v.plugin.state.data, ref(v), ParticleListPainted)?.transform.params as {
    strokes: PaintStroke[];
    groups?: PaintGroup[];
  };
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const turn = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);

/** Three copies of CA and NC close together (painted at 7, 8, 9), then a group of them */
async function grouped(v: PrismViewer) {
  expectOk(
    await v.api.run('mesoscale.paint', {
      entity: 'CA',
      positions: [100, 0, 0, 120, 0, 0],
      normals: [0, 0, 1, 0, 0, 1],
      seed: 1,
    }),
  );
  expectOk(await v.api.run('mesoscale.paint', { entity: 'NC', positions: [110, 15, 0], normals: [0, 0, 1], seed: 2 }));
  const r = await v.api.run('mesoscale.group', { particles: ref(v), indices: [7, 8, 9] });
  expectOk(r);
  return r.value as { group: number; members: number };
}

describe('mesoscale.group', () => {
  it('makes a group of picked instances as one step, the originals kept; undo removes it', async () => {
    const v = await viewer();
    const before = steps(v);
    const g = await grouped(v);
    expect(g.members).toBe(3);
    expect(steps(v)).toBe(before + 3);
    expect(drawn(v).count).toBe(10);
    const group = params(v).groups![0];
    expect(group).toMatchObject({ id: g.group, name: 'Group 1' });
    expect(group.members.map((m) => m.target)).toEqual([1, 1, 2]);
    // its id above the list's targets and entities
    expect(g.group).toBeGreaterThan(3);
    expectOk(await v.api.run('history.undo', {}));
    expect(params(v).groups ?? []).toEqual([]);
    expect(drawn(v).count).toBe(10);
  });

  it('paints the group at its own pose: its members where they were; at a pose P each at P · relative; one step', async () => {
    const v = await viewer();
    const g = await grouped(v);
    const before = drawn(v);
    const was = [7, 8, 9].map((i) => ({ p: xyz(before, i), q: turn(before, i) }));
    const group = params(v).groups![0];
    // the frame's own pose: the centroid, +z along the normal (the members' up, +z here) with no spin
    const center = Vec3.create(110, 5, 0);
    const s = steps(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [center[0], center[1], center[2]],
        normals: [0, 0, 1],
        orient: 'normal',
        spin: 0,
      }),
    );
    expect(steps(v)).toBe(s + 1);
    const out = drawn(v);
    expect(out.count).toBe(13);
    // a plane cluster of three, +z along the normal: each member at P · relative pose; P's +z the normal
    const P = Quat.fromArray(Quat(), params(v).strokes.at(-1)!.rotations, 0);
    group.members.forEach((m, j) => {
      const want = Vec3.add(
        Vec3(),
        Vec3.transformQuat(Vec3(), Vec3.create(...(m.position as [number, number, number])), P),
        center,
      );
      for (let c = 0; c < 3; ++c) expect(out.coordinates[(10 + j) * 3 + c]).toBeCloseTo(want[c], 3);
      // on the surface: its height along the normal its own z in the group
      expect(Vec3.dot(Vec3.sub(Vec3(), xyz(out, 10 + j), center), Vec3.create(0, 0, 1))).toBeCloseTo(m.position[2], 3);
      expect(out.targets[10 + j]).toBe(before.targets[7 + j]);
    });
    // the originals untouched
    for (let i = 0; i < 3; ++i)
      for (let c = 0; c < 3; ++c) expect(out.coordinates[(7 + i) * 3 + c]).toBeCloseTo(was[i].p[c], 4);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(10);
  });

  it('turns the whole group onto a surface: its +z along the normal', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 200, 0],
        normals: [0, 1, 0],
        surface: true,
        seed: 3,
      }),
    );
    const out = drawn(v);
    const group = params(v).groups![0];
    // every member at its own height (z in the group) along the surface's normal (+y)
    group.members.forEach((m, j) => expect(out.coordinates[(10 + j) * 3 + 1] - 200).toBeCloseTo(m.position[2], 3));
  });

  it('grows a tiling from a group copy: every grown copy expands to the members', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    // grown from any member of the copy (index 11): the copy's pose
    const r = await v.api.run('mesoscale.grow', { particles: ref(v), index: 11, mode: 'tiling', rings: 1 });
    expectOk(r);
    expect(r.value).toMatchObject({ count: 6, mode: 'tiling' });
    const grown = params(v).strokes.at(-1)!;
    expect(grown.group).toBe(g.group);
    expect(drawn(v).count).toBe(13 + 18);
    // its source the copy's first particle
    expect(grown.grow!.source.index).toBe(10);
  });

  it('nests: a group of a group copy and a copy expands to the leaves', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    // a member of the group copy (11) stands for the whole copy; 2 a particle of the file
    const r = await v.api.run('mesoscale.group', { particles: ref(v), indices: [11, 2], name: 'Big' });
    expectOk(r);
    const big = r.value as { group: number; members: number };
    expect(big.members).toBe(2);
    expect(
      params(v)
        .groups!.find((x) => x.id === big.group)!
        .members.map((m) => m.group),
    ).toEqual([g.group, undefined]);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: big.group,
        positions: [0, 0, -300],
        normals: [0, 0, 1],
        seed: 5,
      }),
    );
    expect(drawn(v).count).toBe(13 + 4);
    expect(Array.from(drawn(v).targets.slice(13))).toEqual([1, 1, 2, 1]);
  });

  it('ungroups a copy: its members instances of their own where they were, the particles kept; one step', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300, 0, 0, 400],
        normals: [0, 0, 1, 0, 0, 1],
        seed: 4,
      }),
    );
    const before = Array.from(drawn(v).coordinates);
    const s = steps(v);
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 11 }));
    expect(steps(v)).toBe(s + 1);
    // the same particles, in the same places (no key moved: a grow from them stays theirs)
    expect(Array.from(drawn(v).coordinates)).toEqual(before);
    // a member of the ungrouped copy is an instance of its own: not ungrouped again, grown from alone
    expect((await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 11 })).ok).toBe(false);
    const r = await v.api.run('mesoscale.grow', { particles: ref(v), index: 11, mode: 'tiling', rings: 1 });
    expectOk(r);
    expect(params(v).strokes.at(-1)!.group).toBeUndefined();
    expect(drawn(v).count).toBe(16 + 6);
    // the other copy is still one
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 14 }));
    // undo: the copy a group again
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 11 }));
  });

  it('ungroups a copy of a group of groups one level: its inner copies groups still', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    const big = await v.api.run('mesoscale.group', { particles: ref(v), indices: [10, 2], name: 'Big' });
    expectOk(big);
    const id = (big.value as { group: number }).group;
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: id,
        positions: [0, 0, -300],
        normals: [0, 0, 1],
        seed: 5,
      }),
    );
    // 13..15 the inner copy's leaves, 16 the file particle's copy
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 14 }));
    expect((await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 16 })).ok).toBe(false);
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 14 }));
    expect((await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 14 })).ok).toBe(false);
  });

  it('keeps the groups and their copies in a session', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    const was = Array.from(drawn(v).coordinates);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(ref(v)).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(params(v).groups![0].id).toBe(g.group);
    expect(drawn(v).count).toBe(13);
    const now = Array.from(drawn(v).coordinates);
    for (let i = 0; i < was.length; ++i) expect(now[i]).toBeCloseTo(was[i], 4);
  });

  it('picks instances: a click on a member toggles its group copy whole, a particle alone; painting stops it', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    const m = v.api.mesoscale!;
    expect(m.instanceAt(ref(v), 12)).toEqual({ first: 10, count: 3, group: 'Group 1' });
    expect(m.instanceAt(ref(v), 2)).toBeUndefined();
    m.startGroupPick(ref(v));
    // the canvas in selection mode meanwhile (a click neither focuses the camera nor resets it)
    expect(v.plugin.selectionMode).toBe(true);
    expect(m.groupPick.toggle(ref(v), 12)).toBe(true);
    expect(m.groupPick.toggle(ref(v), 2)).toBe(true);
    expect(m.groupPick.state.value?.instances).toEqual([
      { first: 10, count: 3, group: 'Group 1' },
      { first: 2, count: 1 },
    ]);
    expect(m.groupPick.indices).toEqual([10, 2]);
    // another member of the copy: the copy let go
    m.groupPick.toggle(ref(v), 11);
    expect(m.groupPick.indices).toEqual([2]);
    // another list's click is not taken
    expect(m.groupPick.toggle('other', 3)).toBe(false);
    // its list's groups listed with the entities (a row each)
    expect(m.infoState(ref(v)).value?.paintGroups).toEqual([{ id: g.group, name: 'Group 1', members: 3 }]);
    // a brush set (headless: no canvas to start on) stops the picking
    m.paintMode.brush.set({ particles: ref(v), entity: g.group, name: 'Group 1', group: g.group });
    expect(m.groupPick.state.value).toBeUndefined();
    expect(v.plugin.selectionMode).toBe(false);
    m.paintMode.stop();
    // leaving selection mode ends the picking (review N1)
    m.startGroupPick(ref(v));
    v.plugin.selectionMode = false;
    expect(m.groupPick.state.value).toBeUndefined();
    // one on before stays on after
    v.plugin.selectionMode = true;
    m.startGroupPick(ref(v));
    m.groupPick.stop();
    expect(v.plugin.selectionMode).toBe(true);
    v.plugin.selectionMode = false;
    // a change of what is drawn (an undo) lets the picks go: their indices are of the list as it was (review S4)
    m.startGroupPick(ref(v));
    m.groupPick.toggle(ref(v), 12);
    expectOk(await v.api.run('history.undo', {}));
    expect(m.groupPick.state.value?.instances).toEqual([]);
    m.groupPick.stop();
  });

  it("paints a group's stroke as copies, Fiber On or not (its fibers are grown; review S2)", async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300, 200, 0, 300],
        normals: [0, 0, 1, 0, 0, 1],
        fiber: true,
        seed: 4,
      }),
    );
    const last = params(v).strokes.at(-1)!;
    expect(last.fiber).toBeUndefined();
    expect(drawn(v).count).toBe(10 + 6);
  });

  it('grows a random walk from a group copy: its points group copies, each found again (review S6)', async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    const r = await v.api.run('mesoscale.grow', { particles: ref(v), index: 12, mode: 'walk', steps: 5, seed: 2 });
    expectOk(r);
    const grown = params(v).strokes.at(-1)!;
    expect(grown).toMatchObject({ group: g.group, fiber: true });
    const n = drawn(v).count;
    expect((n - 13) % 3).toBe(0);
    expect(n - 13).toBeGreaterThanOrEqual(6);
    // its last copy a group copy whole
    expect(v.api.mesoscale!.instanceAt(ref(v), n - 1)).toEqual({ first: n - 3, count: 3, group: 'Group 1' });
  });

  it("refuses to make a grow again from a group copy since ungrouped; keeps a grown copy's ungrouping (review M2, S1)", async () => {
    const v = await viewer();
    const g = await grouped(v);
    expectOk(
      await v.api.run('mesoscale.paint', {
        entity: '',
        group: g.group,
        positions: [0, 0, 300],
        normals: [0, 0, 1],
        seed: 4,
      }),
    );
    const r = await v.api.run('mesoscale.grow', { particles: ref(v), index: 11, mode: 'tiling', rings: 1 });
    expectOk(r);
    const id = (r.value as { id: number }).id;
    // a grown copy (the second: 16..18) ungrouped, the grow made again with more rings: still ungrouped
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 17 }));
    expectOk(
      await v.api.run('mesoscale.grow', { particles: ref(v), index: 10, mode: 'tiling', rings: 2, replace: id }),
    );
    expect(params(v).strokes.at(-1)!.split).toEqual(['1']);
    expect(v.api.mesoscale!.instanceAt(ref(v), 17)).toBeUndefined();
    // its source copy ungrouped: made again it would be a grow of one member
    expectOk(await v.api.run('mesoscale.ungroup', { particles: ref(v), index: 11 }));
    const again = await v.api.run('mesoscale.grow', {
      particles: ref(v),
      index: 10,
      mode: 'tiling',
      rings: 1,
      replace: id,
    });
    expect(again.ok).toBe(false);
    expect(params(v).strokes.at(-1)!.group).toBe(g.group);
  });
});
