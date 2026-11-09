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
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';

// Static validation (_spec/runtime.md): the examples are valid; each broken document gives the issue a UI can point at.

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
    // a version is required (F11)
    expect(codes({ ...exosomeDoc(), version: undefined as unknown as string })).toContain('format.version');
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

  // F9: a malformed document (a missing field, a null where an object goes) is an issue, never a throw
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  /** Every object a document holds in a list: section items, superstructure contents, looks, annotations, steps. */
  function* items(d: any): Generator<{ list: any[]; i: number }> {
    const lists = (o: any, keys: readonly string[]) => keys.flatMap((k) => (Array.isArray(o?.[k]) ? [o[k]] : []));
    const sections = ['frames', 'alignments', 'resources', 'entities', 'compartments', 'populations', 'instances'];
    const rest = ['catalogs', 'relations', 'models', 'evidence', 'activities', 'views', 'superstructures', 'tours'];
    const inner = ['entities', 'compartments', 'populations', 'models', 'relations'];
    for (const list of lists(d, [...sections, ...rest])) for (let i = 0; i < list.length; i++) yield { list, i };
    for (const ss of d.superstructures ?? [])
      for (const list of lists(ss, inner)) for (let i = 0; i < list.length; i++) yield { list, i };
    for (const v of d.views ?? [])
      for (const list of lists(v, ['looks', 'annotations'])) for (let i = 0; i < list.length; i++) yield { list, i };
    for (const t of d.tours ?? [])
      for (const list of lists(t, ['steps'])) for (let i = 0; i < list.length; i++) yield { list, i };
  }

  it('never throws: every item nulled, every field of every item deleted or nulled (F9)', () => {
    const docs = [exosomeDoc(), galleryDoc(), yeastDoc(), betaCellDoc(), nucleoidDoc()];
    let tried = 0;
    for (const doc of docs) {
      const base = clone(doc) as any;
      const n = [...items(base)].length;
      for (let k = 0; k < n; k++) {
        const nth = () => {
          const d = clone(base);
          return { d, at: [...items(d)][k] };
        };
        const { d, at } = nth();
        const keys = Object.keys(at.list[at.i] ?? {});
        at.list[at.i] = null;
        expect(() => validate(d), `item ${k} null`).not.toThrow();
        tried++;
        for (const key of keys)
          for (const value of [undefined, null]) {
            const { d: e, at: a } = nth();
            if (value === undefined) delete a.list[a.i][key];
            else a.list[a.i][key] = null;
            expect(() => validate(e), `item ${k} ${key} ${value}`).not.toThrow();
            tried++;
          }
      }
    }
    expect(tried).toBeGreaterThan(1000);
  });

  it('the malformed documents the gate found: an error from validate, no throw from compile (F9)', async () => {
    const opts = { resolvers: DefaultResolvers, load: (id: string) => BetaCellResources[id]?.() };
    const d = exosomeDoc();
    const b = betaCellDoc();
    const c0 = d.compartments[0];
    const cases: MesoViewSpecDoc[] = [
      { ...d, compartments: [{ ...c0, geometry: { kind: 'ellipsoid' } as any }, ...d.compartments.slice(1)] },
      { ...d, relations: [{ id: 'r.x', kind: 'binds' } as any] },
      { ...d, entities: [null as any, ...d.entities] },
      { ...d, models: d.models!.map((m, i) => (i ? m : ({ ...m, populations: undefined } as any))) },
      { ...d, alignments: d.alignments!.map((a) => ({ ...a, transform: undefined }) as any) },
      { ...b, tours: [{ id: 't.x' } as any] },
      { ...d, views: [null as any] },
    ];
    for (const doc of cases) {
      expect(errors(doc).length, JSON.stringify(doc).slice(0, 0)).toBeGreaterThan(0);
      await expect(compile(doc, opts)).resolves.toBeDefined();
    }
  });

  it('a location, a detail and an arrangement kind are one of their words (F6, FN3, FN6)', () => {
    const b = betaCellDoc();
    const [g, r] = b.populations;
    const at = (doc: MesoViewSpecDoc) => errors(doc).map((i) => [i.code, i.path]);
    expect(at({ ...b, populations: [g, { ...r, location: 'surface' as 'interior' }] })).toEqual([
      ['value.range', '/populations/1/location'],
    ]);
    expect(at({ ...b, populations: [{ ...g, detail: 'part' as 'parts' }, r] })).toEqual([
      ['value.range', '/populations/0/detail'],
    ]);
    expect(at({ ...b, populations: [g, { ...r, arrangement: { kind: 'lattic' } as never }] })).toEqual([
      ['value.range', '/populations/1/arrangement/kind'],
    ]);
    const [i0, i1] = b.instances!;
    expect(at({ ...b, instances: [{ ...i0, location: 'membrne' as 'membrane' }, i1] })).toEqual([
      ['value.range', '/instances/0/location'],
    ]);
    expect(at({ ...b, instances: [i0, { ...i1, detail: 'body' as 'entity' }] })).toEqual([
      ['value.range', '/instances/1/detail'],
    ]);
    // an instance in a membrane its compartment does not declare, as a population there
    const bare = { ...b, compartments: b.compartments.map((c) => ({ ...c, membrane: undefined })) };
    expect(at({ ...bare, instances: [{ ...i0, location: 'membrane' as const }, i1] })).toEqual([
      ['location.membrane', '/instances/0/location'],
    ]);
  });

  it('two models refining one model is an overlap, naming both refiners (R3)', () => {
    const d = exosomeDoc();
    const refiner = (id: string) => ({
      id,
      kind: 'procedural' as const,
      method: 'meso.relax',
      populations: [],
      refines: 'm.recipe',
    });
    const one = { ...d, models: [...d.models!, refiner('m.r1')] };
    expect(errors(one)).toEqual([]);
    const two = { ...d, models: [...d.models!, refiner('m.r1'), refiner('m.r2')] };
    const e = errors(two);
    expect(e.map((i) => [i.code, i.path])).toEqual([['model.overlap', `/models/${d.models!.length + 1}/refines`]]);
    expect(e[0].ids).toEqual(['m.r1', 'm.r2']);
    // a chain (r2 refines r1 refines the recipe) is not an overlap
    expect(errors({ ...d, models: [...d.models!, refiner('m.r1'), { ...refiner('m.r2'), refines: 'm.r1' }] })).toEqual(
      [],
    );
  });

  it('annotation ids are ids: the pattern, and unique across the document (F7)', () => {
    const d = exosomeDoc();
    const k = d.views!.length;
    const withAnnotation = (id: string) => ({
      ...d,
      views: [...d.views!, { id: 'v.x', annotations: [{ id, target: '(all)', text: 't' }] }],
    });
    expect(errors(withAnnotation('bad id')).map((i) => [i.code, i.path])).toEqual([
      ['id.invalid', `/views/${k}/annotations/0/id`],
    ]);
    expect(errors(withAnnotation(d.entities[0].id)).map((i) => [i.code, i.path])).toEqual([
      ['id.duplicate', `/views/${k}/annotations/0/id`],
    ]);
  });

  it("a positioned annotation's evidence is checked too (FN7)", () => {
    const d = exosomeDoc();
    const k = d.views!.length;
    const v = {
      id: 'v.x',
      annotations: [{ id: 'an.x', target: { position: [0, 0, 0] }, text: 't', evidence: ['ev.nope'] }],
    };
    expect(errors({ ...d, views: [...d.views!, v] } as MesoViewSpecDoc).map((i) => [i.code, i.path])).toEqual([
      ['ref.missing', `/views/${k}/annotations/0/evidence/0`],
    ]);
  });

  it('a unit is a unit, not a property every object has (F10)', () => {
    const d = galleryDoc();
    const p = d.populations[1];
    const with_ = (abundance: object) =>
      errors({ ...d, populations: [d.populations[0], { ...p, abundance } as never, ...d.populations.slice(2)] }).map(
        (i) => i.code,
      );
    expect(with_({ concentration: { value: 1, unit: 'toString' } })).toEqual(['unit.unknown']);
    expect(with_({ density: { value: 1, unit: 'constructor' } })).toEqual(['unit.unknown']);
    expect(errors({ ...d, units: { length: 'toString' as 'nm' } }).map((i) => i.code)).toContain('unit.unknown');
  });
});

