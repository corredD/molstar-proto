/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A seeded generator (mulberry32): the same seed, the same numbers, on every platform (design.md §7.3).

export interface Random {
  /** In [0, 1). */
  next(): number;
  range(lo: number, hi: number): number;
  /** A point uniform on the unit sphere. */
  onSphere(out: number[]): number[];
}

export function createRandom(seed: number): Random {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    onSphere(out) {
      const z = 2 * next() - 1;
      const phi = 2 * Math.PI * next();
      const r = Math.sqrt(1 - z * z);
      out[0] = r * Math.cos(phi);
      out[1] = r * Math.sin(phi);
      out[2] = z;
      return out;
    },
  };
}

/** A sub-seed for a named stream (a population's own), so streams do not shift when another is added. */
export function subSeed(seed: number, name: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
