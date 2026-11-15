/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Image } from '@molstar/graphics/geo/geometry/image/image';
import type { ThemeRegistryContext, Theme } from '@molstar/graphics/theme/theme';
import { Grid, Volume } from '@molstar/model/model/volume';
import { VolumeRepresentation, VolumeRepresentationProvider } from './representation.js';
import { PositionLocation } from '@molstar/graphics/geo/util/location-iterator';
import type { VisualUpdateState } from '../util.js';
import type { RepresentationContext, RepresentationParamsGetter } from '../representation.js';
import type { VisualContext } from '../visual.js';
import { PickingId } from '@molstar/graphics/geo/geometry/picking';
import { EmptyLoci, type Loci } from '@molstar/model/model/loci';
import { transformPositionArray } from '@molstar/graphics/geo/util';
import { Color } from '@molstar/core/util/color';
import { ColorTheme } from '@molstar/graphics/theme/color';
import { packIntToRGBArray } from '@molstar/core/util/number-packing';
import { createPeriodicVolume, createVolumeSliceCellLocationIterator, eachVolumeLoci } from './util.js';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Quat } from '@molstar/core/math/linear-algebra/3d/quat';
import { degToRad } from '@molstar/core/math/misc';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { clamp, normalize } from '@molstar/core/math/interpolate';
import { assertUnreachable } from '@molstar/core/util/type-helpers';
import { OrderedSet } from '@molstar/core/data/int/ordered-set';
import { Interval } from '@molstar/core/data/int/interval';
import { VolumeVisual } from './visual.js';
import { cantorPairing, invertCantorPairing } from '@molstar/core/data/util/hash-functions';
import { Tensor } from '@molstar/core/math/linear-algebra/tensor';
import { ValueCell } from '@molstar/core/util/value-cell';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import { VolumeValueColorTheme, getVolumeValueDomain } from '@molstar/graphics/theme/color/volume-value';
import { type SliceAxis, SliceWindow } from './slice-window.js';

export const SliceParams = {
  ...Image.Params,
  quality: { ...Image.Params.quality, isEssential: false },
  dimension: PD.MappedStatic(
    'x',
    {
      x: PD.Numeric(0, { min: 0, max: 0, step: 1 }, { immediateUpdate: true }),
      y: PD.Numeric(0, { min: 0, max: 0, step: 1 }, { immediateUpdate: true }),
      z: PD.Numeric(0, { min: 0, max: 0, step: 1 }, { immediateUpdate: true }),
      relativeX: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
      relativeY: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
      relativeZ: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
    },
    { isEssential: true, hideIf: (p) => p.mode !== 'grid', description: 'Slice position in grid coordinates.' },
  ),
  isoValue: Volume.IsoValueParam,
  mode: PD.Select('grid', PD.arrayToOptions(['grid', 'frame', 'plane'] as const), {
    description:
      'Grid: slice through the volume along the grid axes in integer steps. Frame: slice through the volume along arbitrary axes in any step size. Plane: an arbitrary plane defined by point and normal.',
  }),
  offset: PD.Numeric(
    0,
    { min: -1, max: 1, step: 0.01 },
    {
      isEssential: true,
      immediateUpdate: true,
      hideIf: (p) => p.mode !== 'frame',
      description: 'Relative offset from center.',
    },
  ),
  axis: PD.Select('a', PD.arrayToOptions(['a', 'b', 'c'] as const), {
    isEssential: true,
    hideIf: (p) => p.mode !== 'frame',
    description: 'Axis of the frame.',
  }),
  rotation: PD.Group(
    {
      axis: PD.Vec3(Vec3.create(1, 0, 0), {}, { description: 'Axis of rotation' }),
      angle: PD.Numeric(
        0,
        { min: -180, max: 180, step: 1 },
        { immediateUpdate: true, description: 'Axis rotation angle in Degrees' },
      ),
    },
    { isExpanded: true, hideIf: (p) => p.mode !== 'frame' },
  ),
  plane: PD.Group(
    {
      point: PD.Vec3(Vec3.create(0, 0, 0), {}, { description: 'Plane point' }),
      normal: PD.Vec3(Vec3.create(1, 0, 0), {}, { description: 'Plane normal' }),
    },
    { isExpanded: true, hideIf: (p) => p.mode !== 'plane' },
  ),
};
export type SliceParams = typeof SliceParams;
export type SliceProps = PD.Values<SliceParams>;

