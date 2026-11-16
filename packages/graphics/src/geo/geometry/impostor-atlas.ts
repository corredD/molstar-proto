/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec2, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { ValueCell } from '@molstar/core/util/value-cell';
import { unpackRGBToInt } from '@molstar/core/util/number-packing';
import type { Sphere3D } from '@molstar/core/math/geometry';
import type { DataArray, TextureImage } from '@molstar/graphics/gl/renderable/util';
import type { LodImpostorValues } from '@molstar/graphics/gl/renderable/schema';
import { sizeDataFactor } from './size-data.js';

/**
 * Octahedral impostors (`lod-impostor.md`): per item (a particle target's structure) its spheres seen from `Views` ×
 * `Views` directions over the sphere, each a tile of coverage, front height and normal, splatted on the CPU into one atlas. The
 * TS rule of the shaders' `lod_impostor` chunks (GLSL, WGSL): the octahedral map, the frames, the three views of a
 * direction, the entry's place.
 */
export interface ImpostorAtlas {
  /**
   * four bytes a texel: coverage, the front's height along the view (0 at `-radius`, 255 at `radius`; 0 off the item),
   * the front's normal's x and y in the view's frame (`0.5 + 0.5 n`; z toward the camera)
   */
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
  /**
   * the widest atlas: its places in 8-texel steps fit 10 bits a side (`encodeEntry`); thousands of targets (a yeast slab:
   * 5,457) need more than 4096² where the device allows
   */
  export const MaxWidth = 8192;
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

  /** reads of a view at the height read before (the shaders' \`ImpostorParallaxSteps\`) */
  export const ParallaxSteps = 1;

  const hitViews = views();
  const hitD = Vec3();
  const hitRight = Vec3();
  const hitUp = Vec3();
  const hitUv = [0, 0];
  const hitSample = [0, 0];

  /**
   * The impostor's coverage and front height along a ray: the TS rule of the shaders' \`impostorHit\` (its three views,
   * their weights, the cut left to the caller). Each view is read where the ray meets its front (\`ParallaxSteps\`): first
   * at the height of the ray's point nearest the center (in the tile), then at the height read there, so that the three
   * views agree on what lies off their planes (an elongated item's views ghosted, its parts jumping as the camera turned). \`o\` the ray's origin from the item's center, \`r\` its unit direction,
   * \`w\` the unit direction toward the camera (the copy's), in the item's frame; entry \`e\` of \`atlas\` read as the
   * GPU's linear filter reads it
   */
  export function hit(atlas: ImpostorAtlas, e: number, o: Vec3, r: Vec3, w: Vec3) {
    const radius = atlas.radii[e];
    const entry = decodeEntry(atlas.codes[e]);
    getViews(hitViews, w);
    let coverage = 0;
    let height = 0;
    for (let k = 0; k < 3; ++k) {
      const i = hitViews.i[k];
      const j = hitViews.j[k];
      frameDirection(hitD, i, j);
      frameBasis(hitRight, hitUp, hitD);
      // the ray's point nearest the center: its height along the view
      const t = -Vec3.dot(o, r);
      planeAt(hitUv, o, r, radius, Vec3.dot(o, hitD) + t * Vec3.dot(r, hitD));
      read(hitSample, atlas, entry, i, j, hitUv, radius);
      for (let step = 0; step < ParallaxSteps && hitSample[0] > 0; ++step) {
        planeAt(hitUv, o, r, radius, hitSample[1]);
        read(hitSample, atlas, entry, i, j, hitUv, radius);
      }
      coverage += hitViews.w[k] * hitSample[0];
      height += hitViews.w[k] * hitSample[0] * hitSample[1];
    }
    return { coverage, height: coverage > 0 ? height / coverage : -radius };
  }

