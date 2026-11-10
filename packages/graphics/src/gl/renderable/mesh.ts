/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Gianluca Tomasello <giagitom@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Renderable, type RenderableState, createRenderable } from '../renderable.js';
import type { GraphicsContext } from '../context.js';
import type { Transparency } from '../render-item.js';
import {
  GlobalUniformSchema,
  BaseSchema,
  AttributeSpec,
  ElementsSpec,
  DefineSpec,
  type Values,
  InternalSchema,
  type InternalValues,
  GlobalTextureSchema,
  ValueSpec,
  UniformSpec,
  GlobalDefineSchema,
  type GlobalDefineValues,
  type GlobalDefines,
  InteriorSchema,
  AnimationSchema,
  ColorLevelsSchema,
  TextureSpec,
} from './schema.js';
import { MeshShaderCode } from '../shader-code.js';
import { ValueCell } from '@molstar/core/util';

export const MeshSchema = {
  ...BaseSchema,
  ...ColorLevelsSchema,
  aGroup: AttributeSpec('float32', 1, 0),
  aPosition: AttributeSpec('float32', 3, 0),
  /** unit normals, three floats on the CPU, octahedral in two snorm16 on the GPU (`oct-normals.ts`) */
  aNormal: AttributeSpec('oct16', 2, 0),
  elements: ElementsSpec('uint32'),
  dVaryingGroup: DefineSpec('boolean'),
  dFlatShaded: DefineSpec('boolean'),
  uDoubleSided: UniformSpec('b', 'material'),
  dFlipSided: DefineSpec('boolean'),
  dIgnoreLight: DefineSpec('boolean'),
  dCelShaded: DefineSpec('boolean'),
  dXrayShaded: DefineSpec('string', ['off', 'on', 'inverted']),
  dTransparentBackfaces: DefineSpec('string', ['off', 'on', 'opaque']),
  dSolidInterior: DefineSpec('boolean'),
  /** whether the bump noise is compiled (`BaseGeometry.hasBump`; with a substance layer, `dSubstance`, too) */
  dBump: DefineSpec('boolean'),
  uBumpFrequency: UniformSpec('f', 'material'),
  uBumpAmplitude: UniformSpec('f', 'material'),
  /**
   * A periodic patch mapped by planes and cells (lipid membranes' far look, WebGPU only): a fragment's group its plane
   * (a region), its point in the plane's patch coordinates, its cell's spin and offset by a hash of (plane, cell), then
   * `tPatch` (mipmapped, repeat) at that point; see `mesh.wgsl.ts`, `patchColor`
   */
  dPatchTexture: DefineSpec('boolean'),
  tPatch: TextureSpec('texture', 'rgba', 'ubyte', 'linear', undefined, { usedIf: ['dPatchTexture'] }),
  /**
   * per plane 4 texels (origin and offset x, e1 and offset y, e2 and cos, its key in the cells' hash, unused twice, and
   * sin), then the 4,096 cells' (offset, cos, sin), then per vertex its shift in its plane's coordinates, two vertices a
   * texel (xy, zw)
   */
  tPatchTable: TextureSpec('texture', 'rgba', 'float', 'nearest', undefined, { usedIf: ['dPatchTexture'] }),
  /** the cell's side, the patch's box x and y, the cells' first texel */
  uPatch: UniformSpec('v4'),
  /** the far color's blend: on (1) or off (0), the patch's px where the patch starts and is whole, a texel's Å */
  uPatchLevels: UniformSpec('v4'),
  /**
   * The middle distance's look (round 8): off (the patch flat), `shells` (a band's stack, an instance a shell, each
   * kept where `tPatch`'s alpha, the heads' height, reaches it), `beneath` (a surface under a shell band: discarded
   * where the band draws), `parallax` (the view ray marched through the heights)
   */
  dPatchMiddle: DefineSpec('string', ['off', 'shells', 'beneath', 'parallax']),
  /** the shells' count, the heads' lo and hi (`tPatch`'s alpha 0 and 1) and the surface's height, Å out of the leaflet */
  uPatchShells: UniformSpec('v4'),
  /** the lipid's px where the middle look starts and ends (shells drawn, `beneath` discarded, parallax marched) */
  uPatchMiddle: UniformSpec('v4'),
  /** Å toward the camera, in depth only (`Mesh.Params.depthOffset`) */
  uDepthOffset: UniformSpec('f'),
  /**
   * CSS pixels per unit of the mesh, constant on screen: the vertex stage scales it about the instance's origin by the
   * world size of a pixel there (the instance's own scale multiplies); 0: world units
   */
  uScreenSize: UniformSpec('f'),
  meta: ValueSpec('unknown'),

  ...InteriorSchema,
  ...AnimationSchema,
} as const;
export type MeshSchema = typeof MeshSchema;
export type MeshValues = Values<MeshSchema>;

/** The schema of the renderable: the object's with the global and internal ones (one object, shared by the items) */
export const MeshRenderableSchema = {
  ...GlobalUniformSchema,
  ...GlobalTextureSchema,
  ...GlobalDefineSchema,
  ...InternalSchema,
  ...MeshSchema,
};

export function MeshRenderable(
  ctx: GraphicsContext,
  id: number,
  values: MeshValues,
  state: RenderableState,
  materialId: number,
  transparency: Transparency,
  globals: GlobalDefines,
): Renderable<MeshValues> {
  const schema = MeshRenderableSchema;
  const renderValues: MeshValues & InternalValues & GlobalDefineValues = {
    ...values,
    uObjectId: ValueCell.create(id),
    dLightCount: ValueCell.create(globals.dLightCount),
    dColorMarker: ValueCell.create(globals.dColorMarker),
  };
  const shaderCode = MeshShaderCode;
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
