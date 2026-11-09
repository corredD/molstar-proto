/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { createMesoDocument, q } from '../builder/index.js';
import { slug } from '../builder/ids.js';
import { IdPattern } from '../format/doc.js';
import { MesoQLSymbols, parseMesoQL, printMesoQL } from '../format/mesoql.js';

function small() {
  const b = createMesoDocument({ title: 'small' });
  const e = b.entity({ label: 'Insulin granule (β)', kind: 'assembly' });
  const c = b.compartment({ label: 'Cell', kind: 'cell', geometry: { kind: 'sphere', radius: 100 } });
  const p = b.population({ entity: e, compartment: c, location: 'interior', abundance: { count: 3 } });
  return { b, e, c, p };
}

describe('builder: ids', () => {
  it('makes an id from the label under the kind prefix', () => {
    const { e, c, p } = small();
    expect([e, c, p]).toEqual(['e.insulin-granule', 'c.cell', 'p.insulin-granule']);
    for (const id of [e, c, p]) expect(id).toMatch(IdPattern);
  });
  it('slugs: ASCII words, accents dropped, at most 40 characters, cut on a word', () => {
    expect(slug('Café  au LAIT!')).toBe('cafe-au-lait');
    expect(slug('β')).toBe('');
    expect(slug('a'.repeat(10) + '-' + 'b'.repeat(35)).length).toBeLessThanOrEqual(40);
    expect(slug('one two three four five six seven eight nine ten')).toBe('one-two-three-four-five-six-seven-eight');
  });
  it('a label without letters takes the counter; a taken id takes -2, -3', () => {
    const b = createMesoDocument({ title: 't' });
    const a = b.entity({ label: 'β', kind: 'protein' });
    const a2 = b.entity({ label: 'β', kind: 'protein' });
    const x = b.entity({ label: 'x', kind: 'protein' });
    const x2 = b.entity({ label: 'X', kind: 'protein' });
    const x3 = b.entity({ label: 'x', kind: 'protein' });
    expect([a, a2]).toEqual(['e.1', 'e.2']);
    expect([x, x2, x3]).toEqual(['e.x', 'e.x-2', 'e.x-3']);
  });
  it('is stable across runs and unique', () => {
    const ids = () => {
      const { b } = small();
      return b.build().doc.populations.map((p) => p.id);
    };
    expect(ids()).toEqual(ids());
    const { b, e, c } = small();
    b.population({ entity: e, compartment: c, location: 'membrane', abundance: { count: 1 } });
    const all = b.build().doc.populations.map((p) => p.id);
    expect(new Set(all).size).toBe(all.length);
  });
  it('names nodes without a label by what they refer to', () => {
    const b = createMesoDocument({ title: 't' });
    const e = b.entity({ id: 'e.hu', label: 'HU', kind: 'protein' });
    const d = b.entity({ id: 'e.dna', label: 'DNA', kind: 'nucleic-acid' });
    const r = b.relation({ kind: 'bends', subjects: [e], objects: [d] });
    const f = b.frame({ kind: 'world', units: 'nm' });
    expect([r, f]).toEqual(['rel.hu-bends-dna', 'f.world']);
  });
  it('keeps a given id, a duplicate one included: validate reports it', () => {
    const b = createMesoDocument({ title: 't' });
    b.entity({ id: 'e.a', label: 'A', kind: 'protein' });
    b.entity({ id: 'e.a', label: 'B', kind: 'protein' });
    expect(b.build().issues.some((i) => i.code === 'id.duplicate')).toBe(true);
  });
  it('does not register site ids as document ids', () => {
    const b = createMesoDocument({ title: 't' });
    const sites = [{ id: 'entry' }];
    b.entity({ label: 'A', kind: 'protein', sites });
    b.entity({ label: 'B', kind: 'protein', sites });
    expect(b.build().issues.filter((i) => i.code === 'id.duplicate')).toEqual([]);
  });
});

