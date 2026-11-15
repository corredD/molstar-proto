/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { TextureImage } from '@molstar/graphics/gl/renderable/util';

/**
 * Octahedral impostors (`lod-impostor.md`): per item (a particle target's structure) its spheres seen from `Views` ×
 * `Views` directions over the sphere, each a tile of coverage and front height, splatted on the CPU into one atlas. The
 * TS rule of the shaders' `lod_impostor` chunks (GLSL, WGSL): the octahedral map, the frames, the three views of a
 * direction, the entry's place.
 */
export interface ImpostorAtlas {
  /** two bytes a texel: coverage, the front's height along the view (0 at `-radius`, 255 at `radius`; 0 off the item) */
  readonly image: TextureImage<Uint8Array>;
  /** per entry its place (`encodeEntry`), -1 where it did not fit */
  readonly codes: number[];
  /** per entry the radius its views span */
  readonly radii: number[];
}

export namespace ImpostorAtlas {
  /** views per side of the octahedral grid: frames at `i / (Views - 1)`, so the edges are frames and no lookup wraps; odd, so the axes are frames */
  export const Views = 9;
  export const MinTile = 8;
  export const MaxTile = 64;
  /** the widest atlas: its places in 8-texel steps fit 9 bits a side (`encodeEntry`) */
  export const MaxWidth = 4096;
  /** subsamples per texel side of the splat (its coverage antialiased) */
  const Supersample = 2;

  /** unit direction `d` to the octahedral map's coordinates in [0, 1]² (the full sphere, z the pole) */
  export function encode(out: number[], d: Vec3) {
    const l = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
    let x = d[0] / l;
    let y = d[1] / l;
    if (d[2] < 0) {
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      x = (1 - ay) * (x >= 0 ? 1 : -1);
      y = (1 - ax) * (y >= 0 ? 1 : -1);
    }
    out[0] = x * 0.5 + 0.5;
    out[1] = y * 0.5 + 0.5;
    return out;
  }

  /** the octahedral map's coordinates `u`, `v` in [0, 1]² to a unit direction */
  export function decode(out: Vec3, u: number, v: number) {
    const x = u * 2 - 1;
    const y = v * 2 - 1;
    const z = 1 - Math.abs(x) - Math.abs(y);
    const t = Math.max(-z, 0);
    Vec3.set(out, x + (x >= 0 ? -t : t), y + (y >= 0 ? -t : t), z);
    return Vec3.normalize(out, out);
  }

  /** the direction toward the camera of frame `i`, `j` */
  export function frameDirection(out: Vec3, i: number, j: number) {
    return decode(out, i / (Views - 1), j / (Views - 1));
  }

  /**
   * The frame of a view toward `d` (from the item to the camera): `right` and `up` with `right × up = d`, from the pole
   * (z), or y where `d` is along the pole
   */
  export function frameBasis(right: Vec3, up: Vec3, d: Vec3) {
    if (Math.abs(d[2]) < 0.999) Vec3.set(up, 0, 0, 1);
    else Vec3.set(up, 0, 1, 0);
    Vec3.normalize(right, Vec3.cross(right, up, d));
    Vec3.cross(up, d, right);
    return right;
  }

  export type Views = { i: number[]; j: number[]; w: number[] };
  export function views(): Views {
    return { i: [0, 0, 0], j: [0, 0, 0], w: [0, 0, 0] };
  }

  const uv = [0, 0];
  /** The three frames nearest to direction `d` (in the item's frame, toward the camera) and their weights */
  export function getViews(out: Views, d: Vec3) {
    encode(uv, d);
    const gx = uv[0] * (Views - 1);
    const gy = uv[1] * (Views - 1);
    const i0 = Math.min(Math.floor(gx), Views - 2);
    const j0 = Math.min(Math.floor(gy), Views - 2);
    const fx = gx - i0;
    const fy = gy - j0;
    if (fx + fy <= 1) {
      set(out, 0, i0, j0, 1 - fx - fy);
      set(out, 1, i0 + 1, j0, fx);
      set(out, 2, i0, j0 + 1, fy);
    } else {
      set(out, 0, i0 + 1, j0 + 1, fx + fy - 1);
      set(out, 1, i0 + 1, j0, 1 - fy);
      set(out, 2, i0, j0 + 1, 1 - fx);
    }
    return out;
  }

  function set(out: Views, k: number, i: number, j: number, w: number) {
    out.i[k] = i;
    out.j[k] = j;
    out.w[k] = w;
  }

