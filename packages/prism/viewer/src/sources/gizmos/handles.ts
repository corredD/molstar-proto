/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Mat4 } from '@molstar/core/math/linear-algebra';
import {
  type GizmoBinding,
  GizmoController,
  type GizmoItem,
  type GizmoLayout,
} from '@molstar/graphics/util/gizmo/controller';
import type { PluginContext } from '@molstar/plugin/context';
import { observableState, type ReadonlyState } from '@molstar/prism-ui/core';
import { BehaviorSubject, Subject } from 'rxjs';

// Handles on what a host moves (gizmos.md): the gizmo library's controller (`@molstar/graphics/util/gizmo`) on the
// host's items, read from the state again at each change, shown and hidden, their clicks claimed
// (`InteractivityManager.clickOwners`: no focus, no select). A drag previews outside the state (the host's) and its
// release is the host's one commit, the canvas's frames held until it is done (`holdFrames`). A change to the cells a
// drag starts from (an undo, another edit) cancels it: those cells and the ones under them.

/** A host's handles: the gizmo library's binding, its items read from the state */
export interface HandlesBinding<T> extends Omit<GizmoBinding<T>, 'items' | 'invalidated'> {
  /** The items shown, as the state holds them now (read again at each change) */
  items(): readonly GizmoItem<T>[];
  /**
   * The cells a drag on `key` starts from (default: the key's); a change to one or a cell under it cancels the drag (a
   * cell above: name it, as a mesh's shape)
   */
  cells?(key: string): readonly string[];
  /**
   * An item's frame alone (`layout`'s): with it, a value of the same geometry as the last laid out keeps that layout's
   * meshes, its frame moved (a drag's moves: no meshes made a pointer event)
   */
  frame?(item: GizmoItem<T>): Mat4;
}

export interface GizmoHandlesOptions {
  /** What has the items read again (default: the state's changes) */
  readonly changes?: { subscribe(next: () => void): { unsubscribe(): void } };
}

/** The longest a commit holds the canvas's frames (ms): a commit that hangs does not freeze the canvas */
const MaxCommitHoldMs = 3000;

export class GizmoHandles<T> {
  readonly #shown = observableState(false);
  readonly #items = new BehaviorSubject<readonly GizmoItem<T>[]>([]);
  readonly #invalidated = new Subject<string>();
  #controller: GizmoController<T> | undefined;
  #subs: { unsubscribe(): void }[] = [];
  #releaseClicks: (() => void) | undefined;
  /** The drag's cells as it started: their params, by ref; its value at the press */
  #drag: { readonly key: string; readonly from: T; readonly params: ReadonlyMap<string, unknown> } | undefined;
  /** The last layout of each item shown, and the value it was of (its meshes kept while its geometry is the same) */
  readonly #laidOut = new Map<string, { value: T; layout: GizmoLayout }>();
  /** A drag ended without its commit, whose cancel the controller runs after the preview in flight */
  #cancelOwed: { readonly key: string; readonly from: T } | undefined;
  /** Owed cancels run early (at a new press): the controller's own calls of them, later, are dropped */
  #cancelsRun = 0;

  constructor(
    private readonly plugin: PluginContext,
    private readonly binding: HandlesBinding<T>,
    private readonly options: GizmoHandlesOptions = {},
  ) {}

  get shown(): ReadonlyState<boolean> {
    return this.#shown.asReadonly;
  }

  /** The key of the item being dragged */
  get dragging(): string | undefined {
    return this.#controller?.dragging.value;
  }

  /** The handles on the items; already shown: the items read again. Without a canvas (headless): false */
  show(): boolean {
    if (!this.#controller) {
      const canvas = this.plugin.canvas3d;
      if (!canvas) return false;
      const controller = new GizmoController(canvas, this.#gizmoBinding());
      this.#controller = controller;
      this.#subs.push(
        // a drag ended: its cancel is owed until the binding's commit or cancel runs
        controller.dragging.subscribe((key) => {
          if (key === undefined && this.#drag) this.#cancelOwed = { key: this.#drag.key, from: this.#drag.from };
        }),
      );
      this.#releaseClicks = this.plugin.managers.interactivity.clickOwners.claim((r) => controller.owns(r));
      const { changes } = this.options;
      this.#subs.push(
        this.plugin.state.data.events.changed.subscribe(() => {
          // the items as they are now, then the drag told if what it started from changed
          if (!changes) this.publish();
          this.#checkDrag();
        }),
      );
      if (changes) this.#subs.push(changes.subscribe(() => this.publish()));
      this.#shown.set(true);
    }
    this.publish();
    return true;
  }

