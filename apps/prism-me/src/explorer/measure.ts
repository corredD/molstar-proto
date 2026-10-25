/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { isEmptyLoci, type Loci } from '@molstar/model/model/loci';
import { isMac } from '@molstar/prism-ui/commands/keys';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { CanvasClick, ExplorerApi, PickedNode } from './operations.js';

// A distance by two ⌘+clicks on a Mac, Ctrl+clicks elsewhere, in selection mode (_spec/ui.md §7): the first point is
// kept (marked in 3D, said on the status line), the second measures it (`stage.distance`, one step), listed under the
// first point's row. Esc, a plain click or leaving selection mode lets the first point go.

/** A distance's first point, waiting for the second */
export interface PendingPoint {
  readonly loci: Loci;
  /** The row it is listed under */
  readonly picked: PickedNode;
}

export interface DistancePicker {
  /** The first point, while the second is awaited */
  readonly pending: ReadonlyState<PendingPoint | undefined>;
  /** A click on the canvas: whether it was a distance's (a plain click lets the first point go, and is not) */
  click(click: CanvasClick): Promise<boolean>;
  /** Lets the first point go */
  cancel(): void;
}

export function distancePicker(
  api: ViewerApi,
  area: ExplorerApi,
  options: {
    readonly post?: (text: string) => void;
    readonly reveal?: (p: PickedNode) => void;
    /** An Apple platform: the gesture is ⌘+click (Ctrl+click is a right-click there); default: this one's */
    readonly mac?: boolean;
  } = {},
): DistancePicker {
  const gesture = (options.mac ?? isMac()) ? '⌘+click' : 'Ctrl+click';
  const pending = observableState<PendingPoint | undefined>(undefined);
  const cancel = () => {
    if (!pending.value) return;
    area.markPoint(undefined);
    pending.set(undefined);
  };
  return {
    pending: pending.asReadonly,
    cancel,
    async click(click) {
      // a distance is measured in selection mode only (Ludovic, 2026-10-24): elsewhere a click is the canvas's own
      if (!click.measure || !area.selectionMode) {
        cancel();
        return false;
      }
      // normalized first (a bond: its atoms; the selection granularity), so its row is the point's
      const loci = isEmptyLoci(click.loci) ? click.loci : area.measurePoint(click.loci);
      const picked = isEmptyLoci(loci) ? undefined : area.pickedOf(loci);
      if (!picked || picked.kind === 'distance' || picked.kind === 'label' || picked.kind === 'volume') {
        options.post?.(`A distance is measured between atoms, residues, chains and particles: ${gesture} one.`);
        return true;
      }
      const first = pending.value;
      // its object removed since (its row gone with it): let go, this point is a new first one
      const gone = first && !area.objectsState().value.some((o) => o.ref === first.picked.node.ref);
      if (!first || gone) {
        cancel();
        pending.set({ loci, picked });
        area.markPoint(loci);
        options.reveal?.(picked);
        options.post?.(
          `${gone ? "The first point's object was removed. " : ''}Distance from ${picked.label}: ${gesture} the second point (Esc cancels).`,
        );
        return true;
      }
      cancel();
      const r = await api.run('stage.distance', {
        a: { loci: first.loci },
        b: { loci },
        node: first.picked.key,
        nodeB: picked.key,
      });
      // made, or measured already: its row picked; a failure or "already" said
      if (!r.ok) options.post?.(r.message);
      else if (r.unchanged) options.post?.(r.did);
      const value = r.ok ? (r.value as { ref?: string } | undefined) : undefined;
      if (value?.ref) {
        const ref = value.ref;
        const label = api.stage?.distancesState().value.find((d) => d.ref === ref)?.label ?? 'Distance';
        options.reveal?.({ key: `d:${ref}`, label, kind: 'distance', node: { ref } });
      }
      return true;
    },
  };
}
