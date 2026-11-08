/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Subject } from 'rxjs';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { distinctColors } from '@molstar/core/util/color/distinct';
import { ValueCell } from '@molstar/core/util/value-cell';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { StateTransformer } from '@molstar/core/state';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import { createRenderObject, type GraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { canCullOnGpu } from '@molstar/graphics/gl/renderable/merged';
import { type MergedEntry, mergeRenderObjectsByType } from '@molstar/graphics/repr/merged';
import { Representation } from '@molstar/graphics/repr/representation';
import { LocationIterator } from '@molstar/graphics/geo/util/location-iterator';
import type { ColorTheme } from '@molstar/graphics/theme/color';
import { UniformSizeTheme } from '@molstar/graphics/theme/size/uniform';
import { EmptyLoci } from '@molstar/model/model/loci';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { assignSlots, type TileKinds, type TriangleSlots } from './assign.js';
import { createLipidTileAssigner, type LipidTileAssigner } from './assign-kernel.js';
import { type LipidPatch, parsePatchPdb } from './patch.js';
import { icosphere, isotropicRemesh, offsetSurface, type TriMesh } from './remesh.js';
import { bakeTileSet, type TileSet } from './tiles.js';

// A membrane of lipid tiles (progress/2026-11-08-lipid-tiles.md, Design): a mesh remeshed at the tiles' edge, a surface
// per leaflet, each triangle a tile of its variant; one spheres object per variant (groups: lipids), merged and culled on
// the GPU, its transforms written by the assignment kernel (`gpuInstances`). WebGPU only: without GPU culling nothing.

/** Patches by name (a PDB's text, parsed once): a file the user opened, or `synthetic` */
const patches = new Map<string, LipidPatch | (() => LipidPatch)>();

/** Makes a patch known by `name` (the file's), from PDB text; its tile sets are baked when first wrapped */
export function registerLipidPatch(name: string, pdb: string) {
  patches.set(name, () => parsePatchPdb(pdb));
  for (const k of tileSets.keys()) if (k.startsWith(`${name}|`)) tileSets.delete(k);
}

/** Whether a patch is known by `name` (registered, or `synthetic`) */
export function hasLipidPatch(name: string) {
  return name === 'synthetic' || patches.has(name);
}

function getPatch(name: string) {
  let p = patches.get(name) ?? (name === 'synthetic' ? syntheticPatch : undefined);
  if (typeof p === 'function') {
    p = p();
    patches.set(name, p);
  }
  return p;
}

/** A built-in stand-in: three species on a lattice (not a simulation), to see a membrane without a patch file */
function syntheticPatch(): LipidPatch {
  const lines: string[] = [];
  const names = ['POPC', 'POPE', 'CHL1'];
  let serial = 1;
  let res = 1;
  for (const side of [1, -1]) {
    for (let r = 0; r < 28; ++r) {
      for (let c = 0; c < 24; ++c, ++res) {
        const name = names[((res * 2654435761) % 3) >>> 0];
        const x = (c + (r % 2) * 0.5) * 8 + (side < 0 ? 2 : 0);
        const y = r * 8 * 0.866;
        const atom = (n: string, ax: number, ay: number, az: number) =>
          `ATOM  ${String(serial++ % 100000).padStart(5)}  ${n.padEnd(3)} ${name}${String(res % 10000).padStart(5)}    ${ax.toFixed(3).padStart(8)}${ay.toFixed(3).padStart(8)}${az.toFixed(3).padStart(8)}`;
        lines.push(atom(name === 'CHL1' ? 'O3' : 'P', x, y, 20 * side));
        for (let chain = 0; chain < 2; ++chain) {
          for (let k = 1; k <= 11; ++k) lines.push(atom(`C${k}`, x + (chain - 0.5) * 3.5, y, (20 - k * 1.5) * side));
        }
      }
    }
  }
  return parsePatchPdb(lines.join('\n'), { box: [24 * 8, 28 * 8 * 0.866] });
}

/**
 * Tile sets by patch, leaflet and kinds: baked once, on the main thread (CHARMM-GUI's step4 patch, both leaflets: 5 s
 * at 16 variants, 42 s at 128 on the M1; the worker is a TODO)
 */
const tileSets = new Map<string, TileSet>();

/**
 * Lipids may reach this far across a seam outside its band, Å (`TileSetParams.slack`): small tiles, as a cow's 42 Å, left
 * a star of gaps at every vertex at 0 (Ludo's first try, 2026-11-08); atoms of two tiles meet there instead, under the
 * 2 Å spheres
 */
const SeamSlack = 3;

function getTileSet(patch: string, leaflet: 'outer' | 'inner', edge: number, kinds: TileKinds) {
  const key = `${patch}|${leaflet}|${edge}|${kinds.edgeTypes}|${kinds.vertexColors}|${kinds.variants}|${kinds.seed}`;
  let set = tileSets.get(key);
  if (!set) {
    const p = getPatch(patch);
    if (!p) return undefined;
    set = bakeTileSet(p[leaflet], { edge, ...kinds, slack: SeamSlack });
    tileSets.set(key, set);
  }
  return set;
}

/** One leaflet of a membrane: its tile set, its surface, the triangles' variants and slots */
export interface MembraneLeaflet {
  readonly name: 'outer' | 'inner';
  readonly tileSet: TileSet;
  readonly mesh: TriMesh;
  readonly slots: TriangleSlots;
}

export interface MembraneData {
  readonly leaflets: readonly MembraneLeaflet[];
  readonly kinds: TileKinds;
  readonly edge: number;
  /** the surface's sphere, before the leaflets' offsets */
  readonly sphere: Sphere3D;
}

/** Counts of a membrane: tiles and lipids per leaflet */
export function membraneCounts(data: MembraneData) {
  let tiles = 0;
  let lipids = 0;
  for (const l of data.leaflets) {
    tiles += l.slots.variant.length;
    for (let v = 0; v < l.slots.counts.length; ++v)
      lipids += l.slots.counts[v] * l.tileSet.variants[v].lipidSpecies.length;
  }
  return { tiles, lipids };
}

/**
 * The membrane of `mesh` (any triangulated surface: remeshed at `edge`) or of a sphere, with tiles from `patch`: pure
 * (CPU), O(triangles) past the tile sets' baking (cached per patch)
 */
export function buildMembrane(
  surface: { readonly mesh?: TriMesh; readonly center?: Vec3; readonly radius?: number },
  patch: string,
  edge: number,
  leaflets: 'both' | 'outer' | 'inner',
  kinds: TileKinds,
): MembraneData | string {
  let base: TriMesh;
  // an explicit edge is the caller's: only the suited one refuses a mesh too small
  if (surface.mesh && !(edge > 0)) {
    const size = boundsDiagonal(surface.mesh.positions);
    if (size < 4 * MinTileEdge) {
      return `The mesh is ${size.toFixed(1)} Å across, too small for lipids (tiles of ${MinTileEdge} Å or more): scale it first (a mesh in cm or nm wants ×100 or ×10).`;
    }
  }
  if (!(edge > 0)) edge = suitedEdge(surface);
  if (surface.mesh) base = isotropicRemesh(surface.mesh, edge);
  else {
    base = icosphere(surface.radius ?? 500, edge);
    const c = surface.center ?? Vec3.zero();
    const p = base.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += c[0];
      p[i + 1] += c[1];
      p[i + 2] += c[2];
    }
  }
  const sphere = boundingSphereOf(base.positions, Sphere3D());
  const out: MembraneLeaflet[] = [];
  for (const name of leaflets === 'both' ? (['outer', 'inner'] as const) : [leaflets]) {
    const tileSet = getTileSet(patch, name, edge, kinds);
    if (!tileSet) return `No lipid patch named ${patch}: open a patch (a PDB of a bilayer) first.`;
    const mesh = offsetSurface(base, tileSet.offset);
    out.push({ name, tileSet, mesh, slots: assignSlots(kinds, mesh.indices) });
  }
  return { leaflets: out, kinds, edge, sphere };
}

