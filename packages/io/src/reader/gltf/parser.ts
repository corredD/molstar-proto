/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task } from '@molstar/core/task';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import type { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import type { Quat } from '@molstar/core/math/linear-algebra/3d/quat';
import { utf8Read } from '@molstar/core/util/utf8';
import { IsNativeEndianLittle } from '../../common/binary.js';
import { B64_DECODE, decodeB64Str } from '../common/decode.js';
import { ReaderResult as Result } from '../result.js';
import {
  GlbChunkType,
  GlbMagic,
  GltfComponentType as CT,
  GltfPrimitiveMode as Mode,
  type GltfFile,
  type GltfMesh,
  type GltfMeshInstance,
  type GltfPrimitive,
} from './schema.js';

// glTF 2.0 reader (gltf.md): GLB, or .gltf with its buffers as data URIs; meshes as triangles.

/** The JSON of a glTF asset, as far as the reader reads it */
interface Json {
  asset?: { version?: string; generator?: string };
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes?: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number; mode?: number; material?: number }[];
  }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    sparse?: unknown;
  }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
}

/** Required extensions that change nothing the reader reads (quantized attributes are read as any component type) */
const IgnorableExtension = /^(KHR_mesh_quantization|KHR_texture_\w+|KHR_materials_\w+)$/;

const ComponentBytes: { [t: number]: number } = {
  [CT.BYTE]: 1,
  [CT.UNSIGNED_BYTE]: 1,
  [CT.SHORT]: 2,
  [CT.UNSIGNED_SHORT]: 2,
  [CT.UNSIGNED_INT]: 4,
  [CT.FLOAT]: 4,
};
/** spec §3.11: the factor of a normalized integer, clamped at -1 for the signed ones */
const NormalizedScale: { [t: number]: number } = {
  [CT.BYTE]: 1 / 127,
  [CT.UNSIGNED_BYTE]: 1 / 255,
  [CT.SHORT]: 1 / 32767,
  [CT.UNSIGNED_SHORT]: 1 / 65535,
};
const TypeSize: { [t: string]: number } = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** The bytes of an accessor's elements: `count` elements of `size` components, `stride` bytes apart */
interface Source {
  bytes: Uint8Array;
  offset: number;
  stride: number;
  count: number;
  size: number;
  componentType: number;
  normalized: boolean;
}

