/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { CutterTable } from '../lipids/cutter.js';
import { mixOf, mixTable, standIns, YeastMixes } from '../lipids/mixes.js';

// Round 7 item 3: a lipid mix per membrane (Ludo, 2026-11-09): stand-ins from the CHARMM-GUI patch, the LD a monolayer,
// a conflict the most recent source.

/** a leaflet of `n` places, its species each two conformers (atoms at z = side × (1, 2)) */
function leaflet(species: string[], n: number, side: number): CutterTable {
  const members = species.flatMap((_, s) =>
    [0, 1].map((c) => ({
      species: s,
      positions: Float32Array.of(c, 0, side, c, 0, 2 * side),
      elements: Uint8Array.of(67, 67),
    })),
  );
  const memberStart = new Uint32Array(members.length + 1);
  for (let m = 0; m < members.length; ++m) memberStart[m + 1] = Math.round(((m + 1) * n) / members.length);
  const lipids = new Float32Array(n * 4);
  for (let l = 0; l < n; ++l) lipids.set([l, l * 2, 1, 0], l * 4);
  return { species, members, memberStart, lipids, box: [100, 100] };
}

const sum = (o: { readonly [k: string]: number | undefined }) => Object.values(o).reduce((a, b) => a! + b!, 0)!;

describe('lipid mixes per membrane', () => {
  it('reads the yeast tables: each leaflet sums to 100, the PM sterol by the most recent source, 80 % inner', () => {
    for (const [name, mix] of Object.entries(YeastMixes)) {
      // the tables' rounding: within 0.2 (the vacuole's 99.9); stand-ins renormalize
      expect(Math.abs(sum(mix.outer) - 100), name).toBeLessThan(0.2);
      if (mix.inner) expect(Math.abs(sum(mix.inner) - 100), name).toBeLessThan(0.2);
    }
    // van 't Klooster 2020's 27.5 % over Schneiter 1999's 31.5: inner 44, outer 11
    expect(YeastMixes.PM.inner!.ERG).toBeCloseTo(44, 6);
    expect(YeastMixes.PM.outer.ERG).toBeCloseTo(11, 6);
    expect(YeastMixes.PM.outer.SL! / YeastMixes.PM.outer.PC!).toBeCloseTo(44 / 28.9, 6);
    // the LD a monolayer, the mito IM's cardiolipin
    expect(YeastMixes.LD.inner).toBeUndefined();
    expect(YeastMixes.MITO_IM.outer.CL).toBe(6.2);
    // stand-in tables: the NE, Golgi and peroxisome take the ER's; another name none
    expect(mixOf('NE')).toBe(YeastMixes.ER);
    expect(mixOf('GOLGI')).toBe(YeastMixes.ER);
    expect(mixOf('cow')).toBeUndefined();
  });

  it('stands the patch in for the classes: cardiolipin as two DOPA renormalized, PC and PE by the membrane', () => {
    const im = standIns(YeastMixes.MITO_IM.outer, false);
    expect(sum(im)).toBeCloseTo(1, 9);
    // CL 6.2 → 12.4 DOPA, plus PA 2.4, out of 106.2
    expect(im.DOPA).toBeCloseTo((2 * 6.2 + 2.4) / 106.2, 9);
    expect(im.DOPC).toBeCloseTo(43.1 / 106.2, 9);
    const pm = standIns(YeastMixes.PM.outer, true);
    expect(pm.SSM).toBeGreaterThan(0.4);
    expect(pm.POPC).toBeGreaterThan(0);
    expect(pm.DOPC).toBeUndefined();
  });

  it("gives each of the patch's places a species, exact counts, the places and turns kept, deterministic", () => {
    const own = leaflet(['CHL1', 'POPC', 'POPS'], 1000, 1);
    const other = leaflet(['SSM'], 10, -1);
    const fractions = { CHL1: 0.443, POPC: 0.3, SSM: 0.257 };
    const t = mixTable(own, other, fractions, 7);
    expect(t.species).toEqual(['CHL1', 'POPC', 'SSM']);
    const counts = [0, 0, 0];
    for (let m = 0; m < t.members.length; ++m) counts[t.members[m].species] += t.memberStart[m + 1] - t.memberStart[m];
    expect(counts).toEqual([443, 300, 257]);
    // the places: the same set of headgroups and turns
    const key = (a: Float32Array) => {
      const k: string[] = [];
      for (let i = 0; i < a.length; i += 4) k.push(Array.from(a.subarray(i, i + 4)).join());
      return k.sort().join(';');
    };
    expect(key(t.lipids)).toBe(key(own.lipids));
    // SSM lacks in this leaflet: the other's conformers, mirrored onto this side
    const ssm = t.members.filter((m) => m.species === 2);
    expect(ssm.length).toBe(2);
    for (const m of ssm) for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBeGreaterThan(0);
    expect(Array.from(mixTable(own, other, fractions, 7).lipids)).toEqual(Array.from(t.lipids));
    expect(Array.from(mixTable(own, other, fractions, 8).lipids)).not.toEqual(Array.from(t.lipids));
    expect(() => mixTable(own, undefined, { DOPA: 1 }, 7)).toThrow(/DOPA/);
  });

  it("leaves the tables it reads as they were, and levels a borrowed species' coarse slots to the leaflet's height (review M1, S1)", () => {
    // 16 atoms a member: atom i at z = side × (top − i), its element 65 + i; the levels' slots atoms 0 and 8
    const member = (species: number, top: number, side: number) => {
      const positions = new Float32Array(48);
      const elements = new Uint8Array(16);
      for (let i = 0; i < 16; ++i) {
        positions[i * 3] = i;
        positions[i * 3 + 2] = side * (top - i);
        elements[i] = 65 + i;
      }
      return { species, positions, elements };
    };
    const table = (species: string[], members: ReturnType<typeof member>[], n: number): CutterTable => {
      const memberStart = new Uint32Array(members.length + 1);
      for (let m = 0; m < members.length; ++m) memberStart[m + 1] = Math.round(((m + 1) * n) / members.length);
      return { species, members, memberStart, lipids: new Float32Array(n * 4).fill(1), box: [100, 100] };
    };
    const own = table(['POPC'], [member(0, 20, 1)], 100);
    // the other leaflet: two species of different heights (its levels swap atoms)
    const other = table(['CHL1', 'SSM'], [member(0, 15, -1), member(1, 25, -1)], 10);
    const before = JSON.stringify(other.members.map((m) => [Array.from(m.positions), Array.from(m.elements)]));
    const ownBefore = JSON.stringify(Array.from(own.members[0].positions));
    const a = mixTable(own, other, { POPC: 0.5, SSM: 0.5 }, 1);
    const b = mixTable(own, other, { POPC: 0.5, SSM: 0.5 }, 1);
    expect(JSON.stringify(other.members.map((m) => [Array.from(m.positions), Array.from(m.elements)]))).toBe(before);
    expect(JSON.stringify(Array.from(own.members[0].positions))).toBe(ownBefore);
    for (const m of [...a.members, ...b.members]) {
      // each atom still its element (atom i: element 65 + i, x = i)
      for (let i = 0; i < 16; ++i) expect(m.elements[i]).toBe(65 + m.positions[i * 3]);
      // the coarse slot at the leaflet's common height (the own top, 20), the mirrored species' too
      expect(m.positions[2]).toBeCloseTo(20, 4);
    }
    expect(JSON.stringify(a.members.map((m) => Array.from(m.positions)))).toBe(
      JSON.stringify(b.members.map((m) => Array.from(m.positions))),
    );
  });
});
