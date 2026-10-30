/**
 * Copyright (c) 2019-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '@molstar/core/util/value-cell';
import { Vec2, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { type DataArray, createDataArray } from '@molstar/graphics/gl/renderable/util';
import { createNullTexture, type Texture } from '@molstar/graphics/gl/texture';
import { getLayerTypeDefine, type LayerType } from './layer-type.js';

export type TransparencyType = LayerType;

export type TransparencyData = {
  tTransparency: ValueCell<DataArray<Uint8Array>>;
  dTransparency: ValueCell<boolean>;
  transparencyAverage: ValueCell<number>;
  transparencyMin: ValueCell<number>;

  tTransparencyGrid: ValueCell<Texture>;
  uTransparencyGridDim: ValueCell<Vec3>;
  uTransparencyGridTexDim: ValueCell<Vec2>;
  uTransparencyGridTransform: ValueCell<Vec4>;
  /** the layer type (`TransparencyType`) */
  transparencyType: ValueCell<string>;
  /** its define (`getLayerTypeDefine`) */
  dTransparencyType: ValueCell<string>;
  uTransparencyStrength: ValueCell<number>;
};

export function applyTransparencyValue(array: Uint8Array, start: number, end: number, value: number) {
  for (let i = start; i < end; ++i) {
    array[i] = value * 255;
  }
  return true;
}

/** Transparency of a hidden instance (a layer's value 1) */
const Hidden = 255;

/**
 * The average transparency of the instances still shown: a hidden instance is not counted, so an object most of
 * whose instances are hidden is not drawn as a transparent one (a second pass); 1 when all are hidden. `hidden` false
 * counts them as any value (where 255 is not hidden: per group, or a theme strength below 1)
 */
export function getTransparencyAverage(array: Uint8Array, count: number, hidden = true): number {
  if (count === 0 || array.length < count) return 0;
  let sum = 0;
  let shown = 0;
  for (let i = 0; i < count; ++i) {
    if (hidden && array[i] === Hidden) continue;
    sum += array[i];
    shown += 1;
  }
  if (shown === 0) return count > 0 ? 1 : 0;
  const average = sum / (255 * shown);
  // 1 means every instance is hidden (and the object is drawn by no pass): not so where 255 is not hidden
  return hidden ? average : Math.min(average, 254 / 255);
}

/** exclude fully opaque parts (and hidden instances, at the top of the range); 1 when none is left */
export function getTransparencyMin(array: Uint8Array, count: number): number {
  if (count === 0 || array.length < count) return 1;
  let min = 255;
  for (let i = 0; i < count; ++i) {
    if (array[i] > 0 && array[i] < min) min = array[i];
  }
  return min / 255;
}

export function clearTransparency(array: Uint8Array, start: number, end: number) {
  array.fill(0, start, end);
}

/** Sets the layer type `type` and its define (`getLayerTypeDefine`) of `values` */
export function setTransparencyType(
  values: Pick<TransparencyData, 'transparencyType' | 'dTransparencyType'>,
  type: TransparencyType | string,
) {
  ValueCell.updateIfChanged(values.transparencyType, type);
  ValueCell.updateIfChanged(values.dTransparencyType, getLayerTypeDefine(type));
}

export function createTransparency(
  count: number,
  type: TransparencyType,
  transparencyData?: TransparencyData,
): TransparencyData {
  const transparency = createDataArray(
    Math.max(1, count),
    1,
    Uint8Array,
    transparencyData && transparencyData.tTransparency.ref.value.array,
  );
  if (transparencyData) {
    ValueCell.update(transparencyData.tTransparency, transparency);
    ValueCell.updateIfChanged(transparencyData.dTransparency, count > 0);
    ValueCell.updateIfChanged(transparencyData.transparencyAverage, getTransparencyAverage(transparency.array, count));
    ValueCell.updateIfChanged(transparencyData.transparencyMin, getTransparencyMin(transparency.array, count));
    setTransparencyType(transparencyData, type);
    return transparencyData;
  } else {
    return {
      tTransparency: ValueCell.create(transparency),
      dTransparency: ValueCell.create(count > 0),
      transparencyAverage: ValueCell.create(0),
      transparencyMin: ValueCell.create(1),

      tTransparencyGrid: ValueCell.create(createNullTexture()),
      uTransparencyGridDim: ValueCell.create(Vec3.create(1, 1, 1)),
      uTransparencyGridTexDim: ValueCell.create(Vec2.create(1, 1)),
      uTransparencyGridTransform: ValueCell.create(Vec4.create(0, 0, 0, 1)),
      transparencyType: ValueCell.create<string>(type),
      dTransparencyType: ValueCell.create(getLayerTypeDefine(type)),
      uTransparencyStrength: ValueCell.create(1),
    };
  }
}

/** A new one each time: the layer's data reuses its array (`createDataArray`), which no two visuals may share */
const emptyTransparencyTexture = () => ({ array: new Uint8Array(4), count: 1 });
export function createEmptyTransparency(transparencyData?: TransparencyData): TransparencyData {
  if (transparencyData) {
    ValueCell.update(transparencyData.tTransparency, emptyTransparencyTexture());
    return transparencyData;
  } else {
    return {
      tTransparency: ValueCell.create(emptyTransparencyTexture()),
      dTransparency: ValueCell.create(false),
      transparencyAverage: ValueCell.create(0),
      transparencyMin: ValueCell.create(1),

      tTransparencyGrid: ValueCell.create(createNullTexture()),
      uTransparencyGridDim: ValueCell.create(Vec3.create(1, 1, 1)),
      uTransparencyGridTexDim: ValueCell.create(Vec2.create(1, 1)),
      uTransparencyGridTransform: ValueCell.create(Vec4.create(0, 0, 0, 1)),
      transparencyType: ValueCell.create<string>('groupInstance'),
      dTransparencyType: ValueCell.create(getLayerTypeDefine('groupInstance')),
      uTransparencyStrength: ValueCell.create(1),
    };
  }
}
