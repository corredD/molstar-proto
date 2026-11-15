/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A grid slice drawn from a window of its planes on the GPU (a ring of `SliceWindowDepth` layers of a 3d texture): the
// slice moves by a uniform (the layer drawn) while it stays in the window, the window follows it plane by plane near its
// edges, a plane copied each. The planes hold the raw values (32-bit floats: no conversion, a z plane of an x-fastest
// grid is a view of the data; the shader colors them by the theme's domain, so a contrast change is a uniform too).

import { Tensor } from '@molstar/core/math/linear-algebra/tensor';
import { Task } from '@molstar/core/task';
import { binGrid } from '@molstar/model/model/volume/bin';
import type { Grid } from '@molstar/model/model/volume';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { Texture } from '@molstar/graphics/gl/texture';

/**
 * `enabled` off: every grid slice is built on the CPU, as before (the rendered tests compare the two paths).
 * `coarseVoxels`: a volume of at least this many voxels (2^28: 1 GiB of floats) is binned 2× in the background, and a
 * slice moved out of its window shows the binned planes until it rests `settleMs` (their window freed `coarseHoldMs` later)
 */
export const SliceWindowConfig = {
  enabled: true,
  coarseVoxels: 2 ** 28,
  settleMs: 150,
  coarseHoldMs: 5000,
  /** a tile's side at most, below the 3d texture limit (the rendered tests tile small planes) */
  maxTileSize: Infinity,
};

/** Planes held per window */
export const SliceWindowDepth = 32;

/** The indices along an axis of `count` slices a window of `depth` planes holds: `[start, start + depth)` */
export interface SliceRing {
  readonly count: number;
  readonly depth: number;
  /** the first index held, -1: none yet */
  start: number;
}

export namespace SliceRing {
  export function create(count: number, capacity = SliceWindowDepth): SliceRing {
    return { count, depth: Math.max(1, Math.min(capacity, count)), start: -1 };
  }

  export function reset(ring: SliceRing) {
    ring.start = -1;
  }

  export function has(ring: SliceRing, index: number) {
    return ring.start >= 0 && index >= ring.start && index < ring.start + ring.depth;
  }

  /** The layer holding `index` */
  export function layer(ring: SliceRing, index: number) {
    return index % ring.depth;
  }

  /**
   * Moves the window so it shows `index` in its band (a quarter of it in from each edge, where the axis lets it): the
   * indices that entered, to be written at their layers (`layer`), in order; none while `index` is in the band, all on
   * the first move or a jump farther than the window (recentered on `index`)
   */
  export function move(ring: SliceRing, index: number): number[] {
    const { count, depth } = ring;
    const last = count - depth;
    index = Math.max(0, Math.min(count - 1, index));
    const margin = depth >> 2;
    const { start } = ring;
    let next = start;
    if (start < 0) {
      next = clampStart(index - (depth >> 1), last);
    } else if (index < start + margin) {
      next = clampStart(index - margin, last);
    } else if (index >= start + depth - margin) {
      next = clampStart(index - (depth - margin - 1), last);
    }
    if (next === start) return [];
    const entered: number[] = [];
    if (start < 0 || Math.abs(next - start) >= depth) {
      next = clampStart(index - (depth >> 1), last);
      for (let i = next; i < next + depth; ++i) entered.push(i);
    } else if (next > start) {
      for (let i = start + depth; i < next + depth; ++i) entered.push(i);
    } else {
      for (let i = next; i < start; ++i) entered.push(i);
    }
    ring.start = next;
    return entered;
  }

  function clampStart(start: number, last: number) {
    return Math.max(0, Math.min(last, start));
  }
}

/** 0, 1, 2: the planes across x, y or z */
export type SliceAxis = 0 | 1 | 2;

/**
 * The planes of a grid along an axis in a window on the GPU (`SliceRing` of `SliceWindowDepth`): each plane laid out as a
 * grid slice's image is (`createGridImage` in slice.ts: rows of y, columns of z for x and y, of x for z), its rows as
 * given (the shader flips them). The plane shown is copied when shown; the others that entered the window wait for idle
 * time (`SliceWindowFillMs` at a time), nearest first: a jump far away costs a plane, not a window
 */
