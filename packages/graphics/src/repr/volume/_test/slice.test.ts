/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it, vi } from 'vitest';
import { OrderedSet, Interval } from '@molstar/core/data/int';
import { Grid, Volume } from '@molstar/model/model/volume';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Color } from '@molstar/core/util/color';
import { clamp, normalize } from '@molstar/core/math/interpolate';
import { packIntToRGBArray } from '@molstar/core/util/number-packing';
import { cantorPairing, hashFnv32a } from '@molstar/core/data/util/hash-functions';
import { PositionLocation } from '@molstar/graphics/geo/util/location-iterator';
import { Image } from '@molstar/graphics/geo/geometry/image/image';
import { transformPositionArray } from '@molstar/graphics/geo/util';
import type { Theme } from '@molstar/graphics/theme/theme';
import { SizeTheme } from '@molstar/graphics/theme/size';
import { UniformColorTheme, UniformColorThemeParams } from '@molstar/graphics/theme/color/uniform';
import { VolumeValueColorTheme, VolumeValueColorThemeParams } from '@molstar/graphics/theme/color/volume-value';
import {
  applySliceObjectLoci,
  applySliceGroupIntervals,
  createImage,
  getSampledImage,
  SliceParams,
  type SliceProps,
} from '../slice.js';
import { createPeriodicVolume } from '../util.js';
import { SliceVisual } from '../slice.js';
import {
  SliceBinned,
  SliceSettleMs,
  SliceWindowConfig,
  SliceWindowDepth,
  SliceWindowHiddenMs,
} from '../slice-window.js';
import { binGrid } from '@molstar/model/model/volume/bin';
import { createNullTexture, type Texture } from '@molstar/graphics/gl/texture';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { TextureImage } from '@molstar/graphics/gl/renderable/util';
import { Task } from '@molstar/core/task';
import { PickingId } from '@molstar/graphics/geo/geometry/picking';
import { MarkerAction } from '@molstar/core/util/marker-action';

function createTestVolume(instanceCount: number, periodic = false, stats: Grid['stats'] = Grid.One.stats): Volume {
  return {
    grid: periodic ? { ...Grid.One, periodicity: 'xyz', stats } : { ...Grid.One, stats },
    instances: Array.from({ length: instanceCount }, () => ({ transform: Mat4.identity() })),
    sourceData: { kind: 'test', name: 'test', data: {} } as any,
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
    _localPropertyData: Object.create(null),
  };
}

