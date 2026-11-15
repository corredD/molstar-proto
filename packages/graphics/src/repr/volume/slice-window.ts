/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A grid slice drawn from a window of its planes on the GPU (a ring of `SliceWindowDepth` layers of a 3d texture): the
// slice moves by a uniform (the layer drawn) while it stays in the window, the window follows it plane by plane near its
// edges, a plane copied each. The planes hold the raw values (32-bit floats: no conversion, a z plane of an x-fastest
// grid is a view of the data; the shader colors them by the theme's domain, so a contrast change is a uniform too).

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
