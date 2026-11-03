/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';

// glTF 2.0: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html (the reader: gltf.md in the package _spec)

/** Accessor component types (spec §3.6.2.2) */
export const GltfComponentType = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

/** Buffer view targets (spec §5.11) */
export const GltfBufferTarget = {
  ARRAY_BUFFER: 34962,
  ELEMENT_ARRAY_BUFFER: 34963,
} as const;

/** Primitive topology (spec §3.7.2.1); absent means TRIANGLES */
export const GltfPrimitiveMode = {
  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
} as const;

/** GLB container (spec §4): the header's magic ("glTF") and the chunk types ("JSON", "BIN\0") */
export const GlbMagic = 0x46546c67;
export const GlbChunkType = {
  JSON: 0x4e4f534a,
  BIN: 0x004e4942,
} as const;

/** One primitive of a glTF mesh, as triangles, in the mesh's own frame */
export interface GltfPrimitive {
  /** its index in the glTF mesh's primitives (points and lines are skipped, so not always its index here) */
  readonly index: number;
  readonly vertexCount: number;
  /** xyz per vertex; a view on the binary buffer when the accessor is tight, aligned float */
  readonly positions: Float32Array;
  /** xyz per vertex, NORMAL */
  readonly normals?: Float32Array;
  /** COLOR_0, linear, `colorSize` (3 or 4) components per vertex, normalized to [0, 1] */
  readonly colors?: Float32Array;
  readonly colorSize: number;
  /** three vertex indices per triangle (strips and fans converted); undefined: the vertices in order */
  readonly indices?: Uint8Array | Uint16Array | Uint32Array;
  readonly triangleCount: number;
  /** the material's `pbrMetallicRoughness.baseColorFactor`, linear RGBA; undefined without a material (white) */
  readonly baseColor?: readonly number[];
}

export interface GltfMesh {
  readonly name?: string;
  readonly primitives: readonly GltfPrimitive[];
}

/** A node of the scene with a mesh, and its world transform (the hierarchy's matrices or TRS, multiplied) */
export interface GltfMeshInstance {
  readonly name?: string;
  readonly mesh: number;
  readonly transform: Mat4;
}

export interface GltfFile {
  readonly meshes: readonly GltfMesh[];
  /** the scene's mesh nodes, in depth-first order */
  readonly instances: readonly GltfMeshInstance[];
  /** `asset.generator`, if given */
  readonly generator?: string;
}
