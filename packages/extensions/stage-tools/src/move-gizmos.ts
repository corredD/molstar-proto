/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '@molstar/core/math/linear-algebra';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { GizmoHandles, PlacementHandles } from '@molstar/prism-viewer/sources/gizmos';
import type { ObjectPlacement, StageApi } from './operations.js';

// An object moved by hand (apps/prism-me/_spec/ui.md, Prism first): Prism's handles (`GizmoHandles`, its transform
// handles on a placement: `PlacementHandles`) on a particle list, a volume or a mesh, as Prism's structure move has them
// on a structure: a rigid move about the object's center, its own transform (a mesh's scale) kept under the turn. A
// drag's preview moves the object as drawn (`previewMove`), its release is one `stage.move` (the move beyond where it
// was).

/** The move from one placement to another (what `stage.move` applies, after where it is) */
export function moveBetween(from: ObjectPlacement, next: ObjectPlacement): Mat4 {
  return Mat4.mul(Mat4(), next.matrix, Mat4.invert(Mat4(), from.matrix));
}

/** The handles on an object (a particle list, a volume, a mesh) while shown */
export class ObjectMoveGizmos {
  readonly #target = observableState<string | undefined>(undefined);
  readonly #handles: GizmoHandles<ObjectPlacement>;

  constructor(plugin: PluginContext, area: StageApi) {
    this.#handles = new GizmoHandles(plugin, {
      ...PlacementHandles,
      items: () => {
        const ref = this.#target.value;
        const value = ref ? area.placementOf(ref) : undefined;
        const label = ref ? (plugin.state.data.cells.get(ref)?.obj?.label ?? 'Object') : '';
        return ref && value ? [{ key: ref, value, label }] : [];
      },
      // what a drag starts from: the object and what is under it; a mesh's placement is its shape's, above it
      cells: (key) => {
        const cell = plugin.state.data.cells.get(key);
        return cell && SO.Shape.Representation3D.is(cell.obj) ? [cell.transform.parent] : [key];
      },
      preview: async (key, from, next) => area.previewMove(key, moveBetween(from, next)),
      commit: async (key, from, next) => {
        try {
          return (await area.move({ target: key, matrix: Array.from(moveBetween(from, next)) } as never)).ok;
        } finally {
          // drawn as the state has it now (moved, or not)
          area.previewMove(key, Mat4.identity());
        }
      },
      cancel: (key) => area.previewMove(key, Mat4.identity()),
    });
  }

  /** The object the handles are on (its ref) */
  get target(): ReadonlyState<string | undefined> {
    return this.#target.asReadonly;
  }

  get shown(): ReadonlyState<boolean> {
    return this.#handles.shown;
  }

  setTarget(ref: string | undefined) {
    this.#target.set(ref);
    this.#handles.publish();
  }

  /** The handles on the target; without a canvas (headless): false */
  show(): boolean {
    return this.#handles.show();
  }

  hide() {
    this.#handles.hide();
  }
}
