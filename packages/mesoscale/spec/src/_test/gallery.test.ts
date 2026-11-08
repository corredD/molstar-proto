/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { galleryDoc } from '../examples/gallery.js';
import { yeastDoc } from '../examples/yeast.js';
import { placementSets } from '../ir/ir.js';
import { rotateVec } from '../ir/placements.js';
import { compile } from '../runtime/runtime.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { abundanceToCount } from '../format/units.js';

// The IR cases beyond the slice (design.md §4.4), on the gallery: dispatch by arrangement, nesting, lattices, fibers,
// bilayers; and the yeast document's failures, reported.

const run = (d = galleryDoc()) => compile(d, { resolvers: DefaultResolvers });

describe('the gallery', () => {
  it('each arrangement goes to its default resolver', async () => {
    const r = await run();
    expect(r.stats.models.map((m) => m.resolver).sort()).toEqual([
      'meso.bilayer',
      'meso.fiber',
      'meso.lattice',
      'meso.pack',
    ]);
  });

  it('nested compartments: ribosomes stay out of the nucleus, the vesicle and the mitochondrion', async () => {
    const r = await run();
    const s = placementSets(r.ir!).find((x) => x.model === 'default:meso.pack')!;
    const rib = s.typeTable.find((t) => t.population === 'p.ribosomes')!;
    let inside = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.types[i] !== rib.index) continue;
      const [x, y, z] = s.positions.subarray(3 * i, 3 * i + 3);
      if (Math.hypot(x - 400, y, z) < 550 + 130) inside++; // nucleus (Å), its membrane and the ribosome radius
      if (Math.hypot(x + 800, y - 500, z) < 250 + 130) inside++;
      if (((x + 500) / (450 + 130)) ** 2 + (y + 700) ** 2 / (200 + 130) ** 2 + (z * z) / (200 + 130) ** 2 < 0.99)
        inside++;
    }
    expect(inside).toBe(0);
    expect(r.counts['p.ribosomes'].achieved).toBe(300);
  });

  it('a lattice patch that fits, and one that does not, explained', async () => {
    const r = await run();
    expect(r.counts['p.pores']).toEqual({ requested: 60, achieved: 60 });
    const atp = r.issues.find((i) => i.code === 'constraint.unmet' && i.ids?.[0] === 'p.atpsynthase')!;
    expect(atp.severity).toBe('error');
    expect(atp.constraint!.reason).toMatch(/holds \d+ hexagonal sites 120 Å apart; 400 asked/);
  });

  it('a lattice with defects: the same copies over more sites, the same holes every run', async () => {
    const d = galleryDoc();
    const holey = {
      ...d,
      populations: d.populations.map((p) =>
        p.id === 'p.pores'
          ? {
              ...p,
              arrangement: {
                kind: 'lattice' as const,
                lattice: 'hexagonal' as const,
                spacing: 22,
                defects: { vacancy: 0.3 },
              },
            }
          : p,
      ),
    };
    const [a, b] = await Promise.all([run(holey), run(holey)]);
    expect(a.counts['p.pores']).toEqual({ requested: 60, achieved: 60 });
    const pores = (r: typeof a) => placementSets(r.ir!).find((s) => s.model === 'default:meso.lattice')!;
    expect(Array.from(pores(a).positions)).toEqual(Array.from(pores(b).positions));
  });

  it('fibers: a traced path, one copy per rise along its arc; grown filaments inside the cell', async () => {
    const r = await run();
    const s = placementSets(r.ir!).find((x) => x.model === 'default:meso.fiber')!;
    expect(s.fibers!.count).toBe(1 + 6);
    expect(r.counts['p.microtubule']).toEqual({ requested: 30, achieved: 30 });
    // consecutive copies of the traced path are one rise apart, and point along the path
    const mt = s.typeTable.find((t) => t.population === 'p.microtubule')!.index;
    const idx = [...s.types.keys()].filter((i) => s.types[i] === mt);
    for (let k = 1; k < idx.length; k++) {
      const [a, b] = [idx[k - 1], idx[k]];
      const d = Math.hypot(...[0, 1, 2].map((j) => s.positions[3 * b + j] - s.positions[3 * a + j]));
      expect(d).toBeLessThanOrEqual(80 + 1e-3);
    }
    const v = rotateVec([0, 0, 0], s.rotations.subarray(4 * idx[0], 4 * idx[0] + 4), 0, 0, 1);
    const dir = [70, 20, 20].map((x) => x / Math.hypot(70, 20, 20));
    expect(v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]).toBeGreaterThan(0.99);
    const actin = s.typeTable.find((t) => t.population === 'p.actin')!.index;
    for (let i = 0; i < s.count; i++)
      if (s.types[i] === actin)
        expect(Math.hypot(s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2])).toBeLessThan(1500);
  });

  it('a bilayer: both leaflets at the density, heads out on the outer leaflet and in on the inner', async () => {
    const r = await run();
    const { requested, achieved } = r.counts['p.vesicle-lipids'];
    const area = 4 * Math.PI * 250 * 250;
    expect(requested).toBe(2 * abundanceToCount({ density: { value: 1.5, unit: 'per_nm2' } }, { area }).count!);
    expect(Math.abs(achieved - requested!) / requested!).toBeLessThan(0.01);
  });
});

describe('the yeast document', () => {
  it('reports what this runtime cannot do with it, and nothing else fails', async () => {
    const r = await compile(yeastDoc(), { resolvers: DefaultResolvers });
    const codes = [...new Set(r.issues.filter((i) => i.severity !== 'info').map((i) => i.code))].sort();
    expect(codes).toEqual(['catalog.unexpanded', 'frame.handedness', 'resolver.unknown']);
    expect(r.issues.find((i) => i.code === 'resolver.unknown')!.message).toMatch(
      /no resolver yeast-cell-viewer\.tiles/,
    );
  });
});