  /** The camera direction `d` (world) in the frame of a copy placed by `transform`: its rotation's inverse applied */
  export function localDirection(out: Vec3, transform: Mat4, d: Vec3) {
    // the transpose of the rotation (columns normalized: a uniform scale)
    const sx = Math.hypot(transform[0], transform[1], transform[2]);
    const sy = Math.hypot(transform[4], transform[5], transform[6]);
    const sz = Math.hypot(transform[8], transform[9], transform[10]);
    Vec3.set(
      out,
      (transform[0] * d[0] + transform[1] * d[1] + transform[2] * d[2]) / sx,
      (transform[4] * d[0] + transform[5] * d[1] + transform[6] * d[2]) / sy,
      (transform[8] * d[0] + transform[9] * d[1] + transform[10] * d[2]) / sz,
    );
    return Vec3.normalize(out, out);
  }

  /**
   * An entry's place as one float the shaders decode: its corner `x`, `y` (multiples of 8 below `MaxWidth`) and its tile
   * (8 to 64, a power of 2), 20 bits, exact in a 32-bit float
   */
  export function encodeEntry(x: number, y: number, tile: number) {
    return x / 8 + (y / 8) * 512 + Math.log2(tile / 8) * 262144;
  }

  export function decodeEntry(code: number) {
    const t = Math.floor(code / 262144);
    const rest = code - t * 262144;
    const y = Math.floor(rest / 512);
    return { x: (rest - y * 512) * 8, y: y * 8, tile: 8 << t };
  }

  /**
   * The tile of an item of `radius` Å: the pixels it covers where the impostors start (`pixelBoundary` Å a pixel), as a
   * power of 2 in [`MinTile`, `MaxTile`]: drawn at most at its size there, smaller farther
   */
  export function tileSize(radius: number, pixelBoundary: number) {
    const pixels = (2 * radius) / Math.max(pixelBoundary, 1e-3);
    const tile = 1 << Math.ceil(Math.log2(Math.max(pixels, 1)));
    return Math.min(MaxTile, Math.max(MinTile, tile));
  }

  export interface Item {
    /** center xyz and group per sphere (`PositionGroupStride` 4 floats) */
    readonly positionGroup: Float32Array;
    /** the drawn radius per sphere */
    readonly radii: Float32Array;
    readonly count: number;
    /** the center and radius the views span (the item's invariant bounding sphere) */
    readonly center: Vec3;
    readonly radius: number;
    readonly tile: number;
  }

  /**
   * The atlas of `items`, shelf-packed (largest first) within `maxSize` (and `MaxWidth`) a side; the tiles halved until
   * they fit, an entry that still does not fit left out (-1)
   */
  export function create(items: readonly Item[], maxSize: number): ImpostorAtlas {
    const limit = Math.min(maxSize, MaxWidth);
    let shrink = 0;
    for (;;) {
      const layout = pack(items, limit, shrink);
      if (layout || shrink >= 3) {
        const l = layout ?? pack(items, limit, shrink, true)!;
        const array = new Uint8Array(l.width * l.height * 2);
        const codes: number[] = [];
        for (let e = 0; e < items.length; ++e) {
          const p = l.places[e];
          if (!p) {
            codes.push(-1);
            continue;
          }
          splat(array, l.width, p.x, p.y, p.tile, items[e]);
          codes.push(encodeEntry(p.x, p.y, p.tile));
        }
        return { image: { array, width: l.width, height: l.height }, codes, radii: items.map((i) => i.radius) };
      }
      shrink += 1;
    }
  }

  type Place = { x: number; y: number; tile: number };

