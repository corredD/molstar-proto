/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet, Interval } from '@molstar/core/data/int';
import { Grid, Volume } from '@molstar/model/model/volume';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Color } from '@molstar/core/util/color';
import { clamp, normalize } from '@molstar/core/math/interpolate';
import { packIntToRGBArray } from '@molstar/core/util/number-packing';
import { cantorPairing } from '@molstar/core/data/util/hash-functions';
import { PositionLocation } from '@molstar/graphics/geo/util/location-iterator';
import type { Image } from '@molstar/graphics/geo/geometry/image/image';
import type { Theme } from '@molstar/graphics/theme/theme';
import { SizeTheme } from '@molstar/graphics/theme/size';
import { UniformColorTheme, UniformColorThemeParams } from '@molstar/graphics/theme/color/uniform';
import { VolumeValueColorTheme, VolumeValueColorThemeParams } from '@molstar/graphics/theme/color/volume-value';
import { applySliceObjectLoci, applySliceGroupIntervals, createImage, SliceParams, type SliceProps } from '../slice.js';
import { createPeriodicVolume } from '../util.js';

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

/**
 * The plane/frame sampler's index as it was built: each pixel that maps a cell, pushed in pixel order under its cell
 * (`cantorPairing(instance, cell)` when periodic). A pixel mapped a cell when it fell in the grid (its group packed, so
 * not zero) and, periodic, had an instance there (else its value was set to NaN; a periodic grid's samples wrap and are
 * never NaN on data without NaN)
 */
function referenceSampledIndex(volume: Volume, image: Image) {
  const { instance, cell } = image.meta.mapping as ReferenceMapping;
  const group = image.groupTexture.ref.value.array;
  const value = image.valueTexture.ref.value.array;
  const periodic = Volume.isPeriodic(volume);
  const index = new Map<number, number[]>();
  for (let i = 0; i < instance.length; ++i) {
    const packed = group[i * 4] !== 0 || group[i * 4 + 1] !== 0 || group[i * 4 + 2] !== 0;
    if (!packed || (periodic && Number.isNaN(value[i]))) continue;
    const key = periodic ? cantorPairing(instance[i], cell[i]) : cell[i];
    const a = index.get(key);
    if (a) a.push(i);
    else index.set(key, [i]);
  }
  return index;
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
    it(`${vName}: a plane or frame slice's index, as before`, async () => {
      const volume = makeVolume();
      const theme = valueTheme(volume);
      const range = Volume.getPeriodicRange(volume);
      const shown = range ? createPeriodicVolume(volume, range.min, range.max) : volume;
      const center = Vec3.add(Vec3(), Grid.getBoundingSphere(shown.grid).center, Vec3.create(0.01, -0.02, 0.03));
      const planes: Partial<SliceProps>[] = [
        { mode: 'plane', plane: { point: center, normal: Vec3.create(1, 0.3, 0.2) } },
        { mode: 'frame', axis: 'b', offset: 0.1, rotation: { axis: Vec3.create(1, 0, 0), angle: 20 } },
        { mode: 'frame', axis: 'c', offset: -0.2, rotation: { axis: Vec3.create(0, 1, 1), angle: 0 } },
      ];
      for (const p of planes) {
        const im = await createImage({} as any, volume, 0, theme, sliceProps(p));
        const mapping = im.meta.mapping as { index: IndexLike };
        const expected = referenceSampledIndex(volume, im);
        expect(expected.size).toBeGreaterThan(0);
        expectSameIndex(mapping.index, expected, keysOf(volume));
      }
    });
  }
});
