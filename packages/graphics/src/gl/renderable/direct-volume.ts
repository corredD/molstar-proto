/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
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
  UniformSpec,
  GlobalUniformSchema,
  InternalSchema,
  TextureSpec,
  ElementsSpec,
  DefineSpec,
  type InternalValues,
  GlobalTextureSchema,
  BaseSchema,
  ValueSpec,
  type GlobalDefineValues,
  type GlobalDefines,
  GlobalDefineSchema,
} from './schema.js';
import { DirectVolumeShaderCode } from '../shader-code.js';
import { ValueCell } from '@molstar/core/util';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Clip } from '@molstar/core/util/clip';
import { ClipStorageVec4s, getPixelClipCount, packStorageClipObjects } from '../clip-storage.js';
import type { ComputeContext } from '../compute.js';
import {
  createExtinctionPyramid,
  type ExtinctionPyramid,
  isVolumeLightingSupported,
} from '../compute/volume-lighting.js';
import { createNullTexture, type Texture } from '../texture.js';

export const DirectVolumeSchema = {
  ...BaseSchema,

  aPosition: AttributeSpec('float32', 3, 0),
  elements: ElementsSpec('uint32'),

  uBboxMin: UniformSpec('v3'),
  uBboxMax: UniformSpec('v3'),
  uBboxSize: UniformSpec('v3'),
  uMaxSteps: { ...UniformSpec('i'), loopBound: true },
  uStepScale: UniformSpec('f'),
  uJumpLength: UniformSpec('f'),
  uTransform: UniformSpec('m4'),
  uGridDim: UniformSpec('v3'),
  tTransferTex: TextureSpec('image-uint8', 'r', 'ubyte', 'linear'),
  /** the transfer function's opacity between two values (`preIntegration`, `createPreIntegratedTransferTexture`) */
  tPreIntegratedTex: TextureSpec('image-uint8', 'r', 'ubyte', 'linear', undefined, { usedIf: ['dPreIntegration'] }),
  dPreIntegration: DefineSpec('boolean'),
  uTransferScale: UniformSpec('f', 'material'),
  /** the opacity at which the marking and pick variants put the volume's surface */
  uSurfaceOpacity: UniformSpec('f'),
  /** the grid's bricks (`BrickRange`), their visibility under the transfer function per brick and the bricks per axis */
  brickRange: ValueSpec('unknown'),
  tBrickTex: TextureSpec('image-uint8', 'r', 'ubyte', 'nearest'),
  uBrickTexDim: UniformSpec('v2'),
  uBrickDim: UniformSpec('v3'),

  dGridTexType: DefineSpec('string', ['2d', '3d']),
  uGridTexDim: UniformSpec('v3'),
  tGridTex: TextureSpec('texture', 'rgba', 'ubyte', 'linear', undefined, { dimension: { define: 'dGridTexType' } }),

  uCellDim: UniformSpec('v3'),
  uCartnToUnit: UniformSpec('m4'),
  uUnitToCartn: UniformSpec('m4'),
  dPackedGroup: DefineSpec('boolean'),
  dAxisOrder: DefineSpec('string', ['012', '021', '102', '120', '201', '210']),

  dIgnoreLight: DefineSpec('boolean'),
  /**
   * `lighting`: `local`, the gradient as the normal; `volumetric`, the extinction pyramid's transmittance and occlusion;
   * `neural`, a network's in-scatter from the same descriptors (`volume-lighting.md`, WebGPU with
   * `isVolumeLightingSupported`: the renderable draws `local` elsewhere)
   */
  dLighting: DefineSpec('string', ['local', 'volumetric', 'neural']),
  dCelShaded: DefineSpec('boolean'),
  dXrayShaded: DefineSpec('string', ['off', 'on', 'inverted']),

  meta: ValueSpec('unknown'),
};
export type DirectVolumeSchema = typeof DirectVolumeSchema;
export type DirectVolumeValues = Values<DirectVolumeSchema>;

/** What the renderable adds for `dLighting`: the extinction pyramid it builds (`createExtinctionPyramid`) */
export const DirectVolumeLightingSchema = {
  tExtinction: TextureSpec('texture', 'r', 'fp16', 'linear', undefined, {
    dimension: '3d',
    usedIf: ['dLighting_volumetric', 'dLighting_neural'],
  }),
};

/** The schema of the renderable: the object's with the global and internal ones (one object, shared by the items) */
export const DirectVolumeRenderableSchema = {
  ...GlobalUniformSchema,
  ...GlobalTextureSchema,
  ...GlobalDefineSchema,
  ...InternalSchema,
  ...DirectVolumeSchema,
  ...DirectVolumeLightingSchema,
};

/**
 * The renderable's `dLighting` (the values' where supported, else `local`) and its extinction pyramid, built where
 * `volumetric` or `neural` is drawn and rebuilt when its inputs change (`volume-lighting.md` §A1)
 */