export function getSliceParams(ctx: ThemeRegistryContext, volume: Volume) {
  const periodicRange = Volume.getPeriodicRange(volume);
  if (periodicRange) {
    const { min, max } = periodicRange;
    volume = createPeriodicVolume(volume, min, max);
  }

  const p = PD.clone(SliceParams);
  const dim = volume.grid.cells.space.dimensions;
  p.dimension = PD.MappedStatic(
    'x',
    {
      x: PD.Numeric(0, { min: 0, max: dim[0] - 1, step: 1 }, { immediateUpdate: true }),
      y: PD.Numeric(0, { min: 0, max: dim[1] - 1, step: 1 }, { immediateUpdate: true }),
      z: PD.Numeric(0, { min: 0, max: dim[2] - 1, step: 1 }, { immediateUpdate: true }),
      relativeX: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
      relativeY: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
      relativeZ: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { immediateUpdate: true }),
    },
    { isEssential: true, hideIf: (p) => p.mode !== 'grid' },
  );
  p.isoValue = Volume.createIsoValueParam(Volume.IsoValue.absolute(volume.grid.stats.min), volume.grid.stats);
  return p;
}

export async function createImage(
  ctx: VisualContext,
  volume: Volume,
  key: number,
  theme: Theme,
  props: SliceProps,
  image?: Image,
): Promise<Image> {
  if (props.mode === 'grid') {
    const domain = getSliceWindowDomain(volume, theme);
    const axis = getSliceAxis(props);
    const windowed = getSliceWindowVolume(volume);
    if (domain && windowed && SliceWindow.isSupported(ctx.graphics, windowed.grid, axis)) {
      return createGridWindowImage(ctx.graphics!, windowed, props, axis, domain, image);
    }
  }
  if (image) releaseSliceWindow(image);
  const periodicRange = Volume.getPeriodicRange(volume);
  if (periodicRange) {
    const { min, max } = periodicRange;
    volume = createPeriodicVolume(volume, min, max);
  }
  switch (props.mode) {
    case 'frame':
      return createFrameImage(ctx, volume, key, theme, props, image);
    case 'grid':
      return createGridImage(ctx, volume, key, theme, props, image);
    case 'plane':
      return createPlaneImage(ctx, volume, key, theme, props, image);
    default:
      assertUnreachable(props.mode);
  }
}

// A grid slice from a window of its planes on the GPU (slice-window.ts): moving the slice within the window changes a
// uniform, the window following it a plane at a time; colored in the shader where the theme's color depends on the
// value alone (uniform, volume-value). Else (another theme, a periodic volume, no 3d textures) built on the CPU.

/**
 * The domain the values are colored over where the theme's colors depend on the value alone: the uniform color times
 * the value in the grid's range, volume-value's palette over its domain
 */
export function getSliceWindowDomain(volume: Volume, theme: Theme): [number, number] | undefined {
  const color = theme.color;
  const { min, max } = volume.grid.stats;
  if (!(max > min)) return;
  if (color.granularity === 'uniform') return [min, max];
  if (color.factory === VolumeValueColorTheme && color.palette && color.granularity === 'vertex') {
    const domain = getVolumeValueDomain(volume, color.props as Parameters<typeof getVolumeValueDomain>[1]);
    return domain[1] > domain[0] ? domain : undefined;
  }
}

/**
 * The volume a window's slice is drawn in: the volume, or a periodic one's single tile (a map's unit cell, as MRC files
 * are read): its grid where the CPU path draws it (`createPeriodicVolume`), its own cells (read by strides, the tile's
 * cells are the volume's); undefined for a periodic volume of several tiles (its cells by instance: the CPU path)
 */
function getSliceWindowVolume(volume: Volume): Volume | undefined {
  const range = Volume.getPeriodicRange(volume);
  if (!range) return volume;
  const { min, max } = range;
  if (volume.instances.length !== 1 || max[0] - min[0] !== 1 || max[1] - min[1] !== 1 || max[2] - min[2] !== 1) return;
  // made once per volume: a step of the slice reads it
  let tile = tileVolumes.get(volume);
  if (!tile) {
    const t = createPeriodicVolume(volume, min, max);
    tile = { ...t, grid: { ...t.grid, periodicity: undefined, cells: volume.grid.cells } } as Volume;
    tileVolumes.set(volume, tile);
  }
  return tile;
}
const tileVolumes = new WeakMap<Volume, Volume>();

function getSliceAxis(props: SliceProps): SliceAxis {
  const name = props.dimension.name;
  return name === 'x' || name === 'relativeX' ? 0 : name === 'y' || name === 'relativeY' ? 1 : 2;
}

/** The grid slice's position: its index along its axis, the quad's corners */
function getGridSlicePlacement(volume: Volume, props: SliceProps, corners: Float32Array) {
  const info = getSliceInfo(volume.grid, props);
  const { x, y, z } = info;
  const dim = props.dimension.name;
  const axis = getSliceAxis(props);
  corners.set(
    axis === 0
      ? [x, 0, 0, x, y, 0, x, 0, z, x, y, z]
      : axis === 1
        ? [0, y, 0, x, y, 0, 0, y, z, x, y, z]
        : [0, 0, z, 0, y, z, x, 0, z, x, y, z],
  );
  transformPositionArray(Grid.getGridToCartesianTransform(volume.grid), corners, 0, 4);
  const index = axis === 0 ? info.x0 : axis === 1 ? info.y0 : info.z0;
  return { info, index, dim };
}

