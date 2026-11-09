/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { validate } from '../format/validate.js';
import { placementSets } from '../ir/ir.js';
import { rotateVec } from '../ir/placements.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';

// Relations as constraints with addresses (_spec/format.md): HU placed on the DNA strand by its entry and exit sites,
// the strand bent at each one; IHF's residue-only site reported, not guessed.

const run = (bend = 120) => compile(nucleoidDoc(bend), { resolvers: DefaultResolvers });

function strandAndHu(r: Awaited<ReturnType<typeof run>>) {
  const s = placementSets(r.ir!).find((x) => x.typeTable.some((t) => t.population === 'p.hu'))!;
  const dna = s.typeTable.find((t) => t.population === 'p.dna')!.index;
  const hu = s.typeTable.find((t) => t.population === 'p.hu')!.index;
  const strand = Array.from(s.fibers!.indices);
  const hus = [...s.types.keys()].filter((i) => s.types[i] === hu);
  const p = (i: number) => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
  const site = (i: number, z: number) => {
    const v = rotateVec([0, 0, 0], s.rotations.subarray(4 * i, 4 * i + 4), 0, 0, z);
    return [s.positions[3 * i] + v[0], s.positions[3 * i + 1] + v[1], s.positions[3 * i + 2] + v[2]];
  };
  return { s, dna, strand, hus, p, site };
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a: number[], b: number[]) => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
};

describe('relations on a strand', () => {
  it('the nucleoid document is valid; its sites are addresses', () => {
    expect(validate(nucleoidDoc()).filter((i) => i.severity === 'error')).toEqual([]);
    const bad = { ...nucleoidDoc(), relations: [{ ...nucleoidDoc().relations![0], entry: '(entity e.hu)' }] };
    expect(validate(bad).map((i) => i.code)).toContain('mesoql.type');
  });

  it('HU sits on the strand: entry site on a DNA copy, the strand resumes at its exit site, bent by the angle', async () => {
    const r = await run(120);
    expect(r.counts['p.hu']).toEqual({ requested: 40, achieved: 40 });
    const { strand, hus, p, site } = strandAndHu(r);
    const strandPos = strand.map(p);
    let bends = 0;
    for (const h of hus) {
      const entry = site(h, -15);
      const exit = site(h, 15);
      // the entry site coincides with a strand copy, and the next strand copy is at the exit site
      const k = strandPos.findIndex((x) => dist(x, entry) < 1e-2);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(dist(strandPos[k + 1], exit)).toBeLessThan(1e-2);
      // incoming direction (k-1 → k) to outgoing (k+1 → k+2): turned by the bend
      if (k > 0 && k + 2 < strandPos.length) {
        const inDir = strandPos[k].map((v, j) => v - strandPos[k - 1][j]);
        const outDir = strandPos[k + 2].map((v, j) => v - strandPos[k + 1][j]);
        if (Math.abs(angle(inDir, outDir) - 120) < 1) bends++;
      }
    }
    expect(bends / hus.length).toBeGreaterThan(0.9);
  });

  it('a different bend is a model edit that changes the strand', async () => {
    const a = strandAndHu(await run(120));
    const b = strandAndHu(await run(60));
    expect(dist(a.p(a.strand[400]), b.p(b.strand[400]))).toBeGreaterThan(1);
  });

  it('IHF: its site is only residues, so the relation is not reconciled and says why', async () => {
    const r = await run();
    const ihf = r.issues.find((i) => i.code === 'constraint.unmet' && i.ids?.[0] === 'p.ihf')!;
    expect(ihf.constraint).toMatchObject({ requested: 5, achieved: 0 });
    expect(ihf.constraint!.reason).toMatch(/given by residues .* needs the structure loaded/);
  });
});