  hide(): void {
    const controller = this.#controller;
    if (!controller) return;
    this.#controller = undefined;
    for (const s of this.#subs) s.unsubscribe();
    this.#subs = [];
    this.#releaseClicks?.();
    this.#releaseClicks = undefined;
    // a drag in progress cancelled (the binding puts its item back)
    controller.dispose();
    this.#drag = undefined;
    this.#cancelOwed = undefined;
    this.#laidOut.clear();
    this.#shown.set(false);
  }

  /** The drag in progress, undone */
  cancel(): void {
    this.#controller?.cancel();
  }

  /** The items read again (a host's target changed) */
  publish(): void {
    const items = this.binding.items();
    // an item gone: its meshes with it
    if (this.#laidOut.size) {
      const shown = new Set(items.map((i) => i.key));
      for (const key of this.#laidOut.keys()) if (!shown.has(key)) this.#laidOut.delete(key);
    }
    this.#items.next(items);
  }

  #gizmoBinding(): GizmoBinding<T> {
    const b = this.binding;
    const laidOut = this.#laidOut;
    return {
      items: this.#items,
      invalidated: this.#invalidated,
      layout: (item) => {
        const last = laidOut.get(item.key);
        if (last && b.frame && b.sameGeometry(last.value, item.value)) {
          last.value = item.value;
          last.layout = { ...last.layout, frame: b.frame(item) };
          return last.layout;
        }
        const layout = b.layout(item);
        if (layout) laidOut.set(item.key, { value: item.value, layout });
        else laidOut.delete(item.key);
        return layout;
      },
      sameGeometry: (x, y) => b.sameGeometry(x, y),
      equal: (x, y) => b.equal(x, y),
      apply: (from, handle, frame, dx, dy) => b.apply(from, handle, frame, dx, dy),
      begin: (key, value) => {
        // the last drag's cancel waits for its preview (Esc, then a press): run now, before this drag's state is set
        const owed = this.#cancelOwed;
        if (owed) {
          this.#cancelOwed = undefined;
          this.#cancelsRun++;
          b.cancel(owed.key, owed.from);
        }
        b.begin?.(key, value);
        this.#drag = { key, from: value, params: this.#paramsOf(key) };
      },
      preview: (key, from, next) => b.preview(key, from, next),
      commit: (key, from, next) => {
        // the commit changes what the drag started from: not a change under it
        this.#drag = undefined;
        this.#cancelOwed = undefined;
        const done = b.commit(key, from, next);
        // frames held until the state has it: the preview and the state's drawing would show it moved twice, or not
        this.plugin.canvas3d?.holdFrames(done, MaxCommitHoldMs);
        return done;
      },
      cancel: (key, from) => {
        // run already, at a new drag's press: this drag's state is the new one's
        if (this.#cancelsRun > 0) {
          this.#cancelsRun--;
          return;
        }
        this.#drag = undefined;
        this.#cancelOwed = undefined;
        b.cancel(key, from);
      },
    };
  }

  /** What a drag started from changed (a cell's params, a cell gone or added): the drag is cancelled */
  #checkDrag() {
    const d = this.#drag;
    if (!d) return;
    const now = this.#paramsOf(d.key);
    let changed = now.size !== d.params.size;
    if (!changed) {
      for (const [ref, params] of d.params) {
        if (now.get(ref) !== params) {
          changed = true;
          break;
        }
      }
    }
    if (changed) this.#invalidated.next(d.key);
  }

  /** The params of the cells a drag on `key` starts from: each cell and every cell under it */
  #paramsOf(key: string): Map<string, unknown> {
    const { cells, tree } = this.plugin.state.data;
    const out = new Map<string, unknown>();
    const roots = this.binding.cells?.(key) ?? [key];
    const down = (ref: string) => {
      const cell = cells.get(ref);
      if (!cell || out.has(ref)) return;
      out.set(ref, cell.transform.params);
      const children = tree.children.get(ref);
      if (children) for (const child of children.values()) down(child);
    };
    for (const root of roots) down(root);
    return out;
  }
}
