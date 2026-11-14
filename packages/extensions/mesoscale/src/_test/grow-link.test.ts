/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { helixPath, spiralTurns } from '../grow.js';
import { helixCopies, helixTurns, spiralCount } from '../grow-link.js';

// Count and Turns of Helix and Spiral, linked (decisions 8 and 21, Ludo 2026-11-13): setting one sets the other.

describe('Count and Turns of a helix in space', () => {
  it('Turns hold the copies a grow of them makes (its 5° polyline, not the exact arc; review M5)', () => {
    expect(helixCopies(10.5, 40, 15, 5)).toBe(214);
    const pose = { position: Vec3(), rotation: Quat.identity() };
    for (const [pitch, radius, rise, turns] of [
      [40, 15, 5, 19],
      [40, 15, 5, 21],
      [25, 9, 3, 7.5],
      [60, 30, 4, 12.5],
    ]) {
      const path = helixPath(pose, Vec3.create(0, 0, 1), rise, {
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
      expect(helixCopies(turns, pitch, radius, rise)).toBe(Math.floor(length / rise + 1e-6) + 1);
    }
  });

  const [pitch, radius, rise] = [40, 15, 5];
  const arc = Math.hypot(2 * Math.PI * radius, pitch);
  it('Turns hold the copies a rise apart along their arc; Count reaches the turns that make it', () => {
    expect(Math.abs(helixCopies(2, pitch, radius, rise) - (2 * arc) / rise)).toBeLessThan(2);
    for (const count of [3, 10, 37]) {
      const turns = helixTurns(count, pitch, radius, rise);
      expect(helixCopies(turns, pitch, radius, rise)).toBeGreaterThanOrEqual(count);
      expect(helixCopies(turns * 0.97, pitch, radius, rise)).toBeLessThan(count);
    }
  });
});

describe('Count and Turns of a spiral', () => {
  it("Turns hold the copies a Step apart along the arms' length; Count reaches the turns spiralTurns says", () => {
    const [spacing, step] = [20, 5];
    for (const count of [10, 30, 100]) {
      const turns = spiralTurns(spacing, count * step);
      expect(spiralCount(turns * (1 + 1e-9), spacing, step)).toBe(count);
      expect(spiralCount(turns * 0.98, spacing, step)).toBeLessThan(count);
    }
  });
});