type SliceWindowState = {
  window: SliceWindow;
  /** the slice drawn, read by the mapping (picking, marking) */
  info: ReturnType<typeof getSliceInfo>;
};

/** The window's of `image`, if drawn from one */
function getSliceWindowState(image: Image) {
  return image.meta.sliceWindow as SliceWindowState | undefined;
}

/** Drawn on the CPU again: the window freed */
function releaseSliceWindow(image: Image) {
  const state = getSliceWindowState(image);
  if (!state) return;
  SliceWindow.destroy(state.window);
  image.meta.sliceWindow = undefined;
  Image.setSliceWindow(image, undefined);
}

/**
 * The mapping of a window's image: each pixel a cell of the slice drawn (`state.info`), the cells computed on first
 * read after a move (a pick, a mark), not on every step
 */
function sliceWindowMapping(space: Tensor.Space, state: SliceWindowState, isPeriodic: boolean): SampledImageMapping {
  const { width, height } = state.window;
  const count = width * height;
  // a periodic volume's single tile: its instance 0, the index by instance and cell (`eachSlice`)
  const instance = new Int16Array(count).fill(isPeriodic ? 0 : -1);
  const index = gridSliceIndex(space, () => state.info);
  const pair: [number, number] = [0, 0];
  let cell: Uint32Array | undefined;
  let cellInfo: SliceWindowState['info'] | undefined;
  return {
    instance,
    get cell() {
      if (!cell || cellInfo !== state.info) {
        cell ??= new Uint32Array(count);
        cellInfo = state.info;
        const { x0, y0, z0, nx, ny, nz } = cellInfo;
        let i = 0;
        for (let iy = y0; iy < ny; ++iy) {
          for (let ix = x0; ix < nx; ++ix) {
            for (let iz = z0; iz < nz; ++iz) cell[i++] = space.dataOffset(ix, iy, iz);
          }
        }
      }
      return cell;
    },
    index: isPeriodic
      ? {
          get(key: number) {
            if (!Number.isInteger(key) || key < 0) return;
            const [i, cell] = invertCantorPairing(pair, key);
            return i === 0 ? index.get(cell) : undefined;
          },
        }
      : index,
  };
}

/** The pixels' groups (each its index, as `createGridImage` packs them): the same for every slice of an axis */
function createGroupTexture(width: number, height: number) {
  const array = new Uint8Array(width * height * 4);
  for (let i = 0, il = width * height; i < il; ++i) packIntToRGBArray(i, array, i * 4);
  return { width, height, array, flipY: true };
}

const NoImage = { width: 1, height: 1, array: new Uint8Array(4) };
const NoValues = { width: 1, height: 1, array: new Float32Array(1) };

function getIsoLevel(volume: Volume, isoValue: Volume.IsoValue) {
  const { stats } = volume.grid;
  return clamp(normalize(Volume.IsoValue.toAbsolute(isoValue, stats).absoluteValue, stats.min, stats.max), 0, 1);
}

function createGridWindowImage(
  graphics: GraphicsContext,
  volume: Volume,
  props: SliceProps,
  axis: SliceAxis,
  domain: [number, number],
  image?: Image,
): Image {
  const { grid } = volume;
  let state = image && getSliceWindowState(image);
  if (state && !SliceWindow.matches(state.window, graphics, grid, axis)) {
    releaseSliceWindow(image!);
    state = undefined;
  }
  const window = state?.window ?? SliceWindow.create(graphics, grid, axis);
  const { width, height } = window;

  const corners = new Float32Array(12);
  const { info, index } = getGridSlicePlacement(volume, props, corners);
  const layer = SliceWindow.show(window, index);

  // the groups of an image of this size kept: the same for every slice of the window
  const groupTexture = state && image ? image.groupTexture.ref.value : createGroupTexture(width, height);
  const im = Image.create(
    NoImage,
    corners,
    groupTexture,
    NoValues,
    Image.createEmptyTrim(),
    getIsoLevel(volume, props.isoValue),
    image,
  );
  const range: [number, number] = [grid.stats.min, grid.stats.max];
  Image.setSliceWindow(im, { texture: window.texture, width, height, layer, range, domain });
  im.setBoundingSphere(Grid.getBoundingSphere(grid));
  if (state) {
    state.info = info;
  } else {
    const fresh: SliceWindowState = { window, info };
    im.meta.sliceWindow = fresh;
    im.meta.mapping = sliceWindowMapping(grid.cells.space, fresh, !!volume.parent && Volume.isPeriodic(volume.parent));
  }
  return im;
}

/**
 * Moves a window's slice in place (`VolumeVisualBuilder.updateGeometry`): another index along the same axis, an iso
 * level, a theme whose colors still depend on the value alone (another domain: a uniform); false where the image is
 * to be made again (`createImage`)
 */
