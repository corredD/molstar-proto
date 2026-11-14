/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Column } from '@molstar/core/data/db';
import { Mat3, Mat4, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import type { ColorListName } from '@molstar/core/util/color/lists';
import { ColorScale } from '@molstar/core/util/color/scale';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import type { ShapeProvider } from '@molstar/graphics/geo/shape/provider';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { wireframeShapeGetter } from '@molstar/graphics/formats/shape/common';
import { shapeFromVtp, type VtpData } from '@molstar/graphics/formats/shape/vtp';
import type { ShapeGetter } from '@molstar/graphics/repr/shape/representation';
import type { Shape } from '@molstar/model/model/shape';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { getShapeProviderTransform, transformShapeProvider } from '@molstar/plugin/state/transforms/shape/transform';

// A mesh colored by a volume of the scene (Look › Color by › Volume; apps/prism-me/_spec/ui.md): the volume's density
// at each vertex (or each cell's center, when the mesh's arrays are per cell), or its Mean, Min or Max along the
// normal within ±Depth, in σ of the volume's grid. Both are read where they are drawn: the mesh at its shape's
// instance transform, the volume in its drawn grid (its level, its move). `MeshVolumeColor` is a decorator between a
// mesh's shape and its representation: it samples, adds the values to the mesh as an array (a VTP's: a copy of the
// file's arrays and this one; an OBJ's or a PLY's: beside it) and, while shown, colors the mesh by it.

/** Where the density is read: at the surface, or the Mean, Min or Max along the normal within ±Depth */
export type VolumeSample = 'surface' | 'mean' | 'min' | 'max';
export const VolumeSamples: readonly VolumeSample[] = ['surface', 'mean', 'min', 'max'];

/** How finely the colors follow the volume: at the vertices (a triangle between them), or a grid at its voxels */
export type VolumeDetail = 'vertex' | 'texture';
export const VolumeDetails: readonly VolumeDetail[] = ['vertex', 'texture'];

/** The range of a volume's colors, in σ, when Auto */
export const AutoSigmaRange: readonly [number, number] = [-2, 2];

/** A mesh's triangles, its vertices in its own (file) frame */
export interface SampledMesh {
  readonly vertices: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** The points a mesh is sampled at, with their normals (unit, or 0 for none), in its own frame */
export interface SamplePoints {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly count: number;
}

const _a = Vec3();
const _b = Vec3();
const _c = Vec3();
const _n = Vec3();

/**
 * The points to sample a mesh at: its vertices, each its normal the sum of its triangles' (area weighted); or, with
 * `cells` (each triangle's cell), each cell's center (its triangles' centroids, area weighted) and normal
 */
export function meshSamplePoints(
  mesh: SampledMesh,
  cells?: { readonly triangleCell: ArrayLike<number>; readonly count: number },
): SamplePoints {
  const { vertices: v, indices: ix, triangleCount } = mesh;
  const count = cells ? cells.count : mesh.vertexCount;
  const positions = new Float32Array(3 * count);
  const normals = new Float32Array(3 * count);
  const area = cells ? new Float64Array(count) : undefined;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = ix[3 * t];
    const i1 = ix[3 * t + 1];
    const i2 = ix[3 * t + 2];
    Vec3.set(_a, v[3 * i0], v[3 * i0 + 1], v[3 * i0 + 2]);
    Vec3.set(_b, v[3 * i1] - _a[0], v[3 * i1 + 1] - _a[1], v[3 * i1 + 2] - _a[2]);
    Vec3.set(_c, v[3 * i2] - _a[0], v[3 * i2 + 1] - _a[1], v[3 * i2 + 2] - _a[2]);
    // twice the triangle's area, along its normal
    Vec3.cross(_n, _b, _c);
    if (cells) {
      const k = cells.triangleCell[t];
      if (k < 0 || k >= count) continue;
      const w = Vec3.magnitude(_n);
      area![k] += w;
      for (let d = 0; d < 3; d++) {
        positions[3 * k + d] += (w * (3 * _a[d] + _b[d] + _c[d])) / 3;
        normals[3 * k + d] += _n[d];
      }
    } else {
      for (const i of [i0, i1, i2]) {
        normals[3 * i] += _n[0];
        normals[3 * i + 1] += _n[1];
        normals[3 * i + 2] += _n[2];
      }
    }
  }
  if (cells) {
    for (let k = 0; k < count; k++) {
      if (area![k] > 0) for (let d = 0; d < 3; d++) positions[3 * k + d] /= area![k];
      else for (let d = 0; d < 3; d++) positions[3 * k + d] = Number.NaN;
    }
  } else {
    for (let i = 0; i < 3 * count; i++) positions[i] = v[i];
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
    if (l > 0) for (let d = 0; d < 3; d++) normals[3 * i + d] /= l;
  }
  return { positions, normals, count };
}

const _g = Vec3();
const _step = Vec3();
const _p = Vec3();

/**
 * The volume at each point (σ of its grid: (value − mean) / σ), the points in the mesh's frame drawn at `transform`
 * and the grid read in its own frame. 'surface': at the point; else the Mean, Min or Max of the samples along its
 * normal from −depth to +depth (Å), every half voxel or less, trilinear. A sample outside the grid (between its outer
 * voxels' centers, a periodic grid too) counts for none; a point with none is NaN.
 */
export function sampleVolume(
  points: SamplePoints,
  transform: Mat4,
  grid: Grid,
  sample: VolumeSample,
  depth: number,
): Float32Array {
  const out = new Float32Array(points.count);
  const gridToCartn = Grid.getGridToCartesianTransform(grid);
  // the mesh's frame to the grid's indices; its normals to the world (inverse transpose), the world to indices
  const toGrid = Mat4.mul(Mat4(), Mat4.invert(Mat4(), gridToCartn), transform);
  const normalMatrix = Mat3.transpose(Mat3(), Mat3.invert(Mat3(), Mat3.fromMat4(Mat3(), transform)));
  const worldToIndex = Mat3.invert(Mat3(), Mat3.fromMat4(Mat3(), gridToCartn));
  const voxel = Math.min(
    Math.hypot(gridToCartn[0], gridToCartn[1], gridToCartn[2]),
    Math.hypot(gridToCartn[4], gridToCartn[5], gridToCartn[6]),
    Math.hypot(gridToCartn[8], gridToCartn[9], gridToCartn[10]),
  );
  const half = sample === 'surface' || !(depth > 0) ? 0 : Math.ceil(depth / (voxel / 2));
  const { mean, sigma } = grid.stats;
  const s = sigma > 0 ? sigma : 1;
  const [mi, mj, mk] = grid.cells.space.dimensions;
  const { get } = grid.cells.space;
  const data = grid.cells.data;
  const value = (i: number, j: number, k: number) => get(data, i, j, k);
  const { positions, normals } = points;
  for (let i = 0; i < points.count; i++) {
    Vec3.set(_p, positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
    Vec3.transformMat4(_g, _p, toGrid);
    if (half) {
      Vec3.set(_step, normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
      Vec3.transformMat3(_step, _step, normalMatrix);
      Vec3.normalize(_step, _step);
      Vec3.scale(_step, _step, depth / half);
      Vec3.transformMat3(_step, _step, worldToIndex);
    }
    let n = 0;
    let acc = sample === 'min' ? Infinity : sample === 'max' ? -Infinity : 0;
    for (let k = -half; k <= half; k++) {
      const x = _g[0] + k * _step[0];
      const y = _g[1] + k * _step[1];
      const z = _g[2] + k * _step[2];
      if (!(x >= 0 && y >= 0 && z >= 0 && x <= mi - 1 && y <= mj - 1 && z <= mk - 1)) continue;
      Vec3.set(_p, x, y, z);
      const v = Grid.trilinearlyInterpolate(_p, mi, mj, mk, false, value);
      if (Number.isNaN(v)) continue;
      n++;
      if (sample === 'min') acc = Math.min(acc, v);
      else if (sample === 'max') acc = Math.max(acc, v);
      else acc += v;
    }
    out[i] = n ? ((sample === 'surface' || sample === 'mean' ? acc / n : acc) - mean) / s : Number.NaN;
  }
  return out;
}

/** The cells of a color grid at most (Detail Texture): a grid over it is coarser */
export const MaxColorGridCells = 256 ** 3;

/**
 * A mesh's color grid (Detail Texture): cells at the volume's voxels (on them where the mesh is drawn without rotation),
 * in the mesh's own frame, and its cells near the surface, the band, the only ones a pixel reads
 */
export interface ColorBand {
  /** Cell (i, j, k) at `transform.xyz + (i, j, k) / transform.w`, in the mesh's frame */
  readonly dimension: Vec3;
  readonly transform: Vec4;
  /** The band's cells (x fastest) */
  readonly cells: Uint32Array;
  /** Their centers and the normals of the nearest points of the surface, in the mesh's frame, to sample */
  readonly points: SamplePoints;
  /** A cell's side where drawn (Å): the voxel, or more where the grid is over `MaxColorGridCells` */
  readonly spacing: number;
  /** Over `MaxColorGridCells` at the voxels: a cell is k voxels */
  readonly capped: boolean;
}

/**
 * The color grid of a mesh drawn at `transform` in `grid`'s voxels, and its band: the cells about each point of its
 * triangles (sampled every half cell, each the 3³ cells about it, which hold the 8 a pixel within half a cell reads), each
 * with the normal (vertex normals interpolated) of the nearest of those points. A grid over `maxCells` takes every
 * k-th voxel.
 */
export function colorBand(mesh: SampledMesh, transform: Mat4, grid: Grid, maxCells = MaxColorGridCells): ColorBand {
  const { vertices: v, indices: ix, vertexCount, triangleCount } = mesh;
  const scale = Math.max(
    Math.hypot(transform[0], transform[1], transform[2]),
    Math.hypot(transform[4], transform[5], transform[6]),
    Math.hypot(transform[8], transform[9], transform[10]),
  );
  // a voxel's side in the mesh's frame; the voxels' lattice there when it is axis-aligned and cubic
  const voxel = voxelOf(grid) / scale;
  const toMesh = Mat4.mul(Mat4(), Mat4.invert(Mat4(), transform), Grid.getGridToCartesianTransform(grid));
  let onVoxels = true;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      const e = toMesh[4 * c + r] - (r === c ? voxel : 0);
      if (Math.abs(e) > 1e-4 * voxel) onVoxels = false;
    }
  }
  const lo = Vec3.create(Infinity, Infinity, Infinity);
  const hi = Vec3.create(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < vertexCount; i++) {
    for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d], v[3 * i + d]);
      hi[d] = Math.max(hi[d], v[3 * i + d]);
    }
  }
  // two cells about the box (the 3³ cells about a point), every k-th voxel within the cap
  const extent = Vec3.sub(Vec3(), hi, lo);
  const cellsAt = (h: number) =>
    (Math.floor(extent[0] / h) + 6) * (Math.floor(extent[1] / h) + 6) * (Math.floor(extent[2] / h) + 6);
  let k = 1;
  while (cellsAt(k * voxel) > maxCells) k = Math.max(k + 1, Math.ceil(k * Math.cbrt(cellsAt(k * voxel) / maxCells)));
  const h = k * voxel;
  const min = Vec3();
  for (let d = 0; d < 3; d++) {
    min[d] = onVoxels ? toMesh[12 + d] + (Math.floor((lo[d] - toMesh[12 + d]) / h) - 2) * h : lo[d] - 2 * h;
  }
  const dimension = Vec3.create(
    Math.floor((hi[0] - min[0]) / h) + 3,
    Math.floor((hi[1] - min[1]) / h) + 3,
    Math.floor((hi[2] - min[2]) / h) + 3,
  );
  const [xn, yn, zn] = dimension;

  const normals = meshSamplePoints(mesh).normals;
  const slot = new Int32Array(xn * yn * zn).fill(-1);
  const cells: number[] = [];
  const dist: number[] = [];
  const nrm: number[] = [];
  const a = Vec3();
  const b = Vec3();
  const c = Vec3();
  const p = Vec3();
  const n = Vec3();
  const at = (out: Vec3, i: number) =>
    Vec3.set(out, (v[3 * i] - min[0]) / h, (v[3 * i + 1] - min[1]) / h, (v[3 * i + 2] - min[2]) / h);
  for (let t = 0; t < triangleCount; t++) {
    const i0 = ix[3 * t];
    const i1 = ix[3 * t + 1];
    const i2 = ix[3 * t + 2];
    at(a, i0);
    at(b, i1);
    at(c, i2);
    // every half cell along its sides
    const m = Math.max(1, Math.ceil(2 * Math.max(Vec3.distance(a, b), Vec3.distance(b, c), Vec3.distance(c, a))));
    for (let u = 0; u <= m; u++) {
      for (let w = 0; w <= m - u; w++) {
        const fb = u / m;
        const fc = w / m;
        const fa = 1 - fb - fc;
        for (let d = 0; d < 3; d++) {
          p[d] = fa * a[d] + fb * b[d] + fc * c[d];
          n[d] = fa * normals[3 * i0 + d] + fb * normals[3 * i1 + d] + fc * normals[3 * i2 + d];
        }
        // a pixel within half a cell of the point reads cells ⌊p − ½⌋ … ⌊p − ½⌋ + 2 along each axis
        const x0 = Math.floor(p[0] - 0.5);
        const y0 = Math.floor(p[1] - 0.5);
        const z0 = Math.floor(p[2] - 0.5);
        for (let z = Math.max(0, z0); z < Math.min(zn, z0 + 3); z++) {
          for (let y = Math.max(0, y0); y < Math.min(yn, y0 + 3); y++) {
            for (let x = Math.max(0, x0); x < Math.min(xn, x0 + 3); x++) {
              const d2 = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
              const cell = x + xn * (y + yn * z);
              let s = slot[cell];
              if (s < 0) {
                s = slot[cell] = cells.length;
                cells.push(cell);
                dist.push(Infinity);
                nrm.push(0, 0, 0);
              }
              if (d2 < dist[s]) {
                dist[s] = d2;
                nrm[3 * s] = n[0];
                nrm[3 * s + 1] = n[1];
                nrm[3 * s + 2] = n[2];
              }
            }
          }
        }
      }
    }
  }

  const count = cells.length;
  const positions = new Float32Array(3 * count);
  const pointNormals = Float32Array.from(nrm);
  for (let s = 0; s < count; s++) {
    const cell = cells[s];
    positions[3 * s] = min[0] + (cell % xn) * h;
    positions[3 * s + 1] = min[1] + (Math.floor(cell / xn) % yn) * h;
    positions[3 * s + 2] = min[2] + Math.floor(cell / (xn * yn)) * h;
    const l = Math.hypot(nrm[3 * s], nrm[3 * s + 1], nrm[3 * s + 2]);
    if (l > 0) for (let d = 0; d < 3; d++) pointNormals[3 * s + d] /= l;
  }
  return {
    dimension,
    transform: Vec4.create(min[0], min[1], min[2], 1 / h),
    cells: Uint32Array.from(cells),
    points: { positions, normals: pointNormals, count },
    spacing: h * scale,
    capped: k > 1,
  };
}

