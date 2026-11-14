/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { helixPath, spiralArc, spiralTurns } from './grow.js';

// Count and Turns of Helix and Spiral, linked (decisions 8 and 21, Ludo 2026-11-13): a fiber's copies lie a rise apart
// along its path, so its Count is its path's length over the rise and its Turns that length in turns. Flat geometry
// (a helix in space, a flat spiral): on a mesh the grow's record gives the other of the two back.

/** The arc a helix makes a turn (Å) */
const helixArc = (pitch: number, radius: number) => Math.hypot(2 * Math.PI * radius, pitch);

/**
 * The copies `turns` of a helix in space hold, a `rise` apart (the first a rise along it): its units along the path
 * `helixPath` makes (a polyline of 5° chords), as `mesoscale.grow` counts them (review M5)
 */
export function helixCopies(turns: number, pitch: number, radius: number, rise: number): number {
  const path = helixPath({ position: Vec3(), rotation: Quat.identity() }, Vec3.create(0, 0, 1), rise, {
    pitch,
    turns,
    hand: 'right',
    direction: 'up',
    radius,
  });
  let length = 0;
  for (let i = 3; i < path.length; i += 3) {
    length += Math.hypot(path[i] - path[i - 3], path[i + 1] - path[i - 2], path[i + 2] - path[i - 1]);
  }
  return path.length ? Math.floor(length / rise + 1e-6) + 1 : 0;
}

/** The turns of a helix in space that hold `count` copies (the arc's, then a few hundredths more for its 5° chords) */
export function helixTurns(count: number, pitch: number, radius: number, rise: number): number {
  let turns = (count * rise) / helixArc(pitch, radius);
  for (let i = 0; i < 8 && helixCopies(turns, pitch, radius, rise) < count; ++i) turns += 0.005;
  return turns;
}

/** The copies `turns` of a flat spiral of arms `spacing` apart hold, a `step` apart along it (as Count's turns say) */
export function spiralCount(turns: number, spacing: number, step: number): number {
  return Math.floor(spiralArc(spacing / (2 * Math.PI), 2 * Math.PI * turns) / step + 1e-6);
}

/** The turns a flat spiral reaches with `count` copies (`spiralTurns`), to two decimals */
export const spiralTurnsOf = (count: number, spacing: number, step: number) =>
  Math.round(spiralTurns(spacing, count * step) * 100) / 100;

/** The settings Count and Turns link (the helix's and the spiral's) and the entity's rise and radius they read */
export interface LinkSettings {
  readonly mode: string;
  readonly turns: number;
  readonly count: number;
  readonly pitch?: number;
  readonly helixRadius?: number;
  readonly spacing?: number;
  readonly rise?: number;
}

/**
 * The follower of the driver `by` (Count or Turns) in flat geometry (a helix in space, a flat spiral), or undefined on a
 * mesh (the grow gives it back). `diameter`, the copy's: the defaults of a radius, a pitch (4 ×) and an arm spacing.
 */
export function linkedValue(
  s: LinkSettings,
  by: 'turns' | 'count',
  rise: number,
  diameter: number,
  onMesh: boolean,
): { count: number } | { turns: number } | undefined {
  const r = s.rise ?? rise;
  if (onMesh) return undefined;
  if (s.mode === 'spiral') {
    const spacing = s.spacing ?? diameter;
    return by === 'turns' ? { count: spiralCount(s.turns, spacing, r) } : { turns: spiralTurnsOf(s.count, spacing, r) };
  }
  const [pitch, radius] = [s.pitch ?? 4 * diameter, s.helixRadius ?? diameter];
  return by === 'turns'
    ? { count: helixCopies(s.turns, pitch, radius, r) }
    : { turns: Math.round(helixTurns(s.count, pitch, radius, r) * 100) / 100 };
}