  /** shelves of blocks (`Views` tiles a side), the tiles `shrink` times halved; undefined where they don't fit */
  function pack(items: readonly Item[], limit: number, shrink: number, partial = false) {
    const tiles = items.map((i) => Math.max(MinTile, i.tile >> shrink));
    const order = items.map((_, e) => e).sort((a, b) => tiles[b] - tiles[a]);
    let area = 0;
    for (const t of tiles) area += (t * Views) ** 2;
    const widest = tiles.length ? Math.max(...tiles) * Views : 8;
    const width = Math.min(limit, Math.max(widest, 1 << Math.ceil(Math.log2(Math.sqrt(area) || 1))));
    const places: (Place | undefined)[] = new Array(items.length);
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const e of order) {
      const block = tiles[e] * Views;
      if (block > width) {
        if (!partial) return undefined;
        continue;
      }
      if (x + block > width) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      if (y + block > limit) {
        if (!partial) return undefined;
        continue;
      }
      places[e] = { x, y, tile: tiles[e] };
      x += block;
      shelf = Math.max(shelf, block);
    }
    const height = Math.max(8, Math.ceil((y + shelf) / 8) * 8);
    return { width, height, places };
  }

  const d = Vec3();
  const right = Vec3();
  const up = Vec3();

  /** The `Views` × `Views` views of `item` into its block at `x0`, `y0` of `array` (`width` texels a row) */
  function splat(array: Uint8Array, width: number, x0: number, y0: number, tile: number, item: Item) {
    const { positionGroup, radii, count, center, radius } = item;
    const n = tile * Supersample;
    const height = new Float32Array(n * n);
    const scale = n / (2 * radius);
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    for (let j = 0; j < Views; ++j) {
      for (let i = 0; i < Views; ++i) {
        frameDirection(d, i, j);
        frameBasis(right, up, d);
        height.fill(-Infinity);
        for (let k = 0; k < count; ++k) {
          const px = positionGroup[k * 4] - cx;
          const py = positionGroup[k * 4 + 1] - cy;
          const pz = positionGroup[k * 4 + 2] - cz;
          const r = radii[k];
          // in subsamples: the sphere's center and radius on the view's plane
          const sx = (px * right[0] + py * right[1] + pz * right[2]) * scale + n / 2;
          const sy = (px * up[0] + py * up[1] + pz * up[2]) * scale + n / 2;
          const sz = px * d[0] + py * d[1] + pz * d[2];
          const sr = r * scale;
          const r2 = r * r;
          const xa = Math.max(0, Math.floor(sx - sr));
          const xb = Math.min(n - 1, Math.ceil(sx + sr));
          const ya = Math.max(0, Math.floor(sy - sr));
          const yb = Math.min(n - 1, Math.ceil(sy + sr));
          for (let t = ya; t <= yb; ++t) {
            const dy = (t + 0.5 - sy) / scale;
            for (let s = xa; s <= xb; ++s) {
              const dx = (s + 0.5 - sx) / scale;
              const q = r2 - dx * dx - dy * dy;
              if (q < 0) continue;
              const h = sz + Math.sqrt(q);
              const o = t * n + s;
              if (h > height[o]) height[o] = h;
            }
          }
        }
        writeTile(array, width, x0 + i * tile, y0 + j * tile, tile, height, radius);
      }
    }
  }

  /** a tile's texels from the subsamples: the share covered, the front's height (the covered subsamples' highest) */
  function writeTile(
    array: Uint8Array,
    width: number,
    x0: number,
    y0: number,
    tile: number,
    h: Float32Array,
    R: number,
  ) {
    const n = tile * Supersample;
    const cover = new Float32Array(tile * tile);
    const front = new Float32Array(tile * tile).fill(-Infinity);
    for (let t = 0; t < tile; ++t) {
      for (let s = 0; s < tile; ++s) {
        let c = 0;
        let f = -Infinity;
        for (let b = 0; b < Supersample; ++b) {
          for (let a = 0; a < Supersample; ++a) {
            const v = h[(t * Supersample + b) * n + s * Supersample + a];
            if (v === -Infinity) continue;
            c += 1;
            if (v > f) f = v;
          }
        }
        cover[t * tile + s] = c / (Supersample * Supersample);
        front[t * tile + s] = f;
      }
    }
    for (let t = 0; t < tile; ++t) {
      for (let s = 0; s < tile; ++s) {
        let f = front[t * tile + s];
        // off the item: its covered neighbors' height, so that linear filtering at the outline reads the item's
        if (f === -Infinity) {
          for (let b = -1; b <= 1; ++b) {
            for (let a = -1; a <= 1; ++a) {
              const u = s + a;
              const v = t + b;
              if (u < 0 || v < 0 || u >= tile || v >= tile) continue;
              const g = front[v * tile + u];
              if (g > f) f = g;
            }
          }
        }
        const o = ((y0 + t) * width + x0 + s) * 2;
        array[o] = Math.round(cover[t * tile + s] * 255);
        array[o + 1] = f === -Infinity ? 0 : Math.max(1, Math.min(255, Math.round(((f + R) / (2 * R)) * 255)));
      }
    }
  }
}
