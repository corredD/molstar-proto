/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { type StateObjectCell, type StateTransformer, StateTransform, StateTree } from '@molstar/core/state';
import { StructureFocusRepresentationTags } from '@molstar/plugin/behavior/dynamic/selection/structure-focus-representation';
import type { PluginContext } from '@molstar/plugin/context';
import type { PluginState } from '@molstar/plugin/state';
import type { HistoryManager, HistoryPort } from '@molstar/prism-ui/core';
import { merge } from 'rxjs';
import { isViewing } from './trajectory.js';

// The history's checkpoints (sequence.md §7.2): the plugin's state directly, never its snapshot manager (whose
// `getStateSnapshot` adds entries and whose restore clears). What undo restores: the data tree, behavior
// settings, canvas props, interactivity, the selection mode, and every owner's custom state (the sequence's, through
// `registerCustomState`). What it never touches: the camera, the selection and the focus (view state, not steps).

export interface ViewerCheckpoint {
  readonly plugin: PluginState.Snapshot;
  /** The snapshot (a story's) shown with this scene: showing one is no step, so Undo brings it back with the scene. */
  readonly snapshot?: string;
}

/** The snapshot's parts a checkpoint holds; `camera: false` keeps it from reading the canvas (headless). */
const CheckpointParams: PluginState.SnapshotParams = {
  data: true,
  behavior: true,
  componentManager: true,
  canvas3d: true,
  // The picking level is view state, as the selection mode is (not steps: sequence.md §7.3).
  interactivity: false,
  structureSelection: false,
  camera: false,
  canvas3dContext: false,
  animation: false,
  startAnimation: false,
};

export function createCheckpointPort(plugin: PluginContext): HistoryPort<ViewerCheckpoint> {
  const trees = new SerializedTrees();
  return {
    checkpoint: () => {
      // The trees from the cache (unchanged transforms shared with earlier checkpoints), the rest from the plugin.
      const snapshot = plugin.state.getSnapshot(TreelessParams);
      const current = plugin.managers.snapshot.state.current;
      // The cells behaviors registered (and what hangs from them) are not the scene's steps: left out (sequence.md §7.2).
      const owned = (t: StateTransform) => isRegisteredOwned(t, plugin);
      return {
        plugin: withoutViewState({
          ...snapshot,
          data: { tree: trees.serialize(plugin.state.data.tree, owned) },
          behaviour: { tree: trees.serialize(plugin.state.behaviors.tree) },
        }),
        ...(current ? { snapshot: current } : {}),
      };
    },
    restore: async (c) => {
      // The focus is view state: a restore leaves it (and the camera, which the checkpoint does not hold); so is the
      // frame a trajectory shows (sequence.md §7.3).
      await plugin.state.setSnapshot({
        ...keepOwnedCells(plugin, keepFrames(plugin, c.plugin)),
        structureFocus: undefined,
      });
      // The story's snapshot this scene was shown with, when the list still has it (the list is not undone).
      // A scene shown with none (before a story was shown, or a snapshot added) marks none.
      const snapshots = plugin.managers.snapshot;
      // One removed from the list since: none of the list is the scene restored either.
      if (!c.snapshot || !snapshots.getEntry(c.snapshot)) snapshots.clearCurrent();
      else if (c.snapshot !== snapshots.state.current) snapshots.setCurrent(c.snapshot);
    },
    size: (c) => trees.size(c),
  };
}

/** The snapshot's parts but the trees, which the port serializes itself. */
const TreelessParams: PluginState.SnapshotParams = { ...CheckpointParams, data: false, behavior: false };

/** Data payloads (a file's text in a raw-data cell) are not counted: the budget is the state's, not the files'. */
function withoutPayloads(_key: string, value: unknown) {
  if (typeof value === 'string' && value.length > 1024) return '';
  if (ArrayBuffer.isView(value)) return '';
  return value;
}