// Looks, for patches (prism.md §2.2): an optional id and an emissive.
describe('format: a look has an id and an emissive', () => {
  const withLook = (look: object) =>
    ({ ...exosomeDoc(), session: undefined, views: [{ id: 'v.x', looks: [look] }] }) as unknown as MesoViewSpecDoc;
  const codes = (d: MesoViewSpecDoc) =>
    validate(d)
      .filter((i) => i.severity === 'error')
      .map((i) => [i.code, i.path]);
  it('the id is optional, a word of the pattern, unique in the document', () => {
    expect(codes(withLook({ select: '(all)' }))).toEqual([]);
    expect(codes(withLook({ id: 'l.ok', select: '(all)', emissive: 0.4 }))).toEqual([]);
    expect(codes(withLook({ id: '9 no', select: '(all)' }))).toEqual([['id.invalid', '/views/0/looks/0/id']]);
    expect(codes(withLook({ id: 'e.catalase', select: '(all)' }))).toEqual([['id.duplicate', '/views/0/looks/0/id']]);
    const two = {
      ...exosomeDoc(),
      session: undefined,
      views: [
        {
          id: 'v.x',
          looks: [
            { id: 'l.a', select: '(all)' },
            { id: 'l.a', select: '(all)' },
          ],
        },
      ],
    } as unknown as MesoViewSpecDoc;
    expect(codes(two)).toEqual([['id.duplicate', '/views/0/looks/1/id']]);
  });
  it('emissive is in [0, 1]', () => {
    expect(codes(withLook({ select: '(all)', emissive: 1.5 }))).toEqual([['value.range', '/views/0/looks/0/emissive']]);
    expect(codes(withLook({ select: '(all)', emissive: -0.1 }))).toEqual([
      ['value.range', '/views/0/looks/0/emissive'],
    ]);
  });
});
