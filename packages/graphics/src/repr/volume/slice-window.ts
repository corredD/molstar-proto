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
import type { Grid } from '@molstar/model/model/volume';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { Texture } from '@molstar/graphics/gl/texture';

/** Off: every grid slice is built on the CPU, as before (the rendered tests compare the two paths) */
export const SliceWindowConfig = { enabled: true };

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
 * given (the shader flips them)
 */
export interface SliceWindow {
  readonly graphics: GraphicsContext;
  readonly grid: Grid;
  readonly axis: SliceAxis;
  readonly width: number;
  readonly height: number;
  readonly ring: SliceRing;
  readonly texture: Texture;
  /** planes copied so far (for tests and measurements) */
  copies: number;
}

/** A plane's texel `(row, column)` at `data[row * rowStride + column * columnStride + index * planeStride]` */
function planeLayout(grid: Grid, axis: SliceAxis) {
  const { space } = grid.cells;
  const [sx, sy, sz] = Tensor.strides(space)!;
  const [nx, ny, nz] = space.dimensions;
  if (axis === 2) return { width: nx, height: ny, count: nz, rowStride: sy, columnStride: sx, planeStride: sz };
  if (axis === 0) return { width: nz, height: ny, count: nx, rowStride: sy, columnStride: sz, planeStride: sx };
  return { width: nz, height: nx, count: ny, rowStride: sx, columnStride: sz, planeStride: sy };
}

const windows = new WeakMap<SliceWindow, { layout: ReturnType<typeof planeLayout>; plane?: Float32Array }>();

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
    const max = graphics.resources.limits.max3dTextureSize;
    return width <= max && height <= max && Math.min(count, SliceWindowDepth) <= max;
  }

  export function create(graphics: GraphicsContext, grid: Grid, axis: SliceAxis): SliceWindow {
    const layout = planeLayout(grid, axis);
    const { width, height, count } = layout;
    const ring = SliceRing.create(count);
    const texture = graphics.resources.texture('volume-float32', 'r', 'float', 'nearest');
    texture.define(width, height, ring.depth);
    const window: SliceWindow = { graphics, grid, axis, width, height, ring, texture, copies: 0 };
    windows.set(window, { layout });
    return window;
  }

  /** Whether `window` holds the planes of `grid`'s cells along `axis` in a texture of `graphics` */
  export function matches(window: SliceWindow, graphics: GraphicsContext, grid: Grid, axis: SliceAxis) {
    return (
      window.graphics === graphics &&
      window.grid.cells === grid.cells &&
      window.axis === axis &&
      graphics.resources.ownsTexture(window.texture)
    );
  }

  /** Moves the window to show plane `index`: the planes that entered copied; the layer holding it */
  export function show(window: SliceWindow, index: number) {
    const { ring } = window;
    for (const i of SliceRing.move(ring, index)) copyPlane(window, i);
    return SliceRing.layer(ring, index);
  }

  /** Plane `index` of the grid, in the window's layout: a view of the data where it is laid out so */
  export function getPlane(window: SliceWindow, index: number): Float32Array {
    const entry = windows.get(window)!;
    const { width, height, rowStride, columnStride, planeStride } = entry.layout;
    const data = window.grid.cells.data;
    const offset = index * planeStride;
    if (data instanceof Float32Array && columnStride === 1 && rowStride === width) {
      return data.subarray(offset, offset + width * height);
    }
    const plane = (entry.plane ??= new Float32Array(width * height));
    for (let row = 0, k = 0; row < height; ++row) {
      for (let column = 0, o = offset + row * rowStride; column < width; ++column, o += columnStride, ++k) {
        plane[k] = data[o];
      }
    }
    return plane;
  }

  function copyPlane(window: SliceWindow, index: number) {
    const { width, height } = window;
    window.texture.loadLayer!({ array: getPlane(window, index), width, height }, SliceRing.layer(window.ring, index));
    window.copies += 1;
  }

  export function destroy(window: SliceWindow) {
    window.texture.destroy();
    windows.delete(window);
  }
}