function updateGridWindowImage(
  image: Image,
  volume: Volume,
  currentVolume: Volume,
  props: SliceProps,
  currentProps: SliceProps,
  theme: Theme,
  graphics: GraphicsContext | undefined,
) {
  const state = getSliceWindowState(image);
  if (!state || !graphics || props.mode !== 'grid' || currentProps.mode !== 'grid') return false;
  if (props.dimension.name !== currentProps.dimension.name) return false;
  if (!Volume.areEquivalent(volume, currentVolume) || !Volume.areInstanceTransformsEqual(volume, currentVolume)) {
    return false;
  }
  const domain = getSliceWindowDomain(volume, theme);
  const windowed = getSliceWindowVolume(volume);
  if (!domain || !windowed) return false;
  volume = windowed;
  const axis = getSliceAxis(props);
  if (!SliceWindow.matches(state.window, graphics, volume.grid, axis)) return false;

  const corners = image.cornerBuffer.ref.value;
  const { info, index } = getGridSlicePlacement(volume, props, corners);
  ValueCell.update(image.cornerBuffer, corners);
  state.info = info;
  const { window } = state;
  const range: [number, number] = [volume.grid.stats.min, volume.grid.stats.max];
  ValueCell.updateIfChanged(image.isoLevel, getIsoLevel(volume, props.isoValue));
  Image.setSliceWindow(image, {
    texture: window.texture,
    width: window.width,
    height: window.height,
    layer: SliceWindow.show(window, index),
    range,
    domain,
  });
  image.setBoundingSphere(Grid.getBoundingSphere(volume.grid));
  return true;
}

//

function getFrame(volume: Volume, props: SliceProps) {
  const { axis, rotation, mode } = props;

  const gridToCartn = Grid.getGridToCartesianTransform(volume.grid);
  const cartnToGrid = Mat4.invert(Mat4(), gridToCartn);
  const [nx, ny, nz] = volume.grid.cells.space.dimensions;

  const a = nx;
  const b = ny;
  const c = nz;

  const dirA = Vec3.create(a, 0, 0);
  const dirB = Vec3.create(0, b, 0);
  const dirC = Vec3.create(0, 0, c);

  const resolution = Math.max(a, b, c) / Math.max(nx, ny, nz);

  const min = Vec3.create(0, 0, 0);
  const max = Vec3.create(a, b, c);
  Vec3.transformMat4(min, min, gridToCartn);
  Vec3.transformMat4(max, max, gridToCartn);
  const center = Vec3.center(Vec3(), max, min);

  const size = Vec3();
  const major = Vec3();
  const minor = Vec3();
  const normal = Vec3();

  if (axis === 'c') {
    Vec3.set(size, a, b, c);
    Vec3.copy(major, dirA);
    Vec3.copy(minor, dirB);
    Vec3.copy(normal, dirC);
  } else if (axis === 'b') {
    Vec3.set(size, a, c, b);
    Vec3.copy(major, dirA);
    Vec3.copy(normal, dirB);
    Vec3.copy(minor, dirC);
  } else {
    Vec3.set(size, b, c, a);
    Vec3.copy(normal, dirA);
    Vec3.copy(major, dirB);
    Vec3.copy(minor, dirC);
  }

  if (rotation.angle !== 0) {
    const ra = Vec3();
    Vec3.scaleAndAdd(ra, ra, dirA, rotation.axis[0]);
    Vec3.scaleAndAdd(ra, ra, dirB, rotation.axis[1]);
    Vec3.scaleAndAdd(ra, ra, dirC, rotation.axis[2]);
    Vec3.normalize(ra, ra);

    const rm = Mat4.fromRotation(Mat4(), degToRad(rotation.angle), ra);
    Vec3.transformDirection(major, major, rm);
    Vec3.transformDirection(minor, minor, rm);
    Vec3.transformDirection(normal, normal, rm);
  }

  if (mode === 'frame') {
    const r = Vec3.distance(min, max);
    const s = Vec3.distance(min, max);
    Vec3.set(size, s, s, r);
  }

  Vec3.transformDirection(major, major, gridToCartn);
  Vec3.transformDirection(minor, minor, gridToCartn);
  Vec3.transformDirection(normal, normal, gridToCartn);

  const trim: Image.Trim = {
    type: 3,
    center: Vec3.create(a / 2, b / 2, c / 2),
    scale: Vec3.create(a, b, c),
    rotation: Quat.identity(),
    transform: cartnToGrid,
  };

  return { size, major, minor, normal, center, trim, resolution };
}

export type SamplingInfo = {
  m: Mat4;
  width: number;
  height: number;
};

/** The pixels showing a cell; the key is the cell, or `cantorPairing(instance, cell)` for a periodic volume */
type SampledImageIndex = { get(key: number): number[] | undefined };

