/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ImpostorAtlas } from '../impostor-atlas.js';

const V = ImpostorAtlas.Views;

/** spheres of radius `r` filling the ellipsoid of semi-axes `a`, `b`, `c` (on a grid of `step`) */
function ellipsoid(a: number, b: number, c: number, r: number, step: number) {
  const p: number[] = [];
  for (let x = -a; x <= a; x += step) {
    for (let y = -b; y <= b; y += step) {
      for (let z = -c; z <= c; z += step) {
        if ((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2 <= 1) p.push(x, y, z, p.length / 4);
      }
    }
  }
  const count = p.length / 4;
  return { positionGroup: new Float32Array(p), radii: new Float32Array(count).fill(r), count };
}

/** the area (Å²) the view of frame (i, j) of entry `e` covers */
function coveredArea(atlas: ImpostorAtlas, e: number, i: number, j: number) {
  const { x, y, tile } = ImpostorAtlas.decodeEntry(atlas.codes[e]);
  const { array, width } = atlas.image;
  const radius = atlas.radii[e];
  const texel = (2 * radius) / tile;
  let sum = 0;
  for (let t = 0; t < tile; ++t) {
    for (let s = 0; s < tile; ++s) {
      sum += array[((y + j * tile + t) * width + x + i * tile + s) * 4] / 255;
    }
  }
  return sum * texel * texel;
}

/** the frame (i, j) nearest to direction `d` */
function nearestFrame(d: Vec3) {
  const uv = ImpostorAtlas.encode([0, 0], d);
  return [Math.round(uv[0] * (V - 1)), Math.round(uv[1] * (V - 1))];
}


/** a seeded LCG in [0, 1) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** spheres of radius `r` at `p` (x, y, z, group), their bounding sphere about the box's center */
function item(p: number[], r: number, tile: number): ImpostorAtlas.Item {
  const count = p.length / 4;
  const positionGroup = new Float32Array(p);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; ++k) {
    for (let a = 0; a < 3; ++a) {
      lo[a] = Math.min(lo[a], p[4 * k + a]);
      hi[a] = Math.max(hi[a], p[4 * k + a]);
    }
  }
  const center = Vec3.create((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  let radius = 0;
  for (let k = 0; k < count; ++k) {
    radius = Math.max(radius, Math.hypot(p[4 * k] - center[0], p[4 * k + 1] - center[1], p[4 * k + 2] - center[2]) + r);
  }
  return { positionGroup, radii: new Float32Array(count).fill(r), count, center, radius, tile };
}

/** a thin bent rod with a head, 180 Å long: an elongated membrane protein (MG_312) */
function stalk() {
  const R = 180;
  const p: number[] = [];
  for (let k = 0; k < 400; ++k) {
    const t = k / 399;
    p.push(-R * 0.85 + 1.7 * R * t, R * 0.3 * Math.sin(t * 3), R * 0.25 * t * t, p.length / 4);
  }
  for (let k = 0; k < 120; ++k) {
    const a = k * 2.399;
    const z = 1 - (2 * k) / 119;
    const s = Math.sqrt(1 - z * z);
    p.push(-R * 0.85 + 20 * s * Math.cos(a), 20 * s * Math.sin(a), 20 * z, p.length / 4);
  }
  return item(p, 5, 64);
}

/** a ring of eight blobs, 145 Å across, seen near edge-on as the camera turns: an 8-mer (MG_224_8MER_GTP) */
function ring() {
  const R = 180;
  const rand = rng(3);
  const p: number[] = [];
  for (let b = 0; b < 8; ++b) {
    const a = (b / 8) * 2 * Math.PI;
    for (let k = 0; k < 80; ++k) {
      const u = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const l = Math.hypot(u[0], u[1], u[2]) || 1;
      const s = 28 * Math.cbrt(rand());
      p.push(R * 0.8 * Math.cos(a) + (u[0] / l) * s, R * 0.8 * Math.sin(a) + (u[1] / l) * s, (u[2] / l) * s * 0.6, p.length / 4);
    }
  }
  return item(p, 5, 64);
}

/**
 * An orbit of the camera about the item (1° steps, 60°, 20° above its equator), orthographic, `n` pixels across its
 * bounding sphere: per step the impostor's mask (coverage cut at 0.35, \`ImpostorAtlas.hit\`) and the spheres' own; the
 * impostor's overlap with the spheres (IoU) and its largest change in a step against its median (a jump)
 */
function orbit(it: ImpostorAtlas.Item, n: number) {
  const atlas = ImpostorAtlas.create([it], 4096);
  const R = it.radius;
  const masks: Uint8Array[] = [];
  let iou = 0;
  const steps = 61;
  const o = Vec3();
  const r = Vec3();
  for (let a = 0; a < steps; ++a) {
    const ang = (a * Math.PI) / 180;
    const w = Vec3.normalize(Vec3(), Vec3.create(Math.sin(ang) * Math.cos(0.35), Math.sin(0.35), Math.cos(ang) * Math.cos(0.35)));
    const up = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), Vec3.create(0, 1, 0), Vec3.scale(Vec3(), w, w[1])));
    const right = Vec3.cross(Vec3(), up, w);
    Vec3.negate(r, w);
    const mask = new Uint8Array(n * n);
    let inter = 0;
    let union = 0;
    for (let y = 0; y < n; ++y) {
      for (let x = 0; x < n; ++x) {
        const sx = ((x + 0.5) / n - 0.5) * 2 * R;
        const sy = ((y + 0.5) / n - 0.5) * 2 * R;
        for (let c = 0; c < 3; ++c) o[c] = sx * right[c] + sy * up[c];
        // the spheres': any sphere the ray passes within its radius of
        let truth = 0;
        for (let k = 0; k < it.count && !truth; ++k) {
          const px = it.positionGroup[4 * k] - it.center[0] - o[0];
          const py = it.positionGroup[4 * k + 1] - it.center[1] - o[1];
          const pz = it.positionGroup[4 * k + 2] - it.center[2] - o[2];
          const t = px * w[0] + py * w[1] + pz * w[2];
          if (px * px + py * py + pz * pz - t * t <= it.radii[k] * it.radii[k]) truth = 1;
        }
        for (let c = 0; c < 3; ++c) o[c] += 2 * R * w[c];
        const m = ImpostorAtlas.hit(atlas, 0, o, r, w).coverage >= 0.35 ? 1 : 0;
        mask[y * n + x] = m;
        inter += m & truth;
        union += m | truth;
      }
    }
    iou += inter / union;
    masks.push(mask);
  }
  const change: number[] = [];
  for (let a = 1; a < steps; ++a) {
    let x = 0;
    let area = 0;
    for (let p = 0; p < n * n; ++p) {
      x += masks[a][p] ^ masks[a - 1][p];
      area += masks[a][p];
    }
    change.push(x / area);
  }
  const sorted = [...change].sort((a, b) => a - b);
  return { iou: iou / steps, jump: sorted[sorted.length - 1] / sorted[sorted.length >> 1] };
}