/** A volume's voxel (Å): its grid's shortest side */
export function voxelOf(grid: Grid): number {
  const m = Grid.getGridToCartesianTransform(grid);
  return Math.min(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
}

/**
 * Per-cell values at the vertices: the mean of the cells of the triangles about each (a triangle counted once each),
 * as a VTP colors a cell array (`cellToVertexAverage`); per-vertex values as they are
 */
function atVertices(values: Float32Array, mesh: SampledMesh, triangleCell?: ArrayLike<number>): ArrayLike<number> {
  if (!triangleCell) return values;
  const sum = new Float64Array(mesh.vertexCount);
  const count = new Uint32Array(mesh.vertexCount);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v = values[triangleCell[t]];
    for (let k = 0; k < 3; k++) {
      sum[mesh.indices[3 * t + k]] += v;
      count[mesh.indices[3 * t + k]]++;
    }
  }
  for (let i = 0; i < mesh.vertexCount; i++) sum[i] = count[i] ? sum[i] / count[i] : 0;
  return sum;
}

/** Where a vertex has no value (outside the volume) */
const NoData = Color(0x808080);

export const MeshVolumeColorParams = {
  volume: PD.Text('', { description: "The volume's drawn cell (its last decorator), by state ref" }),
  name: PD.Text('density', { description: 'The name of the array the values are kept in' }),
  sample: PD.Select<VolumeSample>('surface', [
    ['surface', 'At surface'],
    ['mean', 'Projected: mean'],
    ['min', 'Projected: min'],
    ['max', 'Projected: max'],
  ]),
  depth: PD.Numeric(2, { min: 0, max: 1000, step: 0.1 }, { description: 'Along the normal, ± Å' }),
  detail: PD.Select<VolumeDetail>(
    'vertex',
    [
      ['vertex', 'Vertex'],
      ['texture', 'Texture'],
    ],
    { description: "Colors at the vertices, or a grid at the volume's voxels read per pixel" },
  ),
  show: PD.Boolean(true, { description: 'Colors the mesh by the values (else only keeps the array)' }),
  colorList: PD.Text('viridis'),
  range: PD.Value<'auto' | [number, number]>('auto', { description: 'In σ: auto (±2σ) or [min, max]' }),
  invert: PD.Boolean(false),
};
export type MeshVolumeColorProps = PD.Values<typeof MeshVolumeColorParams>;

