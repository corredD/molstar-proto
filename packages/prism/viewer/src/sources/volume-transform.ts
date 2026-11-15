/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { type State, type StateObjectCell, StateSelection, StateTransform } from '@molstar/core/state';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { PluginStateObject } from '@molstar/plugin/state/objects';
import { getTransformFromParams, type TransformParam } from '@molstar/plugin/state/transforms/helpers';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';

// A volume moved by hand (Mol*'s `VolumeTransform`, a decorator on the volume, as a structure's conformation
// transform): its decorator and the matrix it applies, from where the volume was loaded.

/**
 * Whether a volume's `cell` is under a structure or a model: density streamed for it, which moves with it (its
 * transform), not by itself
 */
export function isStreamedForStructure(state: State, cell: StateObjectCell): boolean {
  for (let ref = cell.transform.parent; ref !== StateTransform.RootRef; ) {
    const c = state.cells.get(ref);
    if (!c) return false;
    if (PluginStateObject.Molecule.Structure.is(c.obj) || PluginStateObject.Molecule.Model.is(c.obj)) return true;
    if (c.transform.parent === ref) return false;
    ref = c.transform.parent;
  }
  return false;
}

/** A volume's transform decorator (`VolumeTransform` below it), if any */
export function volumeTransformCell(state: State, volumeRef: string): StateObjectCell | undefined {
  return state.select(StateSelection.Generators.byRef(volumeRef).subtree().withTransformer(VolumeTransform))[0];
}

/** A volume's pixel size over the file's (the decorator's `scale`; 1 without one, or in a session before it) */
export function volumeScaleOf(state: State, volumeRef: string): number {
  return (volumeTransformCell(state, volumeRef)?.transform.params as { scale?: number } | undefined)?.scale ?? 1;
}

/** A volume's center as loaded: what its decorator turns about (times `scale`: the grid is scaled first) */
export function volumeCenter(data: Volume, scale = 1): Vec3 {
  return Vec3.scale(Vec3(), Grid.getBoundingSphere(data.grid).center, scale);
}

/** The matrix of a transform param, turning about the volume's own (scaled) center where it says so (as the decorator) */
export function volumeMatrixOf(t: TransformParam, data: Volume, scale = 1): Mat4 {
  return getTransformFromParams(t, volumeCenter(data, scale));
}

/**
 * A volume's move now (identity without one), its scale apart: the move is in Å of the scene, applied after the scale;
 * `data` is the volume as loaded (the hierarchy's, before it)
 */
export function currentVolumeTransform(state: State, volumeRef: string, data: Volume): Mat4 {
  const t = volumeTransformCell(state, volumeRef)?.transform.params?.transform as TransformParam | undefined;
  return t ? volumeMatrixOf(t, data, volumeScaleOf(state, volumeRef)) : Mat4.identity();
}