export interface SliceWindow {
  readonly graphics: GraphicsContext;
  readonly grid: Grid;
  readonly axis: SliceAxis;
  readonly width: number;
  readonly height: number;
  readonly ring: SliceRing;
  /** its texture; made again by the next `show` once released (`release`) */
  texture: Texture;
  /** its texture freed (a slice hidden a while): `show` makes it again */
  released: boolean;
  readonly layout: PlaneLayout;
  /** the indices in the window not copied yet */
  readonly pending: Set<number>;
  /** the index shown last, the pending ones nearest it copied first */
  shown: number;
  /** the idle fill scheduled */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** a plane gathered from the grid (where it is not a view of the data), reused */
  plane: Float32Array | undefined;
  /** planes copied so far (for tests and measurements) */
  copies: number;
  /**
   * The plane in tiles where it is wider or taller than a 3d texture may be (a tilt series' 3000² image, the limit often
   * 2048): `[tile width, tile height, tiles across, tiles down]`, each tile a layer (plane `k`'s tiles at layers
   * `k × across × down` on, row by row); `[width, height, 1, 1]` untiled
   */
  readonly tiles: readonly [number, number, number, number];
  /** a tile gathered from the plane, reused */
  tile: Float32Array | undefined;
  /** the planes that entered copied in idle time (off: only the plane shown, a plane tiled or large) */
  idle: boolean;
}

/**
 * Bytes a window takes at most (its planes of 4-byte floats): a large plane gets fewer planes (at least
 * `SliceWindowMinDepth`), a larger one the CPU path. Ludo's tomogram (512 × 720): 32 planes, 47 MB; a 3000² tilt image:
 * 3 planes
 */
export const SliceWindowBudget = 128 * 1024 * 1024;
const SliceWindowMinDepth = 1;

/** A hidden slice's window is freed after this long hidden (ms), made again when shown */
export const SliceWindowHiddenMs = 5000;

/** A plane larger than this (bytes) is not copied in idle time: one copy would outlast an idle slot (a 3000² tilt image) */
export const SliceWindowIdleMaxBytes = 16 * 1024 * 1024;

/** Time spent copying pending planes per idle callback (ms) */
export const SliceWindowFillMs = 4;

/** A plane's texel `(row, column)` at `data[row * rowStride + column * columnStride + index * planeStride]` */
type PlaneLayout = ReturnType<typeof planeLayout>;
function planeLayout(grid: Grid, axis: SliceAxis) {
  const { space } = grid.cells;
  const [sx, sy, sz] = Tensor.strides(space)!;
  const [nx, ny, nz] = space.dimensions;
  if (axis === 2) return { width: nx, height: ny, count: nz, rowStride: sy, columnStride: sx, planeStride: sz };
  if (axis === 0) return { width: nz, height: ny, count: nx, rowStride: sy, columnStride: sz, planeStride: sx };
  return { width: nz, height: nx, count: ny, rowStride: sx, columnStride: sz, planeStride: sy };
}

export namespace SliceWindow {
  /**
   * Whether `graphics` can hold a window of the grid's planes along `axis`: 3d textures (WebGL2, WebGPU) of its size,
   * a grid read by strides (a linear space: not a periodic or wrapped one)
   */
  export function isSupported(graphics: GraphicsContext | undefined, grid: Grid, axis: SliceAxis) {
    if (!SliceWindowConfig.enabled || !graphics?.capabilities.texture3d || !Tensor.strides(grid.cells.space)) {
      return false;
    }
    const { width, height, count } = planeLayout(grid, axis);
    return getWindowDepth(graphics, width, height, count) > 0;
  }

  /** The planes of a window: within the budget (`getDepth`), their tiles within the 3d texture's layers */
  function getWindowDepth(graphics: GraphicsContext, width: number, height: number, count: number) {
    const [, , across, down] = getTiles(graphics, width, height);
    const layers = Math.floor(graphics.resources.limits.max3dTextureSize / (across * down));
    return Math.min(getDepth(width * height, count), layers);
  }

  /** A plane's tiles (`SliceWindow.tiles`): as few as fit the 3d texture limit, the plane split evenly */
  export function getTiles(graphics: GraphicsContext, width: number, height: number) {
    const max = Math.min(graphics.resources.limits.max3dTextureSize, SliceWindowConfig.maxTileSize);
    const across = Math.ceil(width / max);
    const down = Math.ceil(height / max);
    return [Math.ceil(width / across), Math.ceil(height / down), across, down] as const;
  }