/** The smallest tile edge, Å: below it a tile holds a handful of lipids and its corners overlap (tiles.ts, r_v) */
export const MinTileEdge = 40;

/**
 * A tile edge suited to a surface (Ludo's cow, 2026-11-08: a fixed 200 Å turned a 1,000 Å cow into 20 chords inside its
 * body): about a thirtieth of its bounding box's diagonal, between `MinTileEdge` and 200 Å; a thin part (a 50 Å leg)
 * keeps its shape only at the smallest
 */
export function suitedEdge(surface: { readonly mesh?: TriMesh; readonly radius?: number }) {
  const diagonal = surface.mesh ? boundsDiagonal(surface.mesh.positions) : 2 * Math.sqrt(3) * (surface.radius ?? 500);
  return Math.round(Math.min(200, Math.max(MinTileEdge, diagonal / 30)));
}

/**
 * Interior variants a tile set gets at `edge` (Ludo's first try, 2026-11-08: two read as a lattice): 8 up to 60 Å
 * tiles, then fewer as the bake's work grows with the tile's area (variants × edge²), 2 at 200 Å (CHARMM-GUI's patch,
 * both leaflets: under a second at 42 Å, about 5 s at 200 Å on the M1)
 */
export function suitedVariants(edge: number) {
  return Math.max(2, Math.min(8, Math.round(8 * (60 / edge) ** 2)));
}

