/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { PluginBehavior } from '@molstar/plugin/behavior/behavior';
import type { PluginContext } from '@molstar/plugin/context';

// The streaming budget as a viewer setting (prism.md §9: "a viewer setting (Settings), never the document's"): a plugin
// behavior whose one param is the copies a streamed document holds at once, so Settings lists it (its Behaviors group)
// and a checkpoint holds it (Undo of a change restores it). The behavior is eager (in the viewer's spec from the start,
// never added by the lazy chunk: a restore of a checkpoint taken before it would take it away); it only tells the
// document's owner, which reads `streamingBudget(plugin)`. This file imports no MesoViewSpec code.

/** The behavior's id after its namespace: its key in Settings' Behaviors group (`settings.set`). */
export const StreamingBudgetKey = 'mesoviewspec-streaming';

/** Copies resident at once by default: 7 of the tiled fixture's 32 tiles (its story's budget). */
export const DefaultStreamingBudget = 3000;

/**
 * The margin (Å) by which a resident tile keeps its place (streaming.md, `StreamBudget.hysteresis`), so a slight orbit
 * or pan does not drop a tile at the view's edge and load it again (a quarter of the tiled fixture's 2000 Å tiles).
 */
export const StreamHysteresisA = 500;

/** A viewer's budget: its value, and who to tell when it changes. */
export interface StreamingBudget {
  readonly value: number;
  next(copies: number): void;
  /** Called on each change after it; returns its removal. */
  subscribe(listener: (copies: number) => void): () => void;
}

const Budgets = new WeakMap<object, StreamingBudget>();

/** The budget of one viewer (its plugin), as the behavior last set it; the default without the behavior. */
export function streamingBudget(plugin: PluginContext | object): StreamingBudget {
  let b = Budgets.get(plugin);
  if (!b) {
    let value = DefaultStreamingBudget;
    const listeners = new Set<(copies: number) => void>();
    b = {
      get value() {
        return value;
      },
      next(copies) {
        if (copies === value) return;
        value = copies;
        for (const l of [...listeners]) l(copies);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    Budgets.set(plugin, b);
  }
  return b;
}

interface Params {
  readonly budget: number;
}

export const MesoViewSpecStreaming = PluginBehavior.create<Params>({
  name: StreamingBudgetKey,
  category: 'misc',
  display: { name: 'MesoViewSpec streaming', description: 'How many copies of a streamed document load at once' },
  ctor: class extends PluginBehavior.Handler<Params> {
    register() {
      streamingBudget(this.ctx).next(this.params.budget);
    }
    override update(params: Params) {
      if (params.budget === this.params.budget) return false;
      this.params = params;
      streamingBudget(this.ctx).next(params.budget);
      return true;
    }
  },
  params: () => ({
    budget: PD.Numeric(
      DefaultStreamingBudget,
      { min: 0, max: 10_000_000, step: 100 },
      {
        label: 'Streamed copies',
        description:
          'The copies of a streamed document loaded at once, the ones in view first (0: none, level 0 only)',
      },
    ),
  }),
});
