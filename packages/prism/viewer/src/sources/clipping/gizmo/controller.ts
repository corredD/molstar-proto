/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 */

import type { PluginContext } from '@molstar/plugin/context';
import { RepresentationClip } from '@molstar/plugin/state/helpers/representation-clip';
import { observableState, type ReadonlyState } from '@molstar/prism-ui/core';
import { GizmoHandles } from '../../gizmos/handles.js';
import { type Cut, type CutObject, representationsSphere } from '../cuts.js';
import { ClipBinding, type ClipItem, type GizmoCommit } from './binding.js';

export type { GizmoCommit } from './binding.js';

// The clipping gizmos (clipping.md §4): `GizmoHandles` (gizmos.md) on the cuts' binding (`ClipBinding`), for the active
// cut (its editor open: `handleOnly`), shown while the section is (`show`, `hide`). The active cut outlives `hide`: shown
// again, its gizmo comes back. A cut is known by its number, which shifts when one before it goes: the active cut is
// followed by its object (its tag), or by its number when its object changed and the count did not (an edit).

export class ClipGizmos {
  /** The active cuts by number (one: the section's), and their objects as last seen (to follow them) */
  readonly #handled = observableState<readonly number[]>([]);
  #handledObjects = new Map<number, CutObject>();
  /** How many cuts there were when the active ones were last followed: an edit keeps the count, a removal does not */
  #followedCount = 0;
  readonly #binding: ClipBinding;
  readonly #handles: GizmoHandles<CutObject>;

  constructor(
    private readonly plugin: PluginContext,
    private readonly cuts: ReadonlyState<readonly Cut[]>,
  ) {
    this.#binding = new ClipBinding(plugin, () => this.#items(this.cuts.value));
    this.#handles = new GizmoHandles(plugin, this.#binding, { changes: cuts });
  }

  get shown(): ReadonlyState<boolean> {
    return this.#handles.shown;
  }

  /** The cuts whose gizmos show (while `shown`), by number */
  get handled(): ReadonlyState<readonly number[]> {
    return this.#handled.asReadonly;
  }

  /** The active cut: its gizmo alone, or none */
  handleOnly(index: number | undefined): void {
    const cut = index === undefined ? undefined : this.cuts.value.find((c) => c.index === index);
    this.#handledObjects = new Map(cut ? [[cut.index, cut.object] as const] : []);
    this.#followedCount = this.cuts.value.length;
    this.#handles.publish();
  }

  /** Shows the gizmos; a drag's release commits through `commit`. Without a canvas (headless): false */
  show(commit: GizmoCommit): boolean {
    this.#binding.setCommit(commit);
    return this.#handles.show();
  }

  hide(): void {
    this.#handles.hide();
  }

  /** The drag in progress, undone */
  cancel(): void {
    this.#handles.cancel();
  }

  /** The active cuts followed into `cuts`, as the gizmos' items */
  #items(cuts: readonly Cut[]): ClipItem[] {
    // during a drag the cut is the drag's (its number and object are followed again once it ends)
    if (this.#handles.dragging === undefined) this.#follow(cuts);
    const items: ClipItem[] = [];
    for (const cut of cuts) {
      if (!this.#handledObjects.has(cut.index)) continue;
      const bounds = representationsSphere(
        cut.targets.flatMap((t) => {
          const cell = this.plugin.state.data.cells.get(t.ref);
          return cell ? [cell] : [];
        }),
      );
      if (!bounds) continue;
      items.push({ key: cut.object.tag || `#${cut.index}`, value: cut.object, label: `Cut ${cut.index}`, bounds });
    }
    return items;
  }

  /**
   * The active cuts in `cuts`: each by its object (its tag), else by its number when its object is gone and the count
   * is the same (it was edited; a removal shifts the numbers, and the next cut is not the removed one)
   */
  #follow(cuts: readonly Cut[]) {
    const before = this.#handledObjects;
    const next = new Map<number, CutObject>();
    const sameCount = cuts.length === this.#followedCount;
    this.#followedCount = cuts.length;
    for (const cut of cuts) {
      const same = [...before.values()].some((o) => RepresentationClip.sameCut(o, cut.object));
      const old = before.get(cut.index);
      const edited = sameCount && !!old && !cuts.some((c) => RepresentationClip.sameCut(c.object, old));
      if (same || edited) next.set(cut.index, cut.object);
    }
    this.#handledObjects = next;
    const ids = [...next.keys()];
    const prev = this.#handled.value;
    if (ids.length !== prev.length || ids.some((x, i) => x !== prev[i])) this.#handled.set(ids);
  }
}