/** The diagonal of the positions' bounding box, Å */
function boundsDiagonal(p: Float32Array) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; ++k) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  }
  return p.length ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
}

function boundingSphereOf(p: Float32Array, out: Sphere3D) {
  const c = Vec3.zero();
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) Vec3.add(c, c, Vec3.create(p[i], p[i + 1], p[i + 2]));
  Vec3.scale(c, c, 1 / Math.max(1, n));
  let r = 0;
  for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]));
  Vec3.copy(out.center, c);
  out.radius = r;
  return out;
}

export const LipidMembraneReprParams = {
  colorBy: PD.Select('residue-name', [
    ['residue-name', 'Residue name'],
    ['uniform', 'Uniform'],
  ] as const),
  color: PD.Color(Color(0xd9b99b)),
  // 2 Å: heavy atoms only, a united-atom radius (hydrogens folded in) that closes the gaps a carbon's 1.7 Å leaves
  sizeFactor: PD.Numeric(2, { min: 0.5, max: 3, step: 0.1 }, { description: 'The atoms’ radius, Å' }),
};
export type LipidMembraneReprProps = PD.Values<typeof LipidMembraneReprParams>;

/** A species' color: distinct colors by species index across both leaflets (residue names as the tile sets have them) */
function speciesColors(data: MembraneData) {
  const names = new Map<string, number>();
  for (const l of data.leaflets) for (const s of l.tileSet.species) if (!names.has(s)) names.set(s, names.size);
  const palette = distinctColors(Math.max(2, names.size));
  return (name: string) => palette[names.get(name) ?? 0];
}

/**
 * The membrane's representation: a spheres object per (leaflet, variant) with tiles, merged with GPU culling; the
 * transforms from the assignment kernel. No objects where the device cannot cull on the GPU (WebGL2)
 */
