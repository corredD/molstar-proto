/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { ContextMenuItem } from '@molstar/prism-ui';
import { isEmptyLoci, type Loci } from '@molstar/model/model/loci';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { CanvasClick, ExplorerApi, PickedNode } from './operations.js';

// A distance by two ⌘+clicks on a Mac, Ctrl+clicks elsewhere, in selection mode (_spec/ui.md §7): the first point is
// kept (selected, as the click selects in that mode; said on the status line), the second measures it (`stage.distance`,
// one step), listed under the first point's row. Esc, a plain click or leaving selection mode lets the first point go.
// An angle and a dihedral from the latest three and four of these points (as Mol*'s "from the latest picks"), from
// the canvas's right-click (`menuItems`). A point is an atom, a residue, a chain, a particle, a voxel, a mesh's
// triangle (the point picked on it).

/** A distance's first point, waiting for the second */
export interface PendingPoint {
  readonly loci: Loci;
  /** The row it is listed under */
  readonly picked: PickedNode;
}

export interface DistancePicker {
  /** The first point, while the second is awaited */
  readonly pending: ReadonlyState<PendingPoint | undefined>;
  /** The latest points taken (at most four, the oldest first), until let go */
  readonly recent: ReadonlyState<readonly PendingPoint[]>;
  /** An angle (at the middle one) of the latest three points, a dihedral of the latest four; one step */
  measureLatest(kind: 'angle' | 'dihedral'): Promise<void>;
  /** The right-click's items: an angle and a dihedral from the latest points, when there are enough */
  menuItems(): ContextMenuItem[];
  /** A click on the canvas: whether it was a distance's (a plain click lets the first point go, and is not) */
  click(click: CanvasClick): Promise<boolean>;
  /** Lets the points go: the first one, and the latest (an angle's, a dihedral's) */
  cancel(): void;
}

/** A mesh picked by triangle, taken as the whole shape: structure granularity, not one triangle (ui.md §7) */
function wholeMesh(loci: Loci): boolean {
  if (!Shape.isLoci(loci) && !ShapeGroup.isLoci(loci)) return false;
  if (!loci.shape.getTriangleLoci) return false;
  return !(ShapeGroup.isLoci(loci) && loci.triangles?.length === 1);
}

/** The gesture that measures: ⌘+click on a Mac, Ctrl+click elsewhere */
export const measureGesture = (mac: boolean) => (mac ? '⌘+click' : 'Ctrl+click');

/** Said on a measuring click outside selection mode, where nothing measures (_spec/ui.md §7) */
export const selectionModeHint = (mac: boolean) =>
  `Turn on selection mode to measure: ${measureGesture(mac)} two points`;

