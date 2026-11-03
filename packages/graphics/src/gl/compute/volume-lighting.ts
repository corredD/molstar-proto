/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Clip } from '@molstar/core/util/clip';
import { ValueCell } from '@molstar/core/util/value-cell';
import { ClipStorageVec4s } from '../clip-storage.js';
import {
  type ComputeContext,
  type ComputeKernel,
  KernelCode,
  type StorageBuffer,
  StorageBufferSpec,
  StorageTextureSpec,
  TextureLevel,
} from '../compute.js';
import type { GraphicsContext } from '../context.js';
import { DefineSpec, TextureSpec, UniformSpec } from '../renderable/schema.js';
import type { Texture } from '../texture.js';

/**
 * The extinction pyramid of a direct volume (`volume-lighting.md` §A1): levels 1 to `VolumeLightingLevels` of the mean
 * extinction per cell under the transfer function, the mip levels of one `r16float` 3d texture (mip `k - 1` is level
 * `k`), read by the ray marcher's descriptors (§A2) for its volumetric lighting
 */

/** Stored levels: 1 to 5 (level 0, the extinction itself, is read from the grid) */
export const VolumeLightingLevels = 5;

/** The highest opacity per cell taken: a finite extinction (`MaxPreIntegratedAlpha` of the transfer function) */
export const VolumeLightingMaxAlpha = 0.999;

/** The cells per axis of the padded grid: a multiple of `2^VolumeLightingLevels`, so that every level halves exactly */
const PaddingCells = 1 << VolumeLightingLevels;

export const VlExtinctionKernel = KernelCode('vl-extinction', [4, 4, 4]);
export const VlDownsampleKernel = KernelCode('vl-downsample', [4, 4, 4]);

const LevelOutput = {
  uLevelDim: UniformSpec('iv3'),
  outLevel: StorageTextureSpec('r', 'fp16', '3d', 'write'),
};

export const VlExtinctionSchema = {
  ...LevelOutput,
  uGridDim: UniformSpec('iv3'),
  uAlpha: UniformSpec('f'),
  dPackedGroup: DefineSpec('boolean'),
  tGridTex: TextureSpec('texture', 'rgba', 'ubyte', 'nearest', undefined, { dimension: '3d' }),
  /** the transfer function's opacity per cell, its 256 entries in [0, 1] */
  transfer: StorageBufferSpec('f32', 'read'),
  /** the clip objects removing cells (`ExtinctionInput.clip`), in `clipObjects` (`ClipStorageVec4s` each) */
  uClipObjectCount: UniformSpec('i'),
  /** a cell's index to the clip objects' space (model space) */
  uCellToModel: UniformSpec('m4'),
  clipObjects: StorageBufferSpec('vec4<f32>', 'read'),
};

export const VlDownsampleSchema = {
  ...LevelOutput,
  tSource: TextureSpec('texture', 'r', 'fp16', 'nearest', undefined, { dimension: '3d' }),
};

/** Whether `graphics` builds extinction pyramids: compute, with `r16float` storage (`texture-formats-tier1`) */
export function isVolumeLightingSupported(
  graphics: GraphicsContext,
): graphics is GraphicsContext & { compute: ComputeContext } {
  const { compute } = graphics;
  return (
    !!compute &&
    compute.isKernelSupported(VlExtinctionKernel, VlExtinctionSchema) &&
    compute.isKernelSupported(VlDownsampleKernel, VlDownsampleSchema)
  );
}

/** Texels per axis of level 1 for a grid of `gridDim` cells: half the grid padded to a multiple of 32 cells */
export function getExtinctionPyramidSize(out: Vec3, gridDim: Vec3) {
  for (let i = 0; i < 3; ++i) out[i] = (Math.ceil(Math.max(1, gridDim[i]) / PaddingCells) * PaddingCells) / 2;
  return out;
}

export interface ExtinctionInput {
  /** the direct volume's grid texture (`tGridTex`, 3d), its values in `r` (or `a` with `packedGroup`) */
  readonly gridTexture: Texture;
  readonly gridDim: Vec3;
  /** the transfer function's 256 bytes (`tTransferTex`) */
  readonly transfer: Uint8Array;
  /** the material's alpha (`uAlpha`) */
  readonly alpha: number;
  readonly packedGroup: boolean;
  /**
   * The clip objects whose removed cells count as 0 (`volume-lighting.md` §A1): `count` of them packed in `objects`
   * (`packStorageClipObjects`), tested at the cells' centers taken to model space by `cellToModel`; none without
   */
  readonly clip?: { readonly count: number; readonly objects: Float32Array; readonly cellToModel: Mat4 };
}

