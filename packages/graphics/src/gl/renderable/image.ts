/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Renderable, type RenderableState, createRenderable } from '../renderable.js';
import type { GraphicsContext } from '../context.js';
import type { Transparency } from '../render-item.js';
import {
  AttributeSpec,
  type Values,
  GlobalUniformSchema,
  InternalSchema,
  TextureSpec,
  ElementsSpec,
  DefineSpec,
  type InternalValues,
  BaseSchema,
  UniformSpec,
  GlobalTextureSchema,
  type GlobalDefineValues,
  type GlobalDefines,
  GlobalDefineSchema,
} from './schema.js';
import { ImageShaderCode } from '../shader-code.js';
import { ValueCell } from '@molstar/core/util/value-cell';

export const ImageSchema = {
  ...BaseSchema,

  aGroup: AttributeSpec('float32', 1, 0),
  aPosition: AttributeSpec('float32', 3, 0),
  aUv: AttributeSpec('float32', 2, 0),
  elements: ElementsSpec('uint32'),

  uImageTexDim: UniformSpec('v2'),
  tImageTex: TextureSpec('image-uint8', 'rgba', 'ubyte', 'nearest'),
  tGroupTex: TextureSpec('image-uint8', 'rgba', 'ubyte', 'nearest'),
  tValueTex: TextureSpec('image-float32', 'r', 'float', 'linear'),

  uTrimType: UniformSpec('i'),
  uTrimCenter: UniformSpec('v3'),
  uTrimRotation: UniformSpec('q'),
  uTrimScale: UniformSpec('v3'),
  uTrimTransform: UniformSpec('m4'),

  uIsoLevel: UniformSpec('f'),

  /**
   * A grid slice drawn from a window of its planes (`repr/volume/slice-window.ts`): the raw values of the planes in the
   * layers of `tSliceTex`, the one drawn `uSliceLayer`, its rows bottom-up (flipped by the shader to the image's);
   * colored by the value in the domain `uSliceDomain.zw` (the palette's, or `uColor` times it), cut at `uIsoLevel` by
   * the value in the grid's range `uSliceDomain.xy`. `tImageTex`, `tValueTex` unused, `uImageTexDim` the plane's size
   */
  dSliceWindow: DefineSpec('boolean'),
  tSliceTex: TextureSpec('texture', 'r', 'float', 'nearest', undefined, {
    dimension: '3d',
    usedIf: ['dSliceWindow'],
  }),
  uSliceLayer: UniformSpec('i'),
  uSliceDomain: UniformSpec('v4'),

  /** Same as `InterpolationTypeNames` in '../../mol-geo/geometry/image/image' */
  dInterpolation: DefineSpec('string', ['nearest', 'catmulrom', 'mitchell', 'bspline']),
};
export type ImageSchema = typeof ImageSchema;
export type ImageValues = Values<ImageSchema>;

/** The schema of the renderable: the object's with the global and internal ones (one object, shared by the items) */
export const ImageRenderableSchema = {
  ...GlobalUniformSchema,
  ...GlobalTextureSchema,
  ...GlobalDefineSchema,
  ...InternalSchema,
  ...ImageSchema,
};

export function ImageRenderable(
  ctx: GraphicsContext,
  id: number,
  values: ImageValues,
  state: RenderableState,
  materialId: number,
  transparency: Transparency,
  globals: GlobalDefines,
): Renderable<ImageValues> {
  const schema = ImageRenderableSchema;
  const renderValues: ImageValues & InternalValues & GlobalDefineValues = {
    ...values,
    uObjectId: ValueCell.create(id),
    dLightCount: ValueCell.create(globals.dLightCount),
    dColorMarker: ValueCell.create(globals.dColorMarker),
  };
  const shaderCode = ImageShaderCode;
  const renderItem = ctx.createGraphicsRenderItem(
    'triangles',
    shaderCode,
    schema,
    renderValues,
    materialId,
    transparency,
  );
  return createRenderable(renderItem, renderValues, state);
}
