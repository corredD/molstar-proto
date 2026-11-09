/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { validate } from '../format/validate.js';
import { type IR, placementSets } from '../ir/ir.js';
import { evaluateMesoQL, lociSphere, lociToIds } from '../ir/loci.js';
import { parseMesoQL } from '../format/mesoql.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile, InstancesModel } from '../runtime/runtime.js';

// Instances (_spec/format.md): copies stated one by one, with ids that survive re-resolution. David's point: a
// population is how we state copies we cannot list; an index into it (`copies`) is not an identity, an instance is.

const load = (id: string) => BetaCellResources[id]?.();
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (doc: MesoViewSpecDoc, ir: IR, q: string) =>
  lociSphere(evaluateMesoQL(parseMesoQL(q).expr!, { doc, ir }).loci, ir)!;

/** The β-cell with an explicit packing model: its seed and ribosome count are the unrelated edits. */
function cell(seed: number, ribosomes = 2000): MesoViewSpecDoc {
  const d = betaCellDoc();
  return {
    ...d,
    populations: d.populations.map((p) => (p.id === 'p.ribosomes' ? { ...p, abundance: { count: ribosomes } } : p)),
    models: [
      { id: 'm.cell', kind: 'procedural', method: 'meso.pack', populations: ['p.granules', 'p.ribosomes'], seed },
    ],
    session: { view: 'v.docked' },
  };
}

describe('instances', () => {
  it('an instance keeps its id, pose and camera across unrelated edits; an ordinal does not', async () => {
    const runs = [];
    for (const doc of [cell(3), cell(7), cell(3, 1500)]) {
      const r = await compile(doc, { resolvers: DefaultResolvers, load });
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      runs.push({
        doc,
        ir: r.ir!,
        docked: at(doc, r.ir!, '(instance i.granule-docked)').center,
        g12: at(doc, r.ir!, '(copies p.granules 12)').center,
        camera: r.ir!.view.camera!.target,
      });
    }
    // the docked granule sits where the document says (nm → Å), in every run; the camera follows it
    for (const x of runs) {
      expect(dist(x.docked, [0, -13000, 0])).toBeLessThan(1e-3);
      expect(dist(x.camera, x.docked)).toBeLessThan(1e-3);
      expect(
        lociToIds(
          evaluateMesoQL(parseMesoQL('(instance i.granule-docked)').expr!, { doc: x.doc, ir: x.ir }).loci,
          x.ir,
        ),
      ).toEqual(['i.granule-docked#0']);
    }
    // granule 12 of the population is another granule after a repack
    expect(dist(runs[0].g12, runs[1].g12)).toBeGreaterThan(100);
  });

  it('an instance is resolved into parts like any copy of a superstructure, and the packing avoids it', async () => {
    const doc = cell(3);
    const r = await compile(doc, { resolvers: DefaultResolvers, load });
    const parts = evaluateMesoQL(parseMesoQL('(part (instance i.granule-docked) p.Vamp2)').expr!, {
      doc,
      ir: r.ir!,
    }).loci;
    const s = lociSphere(parts, r.ir!)!;
    expect(dist(s.center, [0, -13000, 0])).toBeLessThan(150);
    expect(s.radius).toBeGreaterThan(1300);
    // no packed granule overlaps the docked one (centres at least two envelopes apart, less a packing tolerance)
    const g = placementSets(r.ir!).find((x) => x.model === 'm.cell')!;
    const gi = g.typeTable.find((t) => t.population === 'p.granules')!.index;
    let nearest = Infinity;
    for (let i = 0; i < g.count; i++)
      if (g.types[i] === gi)
        nearest = Math.min(
          nearest,
          dist([g.positions[3 * i], g.positions[3 * i + 1], g.positions[3 * i + 2]], [0, -13000, 0]),
        );
    expect(nearest).toBeGreaterThan(2 * 1400);
    expect(r.counts['i.granule-docked'].achieved).toBe(1);
    expect(placementSets(r.ir!).some((x) => x.model === InstancesModel)).toBe(true);
  });

  it('validates what an instance names and its pose', () => {
    const d = betaCellDoc();
    const bad: MesoViewSpecDoc = {
      ...d,
      instances: [
        { id: 'i.x', entity: 'e.nope', compartment: 'c.cell', pose: { translation: [0, 0, 0] } },
        {
          id: 'i.y',
          entity: 'e.granule',
          compartment: 'c.cell',
          pose: { translation: [0, 0, 0], rotation: [0, 0, 1, 1] },
        },
        { id: 'p.granules', entity: 'e.granule', compartment: 'c.cell', pose: { translation: [0, 0, 0] } },
      ],
    };
    const codes = validate(bad)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(codes).toContain('ref.missing');
    expect(codes).toContain('value.range');
    expect(codes).toContain('id.duplicate');
    expect(
      validate({ ...d, views: [{ id: 'v', selection: '(population i.granule-docked)' }] }).map((i) => i.code),
    ).toContain('mesoql.ref.kind');
  });
});