/** The values a mesh was sampled at, kept as an array: its name, point or cell, its values (σ) */
export interface SampledArray {
  readonly name: string;
  readonly kind: 'point' | 'cell';
  readonly values: Float32Array;
}
const sampledArrays = new WeakMap<object, SampledArray>();
/** The array a decorated mesh's provider keeps (a VTP's is also in its file's arrays) */
export const sampledArrayOf = (provider: object | undefined) => (provider ? sampledArrays.get(provider) : undefined);

/** The color grid of a decorated mesh's provider, when it colors by one (Detail Texture) */
export const colorBandOf = (provider: object | undefined): ColorBand | undefined =>
  (provider as { data?: Partial<VolumeColorData> } | undefined)?.data?.volumeColor?.band?.band;

type AnyProvider = ShapeProvider<any, any, any>;
/** A VTP's parsed file and its arrays (io's, as graphics' VTP shape takes them) */
type VtpFile = VtpData['source'];
type VtpScalarArray = VtpFile['pointData'] extends ReadonlyMap<string, infer A> ? A : never;

/** A VTP's parsed file, when the shape is a VTP's */
function vtpOf(p: AnyProvider): VtpFile | undefined {
  const source = (p.data as { source?: Partial<VtpFile> } | undefined)?.source;
  return source?.pointData instanceof Map && source.cellData instanceof Map && source.triangleCellIndex
    ? (source as VtpFile)
    : undefined;
}

