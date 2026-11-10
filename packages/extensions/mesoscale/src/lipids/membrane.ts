/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Subject } from 'rxjs';
import { type RuntimeContext, Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { distinctColors } from '@molstar/core/util/color/distinct';
import { ValueCell } from '@molstar/core/util/value-cell';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { type State, type StateObjectCell, StateTransformer } from '@molstar/core/state';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { createIdentityTransform, createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { BaseGeometry } from '@molstar/graphics/geo/geometry/base';
import type { BaseValues } from '@molstar/graphics/gl/renderable/schema';
import { Clip } from '@molstar/core/util/clip';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import { createRenderObject, type GraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { canCullOnGpu } from '@molstar/graphics/gl/renderable/merged';
import { type MergedEntry, mergeRenderObjectsByType } from '@molstar/graphics/repr/merged';
import { Representation } from '@molstar/graphics/repr/representation';
import { LocationIterator } from '@molstar/graphics/geo/util/location-iterator';
import { LodNominalRadius, orderLodLevels } from '@molstar/graphics/geo/geometry/lod-levels';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { PositionGroupStride } from '@molstar/graphics/geo/geometry/center-group';
import { createDataArray } from '@molstar/graphics/gl/renderable/util';
import { createColors, createValueColor } from '@molstar/graphics/geo/geometry/color-data';
import type { ColorTheme } from '@molstar/graphics/theme/color';
import { UniformSizeTheme } from '@molstar/graphics/theme/size/uniform';
import { EmptyLoci } from '@molstar/model/model/loci';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { assignSlots, type TileKinds, type TriangleSlots, variantCount } from './assign.js';
import { createLipidTileAssigner, type LipidTileAssigner } from './assign-kernel.js';
import { type LipidPatch, parsePatchPdb } from './patch.js';
import {
  cellSide,
  type CutterRegions,
  cutterRegions,
  type CutterTable,
  cutterTable,
  kindCounts,
  regionKey,
} from './cutter.js';
import { createLipidCutter, type LipidCutter } from './cutter-kernel.js';
import { ElementSymbolColors, elementSymbolColor } from '@molstar/graphics/theme/color/element-symbol';
import type { ElementSymbol } from '@molstar/model/model/structure/model/types';
import { headOffset, patchRaster, patchSurface, type SwitchSpheres } from './far-surface.js';
import type { Texture } from '@molstar/graphics/gl/texture';
import {
  createLipidSelection,
  createPartVisibility,
  type CutBand,
  enterPx,
  estimateLipids,
  type LipidSelection,
  type MembraneFar,
  type PartVisibility,
  poolCapacities,
  type SelectionInput,
  slotTotals,
  wholeTriangles,
} from './procedural.js';
import { enclosures, type TrianglePart, triangleTree } from './triangle-tree.js';
import { createMembraneViews, showPartSurfaces } from './views.js';
import { type MembraneMix, mixOf, mixTable, standIns } from './mixes.js';
import type { GpuInstanceWriter } from '@molstar/graphics/gl/renderable/merged-culler';
import { farTriangles, icosphere, isotropicRemeshSteps, offsetSurface, type TriMesh } from './remesh.js';
import { bakeTileSetSteps, type Tile, type TileSet } from './tiles.js';

// A membrane of lipid tiles (progress/2026-11-08-lipid-tiles.md, Design): a mesh remeshed at the tiles' edge, a surface
// per leaflet, each triangle a tile of its variant; one spheres object per variant (groups: lipids), merged and culled on
// the GPU, its transforms written by the assignment kernel (`gpuInstances`). WebGPU only: without GPU culling nothing.

/** Patches by name (a PDB's text, parsed once): a file the user opened, or `synthetic` */
const patches = new Map<string, LipidPatch | (() => LipidPatch)>();

/** Makes a patch known by `name` (the file's), from PDB text; its tile sets are baked when first wrapped */
export function registerLipidPatch(name: string, pdb: string) {
  patches.set(name, () => parsePatchPdb(pdb));
  for (const k of tileSets.keys()) if (k.startsWith(`${name}|`)) tileSets.delete(k);
  for (const k of cutterTables.keys()) if (k.startsWith(`${name}|`)) cutterTables.delete(k);
}

/** Forgets a patch registered by `name` and what was made from it (a test restores the registry with it) */
export function forgetLipidPatch(name: string) {
  patches.delete(name);
  for (const k of tileSets.keys()) if (k.startsWith(`${name}|`)) tileSets.delete(k);
  for (const k of cutterTables.keys()) if (k.startsWith(`${name}|`)) cutterTables.delete(k);
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

/** Cutter tables by patch and leaflet (`cutter.ts`) */
const cutterTables = new Map<string, CutterTable>();

/** Conformers a species in the cutter's members (`cutter.ts`: why not a member a patch lipid) */
const CutterConformers = 4;

/** a patch leaflet's kinds' counts by its regions' cells (`kindCounts`: per patch and seed, ~20 ms) */
const kindCountCache = new WeakMap<CutterTable, Map<string, Uint32Array>>();
function getKindCounts(table: CutterTable, cells: Float32Array) {
  let byCells = kindCountCache.get(table);
  if (!byCells) kindCountCache.set(table, (byCells = new Map()));
  // the cells' table by its first entries (a seed's): a few floats, not the table
  const key = Array.from(cells.subarray(0, 16)).join();
  let counts = byCells.get(key);
  if (!counts) byCells.set(key, (counts = kindCounts(table, cells)));
  return counts;
}

function getCutterTable(patch: string, leaflet: 'outer' | 'inner') {
  const key = `${patch}|${leaflet}`;
  let table = cutterTables.get(key);
  if (!table) {
    const p = getPatch(patch);
    if (!p) return undefined;
    table = cutterTable(p[leaflet], CutterConformers);
    cutterTables.set(key, table);
  }
  return table;
}

function* getTileSet(
  patch: string,
  leaflet: 'outer' | 'inner',
  edge: number,
  kinds: TileKinds,
): Generator<MembraneProgress, TileSet | undefined> {
  const key = `${patch}|${leaflet}|${edge}|${kinds.edgeTypes}|${kinds.vertexColors}|${kinds.variants}|${kinds.seed}`;
  let set = tileSets.get(key);
  if (!set) {
    const p = getPatch(patch);
    if (!p) return undefined;
    const params = { edge, ...kinds, slack: SeamSlack };
    const steps = bakeTileSetSteps(p[leaflet], params);
    const max = variantCount(kinds);
    for (let r = steps.next(); ; r = steps.next()) {
      if (r.done) {
        set = r.value;
        break;
      }
      yield { message: `Baking lipid tiles (${leaflet}) ${r.value}/${max}`, current: r.value, max };
    }
    tileSets.set(key, set);
  }
  return set;
}

/**
 * Throws past the device's buffers, before any is made for the draw (Ludo's third try, 2026-11-08: the cutter's 27.7 M
 * lipids said ok, then lost the WebGPU device): the GPU culler holds each instance's transform once a level region and
 * once more (`merged-culler.ts`, `AttributeFloats.aTransform`, 48 B; the sphere raster's regions, where the device has
 * it, doubling the levels') in one storage buffer, its largest
 */
export function checkInstances(instances: number, levels: number, maxStorageBufferSize: number, raster: boolean) {
  const bytes = instances * ((raster ? 2 : 1) * Math.max(1, levels) + 1) * 48;
  if (bytes <= maxStorageBufferSize) return;
  const mb = (b: number) => `${Math.ceil(b / 2 ** 20).toLocaleString()} MB`;
  throw new Error(
    `This membrane's ${instances.toLocaleString()} instances need ${mb(bytes)} in one buffer, past this GPU’s buffers (${mb(maxStorageBufferSize)}): wrap it with tiles, or a coarser or smaller mesh.`,
  );
}

/** Thrown inside a membrane's build that a newer one superseded (caught by it, never seen outside) */
const Superseded = new Error('superseded by a newer build');

/** A stage of a membrane's build, for its task's progress (Prism's status pill) */
export interface MembraneProgress {
  readonly message: string;
  readonly current?: number;
  readonly max?: number;
}

/**
 * Runs a membrane's build steps on a task's runtime: a yield to the page whenever a step ends past `YieldMs` since the
 * last (a cancel stops it there: `update` throws), the stage on the status line (Ludo, 2026-11-08: "a progress bar so
 * we know computation is happening and is not blocking")
 */
export async function runSteps<T>(steps: Generator<MembraneProgress, T>, runtime: RuntimeContext): Promise<T> {
  const step = stepper(runtime);
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    await step(r.value);
  }
}

/** A stage's end on `runtime`: a yield (and the stage said, cancellable or not) when `YieldMs` passed since the last */
function stepper(runtime: RuntimeContext, canAbort = true) {
  let last = performance.now();
  return async (p: MembraneProgress) => {
    if (performance.now() - last <= YieldMs) return;
    await runtime.update({ ...p, isIndeterminate: p.max === undefined, canAbort });
    last = performance.now();
  };
}

/** The longest stretch a membrane's build keeps the main thread between yields, aimed at, ms */
export const YieldMs = 30;

function drain<T>(steps: Generator<MembraneProgress, T>): T {
  for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value;
}

/** One leaflet of a membrane: its tile set, its surface, the triangles' variants and slots */
export interface MembraneLeaflet {
  readonly name: 'outer' | 'inner';
  readonly tileSet: TileSet;
  readonly mesh: TriMesh;
  readonly slots: TriangleSlots;
  /** the cutter's view of it, its far surface's colours (round 4b item 5: the cutter's looks): the patch, its regions */
  readonly table: CutterTable;
  readonly regions: CutterRegions;
}

/**
 * One leaflet cut by the cutter (`cutter.ts`) from triangles of a mesh: the whole mesh (`method: 'cutter'`), or the
 * triangles a remesh lost (`tiles`: a limb thinner than the tiles' edge)
 */
export interface CutLeaflet {
  readonly name: 'outer' | 'inner';
  readonly table: CutterTable;
  readonly mesh: TriMesh;
  /** the mesh's regions (`cutter.ts`), shared by its leaflets */
  readonly regions: CutterRegions;
  /**
   * A cell's membrane (round 7: a cut leaflet a part and leaflet, on the part's own triangles, its table the part's mix):
   * its index in `MembraneData.parts`; none: the whole mesh
   */
  readonly part?: number;
}

/** How a membrane is made: matched-edge tiles on a remesh, or cellPACKgpu's cutter on the mesh's own triangles */
export type MembraneMethod = 'tiles' | 'cutter';

export interface MembraneData {
  readonly method: MembraneMethod;
  readonly leaflets: readonly MembraneLeaflet[];
  readonly cut: readonly CutLeaflet[];
  readonly kinds: TileKinds;
  readonly edge: number;
  /** the surface's sphere, before the leaflets' offsets */
  readonly sphere: Sphere3D;
  /** the cutter's mesh's parts (meshes wrapped as one, round 6), and per part the parts enclosing it */
  readonly parts?: readonly TrianglePart[];
  readonly enclosedBy?: readonly Int32Array[];
  /** the parts' whole mesh (which part encloses the eye: `createPartVisibility`) */
  readonly whole?: TriMesh;
  /** the parts whose mix the patch could not make (a species it lacks): cut from the patch as it is (round 7) */
  readonly unmixed?: readonly string[];
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
  method: MembraneMethod = 'tiles',
): MembraneData | string {
  return drain(buildMembraneSteps(surface, patch, edge, leaflets, kinds, method));
}

/** `buildMembrane` a stage at a time (`runSteps` on a task) */
export function* buildMembraneSteps(
  surface: {
    readonly mesh?: TriMesh;
    readonly center?: Vec3;
    readonly radius?: number;
    readonly parts?: readonly TrianglePart[];
  },
  patch: string,
  edge: number,
  leaflets: 'both' | 'outer' | 'inner',
  kinds: TileKinds,
  method: MembraneMethod = 'tiles',
): Generator<MembraneProgress, MembraneData | string> {
  let base: TriMesh;
  const names = leaflets === 'both' ? (['outer', 'inner'] as const) : [leaflets];
  if (method === 'cutter') {
    // the mesh's own triangles (a sphere: an icosphere at the suited edge)
    const mesh =
      surface.mesh ?? centered(icosphere(surface.radius ?? 500, edge > 0 ? edge : suitedEdge(surface)), surface.center);
    if (mesh.indices.length / 3 > MaxCutterTriangles) {
      return `The mesh has ${(mesh.indices.length / 3).toLocaleString()} triangles, over the cutter's ${MaxCutterTriangles.toLocaleString()}: decimate it first (its triangles are cut into cells, they need not be small).`;
    }
    const cut: CutLeaflet[] = [];
    yield { message: 'Finding the surface’s regions' };
    const regions = cutterRegions(mesh.positions, mesh.indices, kinds.seed);
    const plain = { outer: getCutterTable(patch, 'outer'), inner: getCutterTable(patch, 'inner') };
    for (const name of names)
      if (!plain[name]) return `No lipid patch named ${patch}: open a patch (a PDB of a bilayer) first.`;
    const sphere = boundingSphereOf(mesh.positions, Sphere3D());
    // round 6: meshes wrapped as one, a part each; which encloses which (a part inside a closed one is hidden while the
    // eye is outside it)
    const parts = surface.parts && surface.parts.length > 1 ? surface.parts : undefined;
    if (!parts) {
      for (const name of names) cut.push({ name, table: plain[name]!, mesh, regions });
      return { method, leaflets: [], cut, kinds, edge, sphere };
    }
    yield { message: 'Finding the enclosed membranes' };
    const enclosedBy = enclosures(triangleTree(mesh.positions, mesh.indices, parts), mesh.positions, mesh.indices);
    // round 7: a cut leaflet a part and leaflet, on the part's triangles (the whole mesh's regions: the same seams), its
    // table the part's lipid mix (`mixes.ts`; the LD a monolayer: its outer leaflet alone), the patch as it is where the
    // part has none or the patch lacks a species of it (said)
    yield { message: 'Mixing each membrane’s lipids' };
    const unmixed: string[] = [];
    const scratch = new Int32Array(regions.count).fill(-1);
    for (let p = 0; p < parts.length; ++p) {
      const own = partMesh(mesh, regions, parts[p], scratch);
      const found = mixOf(parts[p].name);
      // the patch has every species of the mix (either leaflet), or the part is cut from it as it is, both leaflets
      // (review S6: checked, not caught: another error is a bug, thrown)
      const mix = found && mixable(found, plain.outer, plain.inner) ? found : undefined;
      if (found && !mix) unmixed.push(parts[p].name);
      for (const name of names) {
        if (mix && name === 'inner' && !mix.inner) continue;
        let table = plain[name]!;
        if (mix) {
          const other = plain[name === 'outer' ? 'inner' : 'outer'];
          table = mixTable(table, other, standIns(mix[name] ?? mix.outer, mix.plasma), mixSeed(kinds.seed, p, name));
        }
        cut.push({ name, table, mesh: own.mesh, regions: own.regions, part: p });
      }
    }
    return { method, leaflets: [], cut, kinds, edge, sphere, parts, enclosedBy, whole: mesh, unmixed };
  }
  // tiles build every lipid at once: refused past `MaxTileLipids` (round 5: a billion at x600), the cutter named
  const table = getCutterTable(patch, names[0]);
  if (table) {
    const area = surface.mesh ? meshArea(surface.mesh) : 4 * Math.PI * (surface.radius ?? 500) ** 2;
    const lipids = Math.round(
      area * names.length * (table.memberStart[table.members.length] / (table.box[0] * table.box[1])),
    );
    if (lipids > MaxTileLipids) {
      return `Tiles build every lipid at once, and this surface takes about ${(lipids / 1e6).toFixed(0)} M (over ${MaxTileLipids / 1e6} M): wrap it with lipids (the cutter), which makes them where they are seen.`;
    }
  }
  // an explicit edge is the caller's: only the suited one refuses a mesh too small
  if (surface.mesh && !(edge > 0)) {
    const size = boundsDiagonal(surface.mesh.positions);
    if (size < 4 * MinTileEdge) {
      return `The mesh is ${size.toFixed(1)} Å across, too small for lipids (tiles of ${MinTileEdge} Å or more): scale it first (a mesh in cm or nm wants ×100 or ×10).`;
    }
  }
  if (!(edge > 0)) edge = suitedEdge(surface);
  if (surface.mesh) {
    const iterations = 5;
    const steps = isotropicRemeshSteps(surface.mesh, edge, { iterations });
    for (let r = steps.next(); ; r = steps.next()) {
      if (r.done) {
        base = r.value;
        break;
      }
      yield { message: `Remeshing at ${edge} Å ${r.value + 1}/${iterations}`, current: r.value, max: iterations };
    }
  } else base = centered(icosphere(surface.radius ?? 500, edge), surface.center);
  const sphere = boundingSphereOf(base.positions, Sphere3D());
  const out: MembraneLeaflet[] = [];
  // the parts the remesh lost (a cow's legs, thinner than the edge: Ludo's second try, 2026-11-08), cut on their own
  // triangles
  yield { message: 'Finding the parts the remesh lost' };
  const lost = surface.mesh ? farTriangles(surface.mesh, base, LostDistance) : undefined;
  const cut: CutLeaflet[] = [];
  const lostRegions =
    lost && lost.indices.length > 0 ? cutterRegions(lost.positions, lost.indices, kinds.seed) : undefined;
  for (const name of names) {
    const tileSet = yield* getTileSet(patch, name, edge, kinds);
    if (!tileSet) return `No lipid patch named ${patch}: open a patch (a PDB of a bilayer) first.`;
    const mesh = offsetSurface(base, tileSet.offset);
    out.push({
      name,
      tileSet,
      mesh,
      slots: assignSlots(kinds, mesh.indices),
      table: getCutterTable(patch, name)!,
      regions: cutterRegions(mesh.positions, mesh.indices, kinds.seed),
    });
    if (lost && lostRegions) cut.push({ name, table: getCutterTable(patch, name)!, mesh: lost, regions: lostRegions });
  }
  return { method, leaflets: out, cut, kinds, edge, sphere };
}

/**
 * A part of a mesh as a mesh of its own (round 7): its vertices (a range: `concatMeshes` appends each part's) copied, its
 * triangles' indices rebased, its triangles' regions (the whole mesh's: their frames and cells shared), renumbered in
 * the order its triangles meet them, their rows alone and each keyed by its index in the whole mesh (review X1: a part
 * and leaflet uploaded the whole mesh's table three times; the key keeps the same lipids a triangle). `scratch`, the
 * whole mesh's regions long and all -1, is left so (one for every part: O(the part), not O(the mesh), a part)
 */
export function partMesh(
  mesh: TriMesh,
  regions: CutterRegions,
  part: TrianglePart,
  scratch = new Int32Array(regions.count).fill(-1),
) {
  const ix = mesh.indices.subarray(part.start * 3, part.end * 3);
  let lo = Infinity;
  let hi = -1;
  for (let i = 0; i < ix.length; ++i) {
    if (ix[i] < lo) lo = ix[i];
    if (ix[i] > hi) hi = ix[i];
  }
  if (hi < 0) lo = 0;
  const indices = new Uint32Array(ix.length);
  for (let i = 0; i < ix.length; ++i) indices[i] = ix[i] - lo;
  const positions = mesh.positions.slice(lo * 3, (hi + 1) * 3);
  const T = part.end - part.start;
  const regionOf = new Uint32Array(T);
  const whole: number[] = [];
  for (let t = 0; t < T; ++t) {
    const g = regions.regionOf[part.start + t];
    let r = scratch[g];
    if (r < 0) {
      r = scratch[g] = whole.length;
      whole.push(g);
    }
    regionOf[t] = r;
  }
  const table = new Float32Array(whole.length * 16);
  const keys = new Uint32Array(whole.length);
  for (let r = 0; r < whole.length; ++r) {
    const g = whole[r];
    table.set(regions.table.subarray(g * 16, g * 16 + 16), r * 16);
    keys[r] = regionKey(regions, g);
    scratch[g] = -1;
  }
  return {
    mesh: { positions, indices } as TriMesh,
    regions: { regionOf, table, count: whole.length, cells: regions.cells, keys } as CutterRegions,
  };
}

/** Whether the patch's leaflets hold every species `mix` stands its classes in by (`standIns`) */
function mixable(mix: MembraneMix, outer: CutterTable | undefined, inner: CutterTable | undefined) {
  const has = (s: string) => !!outer?.species.includes(s) || !!inner?.species.includes(s);
  for (const leaflet of [mix.outer, mix.inner]) {
    if (!leaflet) continue;
    for (const s of Object.keys(standIns(leaflet, mix.plasma))) if (!has(s)) return false;
  }
  return true;
}

/** A part and leaflet's seed of its mix's shuffle */
function mixSeed(seed: number, part: number, leaflet: 'outer' | 'inner') {
  return (Math.imul(seed + 1, 0x9e3779b1) ^ (part * 2 + (leaflet === 'inner' ? 1 : 0))) >>> 0;
}

/** The lipids tiles may build (all at once: memory and a wait), about the cutter's budget × 25 */
export const MaxTileLipids = 50_000_000;

/** The cutter's triangles at most: a selection's unit key is triangle × 2^32 + cell, exact below 2^53 (review S7) */
export const MaxCutterTriangles = 2 ** 21;

/** A mesh's area, Å² */
function meshArea(mesh: TriMesh) {
  const p = mesh.positions;
  const ix = mesh.indices;
  let sum = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return sum;
}

/**
 * How far, Å, a triangle of the input may lie from the remesh before the cutter covers it: a leaflet is about 20 Å
 * thick, so the tiles cover what lies closer
 */
export const LostDistance = 10;

function centered(mesh: TriMesh, center: Vec3 | undefined) {
  const c = center ?? Vec3.zero();
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] += c[0];
    p[i + 1] += c[1];
    p[i + 2] += c[2];
  }
  return mesh;
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

/**
 * The bounds of a cut leaflet's members (their one cell for the GPU culler): its own mesh's sphere, not the membrane's
 * (the tiles' remesh, without the parts it lost: a leg's lipids were culled, review M1), grown by a lipid's length
 */
export function cutBounds(leaflet: CutLeaflet) {
  const b = boundingSphereOf(leaflet.mesh.positions, Sphere3D());
  b.radius += 40;
  return b;
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

/**
 * A membrane's levels of detail: Mol*'s spheres levels by size on screen (`Spheres.LodPixelPresets`' pixel sizes), but
 * a sheet's scale: n spheres drawn as n / stride of radius √stride keep its area (scale bias 2). The presets' bias of
 * about 3 keeps a volume's, and a membrane seen face on read as scattered dots through which the scene showed (Dawn,
 * the cow ×100 whole, 2026-11-08)
 */
export function membraneLevels(detail: MembraneDetail, custom: readonly MembraneLevel[] = DefaultCustomLevels) {
  // custom (Ludo tunes them in the membrane's properties, 2026-11-08): by distance from the camera, each level from its
  // start to the next's
  if (detail === 'custom') {
    const lodLevels = custom.map((l, j) => ({
      minDistance: l.distance,
      maxDistance: custom[j + 1]?.distance ?? 1e7,
      overlap: 0,
      stride: Math.max(1, Math.round(l.stride)),
      scaleBias: l.bias,
    }));
    return { lodLevels, lodPixelSize: 0 };
  }
  const lodPixelSize = Spheres.LodPixelPresets[detail === 'off' ? 'balanced' : detail].lodPixelSize;
  // the distances are the pixel boundaries' (`getLodLevelsValue` with a pixel size), these unused. Round 2 dropped a 512
  // stride (half a small sphere's pixels drawn); that was before the levels' scales reached the membrane (`4ac0c0de8`):
  // a 1-in-512 custom level now draws a sheet (Dawn). The presets' coarser levels are round 4's
  const lodLevels = [1, 8, 64].map((stride, j) => ({
    minDistance: j,
    maxDistance: j + 1,
    overlap: 0,
    stride,
    scaleBias: stride === 1 ? 1 : 2,
  }));
  return { lodLevels, lodPixelSize };
}

/** How a membrane's levels are chosen: off, a preset (by size on screen), or custom levels by distance */
export type MembraneDetail = 'off' | 'quality' | 'balanced' | 'performance' | 'custom';

/** A custom level: where it starts (Å from the camera), its stride (1 in n atoms drawn), its scale bias (2: a sheet's) */
export interface MembraneLevel {
  readonly distance: number;
  readonly stride: number;
  readonly bias: number;
}

/** The custom levels a membrane starts with: the presets' strides at round distances, for Ludo to tune (at most 4) */
export const DefaultCustomLevels: readonly MembraneLevel[] = [
  { distance: 0, stride: 1, bias: 1 },
  { distance: 2000, stride: 8, bias: 2 },
  { distance: 8000, stride: 64, bias: 2 },
];

/** A middle look's atoms down to this px at least (the gate's S1): the stride-1 level's lower edge, 8.8 px, and a bit */
export const MiddlePxMin = 9;

/** A cut leaflet's middle distance (round 8): the coarse sphere levels, the heads as shells, or by parallax */
export type MembraneMiddle = 'coarse' | 'shells' | 'parallax';

/** A membrane's atoms close up by zoom: by element, or its carbons its species' colour (`elementColor`) */
export type MembraneAtomColors = 'element' | 'carbon-species';

export const LipidMembraneReprParams = {
  colorBy: PD.Select('residue-name', [
    ['residue-name', 'Residue name'],
    ['uniform', 'Uniform'],
  ] as const),
  color: PD.Color(Color(0xd9b99b)),
  // 2 Å: heavy atoms only, a united-atom radius (hydrogens folded in) that closes the gaps a carbon's 1.7 Å leaves
  sizeFactor: PD.Numeric(2, { min: 0.5, max: 3, step: 0.1 }, { description: 'The atoms’ radius, Å' }),
  // Mol*'s spheres levels by size on screen (`Spheres.LodPixelPresets`), each lipid's or tile's at its own distance
  detail: PD.Select<MembraneDetail>('balanced', [
    ['off', 'Atoms always'],
    ['quality', 'Quality'],
    ['balanced', 'Balanced'],
    ['performance', 'Performance'],
    ['custom', 'Custom levels'],
  ]),
  // with `detail: custom` (`membraneLevels`)
  levels: PD.Value<readonly MembraneLevel[]>(DefaultCustomLevels, { isHidden: true }),
  // made per view (lipid-procedural; Ludo, 2026-11-08: both far looks, to compare): the cutter's lipids where large
  // enough on screen, the textured surface beneath (`texture`, `both`)
  far: PD.Select<MembraneFar>('both', [
    ['both', 'Spheres, then texture'],
    ['spheres', 'Spheres'],
    ['texture', 'Texture'],
  ]),
  atomsPx: PD.Numeric(2, { min: 0.25, max: 16, step: 0.25 }, { description: 'Texture: lipids from this size, px' }),
  // round 5: 2 px, where the patch texture takes over as the spheres look (the switch's colour, `lipid-switch`); under
  // it a frame draws lipids by the hundred thousand for a few px each (x600, M1, Dawn: 140-240 ms at 0.5, 11 at 2)
  spheresPx: PD.Numeric(2, { min: 0.05, max: 8, step: 0.05 }, { description: 'Spheres: lipids down to this size, px' }),
  budget: PD.Numeric(2_000_000, { min: 10_000, max: 8_000_000, step: 10_000 }, { description: 'Lipids at most' }),
  // round 8 (Ludo, 2026-11-09: "to compare and pick"): a cut leaflet's middle distance, between its atoms and the flat
  // texture: the coarse sphere levels, or the heads' relief over the patch's height channel (`patchRaster`'s alpha),
  // drawn as shells or by parallax; parallax by default (Ludo, 2026-11-10: "the parallax works really well")
  middle: PD.Select<MembraneMiddle>('parallax', [
    ['coarse', 'Coarse spheres'],
    ['shells', 'Shells'],
    ['parallax', 'Parallax'],
  ]),
  // the stride 1 → 8 boundary (Balanced: 8.8 px a lipid of 7.4 Å, measured) over the selection's keep (0.8): the atoms
  // to there, no coarse level drawn. Not under it (the gate's S1): the atoms there are what the levels draw as spheres,
  // up to the budget (2 px: 38 ms against 8 at 11, a floor); its sphere levels back would pop (dE 0.043, round 8)
  middlePx: PD.Numeric(
    11,
    { min: MiddlePxMin, max: 32, step: 0.5 },
    { description: 'Shells, parallax: atoms down to this size, px' },
  ),
  shells: PD.Numeric(8, { min: 4, max: 12, step: 1 }, { description: 'Shells: the heads’ layers' }),
  mergePx: PD.Numeric(
    2,
    { min: 0.5, max: 8, step: 0.5 },
    { isHidden: true, description: 'Shells, parallax: flat below, px' },
  ),
  // a membrane as a particle system (Ludo, 2026-11-08): its species as entities, each shown or not and its colour
  // (`mesoscale.membraneSpecies`); a hidden species is not generated (the cutter's), the far surface without it
  hiddenSpecies: PD.Value<readonly string[]>([], { isHidden: true }),
  speciesColors: PD.Value<Readonly<Record<string, number>>>({}, { isHidden: true }),
  // a cell's membranes (round 7 item 2): each part hidden or not (its lipids and surfaces) and its colour (`mesoscale.style`
  // with `parts`), by the part's name; a part's colour its far colour by zoom (its species' and atoms' kept close: review
  // D1), all of it without colours by zoom
  hiddenParts: PD.Value<readonly string[]>([], { isHidden: true }),
  partColors: PD.Value<Readonly<Record<string, number>>>({}, { isHidden: true }),
  // round 9 (Ludo, 2026-11-10: "if I change the color of the geometry/mesh the membrane color multiplier take it"): a
  // part's colours (or the whole membrane's, one mesh) times its mesh's colour (`meshTint`), its far colour, its species'
  // and the patch's, atoms by element not; on by default, off round 7's (`partColors` its far colour). A membrane with no
  // mesh (a sphere) none. Here, not in `colorLevels`: By zoom off keeps it
  meshColors: PD.Boolean(true, { description: 'Colours from meshes: each part’s colours times its mesh’s' }),
  // colours by zoom, as a particle list's (round 4c item 8; `color-levels.md`): far the membrane's colour (`color`), then
  // its species' (its entities'; its chain's the same), close each atom's by its element (`membraneColorLevels`; the
  // tiles' too, round 7 item 6)
  colorLevels: PD.MappedStatic('off', { off: PD.EmptyGroup(), on: PD.Group(ColorLevels.Params, { isFlat: true }) }),
  // its atoms' colours close up by zoom (round 7 item 6): each by its element, or its carbons its species' (its other
  // atoms by element: the classic lipid look)
  atomColors: PD.Select<MembraneAtomColors>('element', [
    ['element', 'By element'],
    ['carbon-species', 'Carbons by species'],
  ]),
  // Prism's clipping (round 4b item 6): a cut on the spheres and the far surfaces alike, the culler dropping the
  // instances it cuts away; a cut alone changes the drawn objects' clip values, nothing built again
  clip: BaseGeometry.Params.clip,
};
export type LipidMembraneReprProps = PD.Values<typeof LipidMembraneReprParams>;

/** A membrane's species (its entities), by name: those its cut leaflets have, both leaflets together */
export function membraneSpecies(data: MembraneData) {
  const names = new Set<string>();
  for (const l of data.cut) for (const m of l.table.members) names.add(l.table.species[m.species]);
  for (const l of data.leaflets) for (const s of l.tileSet.species) names.add(s);
  return [...names];
}

/** A tile without the lipids of `hidden` species (their atoms and groups out); the tile itself when none is hidden */
export function shownLipids(tile: Tile, species: readonly string[], hidden: ReadonlySet<string>): Tile {
  if (hidden.size === 0) return tile;
  const n = tile.lipidSpecies.length;
  let atoms = 0;
  let lipids = 0;
  for (let l = 0; l < n; ++l) {
    if (hidden.has(species[tile.lipidSpecies[l]])) continue;
    atoms += tile.lipidAtomStart[l + 1] - tile.lipidAtomStart[l];
    lipids += 1;
  }
  if (lipids === n) return tile;
  const positions = new Float32Array(atoms * 3);
  const elements = new Uint8Array(atoms);
  const lipidAtomStart = new Uint32Array(lipids + 1);
  const lipidSpecies = new Uint16Array(lipids);
  let a = 0;
  let k = 0;
  for (let l = 0; l < n; ++l) {
    if (hidden.has(species[tile.lipidSpecies[l]])) continue;
    const start = tile.lipidAtomStart[l];
    const end = tile.lipidAtomStart[l + 1];
    positions.set(tile.positions.subarray(start * 3, end * 3), a * 3);
    elements.set(tile.elements.subarray(start, end), a);
    lipidSpecies[k] = tile.lipidSpecies[l];
    a += end - start;
    lipidAtomStart[++k] = a;
  }
  return { ...tile, positions, elements, lipidAtomStart, lipidSpecies };
}

/**
 * The px a cut leaflet's lipids are drawn down to: the far look's switch (`enterPx`), or with a middle look its
 * `middlePx` (round 8: the atoms to there, the middle look below)
 */
function lipidsPx(props: LipidMembraneReprProps) {
  return middleOn(props) ? props.middlePx : enterPx(props.far, props.atomsPx, props.spheresPx);
}

/** Whether a middle look is drawn: parallax, past the spheres (round 8: shells, their band not built, draw as coarse) */
function middleOn(props: LipidMembraneReprProps) {
  return props.middle === 'parallax' && props.far !== 'spheres';
}

/**
 * Whether a middle look draws a cut band (round 8 §2, the gate's M1): with a clip, the lipids near its boundary taken
 * as the coarse look takes them (`SelectionParams.band`), their sphere levels kept (a cross-section shows lipids with
 * tails, not the relief's edge)
 */
function cutBandOn(props: LipidMembraneReprProps) {
  return middleOn(props) && props.clip.objects.length > 0;
}

/**
 * The px a cut leaflet's near surface (beneath its lipids) is drawn down to: its lipids', or with a cut band the coarse
 * rule's (the band's lipids have it beneath them: a cross-section with no gap between the leaflets)
 */
function nearPx(props: LipidMembraneReprProps) {
  return cutBandOn(props) ? enterPx(props.far, props.atomsPx, props.spheresPx) : lipidsPx(props);
}

/** The cut band's width, lipids: a lipid's length past the boundary and one more */
const CutBandWidth = 2;

/** A lipid's size in the patch, Å: the side of the area a lipid takes (the selection's size on screen) */
function lipidSize(table: CutterTable) {
  return Math.sqrt((table.box[0] * table.box[1]) / Math.max(1, table.lipids.length / 4));
}

/**
 * The spheres a cut leaflet's lipids are drawn as where its far surface takes over (round 4c item 7), a lipid `enter` px
 * on screen there (`enterPx`): the level Mol*'s levels by size on screen pick at that size (custom levels, by distance:
 * their last; none: the atoms), each member's atoms in the level's order (`orderLodLevels`, as its spheres are ordered),
 * the sphere's radius grown as the level grows it. Once a look, on the leaflet's few members
 */
export function switchSpheres(table: CutterTable, props: LipidMembraneReprProps, enter: number): SwitchSpheres {
  if (props.detail === 'off') {
    return { atoms: table.members.map((m) => m.positions), radii: table.members.map(() => props.sizeFactor) };
  }
  const { lodLevels, lodPixelSize } = membraneLevels(props.detail, props.levels);
  const perPixel = lipidSize(table) / Math.max(enter, 1e-3);
  const radii: number[] = [];
  const atoms = table.members.map((member) => {
    const count = member.positions.length / 3;
    const array = new Float32Array(count * PositionGroupStride);
    for (let i = 0; i < count; ++i) array.set(member.positions.subarray(i * 3, i * 3 + 3), i * PositionGroupStride);
    const cell = ValueCell.create(createDataArray(count, PositionGroupStride, Float32Array, array));
    // the members' pixel boundaries: their spheres' nominal radius (`Spheres.Params.lodRadius`; review M1: none, every
    // boundary 0 and always the coarsest level)
    const levels = orderLodLevels(cell, count, lodLevels, 1, lodPixelSize, LodNominalRadius);
    let j = levels.length - 1;
    if (lodPixelSize > 0) while (j > 0 && perPixel < levels[j][0]) j -= 1;
    const n = Math.max(1, Math.min(count, Math.round(levels[j][3] / 6)));
    radii.push(props.sizeFactor * levels[j][4]);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) out.set(array.subarray(i * PositionGroupStride, i * PositionGroupStride + 3), i * 3);
    return out;
  });
  return { atoms, radii };
}

/** The selection's hysteresis: a triangle taken keeps its lipids down to this share of the switch's px */
const Keep = 0.8;
/** The leaflet facing the camera within a lipid's length and a curve's: the units past it are hidden (round 5) */
const FacingMargin = 60;

/** A distance past any view, Å: a surface's fade (`lod`) open at its far end */
const NoFade = 1e9;

/**
 * The fade of a cut leaflet's surfaces (round 4c item 7) by distance (`lod`, Mol*'s object fade), set from the switch: a
 * lipid of `size` Å `enter` px on screen at `depthScale` Å a pixel a unit of depth. The far one dithered in from where a
 * lipid is twice `enter` px to the switch, opaque past it, not drawn nearer; the `near` one (beneath the lipids) drawn to
 * where the selection lets a lipid go (`keep` of the switch's px). Orthographic (one size on screen): drawn or not. Its
 * props' `lod` too (`setClip` updates the values with them)
 */
function fadeSurface(
  values: BaseValues,
  size: number,
  enter: number,
  near: boolean,
  depthScale: number,
  pixelSize: number,
) {
  const made = clipped.get(values);
  if (!made) return;
  const lod = made.lod;
  const keep = Keep;
  if (depthScale > 0) {
    const d = size / (depthScale * enter);
    if (near) Vec3.set(lod, 0, d / keep, 1);
    else Vec3.set(lod, d / 2, NoFade, d / 2);
  } else {
    const px = pixelSize > 0 ? size / pixelSize : Infinity;
    const drawn = near ? px >= enter * keep : px < enter;
    if (drawn) Vec3.set(lod, 0, NoFade, 1);
    else Vec3.set(lod, NoFade, 2 * NoFade, 1);
  }
  const u = values.uLod.ref.value;
  if (u[0] === lod[0] && u[1] === lod[1] && u[2] === lod[2]) return;
  ValueCell.update(values.uLod, Vec4.set(u, lod[0], lod[1], lod[2], 0));
}

/** A cut leaflet's near surface off the bilayer's mid-plane, Å (the two leaflets' apart) */
const NearLift = 2;

/** The patch table texture's width (`MeshSchema.tPatchTable`: `patchTexel` reads row by row) */
const PatchTableWidth = 1024;

/**
 * A surface's table's texels (`MeshSchema.tPatchTable`): its regions (each one's key in the cells' hash over its
 * normal's x, unread by the shader: `patchColor` hashes it; exact under 2^24 regions, `MaxCutterTriangles`; review X1),
 * the cells, its vertices' shifts (review S2), in rows of `PatchTableWidth`
 */
export function patchTableArray(regions: CutterRegions, shifts: Float32Array) {
  const texels = regions.table.length / 4 + regions.cells.length / 4 + Math.ceil(shifts.length / 4);
  const rows = Math.ceil(texels / PatchTableWidth);
  const array = new Float32Array(PatchTableWidth * rows * 4);
  array.set(regions.table);
  for (let r = 0; r < regions.count; ++r) array[r * 16 + 12] = regionKey(regions, r);
  array.set(regions.cells, regions.table.length);
  array.set(shifts, regions.table.length + regions.cells.length);
  return { array, rows };
}

/**
 * A leaflet's patch surface (round 5, `patchSurface`): its mesh's triangles, the patch texture mapped by their regions
 * and cells (`dPatchTexture`), single-sided; with colours by zoom the membrane's colour far, the texture from a lipid's
 * entity edge (`ColorLevels.entity`, an atom's px a lipid's × its atom over its size)
 */
function patchObject(
  f: ReturnType<typeof patchSurface>,
  textures: [Texture, Texture],
  table: CutterTable,
  regions: CutterRegions,
  size: number,
  reprProps: LipidMembraneReprProps,
  fade: boolean,
  /** its part's colour (round 7): the surface's far colour, the membrane's otherwise */
  far: Color,
) {
  const n = f.positions.length / 3;
  const m = Mesh.create(f.positions, f.indices, f.normals, f.groups, n, f.indices.length / 3);
  const defaults = PD.getDefaultValues(Mesh.Params);
  const props = {
    ...defaults,
    doubleSided: false,
    clip: reprProps.clip,
    // a cut leaflet's surfaces fade by distance (`fadeSurface`, set where the size on screen changes): the define on
    // from the start, the values set at once from the last view seen (none yet: as orthographic, px unbounded)
    lod: fade ? Vec3.create(0, NoFade, 1) : defaults.lod,
  };
  const transform = createIdentityTransform();
  const locationIterator = LocationIterator(Math.max(1, regions.count), 1, 1, () => ({ kind: 'membrane' }) as never);
  const color = {
    granularity: 'uniform',
    color: () => far,
    props: {},
    description: 'Membrane',
  } as unknown as ColorTheme<any>;
  const values = Mesh.Utils.createValues(
    m,
    transform,
    locationIterator,
    { color, size: UniformSizeTheme({}, { value: 1 }) },
    props,
  );
  Object.assign(values, {
    dPatchTexture: ValueCell.create(true),
    tPatch: ValueCell.create(textures[0]),
    tPatchTable: ValueCell.create(textures[1]),
    uPatch: ValueCell.create(Vec4.create(cellSide(table.box), table.box[0], table.box[1], regions.table.length / 4)),
    uPatchLevels: ValueCell.create(patchLevels(Vec4(), reprProps, size)),
  });
  const object = createRenderObject('mesh', values, Mesh.Utils.createRenderableState(props), -1);
  clipped.set(object.values as never, props);
  return object;
}

/**
 * A cut leaflet's far surface's middle look (round 8, `MeshSchema.dPatchMiddle`): parallax marched from `mergePx` up
 * (the surface drawn to twice the lipids' px, `fadeSurface`), or beneath a shell band (discarded where it draws); the
 * heads' heights the raster's (lo, hi, the surface at the mean)
 */
function setMiddle(
  values: object,
  middle: MembraneMiddle,
  props: LipidMembraneReprProps,
  raster: { lo: number; hi: number; mean?: number },
) {
  const v = values as { dPatchMiddle: ValueCell<string>; uPatchShells: ValueCell<Vec4>; uPatchMiddle: ValueCell<Vec4> };
  ValueCell.update(v.dPatchMiddle, middle === 'parallax' ? 'parallax' : 'beneath');
  ValueCell.update(v.uPatchShells, Vec4.create(props.shells, raster.lo, raster.hi, raster.mean ?? raster.hi));
  ValueCell.update(
    v.uPatchMiddle,
    Vec4.create(props.mergePx, middle === 'parallax' ? NoFade : 2 * props.middlePx, 0, 0),
  );
}

/** Whether a membrane's colours follow the zoom: on, and not one colour (as a list's uniform theme) */
function levelsOn(props: LipidMembraneReprProps) {
  return props.colorLevels.name === 'on' && props.colorBy !== 'uniform';
}

/**
 * A patch surface's levels (`MeshSchema.uPatchLevels`): on, the lipid's px where its species start and end blending in
 * (the levels' entity edge for an atom, a lipid `size / AtomSize` atoms across, a band wide), its lipids' size
 */
function patchLevels(out: Vec4, props: LipidMembraneReprProps, size: number) {
  const on = levelsOn(props);
  const { entity, band } = on ? (props.colorLevels.params as ColorLevels.Props) : { entity: 0, band: 1 };
  const px = (entity * size) / ColorLevels.AtomSize;
  return Vec4.set(out, on ? 1 : 0, px * 2 ** (-band / 2), px * 2 ** (band / 2), size);
}

/** The char code of carbon's element (`Tile.elements`: an atom's element by its first letter) */
const Carbon = 67;

/**
 * An atom's colour by its element (the first letter's char code), Mol*'s element colours; with `carbon-species` a
 * carbon takes its species' colour (round 7 item 6)
 */
export function elementColor(code: number, scheme: MembraneAtomColors = 'element', species?: Color) {
  if (scheme === 'carbon-species' && code === Carbon && species !== undefined) return species;
  return elementSymbolColor(ElementSymbolColors, String.fromCharCode(code) as ElementSymbol);
}

/** A membrane's tints (round 9): a part's (or the one mesh's) mesh colour as a multiplier, by part; none: neutral */
export type MeshTints = readonly (Color | undefined)[];
const NoTints: MeshTints = [];

/**
 * A mesh's colour as its membrane's multiplier (round 9; Ludo, 2026-11-10: normalised): the colour over its largest
 * channel, so the meshes' default grey (0x808080) is white and a wrap dims nothing; black, white and none no tint
 */
export function meshTint(color: Color | undefined): Color | undefined {
  if (color === undefined) return undefined;
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const m = Math.max(r, g, b);
  if (m === 0) return undefined;
  const t = Color.fromRgb(Math.round((r * 255) / m), Math.round((g * 255) / m), Math.round((b * 255) / m));
  return t === 0xffffff ? undefined : t;
}

/**
 * `color` times the tint `t` per channel (round 9; none: `color`). Local: Mol*'s `Color` has no multiply, and this
 * round changes no library (a candidate for `@molstar/core/util/color`)
 */
export function tint(color: Color, t: Color | undefined): Color {
  if (t === undefined) return color;
  const r = Math.round((((color >> 16) & 255) * ((t >> 16) & 255)) / 255);
  const g = Math.round((((color >> 8) & 255) * ((t >> 8) & 255)) / 255);
  const b = Math.round(((color & 255) * (t & 255)) / 255);
  return Color((r << 16) | (g << 8) | b);
}

/**
 * The cell holding a mesh's colour (round 9): its representation (given, or its shape's first), whose `coloring`
 * `cryoet.mesh` writes; a membrane depends on it (`mesoscale.wrapMembrane`), so a recolour reaches it in its step
 */
export function meshColorCell(state: State, ref: string): StateObjectCell | undefined {
  const cell = state.cells.get(ref);
  if (!cell) return undefined;
  if (cell.transform.transformer === ShapeRepresentation3D) return cell;
  let found: StateObjectCell | undefined;
  state.tree.children.get(ref)?.forEach((c) => {
    const child = state.cells.get(c!);
    if (child?.transform.transformer !== ShapeRepresentation3D) return true;
    found = child;
    return false;
  });
  return found;
}

/**
 * A membrane's tints from its meshes' colours, a part a mesh (`meshes`, else its one `mesh`; none for a sphere): a
 * uniform colour's `meshTint`, a mesh's own colours (given, vertex, custom, material) none. One pass, O(meshes)
 */
export function meshTints(state: State, params: { readonly mesh: string; readonly meshes: readonly string[] }) {
  const refs = params.meshes.length > 0 ? params.meshes : params.mesh ? [params.mesh] : [];
  const out: (Color | undefined)[] = new Array(refs.length);
  for (let k = 0; k < refs.length; ++k) {
    const coloring = (meshColorCell(state, refs[k])?.transform.params as { coloring?: ColoringParam } | undefined)
      ?.coloring;
    out[k] = coloring?.name === 'uniform' ? meshTint(coloring.params.color) : undefined;
  }
  return out as MeshTints;
}
type ColoringParam = { readonly name: string; readonly params: { readonly color?: Color } };

/** Whether two tints are the same, part by part */
function sameTints(a: MeshTints, b: MeshTints) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; ++k) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * A membrane object's colours by zoom (round 4c item 8), as a particle list's (`setColorLevels` of its targets): far its
 * colour (`props.color`) on each of its `instances`, then each of its `groups`' colour (the theme's: its species');
 * the near data each group's (its atoms by element: a cut member's, round 5; a tile's, round 7 item 6). Off for one
 * colour, as a list's uniform theme
 */
function membraneColorLevels(
  values: ColorLevels.Data,
  props: LipidMembraneReprProps,
  instances: number,
  groups: number,
  colorOf: (group: number) => Color,
  farColor: Color,
) {
  const on = levelsOn(props);
  ColorLevels.setProps(values, on ? (props.colorLevels.params as ColorLevels.Props) : ColorLevels.defaults, on);
  if (!on) return;
  const near = new Uint8Array(Math.max(1, groups) * 4);
  for (let g = 0; g < groups; ++g) {
    Color.toArray(colorOf(g), near, g * 4);
    near[g * 4 + 3] = ColorLevels.offsetByte(0);
  }
  ValueCell.update(values.tColorNear, { array: near, count: groups });
  const far = new Uint8Array(Math.max(1, instances) * 4);
  for (let i = 0; i < instances; ++i) Color.toArray(farColor, far, i * 4);
  ValueCell.update(values.tColorFar, { array: far, count: instances });
}

/**
 * Whether `b` differs from `a` by its colours by zoom's edges alone, on in both (round 7 item 6): uniforms, nothing
 * built again (on or off, a colour, a scheme: their data, built)
 */
function onlyColorEdges(a: LipidMembraneReprProps, b: LipidMembraneReprProps) {
  if (a.colorLevels.name !== 'on' || b.colorLevels.name !== 'on') return false;
  if (JSON.stringify(a.colorLevels) === JSON.stringify(b.colorLevels)) return false;
  for (const k of Object.keys(b) as (keyof LipidMembraneReprProps)[]) {
    if (k !== 'colorLevels' && a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/** Whether a cut member draws its atoms only, no sphere levels (round 8: a middle look without a cut band) */
function cutAtomsOnly(props: LipidMembraneReprProps) {
  return props.detail === 'off' || (middleOn(props) && !cutBandOn(props));
}

/**
 * Whether `b` differs from `a` by its middle look alone (the gate's S2): its look or its atoms' px (under a middle look,
 * the cut band's px too), the cut lipids' levels the same (`cutAtomsOnly`): a raster, uniforms and a selection anew,
 * nothing built again
 */
function onlyMiddle(a: LipidMembraneReprProps, b: LipidMembraneReprProps) {
  // under a middle look on both sides the far look's switches set the cut band's px alone (the gate's S5)
  const band = middleOn(a) && middleOn(b);
  const keys = (k: keyof LipidMembraneReprProps) =>
    k === 'middle' || k === 'middlePx' || (band && (k === 'spheresPx' || k === 'atomsPx'));
  let changed = false;
  for (const k of Object.keys(b) as (keyof LipidMembraneReprProps)[]) {
    if (a[k] === b[k] || JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (!keys(k)) return false;
    changed = true;
  }
  return changed && cutAtomsOnly(a) === cutAtomsOnly(b);
}

/** Whether `b` differs from `a` by its clip alone */
function onlyClip(a: LipidMembraneReprProps, b: LipidMembraneReprProps) {
  if (a.clip === b.clip) return false;
  for (const k of Object.keys(b) as (keyof LipidMembraneReprProps)[]) {
    if (k !== 'clip' && a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/** Whether `a` and `b` differ at `k`, by value */
function differs(a: LipidMembraneReprProps, b: LipidMembraneReprProps, k: keyof LipidMembraneReprProps) {
  return a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]);
}

/** The props a recolour writes in place (round 9, `recolor`): colours, nothing built */
const ColorKeys: ReadonlySet<string> = new Set(['color', 'speciesColors', 'partColors', 'meshColors', 'atomColors']);

/** Whether `b` differs from `a` by its colours alone, or not at all (round 9) */
function onlyColors(a: LipidMembraneReprProps, b: LipidMembraneReprProps) {
  for (const k of Object.keys(b) as (keyof LipidMembraneReprProps)[]) {
    if (!ColorKeys.has(k) && differs(a, b, k)) return false;
  }
  return true;
}

/** Whether `b` is `a`'s look (round 9: a mesh's opacity, its dependency's update, draws nothing again) */
function sameLook(a: LipidMembraneReprProps, b: LipidMembraneReprProps) {
  for (const k of Object.keys(b) as (keyof LipidMembraneReprProps)[]) if (differs(a, b, k)) return false;
  return true;
}

/** The props an object's values were made with (`setClip`: a cut alone updates its values with them) */
const clipped = new WeakMap<BaseValues, PD.Values<BaseGeometry.Params>>();

/** The clip on an object's values, as it was made otherwise (a define where the cut count goes from or to none) */
function setClip(values: BaseValues, clip: Clip.Props) {
  const made = clipped.get(values);
  if (made) BaseGeometry.updateValues(values, { ...made, clip });
}

/** A membrane's species' default colors, by name (`speciesColors`) */
export function membraneSpeciesColors(data: MembraneData) {
  return speciesColors(data);
}

/** A species' color: distinct colors by species index across both leaflets (residue names as the tile sets have them) */
function speciesColors(data: MembraneData) {
  const names = new Map<string, number>();
  for (const l of data.leaflets) for (const s of l.tileSet.species) if (!names.has(s)) names.set(s, names.size);
  for (const l of data.cut) for (const s of l.table.species) if (!names.has(s)) names.set(s, names.size);
  const palette = distinctColors(Math.max(2, names.size));
  return (name: string) => palette[names.get(name) ?? 0];
}

/** A member's look (round 9): its part's colour (round 7) and its mesh's tint, read when it is painted */
interface MemberLook {
  readonly part: () => Color | undefined;
  readonly tint: () => Color | undefined;
}
const NoLook: MemberLook = { part: () => undefined, tint: () => undefined };

/**
 * The membrane's representation: a spheres object per (leaflet, variant) with tiles, merged with GPU culling; the
 * transforms from the assignment kernel. No objects where the device cannot cull on the GPU (WebGL2)
 */
export function LipidMembraneRepresentation(initialGraphics: GraphicsContext | undefined) {
  let graphics = initialGraphics;
  const currentGraphics = () => graphics;
  /** the data last built, built again on a new context (`setGraphics`) */
  let lastData: MembraneData | undefined;
  const updated = new Subject<number>();
  let version = 0;
  let renderObjects: GraphicsRenderObject[] = [];
  let merged = new Map<string, MergedEntry<number>>();
  let assigners: LipidTileAssigner[] = [];
  let cutters: LipidCutter[] = [];
  /** each cutter's selection input (its triangles, kinds and whole counts) */
  const cutInputs = new WeakMap<LipidCutter, SelectionInput>();
  let cutLipids = 0;
  /** per cut leaflet its selection of a view (`procedural.ts`) */
  let selections: LipidSelection[] = [];
  /** the selections' views (`views.selectFor`) and the pools' regenerations */
  const selectionStats = { regenerations: 0 };
  let props = PD.getDefaultValues(LipidMembraneReprParams);
  const state = Representation.createState();
  let groupCount = 0;
  /** the merged objects' members' values (a cut alone updates them: `setClip`), and the build's */
  let members: BaseValues[] = [];
  let building: BaseValues[] = [];
  /** each member's colours, painted again in place by a recolour (round 9, `recolor`), and the build's */
  let painters: { uniform: boolean; uniformNow: () => boolean; paint: () => void }[] = [];
  let paintersBuilding: typeof painters = [];
  /** the meshes' tints (round 9): given by the transformer (`setMeshTints`), applied by `createOrUpdate` */
  let givenTints = NoTints;
  let tints = NoTints;
  /** whether the meshes colour the membrane (round 9): the switch on and a mesh wrapped (a sphere's none) */
  const meshMode = () => props.meshColors && tints.length > 0;
  /** a part's tint (one mesh's: `part` none), none with the switch off */
  const tintOf = (part: number | undefined) => (props.meshColors ? tints[part ?? 0] : undefined);
  /** the cut leaflets' far surfaces, faded in by distance (`fadeSurface`), and their lipids' size */
  let fading: { values: BaseValues; size: number; near: boolean }[] = [];
  /**
   * every leaflet's patch texture and what it is rastered from (a cut leaflet's: its far surface, a middle switch: S2),
   * its surfaces (their colour, round 9) and the colours it was rastered in (`signature`: a recolour rasters again only
   * the leaflets whose colours changed)
   */
  let rasters: {
    table: CutterTable;
    shown: (sp: number) => boolean;
    side: 'outer' | 'inner';
    /** its species' colours now, the raster's (live: a recolour's) */
    colors: () => (sp: number) => number;
    farColor: () => Color;
    signature: () => string;
    signed: string;
    cut: boolean;
    patch: Texture;
    far: BaseValues[];
    surfaces: BaseValues[];
  }[] = [];
  /** every patch surface drawn and its lipids' size: its levels set where only the edges move (`setColorEdges`) */
  let patches: { values: BaseValues; size: number }[] = [];
  /** the far surfaces of a membrane's parts (round 6): shown while their part is (`showParts`) */
  let partSurfaces: { object: GraphicsRenderObject; part: number }[] = [];
  /** which parts of a cell's membranes the last view showed (round 7: one for all its selections), kept with the cutters */
  let visibility: PartVisibility | undefined;
  /** each part surface visible where the membrane is and its part is shown */
  function showParts() {
    showPartSurfaces(partSurfaces, state.visible, visibility);
  }
  /** the colours by zoom's edges on every drawn object: members, merged objects, patch surfaces (round 7 item 6) */
  function setColorEdges() {
    const on = levelsOn(props);
    const levels = on ? (props.colorLevels.params as ColorLevels.Props) : ColorLevels.defaults;
    for (const v of members) ColorLevels.setProps(v as unknown as ColorLevels.Data, levels, on);
    for (const o of renderObjects) {
      if ('uColorLevelEdges' in o.values) ColorLevels.setProps(o.values as unknown as ColorLevels.Data, levels, on);
    }
    for (const { values, size } of patches) {
      const u = values as unknown as { uPatchLevels: ValueCell<Vec4> };
      ValueCell.update(u.uPatchLevels, patchLevels(u.uPatchLevels.ref.value, props, size));
    }
  }
  /** the last view's size on screen: a new look's surfaces faded from their first frame (the hook comes after it) */
  const lastLod = { depthScale: 0, pixelSize: 0 };

  /** the patch textures of the objects drawn, and of the build before (`buildSteps`) */
  let patchTexturesInUse: Texture[] = [];
  let retiredTextures: Texture[] = [];

  /** a leaflet's patch texture (mipmapped) and its map's table (its regions' frames, then its cells' kinds) */
  function patchTexture(graphics: GraphicsContext, raster: { array: Uint8Array; width: number; height: number }) {
    const patch = graphics.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
    patch.load(raster);
    patch.mipmap();
    return patch;
  }
  /** a surface's table (`MeshSchema.tPatchTable`): its regions, the cells, its vertices' shifts (review S2) */
  function patchTable(graphics: GraphicsContext, regions: CutterRegions, shifts: Float32Array) {
    const { array, rows } = patchTableArray(regions, shifts);
    const table = graphics.resources.texture('image-float32', 'rgba', 'float', 'nearest');
    table.load({ array, width: PatchTableWidth, height: rows });
    return table;
  }

  /**
   * The patch textures all destroyed: on destroy, a new context, a failed build (review M2, M3: a rebuild keeps them, its
   * end destroys the ones two builds old, the last build's objects drawn until the canvas swaps them)
   */
  function releaseTextures() {
    for (const t of retiredTextures) t.destroy();
    for (const t of patchTexturesInUse) t.destroy();
    retiredTextures = [];
    patchTexturesInUse = [];
  }

  function release() {
    for (const a of assigners) a.destroy();
    for (const c of cutters) c.destroy();
    assigners = [];
    cutters = [];
    visibility = undefined;
    selections = [];
    views.reset();
    fading = [];
    patches = [];
  }

  /**
   * a member's spheres values: its atoms (groups: its atoms with `elements`, else its lipids), `n` instances written by
   * `writer`, colored by species
   */
  function memberObject(
    positions: Float32Array,
    lipidAtomStart: ArrayLike<number> | undefined,
    lipidSpecies: ArrayLike<number>,
    names: readonly string[],
    n: number,
    bounds: Sphere3D,
    writer: unknown,
    colorOf: (name: string) => Color,
    elements?: Uint8Array,
    /**
     * its part's colour (round 7): far by zoom (the species' and atoms' kept close: review D1), all of it otherwise; and
     * its mesh's tint (round 9). Read when painted: a recolour paints again (`recolor`)
     */
    look: MemberLook = NoLook,
  ) {
    const atoms = positions.length / 3;
    // with `elements` (a cut member, one lipid; a tile's lipids, round 7 item 6): its atoms its groups, each coloured
    // close up by its element (colours by zoom's atoms, round 5), its species its lipid's; else its lipids
    const byAtom = !!elements;
    const lipids = byAtom ? atoms : lipidSpecies.length;
    const groups = new Float32Array(atoms);
    // a group's species: O(atoms of the member), never of the lipids drawn
    const speciesOf = new Uint16Array(Math.max(1, lipids));
    if (byAtom) {
      for (let a = 0; a < atoms; ++a) groups[a] = a;
      if (!lipidAtomStart) speciesOf.fill(lipidSpecies[0]);
      else {
        for (let l = 0; l < lipidSpecies.length; ++l) {
          speciesOf.fill(lipidSpecies[l], lipidAtomStart[l], lipidAtomStart[l + 1]);
        }
      }
    } else if (lipidAtomStart) {
      for (let l = 0; l < lipids; ++l) {
        groups.fill(l, lipidAtomStart[l], lipidAtomStart[l + 1]);
        speciesOf[l] = lipidSpecies[l];
      }
    }
    const spheres = Spheres.create(positions, groups, atoms);
    // gridless (one cell, the membrane's sphere), the CPU's transforms a placeholder: the kernel writes them
    const transform = createTransform(new Float32Array(n * 16), n, undefined, 0, 0);
    const locationIterator = LocationIterator(
      lipids,
      n,
      1,
      (g: number) => ({ kind: 'lipid', species: speciesOf[g] }) as never,
    );
    const uniformNow = () => props.colorBy === 'uniform' || (look.part() !== undefined && !levelsOn(props));
    // its colours as they are now (a build, a recolour): its species' and far colour times its mesh's tint (round 9)
    const colorTheme = () => {
      const t = look.tint();
      const one = tint(look.part() ?? props.color, t);
      const uniform = uniformNow();
      return {
        granularity: uniform ? 'uniform' : 'group',
        color: (location: { species?: number }) =>
          uniform || location.species === undefined ? one : tint(colorOf(names[location.species]), t),
        props: {},
        description: 'Lipid species',
      } as unknown as ColorTheme<any>;
    };
    const uniform = uniformNow();
    const theme = { color: colorTheme(), size: UniformSizeTheme({}, { value: props.sizeFactor }) };
    // each lipid or tile at its own level by its size on screen (the culler's per-instance levels)
    // round 8: with a middle look a cut lipid is its atoms down to it (the selection keeps a triangle's lipids a little
    // below `middlePx`, measured: no coarse level shows over the relief)
    // with a clip the cut band's lipids keep the levels (the gate's M1: `cutBandOn`, a build where it comes or goes)
    const atomsOnly = lipidAtomStart === undefined ? cutAtomsOnly(props) : props.detail === 'off';
    const lod = atomsOnly ? { lodLevels: [], lodPixelSize: 0 } : membraneLevels(props.detail, props.levels);
    // markers by lipid; by atom (a cut member's, a tile's): by group and instance, 40 a lipid past a texture's size
    const p = {
      ...PD.getDefaultValues(Spheres.Params),
      ...lod,
      gpuCulling: true as const,
      clip: props.clip,
      instanceGranularity: byAtom,
    };
    const values = Spheres.Utils.createValues(spheres, transform, locationIterator, theme, p);
    // atoms by element not tinted; carbons by species their species' tinted colour (round 9, Ludo)
    const levels = () => {
      const t = look.tint();
      membraneColorLevels(
        values,
        props,
        n,
        lipids,
        (g) => {
          const species = tint(colorOf(names[speciesOf[g]]), t);
          return byAtom ? elementColor(elements![g], props.atomColors, species) : species;
        },
        tint(look.part() ?? props.color, t),
      );
    };
    levels();
    clipped.set(values, p);
    building.push(values);
    paintersBuilding.push({
      uniform,
      uniformNow,
      paint: () => {
        createColors(locationIterator, locationIterator, colorTheme(), values as never);
        levels();
      },
    });
    ValueCell.update(values.boundingSphere, Sphere3D.clone(bounds));
    Object.assign(values, { gpuInstances: ValueCell.create(writer) });
    groupCount += lipids * n;
    return createRenderObject('spheres', values, Spheres.Utils.createRenderableState(p), -1);
  }

  /**
   * Member `m`'s writer of a leaflet's pool: its hits on the triangles `selection` holds for the frame's view (its view
   * hook, called by the culler where the view changed), its live count returned; nothing written where the selection
   * stayed (a still camera, the pyramid's rounds)
   */
  function poolWriter(cutter: LipidCutter, m: number, selection: LipidSelection, size: number): GpuInstanceWriter {
    const write = cutter.writer(m, selection);
    let written = -1;
    const writer = ((compute, target) => {
      written = selection.version;
      return write(compute, target);
    }) as GpuInstanceWriter;
    writer.view = (compute, target, view) => {
      views.selectFor(selection, view, size);
      if (written === selection.version) return undefined;
      written = selection.version;
      selectionStats.regenerations += 1;
      return write(compute, target) as number;
    };
    return writer;
  }

  /** each selection once a view, the surfaces faded and the parts shown around them (`views.ts`) */
  const views = createMembraneViews({
    fade: (depthScale, pixelSize) => {
      lastLod.depthScale = depthScale;
      lastLod.pixelSize = pixelSize;
      const enter = lipidsPx(props);
      const near = nearPx(props);
      for (const f of fading) fadeSurface(f.values, f.size, f.near ? near : enter, f.near, depthScale, pixelSize);
    },
    showParts,
    partsVersion: () => visibility?.version,
    params: (size) => {
      selectionParams.lipidSize = size;
      selectionParams.enterPx = builtFor?.method === 'cutter' ? lipidsPx(props) : 0;
      // a clip shows the leaflet behind and the far side: every unit then
      selectionParams.facing = props.clip.objects.length > 0 ? 0 : FacingMargin;
      selectionParams.band = builtFor?.method === 'cutter' && cutBandOn(props) ? cutBand(size) : undefined;
      return selectionParams;
    },
  });
  const selectionParams: {
    lipidSize: number;
    enterPx: number;
    keep: number;
    facing: number;
    band: CutBand | undefined;
  } = { lipidSize: 8, enterPx: 2, keep: Keep, facing: FacingMargin, band: undefined };
  /** the cut band's (the gate's M1): its clip objects made again where the clip changed, written in place a view */
  const band = { objects: Clip.getClip(props.clip).objects, width: 0, enterPx: 0 };
  let bandFor: Clip.Props | undefined;
  function cutBand(size: number) {
    if (bandFor !== props.clip) {
      bandFor = props.clip;
      band.objects = Clip.getClip(props.clip).objects;
    }
    band.width = CutBandWidth * size;
    band.enterPx = enterPx(props.far, props.atomsPx, props.spheresPx);
    return band;
  }

  /** the data the GPU's cutters and assigners were made for: a new look of the same data reuses them (review S5) */
  let builtFor: MembraneData | undefined;

  /** builds, or on a cancel (or any error) releases what it made on the GPU, nothing half-built kept */
  async function build(data: MembraneData, runtime: RuntimeContext) {
    const gen = ++generation;
    // a redraw of a membrane already made (a new look) offers no cancel: a cancelled redraw left its cell in error, and
    // the revert, a whole new build on the same cancelled task, failed too (review X1)
    const canAbort = builtFor !== data;
    try {
      await buildNow(data, stepper(runtime, canAbort), gen);
    } catch (e) {
      // a newer build (a new context, a new look) took over: it owns the state, this one leaves it
      if (e === Superseded) return;
      if (gen === generation) {
        release();
        releaseTextures();
        builtFor = undefined;
        renderObjects = [];
        members = [];
      }
      throw e;
    }
  }

  /** the latest build's number: a build waiting on the GPU or the page keeps nothing once another started (review S1) */
  let generation = 0;

  async function buildNow(data: MembraneData, yieldStep: (p: MembraneProgress) => Promise<void>, gen: number) {
    // what this build made, kept only if it is still the latest when it ends
    const made: { destroy(): void }[] = [];
    const current = () => {
      if (gen !== generation) throw Superseded;
    };
    const step = async (p: MembraneProgress) => {
      await yieldStep(p);
      current();
    };
    try {
      await buildSteps(data, step, current, made);
    } catch (e) {
      // nothing this build made is kept on a failure (past the device's buffers, a cancel) or a newer build
      for (const m of made) m.destroy();
      throw e;
    }
  }

  async function buildSteps(
    data: MembraneData,
    step: (p: MembraneProgress) => Promise<void>,
    current: () => void,
    made: { destroy(): void }[],
  ) {
    cutLipids = 0;
    // the context of this build (`setGraphics` may replace the representation's while it waits)
    const graphics = currentGraphics();
    if (!graphics?.compute || !canCullOnGpu(graphics)) {
      // nothing drawn: the last builds' patch textures go too (review X3)
      release();
      releaseTextures();
      builtFor = undefined;
      renderObjects = [];
      members = [];
      return;
    }
    const reuse = builtFor === data;
    if (!reuse) {
      release();
      builtFor = undefined;
    }
    // this build's cutters and assigners: the kept ones when it reuses them
    const cuts = reuse ? cutters : [];
    const assigns = reuse ? assigners : [];
    const byDefault = speciesColors(data);
    const colorOf = (name: string) => {
      const c = props.speciesColors[name];
      return c === undefined ? byDefault(name) : Color(c);
    };
    const hidden = new Set(props.hiddenSpecies);
    // a cell's membranes (round 7 item 2): a hidden part's leaflets take no budget, no member and no surface
    const hiddenParts = new Set(props.hiddenParts);
    const partName = (l: CutLeaflet) => (l.part === undefined ? undefined : data.parts?.[l.part]?.name);
    const partHidden = (l: CutLeaflet) => {
      const name = partName(l);
      return name !== undefined && hiddenParts.has(name);
    };
    const partColor = (l: CutLeaflet) => {
      // round 9: with its meshes' colours its mesh is its colour, its part colour none
      if (meshMode()) return undefined;
      const name = partName(l);
      const c = name === undefined ? undefined : props.partColors[name];
      return c === undefined ? undefined : Color(c);
    };
    const entries: { visual: number; renderObject: GraphicsRenderObject }[] = [];
    const bounds = Sphere3D.clone(data.sphere);
    groupCount = 0;
    building = [];
    paintersBuilding = [];
    let visual = 0;
    // the cuts' counts first (a count pass each, read back), then the whole membrane's instances against the device
    if (!reuse) {
      const { parts, enclosedBy, whole } = data;
      visibility =
        parts && enclosedBy && whole
          ? createPartVisibility(whole.positions, whole.indices, parts, enclosedBy)
          : undefined;
      for (const leaflet of data.cut) {
        // the count pass and its readback: one wait on the GPU, not a stretch of the main thread
        await step({ message: `Cutting triangles (${leaflet.name})` });
        const { table, mesh } = leaflet;
        // round 5: a small triangle cut whole (its counts from the count pass), a large one by cells (its kinds')
        const { wholeOf, count: W } = wholeTriangles(mesh.positions, mesh.indices, leaflet.regions, table.box);
        const whole = new Uint32Array(W);
        for (let t = 0; t < wholeOf.length; ++t) if (wholeOf[t] >= 0) whole[wholeOf[t]] = t;
        const cutter = await createLipidCutter(
          graphics.compute,
          () => graphics.flush(),
          table,
          mesh.positions,
          mesh.indices,
          leaflet.regions,
          whole,
          getKindCounts(table, leaflet.regions.cells),
        );
        cutInputs.set(cutter, {
          positions: mesh.positions,
          indices: mesh.indices,
          regions: leaflet.regions,
          box: table.box,
          members: table.members.length,
          kinds: getKindCounts(table, leaflet.regions.cells),
          wholeOf,
          wholeCounts: cutter.counts,
          side: leaflet.name === 'inner' ? -1 : 1,
          ...(leaflet.part !== undefined && visibility ? { visibility, part: leaflet.part } : {}),
        });
        made.push(cutter);
        current();
        cuts.push(cutter);
      }
    }
    // a pool a member, its capacity a share of the budget (`poolCapacities`: water-filled across the leaflets, round 7),
    // a selection a leaflet (a part and leaflet of a cell's membranes); a hidden part's none
    // tiles: their lost parts cut whole, no far look (the cutter's alone; review S6)
    const cutter = data.method === 'cutter';
    const budget = cutter ? props.budget : Infinity;
    const inputs = cuts.map((c) => cutInputs.get(c)!);
    // a hidden encloser hides nothing inside it (review M1)
    visibility?.setHidden((q) => hiddenParts.has(data.parts?.[q]?.name ?? ''));
    const capacities = poolCapacities(
      inputs.map((input, c) => (partHidden(data.cut[c]) ? new Uint32Array(input.members) : slotTotals(input, budget))),
      budget,
    );
    // a hidden part's none (its selection's arrays, a few MB, never selecting: review N2)
    const pools = inputs.map((input, c) =>
      partHidden(data.cut[c]) ? undefined : createLipidSelection(input, capacities[c]),
    );
    for (let c = 0; c < pools.length; ++c) {
      const { table } = data.cut[c];
      const pool = pools[c];
      if (!pool) continue;
      for (let m = 0; m < table.members.length; ++m) {
        pool.shown[m] = hidden.has(table.species[table.members[m].species]) ? 0 : 1;
      }
    }
    let instances = 0;
    for (const c of capacities) for (const n of c) instances += n;
    for (const l of data.leaflets) instances += l.slots.variant.length;
    const levels = props.detail === 'off' ? 0 : membraneLevels(props.detail, props.levels).lodLevels.length;
    checkInstances(instances, levels, graphics.compute.maxStorageBufferSize, !!graphics.capabilities.atomicMinMax64);
    for (let c = 0; c < data.cut.length; ++c) {
      const leaflet = data.cut[c];
      const { table } = leaflet;
      const cutter = cuts[c];
      const pool = pools[c];
      if (!pool) continue;
      // the lipids the leaflet holds, about: nothing O(lipids) at the wrap (round 5); exact by export; a hidden part's
      // not counted
      cutLipids += estimateLipids(inputs[c]);
      const b = cutBounds(leaflet);
      for (let m = 0; m < table.members.length; ++m) {
        const member = table.members[m];
        const n = capacities[c][m];
        if (n === 0) continue;
        await step({
          message: `Uploading lipids (${leaflet.name}) ${m + 1}/${table.members.length}`,
          current: m,
          max: table.members.length,
        });
        const species = [member.species];
        entries.push({
          visual: visual++,
          renderObject: memberObject(
            member.positions,
            undefined,
            species,
            table.species,
            n,
            b,
            poolWriter(cutter, m, pool, lipidSize(table)),
            colorOf,
            member.elements,
            { part: () => partColor(leaflet), tint: () => tintOf(leaflet.part) },
          ),
        });
      }
    }
    // tiles: one mesh, its tint (round 9)
    const tileLook: MemberLook = { part: () => undefined, tint: () => tintOf(undefined) };
    for (let k = 0; k < data.leaflets.length; ++k) {
      const { tileSet, mesh, slots } = data.leaflets[k];
      if (!reuse) {
        const assigner = createLipidTileAssigner(
          graphics.compute,
          data.kinds,
          data.edge,
          mesh.positions,
          mesh.indices,
          slots,
        );
        made.push(assigner);
        assigns.push(assigner);
      }
      const assigner = assigns[k];
      bounds.radius = data.sphere.radius + Math.abs(tileSet.offset) + tileSet.sphere[3];
      for (let v = 0; v < tileSet.variants.length; ++v) {
        // a hidden species' lipids out of the tile (a tile mixes species: a per-lipid mask, on its atoms)
        const tile = shownLipids(tileSet.variants[v], tileSet.species, hidden);
        const n = slots.counts[v];
        if (n === 0 || tile.lipidSpecies.length === 0) continue;
        const max = tileSet.variants.length;
        await step({ message: `Uploading lipid tiles (${data.leaflets[k].name}) ${v + 1}/${max}`, current: v, max });
        entries.push({
          visual: visual++,
          renderObject: memberObject(
            tile.positions,
            tile.lipidAtomStart,
            tile.lipidSpecies,
            tileSet.species,
            n,
            bounds,
            assigner.writer(v),
            colorOf,
            tile.elements,
            tileLook,
          ),
        });
      }
    }
    const out: GraphicsRenderObject[] = [];
    current();
    // kept: what the next build of the same data reuses (review S1: set only by a build that finished)
    builtFor = data;
    cutters = cuts;
    selections = pools.filter((p) => p !== undefined);
    assigners = assigns;
    merged = mergeRenderObjectsByType(entries, true, new Map(), out, true, true, graphics);
    // the far look's surfaces (`far`: texture, both; tiles: both): one a leaflet at its heads, in its species' colours
    // (round 4b); a tiles leaflet's on its surface (at its mid-plane: the heads past it), coloured as the cutter cuts the
    // patch there (the species' proportions and grain, not each tile's lipids)
    const nextFading: typeof fading = [];
    const nextRasters: typeof rasters = [];
    const nextPatches: typeof patches = [];
    const nextPartSurfaces: typeof partSurfaces = [];
    const nextTextures: Texture[] = [];
    if (props.far !== 'spheres') {
      const surfaces = [
        ...data.cut.filter((l) => !partHidden(l)).map((l) => ({ ...l, offset: 0, far: () => partColor(l) })),
        ...data.leaflets.map((l) => ({ ...l, offset: l.tileSet.offset, part: undefined, far: () => undefined })),
      ];
      const enter = lipidsPx(props);
      // round 8: the middle look over a cut leaflet's far surface, its texture flat (the look lights the relief)
      const middle = data.method === 'cutter' && middleOn(props) ? props.middle : 'coarse';
      for (const leaflet of surfaces) {
        const { table } = leaflet;
        const size = lipidSize(table);
        const shown = (sp: number) => !hidden.has(table.species[sp]);
        // a part's colour: the surface's far colour by zoom, all of its texture without (round 7 item 2); times its
        // mesh's tint (round 9). Read when rastered: a recolour rasters again (`recolor`)
        const farColor = () => tint(leaflet.far() ?? props.color, tintOf(leaflet.part));
        const colors = () => {
          const t = tintOf(leaflet.part);
          const partColor = leaflet.far();
          const one = tint(partColor ?? props.color, t);
          const flat = props.colorBy === 'uniform' || (partColor !== undefined && !levelsOn(props));
          return (sp: number) => (flat || sp < 0 ? one : tint(colorOf(table.species[sp]), t));
        };
        const signature = () => `${tintOf(leaflet.part) ?? -1} ${leaflet.far() ?? -1}`;
        // a cut leaflet's two (round 4c item 7): beneath its lipids at the lowest head, coarser, where they are drawn
        // (the gaps between them, no gap at any distance), and where its spheres stop the one that takes over, coloured
        // as they show the patch, at their tops; a tiles leaflet's beneath its tiles, always
        const cut = leaflet.offset === 0 && data.method === 'cutter';
        // round 5: the patch as a texture on the mesh's own triangles, mapped per fragment as the cutter maps it (its
        // regions and cells), mipmapped: the spheres' look at the switch, their mean far away, at any scale
        const relief = cut && middle !== 'coarse';
        const raster = patchRaster(table, shown, leaflet.name, colors(), switchSpheres(table, props, enter), !relief);
        const patch = patchTexture(graphics, raster);
        const rastered = {
          table,
          shown,
          side: leaflet.name,
          colors,
          farColor,
          signature,
          signed: signature(),
          cut,
          patch,
          far: [] as BaseValues[],
          surfaces: [] as BaseValues[],
        };
        nextRasters.push(rastered);
        made.push(patch);
        nextTextures.push(patch);
        const head = headOffset(table, leaflet.name) - leaflet.offset;
        const top =
          raster.mean === undefined ? head : (leaflet.name === 'outer' ? 1 : -1) * raster.mean - leaflet.offset;
        // beneath a cut leaflet's lipids: just off the mid-plane (round 5: at the lowest head it stood over the lipids of
        // the coarser levels, in bands across a close view)
        const beneath = (leaflet.name === 'outer' ? 1 : -1) * NearLift;
        for (const fade of cut ? (['near', 'far'] as const) : ([undefined] as const)) {
          const lift = fade === 'far' ? top : fade === 'near' ? beneath : head;
          // round 6: a surface a part (a cell's membrane), hidden with its lipids where it is enclosed (`showParts`);
          // round 7: a cut leaflet a part, its surface its own
          const f = patchSurface(leaflet.mesh, leaflet.regions, leaflet.name, lift);
          const patchShifts = patchTable(graphics, leaflet.regions, f.shifts);
          made.push(patchShifts);
          nextTextures.push(patchShifts);
          const object = patchObject(f, [patch, patchShifts], table, leaflet.regions, size, props, !!fade, farColor());
          if (relief && fade === 'far') setMiddle(object.values, middle, props, raster);
          if (cut && fade === 'far') rastered.far.push(object.values as BaseValues);
          rastered.surfaces.push(object.values as BaseValues);
          nextPatches.push({ values: object.values as BaseValues, size });
          if (fade) {
            const values = object.values as BaseValues;
            nextFading.push({ values, size, near: fade === 'near' });
            const at = fade === 'near' ? nearPx(props) : enter;
            fadeSurface(values, size, at, fade === 'near', lastLod.depthScale, lastLod.pixelSize);
          }
          if (cut && leaflet.part !== undefined) nextPartSurfaces.push({ object, part: leaflet.part });
          out.push(object);
        }
      }
    }
    fading = nextFading;
    rasters = nextRasters;
    patches = nextPatches;
    partSurfaces = nextPartSurfaces;
    // as the last view showed them, before the next view's hook (review S1, nit)
    showParts();
    // the textures of two builds ago: the last build's objects may draw once more (a frame before the swap)
    for (const t of retiredTextures) t.destroy();
    retiredTextures = patchTexturesInUse;
    patchTexturesInUse = nextTextures;
    renderObjects = out;
    members = building;
    painters = paintersBuilding;
    // a clip given while this build ran (a handle's preview: outside the state) reached the old members only: all of
    // this build's carry the latest (review S4)
    for (const v of members) setClip(v, props.clip);
    for (const o of out) setClip(o.values as BaseValues, props.clip);
    // and the latest edges (an edge alone while it ran reached the old objects only: `setColorEdges`)
    setColorEdges();
  }

  /**
   * A middle look switched (the gate's S2, design §5): each cut leaflet's patch rastered again into its texture (flat
   * under a relief, shaded for coarse; the lipids' level at the new px), its far surface's define and uniforms, the
   * fades for the new px, and the next view selects anew; nothing built
   */
  function setMiddleLook() {
    const enter = lipidsPx(props);
    const middle = builtFor?.method === 'cutter' && middleOn(props) ? props.middle : 'coarse';
    const relief = middle !== 'coarse';
    for (const r of rasters) {
      // a tiles leaflet's has no middle look
      if (!r.cut) continue;
      const raster = patchRaster(r.table, r.shown, r.side, r.colors(), switchSpheres(r.table, props, enter), !relief);
      r.signed = r.signature();
      r.patch.load(raster);
      r.patch.mipmap();
      for (const values of r.far) {
        if (relief) setMiddle(values, middle, props, raster);
        else ValueCell.updateIfChanged((values as unknown as { dPatchMiddle: ValueCell<string> }).dPatchMiddle, 'off');
      }
    }
    const near = nearPx(props);
    for (const f of fading) {
      fadeSurface(f.values, f.size, f.near ? near : enter, f.near, lastLod.depthScale, lastLod.pixelSize);
    }
    // a new px, a new selection (not kept by the old one's hysteresis)
    views.reset();
    for (const sel of selections) sel.reset();
    // the culler culls again (its view hooks, a still camera too) where its object's transform changes
    // (merged-culler.ts, `uObjectTransform`): the same transform, a new version. It has no hook for a pool's params
    for (const o of renderObjects) {
      if (o.type !== 'spheres') continue;
      const t = (o.values as { uObjectTransform?: ValueCell<unknown> }).uObjectTransform;
      if (t) ValueCell.update(t, t.ref.value);
    }
  }

  /**
   * Colours alone changed (round 9: a mesh recoloured, the switch, a species' or part's colour): each member's colour
   * data written again in place, every surface's colour, and the patch rastered again only for the leaflets whose
   * colours changed (all of them where the membrane's or its species' did); false, nothing written, where a member's
   * granularity changes (one colour or by species: built again)
   */
  function recolor(before: LipidMembraneReprProps) {
    for (const p of painters) if (p.uniform !== p.uniformNow()) return false;
    for (const p of painters) p.paint();
    const all = differs(before, props, 'color') || differs(before, props, 'speciesColors');
    const enter = lipidsPx(props);
    const relief = builtFor?.method === 'cutter' && middleOn(props) && props.middle !== 'coarse';
    for (const r of rasters) {
      const far = r.farColor();
      for (const v of r.surfaces) createValueColor(far, v as never);
      const signed = r.signature();
      if (!all && signed === r.signed) continue;
      r.signed = signed;
      rastersMade += 1;
      const shade = !(r.cut && relief);
      r.patch.load(patchRaster(r.table, r.shown, r.side, r.colors(), switchSpheres(r.table, props, enter), shade));
      r.patch.mipmap();
    }
    return true;
  }
  /** the patch rasters a recolour made (round 9: only the changed leaflets'), for the tests */
  let rastersMade = 0;
  /** the data whose last `createOrUpdate` finished: the same look of it again draws nothing (round 9) */
  let settled: MembraneData | undefined;

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
      Task.create('Lipid membrane', async (runtime) => {
        const before = props;
        const beforeTints = tints;
        props = { ...props, ...p };
        if (data) lastData = data;
        tints = givenTints;
        const tinted = !sameTints(beforeTints, tints);
        // the same look of the same data (round 9: a mesh's opacity, its state dependency's update): nothing again
        if (lastData && settled === lastData && !tinted && sameLook(before, props)) return;
        settled = undefined;
        // a cut alone (a clip's handle as it goes, its release): the drawn objects' clip values, nothing built again
        // a middle look's cut band comes or goes with the clip: its lipids' levels built (the gate's M1)
        const bandChanged = cutBandOn(before) !== cutBandOn(props);
        if (lastData && builtFor === lastData && !tinted && onlyClip(before, props) && !bandChanged) {
          for (const v of members) setClip(v, props.clip);
          for (const o of renderObjects) setClip(o.values as never, props.clip);
          // a clip shows the leaflet behind (`facing` off): where clips come or go the next view selects anew (review M4;
          // a still camera too: the culler's clip change calls the view hooks again, `syncClip`)
          if (before.clip.objects.length > 0 !== props.clip.objects.length > 0) {
            views.reset();
            for (const sel of selections) sel.reset();
          } else if (cutBandOn(props)) {
            // the band follows the cut (a handle's drag): the next view selects anew, the old units kept until then
            views.reset();
          }
        } else if (lastData && builtFor === lastData && !tinted && onlyMiddle(before, props)) {
          setMiddleLook();
        } else if (lastData && builtFor === lastData && !tinted && onlyColorEdges(before, props)) {
          // the colours by zoom's edges alone (round 7 item 6): their uniforms, nothing built again
          setColorEdges();
        } else if (lastData && builtFor === lastData && onlyColors(before, props) && recolor(before)) {
          // colours alone (round 9): written in place, nothing built again
        } else if (lastData) await build(lastData, runtime);
        settled = lastData;
        version += 1;
        updated.next(version);
      }),
    setState: (s) => {
      Representation.updateState(state, s);
      for (const o of renderObjects) {
        if (s.visible !== undefined) Object.assign(o.state, { visible: s.visible });
      }
      showParts();
    },
    // a new context (a fall back to WebGL2, a restore): nothing of the previous one kept, made again by the next
    // `createOrUpdate` where it can (on WebGL2 nothing: a WebGPU object there uploaded a texture past its range)
    setGraphics: (g) => {
      generation += 1;
      settled = undefined;
      release();
      releaseTextures();
      builtFor = undefined;
      renderObjects = [];
      members = [];
      merged.clear();
      graphics = g;
    },
    setTheme: () => {},
    getLoci: () => EmptyLoci,
    getAllLoci: () => [],
    eachLocation: () => {},
    mark: () => false,
    destroy: () => {
      release();
      releaseTextures();
      builtFor = undefined;
      renderObjects = [];
      members = [];
      merged.clear();
    },
  };
  // the meshes' tints (round 9, `meshTints`), given before `createOrUpdate` (not a param: the meshes' state, not the
  // membrane's); and those applied
  Object.assign(repr, {
    setMeshTints: (t: MeshTints) => {
      givenTints = t;
    },
  });
  Object.defineProperty(repr, 'meshTints', { get: () => tints });
  Object.defineProperty(repr, 'rasters', { get: () => rastersMade });
  // the cutter's lipids, counted on the GPU (the tiles' are `membraneCounts`)
  // a getter (`Object.assign` would copy its value of now)
  Object.defineProperty(repr, 'cutLipids', { get: () => cutLipids });
  // the clip each drawn member and surface carries (its object count): the race with a redraw (review S4)
  Object.defineProperty(repr, 'clipCounts', {
    get: () => [
      ...members.map((v) => v.dClipObjectCount.ref.value),
      ...renderObjects.filter((o) => o.type === 'mesh').map((o) => (o.values as BaseValues).dClipObjectCount.ref.value),
    ],
  });
  // the pool: its live lipids, its views selected for and regenerations (lipid-procedural's camera path)
  Object.defineProperty(repr, 'pool', {
    get: () => {
      let live = 0;
      let triangles = 0;
      let inView = 0;
      let selectMs = 0;
      for (const s of selections) {
        for (const n of s.live) live += n;
        triangles += s.count;
        inView += s.inView;
        selectMs += views.times.get(s) ?? 0;
      }
      // `triangles`: the units taken (a whole triangle or a cell, round 5); `selectMs` the last selection's CPU time
      return { live, triangles, inView, selectMs, selects: views.stats.selects, ...selectionStats };
    },
  });
  return repr as typeof repr & {
    setMeshTints(tints: MeshTints): void;
    readonly meshTints: MeshTints;
    readonly cutLipids: number;
    readonly pool: {
      live: number;
      triangles: number;
      inView: number;
      selectMs: number;
      selects: number;
      regenerations: number;
    };
  };
}

export const LipidMembraneParams = {
  method: PD.Select<MembraneMethod>(
    'tiles',
    [
      ['tiles', 'Tiles (remeshed, matched edges)'],
      ['cutter', 'Cutter (cellPACKgpu’s, on the mesh’s triangles)'],
    ],
    { description: 'How the lipids are made' },
  ),
  mesh: PD.Text('', { description: 'A mesh (a shape) by state ref; empty: a sphere of `radius` at `center`' }),
  meshes: PD.Value<string[]>([], {
    isHidden: true,
    description: 'Meshes by state ref wrapped as one membrane, a part each (a cell’s membranes; round 6): over `mesh`',
  }),
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

/** Meshes as one, each a part (its triangles' range), named */
export function concatMeshes(meshes: readonly TriMesh[], names: readonly string[]) {
  let V = 0;
  let I = 0;
  for (const m of meshes) {
    V += m.positions.length;
    I += m.indices.length;
  }
  const positions = new Float32Array(V);
  const indices = new Uint32Array(I);
  const parts: TrianglePart[] = [];
  let v = 0;
  let i = 0;
  meshes.forEach((m, k) => {
    positions.set(m.positions, v);
    for (let j = 0; j < m.indices.length; ++j) indices[i + j] = m.indices[j] + v / 3;
    parts.push({ start: i / 3, end: (i + m.indices.length) / 3, name: names[k] });
    v += m.positions.length;
    i += m.indices.length;
  });
  return { mesh: { positions, indices } as TriMesh, parts };
}

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

/**
 * A mesh's name, a part's: its shape's label (a representation given, as the explorer's rows are, is labelled by its
 * provider's data, `Mesh` for every OBJ-made shape: round 9 found the yeast cell's parts all named so in the app)
 */
function meshName(state: State, ref: string) {
  const cell = state.cells.get(ref);
  const shape = cell?.transform.transformer === ShapeRepresentation3D ? state.cells.get(cell.transform.parent) : cell;
  return shape?.obj?.label ?? cell?.obj?.label ?? ref;
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
    oldParams.mesh === newParams.mesh &&
    oldParams.meshes.join() === newParams.meshes.join() &&
    oldParams.patch === newParams.patch &&
    oldParams.edge === newParams.edge,
  apply({ params }, plugin: PluginContext) {
    return Task.create('Lipid membrane', async (runtime) => {
      let mesh: TriMesh | undefined;
      let parts: TrianglePart[] | undefined;
      if (params.meshes.length > 0) {
        // round 6: meshes wrapped as one (a cell's membranes), concatenated, a part each by its node's label
        const meshes: TriMesh[] = [];
        for (const ref of params.meshes) {
          const m = await shapeMesh(plugin, ref, runtime);
          if (!m) throw new Error(`No mesh at ${ref}.`);
          meshes.push(m);
        }
        const names = params.meshes.map((ref) => meshName(plugin.state.data, ref));
        ({ mesh, parts } = concatMeshes(meshes, names));
      } else if (params.mesh) {
        mesh = await shapeMesh(plugin, params.mesh, runtime);
        if (!mesh) throw new Error(`No mesh at ${params.mesh}.`);
      }
      const surface = { mesh, center: params.center, radius: params.radius, parts };
      const edge = params.edge > 0 ? params.edge : suitedEdge(surface);
      const variants = params.variants > 0 ? params.variants : suitedVariants(edge);
      const kinds = { edgeTypes: params.edgeTypes, vertexColors: 1, variants, seed: params.seed };
      const data = await runSteps(
        buildMembraneSteps(surface, params.patch, edge, params.leaflets, kinds, params.method),
        runtime,
      );
      if (typeof data === 'string') throw new Error(data);
      if (data.unmixed?.length) {
        plugin.log.warn(
          `The lipid patch lacks a species of the mix of ${data.unmixed.join(', ')}: cut from the patch as it is.`,
        );
      }
      if (!canDrawLipidMembranes(plugin)) {
        plugin.log.warn('Lipid membranes are drawn with WebGPU only: switch the backend to WebGPU to see this one.');
      }
      const repr = LipidMembraneRepresentation(plugin.canvas3d?.graphics);
      repr.setMeshTints(meshTints(plugin.state.data, params));
      await repr.createOrUpdate(params, data).runInContext(runtime);
      const { tiles, lipids } = membraneCounts(data);
      const all = lipids + repr.cutLipids;
      return new SO.Shape.Representation3D(
        { repr: repr as never, sourceData: data },
        {
          label: 'Lipid membrane',
          description:
            data.method === 'cutter'
              ? `${all.toLocaleString()} lipids, cut`
              : `${all.toLocaleString()} lipids, ${tiles.toLocaleString()} tiles`,
        },
      );
    });
  },
  update({ b, oldParams, newParams }, plugin: PluginContext) {
    return Task.create('Lipid membrane', async (runtime) => {
      const rebuild = Object.keys(LipidMembraneParams).some(
        (k) =>
          !(k in LipidMembraneReprParams) &&
          JSON.stringify(oldParams[k as never]) !== JSON.stringify(newParams[k as never]),
      );
      if (rebuild) return StateTransformer.UpdateResult.Recreate;
      // its meshes' colours (round 9): a mesh's update reaches here by the state dependency (`mesoscale.wrapMembrane`)
      (b.data.repr as unknown as { setMeshTints(t: MeshTints): void }).setMeshTints(
        meshTints(plugin.state.data, newParams),
      );
      await b.data.repr.createOrUpdate(newParams as never, b.data.sourceData as never).runInContext(runtime);
      return StateTransformer.UpdateResult.Updated;
    });
  },
});
