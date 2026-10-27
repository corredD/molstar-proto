/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Clip } from '@molstar/core/util/clip';
import { describe, expect, it } from 'vitest';
import { cbs, expectOk, headlessViewer } from '../../../_test/harness.js';
import { mountGizmoCanvas } from '../../../testing/gizmo-canvas.js';

// A cut previewed by a view's gesture (clipping.md §4): shown on its live representations, not in the state and no
// step; `endPreview` puts them back to what the state holds, and a commit then is the one step.

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('a cut previewed', () => {
  it('shows on its representations outside the state, and goes back at its end', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'sphere', target: 'polymer' }));
    const cut = clipping.cuts.value[0];
    const cell = v.plugin.state.data.cells.get(cut.targets[0].ref)!;
    const live = () => {
      const repr = (cell.obj?.data as { repr: { props: { clip: Clip.Props } } }).repr;
      return [...repr.props.clip.objects.find((o) => o.tag === cut.object.tag)!.position];
    };
    const inState = () => [...clipping.cuts.value[0].object.position];
    const before = inState();
    const steps = v.managers.history.steps.value.length;
    expect(clipping.boundsOf(cut)?.radius).toBeGreaterThan(0);

    const moved = Vec3.create(before[0] + 7, before[1], before[2]);
    clipping.previewCut(cut.object, { ...cut.object, position: moved });
    await until(() => live()[0] === before[0] + 7);
    expect(inState()).toEqual(before);
    expect(v.managers.history.steps.value.length).toBe(steps);

    clipping.endPreview();
    await until(() => live()[0] === before[0]);

    // the release: one step, the representations as the state now is
    clipping.previewCut(cut.object, { ...cut.object, position: moved });
    expectOk(await clipping.update({ tag: cut.object.tag, position: [...moved] }));
    clipping.endPreview();
    await until(() => live()[0] === before[0] + 7);
    expect(inState()[0]).toBe(before[0] + 7);
    expect(v.managers.history.steps.value.length).toBe(steps + 1);
  });

  it('drops the previews between, ends at once, keeps a newer one, and ends on a change of the state', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'sphere', target: 'polymer' }));
    expectOk(await clipping.add({ shape: 'cube', target: 'polymer' }));
    const [a, b] = clipping.cuts.value;
    const cell = v.plugin.state.data.cells.get(a.targets[0].ref)!;
    const repr = () => (cell.obj?.data as { repr: { props: { clip: Clip.Props }; createOrUpdate: unknown } }).repr;
    const live = (tag: string) => repr().props.clip.objects.find((o) => o.tag === tag)!.position[0];
    const ax = a.object.position[0];
    const bx = b.object.position[0];
    const at = (o: typeof a.object, x: number) => ({
      ...o,
      position: Vec3.create(x, o.position[1], o.position[2]),
    });
    const settle = () => new Promise((r) => setTimeout(r, 100));

    // a burst ended at once: the first in flight, the others dropped, then back to the state
    const r = repr() as { createOrUpdate: (...args: unknown[]) => unknown };
    const original = r.createOrUpdate;
    let calls = 0;
    r.createOrUpdate = function (this: unknown, ...args: unknown[]) {
      calls++;
      return original.apply(this, args);
    };
    clipping.previewCut(a.object, at(a.object, ax + 1));
    clipping.previewCut(a.object, at(a.object, ax + 2));
    clipping.previewCut(a.object, at(a.object, ax + 3));
    clipping.endPreview();
    await settle();
    expect(live(a.object.tag!)).toBe(ax);
    // the first preview and the restore
    expect(calls).toBe(2);
    r.createOrUpdate = original;

    // another cut while one is previewed: the first back to the state's
    clipping.previewCut(a.object, at(a.object, ax + 5));
    clipping.previewCut(b.object, at(b.object, bx + 5));
    await until(() => live(b.object.tag!) === bx + 5);
    expect(live(a.object.tag!)).toBe(ax);

    // a token: an older end leaves the newer preview
    const t1 = clipping.previewCut(b.object, at(b.object, bx + 6));
    const t2 = clipping.previewCut(b.object, at(b.object, bx + 7));
    clipping.endPreview(t1);
    await until(() => live(b.object.tag!) === bx + 7);
    await settle();
    expect(live(b.object.tag!)).toBe(bx + 7);
    clipping.endPreview(t2);
    await until(() => live(b.object.tag!) === bx);

    // a change of the state (another cut's edit) ends a preview
    clipping.previewCut(b.object, at(b.object, bx + 8));
    await until(() => live(b.object.tag!) === bx + 8);
    expectOk(await clipping.update({ tag: a.object.tag, invert: true }));
    await until(() => live(b.object.tag!) === bx);
  });

  it('asks the canvas for a frame at each preview and at its end (a clip-only update asks for none)', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'sphere', target: 'polymer' }));
    const cut = clipping.cuts.value[0];
    const canvas = mountGizmoCanvas(v.plugin);
    let draws = 0;
    (v.plugin.canvas3d as unknown as { requestDraw: () => void }).requestDraw = () => {
      draws++;
    };
    const p = cut.object.position;
    clipping.previewCut(cut.object, { ...cut.object, position: Vec3.create(p[0] + 3, p[1], p[2]) });
    await until(() => draws >= 1);
    const before = draws;
    clipping.endPreview();
    expect(draws).toBeGreaterThan(before);
    canvas.remove();
  });

  it("gives a cone's half-angle from its scale and back", async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const { cone } = v.api.clipping;
    expect(cone.angle(cone.scale(30))).toBeCloseTo(30, 6);
  });
});