/** The state flags of a transform as they are now (`StateTransform.toJSON` writes the set ones). */
function flagsOf(t: StateTransform): number {
  const s = t.state;
  return (s.isGhost ? 1 : 0) | (s.isLocked ? 2 : 0) | (s.isHidden ? 4 : 0) | (s.isCollapsed ? 8 : 0);
}

/**
 * The trees of checkpoints, each transform serialized and measured once (sequence.md §7.4): a transform object is
 * immutable in a committed tree (a new version is a new object), so its JSON is kept per object and shared by every
 * checkpoint that holds it, and its size with it. A step costs the transforms it changed, not the scene (a scene of
 * 1401 cells re-serialized 147 KB and measured 1 MB of JSON each step). The one thing changed in place is a
 * transform's state flags (the state's transient tree merges a second flag update into the same object), so they are
 * compared on each read. Shared means read-only: `keepFrames` copies what it changes, `StateTransform.fromJSON` only
 * reads.
 */
class SerializedTrees {
  readonly #json = new WeakMap<StateTransform, { flags: number; json: StateTransform.Serialized }>();
  readonly #sizes = new WeakMap<StateTransform.Serialized, number>();
  readonly #valueSizes = new WeakMap<object, number>();

  /** `skip` leaves out a transform and everything under it. */
  serialize(tree: StateTree, skip?: (t: StateTransform) => boolean): StateTree.Serialized {
    const transforms: StateTransform.Serialized[] = [];
    StateTree.doPreOrder(tree, tree.root, transforms, (t, _, out) => {
      if (skip?.(t)) return false;
      const flags = flagsOf(t);
      let cached = this.#json.get(t);
      if (cached?.flags !== flags) {
        // Params are kept from the cached JSON: a transform with custom serialization makes them fresh each time.
        const json = StateTransform.toJSON(t);
        cached = { flags, json: cached ? { ...json, params: cached.json.params } : json };
        this.#json.set(t, cached);
      }
      out.push(cached.json);
    });
    return { transforms };
  }

  /** The checkpoint's JSON size without payloads: each transform and each custom value measured once, the small rest each time. */
  size(c: ViewerCheckpoint): number {
    try {
      const { data, behaviour, custom, ...rest } = c.plugin;
      let size = JSON.stringify(rest, withoutPayloads).length;
      for (const tree of [data?.tree, behaviour?.tree]) {
        if (!tree) continue;
        // `,"data":{"tree":{"transforms":[…]}}` and a comma between transforms.
        size += 34 + Math.max(0, tree.transforms.length - 1);
        for (const t of tree.transforms) size += this.#sizeOf(t);
      }
      if (custom) {
        // `,"custom":{}`, and per key `"key":` and a comma. A key whose value is `undefined` is not in the JSON.
        size += 12;
        let keys = 0;
        for (const [key, value] of Object.entries(custom)) {
          if (value === undefined) continue;
          size += key.length + 3 + (keys++ ? 1 : 0) + this.#sizeOfValue(value);
        }
      }
      return size;
    } catch {
      return 0;
    }
  }

  /**
   * A custom state's value measured once while it is the same object (an owner returns the same document until it
   * changes: a new version is a new object, sequence.md §7.4); a value that is not an object is measured each time.
   */
  #sizeOfValue(value: unknown): number {
    if (typeof value !== 'object' || value === null) return JSON.stringify(value, withoutPayloads)?.length ?? 0;
    let size = this.#valueSizes.get(value);
    if (size === undefined) {
      size = JSON.stringify(value, withoutPayloads).length;
      this.#valueSizes.set(value, size);
    }
    return size;
  }

  #sizeOf(t: StateTransform.Serialized): number {
    let size = this.#sizes.get(t);
    if (size === undefined) {
      size = JSON.stringify(t, withoutPayloads).length;
      this.#sizes.set(t, size);
    }
    return size;
  }
}

/**
 * A snapshot without what is view state for undo (sequence.md §7.2–§7.3): which structure the sequence follows (a saved
 * session keeps it; Undo leaves it).
 */