  /** The planes a window of planes of `texels` holds along an axis of `count`: within `SliceWindowBudget`, 0 if none */
  export function getDepth(texels: number, count: number) {
    const fit = Math.min(SliceWindowDepth, Math.floor(SliceWindowBudget / (texels * 4)));
    if (fit < Math.min(SliceWindowMinDepth, count)) return 0;
    return Math.max(1, Math.min(fit, count));
  }

  export function create(graphics: GraphicsContext, grid: Grid, axis: SliceAxis): SliceWindow {
    const layout = planeLayout(grid, axis);
    const { width, height, count } = layout;
    const ring = SliceRing.create(count, getWindowDepth(graphics, width, height, count));
    const tiles = getTiles(graphics, width, height);
    const [tw, th, across, down] = tiles;
    return {
      graphics,
      grid,
      axis,
      width,
      height,
      ring,
      texture: createTexture(graphics, tw, th, ring.depth * across * down),
      released: false,
      layout,
      pending: new Set(),
      shown: -1,
      timer: undefined,
      plane: undefined,
      copies: 0,
      tiles,
      tile: undefined,
      idle: across * down === 1 && width * height * 4 <= SliceWindowIdleMaxBytes,
    };
  }

  /** Whether `window` holds the planes of `grid`'s cells along `axis` in a texture of `graphics` */
  export function matches(window: SliceWindow, graphics: GraphicsContext, grid: Grid, axis: SliceAxis) {
    return (
      window.graphics === graphics &&
      window.grid.cells === grid.cells &&
      window.axis === axis &&
      (window.released || graphics.resources.ownsTexture(window.texture))
    );
  }

  /**
   * Moves the window to show plane `index`: that plane copied if it is not yet, the others that entered left for idle
   * time (`fill`); the layer holding it
   */
  export function show(window: SliceWindow, index: number) {
    if (window.released) {
      const [tw, th, across, down] = window.tiles;
      window.texture = createTexture(window.graphics, tw, th, window.ring.depth * across * down);
      window.released = false;
    }
    const { ring, pending } = window;
    const entered = SliceRing.move(ring, index);
    if (entered.length) {
      // the layers of the indices that left are the entered ones'
      for (const i of pending) if (!SliceRing.has(ring, i)) pending.delete(i);
      for (const i of entered) pending.add(i);
    }
    index = Math.max(0, Math.min(ring.count - 1, index));
    window.shown = index;
    if (pending.delete(index)) copyPlane(window, index);
    if (pending.size && window.idle && window.timer === undefined) window.timer = setTimeout(() => idle(window), 0);
    return SliceRing.layer(ring, index);
  }

  function idle(window: SliceWindow) {
    window.timer = undefined;
    if (!window.idle) return;
    fill(window, SliceWindowFillMs);
    if (window.pending.size) window.timer = setTimeout(() => idle(window), 0);
  }

  /** Copies pending planes, nearest the one shown first, for `budgetMs` (all of them where undefined) */
  export function fill(window: SliceWindow, budgetMs?: number) {
    const { pending } = window;
    const t0 = performance.now();
    while (pending.size) {
      let next = -1;
      for (const i of pending) {
        if (next < 0 || Math.abs(i - window.shown) < Math.abs(next - window.shown)) next = i;
      }
      pending.delete(next);
      copyPlane(window, next);
      if (budgetMs !== undefined && performance.now() - t0 >= budgetMs) break;
    }
  }

  /** The axes of a plane's columns and rows (x, y, z: 0, 1, 2), as `planeLayout` lays it out */
  export function planeAxes(axis: SliceAxis): readonly [number, number] {
    return axis === 2 ? [0, 1] : axis === 0 ? [2, 1] : [2, 0];
  }

