/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Color } from '@molstar/core/util/color/color';
import { parseGltf } from '../gltf/parser.js';
import { gltfToObj } from '../gltf/to-obj.js';
import { GlbChunkType, GlbMagic, GltfComponentType as CT, type GltfFile } from '../gltf/schema.js';

// --- a tiny glTF writer: the JSON and one binary buffer, as GLB or as .gltf with a data URI ---

function padded(bytes: Uint8Array, pad: number) {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(pad);
  out.set(bytes);
  return out;
}

function glb(json: object, bin: Uint8Array, byteOffset = 0): Uint8Array {
  const text = padded(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const data = padded(bin, 0);
  const length = 12 + 8 + text.length + 8 + data.length;
  const out = new Uint8Array(byteOffset + length);
  const view = new DataView(out.buffer, byteOffset);
  view.setUint32(0, GlbMagic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, GlbChunkType.JSON, true);
  out.set(text, byteOffset + 20);
  view.setUint32(20 + text.length, data.length, true);
  view.setUint32(24 + text.length, GlbChunkType.BIN, true);
  out.set(data, byteOffset + 28 + text.length);
  return out.subarray(byteOffset);
}

/** Concatenates the arrays, each at a 4-aligned offset (or `at` the given offsets), into one buffer */
function buffer(arrays: ArrayBufferView[], at?: number[]) {
  const offsets: number[] = [];
  let end = 0;
  arrays.forEach((a, i) => {
    const o = at ? at[i] : Math.ceil(end / 4) * 4;
    offsets.push(o);
    end = o + a.byteLength;
  });
  const bytes = new Uint8Array(end);
  arrays.forEach((a, i) => bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offsets[i]));
  return {
    bytes,
    bufferViews: arrays.map((a, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: a.byteLength })),
  };
}

const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

/** One triangle mesh (positions accessor 0, indices accessor 1 when given) and the nodes and extras given */
function triangleGltf(
  extra: Record<string, unknown> = {},
  indices: Uint8Array | Uint16Array | Uint32Array = new Uint16Array([0, 1, 2]),
) {
  const { bytes, bufferViews } = buffer([triangle, indices]);
  const componentType =
    indices instanceof Uint8Array
      ? CT.UNSIGNED_BYTE
      : indices instanceof Uint16Array
        ? CT.UNSIGNED_SHORT
        : CT.UNSIGNED_INT;
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: CT.FLOAT, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: bytes.byteLength }],
    ...extra,
  };
  return { json, bytes };
}

async function parse(data: Uint8Array): Promise<GltfFile> {
  const r = await parseGltf(data).run();
  if (r.isError) throw new Error(r.message);
  return r.result;
}

async function parseError(data: Uint8Array): Promise<string> {
  const r = await parseGltf(data).run();
  if (!r.isError) throw new Error('expected an error');
  return r.message;
}

const toArray = (a: ArrayLike<number>) => Array.from(a, (x) => Math.round(x * 1e5) / 1e5 + 0);