type SampledImageMapping = {
  instance: Int16Array;
  cell: Uint32Array;
  /** Only read to mark loci (`eachSlice`): computed, or made on its first lookup, never with each image */
  index: SampledImageIndex;
};

/** The index made on its first lookup: each pixel that maps a cell (`mapped`, every pixel if not given), in order */
function lazySampledImageIndex(
  instance: Int16Array,
  cell: Uint32Array,
  mapped: Uint8Array | undefined,
  isPeriodic: boolean,
): SampledImageIndex {
  let map: Map<number, number[]> | undefined;
  return {
    get(key: number) {
      if (!map) {
        map = new Map();
        for (let i = 0, il = cell.length; i < il; ++i) {
          if (mapped && !mapped[i]) continue;
          const k = isPeriodic ? cantorPairing(instance[i], cell[i]) : cell[i];
          const pixels = map.get(k);
          if (pixels) pixels.push(i);
          else map.set(k, [i]);
        }
        mapped = undefined;
      }
      return map.get(key);
    },
  };
}

/**
 * A non-periodic grid slice's index, computed: each of its pixels shows its own cell, so the pixel of a cell on the
 * slice follows from the cell's coordinates and the build's order (y, then x, then z fastest). Needs a space whose
 * `getCoords` inverts `dataOffset` (one with strides)
 */
function gridSliceIndex(space: Tensor.Space, getInfo: () => ReturnType<typeof getSliceInfo>): SampledImageIndex {
  const [mx, my, mz] = space.dimensions;
  const cellCount = mx * my * mz;
  const coords = [0, 0, 0];
  return {
    get(cell: number) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount) return;
      const { x0, y0, z0, nx, ny, nz } = getInfo();
      const [ix, iy, iz] = space.getCoords(cell, coords);
      if (ix < x0 || ix >= nx || iy < y0 || iy >= ny || iz < z0 || iz >= nz) return;
      return [((iy - y0) * (nx - x0) + (ix - x0)) * (nz - z0) + (iz - z0)];
    },
  };
}

/** A slice sampled along a plane (`info.m` maps the unit square to it); exported for tests */
export function getSampledImage(
  volume: Volume,
  theme: Theme,
  info: SamplingInfo,
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

  const instance = new Int16Array(width * height);
  const cell = new Uint32Array(width * height);
  const mapped = new Uint8Array(width * height);

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
            instance[i] = pm.instance;
            cell[i] = pm.cell;
            mapped[i] = 1;
          } else {
            imageArray[i4] = 0;
            imageArray[i4 + 1] = 0;
            imageArray[i4 + 2] = 0;
            imageArray[i4 + 3] = 0;
            valueArray[i] = NaN;
          }
        } else {
          instance[i] = -1;
          cell[i] = space.dataOffset(ix, iy, iz);
          mapped[i] = 1;
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
  const mapping: SampledImageMapping = {
    instance,
    cell,
    index: lazySampledImageIndex(instance, cell, mapped, !!periodicMapping),
  };
  im.meta.mapping = mapping;

  return im;
}

async function createFrameImage(
  ctx: VisualContext,
  volume: Volume,
  key: number,
  theme: Theme,
  props: SliceProps,
  image?: Image,
): Promise<Image> {
  const { offset, isoValue } = props;

  const { size, major, minor, normal, center, trim, resolution } = getFrame(volume, props);
  const scaleFactor = 1 / resolution;

  const scale = Vec3.create(size[0], size[1], 1);
  const offsetDir = Vec3.setMagnitude(Vec3(), normal, size[2] / 2);

  const width = Math.floor(size[1] * scaleFactor);
  const height = Math.floor(size[0] * scaleFactor);

  const m = Mat4.identity();
  const v = Vec3();
  const anchor = Vec3();

  Vec3.add(v, center, major);
  Mat4.targetTo(m, center, v, minor);
  Vec3.scaleAndAdd(anchor, center, offsetDir, offset);
  Mat4.setTranslation(m, anchor);
  Mat4.mul(m, m, Mat4.rotY90);
  Mat4.scale(m, m, scale);

  const info = { m, width, height };

  return getSampledImage(volume, theme, info, isoValue, trim, image);
}

