/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '@molstar/core/util';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import type { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import type { ComputeContext, ComputeKernel, KernelRequest, StorageBuffer } from '../compute.js';
import {
  CellCullKernel,
  CellCullSchema,
  ClusterCopyKernel,
  ClusterCopySchema,
  ClusterDispatchKernel,
  ClusterDispatchSchema,
  CullArgsSecondKernel,
  CullArgsSecondSchema,
  CullSnapshotKernel,
  CullSnapshotSchema,
  CullArgsKernel,
  CullArgsSchema,
  InstanceCopyKernel,
  InstanceCopySchema,
  MaxCullLevels,
  type OcclusionPyramid,
} from '../compute/cell-cull.js';

/** A 1×1 pyramid texture, bound while the cells are not tested for occlusion */
function createEmptyHiZ(resources: GraphicsResources): Texture {
  const texture = resources.texture('image-float32', 'r', 'float', 'nearest');
  // loaded: storage of its own (a defined texture gets it lazily)
  texture.load({ array: new Float32Array(1), width: 1, height: 1 });
  return texture;
}
import { IndirectRecordBytes, type MultiDrawBaseData } from '../render-item.js';
import type { GraphicsResources } from '../context.js';
import type { Texture } from '../texture.js';
import { Vec2 } from '@molstar/core/math/linear-algebra/3d/vec2';
import { type AnimationValues, getAnimationSlack, type LodLevelsValue, LodView } from '../renderable.js';
import { InstanceDataVec4s, type Merged, type MergeableValues, packInstanceData } from './merged.js';

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
    readonly aSegmentSphere: ValueCell<StorageBuffer>;
    readonly aSegmentLod: ValueCell<StorageBuffer>;
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
    twoPhase?: boolean,
  ) => boolean;
  /**
   * Two-phase occlusion (after `dispatch` with `twoPhase`, the first phase's draws): the instances and clusters not
   * visible last frame, tested against `pyramid` (this frame's, of the first phase's depth; none: all of them in view),
   * into the second phase's records (`getLists` with `second`); what is visible now for the next frame. False where
   * there is no second phase this frame (none dispatched, or the last's results stand)
   */
  dispatchSecond: (pyramid?: OcclusionPyramid) => boolean;
  /**
   * Whether the last dispatch tested occlusion against a pyramid drawn at its view and levels (or none): else a frame
   * culled against another view's (after a camera change, a level scale) may leave out what shows; a frame more settles
   * it (`Renderer.gpuCullUnsettledCount`)
   */
  readonly settled: boolean;
  /**
   * per level its indirect list, with the uniforms of the level lists of the CPU culling (`levels`); `second`: the
   * second phase's (two-phase occlusion), else all instances drawn
   */
  getLists: (levels: readonly MultiDrawBaseData[], second?: boolean) => MultiDrawBaseData[];
  destroy: () => void;
}

/** The culling's kernels, the same for every object: prepared once a culler is created, or by `Canvas3D.precompile` */
export const MergedCullKernels: readonly KernelRequest[] = [
  { code: CellCullKernel, schema: CellCullSchema },
  { code: InstanceCopyKernel, schema: InstanceCopySchema },
  { code: ClusterCopyKernel, schema: ClusterCopySchema },
  { code: ClusterDispatchKernel, schema: ClusterDispatchSchema },
  { code: CullSnapshotKernel, schema: CullSnapshotSchema },
  { code: CullArgsSecondKernel, schema: CullArgsSecondSchema },
  { code: CullArgsKernel, schema: CullArgsSchema },
];

/** Floats per instance of the compacted attributes, by name */
const AttributeFloats = { aTransform: 16, aInstance: 1, aSegment: 3, aSegmentSphere: 4, aSegmentLod: 4 } as const;

/**
 * Spheres a cluster holds at most: level 0 of a member of at least `MinClusteredSpheres` spheres is drawn by clusters of
 * consecutive spheres (in space order within each level's own, `setPositionGroup`), each culled per instance
 * (`cluster-copy`); 256: PetWorld HIV's proteins 2,167 records and 17 MB, a 40% smaller level 0 in view close up than by
 * instances alone (`apps/prism-me/progress/2026-10-31-instance-cull.md`)
 */