describe('slice helpers', () => {
  it('applies object loci as displayed plane intervals for contiguous instances', () => {
    const volume = createTestVolume(4);
    const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([[5, 15]]);
  });

  it('applies object loci per displayed instance for discontiguous selections', () => {
    const volume = createTestVolume(4);
    const loci = Volume.Loci(volume, OrderedSet.ofSortedArray([0, 2]) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });

  it('collapses periodic object loci to the single displayed slice plane', () => {
    const volume = createTestVolume(4, true);
    const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 6, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([[0, 6]]);
  });

  it('batches contiguous slice pixels into minimal intervals', () => {
    const intervals: Array<[number, number]> = [];

    const changed = applySliceGroupIntervals([1, 2, 3, 7, 8, 10], 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([
      [6, 9],
      [12, 14],
      [15, 16],
    ]);
  });
});

/** A whole unit cell (periodic) of 4³ voxels, 40 Å a side, its origin at -0.5 (centered, as EMDB maps are) */
function centeredCell(): Volume {
  const space = Tensor.Space([4, 4, 4], [0, 1, 2], Float32Array);
  const cell = SpacegroupCell.create(
    'P 1',
    Vec3.create(40, 40, 40),
    Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
  );
  const fractionalBox = Box3D.create(Vec3.create(-0.5, -0.5, -0.5), Vec3.create(0.5, 0.5, 0.5));
  return {
    ...createTestVolume(1, true, { min: 0, max: 1, mean: 0.5, sigma: 0.5 }),
    grid: {
      transform: { kind: 'spacegroup', cell, fractionalBox },
      cells: Tensor.create(space, space.create()),
      stats: { min: 0, max: 1, mean: 0.5, sigma: 0.5 },
      periodicity: 'xyz',
    },
  };
}

describe('slice of a periodic volume', () => {
  it('is drawn in the grid, its origin kept', async () => {
    const volume = centeredCell();
    const theme = { color: { granularity: 'uniform', color: () => 0xffffff }, size: {} } as any;
    const props = { ...PD.getDefaultValues(SliceParams), dimension: { name: 'z', params: 2 } } as any;
    const image = await createImage({} as any, volume, 0, theme, props);
    // the z slice through the middle voxel: x and y across the cell (-20..20 Å), z at the third of four voxels
    const corners = Array.from(image.cornerBuffer.ref.value);
    const xs = corners.filter((_, i) => i % 3 === 0);
    const zs = corners.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeCloseTo(-20);
    expect(Math.max(...xs)).toBeCloseTo(20);
    for (const z of zs) expect(z).toBeCloseTo(0);
    // where the isosurface and the volume's bounds are
    for (const c of image.boundingSphere.center) expect(c).toBeCloseTo(0);
  });

  it('as a plane, covers the volume in Å, not in voxels', async () => {
    const volume = centeredCell();
    const theme = { color: { granularity: 'uniform', color: () => 0xffffff }, size: {} } as any;
    const plane = { point: Vec3.create(0, 0, 5), normal: Vec3.create(0, 0, 1) };
    const props = { ...PD.getDefaultValues(SliceParams), mode: 'plane', plane } as any;
    const image = await createImage({} as any, volume, 0, theme, props);
    // the plane z = 5 Å, as wide as the cell (40 Å, its voxels 10 Å) or wider, not 4 voxels' worth
    const corners = Array.from(image.cornerBuffer.ref.value);
    const xs = corners.filter((_, i) => i % 3 === 0);
    const ys = corners.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-20);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(20);
    expect(Math.min(...ys)).toBeLessThanOrEqual(-20);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(20);
    for (const z of corners.filter((_, i) => i % 3 === 2)) expect(z).toBeCloseTo(5);
  });
});

// The grid slice built before it was made fast (lane fast-slice, 2026-11): kept as the reference the new build must
// equal pixel for pixel, with its getSliceInfo, and the plane/frame sampler's pixel→cell index as it was built
type ReferenceMapping = { instance: Int16Array; cell: Uint32Array; index: Map<number, number[]> };

function referenceSliceInfo(grid: Grid, props: SliceProps) {
  const {
    dimension: { name: dim, params: index },
  } = props;
  const { space } = grid.cells;
  const relative = (n: number, i: number) => clamp(Math.round((n - 1) * i), 0, n - 1);
  let width, height;
  let x, y, z;
  let x0 = 0,
    y0 = 0,
    z0 = 0;
  let [nx, ny, nz] = space.dimensions;
  if (dim === 'x' || dim === 'relativeX') {
    (x = dim === 'x' ? index : relative(nx, index)), (y = ny), (z = nz);
    (width = nz), (height = ny);
    (x0 = x), (nx = x0 + 1);
  } else if (dim === 'y' || dim === 'relativeY') {
    (x = nx), (y = dim === 'y' ? index : relative(ny, index)), (z = nz);
    (width = nz), (height = nx);
    (y0 = y), (ny = y0 + 1);
  } else {
    (x = nx), (y = ny), (z = dim === 'z' ? index : relative(nz, index));
    (width = nx), (height = ny);
    (z0 = z), (nz = z0 + 1);
  }
  return { width, height, x0, y0, z0, nx, ny, nz };
}

function referenceGridImage(volume: Volume, theme: Theme, props: SliceProps) {
  const periodicRange = Volume.getPeriodicRange(volume);
  if (periodicRange) volume = createPeriodicVolume(volume, periodicRange.min, periodicRange.max);

  const {
    cells: { space, data },
    stats,
  } = volume.grid;
  const { min, max } = stats;
  const isUniform = theme.color.granularity === 'uniform';
  const color = 'color' in theme.color && theme.color.color ? theme.color.color : () => Color(0xffffff);
  const { width, height, x0, y0, z0, nx, ny, nz } = referenceSliceInfo(volume.grid, props);

  const imageArray = new Uint8Array(width * height * 4);
  const groupArray = new Uint8Array(width * height * 4);
  const valueArray = new Float32Array(width * height);
  const mapping: ReferenceMapping = {
    instance: new Int16Array(width * height),
    cell: new Uint32Array(width * height),
    index: new Map(),
  };
  const gridToCartn = Grid.getGridToCartesianTransform(volume.grid);
  const l = PositionLocation(Vec3(), Vec3());
  const periodicMapping = Volume.getPeriodicMapping(volume);

  let i = 0;
  for (let iy = y0; iy < ny; ++iy) {
    for (let ix = x0; ix < nx; ++ix) {
      for (let iz = z0; iz < nz; ++iz) {
        const i4 = i * 4;
        Vec3.set(l.position, ix, iy, iz);
        Vec3.transformMat4(l.position, l.position, gridToCartn);
        Color.toArray(color(l, false), imageArray, i4);
        const val = normalize(space.get(data, ix, iy, iz), min, max);
        if (isUniform) {
          imageArray[i4] *= val;
          imageArray[i4 + 1] *= val;
          imageArray[i4 + 2] *= val;
        }
        valueArray[i] = val;
        packIntToRGBArray(i, groupArray, i4);
        if (periodicMapping) {
          const pm = periodicMapping.get(ix, iy, iz);
          if (pm) {
            mapping.instance[i] = pm.instance;
            mapping.cell[i] = pm.cell;
            mapping.index.set(cantorPairing(pm.instance, pm.cell), [i]);
          } else {
            imageArray[i4] = 0;
            imageArray[i4 + 1] = 0;
            imageArray[i4 + 2] = 0;
            imageArray[i4 + 3] = 0;
            valueArray[i] = NaN;
          }
        } else {
          const o = space.dataOffset(ix, iy, iz);
          mapping.instance[i] = -1;
          mapping.cell[i] = o;
          mapping.index.set(o, [i]);
        }
        i += 1;
      }
    }
  }
  return { imageArray, groupArray, valueArray, mapping };
}

/** The plane/frame sampler as it was built, kept as the reference (`getSampledImage` at c1b8ecb82) */
function referenceSampledImage(
  volume: Volume,
  theme: Theme,
  info: { m: Mat4; width: number; height: number },
  isoValue: Volume.IsoValue,
  trim: Image.Trim,
  image?: Image,
): Image {
  const { m, width, height } = info;

  const {
    cells: { space },
    stats,
  } = volume.grid;
  const { min, max } = stats;

  const isUniform = theme.color.granularity === 'uniform';
  const color = 'color' in theme.color && theme.color.color ? theme.color.color : () => Color(0xffffff);

  const v = Vec3();

  const gridToCartn = Grid.getGridToCartesianTransform(volume.grid);
  const cartnToGrid = Mat4.invert(Mat4(), gridToCartn);
  const [mx, my, mz] = space.dimensions;

  const imageArray = new Uint8Array(width * height * 4);
  const groupArray = new Uint8Array(width * height * 4);
  const valueArray = new Float32Array(width * height);

  const mapping: ReferenceMapping = {
    instance: new Int16Array(width * height),
    cell: new Uint32Array(width * height),
    index: new Map(),
  };

  const gridCoords = Vec3();

  const pl = PositionLocation(Vec3(), Vec3());
  const getTrilinearlyInterpolated = Grid.makeGetTrilinearlyInterpolated(volume.grid, 'none');

  const periodicMapping = Volume.getPeriodicMapping(volume);

  let i = 0;
  for (let ih = 0; ih < height; ++ih) {
    for (let iw = 0; iw < width; ++iw) {
      const i4 = i * 4;

      const y = clamp(iw + 0.5, 0, width - 1) / width - 0.5;
      const x = clamp(ih + 0.5, 0, height - 1) / height - 0.5;
      Vec3.set(v, x, -y, 0);
      Vec3.transformMat4(v, v, m);

      Vec3.copy(gridCoords, v);
      Vec3.transformMat4(gridCoords, gridCoords, cartnToGrid);

      const ix = Math.trunc(gridCoords[0]);
      const iy = Math.trunc(gridCoords[1]);
      const iz = Math.trunc(gridCoords[2]);

      Vec3.copy(pl.position, v);
      const c = color(pl, false);
      Color.toArray(c, imageArray, i4);

      const val = normalize(getTrilinearlyInterpolated(v), min, max);
      if (isUniform) {
        imageArray[i4] *= val;
        imageArray[i4 + 1] *= val;
        imageArray[i4 + 2] *= val;
      }
      valueArray[i] = val;

      if (ix >= 0 && ix < mx && iy >= 0 && iy < my && iz >= 0 && iz < mz) {
        packIntToRGBArray(i, groupArray, i4);

        if (periodicMapping) {
          const pm = periodicMapping.get(ix, iy, iz);
          if (pm) {
            mapping.instance[i] = pm.instance;
            mapping.cell[i] = pm.cell;
            const key = cantorPairing(pm.instance, pm.cell);
            if (mapping.index.has(key)) {
              mapping.index.get(key)!.push(i);
            } else {
              mapping.index.set(key, [i]);
            }
          } else {
            imageArray[i4] = 0;
            imageArray[i4 + 1] = 0;
            imageArray[i4 + 2] = 0;
            imageArray[i4 + 3] = 0;
            valueArray[i] = NaN;
          }
        } else {
          const o = space.dataOffset(ix, iy, iz);
          mapping.instance[i] = -1;
          mapping.cell[i] = o;
          if (mapping.index.has(o)) {
            mapping.index.get(o)!.push(i);
          } else {
            mapping.index.set(o, [i]);
          }
        }
      }

      i += 1;
    }
  }

  const imageTexture = { width, height, array: imageArray, flipY: true };
  const groupTexture = { width, height, array: groupArray, flipY: true };
  const valueTexture = { width, height, array: valueArray, flipY: true };

  const corners = new Float32Array([-0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0]);
  transformPositionArray(m, corners, 0, 4);

  const isoLevel = clamp(normalize(Volume.IsoValue.toAbsolute(isoValue, stats).absoluteValue, min, max), 0, 1);

  const im = Image.create(imageTexture, corners, groupTexture, valueTexture, trim, isoLevel, image);
  im.setBoundingSphere(
    Volume.isPeriodic(volume)
      ? Volume.getBoundingSphere(volume, Interval.ofLength(volume.instances.length as Volume.InstanceIndex))
      : Grid.getBoundingSphere(volume.grid),
  );
  im.meta.mapping = mapping;

  return im;
}

/** A grid whose cell→Cartesian transform has entries no float represents exactly (a shear, thirds, an origin) */
const Skewed = Mat4.ofRows([
  [0.1, 0.03, 0, 12.3],
  [0.02, 1 / 3, 0.05, -4.7],
  [0, 0.01, 0.7, 0.9],
  [0, 0, 0, 1],
]);
/** Periodic volumes need an orthogonal cell: thirds and tenths, and an origin */
const Scaled = Mat4.ofRows([
  [0.1, 0, 0, 0.3],
  [0, 1 / 3, 0, -0.2],
  [0, 0, 0.7, 0.1],
  [0, 0, 0, 1],
]);

function gridVolume(
  dims: [number, number, number],
  axisOrder: [number, number, number],
  matrix: Mat4,
  periodic?: { tiles: [number, number, number][] },
): Volume {
  const space = Tensor.Space(dims, axisOrder, Float32Array);
  const data = space.create();
  let min = Infinity,
    max = -Infinity,
    sum = 0;
  for (let i = 0; i < data.length; ++i) {
    data[i] = Math.sin(i * 1.7) * 10 + (i % 3);
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
    sum += data[i];
  }
  const mean = sum / data.length;
  const cellSize = Vec3.create(matrix[0] * dims[0], matrix[5] * dims[1], matrix[10] * dims[2]);
  const tiles = periodic?.tiles ?? [[0, 0, 0]];
  return {
    grid: {
      transform: { kind: 'matrix', matrix },
      cells: Tensor.create(space, data),
      stats: { min, max, mean, sigma: (max - min) / 4 },
      ...(periodic ? { periodicity: 'xyz' as const } : {}),
    },
    instances: tiles.map((t) => ({
      transform: Mat4.fromTranslation(Mat4(), Vec3.mul(Vec3(), Vec3.create(t[0], t[1], t[2]), cellSize)),
    })),
    sourceData: { kind: 'test', name: 'test', data: {} } as any,
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
    _localPropertyData: Object.create(null),
  };
}

function uniformTheme(): Theme {
  return {
    color: UniformColorTheme({}, { ...PD.getDefaultValues(UniformColorThemeParams), value: Color(0x3399cc) }),
    size: SizeTheme.Empty,
  };
}

function valueTheme(volume: Volume): Theme {
  const props = PD.getDefaultValues(VolumeValueColorThemeParams);
  return {
    color: VolumeValueColorTheme({ volume }, { ...props, domain: { name: 'custom', params: [-6, 7] } }),
    size: SizeTheme.Empty,
  };
}

/**
 * A position theme as sensitive as can be: the color is a hash of the position's bits, so a position off by one ulp
 * (float drift, sums in another order) changes the pixel; the volume value theme rounds most such drift away
 */
function positionBitsTheme(): Theme {
  const bits = new Float64Array(3);
  const words = new Int32Array(bits.buffer);
  return {
    color: {
      factory: positionBitsTheme as any,
      granularity: 'vertex',
      color: (l: any) => {
        bits[0] = l.position[0];
        bits[1] = l.position[1];
        bits[2] = l.position[2];
        return Color(hashFnv32a(Array.from(words)) & 0xffffff);
      },
      props: {},
    },
    size: SizeTheme.Empty,
  };
}

function sliceProps(p: Partial<SliceProps>): SliceProps {
  return { ...PD.getDefaultValues(SliceParams), ...p };
}

/** Bit for bit: a Float32Array's NaNs and signed zeros compared by their bytes */
function bytes(a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

type IndexLike = { get(key: number): number[] | undefined };

/** Every key the index can be asked for (eachSlice's lookups: cells, or instance and cell paired), and some beyond */
function keysOf(volume: Volume) {
  const cellCount = volume.grid.cells.data.length;
  const keys: number[] = [];
  if (Volume.isPeriodic(volume)) {
    for (let inst = 0; inst < volume.instances.length + 1; ++inst) {
      for (let c = 0; c < cellCount + 2; ++c) keys.push(cantorPairing(inst, c));
    }
  } else {
    for (let c = 0; c < cellCount + 2; ++c) keys.push(c);
  }
  return keys;
}

function expectSameIndex(actual: IndexLike, expected: Map<number, number[]>, keys: number[]) {
  let found = 0;
  for (const k of keys) {
    const e = expected.get(k);
    expect(actual.get(k), `key ${k}`).toEqual(e);
    if (e) found += 1;
  }
  expect(found).toBe(expected.size);
}

describe('grid slice image, built as before', () => {
  const dimensions = ['x', 'y', 'z'] as const;
  const relative = ['relativeX', 'relativeY', 'relativeZ'] as const;
  const volumes: [string, () => Volume][] = [
    ['skewed, x fastest', () => gridVolume([5, 4, 3], [2, 1, 0], Skewed)],
    ['skewed, z fastest', () => gridVolume([4, 3, 5], [0, 1, 2], Skewed)],
    [
      'skewed, a copied space (no strides)',
      () => {
        const v = gridVolume([4, 5, 3], [2, 1, 0], Skewed);
        return { ...v, grid: { ...v.grid, cells: { ...v.grid.cells, space: { ...v.grid.cells.space } } } };
      },
    ],
    [
      'periodic, every tile drawn',
      () =>
        gridVolume([3, 4, 2], [2, 1, 0], Scaled, {
          tiles: [
            [0, 0, 0],
            [1, 0, 0],
          ],
        }),
    ],
    [
      'periodic, a tile missing',
      () =>
        gridVolume([3, 2, 4], [2, 1, 0], Scaled, {
          tiles: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
        }),
    ],
  ];
  const themes: [string, (v: Volume) => Theme][] = [
    ['uniform', () => uniformTheme()],
    ['volume value (by position)', (v) => valueTheme(v)],
    ['position bits', () => positionBitsTheme()],
  ];

  for (const [vName, makeVolume] of volumes) {
    for (const [tName, makeTheme] of themes) {
      it(`${vName}, ${tName}: same pixels, groups, values, mapping and index along x, y, z`, async () => {
        const volume = makeVolume();
        const theme = makeTheme(volume);
        const [nx, ny, nz] = (
          Volume.isPeriodic(volume)
            ? createPeriodicVolume(volume, Volume.getPeriodicRange(volume)!.min, Volume.getPeriodicRange(volume)!.max)
            : volume
        ).grid.cells.space.dimensions;
        const cases: SliceProps['dimension'][] = [];
        for (const name of dimensions) {
          const n = name === 'x' ? nx : name === 'y' ? ny : nz;
          for (let i = 0; i < n; ++i) cases.push({ name, params: i });
        }
        for (const name of relative) cases.push({ name, params: 0.37 });

        for (const dimension of cases) {
          const props = sliceProps({ mode: 'grid', dimension });
          const ref = referenceGridImage(volume, theme, props);
          const im = await createImage({} as any, volume, 0, theme, props);
          const at = `${dimension.name} ${dimension.params}`;
          expect(im.imageTexture.ref.value.array, at).toEqual(ref.imageArray);
          expect(im.groupTexture.ref.value.array, at).toEqual(ref.groupArray);
          expect(bytes(im.valueTexture.ref.value.array as Float32Array), at).toEqual(bytes(ref.valueArray));
          const mapping = im.meta.mapping as { instance: Int16Array; cell: Uint32Array; index: IndexLike };
          expect(mapping.instance, at).toEqual(ref.mapping.instance);
          expect(mapping.cell, at).toEqual(ref.mapping.cell);
          expectSameIndex(mapping.index, ref.mapping.index, keysOf(volume));
        }
      });
    }
  }

  for (const [vName, makeVolume] of volumes) {
    it(`${vName}: a plane or frame sampler's pixels, values, mapping and index, as before`, () => {
      const range = Volume.getPeriodicRange(makeVolume());
      const volume = range ? createPeriodicVolume(makeVolume(), range.min, range.max) : makeVolume();
      const theme = valueTheme(volume);
      const sphere = Grid.getBoundingSphere(volume.grid);
      const isoValue = Volume.IsoValue.relative(0.5);
      const normals = [Vec3.create(1, 0.3, 0.2), Vec3.create(0, 0, 1), Vec3.create(-0.2, 1, 0.4)];
      for (const n of normals) {
        // an oblique plane through the volume's center, as wide as the volume, sampled 9 × 7
        const m = Mat4.fromPlane(
          Mat4(),
          Vec3.normalize(Vec3(), n),
          Vec3.add(Vec3(), sphere.center, Vec3.create(0.01, -0.02, 0.03)),
        );
        Mat4.scale(m, m, Vec3.create(sphere.radius * 2, sphere.radius * 2, sphere.radius * 2));
        const info = { m, width: 9, height: 7 };
        const trim = Image.createEmptyTrim();
        const ref = referenceSampledImage(volume, theme, info, isoValue, trim);
        const im = getSampledImage(volume, theme, info, isoValue, trim);
        const at = `normal ${Array.from(n)}`;
        expect(im.imageTexture.ref.value.array, at).toEqual(ref.imageTexture.ref.value.array);
        expect(im.groupTexture.ref.value.array, at).toEqual(ref.groupTexture.ref.value.array);
        expect(bytes(im.valueTexture.ref.value.array as Float32Array), at).toEqual(
          bytes(ref.valueTexture.ref.value.array as Float32Array),
        );
        const mapping = im.meta.mapping as { instance: Int16Array; cell: Uint32Array; index: IndexLike };
        const expected = ref.meta.mapping as ReferenceMapping;
        expect(mapping.instance, at).toEqual(expected.instance);
        expect(mapping.cell, at).toEqual(expected.cell);
        expect(expected.index.size, at).toBeGreaterThan(0);
        expectSameIndex(mapping.index, expected.index, keysOf(range ? makeVolume() : volume));
      }
    });
  }
});

/** A 3d texture on the CPU: its layers' contents, the planes written into it */
type StubTexture = Texture & { data: Float32Array; width: number; height: number; depth: number; writes: number };

/** A graphics context with 3d textures held on the CPU (`loadLayer`), for the window's path without a GPU */
function stubGraphics(texture3d = true) {
  const owned = new Set<Texture>();
  const textures: StubTexture[] = [];
  const graphics = {
    capabilities: { texture3d },
    resources: {
      limits: { max3dTextureSize: 2048 },
      pending: { track: <T>(p: Promise<T>) => p },
      ownsTexture: (t: Texture) => owned.has(t),
      texture: () => {
        const t = {
          ...createNullTexture(),
          data: new Float32Array(0),
          width: 0,
          height: 0,
          depth: 0,
          writes: 0,
          define(w: number, h: number, d = 1) {
            Object.assign(t, { width: w, height: h, depth: d, data: new Float32Array(w * h * d) });
          },
          loadLayer(image: TextureImage<Float32Array>, layer: number) {
            if (image.width !== t.width || image.height !== t.height || layer >= t.depth) throw new Error('outside');
            t.data.set(image.array, layer * t.width * t.height);
            t.writes += 1;
          },
          destroy() {
            owned.delete(t);
          },
        } as StubTexture;
        owned.add(t);
        textures.push(t);
        return t;
      },
    },
  } as unknown as GraphicsContext;
  return { graphics, textures, owned };
}

describe('grid slice from a window of its planes (slice-window.ts)', () => {
  const volumes: [string, () => Volume][] = [
    ['x fastest', () => gridVolume([5, 4, 40], [2, 1, 0], Skewed)],
    ['z fastest', () => gridVolume([40, 3, 5], [0, 1, 2], Skewed)],
    // a map read from a file (MRC): periodic, one tile, drawn in its tile's grid
    ['periodic, one tile', () => gridVolume([5, 4, 40], [2, 1, 0], Scaled, { tiles: [[1, 0, 0]] })],
  ];
  const dimensions = ['x', 'y', 'z'] as const;

  for (const [vName, makeVolume] of volumes) {
    for (const [tName, makeTheme] of [
      ['uniform', () => uniformTheme()],
      ['volume value', (v: Volume) => valueTheme(v)],
    ] as const) {
      it(`${vName}, ${tName}: the layer drawn holds the CPU image's values, mapping and groups, along x, y, z`, async () => {
        const volume = makeVolume();
        const theme = makeTheme(volume);
        const { min, max } = volume.grid.stats;
        const { graphics, textures } = stubGraphics();
        for (const name of dimensions) {
          const n = volume.grid.cells.space.dimensions[{ x: 0, y: 1, z: 2 }[name]];
          let image: Image | undefined;
          for (let i = 0; i < n; ++i) {
            const props = sliceProps({ mode: 'grid', dimension: { name, params: i } });
            image = await createImage({ graphics } as any, volume, 0, theme, props, image);
            const ref = referenceGridImage(volume, theme, props);
            const at = `${name} ${i}`;
            expect(image.sliceWindow.ref.value, at).toBe(true);
            const texture = image.sliceTexture.ref.value as StubTexture;
            const { width, height } = texture;
            expect([width, height], at).toEqual([
              image.imageTextureDim.ref.value[0],
              image.imageTextureDim.ref.value[1],
            ]);
            const layer = image.sliceLayer.ref.value;
            expect(layer, at).toBe(i % SliceWindowDepth);
            const plane = texture.data.subarray(layer * width * height, (layer + 1) * width * height);
            for (let k = 0; k < plane.length; ++k) {
              expect((plane[k] - min) / (max - min), `${at} pixel ${k}`).toBeCloseTo(ref.valueArray[k], 5);
            }
            expect(image.groupTexture.ref.value.array, at).toEqual(ref.groupArray);
            // where the CPU path draws it
            const cpu = await createImage({} as any, volume, 0, theme, props);
            expect(Array.from(image.cornerBuffer.ref.value), at).toEqual(Array.from(cpu.cornerBuffer.ref.value));
            expect(image.boundingSphere.radius, at).toBeCloseTo(cpu.boundingSphere.radius, 4);
            const mapping = image.meta.mapping as { instance: Int16Array; cell: Uint32Array; index: IndexLike };
            expect(mapping.cell, at).toEqual(ref.mapping.cell);
            expectSameIndex(mapping.index, ref.mapping.index, keysOf(volume));
          }
        }
        // one window per axis made, the previous freed
        expect(textures.length).toBe(3);
      });
    }
  }

  it('colors: the uniform color over the grid range, volume-value over its domain', async () => {
    const volume = gridVolume([5, 4, 40], [2, 1, 0], Skewed);
    const { graphics } = stubGraphics();
    const props = sliceProps({ mode: 'grid', dimension: { name: 'z', params: 3 } });
    const { min, max } = volume.grid.stats;
    const u = await createImage({ graphics } as any, volume, 0, uniformTheme(), props);
    expect(Array.from(u.sliceDomain.ref.value)).toEqual([min, max, min, max].map(Math.fround));
    const v = await createImage({ graphics } as any, volume, 0, valueTheme(volume), props);
    expect(Array.from(v.sliceDomain.ref.value)).toEqual([min, max, -6, 7].map(Math.fround));
  });

  it('falls back to the CPU image: another theme, a periodic volume, no strides, no 3d textures, plane mode', async () => {
    const strided = gridVolume([5, 4, 40], [2, 1, 0], Skewed);
    const noStrides = {
      ...strided,
      grid: { ...strided.grid, cells: { ...strided.grid.cells, space: { ...strided.grid.cells.space } } },
    };
    const periodic = gridVolume([3, 4, 2], [2, 1, 0], Scaled, {
      tiles: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    const grid = sliceProps({ mode: 'grid', dimension: { name: 'z', params: 1 } });
    const cases: [string, Volume, Theme, SliceProps, boolean][] = [
      ['position theme', strided, positionBitsTheme(), grid, true],
      ['periodic, two tiles', periodic, uniformTheme(), grid, true],
      ['no strides', noStrides, uniformTheme(), grid, true],
      ['no 3d textures', strided, uniformTheme(), grid, false],
      ['plane', strided, uniformTheme(), sliceProps({ mode: 'plane' }), true],
    ];
    for (const [name, volume, theme, props, texture3d] of cases) {
      const { graphics, textures } = stubGraphics(texture3d);
      const im = await createImage({ graphics } as any, volume, 0, theme, props);
      expect(im.sliceWindow.ref.value, name).toBe(false);
      expect(textures.length, name).toBe(0);
    }
  });

  it('a window image made again on the CPU frees its window', async () => {
    const volume = gridVolume([5, 4, 40], [2, 1, 0], Skewed);
    const { graphics, owned } = stubGraphics();
    const props = sliceProps({ mode: 'grid', dimension: { name: 'z', params: 3 } });
    const im = await createImage({ graphics } as any, volume, 0, uniformTheme(), props);
    expect(owned.size).toBe(1);
    const again = await createImage({ graphics } as any, volume, 0, positionBitsTheme(), props, im);
    expect(again.sliceWindow.ref.value).toBe(false);
    expect(owned.size).toBe(0);
    expect(again.imageTexture.ref.value.array).toEqual(
      referenceGridImage(volume, positionBitsTheme(), props).imageArray,
    );
  });
});

describe('a slice visual moved within its window', () => {
  async function setup(theme: Theme) {
    const volume = gridVolume([6, 5, 200], [2, 1, 0], Skewed);
    const { graphics, textures, owned } = stubGraphics();
    const visual = SliceVisual(0);
    const update = (props: Partial<SliceProps>, t = theme) =>
      Task.create('update', (runtime) =>
        visual.createOrUpdate({ runtime, graphics }, t, props, { volume, key: 0 }),
      ).run();
    await update(sliceProps({ mode: 'grid', dimension: { name: 'z', params: 100 } }));
    return { volume, visual, update, textures, owned };
  }

  /** The idle fill done (`SliceWindow.fill` by timers) */
  const idle = async () => {
    for (let k = 0; k < 20; ++k) await new Promise((r) => setTimeout(r, 0));
  };

  it('a step updates the image in place: no new geometry, a uniform within the band, a plane copied at its edge', async () => {
    const { visual, update, textures } = await setup(uniformTheme());
    const version = visual.geometryVersion;
    const texture = textures[0];
    // the plane shown at once, the window's others in idle time
    expect(texture.writes).toBe(1);
    await idle();
    expect(texture.writes).toBe(SliceWindowDepth);
    const values = visual.renderObject!.values as any;
    for (let i = 101; i <= 107; ++i) await update({ dimension: { name: 'z', params: i } });
    expect(texture.writes).toBe(SliceWindowDepth);
    expect(values.uSliceLayer.ref.value).toBe(107 % SliceWindowDepth);
    for (let i = 108; i <= 157; ++i) {
      await update({ dimension: { name: 'z', params: i } });
      await idle();
    }
    // one plane per step past the band's edge
    expect(texture.writes).toBe(SliceWindowDepth + 50);
    expect(visual.geometryVersion).toBe(version);
    expect(textures.length).toBe(1);
  });

  it('a jump copies the plane shown at once, the window around it in idle time, nearest first', async () => {
    const { volume, update, textures } = await setup(uniformTheme());
    await idle();
    const texture = textures[0];
    const before = texture.writes;
    await update({ dimension: { name: 'z', params: 20 } });
    expect(texture.writes - before).toBe(1);
    await idle();
    expect(texture.writes - before).toBe(SliceWindowDepth);
    // every layer holds its plane: z 4 to 35
    const [nx, ny] = volume.grid.cells.space.dimensions;
    const plane = nx * ny;
    for (let z = 4; z < 36; ++z) {
      const layer = z % SliceWindowDepth;
      expect(texture.data[layer * plane + 7], `z ${z}`).toBe(
        volume.grid.cells.data[volume.grid.cells.space.dataOffset(1, 1, z)],
      );
    }
  });

  it('picks the voxel of the drawn slice', async () => {
    const { volume, visual, update } = await setup(uniformTheme());
    await update({ dimension: { name: 'z', params: 123 } });
    const [nx] = volume.grid.cells.space.dimensions;
    // pixel (row 2, column 3): x 3, y 2
    const loci = visual.getLoci({ objectId: visual.renderObject!.id, instanceId: 0, groupId: 2 * nx + 3 } as PickingId);
    const cell = (loci as Volume.Cell.Loci).elements[0].indices;
    expect(Interval.start(cell as Interval)).toBe(volume.grid.cells.space.dataOffset(3, 2, 123));
  });

  it('a contrast change is a uniform; another axis or theme makes it again', async () => {
    const volume0 = gridVolume([6, 5, 200], [2, 1, 0], Skewed);
    const { visual, update, textures, owned } = await setup(valueTheme(volume0));
    const version = visual.geometryVersion;
    const props = PD.getDefaultValues(VolumeValueColorThemeParams);
    const contrast: Theme = {
      color: VolumeValueColorTheme({ volume: volume0 }, { ...props, domain: { name: 'custom', params: [-2, 3] } }),
      size: SizeTheme.Empty,
    };
    await update({}, contrast);
    expect(visual.geometryVersion).toBe(version);
    const values = visual.renderObject!.values as any;
    expect(values.uSliceDomain.ref.value[2]).toBe(-2);
    await update({ dimension: { name: 'x', params: 2 } }, contrast);
    expect(visual.geometryVersion).toBe(version + 1);
    expect(textures.length).toBe(2);
    // a theme by position, not by the value alone
    const byPosition = {
      color: { granularity: 'vertex', color: () => Color(0xff0000), props: {} },
      size: SizeTheme.Empty,
    };
    await update({ dimension: { name: 'x', params: 3 } }, byPosition as unknown as Theme);
    expect(values.dSliceWindow.ref.value).toBe(false);
    expect(owned.size).toBe(0);
    visual.destroy();
  });

  it('a step clears the marks: the voxels marked are no longer drawn (as the CPU path, its markers made again)', async () => {
    const { volume, visual, update } = await setup(uniformTheme());
    const values = visual.renderObject!.values as any;
    const cell = volume.grid.cells.space.dataOffset(3, 2, 100);
    const loci = Volume.Cell.Loci(volume, [
      {
        indices: Interval.ofSingleton(cell as Volume.CellIndex),
        instances: OrderedSet.ofSingleton(0 as Volume.InstanceIndex),
      },
    ]);
    expect(visual.mark(loci, MarkerAction.Select)).toBe(true);
    expect(values.markerStatus.ref.value).not.toBe(0);
    await update({ dimension: { name: 'z', params: 101 } });
    expect(values.markerStatus.ref.value).toBe(0);
    expect(Array.from(values.tMarker.ref.value.array as Uint8Array).every((m) => m === 0)).toBe(true);
  });

  it('hidden a while, its window is freed; shown again, made again at the slice drawn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { visual, owned, textures } = await setup(uniformTheme());
      const values = visual.renderObject!.values as any;
      expect(owned.size).toBe(1);
      visual.setVisibility(false);
      vi.advanceTimersByTime(SliceWindowHiddenMs - 1);
      expect(owned.size).toBe(1);
      // shown again before: kept
      visual.setVisibility(true);
      vi.advanceTimersByTime(SliceWindowHiddenMs * 2);
      expect(owned.size).toBe(1);
      visual.setVisibility(false);
      vi.advanceTimersByTime(SliceWindowHiddenMs);
      expect(owned.size).toBe(0);
      visual.setVisibility(true);
      expect(owned.size).toBe(1);
      const texture = textures.at(-1)!;
      expect(values.tSliceTex.ref.value).toBe(texture);
      // the plane drawn copied at once: z 100
      expect(texture.writes).toBeGreaterThanOrEqual(1);
      expect(values.uSliceLayer.ref.value).toBe(100 % SliceWindowDepth);
      visual.destroy();
      expect(owned.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy frees the window', async () => {
    const { visual, owned } = await setup(uniformTheme());
    expect(owned.size).toBe(1);
    visual.destroy();
    expect(owned.size).toBe(0);
  });
});

describe('a big slice moved: its 2× binned planes first, the full resolution once it rests', () => {
  async function big() {
    const volume = gridVolume([7, 5, 200], [2, 1, 0], Skewed);
    const coarseVoxels = SliceWindowConfig.coarseVoxels;
    SliceWindowConfig.coarseVoxels = 1000;
    const { graphics, textures, owned } = stubGraphics();
    const visual = SliceVisual(0);
    const update = (props: Partial<SliceProps>) =>
      Task.create('update', (runtime) =>
        visual.createOrUpdate({ runtime, graphics }, uniformTheme(), props, { volume, key: 0 }),
      ).run();
    await update(sliceProps({ mode: 'grid', dimension: { name: 'z', params: 100 } }));
    const binned = await SliceBinned.get(volume.grid).ready;
    // the full window filled (idle time)
    for (let k = 0; k < 40; ++k) await new Promise((r) => setTimeout(r, 0));
    const restore = () => {
      SliceWindowConfig.coarseVoxels = coarseVoxels;
      visual.destroy();
    };
    return { volume, visual, update, textures, owned, binned, restore };
  }

  it('the binned grid is binGrid 2×', async () => {
    const { volume, binned, restore } = await big();
    try {
      const ref = await binGrid(volume.grid, 2);
      expect(Array.from(binned.cells.data)).toEqual(Array.from(ref.cells.data));
      expect(binned.cells.space.dimensions).toEqual(ref.cells.space.dimensions);
    } finally {
      restore();
    }
  });

  it('a step out of the full window shows the binned plane, the full one after it rests, at the same place', async () => {
    const { volume, visual, update, textures, binned, restore } = await big();
    try {
      const values = visual.renderObject!.values as any;
      const corners = (i: number) => {
        const cpu = createImage(
          {} as any,
          volume,
          0,
          uniformTheme(),
          sliceProps({ mode: 'grid', dimension: { name: 'z', params: i } }),
        );
        return cpu.then((im) => Array.from(im.cornerBuffer.ref.value));
      };
      // within the full window: full resolution
      await update({ dimension: { name: 'z', params: 101 } });
      expect(values.uSliceBin.ref.value).toBe(1);
      // far: the binned plane of the pair holding it
      await update({ dimension: { name: 'z', params: 23 } });
      expect(values.uSliceBin.ref.value).toBe(2);
      const coarse = values.tSliceTex.ref.value as StubTexture;
      expect(coarse).not.toBe(textures[0]);
      const layer = values.uSliceLayer.ref.value;
      expect(layer).toBe(11 % SliceWindowDepth);
      const [bx, by] = binned.cells.space.dimensions;
      expect([coarse.width, coarse.height]).toEqual([bx, by]);
      const plane = coarse.data.subarray(layer * bx * by, (layer + 1) * bx * by);
      for (let y = 0; y < by; ++y) {
        for (let x = 0; x < bx; ++x) {
          expect(plane[y * bx + x]).toBe(binned.cells.data[binned.cells.space.dataOffset(x, y, 11)]);
        }
      }
      // the image's size the full plane's: the shader reads texel p / 2
      expect(Array.from(values.uImageTexDim.ref.value)).toEqual([7, 5]);
      expect(Array.from(values.aPosition.ref.value)).toEqual(await corners(23));
      // rested: full resolution at 23
      await new Promise((r) => setTimeout(r, SliceSettleMs + 50));
      expect(values.uSliceBin.ref.value).toBe(1);
      expect(values.tSliceTex.ref.value).toBe(textures[0]);
      expect(values.uSliceLayer.ref.value).toBe(23 % SliceWindowDepth);
      expect(Array.from(values.aPosition.ref.value)).toEqual(await corners(23));
    } finally {
      restore();
    }
  });

  it('a volume under the threshold never bins', async () => {
    expect(SliceWindowConfig.coarseVoxels).toBe(2 ** 28);
    const volume = gridVolume([7, 5, 200], [2, 1, 0], Skewed);
    const { graphics } = stubGraphics();
    const visual = SliceVisual(0);
    await Task.create('update', (runtime) =>
      visual.createOrUpdate(
        { runtime, graphics },
        uniformTheme(),
        sliceProps({ mode: 'grid', dimension: { name: 'z', params: 100 } }),
        { volume, key: 0 },
      ),
    ).run();
    expect(SliceBinned.peek(volume.grid)).toBeUndefined();
    visual.destroy();
  });
});