async function createPlaneImage(
  ctx: VisualContext,
  volume: Volume,
  key: number,
  theme: Theme,
  props: SliceProps,
  image?: Image,
): Promise<Image> {
  const {
    plane: { point, normal },
    isoValue,
  } = props;

  const nn = Vec3.normalize(Vec3(), normal);
  const gridToCartn = Grid.getGridToCartesianTransform(volume.grid);
  const cartnToGrid = Mat4.invert(Mat4(), gridToCartn);
  const [mx, my, mz] = volume.grid.cells.space.dimensions;

  const a = mx;
  const b = my;
  const c = mz;

  const resolution = Math.max(a, b, c) / Math.max(mx, my, mz);
  const scaleFactor = 1 / resolution;

  // a pixel a voxel along the grid's diagonal, the image as wide as the volume (in Å): any plane's cut fits in it
  const s = Vec3.distance(Vec3.create(0, 0, 0), Vec3.create(a, b, c));
  const extent = 2 * Grid.getBoundingSphere(volume.grid).radius;

  // Get center on plane
  const center = Vec3.create(a / 2, b / 2, c / 2);
  Vec3.transformMat4(center, center, gridToCartn);
  const toCenter = Vec3.sub(Vec3(), center, point);
  const distToPlane = Vec3.dot(toCenter, nn);
  const centerOnPlane = Vec3.scaleAndAdd(Vec3(), center, nn, -distToPlane);

  // Center image on volume (within plane)
  const m = Mat4.fromPlane(Mat4(), nn, centerOnPlane);

  const size = Vec3.set(Vec3(), extent, extent, extent);
  Mat4.scale(m, m, size);

  const width = Math.floor(s * scaleFactor);
  const height = Math.floor(s * scaleFactor);

  const trim: Image.Trim = {
    type: 3,
    center: Vec3.create(a / 2, b / 2, c / 2),
    scale: Vec3.create(a, b, c),
    rotation: Quat.identity(),
    transform: cartnToGrid,
  };

  const info: SamplingInfo = { m, width, height };

  return getSampledImage(volume, theme, info, isoValue, trim, image);
}

async function createGridImage(
  ctx: VisualContext,
  volume: Volume,
  key: number,
  theme: Theme,
  props: SliceProps,
  image?: Image,
): Promise<Image> {
  const {
    dimension: { name: dim },
    isoValue,
  } = props;

  const {
    cells: { space, data },
    stats,
  } = volume.grid;
  const { min, max } = stats;

  const isUniform = theme.color.granularity === 'uniform';
  const color = 'color' in theme.color && theme.color.color ? theme.color.color : () => Color(0xffffff);

  const sliceInfo = getSliceInfo(volume.grid, props);
  const { width, height, x, y, z, x0, y0, z0, nx, ny, nz } = sliceInfo;

  const corners = new Float32Array(
    dim === 'x' || dim === 'relativeX'
      ? [x, 0, 0, x, y, 0, x, 0, z, x, y, z]
      : dim === 'y' || dim === 'relativeY'
        ? [0, y, 0, x, y, 0, 0, y, z, x, y, z]
        : [0, 0, z, 0, y, z, x, 0, z, x, y, z],
  );

  const imageArray = new Uint8Array(width * height * 4);
  const groupArray = new Uint8Array(width * height * 4);
  const valueArray = new Float32Array(width * height);

  const instance = new Int16Array(width * height);
  const cell = new Uint32Array(width * height);

  const gridToCartn = Grid.getGridToCartesianTransform(volume.grid);
  const l = PositionLocation(Vec3(), Vec3());

  const periodicMapping = Volume.getPeriodicMapping(volume);
  const mapped = periodicMapping ? new Uint8Array(width * height) : undefined;

  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15] = gridToCartn;
  const isAffine = m3 === 0 && m7 === 0 && m11 === 0 && m15 === 1;

  // a uniform theme's color is the same at every position: taken once, and no pixel's position computed
  const uniformColor = isUniform ? color(l, false) : Color(0);

  let i = 0;
  for (let iy = y0; iy < ny; ++iy) {
    for (let ix = x0; ix < nx; ++ix) {
      for (let iz = z0; iz < nz; ++iz) {
        const i4 = i * 4;

        if (isUniform) {
          Color.toArray(uniformColor, imageArray, i4);
        } else {
          const p = l.position;
          if (isAffine) {
            // `Vec3.transformMat4` inlined, its sums in its order (`w` is 1): the same position to the bit
            p[0] = m0 * ix + m4 * iy + m8 * iz + m12;
            p[1] = m1 * ix + m5 * iy + m9 * iz + m13;
            p[2] = m2 * ix + m6 * iy + m10 * iz + m14;
          } else {
            Vec3.set(p, ix, iy, iz);
            Vec3.transformMat4(p, p, gridToCartn);
          }
          Color.toArray(color(l, false), imageArray, i4);
        }

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
            instance[i] = pm.instance;
            cell[i] = pm.cell;
            mapped![i] = 1;
          } else {
            imageArray[i4] = 0;
            imageArray[i4 + 1] = 0;
            imageArray[i4 + 2] = 0;
            imageArray[i4 + 3] = 0;
            valueArray[i] = NaN;
          }
        } else {
          instance[i] = -1;
          cell[i] = space.dataOffset(ix, iy, iz);
        }

        i += 1;
      }
    }
  }

  const imageTexture = { width, height, array: imageArray, flipY: true };
  const groupTexture = { width, height, array: groupArray, flipY: true };
  const valueTexture = { width, height, array: valueArray, flipY: true };

  const transform = Grid.getGridToCartesianTransform(volume.grid);
  transformPositionArray(transform, corners, 0, 4);

  const trim = Image.createEmptyTrim();
  const isoLevel = clamp(normalize(Volume.IsoValue.toAbsolute(isoValue, stats).absoluteValue, min, max), 0, 1);

  const im = Image.create(imageTexture, corners, groupTexture, valueTexture, trim, isoLevel, image);
  im.setBoundingSphere(
    Volume.isPeriodic(volume)
      ? Volume.getBoundingSphere(volume, Interval.ofLength(volume.instances.length as Volume.InstanceIndex))
      : Grid.getBoundingSphere(volume.grid),
  );
  // periodic (cells by instance) or a space without strides: the index is made on its first lookup
  const mapping: SampledImageMapping = {
    instance,
    cell,
    index:
      periodicMapping || !Tensor.strides(space)
        ? lazySampledImageIndex(instance, cell, mapped, !!periodicMapping)
        : gridSliceIndex(space, () => sliceInfo),
  };
  im.meta.mapping = mapping;

  return im;
}

