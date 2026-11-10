/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { CutterTable } from '../lipids/cutter.js';
import { membraneStar } from '../lipids/export.js';
import {
  buildMembraneSteps,
  concatMeshes,
  forgetLipidPatch,
  type MembraneData,
  registerLipidPatch,
} from '../lipids/membrane.js';
import { mixOf } from '../lipids/mixes.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { OrganelleMembraneNames } from '../organelle-meshes.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A cell's membranes, a cut leaflet a part and leaflet (lipid-procedural round 7 items 2 and 3): each on its part's own
// triangles, its table its membrane's lipid mix (`mixes.ts`), the LD a monolayer.

/** the stand-ins' species (`standIns`), the CHARMM-GUI patch's names */
const MixSpecies = ['CHL1', 'POPC', 'DOPC', 'POPE', 'PLPE', 'POPI', 'POPS', 'DOPA', 'SSM'];
registerLipidPatch('parts-plain', syntheticPatchPdb().text);
registerLipidPatch('parts-mix', syntheticPatchPdb(16, 18, {}, MixSpecies).text);
afterAll(() => {
  forgetLipidPatch('parts-plain');
  forgetLipidPatch('parts-mix');
});

const Kinds = { edgeTypes: 1, vertexColors: 1, variants: 1, seed: 1 };

function shifted(m: TriMesh, x: number): TriMesh {
  return { positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v)), indices: m.indices };
}

function build(surface: Parameters<typeof buildMembraneSteps>[0], patch: string): MembraneData {
  const steps = buildMembraneSteps(surface, patch, 0, 'both', Kinds, 'cutter');
  for (let r = steps.next(); ; r = steps.next()) {
    if (!r.done) continue;
    if (typeof r.value === 'string') expect.fail(r.value);
    return r.value;
  }
}

/** a species' share of a leaflet table's lipids */
function share(table: CutterTable, species: string) {
  let n = 0;
  for (let m = 0; m < table.members.length; ++m) {
    if (table.species[table.members[m].species] === species) n += table.memberStart[m + 1] - table.memberStart[m];
  }
  return n / table.memberStart[table.members.length];
}

/** a STAR file's rows without their triangle and hit numbers (a part numbers its triangles from 0), sorted */
function rows(data: MembraneData) {
  const out: string[] = [];
  for (const chunk of membraneStar(data)) {
    for (const line of chunk.split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length === 12) out.push(f.slice(0, 10).join(' '));
    }
  }
  return out.sort();
}

describe('a cell’s membranes, a cut leaflet a part (round 7)', () => {
  it('cuts each part on its own triangles as the whole mesh cuts them: the same lipids where no part has a mix', () => {
    const meshes = [icosphere(600, 120), shifted(icosphere(300, 90), 1200)];
    const { mesh, parts } = concatMeshes(meshes, ['a', 'b']);
    const whole = build({ mesh }, 'parts-plain');
    const split = build({ mesh, parts }, 'parts-plain');
    // a cut leaflet a part and leaflet, each on its part's triangles only
    expect(split.cut.map((l) => [l.part, l.name, l.mesh.indices.length / 3])).toEqual([
      [0, 'outer', parts[0].end - parts[0].start],
      [0, 'inner', parts[0].end - parts[0].start],
      [1, 'outer', parts[1].end - parts[1].start],
      [1, 'inner', parts[1].end - parts[1].start],
    ]);
    expect(split.unmixed).toEqual([]);
    // the same lipids at the same places (the whole mesh's regions: no new seam)
    const a = rows(whole);
    expect(a.length).toBeGreaterThan(1000);
    expect(rows(split)).toEqual(a);
  });

  it('gives each membrane its mix: the mito IM cardiolipin’s stand-in, the LD one leaflet, the ER its own', () => {
    const meshes = [icosphere(600, 120), shifted(icosphere(300, 90), 1200), shifted(icosphere(300, 90), -1200)];
    const { mesh, parts } = concatMeshes(meshes, ['MITO_IM', 'ER', 'LD']);
    const data = build({ mesh, parts }, 'parts-mix');
    expect(data.unmixed).toEqual([]);
    const of = (p: number, name: string) => data.cut.find((l) => l.part === p && l.name === name)?.table;
    const n = of(0, 'outer')!.memberStart[of(0, 'outer')!.members.length];
    // cardiolipin as two DOPA (with PA's DOPA): (2 × 6.2 + 2.4) / 106.2 of the IM, the ER's PA alone 2.6 %
    for (const leaflet of ['outer', 'inner']) {
      expect(Math.abs(share(of(0, leaflet)!, 'DOPA') - (2 * 6.2 + 2.4) / 106.2)).toBeLessThanOrEqual(1 / n + 1e-9);
      expect(Math.abs(share(of(1, leaflet)!, 'DOPA') - 0.026)).toBeLessThanOrEqual(1 / n + 1e-9);
    }
    // no SSM out of the PM; DOPC, not POPC, in the endomembranes
    expect(of(1, 'outer')!.species).not.toContain('SSM');
    expect(share(of(1, 'outer')!, 'DOPC')).toBeCloseTo(0.472, 1);
    // the LD a monolayer: its outer leaflet alone
    expect(data.cut.filter((l) => l.part === 2).map((l) => l.name)).toEqual(['outer']);
  });

  it('cuts a part from the patch as it is where the patch lacks a species of its mix, and says which', () => {
    const { mesh, parts } = concatMeshes([icosphere(600, 120), shifted(icosphere(300, 90), 1200)], ['PM', 'other']);
    const data = build({ mesh, parts }, 'parts-plain');
    expect(data.unmixed).toEqual(['PM']);
    expect(data.cut.filter((l) => l.part === 0).map((l) => [...l.table.species].sort())).toEqual([
      ['CHL1', 'POPC', 'POPE'],
      ['CHL1', 'POPC', 'POPE'],
    ]);
  });

  it('finds a mix for each of the yeast viewer’s membranes by its name (the shapes’ labels)', () => {
    for (const name of OrganelleMembraneNames) {
      if (name === 'CELL_OUTER') continue;
      expect(mixOf(name), name).toBeDefined();
    }
  });
});