/** A copy of a VTP's file with one more array (its own arrays shared, not changed) */
function withArray(file: VtpFile, a: SampledArray): VtpFile {
  const array: VtpScalarArray = {
    name: a.name,
    type: 'Float32',
    numberOfComponents: 1,
    rangeMin: undefined,
    rangeMax: undefined,
    values: Column.ofFloatArray(a.values),
  };
  const add = (m: ReadonlyMap<string, VtpScalarArray>, kind: 'point' | 'cell') =>
    kind === a.kind ? new Map([...m, [a.name, array]]) : m;
  return { ...file, pointData: add(file.pointData, 'point'), cellData: add(file.cellData, 'cell') };
}

/** A shape's mesh with one group per vertex: itself when its groups are its vertices (a VTP's), else a copy */
function perVertex(mesh: Mesh): Mesh {
  const groups = mesh.groupBuffer.ref.value;
  let same = true;
  for (let i = 0; i < mesh.vertexCount && same; i++) same = groups[i] === i;
  if (same) return mesh;
  const g = new Float32Array(mesh.vertexCount);
  for (let i = 0; i < g.length; i++) g[i] = i;
  const m = Mesh.create(
    mesh.vertexBuffer.ref.value.slice(0, 3 * mesh.vertexCount),
    mesh.indexBuffer.ref.value.slice(0, 3 * mesh.triangleCount),
    mesh.normalBuffer.ref.value.slice(0, 3 * mesh.vertexCount),
    g,
    mesh.vertexCount,
    mesh.triangleCount,
  );
  return m;
}

