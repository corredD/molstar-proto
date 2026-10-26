/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { StateObjectCell } from '@molstar/core/state';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import type { Representation } from '@molstar/graphics/repr/representation';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject } from '@molstar/plugin/state/objects';
import { observableState, type ReadonlyState } from '@molstar/prism-ui/core';
import { currentTransform } from '../../api/structure.js';
import { GizmoHandles } from '../gizmos/handles.js';
import { type Placement, PlacementHandles } from '../gizmos/placement.js';

export { applyToPlacement, placementPose, poseMatrix } from '../gizmos/placement.js';

// A structure moved by hand (structure-move.md): the transform handles on a structure (`PlacementHandles`, on
// `GizmoHandles`), through its conformation transform (Mol*'s `TransformStructureConformation`, as
// `structure.transform` writes it). A drag's preview moves the structure's representations as drawn (their state
// transforms, on top of what they had): recomputing a structure a frame would not keep up; only the structure's own
// representations (what the transform moves: not a volume streamed under it). Its release is one `structure.transform`
// with the new matrix (`commit`); the representations' own transforms are put back once the state has the move.

/** A structure's placement: the transform on top of where it was loaded, and its center there */
export type StructurePlacement = Placement;

/** One `structure.transform` (the structure by ref, the matrix from where it was loaded); false: not taken */
export type MoveCommit = (structure: string, matrix: Mat4) => Promise<boolean>;

interface Drawn {
  readonly repr: Representation.Any;
  readonly transform: Mat4;
}

/** The structures that can be moved, and the handles on one of them (the target) while shown */
export class StructureMoveGizmos {
  readonly #target = observableState<string | undefined>(undefined);
  readonly #handles: GizmoHandles<StructurePlacement>;
  #commit: MoveCommit | undefined;
  /** The representations a drag moves, as they were drawn before it */
  #drawn: readonly Drawn[] | undefined;

  constructor(private readonly plugin: PluginContext) {
    this.#handles = new GizmoHandles(plugin, {
      ...PlacementHandles,
      items: () => this.#items(),
      begin: (key) => this.#begin(key),
      preview: async (_key, from, next) => {
        // what the drag adds, on top of where the state has it
        const delta = Mat4.mul(Mat4(), next.matrix, Mat4.invert(Mat4(), from.matrix));
        for (const d of this.#drawn ?? []) this.#draw(d.repr, Mat4.mul(Mat4(), delta, d.transform));
        this.plugin.canvas3d?.requestDraw();
      },
      commit: async (key, _from, next) => {
        // this drag's representations (no other drag starts until the commit is done)
        const drawn = this.#drawn;
        this.#drawn = undefined;
        try {
          return (await this.#commit?.(key, next.matrix)) ?? false;
        } finally {
          // the state has the move (or not): the representations as they were drawn before the drag
          this.#restore(drawn);
        }
      },
      cancel: () => {
        this.#restore(this.#drawn);
        this.#drawn = undefined;
      },
    });
  }

  /** The structure the handles are on (its ref) */
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

  /** The handles on the target; a drag's release commits through `commit`. Without a canvas (headless): false */
  show(commit: MoveCommit): boolean {
    this.#commit = commit;
    return this.#handles.show();
  }

  hide() {
    this.#handles.hide();
  }

  /** The target as an item: its placement now */
  #items(): GizmoItem<StructurePlacement>[] {
    const ref = this.#target.value;
    const s = ref
      ? this.plugin.managers.structure.hierarchy.current.structures.find((x) => x.cell.transform.ref === ref)
      : undefined;
    const data = s?.cell.obj?.data;
    if (!s || !data) return [];
    const sphere = data.boundary.sphere;
    const value: StructurePlacement = {
      matrix: currentTransform(s, data),
      center: Vec3.clone(sphere.center),
      radius: Math.max(sphere.radius, 1),
    };
    return [{ key: s.cell.transform.ref, value, label: s.cell.obj?.label ?? 'Structure' }];
  }

  #begin(key: string) {
    const drawn: Drawn[] = [];
    for (const cell of this.#cellsUnder(key)) {
      if (!PluginStateObject.Molecule.Structure.Representation3D.is(cell.obj)) continue;
      const repr = (cell.obj?.data as { repr?: Representation.Any } | undefined)?.repr;
      if (repr?.state?.transform) drawn.push({ repr, transform: Mat4.clone(repr.state.transform) });
    }
    this.#drawn = drawn;
  }

  #restore(drawn: readonly Drawn[] | undefined) {
    for (const d of drawn ?? []) this.#draw(d.repr, d.transform);
    this.plugin.canvas3d?.requestDraw();
  }

  #draw(repr: Representation.Any, transform: Mat4) {
    repr.setState({ transform });
    this.plugin.canvas3d?.update(repr);
  }

  /** The structure's cell and every cell under it (its transform, components, representations) */
  #cellsUnder(ref: string): StateObjectCell[] {
    const state = this.plugin.state.data;
    const out: StateObjectCell[] = [];
    const walk = (r: string) => {
      const cell = state.cells.get(r);
      if (cell) out.push(cell);
      // a ref gone (the structure removed under a drag) has no children
      const children = state.tree.children.get(r);
      if (children) for (const child of children.values()) walk(child);
    };
    walk(ref);
    return out;
  }
}