  /** where the ray meets the plane of the current frame (\`hitD\`, \`hitRight\`, \`hitUp\`) at height \`h\`, in its uv */
  function planeAt(out: number[], o: Vec3, r: Vec3, radius: number, h: number) {
    const t = (h - Vec3.dot(o, hitD)) / Vec3.dot(r, hitD);
    const px = o[0] + r[0] * t;
    const py = o[1] + r[1] * t;
    const pz = o[2] + r[2] * t;
    out[0] = (px * hitRight[0] + py * hitRight[1] + pz * hitRight[2]) / (2 * radius) + 0.5;
    out[1] = (px * hitUp[0] + py * hitUp[1] + pz * hitUp[2]) / (2 * radius) + 0.5;
    return out;
  }

  /** a frame's coverage and height at \`uv\` (the shaders' \`impostorRead\`): 0 off its tile, linear filtering within */
  function read(
    out: number[],
    atlas: ImpostorAtlas,
    entry: { x: number; y: number; tile: number },
    i: number,
    j: number,
    uv: number[],
    radius: number,
  ) {
    if (uv[0] < 0 || uv[1] < 0 || uv[0] > 1 || uv[1] > 1) {
      out[0] = 0;
      out[1] = -radius;
      return out;
    }
    const { tile } = entry;
    const u = entry.x + (i + Math.min(Math.max(uv[0], 0.5 / tile), 1 - 0.5 / tile)) * tile - 0.5;
    const v = entry.y + (j + Math.min(Math.max(uv[1], 0.5 / tile), 1 - 0.5 / tile)) * tile - 0.5;
    const { array, width, height } = atlas.image;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    let c = 0;
    let g = 0;
    for (let b = 0; b < 2; ++b) {
      for (let a = 0; a < 2; ++a) {
        const x = Math.min(width - 1, Math.max(0, x0 + a));
        const y = Math.min(height - 1, Math.max(0, y0 + b));
        const f = (a ? fx : 1 - fx) * (b ? fy : 1 - fy);
        c += f * array[(y * width + x) * 4];
        g += f * array[(y * width + x) * 4 + 1];
      }
    }
    out[0] = c / 255;
    out[1] = ((g / 255) * 2 - 1) * radius;
    return out;
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
   * (8 to 64, a power of 2), 22 bits, exact in a 32-bit float
   */
  export function encodeEntry(x: number, y: number, tile: number) {
    return x / 8 + (y / 8) * 1024 + Math.log2(tile / 8) * 1048576;
  }

  export function decodeEntry(code: number) {
    const t = Math.floor(code / 1048576);
    const rest = code - t * 1048576;
    const y = Math.floor(rest / 1024);
    return { x: (rest - y * 1024) * 8, y: y * 8, tile: 8 << t };
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
   * An item to splat where its block is not in the cache: its `key` (what its views depend on), the radius and tile it
   * asks for, the item made only where needed (`get`; undefined: left out)
   */
  export interface Source {
    readonly key: string;
    readonly radius: number;
    readonly tile: number;
    get(): Item | undefined;
  }

  /**
   * The atlas of `items`, shelf-packed (largest first) within `maxSize` (and `MaxWidth`) a side; the tiles halved until
   * they fit, an entry that still does not fit left out (-1)
   */
  export function create(items: readonly Item[], maxSize: number): ImpostorAtlas {
    return createCached(
      items.map((item, e) => ({ key: `${e}`, radius: item.radius, tile: item.tile, get: () => item })),
      maxSize,
    );
  }

  /**
   * `create` from sources, a source's block (its views at its tile) taken from `cache` by its key and tile where there,
   * splatted and kept there otherwise: a change of one item splats that item alone (`splatted`), the others copied; the
   * blocks of keys not asked for let go
   */
  export function createCached(
    sources: readonly Source[],
    maxSize: number,
    cache?: Map<string, Uint8Array>,
  ): ImpostorAtlas & { splatted: number } {
    const limit = Math.min(maxSize, MaxWidth);
    let shrink = 0;
    for (;;) {
      const layout = pack(sources, limit, shrink);
      if (layout || shrink >= 3) {
        const l = layout ?? pack(sources, limit, shrink, true)!;
        const array = new Uint8Array(l.width * l.height * 4);
        const codes: number[] = [];
        const used = new Set<string>();
        let splatted = 0;
        for (let e = 0; e < sources.length; ++e) {
          const p = l.places[e];
          const source = sources[e];
          if (!p) {
            codes.push(-1);
            continue;
          }
          const key = `${source.key}|${p.tile}`;
          let block = cache?.get(key);
          if (!block) {
            const item = source.get();
            if (!item) {
              codes.push(-1);
              continue;
            }
            const side = p.tile * Views;
            block = new Uint8Array(side * side * 4);
            splat(block, side, 0, 0, p.tile, item);
            splatted += 1;
            cache?.set(key, block);
          }
          used.add(key);
          copyBlock(array, l.width, p.x, p.y, block, p.tile * Views);
          codes.push(encodeEntry(p.x, p.y, p.tile));
        }
        if (cache) for (const k of cache.keys()) if (!used.has(k)) cache.delete(k);
        const image = { array, width: l.width, height: l.height };
        return { image, codes, radii: sources.map((i) => i.radius), splatted };
      }
      shrink += 1;
    }
  }

  function copyBlock(array: Uint8Array, width: number, x0: number, y0: number, block: Uint8Array, side: number) {
    for (let t = 0; t < side; ++t)
      array.set(block.subarray(t * side * 4, (t + 1) * side * 4), ((y0 + t) * width + x0) * 4);
  }

  type Place = { x: number; y: number; tile: number };

  /** shelves of blocks (`Views` tiles a side), the tiles `shrink` times halved; undefined where they don't fit */
  function pack(items: readonly { readonly tile: number }[], limit: number, shrink: number, partial = false) {
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
    // per subsample the front's height and its normal's x and y in the frame
    const height = new Float32Array(n * n);
    const nx = new Float32Array(n * n);
    const ny = new Float32Array(n * n);
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
              if (h > height[o]) {
                height[o] = h;
                nx[o] = dx / r;
                ny[o] = dy / r;
              }
            }
          }
        }
        writeTile(array, width, x0 + i * tile, y0 + j * tile, tile, height, nx, ny, radius);
      }
    }
  }

  /**
   * a tile's texels from the subsamples: the share covered, the front's height (the covered subsamples' highest), its
   * normal's x and y in the frame (the covered subsamples' mean; z toward the camera, positive); off the item its covered
   * neighbors' height and normal, so that linear filtering at the outline reads the item's
   */
  function writeTile(
    array: Uint8Array,
    width: number,
    x0: number,
    y0: number,
    tile: number,
    h: Float32Array,
    hx: Float32Array,
    hy: Float32Array,
    R: number,
  ) {
    const n = tile * Supersample;
    const m = tile * tile;
    const cover = new Float32Array(m);
    const front = new Float32Array(m).fill(-Infinity);
    const fx = new Float32Array(m);
    const fy = new Float32Array(m);
    for (let t = 0; t < tile; ++t) {
      for (let s = 0; s < tile; ++s) {
        let c = 0;
        let f = -Infinity;
        let x = 0;
        let y = 0;
        for (let b = 0; b < Supersample; ++b) {
          for (let a = 0; a < Supersample; ++a) {
            const o = (t * Supersample + b) * n + s * Supersample + a;
            const v = h[o];
            if (v === -Infinity) continue;
            c += 1;
            x += hx[o];
            y += hy[o];
            if (v > f) f = v;
          }
        }
        const k = t * tile + s;
        cover[k] = c / (Supersample * Supersample);
        front[k] = f;
        if (c > 0) {
          fx[k] = x / c;
          fy[k] = y / c;
        }
      }
    }
    for (let t = 0; t < tile; ++t) {
      for (let s = 0; s < tile; ++s) {
        const k = t * tile + s;
        let f = front[k];
        let x = fx[k];
        let y = fy[k];
        if (f === -Infinity) {
          for (let b = -1; b <= 1; ++b) {
            for (let a = -1; a <= 1; ++a) {
              const u = s + a;
              const v = t + b;
              if (u < 0 || v < 0 || u >= tile || v >= tile) continue;
              const g = front[v * tile + u];
              if (g > f) {
                f = g;
                x = fx[v * tile + u];
                y = fy[v * tile + u];
              }
            }
          }
        }
        const o = ((y0 + t) * width + x0 + s) * 4;
        array[o] = Math.round(cover[k] * 255);
        array[o + 1] = f === -Infinity ? 0 : Math.max(1, Math.min(255, Math.round(((f + R) / (2 * R)) * 255)));
        array[o + 2] = Math.round((x * 0.5 + 0.5) * 255);
        array[o + 3] = Math.round((y * 0.5 + 0.5) * 255);
      }
    }
  }

  /** no views: one texel, shared by every item without impostors (`tImpostor` is a shared texture) */
  const Empty: TextureImage<Uint8Array> = { array: new Uint8Array(4), width: 1, height: 1 };

  /** an atlas of no entries: impostors on where no item has any (the define and the band, every entry -1) */
  export const None: ImpostorAtlas = { image: Empty, codes: [], radii: [] };

  export function createValues(): LodImpostorValues {
    return {
      tImpostor: ValueCell.create(Empty),
      uImpostorTexDim: ValueCell.create(Vec2.create(1, 1)),
      uLodImpostorSwitch: ValueCell.create(Vec4.create(0, 0, 0, 0)),
      uImpostorThin: ValueCell.create(Vec2.create(0, 0)),
      dLodImpostor: ValueCell.create(false),
      dLodImpostorLevel: ValueCell.create(false),
      dLodImpostorBand: ValueCell.create(false),
    };
  }

  /** The atlas on `values` (one texture for all that share it), `undefined` for none: the impostors off */
  export function setValues(values: LodImpostorValues, atlas: ImpostorAtlas | undefined) {
    const image = atlas?.image ?? Empty;
    if (values.tImpostor.ref.value !== image) {
      ValueCell.update(values.tImpostor, image);
      ValueCell.update(values.uImpostorTexDim, Vec2.set(values.uImpostorTexDim.ref.value, image.width, image.height));
    }
    ValueCell.updateIfChanged(values.dLodImpostor, !!atlas);
  }

  /**
   * Where each copy switches (`uLodImpostorSwitch`): by size on screen (`SwitchPixels`) or distance
   * (`SwitchDistance`), its threshold, the band's half in octaves; undefined: the levels' boundary
   */
  export function setSwitch(
    values: LodImpostorValues,
    sw:
      | { readonly mode: 'pixels' | 'distance'; readonly value: number; readonly radii?: readonly number[] }
      | undefined,
    halfBand: number,
  ) {
    const v = values.uLodImpostorSwitch.ref.value;
    const mode = sw ? (sw.mode === 'pixels' ? SwitchPixels : SwitchDistance) : 0;
    const value = sw?.value ?? 0;
    // the largest radius the ranges cover (\`radiusCap\`), 0 none
    const cap = sw?.radii?.[1] ?? 0;
    if (v[0] === mode && v[1] === value && v[2] === halfBand && v[3] === cap) return;
    ValueCell.update(values.uLodImpostorSwitch, Vec4.set(v, mode, value, halfBand, cap));
  }

  /**
   * The size on screen below which far copies thin out (\`thinKeep\`), 0 off; the share of the area-keeping enlargement
   * the kept ones take (\`thinScale\`'s \`k\`: 0 none, 1 the area kept)
   */
  export function setThin(values: LodImpostorValues, pixels: number, scale = 1) {
    const v = values.uImpostorThin.ref.value;
    if (v[0] === pixels && v[1] === scale) return;
    ValueCell.update(values.uImpostorThin, Vec2.set(v, pixels, scale));
  }

  /** What `getItem` reads: the spheres' centers and groups, their sizes by type, the size factor, the bounds */
  export interface ItemValues {
    readonly tPositionGroup: ValueCell<DataArray<Float32Array>>;
    readonly uVertexCount: ValueCell<number>;
    readonly sizeType: ValueCell<string>;
    readonly uSize: ValueCell<number>;
    readonly tSize: ValueCell<DataArray<Uint8Array>>;
    readonly uSizeFactor: ValueCell<number>;
    readonly invariantBoundingSphere: ValueCell<Sphere3D>;
  }

  /**
   * The item of spheres drawn by `values`: their drawn radii (size uniform, by group, or the first instance's by
   * instance or group instance; times the size factor), the invariant bounding sphere the impostor is drawn at;
   * undefined for sizes by vertex. `prefix`: the first `count` spheres alone, their radii times `scale` (a coarser
   * level of detail: spheres in level order)
   */
  export function getItem(
    values: ItemValues,
    tile: number,
    prefix?: { readonly count: number; readonly scale: number },
  ): Item | undefined {
    const type = values.sizeType.ref.value;
    if (type !== 'group' && type !== 'uniform' && type !== 'instance' && type !== 'groupInstance') return undefined;
    const count = prefix ? Math.min(prefix.count, values.uVertexCount.ref.value) : values.uVertexCount.ref.value;
    const positionGroup = values.tPositionGroup.ref.value.array;
    const factor = values.uSizeFactor.ref.value * (prefix?.scale ?? 1);
    const radii = new Float32Array(count);
    if (type === 'uniform') {
      radii.fill(values.uSize.ref.value * factor);
    } else {
      const { array, count: sizes } = values.tSize.ref.value;
      for (let k = 0; k < count; ++k) {
        const g = type === 'instance' ? 0 : Math.min(positionGroup[k * 4 + 3], sizes - 1) * 4;
        radii[k] = (unpackRGBToInt(array[g], array[g + 1], array[g + 2]) / sizeDataFactor) * factor;
      }
    }
    const { center, radius } = values.invariantBoundingSphere.ref.value;
    return { positionGroup, radii, count, center, radius, tile };
  }

  /** The impostors' switch by each copy's size on screen (`uLodImpostorSwitch.x`) */
  export const SwitchPixels = 1;
  /** by each copy's distance from the eye */
  export const SwitchDistance = 2;
  /** Octaves beyond the band over which the impostors flatten (Goodsell's look; \`ImpostorFlatOctaves\` in the shaders) */
  export const FlatOctaves = 1;

  /**
   * A copy's share of the impostor (the TS rule of the shaders' switch, \`lod-impostor.md\`): 0 its spheres, 1 its
   * impostor, between them the band of `halfBand` octaves each side of the threshold; above 1 the impostor's flatness
   * (1 + up to 1). By `SwitchPixels`: the copy of `radius` Å at `pixel` Å a pixel is `2 radius / pixel` pixels across,
   * an impostor below `value` pixels (a radius above `radiusCap` counts as it: the culling's ranges are up to it); by
   * `SwitchDistance`: at `distance` Å from the eye, beyond `value` Å
   */
  export function switchShare(
    mode: number,
    value: number,
    halfBand: number,
    radius: number,
    pixel: number,
    distance: number,
    radiusCap = Infinity,
  ) {
    const ratio = mode === SwitchPixels ? (value * pixel) / (2 * Math.min(radius, radiusCap)) : distance / value;
    const l = Math.log2(Math.max(ratio, 1e-30));
    const t = Math.min(1, Math.max(0, (l + halfBand) / (2 * halfBand)));
    const s = t * t * (3 - 2 * t);
    return s + Math.min(1, Math.max(0, (l - halfBand) / FlatOctaves));
  }

  /**
   * Stochastic simplification of the far copies (Cook, Halstead, Planck, Ryu 2007, \`lod-impostor.md\`): below \`s0\`
   * pixels across a share \`p\` of the copies is kept (\`thinKeep\`, by area: \`(size / s0)²\`, at least
   * \`ThinMinKeep\`), each copy by its hash (\`copyHash\`: the same copies at every frame, no flicker), the kept ones
   * larger by about \`1 / √p\` (\`thinScale\`: the area covered kept, the fade's included); a copy leaving shrinks to nothing over \`ThinFade\` above
   * \`p\` (\`thinFactor\`), then is culled (no pop)
   */
  export const ThinMinKeep = 1 / 64;
  export const ThinFade = 0.25;

  export function thinKeep(size: number, s0: number) {
    if (!(s0 > 0) || size >= s0) return 1;
    return Math.max(ThinMinKeep, (size / s0) * (size / s0));
  }

  /**
   * The area the kept and the fading copies draw, per kept copy at scale 1: the fade's `∫(1 - smoothstep)² = 13/35`
   * over its `ThinFade` share
   */
  export const ThinArea = 1 + (ThinFade * 13) / 35;

  /**
   * the kept copies' scale: \`1 / √(p ThinArea)\` (the area covered kept, the fade's included; at least 1) to the power
   * \`k\`: 0 not enlarged (the area thinned with the copies), 1 the area kept, above it more (Ludo: a control)
   */
  export function thinScale(p: number, k = 1) {
    return Math.pow(1 / Math.sqrt(Math.min(1, p * ThinArea)), k);
  }

  /** a copy's size factor at hash \`h\` where \`p\` is kept: \`thinScale(p, k)\`, shrinking to 0 over the fade, 0 beyond */
  export function thinFactor(h: number, p: number, k = 1) {
    if (p >= 1) return 1;
    const end = p * (1 + ThinFade);
    if (h >= end) return 0;
    const t = Math.min(1, Math.max(0, (h - p) / (end - p)));
    return thinScale(p, k) * (1 - t * t * (3 - 2 * t));
  }

  /** A copy's hash in [0, 1): of its segment (member) and its instance, PCG (the shaders' and the culling's) */
  export function copyHash(segment: number, instance: number) {
    let x = (Math.imul(segment >>> 0, 0x9e3779b1) ^ (instance >>> 0)) >>> 0;
    x = (Math.imul(x, 747796405) + 2891336453) >>> 0;
    const word = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
    return (((word >>> 22) ^ word) >>> 0) / 4294967296;
  }

  /**
   * The radius the impostors' ranges cover by size on screen (\`LodImpostorSwitch.radii[1]\`): the largest item's, so
   * that every copy switches at its own size on screen. (A 90th percentile by copies was 64 Å on cellpack-mg's proteins
   * and 17 Å once its 1.1 M lipids had impostors: a ribosome, 183 Å, a silhouette below 125 px, its views blending
   * visibly as the camera turned.)
   */
  export function radiusCap(items: readonly { readonly radius: number }[]) {
    let cap = 0;
    for (const it of items) cap = Math.max(cap, it.radius);
    return cap;
  }

  /** The size on screen (px) a typical copy has at the impostors' distance by default (`autoDistance`) */
  export const AutoPixels = 12;

  /**
   * The impostors' distance by default: where a copy of the median radius (`items` by their copies) is `AutoPixels`
   * across in a 720-px-high view of 45°, a distance of the proteins whatever the model's extent (a slab's radius is tens
   * of thousands of Å)
   */
  export function autoDistance(items: readonly { readonly radius: number; readonly count: number }[]) {
    const sorted = [...items].sort((a, b) => a.radius - b.radius);
    let total = 0;
    for (const it of sorted) total += it.count;
    let acc = 0;
    let median = 30;
    for (const it of sorted) {
      acc += it.count;
      if (acc >= 0.5 * total) {
        median = it.radius;
        break;
      }
    }
    return Math.round((2 * median) / AutoPixels / ((2 * Math.tan(Math.PI / 8)) / 720));
  }
}