function withoutViewState(snapshot: PluginState.Snapshot): PluginState.Snapshot {
  const sequence = snapshot.custom?.['prism-viewer.sequence'] as Record<string, unknown> | undefined;
  if (!sequence || !('structure' in sequence)) return snapshot;
  const { structure: _, ...rest } = sequence;
  return { ...snapshot, custom: { ...snapshot.custom, 'prism-viewer.sequence': rest } };
}

/** A checkpoint's data with each trajectory at the frame it shows now (frames are viewing, not steps). */
function keepFrames(plugin: PluginContext, snapshot: PluginState.Snapshot): PluginState.Snapshot {
  const data = snapshot.data;
  if (!data) return snapshot;
  let changed = false;
  const transforms = data.tree.transforms.map((t) => {
    if (!t.transformer.endsWith('model-from-trajectory')) return t;
    const now = (plugin.state.data.cells.get(t.ref)?.transform.params as { modelIndex?: number } | undefined)
      ?.modelIndex;
    if (now === undefined || now === t.params?.modelIndex) return t;
    changed = true;
    return { ...t, params: { ...t.params, modelIndex: now } };
  });
  return changed ? { ...snapshot, data: { ...data, tree: { ...data.tree, transforms } } } : snapshot;
}

/** The checkpoint's JSON size without data payloads, measured whole (tests; the port measures per transform). */
export function checkpointSize(c: ViewerCheckpoint): number {
  try {
    return JSON.stringify(c.plugin, withoutPayloads).length;
  } catch {
    return 0;
  }
}

/** Cells owned by behaviors: they change outside the API by design and do not make checkpoints unsafe (§7.3). */
const BehaviorTags = new Set<string>(Object.values(StructureFocusRepresentationTags));

/** Transformers whose cells behaviors make and update on their own: volume streaming, custom properties. */
const BehaviorTransformers = ['volume-streaming', 'custom-model-properties', 'custom-structure-properties'];

/** The transformers an extension registered as behavior-owned, per plugin (id -> registrations). */
const Registered = new WeakMap<PluginContext, Map<string, number>>();

/**
 * Registers transformers whose cells a behavior of the caller owns (sequence.md §7.2): a cell of one (a streamed
 * tile) is no change outside the API, whoever makes or updates it, and a checkpoint leaves it out with everything
 * under it; a restore keeps it where its parent is still in the tree (the behavior follows the camera, not the
 * history). A transformer is its object or its id, matched whole (the fixed list below matches by part). Per plugin;
 * returns the function that takes the registration back.
 */
export function registerBehaviorOwned(
  plugin: PluginContext,
  transformers: ReadonlyArray<StateTransformer | string>,
): () => void {
  let ids = Registered.get(plugin);
  if (!ids) Registered.set(plugin, (ids = new Map()));
  const added = transformers.map((t) => (typeof t === 'string' ? t : t.id));
  for (const id of added) ids.set(id, (ids.get(id) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const id of added) {
      const n = (ids.get(id) ?? 0) - 1;
      if (n > 0) ids.set(id, n);
      else ids.delete(id);
    }
  };
}

/** Whether a transformer was registered for the plugin by `registerBehaviorOwned`. */
function isRegisteredOwned(transform: StateTransform, plugin: PluginContext): boolean {
  return !!Registered.get(plugin)?.has(transform.transformer.id);
}

/**
 * Whether the cell is no change outside the API: a transformer registered for the plugin (`registerBehaviorOwned`), or
 * the fixed list (the focus representation, volume streaming, custom properties). Only the registered are left out of
 * checkpoints: the fixed list's cells (custom properties sit above the structures) are the scene's.
 */
export function isBehaviorOwned(transform: StateTransform, plugin?: PluginContext): boolean {
  if (transform.tags?.some((t) => BehaviorTags.has(t))) return true;
  if (plugin && isRegisteredOwned(transform, plugin)) return true;
  const id = transform.transformer.id;
  return BehaviorTransformers.some((t) => id.includes(t));
}