//

function getRelativeIndex(dim: number, index: number) {
  return clamp(Math.round((dim - 1) * index), 0, dim - 1);
}

function getSliceInfo(grid: Grid, props: SliceProps) {
  const {
    dimension: { name: dim, params: index },
  } = props;
  const { space } = grid.cells;

  let width, height;
  let x, y, z;
  let x0 = 0,
    y0 = 0,
    z0 = 0;
  let [nx, ny, nz] = space.dimensions;

  if (dim === 'x') {
    (x = index), (y = ny), (z = nz);
    (width = nz), (height = ny);
    (x0 = x), (nx = x0 + 1);
  } else if (dim === 'y') {
    (x = nx), (y = index), (z = nz);
    (width = nz), (height = nx);
    (y0 = y), (ny = y0 + 1);
  } else if (dim === 'z') {
    (x = nx), (y = ny), (z = index);
    (width = nx), (height = ny);
    (z0 = z), (nz = z0 + 1);
  } else if (dim === 'relativeX') {
    x = getRelativeIndex(nx, index);
    y = ny;
    z = nz;
    (width = nz), (height = ny);
    (x0 = x), (nx = x0 + 1);
  } else if (dim === 'relativeY') {
    x = nx;
    y = getRelativeIndex(ny, index);
    z = nz;
    (width = nz), (height = nx);
    (y0 = y), (ny = y0 + 1);
  } /* if (dim === 'relativeZ') */ else {
    x = nx;
    y = ny;
    z = getRelativeIndex(nz, index);
    (width = nx), (height = ny);
    (z0 = z), (nz = z0 + 1);
  }
  return {
    width,
    height,
    x,
    y,
    z,
    x0,
    y0,
    z0,
    nx,
    ny,
    nz,
  };
}

function getObjectLoci(volume: Volume, instances: OrderedSet<Volume.InstanceIndex>, props: SliceProps) {
  // TODO: get exact groups
  return Volume.Loci(volume, instances);
}

function getLoci(volume: Volume, props: SliceProps) {
  const instances = Interval.ofLength(volume.instances.length as Volume.InstanceIndex);
  return getObjectLoci(volume, instances, props);
}

function getSliceLoci(pickingId: PickingId, volume: Volume, _key: number, props: SliceProps, id: number, image: Image) {
  let { objectId, groupId, instanceId } = pickingId;
  if (id === objectId) {
    const mapping = image.meta.mapping as SampledImageMapping;
    if (mapping) {
      const instanceIndex = mapping.instance[groupId];
      if (instanceIndex >= 0) instanceId = instanceIndex;
      groupId = mapping.cell[groupId];
    }

    const granularity = Volume.PickingGranularity.get(volume);
    const instances = OrderedSet.ofSingleton(instanceId as Volume.InstanceIndex);
    if (granularity === 'volume') {
      return Volume.Loci(volume, instances);
    }
    if (granularity === 'object' || groupId === PickingId.Null) {
      return getObjectLoci(volume, instances, props);
    } else {
      const indices = Interval.ofSingleton(groupId as Volume.CellIndex);
      return Volume.Cell.Loci(volume, [{ indices, instances }]);
    }
  }
  return EmptyLoci;
}

export function applySliceObjectLoci(
  loci: Volume.Loci,
  volume: Volume,
  groupCount: number,
  apply: (interval: Interval) => boolean,
) {
  if (Volume.isLociEmpty(loci) || !Volume.areEquivalent(loci.volume, volume)) return false;

  if (Volume.isPeriodic(volume)) {
    return apply(Interval.ofBounds(0, groupCount));
  }

  let changed = false;
  if (Interval.is(loci.instances)) {
    const start = Interval.start(loci.instances) * groupCount;
    const end = Interval.end(loci.instances) * groupCount;
    if (apply(Interval.ofBounds(start, end))) changed = true;
  } else {
    OrderedSet.forEach(loci.instances, (instanceIndex) => {
      const offset = instanceIndex * groupCount;
      if (apply(Interval.ofBounds(offset, offset + groupCount))) changed = true;
    });
  }
  return changed;
}

