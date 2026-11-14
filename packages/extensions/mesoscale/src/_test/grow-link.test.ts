/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { spiralTurns } from '../grow.js';
import { helixCopies, helixTurns, spiralCount } from '../grow-link.js';

// Count and Turns of Helix and Spiral, linked (decisions 8 and 21, Ludo 2026-11-13): setting one sets the other.

describe('Count and Turns of a helix in space', () => {
  const [pitch, radius, rise] = [40, 15, 5];
  const arc = Math.hypot(2 * Math.PI * radius, pitch);
  it('Turns hold the copies a rise apart along their arc; Count reaches the turns that make it', () => {
    expect(helixCopies(2, pitch, radius, rise)).toBe(Math.floor((2 * arc) / rise));
    for (const count of [3, 10, 37]) {
      const turns = helixTurns(count, pitch, radius, rise);
      expect(helixCopies(turns, pitch, radius, rise)).toBe(count);
      // the fewest turns that hold it
      expect(helixCopies(turns * 0.99, pitch, radius, rise)).toBeLessThan(count);
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