describe('impostor atlas', () => {
  it('maps directions to the octahedron and back', () => {
    for (const d of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0.3, -0.5, -0.8],
      [-0.7, 0.2, 0.1],
    ]) {
      const n = Vec3.normalize(Vec3(), Vec3.create(d[0], d[1], d[2]));
      const uv = ImpostorAtlas.encode([0, 0], n);
      expect(uv[0]).toBeGreaterThanOrEqual(0);
      expect(uv[0]).toBeLessThanOrEqual(1);
      const back = ImpostorAtlas.decode(Vec3(), uv[0], uv[1]);
      expect(Vec3.distance(back, n)).toBeLessThan(1e-6);
    }
  });

  it('frames on the grid of the octahedral map, an orthonormal basis each', () => {
    const right = Vec3();
    const up = Vec3();
    const d = Vec3();
    for (let j = 0; j < V; ++j) {
      for (let i = 0; i < V; ++i) {
        ImpostorAtlas.frameDirection(d, i, j);
        ImpostorAtlas.frameBasis(right, up, d);
        expect(Vec3.magnitude(d)).toBeCloseTo(1, 6);
        expect(Vec3.dot(right, up)).toBeCloseTo(0, 6);
        expect(Vec3.dot(right, d)).toBeCloseTo(0, 6);
        expect(Vec3.dot(up, d)).toBeCloseTo(0, 6);
        // right-handed: right x up = toward the camera
        expect(Vec3.distance(Vec3.cross(Vec3(), right, up), d)).toBeLessThan(1e-6);
      }
    }
  });

  it('blends the three nearest views, their weights summing to 1, the frame itself alone on it', () => {
    const out = ImpostorAtlas.views();
    const d = Vec3();
    ImpostorAtlas.frameDirection(d, 3, 5);
    ImpostorAtlas.getViews(out, d);
    const k = out.w.indexOf(Math.max(...out.w));
    expect(out.w[k]).toBeCloseTo(1, 5);
    expect([out.i[k], out.j[k]]).toEqual([3, 5]);
    for (const w of [
      [0.2, 0.9, -0.1],
      [-0.6, -0.6, -0.5],
    ]) {
      ImpostorAtlas.getViews(out, Vec3.normalize(Vec3(), Vec3.create(w[0], w[1], w[2])));
      expect(out.w[0] + out.w[1] + out.w[2]).toBeCloseTo(1, 6);
      for (const x of out.w) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('chooses for a copy turned by R the view of R⁻¹ d for the camera direction d', () => {
    const R = Mat4.fromRotation(Mat4(), 1.1, Vec3.normalize(Vec3(), Vec3.create(1, 2, 3)));
    const d = Vec3.normalize(Vec3(), Vec3.create(0.2, -0.4, 0.9));
    // what the shaders compute: the camera's direction in the copy's frame
    const local = ImpostorAtlas.localDirection(Vec3(), R, d);
    const inverse = Vec3.transformDirection(Vec3(), d, Mat4.invert(Mat4(), R));
    expect(Vec3.distance(local, inverse)).toBeLessThan(1e-6);
    const a = ImpostorAtlas.views();
    const b = ImpostorAtlas.views();
    ImpostorAtlas.getViews(a, local);
    ImpostorAtlas.getViews(b, inverse);
    expect([a.i, a.j]).toEqual([b.i, b.j]);
    for (let k = 0; k < 3; ++k) expect(a.w[k]).toBeCloseTo(b.w[k], 5);
  });

  it('packs entries and encodes their places in a float the shaders decode', () => {
    for (const [x, y, tile] of [
      [0, 0, 8],
      [4088, 4088, 64],
      [512, 1024, 16],
      // an atlas up to 8192 a side (a model of thousands of targets)
      [8184, 8184, 64],
      [8184, 0, 8],
    ]) {
      const code = ImpostorAtlas.encodeEntry(x, y, tile);
      expect(Math.fround(code)).toBe(code);
      expect(ImpostorAtlas.decodeEntry(code)).toEqual({ x, y, tile });
    }
  });

  it('sizes a tile by the pixels the copy covers where the impostors start, a power of 2 in [8, 64]', () => {
    expect(ImpostorAtlas.tileSize(20, 6)).toBe(8);
    expect(ImpostorAtlas.tileSize(50, 6)).toBe(32);
    expect(ImpostorAtlas.tileSize(400, 6)).toBe(64);
  });

  it('gives an ellipsoid of spheres its silhouette area per view direction', () => {
    const [a, b, c] = [30, 15, 10];
    const e = ellipsoid(a, b, c, 1.5, 1);
    const atlas = ImpostorAtlas.create([{ ...e, center: Vec3(), radius: a + 1.5, tile: 64 }], 4096);
    expect(atlas.codes.length).toBe(1);
    // silhouettes of the ellipsoid grown by the spheres' radius
    const along = [
      [Vec3.create(0, 0, 1), Math.PI * (a + 1.5) * (b + 1.5)],
      [Vec3.create(1, 0, 0), Math.PI * (b + 1.5) * (c + 1.5)],
      [Vec3.create(0, 1, 0), Math.PI * (a + 1.5) * (c + 1.5)],
    ] as const;
    for (const [d, area] of along) {
      const [i, j] = nearestFrame(d);
      expect(Math.abs(coveredArea(atlas, 0, i, j) / area - 1)).toBeLessThan(0.1);
    }
  });

  it('writes the front surface: nearer the camera above, the background 0', () => {
    // two spheres along z: seen from +z the nearer one's front at z = 12
    const atlas = ImpostorAtlas.create(
      [
        {
          positionGroup: new Float32Array([0, 0, 10, 0, 0, 0, -10, 1]),
          radii: new Float32Array([2, 2]),
          count: 2,
          center: Vec3(),
          radius: 12,
          tile: 32,
        },
      ],
      4096,
    );
    const [i, j] = nearestFrame(Vec3.create(0, 0, 1));
    const { x, y, tile } = ImpostorAtlas.decodeEntry(atlas.codes[0]);
    const { array, width } = atlas.image;
    const at = (s: number, t: number) => ((y + j * tile + t) * width + x + i * tile + s) * 4;
    const middle = at(tile / 2, tile / 2);
    expect(array[middle]).toBeGreaterThan(200);
    // height 12 of the radius 12: (12 + 12) / 24 of 255
    expect(array[middle + 1]).toBeGreaterThan(245);
    expect(array[at(1, 1)]).toBe(0);
    // the front's normal toward the camera in the middle (x, y 0: 127.5), tilted at the sphere's side
    // (the middle texel half a texel off the sphere's center: n.x 0.19)
    expect(Math.abs(array[middle + 2] - 127.5)).toBeLessThan(32);
    expect(Math.abs(array[middle + 3] - 127.5)).toBeLessThan(32);
    const side = at(tile / 2 + 2, tile / 2);
    expect(array[side + 2]).toBeGreaterThan(array[middle + 2] + 40);
  });

  it('splats an item once: a cache of blocks by key, the atlas packed again from it', () => {
    const e = ellipsoid(20, 10, 8, 1.5, 2);
    const item = (key: string) => ({
      key,
      radius: 22,
      tile: 16,
      get: () => ({ ...e, center: Vec3(), radius: 22, tile: 16 }),
    });
    const cache = new Map<string, Uint8Array>();
    const first = ImpostorAtlas.createCached([item('a'), item('b')], 4096, cache);
    expect(first.splatted).toBe(2);
    const again = ImpostorAtlas.createCached([item('a'), item('b'), item('c')], 4096, cache);
    // only the new one; the others' blocks copied, the same texels
    expect(again.splatted).toBe(1);
    const block = (atlas: ImpostorAtlas, k: number) => {
      const { x, y, tile } = ImpostorAtlas.decodeEntry(atlas.codes[k]);
      const out: number[] = [];
      for (let t = 0; t < tile * V; ++t) {
        const o = ((y + t) * atlas.image.width + x) * 4;
        out.push(...atlas.image.array.subarray(o, o + tile * V * 4));
      }
      return out;
    };
    expect(block(again, 0)).toEqual(block(first, 0));
    // a key no longer asked for is let go
    ImpostorAtlas.createCached([item('c')], 4096, cache);
    expect([...cache.keys()].some((k) => k.startsWith('a'))).toBe(false);
  });

  it('switches a copy by its own size on screen or its distance, cross-fading over the band', () => {
    const h = 0.25;
    // size on screen: a copy of radius 100 Å at 10 Å a pixel is 20 px across
    const px = (R: number, pixel: number) => ImpostorAtlas.switchShare(ImpostorAtlas.SwitchPixels, 12, h, R, pixel, 0);
    expect(px(100, 10)).toBe(0); // 20 px: spheres
    expect(px(100, 100)).toBeGreaterThanOrEqual(1); // 2 px: impostor
    expect(px(100, 200 / 12)).toBeCloseTo(0.5, 6); // 12 px: the band's middle
    // the same size on screen, whatever the radius: a ribosome and a small protein switch alike
    expect(px(250, 250 / 6)).toBeCloseTo(px(30, 30 / 6), 12);
    // above the cap (\`radiusCap\`: the largest item's), a radius counts as the cap: the largest switch larger on screen,
    // within the ranges the culling draws
    const capped = ImpostorAtlas.switchShare(ImpostorAtlas.SwitchPixels, 12, h, 400, 400 / 6, 0, 100);
    expect(capped).toBeCloseTo(ImpostorAtlas.switchShare(ImpostorAtlas.SwitchPixels, 12, h, 100, 400 / 6, 0), 12);
    // distance from the eye
    const dist = (d: number) => ImpostorAtlas.switchShare(ImpostorAtlas.SwitchDistance, 5000, h, 50, 0, d);
    expect(dist(3000)).toBe(0);
    expect(dist(9000)).toBeGreaterThanOrEqual(1);
    expect(dist(5000)).toBeCloseTo(0.5, 6);
    // beyond the band the impostors flatten (the share 1 + flatness, at most 2)
    expect(dist(5000 * 2 ** (h + 1))).toBeCloseTo(2, 6);
    expect(dist(1e9)).toBe(2);
  });

  it('switches every copy at its own size on screen: lipids by the million do not cap the large ones', () => {
    // cellpack-mg: 1.1 M lipids (10-17 Å) and a few large complexes (a ribosome, 183 Å; a 6-mer, 312 Å)
    const items = [
      { radius: 10, count: 1100000 },
      { radius: 17, count: 800000 },
      { radius: 37, count: 200000 },
      { radius: 183, count: 74 },
      { radius: 312, count: 92 },
    ];
    const cap = ImpostorAtlas.radiusCap(items);
    expect(cap).toBe(312);
    // a ribosome 24 px across (twice the threshold of 12 px) is drawn by its spheres, not as a 125-px silhouette
    const share = (R: number, px: number) =>
      ImpostorAtlas.switchShare(ImpostorAtlas.SwitchPixels, 12, 0.25, R, (2 * R) / px, 0, cap);
    expect(share(183, 24)).toBe(0);
    expect(share(312, 24)).toBe(0);
    expect(share(183, 12)).toBeCloseTo(0.5, 6);
    expect(share(183, 6)).toBeGreaterThanOrEqual(1);
  });

  it('keeps a long thin item and a ring in shape and steady as the camera turns (each view read at its own height)', () => {
    // the three views' planes through the center misplace what lies off them: an elongated item's views disagree, its
    // blend ghosts (IoU 0.55, 0.65) and parts cross the cut at once as the weights move (jumps 7.3, 6.0 the median)
    const s = orbit(stalk(), 48);
    const r = orbit(ring(), 48);
    expect(s.iou).toBeGreaterThan(0.7);
    expect(r.iou).toBeGreaterThan(0.75);
    expect(s.jump).toBeLessThan(5);
    expect(r.jump).toBeLessThan(5);
  }, 60000);

  it('fits thousands of items where the device allows 8192 a side, none left out', () => {
    // 5,457 targets (yeast_slab_z600nm): at the smallest tile (8) 72 × 72 texels each, more than 4096² holds
    const e = {
      positionGroup: new Float32Array([0, 0, 0, 0]),
      radii: new Float32Array([2]),
      count: 1,
      center: Vec3(),
      radius: 30,
    };
    const items = Array.from({ length: 5457 }, () => ({ ...e, tile: 8 }));
    const small = ImpostorAtlas.create(items, 4096);
    expect(small.codes.filter((c) => c < 0).length).toBeGreaterThan(0);
    const large = ImpostorAtlas.create(items, 8192);
    expect(large.codes.filter((c) => c < 0).length).toBe(0);
    expect(large.image.width).toBeLessThanOrEqual(8192);
    for (const c of large.codes.slice(-3)) expect(ImpostorAtlas.decodeEntry(c).y).toBeLessThan(8192);
  });

  // stochastic simplification (Cook, Halstead, Planck, Ryu 2007): below a size on screen a share of the copies kept,
  // by a hash of each, the kept ones larger so that the area covered stays
  it('thins copies below a size on screen, by a stable hash, keeping the area', () => {
    const s0 = 4;
    // at s0 and above all kept; below, the share by area, at least the floor
    expect(ImpostorAtlas.thinKeep(8, s0)).toBe(1);
    expect(ImpostorAtlas.thinKeep(4, s0)).toBe(1);
    expect(ImpostorAtlas.thinKeep(2, s0)).toBeCloseTo(0.25, 12);
    expect(ImpostorAtlas.thinKeep(0.01, s0)).toBe(ImpostorAtlas.ThinMinKeep);
    // the hash: the same for a copy every time, in [0, 1), spread evenly
    expect(ImpostorAtlas.copyHash(3, 12345)).toBe(ImpostorAtlas.copyHash(3, 12345));
    let below = 0;
    const n = 20000;
    for (let i = 0; i < n; ++i) {
      const h = ImpostorAtlas.copyHash(7, i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      if (h < 0.25) below++;
    }
    expect(Math.abs(below / n - 0.25)).toBeLessThan(0.01);
    // the area drawn, the fade's included: the mean over the hashes of the factor's square is 1 (one copy's area)
    for (const size of [3.9, 3.6, 3, 2, 1, 0.6, 0.2]) {
      const p = ImpostorAtlas.thinKeep(size, s0);
      let area = 0;
      const m = 200000;
      for (let i = 0; i < m; ++i) area += ImpostorAtlas.thinFactor((i + 0.5) / m, p) ** 2;
      expect(Math.abs(area / m - 1)).toBeLessThan(0.01);
    }
    // a copy's size factor: 1/√p kept, shrinking to 0 over the fade above p, 0 beyond (culled)
    const p = 0.25;
    expect(ImpostorAtlas.thinFactor(0.1, p)).toBeCloseTo(ImpostorAtlas.thinScale(p), 12);
    expect(ImpostorAtlas.thinScale(p)).toBeGreaterThan(1);
    expect(ImpostorAtlas.thinFactor(p * (1 + ImpostorAtlas.ThinFade), p)).toBe(0);
    expect(ImpostorAtlas.thinFactor(p * (1 + ImpostorAtlas.ThinFade / 2), p)).toBeGreaterThan(0);
  });

  it('by distance by default: where a copy of the median radius (by copies) is 12 px across in a 720-px view', () => {
    // a yeast slab: millions of copies of 20 to 90 Å, the model 24,000 Å in radius: a distance of proteins
    const d = ImpostorAtlas.autoDistance([
      { radius: 20, count: 1000 },
      { radius: 50, count: 3000 },
      { radius: 90, count: 500 },
    ]);
    expect(d).toBeCloseTo((2 * 50) / 12 / ((2 * Math.tan(Math.PI / 8)) / 720), 0);
  });
});
