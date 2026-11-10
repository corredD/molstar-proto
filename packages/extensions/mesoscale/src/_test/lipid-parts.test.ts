/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterAll, describe, expect, it } from 'vitest';
import { type CutterRegions, type CutterTable, cutterRegions } from '../lipids/cutter.js';
import { membraneStar } from '../lipids/export.js';
import {
  buildMembraneSteps,
  concatMeshes,
  forgetLipidPatch,
  type MembraneData,
  patchTableArray,
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

/** a STAR file's rows' fields, without the hit number */
function fields(data: MembraneData, hiddenParts: ReadonlySet<string> = new Set()) {
  const out: string[][] = [];
  for (const chunk of membraneStar(data, new Set(), 256, hiddenParts)) {
    for (const line of chunk.split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length === 12) out.push(f.slice(0, 11));
    }
  }
  return out;
}

/** a STAR file's rows, the triangle the whole mesh's (review S1), sorted */
function rows(data: MembraneData) {
  return fields(data)
    .map((f) => f.join(' '))
    .sort();
}

describe('a cell’s membranes, a cut leaflet a part (round 7)', () => {
  it('names its parts apart: a name taken again `name 2`, a suffix taken skipped (round 9 review S3)', () => {
    const one = icosphere(100, 20);
    const { parts } = concatMeshes([one, one, one, one], ['a', 'a', 'a 2', 'a']);
    expect(parts.map((p) => p.name)).toEqual(['a', 'a 2', 'a 2 2', 'a 3']);
  });

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

  it('holds a part’s own regions only, renumbered, each keyed by its index in the whole mesh (round 7 review X1)', () => {
    const meshes = [icosphere(600, 120), shifted(icosphere(300, 90), 1200)];
    const { mesh, parts } = concatMeshes(meshes, ['a', 'b']);
    const regions = cutterRegions(mesh.positions, mesh.indices, Kinds.seed);
    const split = build({ mesh, parts }, 'parts-plain');
    for (const l of split.cut) {
      const part = parts[l.part!];
      // its keys (`CutterRegions.keys`) read untyped: the test before the field (review X1)
      const own = l.regions as CutterRegions & { keys?: Uint32Array };
      // its table its regions' rows alone (no copy of the whole mesh's a part and leaflet)
      expect(own.count).toBeLessThan(regions.count);
      expect(own.table.length).toBe(own.count * 16);
      expect(own.keys?.length).toBe(own.count);
      for (let t = 0; t < own.regionOf.length; ++t) {
        const r = own.regionOf[t];
        const whole = regions.regionOf[part.start + t];
        expect(r).toBeLessThan(own.count);
        // the cells' hash keyed as in the whole mesh: the same lipids a triangle
        expect(own.keys?.[r] ?? r).toBe(whole);
        expect(Array.from(own.table.subarray(r * 16, r * 16 + 16))).toEqual(
          Array.from(regions.table.subarray(whole * 16, whole * 16 + 16)),
        );
      }
    }
    // the surface's table texture: each region's key over its normal's x, the shader's hash input (review X1)
    for (const l of split.cut) {
      const own = l.regions as CutterRegions & { keys?: Uint32Array };
      const texels = patchTableArray(own, new Float32Array(0)).array;
      for (let r = 0; r < own.count; ++r) expect(texels[r * 16 + 12]).toBe(own.keys?.[r] ?? r);
    }
    // the second part's regions renumbered from 0: its keys are not its indices (every reader must hash the key)
    const second = split.cut.find((l) => l.part === 1)!.regions as CutterRegions & { keys?: Uint32Array };
    expect(second.keys?.[0]).toBeGreaterThan(0);
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
    // exported (review S1): a class number one species across the parts, the triangles the whole mesh's, a hidden part
    // left out
    const all = fields(data);
    const classes = new Map<string, Set<string>>();
    for (const f of all) {
      if (!classes.has(f[6])) classes.set(f[6], new Set());
      classes.get(f[6])!.add(f[7]);
    }
    for (const [c, names] of classes) expect([...names], `class ${c}`).toHaveLength(1);
    const inPart = (f: string[], p: number) => +f[10] >= parts[p].start && +f[10] < parts[p].end;
    expect(all.some((f) => inPart(f, 1))).toBe(true);
    expect(fields(data, new Set(['ER'])).some((f) => inPart(f, 1))).toBe(false);
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
