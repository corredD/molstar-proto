/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '@molstar/core/util/value-cell';
import { type DataArray, createDataArray } from '@molstar/graphics/gl/renderable/util';
import { Clipping } from '@molstar/graphics/theme/clipping';

export type ClippingType = 'instance' | 'groupInstance';

export type ClippingData = {
  tClipping: ValueCell<DataArray<Uint8Array>>;
  dClipping: ValueCell<boolean>;
  /** the type (`ClippingType`); the object uniform `uInstanceGranularity` selects the index */
  clippingType: ValueCell<string>;
  /** the clipping table (`Clipping.tableData`), with `dClipTable` */
  tClipTable: ValueCell<DataArray<Float32Array>>;
  dClipTable: ValueCell<boolean>;
};

/** Each table encoded once, however many visuals it is set on (a representation's target visuals share one) */
const encoded = new WeakMap<Clipping.Table, Float32Array>();

const emptyClipTable = () => ({ array: new Float32Array(4), count: 1 });

/**
 * Sets the clipping table of `data` (`Clipping.table`): its cells uploaded only when they changed, so a row of the
 * table (the same instances cut every frame) is not touched by a clip object's move. Whether it changed.
 */
export function setClippingTable(data: ClippingData, table: Clipping.Table | undefined): boolean {
  ValueCell.updateIfChanged(data.dClipTable, !!table);
  if (!table) return false;
  const current = data.tClipTable.ref.value;
  let array = encoded.get(table);
  if (!array) encoded.set(table, (array = Clipping.tableData(table)));
  const count = Math.max(1, table.length * Clipping.TableWidth);
  if (current.count === count && current.array.length >= array.length) {
    let same = true;
    for (let i = 0; i < array.length && same; ++i) same = current.array[i] === array[i];
    if (same) return false;
  }
  ValueCell.update(data.tClipTable, createDataArray(count, 4, Float32Array, current.array));
  data.tClipTable.ref.value.array.set(array);
  return true;
}

export function applyClippingGroups(array: Uint8Array, start: number, end: number, groups: Clipping.Groups) {
  array.fill(groups, start, end);
  return true;
}

export function clearClipping(array: Uint8Array, start: number, end: number) {
  array.fill(0, start, end);
}

export function createClipping(count: number, type: ClippingType, clippingData?: ClippingData): ClippingData {
  const clipping = createDataArray(
    Math.max(1, count),
    1,
    Uint8Array,
    clippingData && clippingData.tClipping.ref.value.array,
  );
  if (clippingData) {
    ValueCell.update(clippingData.tClipping, clipping);
    ValueCell.updateIfChanged(clippingData.dClipping, count > 0);
    ValueCell.updateIfChanged(clippingData.clippingType, type);
    return clippingData;
  } else {
    return {
      tClipping: ValueCell.create(clipping),
      dClipping: ValueCell.create(count > 0),
      clippingType: ValueCell.create<string>(type),
      tClipTable: ValueCell.create(emptyClipTable()),
      dClipTable: ValueCell.create(false),
    };
  }
}

/** A new one each time: the layer's data reuses its array (`createDataArray`), which no two visuals may share */
const emptyClippingTexture = () => ({ array: new Uint8Array(4), count: 1 });
export function createEmptyClipping(clippingData?: ClippingData): ClippingData {
  if (clippingData) {
    ValueCell.update(clippingData.tClipping, emptyClippingTexture());
    ValueCell.updateIfChanged(clippingData.dClipping, false);
    ValueCell.updateIfChanged(clippingData.dClipTable, false);
    return clippingData;
  } else {
    return {
      tClipping: ValueCell.create(emptyClippingTexture()),
      dClipping: ValueCell.create(false),
      clippingType: ValueCell.create<string>('groupInstance'),
      tClipTable: ValueCell.create(emptyClipTable()),
      dClipTable: ValueCell.create(false),
    };
  }
}