export function distancePicker(
  api: ViewerApi,
  area: ExplorerApi,
  options: {
    readonly post?: (text: string) => void;
    readonly reveal?: (p: PickedNode) => void;
    /** An Apple platform: the gesture is ⌘+click; default: the area's (`ExplorerApi.mac`), read at each message */
    readonly mac?: boolean;
  } = {},
): DistancePicker {
  const gesture = () => measureGesture(options.mac ?? area.mac);
  const pending = observableState<PendingPoint | undefined>(undefined);
  const recent = observableState<readonly PendingPoint[]>([]);
  const letGo = () => {
    if (!pending.value) return;
    pending.set(undefined);
  };
  /** Lets every point go: the first one's, and the latest */
  const cancel = () => {
    letGo();
    if (recent.value.length) recent.set([]);
  };
  const take = (point: PendingPoint) => recent.set([...recent.value, point].slice(-4));
  /** Lists a measurement made (or measured already) under its row, says a failure or an "already" */
  const made = (r: Awaited<ReturnType<ViewerApi['run']>>, kind: string) => {
    if (!r.ok) options.post?.(r.message);
    else if (r.unchanged) options.post?.(r.did);
    const value = r.ok ? (r.value as { ref?: string } | undefined) : undefined;
    if (value?.ref) {
      const ref = value.ref;
      const label = api.stage?.distancesState().value.find((d) => d.ref === ref)?.label ?? kind;
      options.reveal?.({ key: `d:${ref}`, label, kind: 'distance', node: { ref } });
    }
  };
  const measureLatest = async (kind: 'angle' | 'dihedral') => {
    const n = kind === 'angle' ? 3 : 4;
    const points = recent.value.slice(-n);
    if (points.length < n) {
      options.post?.(
        `${kind === 'dihedral' ? 'A' : 'An'} ${kind} needs ${n} points: ${gesture()} them in selection mode first.`,
      );
      return;
    }
    // a point's object removed since: said, as for a distance's first point
    const objects = new Set(area.objectsState().value.map((o) => o.ref));
    if (points.some((p) => !objects.has(p.picked.node.ref))) {
      cancel();
      options.post?.(`A point's object was removed: ${gesture()} the points again.`);
      return;
    }
    const [a, b, c, d] = points.map((p) => ({ loci: p.loci }));
    const [node, nodeB, nodeC, nodeD] = points.map((p) => p.picked.key);
    // the unpaired point stays: the next click still completes its distance (ui.md §7)
    const r = await api.run(`stage.${kind}`, {
      a,
      b,
      c,
      ...(d ? { d, nodeD } : {}),
      node,
      nodeB,
      nodeC,
    });
    made(r, kind === 'angle' ? 'Angle' : 'Dihedral');
  };
  return {
    pending: pending.asReadonly,
    recent: recent.asReadonly,
    cancel,
    measureLatest,
    menuItems() {
      const n = recent.value.length;
      const items: ContextMenuItem[] = [];
      if (n >= 3) {
        items.push({
          id: 'measure-angle',
          label: 'Measure the angle of the latest 3 points (at the middle one)',
          icon: 'measure-angle',
          run: () => void measureLatest('angle'),
        });
      }
      if (n >= 4) {
        items.push({
          id: 'measure-dihedral',
          label: 'Measure the dihedral of the latest 4 points (about the middle two)',
          icon: 'measure-angle',
          run: () => void measureLatest('dihedral'),
        });
      }
      return items;
    },
    async click(click) {
      // a distance is measured in selection mode only (Ludovic, 2026-10-24): elsewhere a click is the canvas's own
      if (!click.measure || !area.selectionMode) {
        cancel();
        return false;
      }
      // normalized first (a bond: its atoms; the selection granularity), so its row is the point's
      const loci = isEmptyLoci(click.loci) ? click.loci : area.measurePoint(click.loci);
      const picked = isEmptyLoci(loci) ? undefined : area.pickedOf(loci);
      // a triangle-picked mesh taken whole (structure granularity): not a point, and a point already waiting stays
      // (ui.md §7)
      if (wholeMesh(loci)) {
        options.post?.(`A whole mesh is not a point. Pick a triangle of it (a finer granularity than the structure).`);
        return true;
      }
      if (!picked || picked.kind === 'distance' || picked.kind === 'label') {
        options.post?.(
          `A distance is measured between atoms, residues, chains, particles, volumes and mesh triangles: ${gesture()} one.`,
        );
        return true;
      }
      const first = pending.value;
      // its object removed since (its row gone with it): let go, this point is a new first one
      const gone = first && !area.objectsState().value.some((o) => o.ref === first.picked.node.ref);
      if (!first || gone) {
        letGo();
        pending.set({ loci, picked });
        take({ loci, picked });
        options.reveal?.(picked);
        options.post?.(
          `${gone ? "The first point's object was removed. " : ''}Distance from ${picked.label}: ${gesture()} the second point (Esc cancels).`,
        );
        return true;
      }
      letGo();
      take({ loci, picked });
      const r = await api.run('stage.distance', {
        a: { loci: first.loci },
        b: { loci },
        node: first.picked.key,
        nodeB: picked.key,
      });
      // made, or measured already: its row picked; a failure or "already" said
      made(r, 'Distance');
      return true;
    },
  };
}