function createVolumeLighting(ctx: GraphicsContext, values: DirectVolumeValues) {
  const supported = isVolumeLightingSupported(ctx);
  const dLighting = ValueCell.create(getLighting());
  const nullTexture = createNullTexture();
  const tExtinction = ValueCell.create<Texture>(nullTexture);
  let pyramid: ExtinctionPyramid | undefined;
  /** the inputs of the last build */
  const transfer = new Uint8Array(256);
  let gridTextureVersion = -1;
  let gridDimVersion = -1;
  let alpha = -1;
  let packedGroup = false;
  /** the clip of the last build (`ExtinctionInput.clip`) and the clip of the values, read by `readClip` */
  const clip = { count: 0, objects: new Float32Array(Clip.MaxObjectCount * ClipStorageVec4s * 4), cellToModel: Mat4() };
  const next = { count: 0, objects: new Float32Array(clip.objects.length), cellToModel: Mat4() };

  /**
   * Reads the clip of the values into `next`, whether it differs from the last build's: the march clips its samples
   * only per pixel (`dClipVariant_pixel`), the pyramid the cells of the first instance (as the trace reads it), in
   * model space without the scene's view and scale (`uModel` taken as the identity)
   */
  function readClip() {
    next.count = getPixelClipCount(values);
    if (next.count === 0) return clip.count !== 0;
    packStorageClipObjects(values, next.objects);
    const instance = Mat4.fromArray(next.cellToModel, values.aTransform.ref.value, 0);
    Mat4.mul(next.cellToModel, instance, values.uTransform.ref.value);
    if (next.count !== clip.count || !Mat4.areEqual(next.cellToModel, clip.cellToModel, 0)) return true;
    for (let i = 0, il = next.count * ClipStorageVec4s * 4; i < il; ++i) {
      if (next.objects[i] !== clip.objects[i]) return true;
    }
    return false;
  }

  function getLighting() {
    const lighting = values.dLighting.ref.value;
    return supported && values.dGridTexType.ref.value === '3d' ? lighting : 'local';
  }

  function update() {
    const lighting = getLighting();
    if (lighting !== 'local') {
      if (!pyramid) {
        pyramid = createExtinctionPyramid(ctx as GraphicsContext & { compute: ComputeContext });
        gridTextureVersion = -1;
      }
      const tf = values.tTransferTex.ref.value.array;
      const clipChanged = readClip();
      const changed =
        gridTextureVersion !== values.tGridTex.ref.version ||
        gridDimVersion !== values.uGridDim.ref.version ||
        alpha !== values.uAlpha.ref.value ||
        packedGroup !== values.dPackedGroup.ref.value ||
        tf.some((v, i) => v !== transfer[i]) ||
        clipChanged;
      if (changed) {
        transfer.set(tf);
        gridTextureVersion = values.tGridTex.ref.version;
        gridDimVersion = values.uGridDim.ref.version;
        alpha = values.uAlpha.ref.value;
        packedGroup = values.dPackedGroup.ref.value;
        clip.count = next.count;
        clip.objects.set(next.objects);
        Mat4.copy(clip.cellToModel, next.cellToModel);
        pyramid.build({
          gridTexture: values.tGridTex.ref.value,
          gridDim: values.uGridDim.ref.value,
          transfer,
          alpha,
          packedGroup,
          clip,
        });
      }
      if (tExtinction.ref.value !== pyramid.texture) ValueCell.update(tExtinction, pyramid.texture);
    } else if (pyramid) {
      ValueCell.update(tExtinction, nullTexture);
      pyramid.destroy();
      pyramid = undefined;
    }
    ValueCell.updateIfChanged(dLighting, lighting);
  }
  update();

  return {
    dLighting,
    tExtinction,
    update,
    getByteCount: () => pyramid?.getByteCount() ?? 0,
    dispose: () => {
      pyramid?.destroy();
      pyramid = undefined;
    },
  };
}

export function DirectVolumeRenderable(
  ctx: GraphicsContext,
  id: number,
  values: DirectVolumeValues,
  state: RenderableState,
  materialId: number,
  transparency: Transparency,
  globals: GlobalDefines,
): Renderable<DirectVolumeValues> {
  const schema = DirectVolumeRenderableSchema;
  const lighting = createVolumeLighting(ctx, values);
  const renderValues: DirectVolumeValues &
    Values<typeof DirectVolumeLightingSchema> &
    InternalValues &
    GlobalDefineValues = {
    ...values,
    dLighting: lighting.dLighting,
    tExtinction: lighting.tExtinction,
    uObjectId: ValueCell.create(id),
    dLightCount: ValueCell.create(globals.dLightCount),
    dColorMarker: ValueCell.create(globals.dColorMarker),
  };
  const shaderCode = DirectVolumeShaderCode;
  const renderItem = ctx.createGraphicsRenderItem(
    'triangles',
    shaderCode,
    schema,
    renderValues,
    materialId,
    transparency,
  );
  const renderable = createRenderable(renderItem, renderValues, state);
  const { update, getByteCount, dispose } = renderable;
  return Object.assign(renderable, {
    update: () => {
      lighting.update();
      update();
    },
    getByteCount: () => getByteCount() + lighting.getByteCount(),
    dispose: () => {
      lighting.dispose();
      dispose();
    },
  });
}
