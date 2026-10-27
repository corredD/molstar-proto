/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Clip } from '@molstar/core/util/clip';
import { describe, expect, it } from 'vitest';
import { cbs, expectOk, headlessViewer } from '../../../_test/harness.js';

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

  it("gives a cone's half-angle from its scale and back", async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const { cone } = v.api.clipping;
    expect(cone.angle(cone.scale(30))).toBeCloseTo(30, 6);
  });
});