export interface ExtinctionPyramid {
  /** levels 1 to 5 as mips 0 to 4, linear */
  readonly texture: Texture;
  /** Builds all levels from `input` (dispatches in a compute pass of their own) */
  build: (input: ExtinctionInput) => void;
  getByteCount: () => number;
  destroy: () => void;
}

export function createExtinctionPyramid(graphics: GraphicsContext & { compute: ComputeContext }): ExtinctionPyramid {
  const { compute, resources } = graphics;
  const texture = resources.texture('volume-float16', 'r', 'fp16', 'linear');
  const transferArray = new Float32Array(256);
  const transfer: StorageBuffer = compute.createBuffer(transferArray.byteLength, 'extinction transfer');
  const clipObjects: StorageBuffer = compute.createBuffer(
    Clip.MaxObjectCount * ClipStorageVec4s * 16,
    'extinction clip objects',
  );

  const size = Vec3();
  const levelDims = Array.from({ length: VolumeLightingLevels }, () => ValueCell.create(Vec3()));
  const gridDim = ValueCell.create(Vec3());
  const alpha = ValueCell.create(1);
  const packedGroup = ValueCell.create(false);
  const gridTexture = ValueCell.create<Texture>(texture);
  const clipObjectCount = ValueCell.create(0);
  const cellToModel = ValueCell.create(Mat4.identity());

  let kernels: ComputeKernel[] | undefined;
  function getKernels() {
    if (kernels) return kernels;
    kernels = [
      compute.createKernel(VlExtinctionKernel, VlExtinctionSchema, {
        uLevelDim: levelDims[0],
        outLevel: ValueCell.create(TextureLevel(texture, 0)),
        uGridDim: gridDim,
        uAlpha: alpha,
        dPackedGroup: packedGroup,
        tGridTex: gridTexture,
        transfer: ValueCell.create(transfer),
        uClipObjectCount: clipObjectCount,
        uCellToModel: cellToModel,
        clipObjects: ValueCell.create(clipObjects),
      }),
    ];
    for (let level = 1; level < VolumeLightingLevels; ++level) {
      kernels.push(
        compute.createKernel(VlDownsampleKernel, VlDownsampleSchema, {
          uLevelDim: levelDims[level],
          outLevel: ValueCell.create(TextureLevel(texture, level)),
          tSource: ValueCell.create(TextureLevel(texture, level - 1)),
        }),
      );
    }
    return kernels;
  }

  return {
    texture,
    build: (input) => {
      getExtinctionPyramidSize(size, input.gridDim);
      texture.define(size[0], size[1], size[2], VolumeLightingLevels);
      for (let level = 0; level < VolumeLightingLevels; ++level) {
        const d = levelDims[level];
        Vec3.set(d.ref.value, size[0] >> level, size[1] >> level, size[2] >> level);
        ValueCell.update(d, d.ref.value);
      }
      ValueCell.update(gridDim, Vec3.copy(gridDim.ref.value, input.gridDim));
      ValueCell.updateIfChanged(alpha, input.alpha);
      ValueCell.update(gridTexture, input.gridTexture);
      for (let i = 0; i < 256; ++i) transferArray[i] = input.transfer[i] / 255;
      transfer.write(transferArray);
      const { clip } = input;
      ValueCell.updateIfChanged(clipObjectCount, clip?.count ?? 0);
      if (clip && clip.count > 0) {
        clipObjects.write(clip.objects);
        ValueCell.update(cellToModel, Mat4.copy(cellToModel.ref.value, clip.cellToModel));
      }

      const wasPacked = packedGroup.ref.value;
      ValueCell.updateIfChanged(packedGroup, input.packedGroup);
      const ks = getKernels();
      if (wasPacked !== input.packedGroup) ks[0].update();

      compute.beginComputePass({ label: 'extinction pyramid' });
      for (let level = 0; level < VolumeLightingLevels; ++level) {
        const [x, y, z] = levelDims[level].ref.value;
        ks[level].dispatch(Math.ceil(x / 4), Math.ceil(y / 4), Math.ceil(z / 4));
      }
      compute.endComputePass();
    },
    getByteCount: () => texture.getByteCount() + transfer.byteLength + clipObjects.byteLength,
    destroy: () => {
      if (kernels) for (const k of kernels) k.destroy();
      kernels = undefined;
      transfer.destroy();
      clipObjects.destroy();
      texture.destroy();
    },
  };
}
