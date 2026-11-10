/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Color } from '@molstar/core/util/color';
import { meshTint, tint } from '../lipids/membrane.js';

// A membrane's colours times its mesh's (lipid-procedural round 9; Ludo, 2026-11-10: normalised).

describe('a mesh’s colour as its membrane’s multiplier (round 9)', () => {
  it('normalises a mesh’s colour by its largest channel: the meshes’ grey no tint', () => {
    expect(meshTint(Color(0x808080))).toBeUndefined();
    expect(meshTint(Color(0xffffff))).toBeUndefined();
    expect(meshTint(Color(0x000000))).toBeUndefined();
    expect(meshTint(undefined)).toBeUndefined();
    expect(meshTint(Color(0x800000))).toBe(0xff0000);
    expect(meshTint(Color(0x336699))).toBe(0x55aaff);
  });

  it('multiplies per channel; no tint leaves the colour', () => {
    expect(tint(Color(0xd9b99b), undefined)).toBe(0xd9b99b);
    expect(tint(Color(0xd9b99b), Color(0xff0000))).toBe(0xd90000);
    expect(tint(Color(0x80ff40), Color(0x55aaff))).toBe(Color.fromRgb(43, 170, 64));
    expect(tint(Color(0xffffff), Color(0x336699))).toBe(0x336699);
  });
});