describe('builder: the document', () => {
  it('emits sections in document order, nodes in call order, no undefined keys, empty optionals out', () => {
    const b = createMesoDocument({ title: 'order', units: { length: 'nm' } });
    b.view({ label: 'V' });
    const e = b.entity({ label: 'A', kind: 'protein', radius: undefined });
    b.evidence({ kind: 'assumption', statement: 's' });
    const c = b.compartment({ label: 'C', kind: 'cell', geometry: { kind: 'sphere', radius: 1 } });
    b.population({ entity: e, compartment: c, location: 'interior', abundance: { count: 1 } });
    b.frame({ kind: 'world', units: 'nm' });
    const { doc, issues } = b.build();
    expect(Object.keys(doc)).toEqual([
      'format',
      'version',
      'metadata',
      'units',
      'frames',
      'entities',
      'compartments',
      'populations',
      'evidence',
      'views',
    ]);
    expect(doc.entities[0]).toStrictEqual({ id: 'e.a', label: 'A', kind: 'protein' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('a superstructure holds its own nodes; the document sees the entity that names it', () => {
    const b = createMesoDocument({ title: 'ss' });
    const ss = b.superstructure({ label: 'Granule', kind: 'vesicle' });
    const env = ss.compartment({ label: 'envelope', kind: 'vesicle', geometry: { kind: 'sphere', radius: 5 } });
    const prot = ss.entity({ label: 'VAMP2', kind: 'protein' });
    const ip = ss.population({ entity: prot, compartment: env, location: 'interior', abundance: { count: 3 } });
    const granule = b.entity({ label: 'granule', kind: 'assembly', superstructure: ss.ref });
    const cell = b.compartment({ label: 'cell', kind: 'cell', geometry: { kind: 'sphere', radius: 50 } });
    const p = b.population({ entity: granule, compartment: cell, location: 'interior', abundance: { count: 4 } });
    const { doc, issues } = b.build();
    expect(doc.superstructures?.[0]).toMatchObject({
      id: 's.granule',
      compartments: [{ id: env }],
      entities: [{ id: prot }],
    });
    expect(Object.keys(doc.superstructures?.[0] ?? {})).toEqual([
      'id',
      'label',
      'kind',
      'compartments',
      'populations',
      'entities',
    ]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(q.part(q.copies(p, 1), ip)).toBe('(part (copies p.granule 1) p.vamp2)');
  });
  it('add() takes nodes as they are, registers their ids; get() names one made later', () => {
    const b = createMesoDocument({ title: 'add' });
    const [x] = b.add('entities', [{ id: 'e.imported', label: 'I', kind: 'protein', radius: 2 }]);
    const y = b.entity({ label: 'imported', kind: 'protein' });
    expect([x, y]).toEqual(['e.imported', 'e.imported-2']);
    const later = b.get('evidence', 'ev.later');
    b.entity({ label: 'E', kind: 'protein', evidence: [later] });
    expect(b.build().issues.some((i) => i.code === 'ref.missing')).toBe(true);
    b.evidence({ id: 'ev.later', kind: 'assumption', statement: 's' });
    expect(b.build().issues.some((i) => i.code === 'ref.missing')).toBe(false);
  });
  it('build() returns issues, never throws', () => {
    const { b, c } = small();
    const stranger = createMesoDocument({ title: 'other' }).entity({ id: 'e.stranger', label: 'S', kind: 'protein' });
    b.population({ entity: stranger, compartment: c, location: 'interior', abundance: { count: 1 } });
    expect(() => b.build()).not.toThrow();
    expect(b.build().issues.some((i) => i.severity === 'error')).toBe(true);
  });
  it('session and custom', () => {
    const b = createMesoDocument({ title: 's' });
    const v = b.view({ label: 'V' });
    b.session({ view: v });
    b.custom('cellpack', { a: 1 });
    expect(b.build().doc).toMatchObject({ session: { view: 'v.v' }, custom: { cellpack: { a: 1 } } });
  });
});

describe('builder: MesoQL helpers', () => {
  const b = createMesoDocument({ title: 'q' });
  const e = b.entity({ id: 'e.x', label: 'x', kind: 'protein', sites: [{ id: 'dna-entry' }] });
  const c = b.compartment({ id: 'c.exosome', label: 'x', kind: 'vesicle', geometry: { kind: 'sphere', radius: 1 } });
  const p = b.population({
    id: 'p.catalase',
    entity: e,
    compartment: c,
    location: 'interior',
    abundance: { count: 1 },
  });
  const ss = b.superstructure({ label: 'g' });
  const ip = ss.get('population', 'p.Vamp2');
  const m = b.get('model', 'm.picks');
  const i = b.get('instance', 'i.a');

  const examples: Record<string, string> = {
    all: q.all(),
    population: q.population(p),
    instance: q.instance(i),
    entity: q.entity(e),
    in: q.in(c, { location: 'membrane' }),
    model: q.model(m),
    copies: q.copies(p, 12),
    and: q.and(q.entity(e), q.in(c)),
    or: q.or(q.population(p), q.population(p)),
    not: q.not(q.entity(e)),
    within: q.within(q.entity(e), { of: q.population(p), distance: 20 }),
    site: q.site(e, 'dna-entry'),
    residues: q.residues(e, { chain: 'A', range: [53, 63] }),
    part: q.part(q.copies(p, 12), ip),
  };
  it('has a helper for every symbol of the table', () => {
    expect(Object.keys(examples).sort()).toEqual(MesoQLSymbols.map((s) => s.name).sort());
    for (const s of MesoQLSymbols) expect(Object.keys(q)).toContain(s.name);
  });
  it('prints what printMesoQL prints, and parses with no issue', () => {
    for (const [name, text] of Object.entries(examples)) {
      const r = parseMesoQL(text);
      expect(r.issues, name).toEqual([]);
      expect(printMesoQL(r.expr as never), name).toBe(text);
    }
  });
  it('prints the examples of the table (names, keyword order)', () => {
    expect(q.in(c, { location: 'membrane' })).toBe('(in c.exosome :location membrane)');
    expect(q.copies(p, 12)).toBe('(copies p.catalase 12)');
    expect(q.copies(p, 12, 2)).toBe('(copies p.catalase 12 2)');
    expect(q.in([c, c], { nested: false, location: 'interior' })).toBe(
      '(in c.exosome c.exosome :nested false :location interior)',
    );
    expect(q.not(q.entity(e), { in: q.in(c) })).toBe('(not (entity e.x) :in (in c.exosome))');
    expect(q.residues(e, { chain: 'A', range: '53-63' })).toBe('(residues e.x :chain A :range 53-63)');
  });
});
