/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type IR, type IRLook, placementSets } from '../ir/ir.js';
import type { PlacementSet } from '../ir/placements.js';

// The renderer adapter contract (design.md §6.5): an adapter is told the whole IR each time and works out what changed
// by keys, never by content. `planCommit` is that diff, the same for every adapter: placement sets by key (a set whose
// key is unchanged is the same object and never re-uploaded), looks by value (O(types)), the camera by value.

export interface RendererAdapter {
  readonly id: string;
  commit(ir: IR): Promise<CommitReport>;
  dispose(): void | Promise<void>;
}

export interface CommitReport {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly kept: readonly string[];
  readonly looksWritten: number;
  readonly cameraSet: boolean;
  /** Wall time of the commit, and of its parts where the adapter can tell them apart. */
  readonly ms: { readonly total: number; readonly sets?: number; readonly looks?: number; readonly camera?: number };
}

export interface CommitPlan {
  readonly add: readonly PlacementSet[];
  readonly remove: readonly string[];
  readonly keep: readonly string[];
  /** The looks to write (all of them when any changed: adapters write a set's looks as one patch). */
  readonly looks: readonly IRLook[];
  readonly looksChanged: boolean;
  readonly cameraChanged: boolean;
}

export function planCommit(prev: IR | undefined, next: IR): CommitPlan {
  const before = new Map((prev ? placementSets(prev) : []).map((s) => [s.key, s]));
  const after = placementSets(next);
  const add: PlacementSet[] = [];
  const keep: string[] = [];
  for (const s of after) {
    if (before.has(s.key)) keep.push(s.key);
    else add.push(s);
  }
  const afterKeys = new Set(after.map((s) => s.key));
  const remove = [...before.keys()].filter((k) => !afterKeys.has(k));
  const looksChanged = !prev || add.length > 0 || JSON.stringify(prev.view.looks) !== JSON.stringify(next.view.looks);
  const cameraChanged = !!next.view.camera && JSON.stringify(prev?.view.camera) !== JSON.stringify(next.view.camera);
  return { add, remove, keep, looks: next.view.looks, looksChanged, cameraChanged };
}