export const ClusterSpheres = 256;
export const MinClusteredSpheres = 2 * ClusterSpheres;

/** WebGPU's least `maxComputeWorkgroupsPerDimension`: `cluster-copy`'s rows, a cluster each */
const MaxWorkgroupsPerDimension = 65535;

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
  const buffer = (label: string) => ValueCell.create(createBuffer(16, label));
  const instanceData = buffer('culled instance data');
  const instanceCells = buffer('culled instance cells');
  const segmentBases = buffer('culled segment bases');
  const cellSpheres = buffer('culled cell spheres');
  const cellLevels = buffer('culled cell levels');
  const counters = buffer('culled counters');
  const args = buffer('culled draw arguments');
  const clusters = buffer('culled clusters');
  const clusterCounters = buffer('culled cluster counters');
  const clusterArgs = buffer('culled cluster draw arguments');
  const clusterDispatch = buffer('culled cluster dispatch');
  const clusteredSegments = buffer('culled clustered segments');
  // two-phase occlusion: the counters after phase 1, the second phase's records, the clusters' visibility
  const counters1 = buffer('culled counters, first phase');
  const clusterCounters1 = buffer('culled cluster counters, first phase');
  const args2 = buffer('culled draw arguments, second phase');
  const clusterArgs2 = buffer('culled cluster draw arguments, second phase');
  const clusterBits = buffer('culled cluster visibility');
  const attributes = {
    aTransform: buffer('culled transforms'),
    aInstance: buffer('culled instances'),
    aSegment: buffer('culled segments'),
    aSegmentSphere: buffer('culled segment spheres'),
    aSegmentLod: buffer('culled segment levels'),
  };

  const levelCountCell = ValueCell.create(0);
  /** the view, the levels and the pyramid: the cell test's and the instance test's */
  const viewValues = {
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
    uHiZ: ValueCell.create(false),
    uHiZView: ValueCell.create(Mat4()),
    uHiZProjection: ValueCell.create(Mat4()),
    uHiZDepthRange: ValueCell.create(Vec2()),
    uHiZViewport: ValueCell.create(Vec2()),
    uHiZLevelCount: ValueCell.create(0),
    uHiZPlane0: ValueCell.create(Vec4()),
    uHiZPlane1: ValueCell.create(Vec4()),
    uHiZPlane2: ValueCell.create(Vec4()),
    uHiZPlane3: ValueCell.create(Vec4()),
    uHiZPlane4: ValueCell.create(Vec4()),
    uHiZPlane5: ValueCell.create(Vec4()),
    uHiZMinLevel: ValueCell.create(0),
    tHiZ: ValueCell.create(createEmptyHiZ(resources)),
  };
  const cellValues = { ...viewValues, uCellCount: ValueCell.create(0), cellSpheres, cellLevels };
  const emptyHiZ = cellValues.tHiZ.ref.value;
  const copyValues = {
    // the same cells as the cell test's: one write serves both kernels
    ...viewValues,
    uInstanceCount: ValueCell.create(0),
    uSegmentCount: ValueCell.create(0),
    uPhase: ValueCell.create(0),
    instanceData,
    instanceCells,
    segmentBases,
    cellLevels,
    counters,
    transforms: attributes.aTransform,
    instances: attributes.aInstance,
    segments: attributes.aSegment,
    spheres: attributes.aSegmentSphere,
    lods: attributes.aSegmentLod,
  };
  const argsValues = {
    uRecordCount: ValueCell.create(0),
    uRecordWords: ValueCell.create(words),
    counters,
    args,
  };
  const clusterValues = {
    ...viewValues,
    uClusterCount: ValueCell.create(0),
    uPhase: ValueCell.create(0),
    clusters,
    counters,
    counters1,
    clusterCounters,
    clusterBits,
    transforms: attributes.aTransform,
    instances: attributes.aInstance,
    segments: attributes.aSegment,
    spheres: attributes.aSegmentSphere,
    lods: attributes.aSegmentLod,
  };
  const clusterDispatchValues = {
    uSegmentCount: ValueCell.create(0),
    uClusterCount: ValueCell.create(0),
    counters,
    clustered: clusteredSegments,
    dispatchArgs: clusterDispatch,
  };
  const snapshotValues = { uRecordCount: ValueCell.create(0), counters, snapshot: counters1 };
  const clusterSnapshotValues = {
    uRecordCount: ValueCell.create(0),
    counters: clusterCounters,
    snapshot: clusterCounters1,
  };
  const argsSecondValues = {
    uRecordCount: ValueCell.create(0),
    uRecordWords: ValueCell.create(words),
    counters,
    snapshot: counters1,
    all: args,
    args: args2,
  };
  const clusterArgsSecondValues = {
    uRecordCount: ValueCell.create(0),
    uRecordWords: ValueCell.create(words),
    counters: clusterCounters,
    snapshot: clusterCounters1,
    all: clusterArgs,
    args: clusterArgs2,
  };
  const clusterArgsValues = {
    uRecordCount: ValueCell.create(0),
    uRecordWords: ValueCell.create(words),
    counters: clusterCounters,
    args: clusterArgs,
  };
  let kernels: ComputeKernel[] | undefined;
  let preparing = false;
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
      compute.createKernel(ClusterCopyKernel, ClusterCopySchema, clusterValues),
      compute.createKernel(CullArgsKernel, CullArgsSchema, clusterArgsValues),
      compute.createKernel(ClusterDispatchKernel, ClusterDispatchSchema, clusterDispatchValues),
      compute.createKernel(CullSnapshotKernel, CullSnapshotSchema, snapshotValues),
      compute.createKernel(CullSnapshotKernel, CullSnapshotSchema, clusterSnapshotValues),
      compute.createKernel(CullArgsSecondKernel, CullArgsSecondSchema, argsSecondValues),
      compute.createKernel(CullArgsSecondKernel, CullArgsSecondSchema, clusterArgsSecondValues),
    ];
    return true;
  };

  /** replaces the buffer of `cell` by one of at least `bytes` where it is smaller */
  const ensure = (cell: ValueCell<StorageBuffer>, bytes: number) => {
    if (cell.ref.value.byteLength >= bytes) return;
    cell.ref.value.destroy();
    ValueCell.update(cell, createBuffer(bytes, 'merged culling'));
  };

  let instanceCount = 0;
  let segmentCount = 0;
  let cellCount = 0;
  let levelCount = 0;
  let identityBase = 0;
  let clusterCount = 0;

  function syncLayout() {
    const lodLevels = members[0].lodLevels?.ref.value as LodLevelsValue | undefined;
    levelCount = lodLevels ? Math.min(lodLevels.length, MaxCullLevels) : 0;
    const levels = Math.max(1, levelCount);
    instanceCount = values.instanceCount.ref.value;
    segmentCount = segments.count;
    identityBase = levels * instanceCount;

    // the cells: per member those of its grid with instances, or one of all its instances without a grid
    const spheres: number[] = [];
    // per instance its cell, its segment, whether visible last frame (two-phase occlusion), unused
    const cellOf = new Uint32Array(instanceCount * 4);
    for (let s = 0; s < segmentCount; ++s) {
      const member = members[s];
      const base = segments.instanceBases[s];
      const grid = member.instanceGrid.ref.value;
      if (grid.cellSize <= 1) {
        const b = member.boundingSphere.ref.value as Sphere3D;
        const c = spheres.length / 4;
        spheres.push(b.center[0], b.center[1], b.center[2], b.radius);
        for (let i = 0; i < segments.instanceCounts[s]; ++i) cellOf.set([c, s], (base + i) * 4);
        continue;
      }
      const { cellOffsets, cellSpheres: gridSpheres, cellCount: gridCells } = grid;
      for (let k = 0; k < gridCells; ++k) {
        if (cellOffsets[k + 1] === cellOffsets[k]) continue;
        const c = spheres.length / 4;
        for (let q = 0; q < 4; ++q) spheres.push(gridSpheres[k * 4 + q]);
        for (let i = cellOffsets[k]; i < cellOffsets[k + 1]; ++i) cellOf.set([c, s], (base + i) * 4);
      }
    }
    cellCount = spheres.length / 4;

    // the clusters of level 0 (members of grids and levels, of `MinClusteredSpheres` spheres or more): per level's own
    // range of spheres, cut evenly in at most `ClusterSpheres`; a region after the identity's per cluster
    const clusterData: number[] = [];
    const clusterRecords: number[] = [];
    const clustered = new Uint8Array(segmentCount);
    let regionBase = identityBase + instanceCount;
    for (let s = 0; s < segmentCount && levelCount > 0; ++s) {
      const member = members[s] as MergeableValues & { tPositionGroup?: ValueCell<{ array: Float32Array }> };
      const memberLevels = member.lodLevels?.ref.value as LodLevelsValue | undefined;
      const positions = member.tPositionGroup?.ref.value.array;
      if (!memberLevels || !positions || member.instanceGrid.ref.value.cellSize <= 1) continue;
      const count = memberLevels[0][3] / 6;
      if (count < MinClusteredSpheres) continue;
      clustered[s] = 1;
      const n = segments.instanceCounts[s];
      const padding =
        ((member as { padding?: ValueCell<number> }).padding?.ref.value ?? 0) * Math.max(1, memberLevels[0][4]);
      const edges = Array.from(new Set([0, count, ...memberLevels.map((l) => Math.min(count, l[3] / 6))])).sort(
        (a, b) => a - b,
      );
      for (let e = 0; e + 1 < edges.length; ++e) {
        const [a, b] = [edges[e], edges[e + 1]];
        const pieces = Math.ceil((b - a) / ClusterSpheres);
        const size = Math.ceil((b - a) / pieces);
        for (let start = a; start < b; start += size) {
          const end = Math.min(b, start + size);
          const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let i = start; i < end; ++i) {
            for (let k = 0; k < 3; ++k) {
              const v = positions[i * 4 + k];
              if (v < box[k]) box[k] = v;
              if (v > box[3 + k]) box[3 + k] = v;
            }
          }
          const c = [0, 1, 2].map((k) => (box[k] + box[3 + k]) / 2);
          let r = 0;
          for (let i = start; i < end; ++i) {
            const dx = positions[i * 4] - c[0];
            const dy = positions[i * 4 + 1] - c[1];
            const dz = positions[i * 4 + 2] - c[2];
            r = Math.max(r, dx * dx + dy * dy + dz * dz);
          }
          clusterData.push(
            c[0],
            c[1],
            c[2],
            Math.sqrt(r) + padding,
            s,
            segments.instanceBases[s],
            regionBase,
            regionBase - identityBase - instanceCount,
          );
          // the record: the cluster's spheres, from the segment's first, its region's instances
          const first = indexed ? segments.elementOffsets[s] / 4 + start * 6 : segments.drawBases[s] + start * 6;
          if (indexed) clusterRecords.push((end - start) * 6, 0, first, 0, regionBase);
          else clusterRecords.push((end - start) * 6, 0, first, regionBase);
          regionBase += n;
        }
      }
    }
    clusterCount = clusterData.length / 8;
    let clusterSlots = regionBase - identityBase - instanceCount;
    // none where the clusters exceed a dispatch's rows or the attributes a binding (`aTransform`, 64 bytes a slot)
    if (
      clusterCount > MaxWorkgroupsPerDimension ||
      ((levels + 1) * instanceCount + clusterSlots) * 64 > compute.maxStorageBufferSize
    ) {
      clusterCount = 0;
      clusterSlots = 0;
      clustered.fill(0);
    }

    ensure(instanceData, instanceCount * InstanceDataVec4s * 16);
    ensure(instanceCells, instanceCount * 16);
    ensure(segmentBases, segmentCount * 8);
    ensure(cellSpheres, cellCount * 16);
    ensure(cellLevels, cellCount * 4);
    ensure(counters, levels * segmentCount * 4);
    ensure(args, levels * segmentCount * stride);
    for (const [name, floats] of Object.entries(AttributeFloats)) {
      ensure(
        attributes[name as keyof typeof AttributeFloats],
        ((levels + 1) * instanceCount + clusterSlots) * floats * 4,
      );
    }
    ensure(clusters, clusterCount * 32);
    ensure(clusterCounters, clusterCount * 4);
    ensure(clusterArgs, clusterCount * stride);
    ensure(clusteredSegments, segmentCount * 4);
    ensure(counters1, levels * segmentCount * 4);
    ensure(clusterCounters1, clusterCount * 4);
    ensure(args2, levels * segmentCount * stride);
    ensure(clusterArgs2, clusterCount * stride);
    ensure(clusterBits, clusterSlots * 4);
    clusterBits.ref.value.clear(0, Math.max(4, clusterSlots * 4));
    clusteredSegments.ref.value.write(Uint32Array.from(clustered));
    if (clusterCount > 0) {
      // the floats as written, the segment and regions as their bits
      const data = new Float32Array(clusterData);
      const bits = new Uint32Array(data.buffer);
      for (let k = 0; k < clusterCount; ++k) {
        for (let q = 4; q < 8; ++q) bits[k * 8 + q] = clusterData[k * 8 + q];
      }
      clusters.ref.value.write(data);
      clusterArgs.ref.value.write(new Uint32Array(clusterRecords));
      clusterArgs2.ref.value.write(new Uint32Array(clusterRecords));
    }
    instanceCells.ref.value.write(cellOf);
    // per segment its first instance and its padding (the per-instance test grows coarse levels' spheres by it)
    const bases = new Uint32Array(segmentCount * 2);
    const paddings = new Float32Array(bases.buffer);
    for (let s = 0; s < segmentCount; ++s) {
      bases[s * 2] = segments.instanceBases[s];
      paddings[s * 2 + 1] = (members[s] as { padding?: ValueCell<number> }).padding?.ref.value ?? 0;
    }
    segmentBases.ref.value.write(bases);
    cellSpheres.ref.value.write(new Float32Array(spheres));

    // the records' words but the instance count: the level's count, first vertex or index, the region's first instance
    const records = new Uint32Array(levels * segmentCount * words);
    for (let j = 0; j < levels; ++j) {
      for (let s = 0; s < segmentCount; ++s) {
        const member = members[s];
        const drawCount: number = member.drawCount.ref.value;
        // gridless members draw at full detail at each level they overlap, as the CPU culling (`cullSegment`)
        const gridless = member.instanceGrid.ref.value.cellSize <= 1;
        const memberLevels = member.lodLevels?.ref.value as LodLevelsValue | undefined;
        const o = (j * segmentCount + s) * words;
        records[o] = levelCount === 0 || gridless || !memberLevels ? drawCount : memberLevels[j][3];
        // level 0 of a clustered segment drawn by its clusters' records
        if (j === 0 && clustered[s]) records[o] = 0;
        const first = j * instanceCount + segments.instanceBases[s];
        if (indexed) {
          records[o + 2] = segments.elementOffsets[s] / 4;
          records[o + 4] = first;
        } else {
          records[o + 2] = segments.drawBases[s];
          records[o + 3] = first;
        }
      }
    }
    args.ref.value.write(records);
    args2.ref.value.write(records);

    ValueCell.updateIfChanged(levelCountCell, levelCount);
    ValueCell.updateIfChanged(cellValues.uCellCount, cellCount);
    ValueCell.updateIfChanged(copyValues.uInstanceCount, instanceCount);
    ValueCell.updateIfChanged(copyValues.uSegmentCount, segmentCount);
    ValueCell.updateIfChanged(argsValues.uRecordCount, levels * segmentCount);
    ValueCell.updateIfChanged(clusterValues.uClusterCount, clusterCount);
    ValueCell.updateIfChanged(clusterArgsValues.uRecordCount, clusterCount);
    ValueCell.updateIfChanged(clusterDispatchValues.uSegmentCount, segmentCount);
    ValueCell.updateIfChanged(clusterDispatchValues.uClusterCount, clusterCount);
    ValueCell.updateIfChanged(snapshotValues.uRecordCount, levels * segmentCount);
    ValueCell.updateIfChanged(argsSecondValues.uRecordCount, levels * segmentCount);
    ValueCell.updateIfChanged(clusterSnapshotValues.uRecordCount, clusterCount);
    ValueCell.updateIfChanged(clusterArgsSecondValues.uRecordCount, clusterCount);
  }

  const getSlack = () =>
    getAnimationSlack(values as unknown as AnimationValues, members as unknown as AnimationValues[]);

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

  /** the instances' data for the kernel, and their own order after the regions (the identity region) */
  function syncInstances() {
    const data = new Float32Array(instanceCount * InstanceDataVec4s * 4);
    packInstanceData(values, data);
    instanceData.ref.value.write(data);
    for (const [name, floats] of Object.entries(AttributeFloats)) {
      const array = (values[name].ref.value as Float32Array).subarray(0, instanceCount * floats);
      attributes[name as keyof typeof AttributeFloats].ref.value.write(array, identityBase * floats * 4);
    }
  }

  /** what the cells and records are written from: the grids, the counts and the levels */
  const getLayoutKey = () => {
    let key = `${values.instanceCount.ref.value},${segments.count}`;
    for (const m of members) {
      key += `,${m.instanceGrid.ref.version},${m.boundingSphere.ref.version},${m.drawCount.ref.value},${m.lodLevels?.ref.version ?? -1},${(m as { padding?: ValueCell<number> }).padding?.ref.version ?? -1},${(m as { tPositionGroup?: ValueCell<unknown> }).tPositionGroup?.ref.version ?? -1}`;
    }
    return key;
  };
  const getInstanceVersions = () =>
    `${values.aTransform.ref.version},${values.aInstance.ref.version},${values.aSegment.ref.version},${values.aSegmentSphere.ref.version},${values.aSegmentLod.ref.version}`;
  let layoutKey = '';
  let instanceVersions = '';
  /** advanced where the layout or the instances changed: a dispatch culled with an older one is not current */
  let dataVersion = 0;
  function sync() {
    const key = getLayoutKey();
    const layoutChanged = key !== layoutKey;
    if (layoutChanged) {
      layoutKey = key;
      syncLayout();
    }
    const versions = getInstanceVersions();
    if (layoutChanged || versions !== instanceVersions) {
      instanceVersions = versions;
      syncInstances();
      dataVersion += 1;
    }
  }
  sync();
  // compiled from now on: a frame waiting for what is pending waits for them, culled on the CPU only meanwhile
  getKernels();

  const setPlane = (cell: ValueCell<Vec4>, plane: Plane3D) => {
    const v = cell.ref.value;
    Vec4.set(v, plane.normal[0], plane.normal[1], plane.normal[2], plane.constant);
    ValueCell.update(cell, v);
  };

  /**
   * What the last dispatch culled with: the planes, the distance range, the levels' ranges, `dataVersion` and the
   * pyramid's build; while they are the same its compacted attributes and records are current. Each drawn frame builds
   * a pyramid: a still camera without one culls nothing again, with one it tests against what the last frame drew (an
   * object hidden or refined at the same view reveals what it hid, `merged-render-objects.md` GPU occlusion culling)
   */
  const dispatched = new Float64Array(7 * 4 + 2).fill(NaN);
  const dispatchedLevels = Mat4.zero().fill(NaN);
  let dispatchedSlack = NaN;
  let dispatchedVersion = -1;
  const pyramidFrustum = Frustum3D();
  const pyramidMatrix = Mat4();

  /** the pyramid build the last dispatch tested against (`OcclusionPyramid.version`), -1 for none */
  let dispatchedPyramid = -1;
  function isPyramidDispatched(pyramid: OcclusionPyramid | undefined) {
    return pyramid ? pyramid.version === dispatchedPyramid : dispatchedPyramid === -1;
  }
  const getPlane = (i: number, cameraPlane: Plane3D, frustum: Frustum3D) => (i < 6 ? frustum[i as 0] : cameraPlane);
  function isDispatched(cameraPlane: Plane3D, frustum: Frustum3D, min: number, max: number) {
    if (dispatchedVersion !== dataVersion || dispatched[28] !== min || dispatched[29] !== max) return false;
    if (dispatchedSlack !== viewValues.uAnimationSlack.ref.value) return false;
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
    dispatchedSlack = viewValues.uAnimationSlack.ref.value;
    Mat4.copy(dispatchedLevels, levelRanges);
    dispatchedVersion = dataVersion;
  }

  let settled = true;
  /** whether the last dispatch was two-phase, and its second phase not dispatched yet */
  let dispatchedTwoPhase = false;
  let secondPending = false;
  const groups = (n: number) => Math.ceil(n / CellCullKernel.workgroupSize[0]);

  /** the occlusion test's pyramid (`OcclusionPyramid`), none: no occlusion */
  function setPyramid(pyramid: OcclusionPyramid | undefined) {
    ValueCell.updateIfChanged(cellValues.uHiZ, !!pyramid);
    if (pyramid) {
      ValueCell.update(cellValues.uHiZView, Mat4.copy(cellValues.uHiZView.ref.value, pyramid.view));
      ValueCell.update(cellValues.uHiZProjection, Mat4.copy(cellValues.uHiZProjection.ref.value, pyramid.projection));
      ValueCell.update(
        cellValues.uHiZDepthRange,
        Vec2.set(cellValues.uHiZDepthRange.ref.value, pyramid.near, pyramid.far),
      );
      ValueCell.update(
        cellValues.uHiZViewport,
        Vec2.set(cellValues.uHiZViewport.ref.value, pyramid.width, pyramid.height),
      );
      ValueCell.updateIfChanged(cellValues.uHiZLevelCount, pyramid.levelCount);
      // the pyramid's frustum: the planes of its projection and view, as the renderer's
      Frustum3D.fromProjectionMatrix(pyramidFrustum, Mat4.mul(pyramidMatrix, pyramid.projection, pyramid.view));
      setPlane(cellValues.uHiZPlane0, pyramidFrustum[0]);
      setPlane(cellValues.uHiZPlane1, pyramidFrustum[1]);
      setPlane(cellValues.uHiZPlane2, pyramidFrustum[2]);
      setPlane(cellValues.uHiZPlane3, pyramidFrustum[3]);
      setPlane(cellValues.uHiZPlane4, pyramidFrustum[4]);
      setPlane(cellValues.uHiZPlane5, pyramidFrustum[5]);
      ValueCell.updateIfChanged(cellValues.uHiZMinLevel, pyramid.minLevel);
    }
    ValueCell.updateIfChanged(cellValues.tHiZ, pyramid?.texture ?? emptyHiZ);
  }

  /** the instances' and clusters' copies (a phase, or the one), then the records of all instances drawn */
  function copyPass(records: number) {
    kernels![1].dispatch(groups(instanceCount));
    if (clusterCount > 0) {
      // as many columns as the most level-0 instances of a clustered segment drawn need (none out of view)
      kernels![5].dispatch(1);
      kernels![3].dispatchIndirect(clusterDispatch.ref.value);
    }
    kernels![2].dispatch(groups(records));
    if (clusterCount > 0) kernels![4].dispatch(groups(clusterCount));
  }
  let lists: MultiDrawBaseData[] = [];
  let lists2: MultiDrawBaseData[] = [];
  /** per level an indirect list of `levelArgs`, and level 0's clusters' of `clusterRecords` */
  function createLists(levels: readonly MultiDrawBaseData[], levelArgs: StorageBuffer, clusterRecords: StorageBuffer) {
    const out: MultiDrawBaseData[] = levels.slice(0, Math.max(1, levelCount)).map((level, j) => ({
      firsts: EmptyInt,
      counts: EmptyInt,
      offsets: EmptyInt,
      instanceCounts: EmptyInt,
      baseVertices: EmptyInt,
      baseInstances: EmptyUint,
      count: segmentCount,
      uniforms: level.uniforms,
      indirect: { buffer: levelArgs, byteOffset: j * segmentCount * stride, indexed },
    }));
    // level 0 of the clustered segments: a record per cluster
    if (clusterCount > 0) {
      out.push({ ...out[0], count: clusterCount, indirect: { buffer: clusterRecords, byteOffset: 0, indexed } });
    }
    return out;
  }
  let listsLevels: readonly MultiDrawBaseData[] | undefined;
  let listsKey = '';

  return {
    attributes,
    get identityBase() {
      return identityBase;
    },
    get settled() {
      return settled;
    },
    sync,
    dispatch: (cameraPlane, frustum, lod, pyramid, twoPhase = false) => {
      if (instanceCount === 0 || cellCount === 0) return false;
      const [min, max] = values.uLod.ref.value as Vec4;
      setLevelRanges(lod);
      ValueCell.updateIfChanged(viewValues.uAnimationSlack, getSlack());
      const sameView = isDispatched(cameraPlane, frustum, min, max);
      // one phase: a frame of the same view, data and pyramid culls as the last; two phases every frame (what was visible
      // last frame converges to what is visible: a frame after a jump draws more than it shows)
      if (!twoPhase && !dispatchedTwoPhase && sameView && isPyramidDispatched(pyramid)) {
        secondPending = false;
        return true;
      }
      if (!getKernels()) return false;
      dispatchedTwoPhase = twoPhase;
      // two-phase: no occlusion in phase 1 (the instances visible last frame), the pyramid of this frame in phase 2
      const first = twoPhase ? undefined : pyramid;
      dispatchedPyramid = first?.version ?? -1;
      setPyramid(first);
      setPlane(cellValues.uPlane0, frustum[0]);
      setPlane(cellValues.uPlane1, frustum[1]);
      setPlane(cellValues.uPlane2, frustum[2]);
      setPlane(cellValues.uPlane3, frustum[3]);
      setPlane(cellValues.uPlane4, frustum[4]);
      setPlane(cellValues.uPlane5, frustum[5]);
      setPlane(cellValues.uCameraPlane, cameraPlane);
      ValueCell.update(cellValues.uLevels, Mat4.copy(cellValues.uLevels.ref.value, levelRanges));
      const hasLod = min !== 0 || max !== 0;
      ValueCell.update(cellValues.uLodRange, Vec4.set(cellValues.uLodRange.ref.value, min, max, hasLod ? 1 : 0, 0));
      ValueCell.updateIfChanged(copyValues.uPhase, twoPhase ? 1 : 0);
      ValueCell.updateIfChanged(clusterValues.uPhase, twoPhase ? 1 : 0);

      const records = Math.max(1, levelCount) * segmentCount;
      counters.ref.value.clear(0, records * 4);
      if (clusterCount > 0) clusterCounters.ref.value.clear(0, clusterCount * 4);
      compute.beginComputePass({ label: 'merged cell culling' });
      kernels![0].dispatch(groups(cellCount));
      copyPass(records);
      if (twoPhase) {
        // where the second phase's instances start
        kernels![6].dispatch(groups(records));
        if (clusterCount > 0) kernels![7].dispatch(groups(clusterCount));
      }
      compute.endComputePass();
      setDispatched(cameraPlane, frustum, min, max);
      secondPending = twoPhase;
      // the pyramid was drawn from the last dispatch's culling: at this view and levels where they are the same
      settled = twoPhase || !pyramid || sameView;
      return true;
    },
    dispatchSecond: (pyramid) => {
      if (!secondPending || !kernels) return false;
      secondPending = false;
      setPyramid(pyramid);
      ValueCell.updateIfChanged(copyValues.uPhase, 2);
      ValueCell.updateIfChanged(clusterValues.uPhase, 2);
      const records = Math.max(1, levelCount) * segmentCount;
      compute.beginComputePass({ label: 'merged cell culling, second phase' });
      copyPass(records);
      kernels![8].dispatch(groups(records));
      if (clusterCount > 0) kernels![9].dispatch(groups(clusterCount));
      compute.endComputePass();
      return true;
    },
    getLists: (levels, second = false) => {
      const key = `${segmentCount},${levelCount},${args.ref.value.id},${clusterCount},${clusterArgs.ref.value.id},${args2.ref.value.id},${clusterArgs2.ref.value.id}`;
      if (levels !== listsLevels || key !== listsKey) {
        listsLevels = levels;
        listsKey = key;
        lists = createLists(levels, args.ref.value, clusterArgs.ref.value);
        lists2 = createLists(levels, args2.ref.value, clusterArgs2.ref.value);
      }
      return second ? lists2 : lists;
    },
    destroy: () => {
      if (kernels) for (const k of kernels) k.destroy();
      emptyHiZ.destroy();
      const cells = [
        instanceData,
        instanceCells,
        segmentBases,
        cellSpheres,
        cellLevels,
        counters,
        args,
        clusters,
        clusterCounters,
        clusterArgs,
        clusterDispatch,
        clusteredSegments,
        counters1,
        clusterCounters1,
        args2,
        clusterArgs2,
        clusterBits,
      ];
      for (const cell of [...cells, ...Object.values(attributes)]) cell.ref.value.destroy();
    },
  };
}