export function applySliceGroupIntervals(
  indices: number[] | undefined,
  offset: number,
  apply: (interval: Interval) => boolean,
) {
  if (!indices || indices.length === 0) return false;

  let changed = false;
  let start = indices[0] + offset;
  let prev = start;

  for (let i = 1, il = indices.length; i < il; ++i) {
    const value = indices[i] + offset;
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    if (apply(Interval.ofBounds(start, prev + 1))) changed = true;
    start = value;
    prev = value;
  }

  if (apply(Interval.ofBounds(start, prev + 1))) changed = true;
  return changed;
}

function eachSlice(
  loci: Loci,
  volume: Volume,
  key: number,
  props: SliceProps,
  apply: (interval: Interval) => boolean,
  image: Image,
) {
  const mapping = image.meta.mapping as SampledImageMapping;
  if (mapping) {
    const groupCount = mapping.cell.length;
    const cellCount = volume.grid.cells.data.length;
    const isPeriodic = Volume.isPeriodic(volume);

    if (Volume.isLoci(loci)) {
      return applySliceObjectLoci(loci, volume, groupCount, apply);
    }

    return eachVolumeLoci(loci, volume, undefined, (interval) => {
      let changed = false;
      for (let i = Interval.start(interval), il = Interval.end(interval); i < il; ++i) {
        const instanceIndex = Math.floor(i / cellCount);
        const groupIndex = i % cellCount;
        if (isPeriodic) {
          if (applySliceGroupIntervals(mapping.index.get(cantorPairing(instanceIndex, groupIndex)), 0, apply)) {
            changed = true;
          }
        } else {
          const offset = instanceIndex * groupCount;
          if (applySliceGroupIntervals(mapping.index.get(groupIndex), offset, apply)) {
            changed = true;
          }
        }
      }
      return changed;
    });
  } else {
    return eachVolumeLoci(loci, volume, undefined, apply);
  }
}

//

export function SliceVisual(materialId: number): VolumeVisual<SliceParams> {
  return VolumeVisual<Image, SliceParams>(
    {
      defaultProps: PD.getDefaultValues(SliceParams),
      createGeometry: createImage,
      createLocationIterator: createVolumeSliceCellLocationIterator,
      getLoci: getSliceLoci,
      eachLocation: eachSlice,
      setUpdateState: (
        state: VisualUpdateState,
        newVolume: Volume,
        currentVolume: Volume,
        newProps: SliceProps,
        currentProps: SliceProps,
        newTheme: Theme,
        currentTheme: Theme,
      ) => {
        state.createGeometry =
          newProps.dimension.name !== currentProps.dimension.name ||
          newProps.dimension.params !== currentProps.dimension.params ||
          newProps.mode !== currentProps.mode ||
          !Vec3.equals(newProps.rotation.axis, currentProps.rotation.axis) ||
          newProps.rotation.angle !== currentProps.rotation.angle ||
          newProps.offset !== currentProps.offset ||
          newProps.axis !== currentProps.axis ||
          !Vec3.equals(newProps.plane.point, currentProps.plane.point) ||
          !Vec3.equals(newProps.plane.normal, currentProps.plane.normal) ||
          !Volume.IsoValue.areSame(newProps.isoValue, currentProps.isoValue, newVolume.grid.stats) ||
          !ColorTheme.areEqual(newTheme.color, currentTheme.color) ||
          !Volume.areInstanceTransformsEqual(newVolume, currentVolume);
      },
      updateGeometry: updateGridWindowImage,
      geometryUtils: Image.Utils,
      dispose: (image: Image | undefined) => {
        const state = image && getSliceWindowState(image);
        if (state) SliceWindow.destroy(state.window);
      },
    },
    materialId,
  );
}

export function SliceRepresentation(
  ctx: RepresentationContext,
  getParams: RepresentationParamsGetter<Volume, SliceParams>,
): VolumeRepresentation<SliceParams> {
  return VolumeRepresentation('Slice', ctx, getParams, SliceVisual, getLoci);
}

export const SliceRepresentationProvider = VolumeRepresentationProvider({
  name: 'slice',
  label: 'Slice',
  description: 'Slice of volume rendered as image with interpolation.',
  factory: SliceRepresentation,
  getParams: getSliceParams,
  defaultValues: PD.getDefaultValues(SliceParams),
  defaultColorTheme: { name: 'uniform' },
  defaultSizeTheme: { name: 'uniform' },
  isApplicable: (volume: Volume) => !Volume.isEmpty(volume) && !Volume.Segmentation.get(volume),
});
