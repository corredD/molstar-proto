/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { cutterTable } from '../lipids/cutter.js';
import { LipidMembraneReprParams, switchSpheres } from '../lipids/membrane.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The spheres a far surface takes over from (round 4c item 7, the gate's M1): the level Mol*'s levels draw at the
// switch's size on screen, as the members' (their nominal radius 1.7 Å, Balanced: levels at 0.85 and 2.40 Å a pixel).

const { text, box } = syntheticPatchPdb();
const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
const props = PD.getDefaultValues(LipidMembraneReprParams);

describe('the spheres at a membrane’s switch', () => {
  it('are the level drawn at the switch’s px, not always the coarsest', () => {
    // 23 atoms a lipid, a lipid about 7.4 Å: 0.5 px is 15 Å a pixel (stride 64: 1 atom, √23 grown), 8 px 0.93 Å (stride
    // 8: 3 atoms, √8 grown), 16 px 0.46 Å (the atoms)
    const coarse = switchSpheres(table, props, 0.5);
    expect(coarse.atoms[0].length / 3).toBe(1);
    expect(coarse.radius).toBeCloseTo(2 * Math.sqrt(23), 3);
    const middle = switchSpheres(table, props, 8);
    expect(middle.atoms[0].length / 3).toBe(3);
    expect(middle.radius).toBeCloseTo(2 * Math.sqrt(8), 3);
    const atoms = switchSpheres(table, props, 16);
    expect(atoms.atoms[0].length / 3).toBe(23);
    expect(atoms.radius).toBeCloseTo(2, 3);
  });
});