/**
 * A checkpoint's data with the owned cells of the tree now put back: each owned cell and what hangs from it, where its
 * parent is in the checkpoint's tree (an owned cell whose parent the restore removes goes with it).
 */
function keepOwnedCells(plugin: PluginContext, snapshot: PluginState.Snapshot): PluginState.Snapshot {
  const data = snapshot.data;
  if (!data) return snapshot;
  const tree = plugin.state.data.tree;
  const owned: StateTransform[] = [];
  StateTree.doPreOrder(tree, tree.root, owned, (t, _, out) => {
    if (!isRegisteredOwned(t, plugin)) return;
    StateTree.doPreOrder(tree, t, out, (n, _, o) => void o.push(n));
    return false;
  });
  if (!owned.length) return snapshot;
  const refs = new Set(data.tree.transforms.map((t) => t.ref));
  const kept: StateTransform.Serialized[] = [];
  for (const t of owned) {
    // Pre-order: a parent is decided before its children. One the checkpoint holds (it was taken before the
    // registration) stays as it was; one whose parent or dependency the restore removes goes with it.
    if (refs.has(t.ref) || !refs.has(t.parent) || !(t.dependsOn ?? []).every((d) => refs.has(d))) continue;
    refs.add(t.ref);
    kept.push(StateTransform.toJSON(t));
  }
  if (!kept.length) return snapshot;
  return { ...snapshot, data: { ...data, tree: { ...data.tree, transforms: [...data.tree.transforms, ...kept] } } };
}

/**
 * Watches the data tree for changes outside the API (sequence.md §7.3): a cell created, removed or updated while the
 * history is not applying a run or a restore, and not owned by a behavior, makes every earlier checkpoint unsafe.
 */
export function watchOutsideChanges(plugin: PluginContext, history: HistoryManager<ViewerCheckpoint>): () => void {
  const state = plugin.state.data;
  const removedTransforms = new Map<string, StateTransform>();
  // A cell is owned when it is the fixed list's, or registered, or under a registered one (a checkpoint leaves those
  // out). The fixed list's own cells do not own what hangs from them: custom properties sit above the structures.
  // A removed cell is gone from the tree by the time its event comes, and so is its parent: a removal's events come
  // leaves first, so the parent's transform is still in `removedTransforms` (kept until its own event is checked).
  const isOwned = (transform: StateTransform) => {
    if (isBehaviorOwned(transform, plugin)) return true;
    let t: StateTransform | undefined = transform;
    while (t) {
      if (isRegisteredOwned(t, plugin)) return true;
      t = t.parent === t.ref ? undefined : (state.tree.transforms.get(t.parent) ?? removedTransforms.get(t.parent));
    }
    return false;
  };
  const check = (transform: StateTransform | undefined) => {
    if (history.applying || !transform || isOwned(transform)) return;
    // Snapshots playing are a presentation, not edits: the steps before stay undoable (sequence.md §7.3).
    if (plugin.managers.snapshot.state.isPlaying) return;
    // So are the frames stepped through and the animations played (the trajectory and animation areas).
    if (isViewing(plugin)) return;
    history.invalidate('Changed outside the viewer: this step can no longer be undone.');
  };
  const transformOf = (ref: string): StateTransform | undefined =>
    (state.cells.get(ref) as StateObjectCell | undefined)?.transform ?? state.tree.transforms.get(ref);
  const created = state.events.cell.created.subscribe((e) => removedTransforms.set(e.ref, e.cell.transform));
  const sub = merge(state.events.cell.created.pipe(), state.events.object.updated.pipe()).subscribe((e) =>
    check(transformOf(e.ref)),
  );
  const removed = state.events.cell.removed.subscribe((e) => {
    check(removedTransforms.get(e.ref));
    removedTransforms.delete(e.ref);
  });
  for (const [ref, cell] of state.cells) removedTransforms.set(ref, cell.transform);
  return () => {
    sub.unsubscribe();
    created.unsubscribe();
    removed.unsubscribe();
  };
}