/** A decorated mesh's data: its shape's (a VTP's file and transforms, kept for readers) and how it is colored */
interface VolumeColorData {
  readonly volumeColor: {
    readonly base: AnyProvider;
    readonly values: Float32Array;
    readonly triangleCell?: ArrayLike<number>;
    /** Detail Texture: the color grid and its band's values (σ) */
    readonly band?: { readonly band: ColorBand; readonly values: Float32Array };
    readonly props: MeshVolumeColorProps;
  };
}

/** The colors of a band's grid, kept with the band: its other cells (never read) no value once, its cells refilled */
const bandColors = new WeakMap<ColorBand, Uint8Array>();

/** A color grid of `band`'s values: its cells' colors, the others (never read) as no value */
function colorGridOf(band: ColorBand, values: Float32Array, color: (value: number) => Color): Shape.ColorGrid {
  let colors = bandColors.get(band);
  if (!colors) {
    const [xn, yn, zn] = band.dimension;
    colors = new Uint8Array(4 * xn * yn * zn);
    const none = Color.toRgb(NoData);
    for (let i = 0; i < colors.length; i += 4) {
      colors[i] = none[0];
      colors[i + 1] = none[1];
      colors[i + 2] = none[2];
      colors[i + 3] = 255;
    }
    bandColors.set(band, colors);
  }
  for (let n = 0; n < band.cells.length; n++) {
    const c = Number.isNaN(values[n]) ? NoData : color(values[n]);
    const o = 4 * band.cells[n];
    colors[o] = (c >> 16) & 255;
    colors[o + 1] = (c >> 8) & 255;
    colors[o + 2] = c & 255;
  }
  return { colors, dimension: band.dimension, transform: band.transform };
}

