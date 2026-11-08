/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { validate } from '../format/validate.js';
import { exosomeDoc } from '../examples/exosome.js';
import { galleryDoc, gallerySubset } from '../examples/gallery.js';
import { yeastDoc } from '../examples/yeast.js';

// Static validation (design.md §7.4): the examples are valid; each broken document gives the issue a UI can point at.

const errors = (d: MesoViewSpecDoc) => validate(d).filter((i) => i.severity === 'error');
const codes = (d: MesoViewSpecDoc) => validate(d).map((i) => i.code);

describe('validate', () => {
  it('the examples have no errors', () => {
    expect(errors(exosomeDoc())).toEqual([]);
    expect(errors(galleryDoc())).toEqual([]);
    expect(errors(yeastDoc())).toEqual([]);
  });

  it('every document a story shows validates (the resolver mocks are gallery subsets)', () => {
    for (const ids of [
      ['p.pores', 'p.atpsynthase'],
      ['p.ribosomes', 'p.proteasomes'],
      ['p.actin', 'p.microtubule'],
      ['p.vesicle-lipids'],
    ])
      expect(errors(gallerySubset(ids))).toEqual([]);
  });

  it('the yeast document says what its source leaves out: frames without handedness', () => {
    const w = validate(yeastDoc()).filter((i) => i.code === 'frame.handedness');
    expect(w.map((i) => i.ids?.[0])).toEqual(['f.cell', 'f.fibsem08', 'f.fibsem05']);
  });

  it('a wrong format or a newer major version is refused', () => {
    expect(codes({ ...exosomeDoc(), format: 'mvsj' as 'meso_view_spec' })).toEqual(['format.version']);
    expect(codes({ ...exosomeDoc(), version: '1.0.0' })).toContain('format.version');
  });

  it('duplicate and malformed ids', () => {
    const d = exosomeDoc();
    const dup = { ...d, entities: [...d.entities, { ...d.entities[0] }] };
    expect(errors(dup).map((i) => [i.code, i.path])).toEqual([['id.duplicate', `/entities/${d.entities.length}/id`]]);
    expect(codes({ ...d, entities: [...d.entities, { ...d.entities[0], id: '9bad' }] })).toContain('id.invalid');
  });

  it('references must name a node of the right kind', () => {
    const d = exosomeDoc();
    const bad = {
      ...d,
      populations: [
        { ...d.populations[0], entity: 'c.exosome' },
        { ...d.populations[1], compartment: 'nowhere' },
        ...d.populations.slice(2),
      ],
    };
    const e = errors(bad);
    expect(e.find((i) => i.code === 'ref.kind')?.path).toBe('/populations/0/entity');
    expect(e.find((i) => i.code === 'ref.missing')?.path).toBe('/populations/1/compartment');
  });

  it('compartments that contain each other', () => {
    const d = galleryDoc();
    const cyc = {
      ...d,
      compartments: d.compartments.map((c) => (c.id === 'c.cell' ? { ...c, parent: 'c.nucleus' } : c)),
    };
    expect(codes(cyc)).toContain('compartment.cycle');
  });

  it('a membrane location needs a membrane', () => {
    const d = galleryDoc();
    const noMembrane = {
      ...d,
      compartments: d.compartments.map((c) => (c.id === 'c.nucleus' ? { ...c, membrane: undefined } : c)),
    };
    expect(errors(noMembrane).map((i) => i.code)).toEqual(['location.membrane']);
  });

  it('a population realized twice, and models avoiding each other in a cycle', () => {
    const d = exosomeDoc();
    const twice = {
      ...d,
      models: [
        ...d.models!,
        { id: 'm.again', kind: 'procedural' as const, method: 'meso.pack', populations: ['p.ALB'] },
      ],
    };
    expect(codes(twice)).toContain('model.overlap');
    const cycle = { ...d, models: d.models!.map((m) => (m.id === 'm.picks' ? { ...m, avoid: ['m.recipe'] } : m)) };
    expect(codes(cycle)).toContain('model.cycle');
  });

  it('units, values and colors', () => {
    const d = galleryDoc();
    const bad: MesoViewSpecDoc = {
      ...d,
      populations: [
        { ...d.populations[1], abundance: { concentration: { value: 1, unit: 'mol' as 'M' } } },
        ...d.populations.slice(2),
      ],
      views: [{ id: 'v', looks: [{ select: '(population p.pores)', color: 'red' }] }],
    };
    expect(
      errors(bad)
        .map((i) => i.code)
        .sort(),
    ).toEqual(['unit.unknown', 'value.range']);
  });

  it('a spatial resource whose frame no alignment reaches the world', () => {
    const d = exosomeDoc();
    expect(codes({ ...d, alignments: [] })).toContain('frame.unaligned');
  });
});