export function LipidMembraneRepresentation(graphics: GraphicsContext | undefined) {
  const updated = new Subject<number>();
  let version = 0;
  let renderObjects: GraphicsRenderObject[] = [];
  let merged = new Map<string, MergedEntry<number>>();
  let assigners: LipidTileAssigner[] = [];
  let props = PD.getDefaultValues(LipidMembraneReprParams);
  const state = Representation.createState();
  let groupCount = 0;

  function build(data: MembraneData) {
    for (const a of assigners) a.destroy();
    assigners = [];
    if (!graphics?.compute || !canCullOnGpu(graphics)) {
      renderObjects = [];
      return;
    }
    const colorOf = speciesColors(data);
    const entries: { visual: number; renderObject: GraphicsRenderObject }[] = [];
    const bounds = Sphere3D.clone(data.sphere);
    groupCount = 0;
    for (const leaflet of data.leaflets) {
      const { tileSet, mesh, slots } = leaflet;
      const assigner = createLipidTileAssigner(
        graphics.compute,
        data.kinds,
        data.edge,
        mesh.positions,
        mesh.indices,
        slots,
      );
      assigners.push(assigner);
      bounds.radius = data.sphere.radius + Math.abs(tileSet.offset) + tileSet.sphere[3];
      tileSet.variants.forEach((tile, v) => {
        const n = slots.counts[v];
        const lipids = tile.lipidSpecies.length;
        if (n === 0 || lipids === 0) return;
        const atoms = tile.positions.length / 3;
        const groups = new Float32Array(atoms);
        for (let l = 0; l < lipids; ++l) groups.fill(l, tile.lipidAtomStart[l], tile.lipidAtomStart[l + 1]);
        const spheres = Spheres.create(tile.positions, groups, atoms);
        // gridless (one cell, the membrane's sphere), the CPU's transforms a placeholder: the kernel writes them
        const transform = createTransform(new Float32Array(n * 16), n, undefined, 0, 0);
        const species = tile.lipidSpecies;
        const names = tileSet.species;
        const locationIterator = LocationIterator(
          lipids,
          n,
          1,
          (g: number) => ({ kind: 'lipid', species: species[g] }) as never,
        );
        const uniform = props.colorBy === 'uniform';
        const color = {
          granularity: uniform ? 'uniform' : 'group',
          color: (location: { species?: number }) =>
            uniform || location.species === undefined ? props.color : colorOf(names[location.species]),
          props: {},
          description: 'Lipid species',
        } as unknown as ColorTheme<any>;
        const theme = { color, size: UniformSizeTheme({}, { value: props.sizeFactor }) };
        const p = { ...PD.getDefaultValues(Spheres.Params), gpuCulling: true as const };
        const values = Spheres.Utils.createValues(spheres, transform, locationIterator, theme, p);
        ValueCell.update(values.boundingSphere, Sphere3D.clone(bounds));
        Object.assign(values, { gpuInstances: ValueCell.create(assigner.writer(v)) });
        entries.push({
          visual: v,
          renderObject: createRenderObject('spheres', values, Spheres.Utils.createRenderableState(p), -1),
        });
        groupCount += lipids * n;
      });
    }
    const out: GraphicsRenderObject[] = [];
    merged = mergeRenderObjectsByType(entries, true, new Map(), out, true, true, graphics);
    renderObjects = out;
  }

  const repr: Representation<MembraneData, typeof LipidMembraneReprParams> = {
    label: 'Lipid membrane',
    updated,
    get groupCount() {
      return groupCount;
    },
    get renderObjects() {
      return renderObjects;
    },
    get geometryVersion() {
      return version;
    },
    get props() {
      return props;
    },
    params: LipidMembraneReprParams,
    state,
    theme: { color: undefined as never, size: undefined as never },
    createOrUpdate: (p, data) =>
      Task.create('Lipid membrane', async () => {
        props = { ...props, ...p };
        if (data) build(data);
        version += 1;
        updated.next(version);
      }),
    setState: (s) => {
      Representation.updateState(state, s);
      for (const o of renderObjects) {
        if (s.visible !== undefined) Object.assign(o.state, { visible: s.visible });
      }
    },
    setTheme: () => {},
    getLoci: () => EmptyLoci,
    getAllLoci: () => [],
    eachLocation: () => {},
    mark: () => false,
    destroy: () => {
      for (const a of assigners) a.destroy();
      assigners = [];
      renderObjects = [];
      merged.clear();
    },
  };
  return repr;
}

export const LipidMembraneParams = {
  mesh: PD.Text('', { description: 'A mesh (a shape) by state ref; empty: a sphere of `radius` at `center`' }),
  center: PD.Vec3(Vec3.zero()),
  radius: PD.Numeric(500, { min: 50, max: 100000, step: 10 }, { description: 'The sphere’s radius, Å' }),
  patch: PD.Text('synthetic', {
    description: 'The lipid patch by name (`registerLipidPatch`): a file opened, or synthetic',
  }),
  edge: PD.Numeric(
    0,
    { min: 0, max: 400, step: 10 },
    { description: 'The tiles’ edge, Å (0: suited to the surface, `suitedEdge`)' },
  ),
  leaflets: PD.Select('both', [
    ['both', 'Both'],
    ['outer', 'Outer'],
    ['inner', 'Inner'],
  ] as const),
  variants: PD.Numeric(
    0,
    { min: 0, max: 16, step: 1 },
    { description: 'Interior variants of each tile (0: suited to the edge, `suitedVariants`)' },
  ),
  edgeTypes: PD.Numeric(1, { min: 1, max: 2, step: 1 }),
  seed: PD.Numeric(1, { min: 0, max: 1e6, step: 1 }),
  ...LipidMembraneReprParams,
};
export type LipidMembraneProps = PD.Values<typeof LipidMembraneParams>;