describe('glTF reader', () => {
  it('reads the CryoET Data Portal mesh: counts and bounds as its accessors give them', async () => {
    // https://files.cryoetdataportal.cziscience.com/10521/L2_P2_ts_002/Reconstructions/VoxelSpacing10.005/Annotations/101/sample-1.0_mesh.glb
    const data = new Uint8Array(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../../../data/examples/shapes/cryoet-10521-mesh.glb')),
    );
    const file = await parse(data);
    expect(file.generator).toBe('https://github.com/mikedh/trimesh');
    // the node chain world → geometry_0
    expect(file.instances.map((i) => [i.name, i.mesh])).toEqual([['geometry_0', 0]]);
    const [p] = file.meshes[0].primitives;
    expect(p.vertexCount).toBe(5084);
    expect(p.triangleCount).toBe(10164);
    // views on the file's bytes, not copies
    expect(p.positions.buffer).toBe(data.buffer);
    expect(p.indices).toBeInstanceOf(Uint32Array);
    expect(p.indices!.buffer).toBe(data.buffer);

    const { obj, mtl } = gltfToObj(file);
    expect(obj.triangleCount).toBe(10164);
    expect(obj.positionCount).toBe(5084);
    expect(obj.normalCount).toBe(0);
    expect(mtl.size).toBe(0);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < obj.positions.length; ++i) {
      min[i % 3] = Math.min(min[i % 3], obj.positions[i]);
      max[i % 3] = Math.max(max[i % 3], obj.positions[i]);
    }
    // the accessor's min and max, in Å (the file's extras say "meters": not read, gltf.md §4)
    expect(min).toEqual([0, 0, Math.fround(682.9225463867188)]);
    expect(max).toEqual([5480, 7720, Math.fround(2804.80078125)]);
  });

  it('applies the node hierarchy: TRS parent times matrix child', async () => {
    const { json, bytes } = triangleGltf({
      nodes: [
        // rotate 90° about z, scale 2, translate x by 10
        { children: [1], translation: [10, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], scale: [2, 2, 2] },
        // translate y by 1, column-major
        { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1] },
      ],
    });
    const { obj } = gltfToObj(await parse(glb(json, bytes)));
    // (x, y) → T(10) R(90°) S(2) (x, y + 1) = (10 - 2 (y + 1), 2 x)
    expect(toArray(obj.positions)).toEqual([8, 0, 0, 8, 2, 0, 6, 0, 0]);
    expect(Array.from(obj.positionIndices)).toEqual([0, 1, 2]);
  });

  it('reverses the winding under a mirroring transform', async () => {
    const { json, bytes } = triangleGltf({ nodes: [{ mesh: 0, scale: [-1, 1, 1] }] });
    const { obj } = gltfToObj(await parse(glb(json, bytes)));
    expect(toArray(obj.positions)).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);
    expect(Array.from(obj.positionIndices)).toEqual([0, 2, 1]);
  });

  it('reads interleaved attributes (byteStride) and transforms the normals', async () => {
    // position xyz, normal xyz per vertex: 24 bytes
    const interleaved = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
    const { json, bytes } = triangleGltf();
    json.bufferViews[0] = { buffer: 0, byteOffset: 0, byteLength: 72, byteStride: 24 } as any;
    json.accessors.push({ bufferView: 0, byteOffset: 12, componentType: CT.FLOAT, count: 3, type: 'VEC3' } as any);
    json.meshes[0].primitives[0].attributes = { POSITION: 0, NORMAL: 2 } as any;
    const { bytes: b2, bufferViews } = buffer([interleaved, new Uint16Array([0, 1, 2])]);
    json.bufferViews[1] = bufferViews[1];
    json.buffers[0].byteLength = b2.byteLength;
    json.nodes = [{ mesh: 0, rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }] as any; // 90° about x
    void bytes;

    const file = await parse(glb(json, b2));
    const [p] = file.meshes[0].primitives;
    expect(toArray(p.positions)).toEqual(Array.from(triangle));
    expect(toArray(p.normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const { obj } = gltfToObj(file);
    expect(obj.normalCount).toBe(3);
    expect(toArray(obj.normals)).toEqual([0, -1, 0, 0, -1, 0, 0, -1, 0]);
  });

  it('reads uint8, uint16 and uint32 indices to the same triangles', async () => {
    for (const indices of [new Uint8Array([2, 1, 0]), new Uint16Array([2, 1, 0]), new Uint32Array([2, 1, 0])]) {
      const { json, bytes } = triangleGltf({}, indices);
      const [p] = (await parse(glb(json, bytes))).meshes[0].primitives;
      expect(p.indices).toBeInstanceOf(indices.constructor);
      expect(Array.from(p.indices!)).toEqual([2, 1, 0]);
    }
  });

  it('copies what it cannot view: an unaligned buffer, normalized integers', async () => {
    // the GLB at an odd byte offset of its ArrayBuffer: no aligned view on the floats or the uint16 indices
    const { json, bytes } = triangleGltf();
    const file = await parse(glb(json, bytes, 1));
    const [p] = file.meshes[0].primitives;
    expect(toArray(p.positions)).toEqual(Array.from(triangle));
    expect(Array.from(p.indices!)).toEqual([0, 1, 2]);

    // KHR_mesh_quantization: normalized int16 positions
    const q = new Int16Array([0, 0, 0, 32767, 0, 0, 0, -32767, 0]);
    const { bytes: b, bufferViews } = buffer([q]);
    const quantized = {
      asset: { version: '2.0' },
      extensionsRequired: ['KHR_mesh_quantization'],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: CT.SHORT, normalized: true, count: 3, type: 'VEC3' }],
      bufferViews,
      buffers: [{ byteLength: b.byteLength }],
    };
    const [qp] = (await parse(glb(quantized, b))).meshes[0].primitives;
    expect(toArray(qp.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, -1, 0]);
    expect(qp.triangleCount).toBe(1);
  });

  it('converts triangle strips and fans', async () => {
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const { bytes, bufferViews } = buffer([quad]);
    const make = (mode: number) => ({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode }] }],
      accessors: [{ bufferView: 0, componentType: CT.FLOAT, count: 4, type: 'VEC3' }],
      bufferViews,
      buffers: [{ byteLength: bytes.byteLength }],
    });
    const [strip] = (await parse(glb(make(5), bytes))).meshes[0].primitives;
    expect(Array.from(strip.indices!)).toEqual([0, 1, 2, 2, 1, 3]);
    const [fan] = (await parse(glb(make(6), bytes))).meshes[0].primitives;
    expect(Array.from(fan.indices!)).toEqual([1, 2, 0, 2, 3, 0]);
  });

  it('gives one face group per primitive and node name, named and coloured', async () => {
    const colors = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const { bytes, bufferViews } = buffer([triangle, new Uint16Array([0, 1, 2]), colors]);
    const json = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0, 1, 2, 3] }],
      // three nodes share mesh 0 and its accessors, two by one name; a node of mesh 1 takes the same name
      nodes: [
        { name: 'a', mesh: 0 },
        { name: 'a', mesh: 0, translation: [5, 0, 0] },
        { name: 'b', mesh: 0 },
        { name: 'a', mesh: 1 },
      ],
      meshes: [0, 1].map(() => ({
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1, material: 0 },
          { attributes: { POSITION: 0, COLOR_0: 2 }, indices: 1 },
        ],
      })),
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.21586, 0.21586, 0.21586, 1] } }],
      accessors: [
        { bufferView: 0, componentType: CT.FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: CT.UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
        { bufferView: 2, componentType: CT.UNSIGNED_BYTE, normalized: true, count: 3, type: 'VEC4' },
      ],
      bufferViews,
      buffers: [{ byteLength: bytes.byteLength }],
    };
    const file = await parse(glb(json, bytes));
    const [p0, p1] = file.meshes[0].primitives;
    expect(p0.positions).toBe(p1.positions); // decoded once
    const { obj, mtl } = gltfToObj(file);
    // the groups by name, not by node: as many as the distinct names, however many instances
    expect(obj.materialNames).toEqual(['a 0', 'a 1', 'b 0', 'b 1', 'a 0 (2)', 'a 1 (2)']);
    expect(Array.from(obj.faceGroups)).toEqual([0, 1, 0, 1, 2, 3, 4, 5]);
    expect(Array.from(obj.positionIndices.subarray(0, 12))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // linear 0.21586 is sRGB 128 / 255; no material is white
    expect(Color.toHexStyle(mtl.get('a 0')!.Kd)).toBe('#808080');
    expect(Color.toHexStyle(mtl.get('a 1')!.Kd)).toBe('#ffffff');
    // COLOR_0 per vertex, the base colour for the primitive without
    expect(Array.from(obj.vertexColors.subarray(0, 3), (c) => Math.round(c * 255))).toEqual([128, 128, 128]);
    // as the OBJ shape reads them (Color.fromNormalizedArray truncates): pure red, green, blue, and white
    const rendered = (i: number) => Color.toHexStyle(Color.fromNormalizedArray(obj.vertexColors, i * 3));
    expect([3, 4, 5].map(rendered)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(rendered(0)).toBe('#808080');
    expect(obj.positions[27]).toBe(5);
  });

  it('clamps float vertex colours to [0, 1] before they are packed', async () => {
    const colors = new Float32Array([1.2, 0, 0, 0, -0.5, 1, 1, 1, 1]);
    const { bytes, bufferViews } = buffer([triangle, colors]);
    const json = {
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }],
      accessors: [
        { bufferView: 0, componentType: CT.FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: CT.FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews,
      buffers: [{ byteLength: bytes.byteLength }],
    };
    const { obj } = gltfToObj(await parse(glb(json, bytes)));
    const rendered = [0, 1, 2].map((i) => Color.toHexStyle(Color.fromNormalizedArray(obj.vertexColors, i * 3)));
    expect(rendered).toEqual(['#ff0000', '#0000ff', '#ffffff']);
  });

  it('reads a .gltf whose buffer is a data URI', async () => {
    const { json, bytes } = triangleGltf();
    const uri = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
    json.buffers = [{ byteLength: bytes.byteLength, uri } as any];
    const file = await parse(new TextEncoder().encode(JSON.stringify(json)));
    expect(toArray(file.meshes[0].primitives[0].positions)).toEqual(Array.from(triangle));
  });

  it('skips points and lines with a warning, and refuses a scene without triangles', async () => {
    const { json, bytes } = triangleGltf();
    json.meshes[0].primitives.unshift({ attributes: { POSITION: 0 }, mode: 1 } as any);
    const r = await parseGltf(glb(json, bytes)).run();
    expect(r.isError).toBe(false);
    if (!r.isError) {
      expect(r.result.meshes[0].primitives.length).toBe(1);
      expect(r.warnings).toEqual(['glTF mesh 0 primitive 0: points or lines, skipped']);
      // named by its index in the glTF mesh
      expect(gltfToObj(r.result).obj.materialNames).toEqual(['tri 1']);
    }
    (json.meshes[0].primitives[1] as any).mode = 0;
    expect(await parseError(glb(json, bytes))).toBe('glTF has no triangles in its scene');
  });

  it('refuses compressed meshes, sparse accessors, external buffers and bad indices clearly', async () => {
    const draco = triangleGltf({ extensionsRequired: ['KHR_draco_mesh_compression', 'KHR_materials_unlit'] });
    expect(await parseError(glb(draco.json, draco.bytes))).toBe(
      'glTF requires unsupported extensions (compressed meshes are not read): KHR_draco_mesh_compression',
    );

    const sparse = triangleGltf();
    (sparse.json.accessors[0] as any).sparse = { count: 1 };
    expect(await parseError(glb(sparse.json, sparse.bytes))).toBe(
      'glTF accessor 0: sparse accessors are not supported',
    );

    const external = triangleGltf();
    (external.json.buffers[0] as any).uri = 'mesh.bin';
    expect(await parseError(new TextEncoder().encode(JSON.stringify(external.json)))).toBe(
      'glTF buffer 0 is an external file (mesh.bin): only GLB or .gltf with data URIs is read',
    );

    // a data URI shorter than its buffer, or not base64
    for (const payload of ['AAAAAAAA', '!!!!']) {
      const short = triangleGltf();
      (short.json.buffers[0] as any).uri = `data:application/octet-stream;base64,${payload}`;
      expect(await parseError(new TextEncoder().encode(JSON.stringify(short.json)))).toBe(
        'glTF buffer 0 is shorter than its byteLength',
      );
    }

    const outOfRange = triangleGltf({}, new Uint16Array([0, 1, 3]));
    expect(await parseError(glb(outOfRange.json, outOfRange.bytes))).toBe(
      'glTF mesh 0 primitive 0: index 3 of 3 vertices',
    );

    // one index accessor for two primitives: checked against each one's vertices, whatever their order
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const shared = buffer([quad, triangle, new Uint16Array([0, 1, 3])]);
    const sharedJson = {
      asset: { version: '2.0' },
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0 }, indices: 2 },
            { attributes: { POSITION: 1 }, indices: 2 },
          ],
        },
      ],
      accessors: [
        { bufferView: 0, componentType: CT.FLOAT, count: 4, type: 'VEC3' },
        { bufferView: 1, componentType: CT.FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: CT.UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: shared.bufferViews,
      buffers: [{ byteLength: shared.bytes.byteLength }],
    };
    expect(await parseError(glb(sharedJson, shared.bytes))).toBe('glTF mesh 0 primitive 1: index 3 of 3 vertices');

    const v1 = triangleGltf({ asset: { version: '1.0' } });
    expect(await parseError(glb(v1.json, v1.bytes))).toBe('glTF version 1.0 is not supported (2.x only)');

    const truncated = glb(triangleGltf().json, triangleGltf().bytes);
    expect(await parseError(truncated.subarray(0, truncated.length - 4))).toMatch(/^GLB is truncated/);
  });
});