/**
 * The decorated mesh's shape: its base's as is, or colored at each vertex by the values (Shown). From its data alone:
 * the representation keeps the getter it was made with and is given each new data (`ShapeRepresentation3D.update`)
 */
function volumeColorGetter(): ShapeGetter<VolumeColorData, Mesh, any> {
  let last: { inner: Shape<Mesh>; color: VolumeColorData['volumeColor']; shape: Shape<Mesh> } | undefined;
  return async (ctx, data, props, shape) => {
    const color = data.volumeColor;
    const { base, values, triangleCell, band, props: p } = color;
    // the shape it is given back is ours: the base's own is the one to refill (not a copy with groups per vertex)
    const prev = shape && last?.shape === shape ? last.inner : shape;
    const inner = (await base.getShape(ctx, base.data, props, prev)) as Shape<Mesh>;
    if (!p.show) return inner;
    if (last?.inner === inner && last.color === color) return last.shape;
    const geometry = perVertex(inner.geometry);
    const mesh = {
      vertices: geometry.vertexBuffer.ref.value,
      indices: geometry.indexBuffer.ref.value,
      vertexCount: geometry.vertexCount,
      triangleCount: geometry.triangleCount,
    };
    const [lo, hi] = p.range === 'auto' ? AutoSigmaRange : p.range;
    const scale = ColorScale.create({ listOrName: p.colorList as ColorListName, domain: [lo, hi], reverse: p.invert });
    const at = atVertices(values, mesh, triangleCell);
    const colors = new Uint32Array(geometry.vertexCount);
    for (let i = 0; i < colors.length; i++) colors[i] = Number.isNaN(at[i]) ? NoData : scale.color(at[i]);
    const getColor = (g: number) => (colors[g] ?? NoData) as Color;
    const label = geometry === inner.geometry ? inner.getLabel : (g: number) => `Vertex ${g}`;
    const colored = ShapeUtils.enableTrianglePicking(
      ShapeUtils.create(
        inner.name,
        inner.sourceData,
        geometry,
        getColor,
        inner.getSize,
        label,
        inner.transforms,
        geometry.vertexCount,
      ),
    );
    if (p.detail === 'texture' && band) colored.colorGrid = colorGridOf(band.band, band.values, scale.color);
    last = { inner, color, shape: colored };
    return colored;
  };
}

/** What the sampling was made of, to sample again only when one of them changes */
interface SampleCache {
  inner?: AnyProvider;
  volume?: Volume;
  sample?: VolumeSample;
  depth?: number;
  values?: Float32Array;
  /** Detail Texture's band, for the same mesh, volume, sample and depth */
  band?: { band: ColorBand; values: Float32Array };
  /** The shape drawn with the array (a VTP's made again from its file), for these values and this name */
  base?: { inner: AnyProvider; values: Float32Array; name: string; provider: AnyProvider };
}

