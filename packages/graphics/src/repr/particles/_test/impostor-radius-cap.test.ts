/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { ImpostorAtlas } from '@molstar/graphics/geo/geometry/impostor-atlas';
import { getImpostorRadiusCap } from '../representation/target/representation.js';

const source = (radius: number): ImpostorAtlas.Source => ({ key: `${radius}`, radius, tile: 8, get: () => undefined });

describe('particle targets: the impostors radius cap', () => {
  it("is the largest target's radius, whatever the copies (cellpack-mg: lipids by the million, a few ribosomes)", () => {
    // the representation's sources: one per target; many small (lipids), few large
    const sources = [10, 12, 15, 17, 17, 17, 17, 17, 17, 17, 17, 37, 183, 312].map(source);
    expect(getImpostorRadiusCap(sources)).toBe(312);
  });
});
