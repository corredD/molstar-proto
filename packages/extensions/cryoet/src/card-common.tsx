/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ActionFooter, Button, Show } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import { type FetchProgress, progressLine } from './load-steps.js';

// What the portal's and EMPIAR's cards share (_spec/portal.md §4, empiar.md §4): their muted line, what a run answers,
// and Load, kept by the panel, not by the form a pick makes again (night review B4).

export const Muted = 'margin: 0; color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

/** What a run of an operation answers, as a card reads it (the viewer's `ApiResult`, without depending on it) */
export type CardRunResult =
  | { readonly ok: true; readonly did: string; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly code?: string; readonly message: string; readonly hint?: string };

/** How a card loads: the viewer's API (`ctx.api`), or a story's fake */
export interface CardContext {
  readonly api: {
    run(id: string, values: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<CardRunResult>;
  };
}

/** The cards' Loads, by the area they load from, then the context they run through (`LoadAction.of`) */
const actions = new WeakMap<object, WeakMap<CardContext, LoadAction>>();

/**
 * A card's Load: busy, what the last load said, its Cancel. One a panel: a load in flight keeps its result when the pick
 * changes, and a second Load waits for it. A size question (`confirm`) is for the pick it was asked of (`key`): Load
 * goes on (`large`) for that pick only, so changing the files asks again (review M1).
 */
export class LoadAction {
  /**
   * The Load of a card's area and context, kept while they are (review F2: an overlay card is unmounted when closed, and
   * a Load made a mount lost the load still running: opened again, no busy, no Cancel, and a second Load). Keyed by
   * both: the app's two cards share their context, each its own area; a story or a test gives fakes of its own. It holds
   * states and the load's stop, no view: each mount watches it in its own scope.
   */
  static of(area: object, ctx: CardContext): LoadAction {
    let byCtx = actions.get(area);
    if (!byCtx) actions.set(area, (byCtx = new WeakMap()));
    let action = byCtx.get(ctx);
    if (!action) byCtx.set(ctx, (action = new LoadAction(ctx)));
    return action;
  }

  readonly busy = observableState(false);
  private readonly said = observableState('');
  private readonly asked = observableState<{ readonly key: string; readonly message: string } | undefined>(undefined);
  private stop: AbortController | undefined;

  constructor(private readonly ctx: CardContext) {}

  /** Runs `id`; with a `key`, the question's: `large` when the key was asked of */
  async run(id: string, values: Record<string, unknown>, key?: string) {
    this.busy.set(true);
    this.stop = new AbortController();
    try {
      const large = key === undefined ? {} : { large: this.asked.value?.key === key };
      const r = await this.ctx.api.run(id, { ...values, ...large }, { signal: this.stop.signal });
      const confirm = !r.ok && r.code === 'confirm' && key !== undefined;
      this.asked.set(confirm ? { key, message: `${r.message} Load anyway?` } : undefined);
      this.said.set(
        r.ok ? [r.did, ...(r.warnings ?? [])].join(' ') : confirm ? '' : `${r.message}${r.hint ? ` ${r.hint}` : ''}`,
      );
    } catch (e) {
      // a load that threw (a format's error out of the state's update) says so, and Load comes back
      this.said.set((e as Error).message ?? String(e));
    } finally {
      this.busy.set(false);
      this.stop = undefined;
    }
  }

  /** Load's row for a form: the button (`Load anyway` for the pick asked of), its download and Cancel, what it said */
  view(props: {
    key?: ReadonlyState<string>;
    info: ReadonlyState<string>;
    fetching?: ReadonlyState<FetchProgress | undefined>;
    onApply(): void;
  }) {
    const key = props.key ?? observableState('').asReadonly;
    const asking = derive([this.asked.asReadonly, key], (a, k) => !!a && a.key === k);
    const line = derive([this.said.asReadonly, this.asked.asReadonly, asking], (s, a, on) => (on ? a!.message : s));
    // no download under way (before the first, between the last and the step's end): the load still runs (review F6)
    const reading = props.fetching && mapState(props.fetching, (f) => (f ? progressLine(f) : 'Loading…'));
    return (
      <>
        <ActionFooter
          icon="download"
          label={mapState(asking, (a) => (a ? 'Load anyway' : 'Load'))}
          busy={this.busy.asReadonly}
          info={props.info}
          onApply={props.onApply}
        />
        <Show when={this.busy.asReadonly}>
          {() => (
            <div style="display: flex; gap: var(--msp-space-2); align-items: center; min-width: 0">
              <p style={`${Muted}; flex: 1`}>{reading ?? 'Loading…'}</p>
              <Button size="sm" onClick={() => this.stop?.abort()}>
                Cancel
              </Button>
            </div>
          )}
        </Show>
        <Show when={mapState(line, (m) => !!m)}>{() => <p style={Muted}>{line}</p>}</Show>
      </>
    );
  }
}

/** A read flag that only the latest of overlapping reads clears (night review B7) */
export function readingFlag() {
  const reading = observableState(false);
  let latest = 0;
  return {
    state: reading.asReadonly,
    track<T>(p: Promise<T>): Promise<T> {
      const n = ++latest;
      reading.set(true);
      return p.finally(() => {
        if (n === latest) reading.set(false);
      });
    },
  };
}