/** The mesh of a shape in the state (its provider's geometry, its first instance's transform applied) */
async function shapeMesh(
  plugin: PluginContext,
  ref: string,
  runtime: Parameters<Parameters<typeof Task.create>[1]>[0],
) {
  const cell = plugin.state.data.cells.get(ref);
  let obj = cell?.obj;
  if (obj && SO.Shape.Representation3D.is(obj)) obj = plugin.state.data.cells.get(cell!.transform.parent)?.obj;
  if (!obj || !SO.Shape.Provider.is(obj)) return undefined;
  // the getters read their props (OBJ's and PLY's coloring, grouping): the provider's defaults
  const shape = await obj.data.getShape(runtime, obj.data.data, PD.getDefaultValues(obj.data.params) as never);
  const geometry = shape.geometry as {
    kind?: string;
    vertexBuffer?: ValueCell<Float32Array>;
    indexBuffer?: ValueCell<Uint32Array>;
    vertexCount?: number;
    triangleCount?: number;
  };
  if (geometry.kind !== 'mesh' || !geometry.vertexBuffer || !geometry.indexBuffer) return undefined;
  const positions = geometry.vertexBuffer.ref.value.slice(0, geometry.vertexCount! * 3);
  const t = shape.transforms[0];
  if (t) {
    const v = Vec3();
    for (let i = 0; i < positions.length; i += 3) {
      Vec3.transformMat4(v, Vec3.create(positions[i], positions[i + 1], positions[i + 2]), t);
      positions.set(v, i);
    }
  }
  return { positions, indices: geometry.indexBuffer.ref.value.slice(0, geometry.triangleCount! * 3) } as TriMesh;
}

/** Whether lipid membranes can be drawn here: WebGPU with GPU culling (not WebGL2) */
export function canDrawLipidMembranes(plugin: PluginContext) {
  const graphics = plugin.canvas3d?.graphics;
  return !!graphics?.compute && canCullOnGpu(graphics);
}

export type LipidMembrane = typeof LipidMembrane;
export const LipidMembrane = PluginStateTransform.BuiltIn({
  name: 'mesoscale-lipid-membrane',
  display: { name: 'Lipid membrane', description: 'A mesh or a sphere wrapped with lipid tiles (WebGPU)' },
  from: SO.Root,
  to: SO.Shape.Representation3D,
  params: LipidMembraneParams,
})({
  canAutoUpdate: ({ oldParams, newParams }) =>
    oldParams.mesh === newParams.mesh && oldParams.patch === newParams.patch && oldParams.edge === newParams.edge,
  apply({ params }, plugin: PluginContext) {
    return Task.create('Lipid membrane', async (runtime) => {
      const mesh = params.mesh ? await shapeMesh(plugin, params.mesh, runtime) : undefined;
      if (params.mesh && !mesh) throw new Error(`No mesh at ${params.mesh}.`);
      const surface = { mesh, center: params.center, radius: params.radius };
      const edge = params.edge > 0 ? params.edge : suitedEdge(surface);
      const variants = params.variants > 0 ? params.variants : suitedVariants(edge);
      const kinds = { edgeTypes: params.edgeTypes, vertexColors: 1, variants, seed: params.seed };
      const data = buildMembrane(surface, params.patch, edge, params.leaflets, kinds);
      if (typeof data === 'string') throw new Error(data);
      if (!canDrawLipidMembranes(plugin)) {
        plugin.log.warn('Lipid membranes are drawn with WebGPU only: switch the backend to WebGPU to see this one.');
      }
      const repr = LipidMembraneRepresentation(plugin.canvas3d?.graphics);
      await repr.createOrUpdate(params, data).runInContext(runtime);
      const { tiles, lipids } = membraneCounts(data);
      return new SO.Shape.Representation3D(
        { repr: repr as never, sourceData: data },
        { label: 'Lipid membrane', description: `${lipids.toLocaleString()} lipids, ${tiles.toLocaleString()} tiles` },
      );
    });
  },
  update({ b, oldParams, newParams }) {
    return Task.create('Lipid membrane', async (runtime) => {
      const rebuild = Object.keys(LipidMembraneParams).some(
        (k) =>
          !(k in LipidMembraneReprParams) &&
          JSON.stringify(oldParams[k as never]) !== JSON.stringify(newParams[k as never]),
      );
      if (rebuild) return StateTransformer.UpdateResult.Recreate;
      await b.data.repr.createOrUpdate(newParams as never, b.data.sourceData as never).runInContext(runtime);
      return StateTransformer.UpdateResult.Updated;
    });
  },
});
