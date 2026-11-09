/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task } from '@molstar/core/task';
import { StateObjectRef } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { PluginStateTransform, PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { DataFormatProvider } from '@molstar/plugin/state/formats/provider';
import { ShapeFormatCategory } from '@molstar/plugin/state/formats/shape/category';
import { ShapeFromObj } from '@molstar/plugin/state/formats/shape/obj';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import type { PluginContext } from '@molstar/plugin/context';

type ObjFile = SO.Format.Obj['data'];

// The whole yeast cell viewer's compartment meshes (zoidpuff.github.io/yeast_cell_viewer, `organelle_meshes.bin`, read
// as its `renderer.ts` `uploadOrganelleMeshes` reads it; lipid-procedural round 6): u32 count, count × (membrane id, nV,
// nT) u32, then per mesh nV × 3 f32 positions (nm) and nT × 3 u32 indices. Its `.bin.gz` is inflated by Mol*'s open.
// Each mesh a shape named by its membrane, in Å (×10): wrapped with lipids at once (`mesoscale.wrapMeshes`).

/** The viewer's membranes by id (its `geometry.json`, `mem_names`) */
export const OrganelleMembraneNames = [
  'PM',
  'ER',
  'NE',
  'VAC',
  'MITO_OM',
  'MITO_IM',
  'GOLGI',
  'PEROX',
  'LD',
  'CELL_OUTER',
];

/** nm to Å */
export const OrganelleScale = 10;

export interface OrganelleMesh {
  readonly membrane: number;
  readonly name: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** The meshes of an `organelle_meshes.bin`, positions times `scale`; or what is wrong with the bytes */
export function parseOrganelleMeshes(bytes: Uint8Array, scale = OrganelleScale): OrganelleMesh[] | string {
  const starts = organelleStarts(bytes);
  if (typeof starts === 'string') return starts;
  const count = starts.length;
  const out: OrganelleMesh[] = [];
  for (let i = 0; i < count; ++i) {
    const m = organelleMeshAt(bytes, i, scale);
    if (typeof m === 'string') return m;
    out.push(m);
  }
  return out;
}

/** Per file its meshes' starts (the header read once a file: + Open's transforms read a mesh each) */
const headers = new WeakMap<Uint8Array, Float64Array | string>();

/** Each mesh's first byte, the header's sizes the file's (no mesh read); or what is wrong */
function organelleStarts(bytes: Uint8Array): Float64Array | string {
  const cached = headers.get(bytes);
  if (cached) return cached;
  const starts = readStarts(bytes);
  headers.set(bytes, starts);
  return starts;
}

function readStarts(bytes: Uint8Array): Float64Array | string {
  if (bytes.byteLength < 4) return 'Not organelle meshes: too short.';
  const view = dataView(bytes);
  const count = view.getUint32(0, true);
  if (count === 0 || count > 1024 || 4 + count * 12 > bytes.byteLength) return 'Not organelle meshes: a bad header.';
  const starts = new Float64Array(count);
  let size = 4 + count * 12;
  for (let i = 0; i < count; ++i) {
    starts[i] = size;
    size += view.getUint32(8 + i * 12, true) * 12 + view.getUint32(12 + i * 12, true) * 12;
    if (size > bytes.byteLength) return `Not organelle meshes: mesh ${i} runs past the end.`;
  }
  if (size !== bytes.byteLength) return 'Not organelle meshes: bytes past the last mesh.';
  return starts;
}

/** The meshes' names, read from the header alone; or what is wrong */
function organelleNames(bytes: Uint8Array): string[] | string {
  const starts = organelleStarts(bytes);
  if (typeof starts === 'string') return starts;
  const count = starts.length;
  const view = dataView(bytes);
  return Array.from({ length: count }, (_, i) => {
    const id = view.getUint32(4 + i * 12, true);
    return OrganelleMembraneNames[id] ?? `membrane ${id}`;
  });
}

/** Mesh `index` of an `organelle_meshes.bin` (what one opened mesh's transform reads), or what is wrong */
export function organelleMeshAt(bytes: Uint8Array, index: number, scale = OrganelleScale): OrganelleMesh | string {
  const starts = organelleStarts(bytes);
  if (typeof starts === 'string') return starts;
  const count = starts.length;
  if (!(index >= 0 && index < count)) return `No mesh ${index} (${count} in the file).`;
  const view = dataView(bytes);
  let at = starts[index];
  const membrane = view.getUint32(4 + index * 12, true);
  const nV = view.getUint32(8 + index * 12, true);
  const nT = view.getUint32(12 + index * 12, true);
  const positions = new Float32Array(nV * 3);
  for (let k = 0; k < nV * 3; ++k) positions[k] = view.getFloat32(at + k * 4, true) * scale;
  at += nV * 12;
  const indices = new Uint32Array(nT * 3);
  for (let k = 0; k < nT * 3; ++k) {
    const v = view.getUint32(at + k * 4, true);
    if (v >= nV) return `Not organelle meshes: mesh ${index} indexes a vertex past its ${nV}.`;
    indices[k] = v;
  }
  return { membrane, name: OrganelleMembraneNames[membrane] ?? `membrane ${membrane}`, positions, indices };
}

/** A mesh as an OBJ's (`ShapeFromObj` makes its shape, as an opened OBJ's) */
function objFile({ positions, indices }: OrganelleMesh): ObjFile {
  const T = indices.length / 3;
  return {
    positions,
    normals: new Float32Array(0),
    positionIndices: Int32Array.from(indices),
    normalIndices: new Int32Array(T * 3).fill(-1),
    positionCount: positions.length / 3,
    normalCount: 0,
    triangleCount: T,
    vertexColors: new Float32Array(0),
    materialNames: [],
    faceGroups: new Int32Array(T),
  };
}

export type OrganelleMeshFromBinary = typeof OrganelleMeshFromBinary;
export const OrganelleMeshFromBinary = PluginStateTransform.BuiltIn({
  name: 'mesoscale-organelle-mesh',
  display: { name: 'Organelle mesh', description: 'One mesh of the yeast cell viewer’s organelle_meshes.bin, in Å' },
  from: [SO.Data.Binary, SO.Data.Response],
  to: SO.Format.Obj,
  params: { index: PD.Numeric(0, { min: 0, max: 1023, step: 1 }) },
})({
  apply({ a, params }) {
    return Task.create('Organelle mesh', async () => {
      const mesh = organelleMeshAt(SO.Data.readBytes(a), params.index);
      if (typeof mesh === 'string') throw new Error(mesh);
      return new SO.Format.Obj(objFile(mesh), { label: mesh.name });
    });
  },
});

export const OrganelleMeshesProvider = DataFormatProvider({
  name: 'organelle-meshes',
  label: 'Organelle meshes',
  description: 'The yeast cell viewer’s compartment meshes (organelle_meshes.bin)',
  category: ShapeFormatCategory,
  binaryExtensions: ['bin'],
  priority: 1,
  // a response sniffed as itself (its bytes held whole), its header's sizes the file's
  sniffsResponse: true,
  isApplicable: (_info, data) => {
    const bytes = ArrayBuffer.isView(data) ? (data as Uint8Array) : (data as { heldBytes?: Uint8Array }).heldBytes;
    return !!bytes && typeof organelleStarts(bytes) !== 'string';
  },
  parse: async (plugin: PluginContext, data: StateObjectRef<SO.Data.Binary | SO.Data.Response>) => {
    const obj = StateObjectRef.resolve(plugin.state.data, data)?.obj;
    const bytes = obj ? SO.Data.readBytes(obj as SO.Data.Binary | SO.Data.Response) : undefined;
    const names = bytes ? organelleNames(bytes) : 'No data.';
    if (typeof names === 'string') throw new Error(names);
    const b = plugin.state.data.build();
    const shapes = names.map(
      (name, index) =>
        b
          .to(data)
          .apply(OrganelleMeshFromBinary, { index }, { state: { isGhost: true } })
          .apply(ShapeFromObj, { label: name }).selector,
    );
    await b.commit();
    return { shapes };
  },
  visuals: async (plugin: PluginContext, data: { shapes: StateObjectRef<SO.Shape.Provider>[] }) => {
    const b = plugin.state.data.build();
    for (const s of data.shapes) b.to(s).apply(ShapeRepresentation3D);
    await b.commit();
  },
});

/** A view of bytes (copied where their buffer is another realm's, a page's file in a test's DOM) */
function dataView(bytes: Uint8Array) {
  const own = bytes.buffer instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
  return new DataView(own.buffer, own.byteOffset, own.byteLength);
}
