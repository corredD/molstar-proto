/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '@molstar/core/util';
import { Sphere3D } from '@molstar/core/math/geometry';
import { hashFnv32a } from '@molstar/core/data/util';
import {
  type DataArray,
  calculateInvariantBoundingSphere,
  createDataArray,
} from '@molstar/graphics/gl/renderable/util';
import { createGroupMapping, type GroupMapping } from '../util.js';

/**
 * Center (xyz) and group per item, shared by the geometries drawn as one quad of 6 vertices per item
 * (spheres, points): the buffers, the derived bounding sphere and group mapping, and the
 * `tPositionGroup` data the shaders read the item data from (vertex pulling)
 */
export interface CenterGroupData {
  readonly centerBuffer: ValueCell<Float32Array>;
  readonly groupBuffer: ValueCell<Float32Array>;
  /** center xyz and group per item, ordered by level of detail when strides are given */
  readonly positionGroup: ValueCell<DataArray<Float32Array>>;

  getBoundingSphere(): Sphere3D;
  getGroupMapping(): GroupMapping;
  setBoundingSphere(boundingSphere: Sphere3D): void;
  hasBoundingSphere(): boolean;
  /**
   * Writes the items to `positionGroup`; with `strides`, items are reordered into levels of detail
   * (items of a coarser level first) and the vertex offsets of the levels are returned
   */
  updatePositionGroup(strides?: number[]): number[] | undefined;
}

export function createCenterGroupData(
  centers: Float32Array,
  groups: Float32Array,
  getCount: () => number,
): CenterGroupData {
  const centerBuffer = ValueCell.create(centers);
  const groupBuffer = ValueCell.create(groups);
  const positionGroup = ValueCell.create(createDataArray(1, 4, Float32Array));

  const boundingSphere = Sphere3D();
  let groupMapping: GroupMapping;
  let currentHash = -1;
  let currentGroup = -1;

  const hashCode = () => hashFnv32a([getCount(), centerBuffer.ref.version, groupBuffer.ref.version]);

  return {
    centerBuffer,
    groupBuffer,
    positionGroup,
    getBoundingSphere() {
      const newHash = hashCode();
      if (newHash !== currentHash) {
        const b = calculateInvariantBoundingSphere(centerBuffer.ref.value, getCount(), 1);
        Sphere3D.copy(boundingSphere, b);
        currentHash = newHash;
      }
      return boundingSphere;
    },
    getGroupMapping() {
      if (groupBuffer.ref.version !== currentGroup) {
        groupMapping = createGroupMapping(groupBuffer.ref.value, getCount());
        currentGroup = groupBuffer.ref.version;
      }
      return groupMapping;
    },
    setBoundingSphere(sphere: Sphere3D) {
      Sphere3D.copy(boundingSphere, sphere);
      currentHash = hashCode();
    },
    hasBoundingSphere() {
      return currentHash === hashCode();
    },
    updatePositionGroup(strides: number[] = []) {
      const count = getCount();
      const pgt = createDataArray(count, 4, Float32Array, positionGroup.ref.value.array);
      const offsets = setPositionGroup(pgt, centerBuffer.ref.value, groupBuffer.ref.value, count, strides);
      ValueCell.update(positionGroup, pgt);
      return offsets;
    },
  };
}

/** spreads the low 10 bits of `x` to every third bit */
function spreadBits(x: number) {
  x &= 0x3ff;
  x = (x | (x << 16)) & 0x30000ff;
  x = (x | (x << 8)) & 0x300f00f;
  x = (x | (x << 4)) & 0x30c30c3;
  x = (x | (x << 2)) & 0x9249249;
  return x;
}

/** sorts item indices `items` by the Morton code of their centers (10 bits an axis over the items' box) */
function sortBySpace(items: number[], centers: Float32Array) {
  const n = items.length;
  if (n < 2) return;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const j of items) {
    for (let k = 0; k < 3; ++k) {
      const v = centers[j * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const scale = [0, 1, 2].map((k) => (max[k] > min[k] ? 1023 / (max[k] - min[k]) : 0));
  const keys = new Float64Array(n);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; ++i) {
    const j = items[i];
    const q = (k: number) => Math.floor((centers[j * 3 + k] - min[k]) * scale[k]);
    keys[i] = (spreadBits(q(0)) | (spreadBits(q(1)) << 1) | (spreadBits(q(2)) << 2)) >>> 0;
    order[i] = i;
  }
  order.sort((a, b) => keys[a] - keys[b] || a - b);
  const sorted = Array.from(order, (i) => items[i]);
  for (let i = 0; i < n; ++i) items[i] = sorted[i];
}

/**
 * Writes center and group per item to `out`; returns the vertex offsets (6 per item) of the levels
 * of detail when `strides` are given
 */
export function setPositionGroup(
  out: DataArray<Float32Array>,
  centers: Float32Array,
  groups: Float32Array,
  count: number,
  strides: number[],
) {
  const { array } = out;
  if (strides.length === 0) {
    for (let i = 0; i < count; ++i) {
      array[i * 4 + 0] = centers[i * 3 + 0];
      array[i * 4 + 1] = centers[i * 3 + 1];
      array[i * 4 + 2] = centers[i * 3 + 2];
      array[i * 4 + 3] = groups[i];
    }
    return;
  }

  const offsets = [0];

  // per level the items it adds (those of its stride not in a coarser one), in space order (Morton): items near in the
  // list are near in space, so that consecutive ranges make compact clusters (the GPU culling's, `merged-culler.ts`); a level
  // draws the same items in any order
  const items: number[] = [];
  let o = 0;
  for (let i = 0, il = strides.length; i < il; ++i) {
    const s = strides[i];
    items.length = 0;
    for (let j = 0; j < count; ++j) {
      let handled = false;
      for (let k = 0; k < i; ++k) {
        if (j % strides[k] === 0) {
          handled = true;
          break;
        }
      }
      if (!handled && j % s === 0) items.push(j);
    }
    sortBySpace(items, centers);
    for (const j of items) {
      array[o * 4 + 0] = centers[j * 3 + 0];
      array[o * 4 + 1] = centers[j * 3 + 1];
      array[o * 4 + 2] = centers[j * 3 + 2];
      array[o * 4 + 3] = groups[j];
      o += 1;
    }
    offsets.push(o * 6);
  }

  return offsets;
}
