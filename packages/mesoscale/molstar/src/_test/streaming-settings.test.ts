/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultStreamingBudget, StreamingBudgetKey, streamingBudget } from '../streaming-settings.js';

// The streaming budget as a viewer setting (prism.md §9): prism-me's viewer has the behavior from the start, Settings
// lists it in its Behaviors group, a change is one History step that Undo takes back, and the owner reads it from
// `streamingBudget(plugin)`. Before any document, so before the MesoViewSpec chunk loads.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

describe('the streaming budget setting', () => {
  it('is in Settings › Behaviors, changed as one step, restored by Undo', async () => {
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    const person = v.api.as({ kind: 'person' });
    const budget = streamingBudget(v.plugin);
    expect(budget.value).toBe(DefaultStreamingBudget);
    const got = (await person.settings.get({ group: 'behaviors' })) as {
      ok: boolean;
      value: { values: Record<string, { budget?: number }> }[];
    };
    expect(got.ok).toBe(true);
    expect(got.value[0].values[StreamingBudgetKey]).toEqual({ budget: DefaultStreamingBudget });
    const told: number[] = [];
    budget.subscribe((c) => told.push(c));
    const set = await person.settings.set({ group: 'behaviors', values: { [StreamingBudgetKey]: { budget: 800 } } });
    expect(set.ok, JSON.stringify(set)).toBe(true);
    expect(budget.value).toBe(800);
    expect(v.managers.history.steps.value.length).toBe(1);
    expect((await v.managers.history.undo()).ok).toBe(true);
    expect(budget.value).toBe(DefaultStreamingBudget);
    expect(told).toEqual([800, DefaultStreamingBudget]);
  });
});
