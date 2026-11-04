/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import { expectOk, headlessViewer, recordRuns, until } from '../../_test/harness.js';
import { mapFile } from '../../api/_test/volume-fixtures.js';
import type { ViewerApi } from '../../api/area.js';
import type { PrismViewer } from '../../viewer.js';
import { gestureSteps } from '../gesture-steps.js';

// A gesture's history (gesture-steps.ts): one checkpoint, taken at its start; its steps take none (a snapshot a step
// switched undo off on a scene whose snapshot is slow, three in a row over the budget); one undo step a gesture.

const isoOf = (v: PrismViewer) =>
  (v.plugin.managers.volume.hierarchy.current.volumes[0].representations[0].cell.transform.params as any).type.params
    .isoValue.relativeValue as number;

async function loaded() {
  const v = await headlessViewer();
  await v.api.load.files({ files: [mapFile()] });
  await until(() => v.plugin.managers.volume.hierarchy.current.volumes[0]?.representations.length === 1);
  await until(() => v.api.running.value.length === 0);
  return v;
}

/** A gesture of iso values on the map's isosurface, one change applied at a time (no throttle). */
function isoGesture(v: PrismViewer) {
  return gestureSteps<{ value: number }>(v.api, {
    label: 'Iso value',
    apply: (g: ViewerApi, _key, { value }) => g.volume.isovalue({ value, kind: 'relative' }),
    changed: () => {},
    quietMs: 10_000,
    throttleMs: 0,
  });
}

/** Changes one at a time, each once the last landed: every one an applied step of the gesture. */
async function drag(v: PrismViewer, steps: ReturnType<typeof isoGesture>, values: readonly number[]) {
  for (const value of values) {
    steps.change('iso', { value });
    await until(() => Math.abs(isoOf(v) - value) < 1e-6);
  }
}

describe('a gesture', () => {
  it('takes one checkpoint, at its start, whatever its steps; one undo step', async () => {
    const v = await loaded();
    const before = isoOf(v);
    const steps = v.api.history.steps.value.length;
    const snapshots = vi.spyOn(v.plugin.state, 'getSnapshot');
    const g = isoGesture(v);
    await drag(v, g, [1.1, 1.2, 1.3, 1.4, 1.5]);
    // Mid-drag: nothing recorded yet.
    expect(v.api.history.steps.value.length).toBe(steps);
    g.settle();
    await until(() => v.api.running.value.length === 0 && v.api.history.steps.value.length === steps + 1);
    expect(snapshots).toHaveBeenCalledTimes(1);
    expectOk(await v.api.history.undo());
    expect(isoOf(v)).toBeCloseTo(before, 5);
  });

  it('keeps undo on when the snapshot is slow: one slow checkpoint a gesture, not one a step', async () => {
    const v = await loaded();
    const state = v.plugin.state;
    const real = state.getSnapshot.bind(state);
    // Over the 50 ms budget: three in a row turn per-step checkpoints off.
    vi.spyOn(state, 'getSnapshot').mockImplementation((...args) => {
      const t0 = performance.now();
      while (performance.now() - t0 < 60);
      return real(...args);
    });
    const g = isoGesture(v);
    await drag(v, g, [1.1, 1.2, 1.3, 1.4]);
    g.settle();
    await until(() => v.api.running.value.length === 0);
    expect(v.managers.history.checkpointing.value).toBe(true);
  });

  it('is all or nothing: a refused step undoes the whole gesture at its end', async () => {
    const v = await loaded();
    const before = isoOf(v);
    const steps = v.api.history.steps.value.length;
    const g = isoGesture(v);
    await drag(v, g, [1.1, 1.2]);
    // Not a number: refused.
    g.change('iso', { value: Number.NaN });
    g.settle();
    await until(() => v.api.running.value.length === 0);
    await until(() => Math.abs(isoOf(v) - before) < 1e-6);
    expect(v.api.history.steps.value.length).toBe(steps);
  });

  it('applies nothing more once a step was refused: the drag is undone at its end anyway', async () => {
    const v = await loaded();
    const before = isoOf(v);
    const g = isoGesture(v);
    await drag(v, g, [1.1]);
    const runs = recordRuns(v);
    g.change('iso', { value: Number.NaN });
    await until(() => runs.some((r) => r.result && !r.result.ok));
    const iso = isoOf(v);
    g.change('iso', { value: 1.3 });
    await new Promise((r) => setTimeout(r, 100));
    // Not applied: it would be thrown away at the end.
    expect(isoOf(v)).toBeCloseTo(iso, 6);
    g.settle();
    await until(() => v.api.running.value.length === 0);
    await until(() => Math.abs(isoOf(v) - before) < 1e-6);
  });
});
