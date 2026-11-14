/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { spiralArc, spiralTurns } from './grow.js';

// Count and Turns of Helix and Spiral, linked (decisions 8 and 21, Ludo 2026-11-13): a fiber's copies lie a rise apart
// along its path, so its Count is its path's length over the rise and its Turns that length in turns. Flat geometry
// (a helix in space, a flat spiral): on a mesh the grow's record gives the other of the two back.

/** The arc a helix makes a turn (Å) */
const helixArc = (pitch: number, radius: number) => Math.hypot(2 * Math.PI * radius, pitch);

/** The copies `turns` of a helix in space hold, a `rise` apart (the first a rise along it) */
export function helixCopies(turns: number, pitch: number, radius: number, rise: number): number {
  return Math.floor((turns * helixArc(pitch, radius)) / rise + 1e-6);
}

/** The fewest turns of a helix in space that hold `count` copies */
export function helixTurns(count: number, pitch: number, radius: number, rise: number): number {
  return (count * rise) / helixArc(pitch, radius);
}

/** The copies `turns` of a flat spiral of arms `spacing` apart hold, a `step` apart along it (as Count's turns say) */
export function spiralCount(turns: number, spacing: number, step: number): number {
  return Math.floor(spiralArc(spacing / (2 * Math.PI), 2 * Math.PI * turns) / step + 1e-6);
}

/** The turns a flat spiral reaches with `count` copies (`spiralTurns`), to two decimals */
export const spiralTurnsOf = (count: number, spacing: number, step: number) =>
  Math.round(spiralTurns(spacing, count * step) * 100) / 100;