export type MeshVolumeColor = typeof MeshVolumeColor;
export const MeshVolumeColor = PluginStateTransform.BuiltIn({
  name: 'cryoet-mesh-volume-color',
  display: { name: 'Color by volume', description: "A mesh's density in a volume, kept as an array and its colors" },
  from: SO.Shape.Provider,
  to: SO.Shape.Provider,
  isDecorator: true,
  params: MeshVolumeColorParams,
})({
  // weak: the mesh stays drawn (gray) when its volume is removed, and is colored again when it comes back
  weakDependencies: true,
  getDependencies: (p) => (p.volume ? [p.volume] : []),
  apply({ a, params, dependencies, cache }) {
    return Task.create('Color by volume', async (ctx) => {
      const inner = a.data as AnyProvider;
      const volume = params.volume ? (dependencies?.[params.volume]?.data as Volume | undefined) : undefined;
      const file = vtpOf(inner);
      // per cell when the mesh's arrays are (a VTP with cell arrays only), else per vertex
      const perCell = !!file && file.cellData.size > 0 && file.pointData.size === 0;
      const c = cache as SampleCache;
      // the mesh as drawn (its transform, a move above it included), made with the shape's default props
      let drawn: Shape<Mesh> | undefined;
      const drawnMesh = async () => {
        drawn ??= (await inner.getShape(ctx, inner.data, PD.getDefaultValues(inner.params))) as Shape<Mesh>;
        const g = drawn.geometry;
        const mesh = {
          vertices: g.vertexBuffer.ref.value,
          indices: g.indexBuffer.ref.value,
          vertexCount: g.vertexCount,
          triangleCount: g.triangleCount,
        };
        return { mesh, transform: drawn.transforms[0] ?? Mat4.identity() };
      };
      let values = c.values;
      if (
        !values ||
        c.inner !== inner ||
        c.volume !== volume ||
        c.sample !== params.sample ||
        c.depth !== params.depth
      ) {
        const { mesh, transform } = await drawnMesh();
        const points = meshSamplePoints(
          mesh,
          perCell ? { triangleCell: file!.triangleCellIndex, count: file!.numberOfCells } : undefined,
        );
        values = volume
          ? sampleVolume(points, transform, volume.grid, params.sample, params.depth)
          : new Float32Array(points.count).fill(Number.NaN);
        Object.assign(c, { inner, volume, sample: params.sample, depth: params.depth, values, band: undefined });
      }
      // Detail Texture: the band sampled as the vertices are, kept while only the colors change
      if (params.detail === 'texture' && volume && !c.band) {
        const { mesh, transform } = await drawnMesh();
        const band = colorBand(mesh, transform, volume.grid);
        c.band = { band, values: sampleVolume(band.points, transform, volume.grid, params.sample, params.depth) };
      }
      const array: SampledArray = { name: params.name, kind: perCell ? 'cell' : 'point', values };
      // a VTP: a provider of its file with the array, so Array can color by it, moved as the shape above it moves it
      // (`shape.transform`); another mesh: its own. Made again only for other values or another name
      let base = c.base?.inner === inner && c.base.values === values && c.base.name === params.name && c.base.provider;
      if (!base) {
        const move = getShapeProviderTransform(inner);
        const vtp = file
          ? await shapeFromVtp(withArray(file, array), { transforms: inner.data.transforms }).runInContext(ctx)
          : undefined;
        base = vtp ? (move ? transformShapeProvider(vtp, move) : vtp) : inner;
        c.base = { inner, values, name: params.name, provider: base };
      }
      const getShape = volumeColorGetter();
      const data: VolumeColorData = {
        ...base.data,
        volumeColor: {
          base,
          values,
          triangleCell: perCell ? file!.triangleCellIndex : undefined,
          band: params.detail === 'texture' ? c.band : undefined,
          props: params,
        },
      };
      // registered as moved by the identity: its representation is made anew when the decorator comes or goes (the
      // getter it keeps is then this one, or the shape's own again), and updated with each new data in between
      const provider = transformShapeProvider({ ...base, data, getShape }, Mat4.identity());
      // its shapes as made (not copies with the identity premultiplied: a copy is not picked by triangle)
      provider.getShape = getShape;
      provider.getWireframeShape = wireframeShapeGetter(getShape);
      sampledArrays.set(provider, array);
      return new SO.Shape.Provider(provider, { label: a.label, description: a.description });
    });
  },
});
