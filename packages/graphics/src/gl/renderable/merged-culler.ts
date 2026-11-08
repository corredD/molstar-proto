/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Clip } from '@molstar/core/util/clip';
import {
  ClipStorageVec4s,
  getCullClipCount,
  getCullInstanceClipCount,
  packStorageClipObjects,
} from '../clip-storage.js';
import { ValueCell } from '@molstar/core/util';
import { isDebugMode } from '@molstar/core/util/debug';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import type { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import type { ComputeContext, ComputeKernel, KernelRequest, StorageBuffer } from '../compute.js';
import {
  CellCullKernel,
  CellCullSchema,
  CullArgsKernel,
  CullArgsSchema,
  InstanceCopyKernel,
  InstanceCopySchema,
  MaxCullLevels,
  type OcclusionPyramid,
  createEmptyHiZ,
  createHiZValues,
  setHiZValues,
  workgroupRows,
} from '../compute/cell-cull.js';
import { IndirectRecordBytes, type MultiDrawBaseData } from '../render-item.js';
import type { GraphicsResources } from '../context.js';
import { type AnimationValues, getAnimationSlack, type LodLevelsValue, LodView } from '../renderable.js';
import { InstanceDataVec4s, type Merged, type MergeableValues, packInstanceData } from './merged.js';
import { packAffineRows } from '../affine-rows.js';

/**
 * GPU culling of a merged render object by the cells of its members' instance grids (`merged-render-objects.md` GPU
 * culling): per frame (`dispatch`, before the passes) the cells tested and the instances of the drawn ones copied into
 * compacted instanced attributes (`attributes`, bound in place of the merged object's), a region per level and
 * segment, drawn by an indirect record per level and segment (`getLists`); the programs stay the same. Members without
 * a grid are a cell of all their instances. The compacted attributes end with all instances in their own order
 * (`identityBase`): views not culled on the GPU (a scaled model, another view of the frame) draw the CPU culling's
 * lists shifted to it
 */
export interface MergedCuller {
  /** the compacted instanced attributes, by name */
  readonly attributes: {
    readonly aTransform: ValueCell<StorageBuffer>;
    readonly aInstance: ValueCell<StorageBuffer>;
    readonly aSegment: ValueCell<StorageBuffer>;
  };
  /** the first instance of the identity region */
  readonly identityBase: number;
  /** after the merged values synced: the cells, records and instances written where they changed */
  sync: () => void;
  /**
   * culls with the planes, the levels' ranges for `lod`, and the occlusion of `pyramid` where given (the previous
   * frame's); false where the kernels
   * are not ready yet (compiling in the background)
   */
  dispatch: (
    cameraPlane: Plane3D,
    frustum: Frustum3D,
    lod: LodView,
    pyramid?: OcclusionPyramid,
    raster?: MergedRasterParams,
  ) => boolean;
  /** whether `dispatchSecond` is to run for the last `dispatch`: it culled anew, against a pyramid */
  readonly secondPending: boolean;
  /**
   * The second phase of the last `dispatch` (no pass open): the instances it left out tested against `pyramid`, of the
   * frame's depth so far with the frame's camera, those visible for `getSecondLists`; what the first drew stays hidden
   * or not as it is, its depth part of the frame's, so what this leaves out is hidden in the finished frame. Afterwards
   * `getLists` draw both. No pyramid: nothing, the frame stays as the first phase left it
   */
  dispatchSecond: (pyramid: OcclusionPyramid | undefined) => boolean;
  /** whether `dispatchSecond` ran for the last `dispatch` */
  readonly secondDispatched: boolean;
  /** `getLists` for the instances of the second phase alone */
  getSecondLists: (levels: readonly MultiDrawBaseData[], withRaster?: boolean) => MultiDrawBaseData[];
  /** per level its indirect list, with the uniforms of the level lists of the CPU culling (`levels`) */
  getLists: (levels: readonly MultiDrawBaseData[], withRaster?: boolean) => MultiDrawBaseData[];
  /**
   * what the sphere raster draws from (`sphere-raster.ts`): the instances of the raster regions of the last `dispatch`;
   * undefined where it had no raster parameters
   */
  getRasterInput: () => MergedRasterInput | undefined;
  /** whether the lists draw only the records with instances (`compactRecords`) */
  readonly recordsCompact: boolean;
  /** advances where the records the lists draw changed: recordings of them no longer hold */
  readonly recordsVersion: number;
  destroy: () => void;
}

/**
 * The compacted instances of a dispatch for kernels drawing them (the sphere raster): a region per level and segment,
 * its count, vertex count and first vertex in `records` (the indirect records, level-major: `j * segmentCount + s`)
 */
export interface MergedRasterInput {
  /** the transforms' affine rows, three vec4s an instance */
  readonly transforms: StorageBuffer;
  /** `aInstance`, a float an instance */
  readonly instances: StorageBuffer;
  /** `aSegment`, a vec4 an instance */
  readonly segments: StorageBuffer;
  readonly records: StorageBuffer;
  /** the second phase's records (`MergedCuller.dispatchSecond`), as `records` */
  readonly secondRecords: StorageBuffer;
  /** whether the second phase ran for this dispatch */
  readonly secondDispatched: boolean;
  /** u32 words a record (the first instance its last) */
  readonly recordWords: number;
  /** the levels' lists (at least 1), the levels of the first member (0 without) */
  readonly levels: number;
  readonly levelCount: number;
  readonly lodLevels: LodLevelsValue | undefined;
  readonly instanceCount: number;
  readonly segmentCount: number;
  /** chunks of 64 spheres of all regions full (each segment's instances at each level) */
  readonly chunkCapacity: number;
  /** advances with each dispatch: what the regions hold changed */
  readonly dispatchVersion: number;
  /** the raster regions' first record and first slot (after the levels' regions) */
  readonly recordBase: number;
  readonly slotBase: number;
}

/**
 * The sphere raster's split of a dispatch (`sphere-compute-raster.md`, the split per instance): instances whose largest
 * sphere is at most `radius` pixels at their nearest point, in front of the `near` plane, go into raster regions after
 * the levels' (`MergedRasterInput`); the impostors draw the rest (`getLists` without them)
 */
export interface MergedRasterParams {
  readonly radius: number;
  /** pixels per Å of radius over the distance: the projection's focal scale times half the viewport */
  readonly scale: number;
  readonly near: number;
}

/**
 * The cells culled on the GPU per side of a grid cell: the grid's cells (`cellSize`, 200 Å by default) also order the
 * CPU culling's draws, where finer cells split its ranges into more draws (a grid of 50 Å: 2.3x the draws zoomed into
 * `postsynstubby_2`); on the GPU cells cost threads, not draws, and finer cells occlude better (4 a side: the opaque
 * pass 16-19% less there; 8 no better)
 */
const GpuCellDivisions = 4;

const SplitBuckets = GpuCellDivisions * GpuCellDivisions * GpuCellDivisions;
const splitBox = new Float64Array(SplitBuckets * 6);
const splitCount = new Uint32Array(SplitBuckets);
const splitCellOf = new Int32Array(SplitBuckets);
let splitBucket = new Uint8Array(0);
let splitCenters = new Float64Array(0);

/**
 * The instances `start` to `end` of a grid cell (`transforms`, the grid's order) split into cells of side `fine` by
 * their centers (`invariant`'s, transformed): each cell's sphere, as the grid's (the box of the centers expanded by the
 * invariant radius), appended to `spheres`; `assign` given each instance's cell
 */
function splitCell(
  transforms: Float32Array,
  invariant: Sphere3D,
  start: number,
  end: number,
  fine: number,
  spheres: number[],
  assign: (instance: number, cell: number) => void,
) {
  const n = end - start;
  if (splitBucket.length < n) {
    splitBucket = new Uint8Array(n);
    splitCenters = new Float64Array(n * 3);
  }
  const [cx, cy, cz] = invariant.center;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (let j = 0; j < n; ++j) {
    const o = (start + j) * 16;
    const x = transforms[o] * cx + transforms[o + 4] * cy + transforms[o + 8] * cz + transforms[o + 12];
    const y = transforms[o + 1] * cx + transforms[o + 5] * cy + transforms[o + 9] * cz + transforms[o + 13];
    const z = transforms[o + 2] * cx + transforms[o + 6] * cy + transforms[o + 10] * cz + transforms[o + 14];
    splitCenters[j * 3] = x;
    splitCenters[j * 3 + 1] = y;
    splitCenters[j * 3 + 2] = z;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
  }
  splitCount.fill(0);
  const d = GpuCellDivisions;
  const index = (v: number, min: number) => Math.min(d - 1, Math.floor((v - min) / fine));
  for (let j = 0; j < n; ++j) {
    const x = splitCenters[j * 3];
    const y = splitCenters[j * 3 + 1];
    const z = splitCenters[j * 3 + 2];
    const b = index(x, minX) + d * (index(y, minY) + d * index(z, minZ));
    splitBucket[j] = b;
    const o = b * 6;
    if (splitCount[b] === 0) {
      splitBox[o] = splitBox[o + 3] = x;
      splitBox[o + 1] = splitBox[o + 4] = y;
      splitBox[o + 2] = splitBox[o + 5] = z;
    } else {
      if (x < splitBox[o]) splitBox[o] = x;
      if (y < splitBox[o + 1]) splitBox[o + 1] = y;
      if (z < splitBox[o + 2]) splitBox[o + 2] = z;
      if (x > splitBox[o + 3]) splitBox[o + 3] = x;
      if (y > splitBox[o + 4]) splitBox[o + 4] = y;
      if (z > splitBox[o + 5]) splitBox[o + 5] = z;
    }
    splitCount[b] += 1;
  }
  const r = invariant.radius;
  for (let b = 0; b < SplitBuckets; ++b) {
    if (splitCount[b] === 0) continue;
    splitCellOf[b] = spheres.length / 4;
    const o = b * 6;
    // the sphere around the box expanded by the radius (`Sphere3D.fromBox3D`)
    const hx = (splitBox[o + 3] - splitBox[o]) / 2 + r;
    const hy = (splitBox[o + 4] - splitBox[o + 1]) / 2 + r;
    const hz = (splitBox[o + 5] - splitBox[o + 2]) / 2 + r;
    spheres.push(
      (splitBox[o] + splitBox[o + 3]) / 2,
      (splitBox[o + 1] + splitBox[o + 4]) / 2,
      (splitBox[o + 2] + splitBox[o + 5]) / 2,
      Math.sqrt(hx * hx + hy * hy + hz * hz),
    );
  }
  for (let j = 0; j < n; ++j) assign(start + j, splitCellOf[splitBucket[j]]);
}

/** The culling's kernels, the same for every object: prepared once a culler is created, or by `Canvas3D.precompile` */
export const MergedCullKernels: readonly KernelRequest[] = [
  { code: CellCullKernel, schema: CellCullSchema },
  { code: InstanceCopyKernel, schema: InstanceCopySchema },
  { code: CullArgsKernel, schema: CullArgsSchema },
];

/** Floats per instance of the compacted attributes, by name */
const AttributeFloats = { aTransform: 12, aInstance: 1, aSegment: 4 } as const;

const EmptyInt = new Int32Array(0);
const EmptyUint = new Uint32Array(0);

export function createMergedCuller(
  compute: ComputeContext,
  /** for a texture bound while there is no pyramid */
  resources: GraphicsResources,
  merged: Merged,
  members: readonly MergeableValues[],
  indexed: boolean,
): MergedCuller {
  const { values, segments } = merged;
  const stride = indexed ? IndirectRecordBytes.indexed : IndirectRecordBytes.vertex;
  const words = stride / 4;

  const createBuffer = (bytes: number, label: string) => compute.createBuffer(Math.max(16, bytes), label);
  /** each buffer's label, kept when `ensure` replaces it */
  const labels = new Map<ValueCell<StorageBuffer>, string>();
  const buffer = (label: string) => {
    const cell = ValueCell.create(createBuffer(16, label));
    labels.set(cell, label);
    return cell;
  };
  const instanceData = buffer('culled instance data');
  const instanceCells = buffer('culled instance cells');
  const segmentData = buffer('culled segment data');
  const cellSpheres = buffer('culled cell spheres');
  const cellLevels = buffer('culled cell levels');
  const counters = buffer('culled counters');
  const args = buffer('culled draw arguments');
  const secondArgs = buffer('culled draw arguments, second phase');
  const attributes = {
    aTransform: buffer('culled transforms'),
    aInstance: buffer('culled instances'),
    aSegment: buffer('culled segments'),
  };

  const levelCountCell = ValueCell.create(0);
  const cellValues = {
    uPlane0: ValueCell.create(Vec4()),
    uPlane1: ValueCell.create(Vec4()),
    uPlane2: ValueCell.create(Vec4()),
    uPlane3: ValueCell.create(Vec4()),
    uPlane4: ValueCell.create(Vec4()),
    uPlane5: ValueCell.create(Vec4()),
    uCameraPlane: ValueCell.create(Vec4()),
    uLodRange: ValueCell.create(Vec4()),
    uLevels: ValueCell.create(Mat4()),
    uLevelCount: levelCountCell,
    uAnimationSlack: ValueCell.create(0),
    uCellCount: ValueCell.create(0),
    ...createHiZValues(createEmptyHiZ(resources)),
    uHiZClamp: ValueCell.create(false),
    uClipObjectCount: ValueCell.create(0),
    uClipBase: ValueCell.create(0),
    segmentData,
    cellSpheres,
    cellLevels,
  };
  const emptyHiZ = cellValues.tHiZ.ref.value;
  // the sphere tests' uniforms shared with the cells' kernel (the same cells, set once per dispatch)
  const { uCellCount: _, cellSpheres: __, cellLevels: ___, ...sphereTestValues } = cellValues;
  const copyValues = {
    ...sphereTestValues,
    uInstanceCount: ValueCell.create(0),
    uSegmentCount: ValueCell.create(0),
    uRasterRadius: ValueCell.create(0),
    uRasterScale: ValueCell.create(0),
    uRasterNear: ValueCell.create(0),
    uRasterLevels: ValueCell.create(0),
    uClipInstance: ValueCell.create(0),
    uPhase: ValueCell.create(0),
    instanceData,
    instanceCells,
    cellLevels,
    counters,
    transforms: attributes.aTransform,
    instances: attributes.aInstance,
    segments: attributes.aSegment,
  };
  const argsValues = {
    uRecordCount: ValueCell.create(0),
    uRecordWords: ValueCell.create(words),
    uPhase: copyValues.uPhase,
    counters,
    args,
    second: secondArgs,
  };
  let kernels: ComputeKernel[] | undefined;
  let preparing = false;
  /** a kernel's workgroups over `n` items, in rows past the device's limit (`workgroupRows`) */
  const groups = (n: number) => workgroupRows(n, CellCullKernel.workgroupSize[0], compute.maxWorkgroupsPerDimension);
  const getKernels = () => {
    if (kernels) return true;
    if (!compute.hasKernels(MergedCullKernels)) {
      if (!preparing) {
        preparing = true;
        compute.prepareKernels(MergedCullKernels).finally(() => (preparing = false));
      }
      return false;
    }
    kernels = [
      compute.createKernel(CellCullKernel, CellCullSchema, cellValues),
      compute.createKernel(InstanceCopyKernel, InstanceCopySchema, copyValues),
      compute.createKernel(CullArgsKernel, CullArgsSchema, argsValues),
    ];
    return true;
  };

  /** replaces the buffer of `cell` by one of at least `bytes` where it is smaller */
  const ensure = (cell: ValueCell<StorageBuffer>, bytes: number) => {
    if (cell.ref.value.byteLength >= bytes) return;
    cell.ref.value.destroy();
    ValueCell.update(cell, createBuffer(bytes, labels.get(cell) ?? 'merged culling'));
  };

  let instanceCount = 0;
  let segmentCount = 0;
  let cellCount = 0;
  let levelCount = 0;
  let identityBase = 0;
  let chunkCapacity = 0;
  /** whether the layout has raster regions (from the first dispatch with raster parameters on) */
  let rasterRegions = false;
  /** `getSegmentData` of the layout */
  let segmentDataCopy: Float32Array | undefined;
  /** the largest scale of each segment's instances (`rasterized` scales the largest sphere by the instance's) */
  let segmentScales = new Float32Array(0);
  let rasterDispatched = false;
  let secondPending = false;
  let secondDispatched = false;

  /**
   * The cells by member (`merged-render-objects.md` cells by member): each member's in a block of slots of its own (`slotBases`, `slotCounts`: its cells and room to
   * grow), so a member whose instances moved (a drag's preview: one member of thousands, each pointer event) writes its
   * block, its instances' cells, its segment and records alone (`syncMembers`), O(its instances); a full layout only
   * where the structure changed or a member outgrew its block. Slots a member does not use are empty spheres no
   * instance names (the instance kernel copies the instances of the cells drawn, by their cell)
   */
  let slotBases = new Uint32Array(0);
  let slotCounts = new Uint32Array(0);
  let slotSpheres = new Float32Array(0);
  let cellOf = new Uint32Array(0);
  /** per member the versions its cells, segment and records were written from (`MemberKeyLength` each) */
  let memberKeys = new Float64Array(0);
  /** per member its part of `chunkCapacity` */
  let memberChunks = new Float64Array(0);
  /** a member's cells (`computeMemberCells`): their spheres, and its instances' cells (member-local) */
  const memberSpheres: number[] = [];
  let memberCellOf = new Uint32Array(0);
  const assignMemberCell = (instance: number, cell: number) => {
    memberCellOf[instance] = cell;
  };

  /** member `s`'s cells: per cell of its grid with instances, or one of all its instances without a grid; their count */
  function computeMemberCells(s: number) {
    const member = members[s];
    const n = segments.instanceCounts[s];
    memberSpheres.length = 0;
    if (memberCellOf.length < n) memberCellOf = new Uint32Array(Math.max(n, memberCellOf.length * 2));
    const grid = member.instanceGrid.ref.value;
    if (grid.cellSize <= 1) {
      const b = member.boundingSphere.ref.value as Sphere3D;
      memberSpheres.push(b.center[0], b.center[1], b.center[2], b.radius);
      memberCellOf.fill(0, 0, n);
      return 1;
    }
    const { cellOffsets, cellSpheres: gridSpheres, cellCount: gridCells } = grid;
    const transforms = member.aTransform.ref.value as Float32Array;
    const invariant = member.invariantBoundingSphere.ref.value as Sphere3D;
    const fine = grid.cellSize / GpuCellDivisions;
    for (let k = 0; k < gridCells; ++k) {
      const start = cellOffsets[k];
      const end = cellOffsets[k + 1];
      if (start === end) continue;
      if (end - start === 1) {
        memberCellOf[start] = memberSpheres.length / 4;
        for (let q = 0; q < 4; ++q) memberSpheres.push(gridSpheres[k * 4 + q]);
        continue;
      }
      splitCell(transforms, invariant, start, end, fine, memberSpheres, assignMemberCell);
    }
    return memberSpheres.length / 4;
  }

  /** the slots for `cells` cells: a gridless member has one always; a gridded one room for a quarter more */
  const slotsFor = (s: number, cells: number) =>
    members[s].instanceGrid.ref.value.cellSize <= 1 ? 1 : cells + Math.max(2, cells >> 2);

  /** member `s`'s cells (`computeMemberCells`, `cells` of them) into its block and its instances' cells */
  function writeMemberCells(s: number, cells: number) {
    const base = slotBases[s];
    for (let q = 0, ql = cells * 4; q < ql; ++q) slotSpheres[base * 4 + q] = memberSpheres[q];
    slotSpheres.fill(0, (base + cells) * 4, (base + slotCounts[s]) * 4);
    const first = segments.instanceBases[s];
    for (let i = 0, il = segments.instanceCounts[s]; i < il; ++i) {
      cellOf[(first + i) * 2] = base + memberCellOf[i];
      cellOf[(first + i) * 2 + 1] = s;
    }
  }

  const MemberKeyLength = 5;
  /** whether member `s`'s cells, segment or records may have changed since written; with `store`, marks them written */
  function memberChanged(s: number, store: boolean) {
    const m = members[s];
    const o = s * MemberKeyLength;
    const a = m.instanceGrid.ref.version;
    const b = m.aTransform.ref.version;
    const c = m.invariantBoundingSphere.ref.version;
    const d = m.boundingSphere.ref.version;
    const e = m.lodLevels?.ref.version ?? -1;
    const k = memberKeys;
    const changed = k[o] !== a || k[o + 1] !== b || k[o + 2] !== c || k[o + 3] !== d || k[o + 4] !== e;
    if (store) {
      k[o] = a;
      k[o + 1] = b;
      k[o + 2] = c;
      k[o + 3] = d;
      k[o + 4] = e;
    }
    return changed;
  }

  /**
   * region `k`'s record of segment `s` into `out` at `o`, its words but the instance count: the level's count, first
   * vertex or index, the region's first instance; its chunks where `k` is a level's own region (else 0)
   */
  function writeRecord(out: Uint32Array, o: number, k: number, s: number) {
    const levels = Math.max(1, levelCount);
    // a raster region as its level's
    const j = k % levels;
    const member = members[s];
    const drawCount: number = member.drawCount.ref.value;
    // gridless members draw at full detail at each level they overlap, as the CPU culling (`cullSegment`)
    const gridless = member.instanceGrid.ref.value.cellSize <= 1;
    const memberLevels = member.lodLevels?.ref.value as LodLevelsValue | undefined;
    out[o] = levelCount === 0 || gridless || !memberLevels ? drawCount : memberLevels[j][3];
    const first = k * instanceCount + segments.instanceBases[s];
    if (indexed) {
      out[o + 2] = segments.elementOffsets[s] / 4;
      out[o + 4] = first;
    } else {
      out[o + 2] = segments.drawBases[s];
      out[o + 3] = first;
    }
    // quads of 6 vertices (or indices) a sphere
    return k === j ? Math.ceil(out[o] / 6 / 64) * segments.instanceCounts[s] : 0;
  }

  /** what the layout is of: the counts, the levels, the raster regions (`structure`) */
  let structure = new Float64Array(0);
  function structureChanged() {
    const lodLevels = members[0].lodLevels?.ref.value as LodLevelsValue | undefined;
    const n = segments.count;
    const length = 4 + n * 2;
    let changed = structure.length !== length;
    if (changed) structure = new Float64Array(length);
    const set = (i: number, v: number) => {
      if (structure[i] !== v) {
        structure[i] = v;
        changed = true;
      }
    };
    set(0, values.instanceCount.ref.value);
    set(1, n);
    set(2, rasterRegions ? 1 : 0);
    set(3, lodLevels ? Math.min(lodLevels.length, MaxCullLevels) : 0);
    for (let s = 0; s < n; ++s) {
      set(4 + s * 2, segments.instanceCounts[s]);
      set(5 + s * 2, members[s].drawCount.ref.value);
    }
    return changed;
  }

  function syncLayout() {
    const lodLevels = members[0].lodLevels?.ref.value as LodLevelsValue | undefined;
    levelCount = lodLevels ? Math.min(lodLevels.length, MaxCullLevels) : 0;
    const levels = Math.max(1, levelCount);
    instanceCount = values.instanceCount.ref.value;
    segmentCount = segments.count;
    // the levels' regions, with raster regions those again
    const regions = (rasterRegions ? 2 : 1) * levels;
    identityBase = regions * instanceCount;

    // the cells, each member's in its block
    if (slotBases.length !== segmentCount) {
      slotBases = new Uint32Array(segmentCount);
      slotCounts = new Uint32Array(segmentCount);
      memberKeys = new Float64Array(segmentCount * MemberKeyLength);
      memberChunks = new Float64Array(segmentCount);
    }
    if (cellOf.length !== instanceCount * 2) cellOf = new Uint32Array(instanceCount * 2);
    let slots = 0;
    for (let s = 0; s < segmentCount; ++s) {
      const cells = computeMemberCells(s);
      slotBases[s] = slots;
      slotCounts[s] = slotsFor(s, cells);
      slots += slotCounts[s];
      if (slotSpheres.length < slots * 4) {
        const grown = new Float32Array(Math.max(slots * 4, slotSpheres.length * 2));
        grown.set(slotSpheres);
        slotSpheres = grown;
      }
      writeMemberCells(s, cells);
      memberChanged(s, true);
    }
    cellCount = slots;

    ensure(instanceData, instanceCount * InstanceDataVec4s * 16);
    ensure(instanceCells, instanceCount * 8);
    // the clip objects after the segments (`syncClip`)
    ensure(segmentData, segmentCount * 48 + Clip.MaxObjectCount * ClipStorageVec4s * 16);
    ensure(cellSpheres, cellCount * 16);
    ensure(cellLevels, cellCount * 4);
    ensure(counters, regions * segmentCount * 4);
    ensure(args, regions * segmentCount * stride);
    ensure(secondArgs, regions * segmentCount * stride);
    for (const [name, floats] of Object.entries(AttributeFloats)) {
      ensure(attributes[name as keyof typeof AttributeFloats], (regions + 1) * instanceCount * floats * 4);
    }
    instanceCells.ref.value.write(cellOf);
    segmentDataCopy = getSegmentData();
    segmentData.ref.value.write(segmentDataCopy);
    syncClip(true);
    cellSpheres.ref.value.write(slotSpheres.subarray(0, cellCount * 4));

    const records = new Uint32Array(regions * segmentCount * words);
    chunkCapacity = 0;
    memberChunks.fill(0);
    for (let k = 0; k < regions; ++k) {
      for (let s = 0; s < segmentCount; ++s) {
        const chunks = writeRecord(records, (k * segmentCount + s) * words, k, s);
        memberChunks[s] += chunks;
        chunkCapacity += chunks;
      }
    }
    args.ref.value.write(records);
    secondArgs.ref.value.write(records);

    ValueCell.updateIfChanged(levelCountCell, levelCount);
    ValueCell.updateIfChanged(cellValues.uCellCount, cellCount);
    ValueCell.updateIfChanged(copyValues.uInstanceCount, instanceCount);
    ValueCell.updateIfChanged(copyValues.uSegmentCount, segmentCount);
    ValueCell.updateIfChanged(argsValues.uRecordCount, regions * segmentCount);
    ValueCell.updateIfChanged(copyValues.uRasterLevels, rasterRegions ? levels : 0);
  }

  /**
   * The members whose cells, segment or records changed (`memberChanged`), the structure the same: their blocks,
   * instances' cells, segments, records and instances written alone. False where one outgrew its block (nothing
   * written then: a full layout is due)
   */
  const changedMembers: number[] = [];
  const record = new Uint32Array(words);
  function syncMembers() {
    changedMembers.length = 0;
    for (let s = 0; s < segmentCount; ++s) if (memberChanged(s, false)) changedMembers.push(s);
    if (changedMembers.length === 0) return true;
    const regions = (rasterRegions ? 2 : 1) * Math.max(1, levelCount);
    for (const s of changedMembers) {
      const cells = computeMemberCells(s);
      // outgrown: the full layout rewrites what this wrote of the members before
      if (cells > slotCounts[s]) return false;
      writeMemberCells(s, cells);
      memberChanged(s, true);
      const base = slotBases[s];
      cellSpheres.ref.value.write(slotSpheres.subarray(base * 4, (base + slotCounts[s]) * 4), base * 16);
      const first = segments.instanceBases[s];
      const n = segments.instanceCounts[s];
      instanceCells.ref.value.write(cellOf.subarray(first * 2, (first + n) * 2), first * 8);
      writeSegmentRow(segmentDataCopy!, s);
      segmentData.ref.value.write(segmentDataCopy!.subarray(s * 12, s * 12 + 12), s * 48);
      chunkCapacity -= memberChunks[s];
      memberChunks[s] = 0;
      for (let k = 0; k < regions; ++k) {
        record.fill(0);
        memberChunks[s] += writeRecord(record, 0, k, s);
        const offset = (k * segmentCount + s) * stride;
        args.ref.value.write(record, offset);
        secondArgs.ref.value.write(record, offset);
      }
      chunkCapacity += memberChunks[s];
      syncInstanceRange(first, n);
      segmentScales[s] = segmentScale(s);
    }
    return true;
  }

  /** the levels' distance ranges for `lod` (`LodView.getRange`) into `levelRanges`, per level a column */
  const levelRanges = Mat4.zero();
  const range: number[] = [0, 0, 0];
  function setLevelRanges(lod: LodView) {
    Mat4.setZero(levelRanges);
    const lodLevels = members[0].lodLevels?.ref.value as LodLevelsValue | undefined;
    for (let j = 0; j < levelCount; ++j) {
      LodView.getRange(lodLevels!, j, lod, range);
      levelRanges[j * 4] = range[0];
      levelRanges[j * 4 + 1] = range[1];
    }
  }

  /**
   * per segment its invariant sphere, its first instance and largest sphere's radius (`padding`: the largest size times
   * the size factor), its level scales (as `tSegment`'s) (`segmentData`)
   */
  function getSegmentData() {
    const out = new Float32Array(segmentCount * 12);
    for (let s = 0; s < segmentCount; ++s) writeSegmentRow(out, s);
    return out;
  }
  /** segment `s`'s row of `getSegmentData` into `out` */
  function writeSegmentRow(out: Float32Array, s: number) {
    const member = members[s];
    const { center, radius } = member.invariantBoundingSphere.ref.value as Sphere3D;
    const o = s * 12;
    out[o] = center[0];
    out[o + 1] = center[1];
    out[o + 2] = center[2];
    out[o + 3] = radius;
    new Uint32Array(out.buffer, out.byteOffset + (o + 4) * 4, 1)[0] = segments.instanceBases[s];
    out[o + 5] = (member as { padding?: ValueCell<number> }).padding?.ref.value ?? 0;
    const gridless = member.instanceGrid.ref.value.cellSize <= 1;
    const memberLevels = !gridless ? (member.lodLevels?.ref.value as LodLevelsValue | undefined) : undefined;
    for (let j = 0; j < 4; ++j) out[o + 8 + j] = memberLevels?.[j]?.[4] ?? 1;
  }

  /**
   * The clip objects cells and instances are culled by where they clip them whole (`getCullClipCount`), instances' centers
   * clipped too with instance clipping (`getCullInstanceClipCount`, the vertex stage's), after the segments in
   * `segmentData`; where they changed (or `force`, the buffer written anew) written, true
   */
  const clipVersions = [-1, -1, -1, -1];
  function syncClip(force: boolean) {
    const count = getCullClipCount(values);
    const frame = values.uClipObjectFrame.ref.version;
    const shape = values.uClipObjectShape.ref.version;
    const instance = getCullInstanceClipCount(values) > 0 ? 1 : 0;
    const v = clipVersions;
    if (!force && v[0] === count && v[1] === frame && v[2] === shape && v[3] === instance) return false;
    v[0] = count;
    v[1] = frame;
    v[2] = shape;
    v[3] = instance;
    if (count > 0) {
      const data = new Float32Array(count * ClipStorageVec4s * 4);
      packStorageClipObjects(values, data);
      segmentData.ref.value.write(data, segmentCount * 48);
    }
    ValueCell.updateIfChanged(cellValues.uClipObjectCount, count);
    ValueCell.updateIfChanged(cellValues.uClipBase, segmentCount * 3);
    ValueCell.updateIfChanged(copyValues.uClipInstance, instance);
    return true;
  }

  /** the instances' data for the kernel, and their own order after the regions (the identity region) */
  function syncInstances() {
    const data = new Float32Array(instanceCount * InstanceDataVec4s * 4);
    packInstanceData(values, data);
    setSegmentScales();
    instanceData.ref.value.write(data);
    for (const [name, floats] of Object.entries(AttributeFloats)) {
      const value = values[name].ref.value as Float32Array;
      // the transforms as their rows (`affine-rows.ts`), as the regions hold them
      const array =
        name === 'aTransform'
          ? packAffineRows(value, instanceCount, new Float32Array(instanceCount * floats))
          : value.subarray(0, instanceCount * floats);
      attributes[name as keyof typeof AttributeFloats].ref.value.write(array, identityBase * floats * 4);
    }
  }

  /** `syncInstances` of the instances `start` to `start + count` alone (`syncMembers`) */
  let rangeData = new Float32Array(0);
  let rangeRows = new Float32Array(0);
  function syncInstanceRange(start: number, count: number) {
    const size = count * InstanceDataVec4s * 4;
    if (rangeData.length < size) rangeData = new Float32Array(size);
    const data = rangeData.subarray(0, size);
    packInstanceData(values, data, start, count);
    instanceData.ref.value.write(data, start * InstanceDataVec4s * 16);
    for (const [name, floats] of Object.entries(AttributeFloats)) {
      const value = values[name].ref.value as Float32Array;
      let array: Float32Array;
      if (name === 'aTransform') {
        if (rangeRows.length < count * floats) rangeRows = new Float32Array(count * floats);
        array = packAffineRows(
          value.subarray(start * 16, (start + count) * 16),
          count,
          rangeRows.subarray(0, count * floats),
        );
      } else {
        array = value.subarray(start * floats, (start + count) * floats);
      }
      attributes[name as keyof typeof AttributeFloats].ref.value.write(array, (identityBase + start) * floats * 4);
    }
  }

  /** debug mode: what the raster split classifies by (`rasterized`), logged where it changed */
  let rasterInputsLogged = '';
  function logRasterInputs(raster: MergedRasterParams) {
    const data = getSegmentData();
    const range = (o: number) => {
      let min = Infinity;
      let max = -Infinity;
      for (let s = 0; s < segmentCount; ++s) {
        min = Math.min(min, data[s * 12 + o]);
        max = Math.max(max, data[s * 12 + o]);
      }
      return `${min.toFixed(2)}-${max.toFixed(2)}`;
    };
    const levels: string[] = [];
    for (let j = 0; j < Math.max(1, levelCount); ++j) {
      levels.push(`${levelRanges[j * 4].toFixed(1)}-${levelRanges[j * 4 + 1].toFixed(1)} x${range(8 + j)}`);
    }
    const text =
      `sphere raster split: ${JSON.stringify(raster)}, ${segmentCount} segments, invariant radius ${range(3)}, ` +
      `largest sphere ${range(5)}, levels (distances, scales) ${levels.join('; ')}`;
    if (text !== rasterInputsLogged) console.log(text);
    rasterInputsLogged = text;
  }

  const getInstanceVersions = () =>
    `${values.aTransform.ref.version},${values.aInstance.ref.version},${values.aSegment.ref.version}`;
  let instanceVersions = '';
  /** advanced where the layout or the instances changed: a dispatch culled with an older one is not current */
  let dataVersion = 0;
  /**
   * The cells and records are written from the counts and levels (`structureChanged`: a full layout) and per member
   * from its grid, transforms, spheres and levels (`syncMembers`: those of the members that changed)
   */
  function sync() {
    const versions = getInstanceVersions();
    if (structureChanged() || !syncMembers()) {
      syncLayout();
      syncInstances();
    } else if (changedMembers.length > 0) {
      // the members' instances written by `syncMembers`; the merged object's others stay (`Merged.sync` writes the
      // members that changed)
    } else if (versions !== instanceVersions) {
      syncInstances();
    } else {
      return;
    }
    instanceVersions = versions;
    dataVersion += 1;
  }
  sync();
  // compiled from now on: a frame waiting for what is pending waits for them, culled on the CPU only meanwhile
  getKernels();

  const setPlane = (cell: ValueCell<Vec4>, plane: Plane3D) => {
    const v = cell.ref.value;
    Vec4.set(v, plane.normal[0], plane.normal[1], plane.normal[2], plane.constant);
    ValueCell.update(cell, v);
  };

  const frustumPlanes = [
    cellValues.uPlane0,
    cellValues.uPlane1,
    cellValues.uPlane2,
    cellValues.uPlane3,
    cellValues.uPlane4,
    cellValues.uPlane5,
  ];
  const pyramidFrustum = Frustum3D();
  const pyramidMatrix = Mat4();
  /**
   * `setHiZValues`, and whether the pyramid is of the view culled for (`uHiZClamp`): its frustum's planes those set
   * last (`uPlane0` to `uPlane5`), as the renderer computes them from a camera
   */
  function setPyramid(pyramid: OcclusionPyramid | undefined) {
    setHiZValues(cellValues, pyramid, emptyHiZ);
    let same = !!pyramid;
    if (pyramid) {
      Frustum3D.fromProjectionMatrix(pyramidFrustum, Mat4.mul(pyramidMatrix, pyramid.projection, pyramid.view));
      for (let i = 0; i < 6 && same; ++i) {
        const { normal, constant } = pyramidFrustum[i as 0];
        const v = frustumPlanes[i].ref.value;
        same = v[0] === normal[0] && v[1] === normal[1] && v[2] === normal[2] && v[3] === constant;
      }
    }
    ValueCell.updateIfChanged(cellValues.uHiZClamp, same);
  }

  /**
   * What the last dispatch culled with: the planes, the distance range, the levels' ranges, `dataVersion` and the
   * pyramid's camera; while they are the same its compacted attributes and records are current (a still camera culls
   * nothing again, once tested twice against a pyramid of its own view: the first such pyramid is of a frame culled
   * against another view's, which can lack occluders and occlude less; a round counts a new build only, a pyramid
   * served again while the Hi-Z pass skips its builds is still of the frame it was built in)
   */
  const dispatched = new Float64Array(7 * 4 + 2).fill(NaN);
  const dispatchedLevels = Mat4.zero().fill(NaN);
  let dispatchedVersion = -1;
  const dispatchedPyramid = new Float64Array(32).fill(NaN);
  let dispatchedHiZ = false;
  let dispatchedPyramidVersion = -1;
  /** dispatches in a row against pyramids of the same camera, each a new build */
  let pyramidRounds = 0;
  function isPyramidCamera(pyramid: OcclusionPyramid) {
    for (let i = 0; i < 16; ++i) {
      if (dispatchedPyramid[i] !== pyramid.view[i] || dispatchedPyramid[16 + i] !== pyramid.projection[i]) return false;
    }
    return true;
  }
  function isPyramidDispatched(pyramid: OcclusionPyramid | undefined) {
    if (!pyramid) return !dispatchedHiZ;
    return dispatchedHiZ && pyramidRounds >= 2 && isPyramidCamera(pyramid);
  }
  const getPlane = (i: number, cameraPlane: Plane3D, frustum: Frustum3D) => (i < 6 ? frustum[i as 0] : cameraPlane);
  let dispatchedSlack = NaN;
  function isDispatched(cameraPlane: Plane3D, frustum: Frustum3D, min: number, max: number) {
    if (dispatchedVersion !== dataVersion || dispatched[28] !== min || dispatched[29] !== max) return false;
    if (dispatchedSlack !== cellValues.uAnimationSlack.ref.value) return false;
    for (let i = 0; i < 16; ++i) if (dispatchedLevels[i] !== levelRanges[i]) return false;
    for (let i = 0; i < 7; ++i) {
      const { normal, constant } = getPlane(i, cameraPlane, frustum);
      const o = i * 4;
      if (
        dispatched[o] !== normal[0] ||
        dispatched[o + 1] !== normal[1] ||
        dispatched[o + 2] !== normal[2] ||
        dispatched[o + 3] !== constant
      ) {
        return false;
      }
    }
    return true;
  }
  function setDispatched(cameraPlane: Plane3D, frustum: Frustum3D, min: number, max: number) {
    for (let i = 0; i < 7; ++i) {
      const { normal, constant } = getPlane(i, cameraPlane, frustum);
      dispatched.set([normal[0], normal[1], normal[2], constant], i * 4);
    }
    dispatched[28] = min;
    dispatched[29] = max;
    dispatchedSlack = cellValues.uAnimationSlack.ref.value;
    Mat4.copy(dispatchedLevels, levelRanges);
    dispatchedVersion = dataVersion;
  }

  /** the levels' lists, then the raster regions' where there are; `levelLists` the levels' of them (the same lists) */
  let lists: MultiDrawBaseData[] = [];
  let levelLists: MultiDrawBaseData[] = [];
  let listsLevels: readonly MultiDrawBaseData[] | undefined;
  let listsKey = '';

  /**
   * A still camera culls nothing again (`isDispatched`), so its records stay: read back once, each list then draws only
   * those with instances. A draw costs whether it draws or not, outside the GPU's timers: with thousands of units and
   * levels, most of them empty (the raster's instances are in its regions), the larger part of a frame. Any dispatch
   * or new lists restore all records
   */
  let recordsGeneration = 0;
  let recordsRead = -1;
  let recordsCompact = false;
  let recordsVersion = 0;
  let dispatchVersion = 0;
  /**
   * The records a dispatch can fill, per list (the levels', then the raster regions') and segment: without those the
   * segment's bounds rule out, so that a moving camera does not issue them either (`predictRecords`)
   */
  let predicted = new Uint8Array(0);
  let predictedNext = new Uint8Array(0);
  function setListRecords() {
    recordsVersion += 1;
    for (let k = 0; k < lists.length; ++k) {
      const l = lists[k];
      const records = new Uint32Array(segmentCount);
      let n = 0;
      for (let s = 0; s < segmentCount; ++s) if (predicted[k * segmentCount + s]) records[n++] = s;
      l.count = n;
      l.indirect = { ...l.indirect!, records: records.subarray(0, n), recordsVersion };
    }
  }
  function setSegmentScales() {
    if (segmentScales.length !== segmentCount) segmentScales = new Float32Array(segmentCount);
    for (let s = 0; s < segmentCount; ++s) segmentScales[s] = segmentScale(s);
  }
  /** the largest scale of segment `s`'s instances */
  function segmentScale(s: number) {
    const t = values.aTransform.ref.value as Float32Array;
    let max = 0;
    const begin = segments.instanceBases[s];
    for (let i = begin, il = begin + segments.instanceCounts[s]; i < il; ++i) {
      const o = i * 16;
      max = Math.max(
        max,
        t[o] * t[o] + t[o + 1] * t[o + 1] + t[o + 2] * t[o + 2],
        t[o + 4] * t[o + 4] + t[o + 5] * t[o + 5] + t[o + 6] * t[o + 6],
        t[o + 8] * t[o + 8] + t[o + 9] * t[o + 9] + t[o + 10] * t[o + 10],
      );
    }
    return Math.sqrt(max);
  }
  /**
   * From each segment's bounds, which hold its instances' spheres: conservative (a margin for the kernels' 32-bit
   * floats), the kernels decide per cell and instance. A record is left out where the bounds lie outside the frustum or
   * the level's range, and a level's where all the instances go to the raster (`rasterized` holds at their nearest
   * point, and so further away). False where nothing changed
   */
  function predictRecords(cameraPlane: Plane3D, frustum: Frustum3D, raster: MergedRasterParams | undefined) {
    const levels = Math.max(1, levelCount);
    const size = (rasterRegions ? 2 : 1) * levels * segmentCount;
    if (predictedNext.length !== size) predictedNext = new Uint8Array(size);
    const next = predictedNext.fill(0);
    const segmentInfo = segmentDataCopy!;
    for (let s = 0; s < segmentCount; ++s) {
      const { center: c, radius } = members[s].boundingSphere.ref.value as Sphere3D;
      const r = radius * 1.001 + 1e-3 + cellValues.uAnimationSlack.ref.value;
      let inside = true;
      for (let i = 0; i < 6 && inside; ++i) {
        const { normal, constant } = frustum[i as 0];
        inside = normal[0] * c[0] + normal[1] * c[1] + normal[2] * c[2] + constant >= -r;
      }
      if (!inside) continue;
      const n = cameraPlane.normal;
      const d = n[0] * c[0] + n[1] * c[1] + n[2] * c[2] + cameraPlane.constant;
      for (let j = 0; j < levels; ++j) {
        const min = levelCount ? levelRanges[j * 4] : -Infinity;
        const max = levelCount ? levelRanges[j * 4 + 1] : Infinity;
        if (d + r < min || d - r > max) continue;
        let toRaster = false;
        if (raster) {
          next[(levels + j) * segmentCount + s] = 1;
          const largest = segmentInfo[s * 12 + 5] * segmentScales[s] * segmentInfo[s * 12 + 8 + Math.min(j, 3)] * 1.001;
          const nearest = Math.max(d - r, min);
          toRaster =
            segmentInfo[s * 12 + 3] > 0 &&
            nearest - largest > raster.near &&
            largest * raster.scale <= raster.radius * Math.sqrt(Math.max(nearest * nearest - largest * largest, 0));
        }
        if (!toRaster) next[j * segmentCount + s] = 1;
      }
    }
    let same = next.length === predicted.length;
    for (let i = 0; same && i < next.length; ++i) same = next[i] === predicted[i];
    if (same) return false;
    predictedNext = predicted;
    predicted = next;
    return true;
  }
  function restoreRecords() {
    recordsGeneration += 1;
    if (!recordsCompact) return;
    recordsCompact = false;
    setListRecords();
  }
  function compactRecords() {
    if (recordsRead === recordsGeneration || recordsCompact || lists.length === 0) return;
    recordsRead = recordsGeneration;
    const generation = recordsGeneration;
    args.ref.value
      .readAsync()
      .then((data) => {
        if (generation !== recordsGeneration) return;
        const words = new Uint32Array(data);
        for (const l of lists) {
          const records = new Uint32Array(segmentCount);
          let n = 0;
          const base = l.indirect!.byteOffset / 4;
          for (let s = 0; s < segmentCount; ++s) {
            if (words[base + (s * stride) / 4 + 1] > 0) records[n++] = s;
          }
          l.count = n;
          l.indirect = { ...l.indirect!, records: records.subarray(0, n), recordsVersion: recordsVersion + 1 };
        }
        recordsCompact = true;
        recordsVersion += 1;
      })
      // the full lists stay: the same image
      .catch(() => {});
  }

  function buildLists(levels: readonly MultiDrawBaseData[], key: string) {
    restoreRecords();
    listsLevels = levels;
    listsKey = key;
    const n = Math.max(1, levelCount);
    const list = (level: MultiDrawBaseData, k: number): MultiDrawBaseData => ({
      firsts: EmptyInt,
      counts: EmptyInt,
      offsets: EmptyInt,
      instanceCounts: EmptyInt,
      baseVertices: EmptyInt,
      baseInstances: EmptyUint,
      count: segmentCount,
      uniforms: level.uniforms,
      indirect: { buffer: args.ref.value, byteOffset: k * segmentCount * stride, indexed },
    });
    levelLists = levels.slice(0, n).map((level, j) => list(level, j));
    lists = rasterRegions ? [...levelLists, ...levelLists.map((level, j) => list(level, n + j))] : levelLists;
    if (predicted.length === lists.length * segmentCount) setListRecords();
  }

  return {
    attributes,
    get identityBase() {
      return identityBase;
    },
    sync,
    dispatch: (cameraPlane, frustum, lod, pyramid, raster) => {
      if (instanceCount === 0 || cellCount === 0) return false;
      if (raster && !rasterRegions) {
        rasterRegions = true;
        sync();
      }
      // clipped instances culled: a change of the clip objects culls again
      if (syncClip(false)) dataVersion += 1;
      secondPending = false;
      secondDispatched = false;
      const [min, max] = values.uLod.ref.value as Vec4;
      setLevelRanges(lod);
      ValueCell.updateIfChanged(
        cellValues.uAnimationSlack,
        getAnimationSlack(values as unknown as AnimationValues, members as unknown as AnimationValues[]),
      );
      const rasterChanged =
        copyValues.uRasterRadius.ref.value !== (raster?.radius ?? 0) ||
        copyValues.uRasterScale.ref.value !== (raster?.scale ?? 0) ||
        copyValues.uRasterNear.ref.value !== (raster?.near ?? 0);
      const viewChanged = !isDispatched(cameraPlane, frustum, min, max);
      if (!rasterChanged && !viewChanged && isPyramidDispatched(pyramid)) {
        compactRecords();
        return true;
      }
      if (!getKernels()) return false;
      restoreRecords();
      if (predictRecords(cameraPlane, frustum, raster)) setListRecords();
      dispatchVersion += 1;
      ValueCell.updateIfChanged(copyValues.uRasterRadius, raster?.radius ?? 0);
      ValueCell.updateIfChanged(copyValues.uRasterScale, raster?.scale ?? 0);
      ValueCell.updateIfChanged(copyValues.uRasterNear, raster?.near ?? 0);
      rasterDispatched = !!raster;
      if (isDebugMode && raster) logRasterInputs(raster);
      if (!pyramid) pyramidRounds = 0;
      // a view of its own: levels of an earlier one (a draw compiling, none of this view yet) left out what stays out
      // until culled again
      else if (viewChanged || !dispatchedHiZ || !isPyramidCamera(pyramid)) pyramidRounds = 1;
      else if (pyramid.version !== dispatchedPyramidVersion) pyramidRounds += 1;
      dispatchedHiZ = !!pyramid;
      if (pyramid) {
        dispatchedPyramidVersion = pyramid.version;
        dispatchedPyramid.set(pyramid.view, 0);
        dispatchedPyramid.set(pyramid.projection, 16);
      }
      setPlane(cellValues.uPlane0, frustum[0]);
      setPlane(cellValues.uPlane1, frustum[1]);
      setPlane(cellValues.uPlane2, frustum[2]);
      setPlane(cellValues.uPlane3, frustum[3]);
      setPlane(cellValues.uPlane4, frustum[4]);
      setPlane(cellValues.uPlane5, frustum[5]);
      setPyramid(pyramid);
      setPlane(cellValues.uCameraPlane, cameraPlane);
      ValueCell.update(cellValues.uLevels, Mat4.copy(cellValues.uLevels.ref.value, levelRanges));
      const hasLod = min !== 0 || max !== 0;
      ValueCell.update(cellValues.uLodRange, Vec4.set(cellValues.uLodRange.ref.value, min, max, hasLod ? 1 : 0, 0));

      const records = (rasterRegions ? 2 : 1) * Math.max(1, levelCount) * segmentCount;
      counters.ref.value.clear(0, records * 4);
      compute.beginComputePass({ label: 'merged cell culling' });
      kernels![0].dispatch(...groups(cellCount));
      kernels![1].dispatch(...groups(instanceCount));
      kernels![2].dispatch(...groups(records));
      compute.endComputePass();
      setDispatched(cameraPlane, frustum, min, max);
      // without a pyramid the first phase left out nothing occluded
      secondPending = !!pyramid;
      return true;
    },
    get secondPending() {
      return secondPending;
    },
    dispatchSecond: (pyramid) => {
      if (!secondPending) return false;
      secondPending = false;
      if (!pyramid || !kernels) return false;
      setPyramid(pyramid);
      ValueCell.updateIfChanged(copyValues.uPhase, 1);
      const records = (rasterRegions ? 2 : 1) * Math.max(1, levelCount) * segmentCount;
      compute.beginComputePass({ label: 'merged cell culling, second phase' });
      kernels[0].dispatch(...groups(cellCount));
      kernels[1].dispatch(...groups(instanceCount));
      kernels[2].dispatch(...groups(records));
      compute.endComputePass();
      ValueCell.updateIfChanged(copyValues.uPhase, 0);
      secondDispatched = true;
      return true;
    },
    get secondDispatched() {
      return secondDispatched;
    },
    getSecondLists: (levels, withRaster = true) => {
      const key = `${segmentCount},${levelCount},${args.ref.value.id},${rasterRegions}`;
      if (levels !== listsLevels || key !== listsKey) buildLists(levels, key);
      const buffer = secondArgs.ref.value;
      return (withRaster ? lists : levelLists).map((l) => ({ ...l, indirect: { ...l.indirect!, buffer } }));
    },
    getLists: (levels, withRaster = true) => {
      // the raster regions too where they exist and the raster does not draw them (another view, not ready); the
      // levels' lists the same objects either way, so that their draws (and recordings of them) stay the same
      const key = `${segmentCount},${levelCount},${args.ref.value.id},${rasterRegions}`;
      if (levels !== listsLevels || key !== listsKey) buildLists(levels, key);
      return withRaster ? lists : levelLists;
    },
    getRasterInput: () => {
      if (!rasterRegions || !rasterDispatched) return undefined;
      const levels = Math.max(1, levelCount);
      return {
        transforms: attributes.aTransform.ref.value,
        instances: attributes.aInstance.ref.value,
        segments: attributes.aSegment.ref.value,
        records: args.ref.value,
        secondRecords: secondArgs.ref.value,
        get secondDispatched() {
          return secondDispatched;
        },
        recordWords: words,
        levels,
        levelCount,
        lodLevels: members[0].lodLevels?.ref.value as LodLevelsValue | undefined,
        instanceCount,
        segmentCount,
        chunkCapacity,
        dispatchVersion,
        recordBase: levels * segmentCount,
        slotBase: levels * instanceCount,
      };
    },
    get recordsCompact() {
      return recordsCompact;
    },
    get recordsVersion() {
      return recordsVersion;
    },
    destroy: () => {
      if (kernels) for (const k of kernels) k.destroy();
      emptyHiZ.destroy();
      const cells = [instanceData, instanceCells, segmentData, cellSpheres, cellLevels, counters, args, secondArgs];
      for (const cell of [...cells, ...Object.values(attributes)]) cell.ref.value.destroy();
    },
  };
}
