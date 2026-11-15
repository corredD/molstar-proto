/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import type { StateObjectCell } from '@molstar/core/state';
import { StateTransform } from '@molstar/core/state';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Grid } from '@molstar/model/model/volume';
import { PluginStateObject } from '@molstar/plugin/state/objects';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import { StateSelection } from '@molstar/core/state';
import { describe, expect, it } from 'vitest';
import { cbs, headlessViewer } from '../../_test/harness.js';
import { mapFile } from '../../api/_test/volume-fixtures.js';
import { isStreamedForStructure, volumeTransformCell } from '../volume-transform.js';

// Which volumes move by themselves (`volume.transform`, the move handles): not density streamed for a structure, which
// hangs under it in the tree and moves with it.

/** A volume cell placed under `parent` (as streaming places its density under the structure) */
const under = (parent: string) => ({ transform: { parent } }) as unknown as StateObjectCell;

describe('isStreamedForStructure', () => {
  it('is a volume under a structure, not one loaded on its own', async () => {
    const v = await headlessViewer({ files: [cbs(), mapFile()] });
    const state = v.plugin.state.data;
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expect(isStreamedForStructure(state, under(structure))).toBe(true);
    expect(isStreamedForStructure(state, under(StateTransform.RootRef))).toBe(false);
    const own = v.plugin.managers.volume.hierarchy.current.volumes[0].cell;
    expect(isStreamedForStructure(state, own)).toBe(false);
  });

  it('leaves volume.transform moving a map loaded on its own', async () => {
    const v = await headlessViewer({ files: [mapFile()] });
    // the map loaded on its own moves
    expect((await v.api.volume.transform({ translation: Vec3.create(1, 0, 0) })).ok).toBe(true);
  });
});

// A volume with a pixel size set (the decorator's `scale`): its move and its reset change the move only.
describe('a volume with a scale', () => {
  const setup = async () => {
    const v = await headlessViewer({ files: [mapFile()] });
    const cell = v.plugin.managers.volume.hierarchy.current.volumes[0].cell;
    const ref = cell.transform.ref;
    const identity = { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } };
    await v.plugin.runTask(
      v.plugin.state.data.updateTree(
        v.plugin.state.data.build().to(cell).insert(VolumeTransform, { transform: identity, scale: 2 }),
      ),
    );
    const scaleOf = () => (volumeTransformCell(v.plugin.state.data, ref)!.transform.params as { scale?: number }).scale;
    const origin = () => {
      const cells = v.plugin.state.data.select(
        StateSelection.Generators.byRef(ref).subtree().ofType(PluginStateObject.Volume.Data),
      );
      const grid = (cells[cells.length - 1].obj!.data as { grid: Grid }).grid;
      return Vec3.transformMat4(Vec3(), Vec3.zero(), Grid.getGridToCartesianTransform(grid));
    };
    return { v, scaleOf, origin };
  };

  it('keeps its scale when moved, and when reset', async () => {
    const { v, scaleOf, origin } = await setup();
    const before = origin();
    expect((await v.api.volume.transform({ translation: Vec3.create(10, 0, 0) })).ok).toBe(true);
    expect(scaleOf()).toBe(2);
    expect(origin()[0]).toBeCloseTo(before[0] + 10, 4);
    expect((await v.api.volume.transformReset({})).ok).toBe(true);
    expect(scaleOf()).toBe(2);
    expect(origin()[0]).toBeCloseTo(before[0], 4);
    // reset again: the move is identity, the scale is not a move
    expect(((await v.api.volume.transformReset({})) as any).unchanged).toBe(true);
  });
});