function readContainer(data: Uint8Array): { json: Json; bin?: Uint8Array } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 12 || view.getUint32(0, true) !== GlbMagic) {
    return { json: JSON.parse(utf8Read(data, 0, data.byteLength)) }; // .gltf
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB version ${version} is not supported (2 only)`);
  const length = view.getUint32(8, true);
  if (length > data.byteLength) throw new Error(`GLB is truncated: ${data.byteLength} of ${length} bytes`);
  let json: Json | undefined;
  let bin: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= length; ) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) throw new Error('GLB chunk runs past the end of the file');
    if (chunkType === GlbChunkType.JSON && !json) json = JSON.parse(utf8Read(data, start, chunkLength));
    else if (chunkType === GlbChunkType.BIN && !bin) bin = data.subarray(start, start + chunkLength);
    offset = start + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function readBuffers(json: Json, bin: Uint8Array | undefined): Uint8Array[] {
  return (json.buffers ?? []).map(({ uri, byteLength }, i) => {
    let bytes: Uint8Array;
    if (uri === undefined) {
      if (i !== 0 || !bin) throw new Error(`glTF buffer ${i} has no data`);
      bytes = bin;
    } else if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',');
      if (!uri.slice(0, comma).endsWith(';base64')) throw new Error(`glTF buffer ${i}: data URI not in base64`);
      // decodeB64Str fills what the payload lacks with zeros: its base64 characters must hold byteLength bytes
      let end = comma + 1;
      while (end < uri.length && B64_DECODE[uri.charCodeAt(end)] >= 0) ++end;
      if (Math.floor(((end - comma - 1) * 3) / 4) < byteLength) {
        throw new Error(`glTF buffer ${i} is shorter than its byteLength`);
      }
      bytes = decodeB64Str(uri, comma + 1, byteLength);
    } else {
      throw new Error(`glTF buffer ${i} is an external file (${uri}): only GLB or .gltf with data URIs is read`);
    }
    if (bytes.byteLength < byteLength) throw new Error(`glTF buffer ${i} is shorter than its byteLength`);
    return bytes;
  });
}

function source(json: Json, buffers: Uint8Array[], index: number): Source {
  const a = json.accessors?.[index];
  if (!a) throw new Error(`glTF accessor ${index} not found`);
  if (a.sparse) throw new Error(`glTF accessor ${index}: sparse accessors are not supported`);
  if (a.bufferView === undefined) throw new Error(`glTF accessor ${index} has no bufferView`);
  const bv = json.bufferViews?.[a.bufferView];
  const bytes = bv && buffers[bv.buffer];
  if (!bytes) throw new Error(`glTF accessor ${index}: buffer view ${a.bufferView} not found`);
  const componentBytes = ComponentBytes[a.componentType];
  const size = TypeSize[a.type];
  if (!componentBytes || !size) throw new Error(`glTF accessor ${index}: ${a.type} of ${a.componentType} not read`);
  const elementBytes = componentBytes * size;
  const stride = bv.byteStride || elementBytes;
  const viewOffset = bv.byteOffset ?? 0;
  const accessorOffset = a.byteOffset ?? 0;
  if (
    viewOffset + bv.byteLength > bytes.byteLength ||
    (a.count > 0 && accessorOffset + stride * (a.count - 1) + elementBytes > bv.byteLength)
  ) {
    throw new Error(`glTF accessor ${index} runs past its buffer view`);
  }
  return {
    bytes,
    offset: viewOffset + accessorOffset,
    stride,
    count: a.count,
    size,
    componentType: a.componentType,
    normalized: !!a.normalized,
  };
}

function readComponent(view: DataView, p: number, type: number): number {
  switch (type) {
    case CT.FLOAT:
      return view.getFloat32(p, true);
    case CT.UNSIGNED_INT:
      return view.getUint32(p, true);
    case CT.UNSIGNED_SHORT:
      return view.getUint16(p, true);
    case CT.SHORT:
      return view.getInt16(p, true);
    case CT.UNSIGNED_BYTE:
      return view.getUint8(p);
    default:
      return view.getInt8(p);
  }
}

/** The accessor as floats: a view on the buffer when tight, aligned little-endian float; else decoded (strided, integer) */
function readFloats({ bytes, offset, stride, count, size, componentType, normalized }: Source): Float32Array {
  const start = bytes.byteOffset + offset;
  if (componentType === CT.FLOAT && stride === size * 4 && start % 4 === 0 && IsNativeEndianLittle) {
    return new Float32Array(bytes.buffer, start, count * size);
  }
  const out = new Float32Array(count * size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const componentBytes = ComponentBytes[componentType];
  for (let i = 0, o = 0; i < count; ++i) {
    for (let k = 0, p = offset + i * stride; k < size; ++k, p += componentBytes) {
      out[o++] = readComponent(view, p, componentType);
    }
  }
  const scale = normalized ? NormalizedScale[componentType] : undefined;
  if (scale) for (let i = 0, il = out.length; i < il; ++i) out[i] = Math.max(out[i] * scale, -1);
  return out;
}

function readIndices(s: Source, index: number): Uint8Array | Uint16Array | Uint32Array {
  const { bytes, offset, stride, count, componentType } = s;
  const Ctor =
    componentType === CT.UNSIGNED_INT
      ? Uint32Array
      : componentType === CT.UNSIGNED_SHORT
        ? Uint16Array
        : componentType === CT.UNSIGNED_BYTE
          ? Uint8Array
          : undefined;
  if (!Ctor || s.size !== 1) throw new Error(`glTF accessor ${index}: indices must be unsigned scalars`);
  const start = bytes.byteOffset + offset;
  const n = Ctor.BYTES_PER_ELEMENT;
  if (stride === n && start % n === 0 && (IsNativeEndianLittle || n === 1))
    return new Ctor(bytes.buffer as ArrayBuffer, start, count);
  const out = new Ctor(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; ++i) out[i] = readComponent(view, offset + i * stride, componentType);
  return out;
}

/** spec §3.7.2.1: strip triangle i is (i, i+1, i+2), odd ones (i+1, i, i+2) to keep the winding; fan i is (i+1, i+2, 0) */
function toTriangleList(mode: number, indices: ArrayLike<number> | undefined, n: number): Uint32Array {
  const triangleCount = Math.max(0, n - 2);
  const out = new Uint32Array(triangleCount * 3);
  const at = (i: number) => (indices ? indices[i] : i);
  for (let i = 0, o = 0; i < triangleCount; ++i, o += 3) {
    if (mode === Mode.TRIANGLE_FAN) {
      out[o] = at(i + 1);
      out[o + 1] = at(i + 2);
      out[o + 2] = at(0);
    } else {
      const odd = i & 1;
      out[o] = at(i + odd);
      out[o + 1] = at(i + 1 - odd);
      out[o + 2] = at(i + 2);
    }
  }
  return out;
}

class Reader {
  private floats = new Map<number, Float32Array>();
  private indices = new Map<number, { data: Uint8Array | Uint16Array | Uint32Array; max: number }>();
  readonly warnings: string[] = [];

  constructor(
    private json: Json,
    private buffers: Uint8Array[],
  ) {}

  /** A float attribute of `count` elements, `sizes` its allowed component counts; shared accessors decoded once */
  private attribute(index: number, sizes: number[], count: number | undefined, what: string) {
    const s = source(this.json, this.buffers, index);
    if (!sizes.includes(s.size)) throw new Error(`glTF ${what}: accessor ${index} has ${s.size} components`);
    if (count !== undefined && s.count !== count) throw new Error(`glTF ${what}: ${s.count} values, ${count} vertices`);
    let data = this.floats.get(index);
    if (!data) this.floats.set(index, (data = readFloats(s)));
    return { data, size: s.size, count: s.count };
  }

  /** Indices, decoded once per accessor with their maximum, which is checked against each primitive using them */
  private triangleIndices(index: number, vertexCount: number, what: string) {
    let entry = this.indices.get(index);
    if (!entry) {
      const data = readIndices(source(this.json, this.buffers, index), index);
      let max = -1;
      for (let i = 0, il = data.length; i < il; ++i) if (data[i] > max) max = data[i];
      this.indices.set(index, (entry = { data, max }));
    }
    if (entry.max >= vertexCount) throw new Error(`glTF ${what}: index ${entry.max} of ${vertexCount} vertices`);
    return entry.data;
  }

  primitive(meshIndex: number, primitiveIndex: number): GltfPrimitive | undefined {
    const what = `mesh ${meshIndex} primitive ${primitiveIndex}`;
    const p = this.json.meshes![meshIndex].primitives[primitiveIndex];
    const mode = p.mode ?? Mode.TRIANGLES;
    if (mode < Mode.TRIANGLES || mode > Mode.TRIANGLE_FAN || p.attributes.POSITION === undefined) {
      this.warnings.push(`glTF ${what}: ${mode < Mode.TRIANGLES ? 'points or lines' : 'no triangles'}, skipped`);
      return;
    }
    const positions = this.attribute(p.attributes.POSITION, [3], undefined, `${what} POSITION`);
    const vertexCount = positions.count;
    const normals =
      p.attributes.NORMAL !== undefined
        ? this.attribute(p.attributes.NORMAL, [3], vertexCount, `${what} NORMAL`).data
        : undefined;
    const colors =
      p.attributes.COLOR_0 !== undefined
        ? this.attribute(p.attributes.COLOR_0, [3, 4], vertexCount, `${what} COLOR_0`)
        : undefined;
    let indices: Uint8Array | Uint16Array | Uint32Array | undefined =
      p.indices !== undefined ? this.triangleIndices(p.indices, vertexCount, what) : undefined;
    if (mode !== Mode.TRIANGLES) indices = toTriangleList(mode, indices, indices ? indices.length : vertexCount);
    const material = p.material !== undefined ? this.json.materials?.[p.material] : undefined;
    return {
      index: primitiveIndex,
      vertexCount,
      positions: positions.data,
      normals,
      colors: colors?.data,
      colorSize: colors?.size ?? 0,
      indices,
      triangleCount: Math.floor((indices ? indices.length : vertexCount) / 3),
      baseColor: material ? (material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]) : undefined,
    };
  }
}

function localTransform(node: NonNullable<Json['nodes']>[number]): Mat4 {
  if (node.matrix) return Mat4.fromArray(Mat4(), node.matrix, 0);
  return Mat4.compose(
    Mat4(),
    (node.translation ?? [0, 0, 0]) as Vec3,
    (node.rotation ?? [0, 0, 0, 1]) as Quat,
    (node.scale ?? [1, 1, 1]) as Vec3,
  );
}

/** The mesh nodes of the default scene (or of the root nodes, or each mesh once), with their world transforms */
function instances(json: Json): GltfMeshInstance[] {
  const nodes = json.nodes ?? [];
  const meshCount = json.meshes?.length ?? 0;
  if (!nodes.length) return Array.from({ length: meshCount }, (_, mesh) => ({ mesh, transform: Mat4.identity() }));
  let roots: number[];
  if (json.scenes?.length) {
    roots = json.scenes[json.scene ?? 0]?.nodes ?? [];
  } else {
    const isChild = new Uint8Array(nodes.length);
    for (const n of nodes) for (const c of n.children ?? []) isChild[c] = 1;
    roots = nodes.map((_, i) => i).filter((i) => !isChild[i]);
  }
  const out: GltfMeshInstance[] = [];
  const visited = new Uint8Array(nodes.length);
  const visit = (i: number, parent: Mat4) => {
    const node = nodes[i];
    if (!node) throw new Error(`glTF node ${i} not found`);
    if (visited[i]) throw new Error(`glTF node ${i} has two parents or is in a cycle`);
    visited[i] = 1;
    const transform = Mat4.mul(Mat4(), parent, localTransform(node));
    if (node.mesh !== undefined) {
      if (node.mesh >= meshCount) throw new Error(`glTF node ${i}: mesh ${node.mesh} not found`);
      out.push({ name: node.name, mesh: node.mesh, transform });
    }
    for (const c of node.children ?? []) visit(c, transform);
  };
  const identity = Mat4.identity();
  for (const r of roots) visit(r, identity);
  return out;
}

function parseInternal(data: Uint8Array): Result<GltfFile> {
  const { json, bin } = readContainer(data);
  const version = json.asset?.version;
  if (!version?.startsWith('2.')) throw new Error(`glTF version ${version} is not supported (2.x only)`);
  const unsupported = (json.extensionsRequired ?? []).filter((e) => !IgnorableExtension.test(e));
  if (unsupported.length) {
    throw new Error(`glTF requires unsupported extensions (compressed meshes are not read): ${unsupported.join(', ')}`);
  }
  const reader = new Reader(json, readBuffers(json, bin));
  // Only the meshes the scene uses are read
  const instanceList = instances(json);
  const meshes: GltfMesh[] = (json.meshes ?? []).map(({ name }) => ({ name, primitives: [] }));
  const read = new Uint8Array(meshes.length);
  for (const { mesh } of instanceList) {
    if (read[mesh]) continue;
    read[mesh] = 1;
    const primitives: GltfPrimitive[] = [];
    for (let p = 0, pl = json.meshes![mesh].primitives.length; p < pl; ++p) {
      const primitive = reader.primitive(mesh, p);
      if (primitive) primitives.push(primitive);
    }
    meshes[mesh] = { name: meshes[mesh].name, primitives };
  }
  if (!meshes.some((m) => m.primitives.some((p) => p.triangleCount > 0))) {
    return Result.error('glTF has no triangles in its scene');
  }
  return Result.success({ meshes, instances: instanceList, generator: json.asset?.generator }, reader.warnings);
}

/** Parse a GLB, or a .gltf whose buffers are data URIs; refuses compressed meshes and external buffers */
export function parseGltf(data: Uint8Array) {
  return Task.create<Result<GltfFile>>('Parse glTF', async () => {
    try {
      return parseInternal(data);
    } catch (e) {
      return Result.error(e instanceof Error ? e.message : `${e}`);
    }
  });
}