  /** Plane `index` of the grid, in the window's layout: a view of the data where it is laid out so */
  export function getPlane(window: SliceWindow, index: number): Float32Array {
    const { width, height, rowStride, columnStride, planeStride } = window.layout;
    const data = window.grid.cells.data;
    const offset = index * planeStride;
    if (data instanceof Float32Array && columnStride === 1 && rowStride === width) {
      return data.subarray(offset, offset + width * height);
    }
    const plane = (window.plane ??= new Float32Array(width * height));
    if (rowStride < columnStride) {
      // the rows' elements nearer in memory (a y plane: x is fastest): read along them
      for (let column = 0; column < width; ++column) {
        for (let row = 0, o = offset + column * columnStride, k = column; row < height; ++row, o += rowStride) {
          plane[k] = data[o];
          k += width;
        }
      }
    } else {
      for (let row = 0, k = 0; row < height; ++row) {
        for (let column = 0, o = offset + row * rowStride; column < width; ++column, o += columnStride, ++k) {
          plane[k] = data[o];
        }
      }
    }
    return plane;
  }

  function copyPlane(window: SliceWindow, index: number) {
    const { width, height, tiles } = window;
    const [tw, th, across, down] = tiles;
    const plane = getPlane(window, index);
    const layer = SliceRing.layer(window.ring, index);
    if (across * down === 1) {
      window.texture.loadLayer!({ array: plane, width, height }, layer);
    } else {
      // each tile gathered (its part past the plane's edge left as it was: never read)
      const tile = (window.tile ??= new Float32Array(tw * th));
      for (let ty = 0; ty < down; ++ty) {
        for (let tx = 0; tx < across; ++tx) {
          const x0 = tx * tw;
          const y0 = ty * th;
          const w = Math.min(tw, width - x0);
          const h = Math.min(th, height - y0);
          for (let row = 0; row < h; ++row) {
            const from = (y0 + row) * width + x0;
            tile.set(plane.subarray(from, from + w), row * tw);
          }
          window.texture.loadLayer!({ array: tile, width: tw, height: th }, (layer * down + ty) * across + tx);
        }
      }
    }
    window.copies += 1;
  }

  /** Whether plane `index` is in the window's texture (copied, not pending) */
  export function holds(window: SliceWindow, index: number) {
    return !window.released && SliceRing.has(window.ring, index) && !window.pending.has(index);
  }

  /** Frees the texture (a slice hidden a while), the window emptied: the next `show` makes it again */
  export function release(window: SliceWindow) {
    if (window.released) return;
    clearTimeout(window.timer);
    window.timer = undefined;
    window.pending.clear();
    SliceRing.reset(window.ring);
    window.texture.destroy();
    window.released = true;
  }

  export function destroy(window: SliceWindow) {
    clearTimeout(window.timer);
    window.timer = undefined;
    window.pending.clear();
    window.texture.destroy();
  }
}

function createTexture(graphics: GraphicsContext, width: number, height: number, depth: number) {
  const texture = graphics.resources.texture('volume-float32', 'r', 'float', 'nearest');
  texture.define(width, height, depth);
  return texture;
}

type Binned = { grid?: Grid; readonly ready: Promise<Grid>; readonly factors: readonly [number, number, number] };

/** Fewer planes than this along z: z not binned (a tilt series: z is the tilt, binning would mix two angles) */
export const SliceBinnedMinDepth = 128;
const binned = new WeakMap<Tensor, Binned>();

/**
 * A grid binned 2× for the slices of a big volume (`SliceWindowConfig.coarseVoxels`): `binGrid` (each voxel the mean of
 * its 2×2×2 block, as an MRC level's 2×; z kept below `SliceBinnedMinDepth` planes), made once per grid's cells in the background (it yields every few ms), kept
 * while the cells are
 */
export namespace SliceBinned {
  export function isWanted(grid: Grid) {
    const [nx, ny, nz] = grid.cells.space.dimensions;
    return nx * ny * nz >= SliceWindowConfig.coarseVoxels;
  }

  export function get(grid: Grid): Binned {
    let b = binned.get(grid.cells);
    if (!b) {
      const nz = grid.cells.space.dimensions[2];
      const factors = [2, 2, nz < SliceBinnedMinDepth ? 1 : 2] as const;
      const entry: Binned = {
        factors,
        ready: Task.create('Binning for the slice', (ctx) => binGrid(grid, factors, ctx))
          .run(() => {}, 8)
          .then((g) => (entry.grid = g))
          // not binned (e.g. out of memory): the slice stays at full resolution
          .catch(() => undefined as unknown as Grid),
      };
      binned.set(grid.cells, (b = entry));
    }
    return b;
  }

  /** The binned grid if made (or being made) */
  export function peek(grid: Grid) {
    return binned.get(grid.cells);
  }
}
