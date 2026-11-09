/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import { parseMesoQL } from '../format/mesoql.js';
import { indexDoc, validate } from '../format/validate.js';
import { placementSets, walk } from '../ir/ir.js';
import { evaluateMesoQL, lociSize, lociToIds } from '../ir/loci.js';
import { planCommit } from '../runtime/adapter.js';
import { flattenInstances } from '../runtime/instancing.js';
import { compile, updateView } from '../runtime/runtime.js';
import { countingResolvers } from './helpers.js';

// Superstructures (design.md §3.9): reusable, nested, instanced. One description, resolved once, placed many times;
// both levels of detail from the same document; addresses and copy ids through the nesting.

const load = (id: string) => BetaCellResources[id]?.();
const PerGranule = 548 + 940 + 454 + 287;

describe('superstructures', () => {
  it('the granule is resolved once, its 120 copies are poses', async () => {
    const counting = countingResolvers();
    const r = await compile(betaCellDoc(), { resolvers: counting.resolvers, load });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(counting.calls.get('cellpack-gpu')).toBe(1);
    const nodes = [...walk(r.ir!.root)].map(([n]) => n);
    // one instances node per population: the packed 120, and each granule the document names (a population of one)
    const inst = nodes.filter((n) => n.kind === 'instances').map((n) => n.params as { instances: number });
    expect(inst.every((p) => (p as unknown as { superstructure: string }).superstructure === 's.isg')).toBe(true);
    expect(inst.map((p) => p.instances).sort((x, y) => x - y)).toEqual([1, 1, 120]);
    const ss = nodes.find((n) => n.kind === 'superstructure')!;
    expect(ss.params).toMatchObject({ superstructure: 's.isg', copies: PerGranule });
    expect(ss.children?.every((c) => c.ref.startsWith('s.isg/'))).toBe(true);
  });

  it('flattened for a renderer without nested instancing: (120 + 2 named) × the template, cached across view edits', async () => {
    const r = await compile(betaCellDoc(), { resolvers: countingResolvers().resolvers, load });
    const cache = new Map();
    const a = flattenInstances(r.ir!, cache);
    expect(a.expandedCopies).toBe(122 * PerGranule);
    expect(a.expandedBytes / a.instancedBytes).toBeGreaterThan(100);
    // the granules' own copies are hidden when drawn as parts; the template's looks follow its expansion
    const vamp = a.ir.view.looks.filter((l) => l.set.includes('*') && l.color === 0xd0453a);
    expect(vamp.length).toBe(3); // the population's expansion and each named granule's
    const recolored = {
      ...betaCellDoc(),
      views: [{ ...betaCellDoc().views![0], looks: [{ select: '(population p.Chga)', color: '#ffffff' }] }],
    };
    const b = flattenInstances(updateView(recolored, r.ir!), cache);
    expect(planCommit(a.ir, b.ir)).toMatchObject({ add: [], remove: [] });
  });

  it('more granules: the template is a cache hit, only the cell packing reruns', async () => {
    const counting = countingResolvers();
    const cache = new Map();
    await compile(betaCellDoc(120), { resolvers: counting.resolvers, load, cache });
    const r = await compile(betaCellDoc(150), { resolvers: counting.resolvers, load, cache });
    expect(counting.calls.get('cellpack-gpu')).toBe(1);
    expect(counting.calls.get('meso.pack')).toBe(2);
    expect(r.counts['p.granules'].achieved).toBe(150);
  });

  it('detail entity: the same document drawn as one body a granule; the granules keep their places', async () => {
    const counting = countingResolvers();
    const cache = new Map();
    const parts = await compile(betaCellDoc(120, 'parts'), { resolvers: counting.resolvers, load, cache });
    const bodies = await compile(betaCellDoc(120, 'entity'), { resolvers: counting.resolvers, load, cache });
    expect(bodies.stats.resolverRuns).toBe(0);
    const cellSet = (r: typeof parts) => placementSets(r.ir!).find((s) => s.model === 'default:meso.pack')!;
    expect(cellSet(bodies)).toBe(cellSet(parts));
    expect([...walk(bodies.ir!.root)].some(([n]) => n.kind === 'superstructure')).toBe(false);
    expect(flattenInstances(bodies.ir!).expandedCopies).toBe(0);
  });

  it('addresses through the nesting: one granule, its Vamp2, ids that say which granule', async () => {
    const r = await compile(betaCellDoc(), { resolvers: countingResolvers().resolvers, load });
    const kinds = indexDoc(betaCellDoc()).kinds as ReadonlyMap<string, string>;
    const p = parseMesoQL('(part (copies p.granules 12) p.Vamp2)', { kinds });
    expect(p.issues).toEqual([]);
    const { loci } = evaluateMesoQL(p.expr!, { doc: betaCellDoc(), ir: r.ir! });
    expect(lociSize(loci)).toBe(548);
    expect(lociToIds(loci, r.ir!, 2)).toEqual(['p.granules#12/p.Vamp2#0', 'p.granules#12/p.Vamp2#1']);
    // (population p.Vamp2) is the template's: every granule's Vamp2 at once, 548 entries however many granules
    const all = evaluateMesoQL(parseMesoQL('(population p.Vamp2)', { kinds }).expr!, { doc: betaCellDoc(), ir: r.ir! });
    expect(lociSize(all.loci)).toBe(548);
  });

  it("a look on one granule's Vamp2 lands on that granule's block of the expansion", async () => {
    const r = await compile(betaCellDoc(), { resolvers: countingResolvers().resolvers, load });
    const doc = {
      ...betaCellDoc(),
      views: [{ id: 'v', looks: [{ select: '(part (copies p.granules 12) p.Vamp2)', color: '#00ff00' }] }],
    };
    const ir = updateView(doc, r.ir!);
    const virtual = ir.view.looks.filter((l) => /@\d+>/.test(l.set));
    expect(virtual.length).toBe(1);
    const flat = flattenInstances(ir).ir;
    const placed = flat.view.looks.filter((l) => l.color === 0x00ff00);
    expect(placed.length).toBe(1);
    const [start, end] = placed[0].runs!;
    expect(end - start).toBe(548);
    expect(Math.floor(start / PerGranule)).toBe(12);
  });

  it('nests: a superstructure of superstructures, flattened through both levels', async () => {
    const doc: MesoViewSpecDoc = {
      format: 'meso_view_spec',
      version: '0.2.0',
      metadata: { title: 'nested' },
      units: { length: 'nm' },
      entities: [
        { id: 'e.x', label: 'x', kind: 'protein', radius: 2 },
        { id: 'e.inner', label: 'inner body', kind: 'assembly', superstructure: 's.inner' },
        { id: 'e.outer', label: 'outer body', kind: 'assembly', superstructure: 's.outer' },
      ],
      superstructures: [
        {
          id: 's.inner',
          label: 'inner',
          compartments: [{ id: 'c.in', label: 'in', kind: 'vesicle', geometry: { kind: 'sphere', radius: 12 } }],
          populations: [
            { id: 'p.x', entity: 'e.x', compartment: 'c.in', location: 'interior', abundance: { count: 5 } },
          ],
        },
        {
          id: 's.outer',
          label: 'outer',
          compartments: [{ id: 'c.out', label: 'out', kind: 'vesicle', geometry: { kind: 'sphere', radius: 80 } }],
          populations: [
            { id: 'p.inner', entity: 'e.inner', compartment: 'c.out', location: 'interior', abundance: { count: 4 } },
          ],
        },
      ],
      compartments: [{ id: 'c.top', label: 'top', kind: 'cell', geometry: { kind: 'sphere', radius: 400 } }],
      populations: [
        { id: 'p.outer', entity: 'e.outer', compartment: 'c.top', location: 'interior', abundance: { count: 3 } },
      ],
    };
    expect(validate(doc).filter((i) => i.severity === 'error')).toEqual([]);
    const r = await compile(doc, { resolvers: countingResolvers().resolvers });
    const f = flattenInstances(r.ir!);
    const drawn = placementSets(f.ir).filter((s) => s.typeTable.some((t) => t.population === 'p.x'));
    expect(drawn.reduce((n, s) => n + s.count, 0)).toBe(3 * 4 * 5);
  });

  it('a superstructure that contains itself is refused', () => {
    const d = betaCellDoc();
    const looped = {
      ...d,
      superstructures: [
        {
          ...d.superstructures![0],
          populations: [
            ...d.superstructures![0].populations,
            {
              id: 'p.self',
              entity: 'e.granule',
              compartment: 'c.isg',
              location: 'interior' as const,
              abundance: { count: 1 },
            },
          ],
        },
      ],
    };
    expect(validate(looped).map((i) => i.code)).toContain('superstructure.cycle');
  });
});

/** Two superstructures and a cell that places both: a superstructure's contents are its own (design.md §3.9). */
function twoSuperstructures(): MesoViewSpecDoc {
  return {
    format: 'meso_view_spec',
    version: '0.3.0',
    metadata: { title: 'two superstructures' },
    units: { length: 'nm' },
    entities: [
      { id: 'e.body-a', label: 'a', kind: 'assembly', superstructure: 's.a' },
      { id: 'e.body-b', label: 'b', kind: 'assembly', superstructure: 's.b' },
    ],
    superstructures: [
      {
        id: 's.a',
        label: 'a',
        entities: [{ id: 'e.only-a', label: 'only in a', kind: 'protein', radius: 2 }],
        compartments: [{ id: 'c.a', label: 'a', kind: 'vesicle', geometry: { kind: 'sphere', radius: 20 } }],
        populations: [
          { id: 'p.a', entity: 'e.only-a', compartment: 'c.a', location: 'interior', abundance: { count: 3 } },
        ],
      },
      {
        id: 's.b',
        label: 'b',
        compartments: [{ id: 'c.b', label: 'b', kind: 'vesicle', geometry: { kind: 'sphere', radius: 20 } }],
        populations: [],
      },
    ],
    compartments: [{ id: 'c.top', label: 'top', kind: 'cell', geometry: { kind: 'sphere', radius: 400 } }],
    populations: [
      { id: 'p.as', entity: 'e.body-a', compartment: 'c.top', location: 'interior', abundance: { count: 2 } },
      { id: 'p.bs', entity: 'e.body-b', compartment: 'c.top', location: 'interior', abundance: { count: 2 } },
    ],
  };
}

describe('a superstructure keeps its contents to itself', () => {
  const errs = (d: MesoViewSpecDoc) =>
    validate(d)
      .filter((i) => i.severity === 'error')
      .map((i) => [i.code, i.path]);

  it('the document is valid, and MesoQL still addresses inner populations', () => {
    const d = twoSuperstructures();
    expect(errs(d)).toEqual([]);
    expect(errs({ ...d, views: [{ id: 'v', looks: [{ select: '(part (population p.as) p.a)' }] }] })).toEqual([]);
  });

  it('the document refers to no compartment, entity or population inside a superstructure (F1)', async () => {
    const d = twoSuperstructures();
    const p0 = d.populations[0];
    const cases: [MesoViewSpecDoc, string][] = [
      [{ ...d, populations: [{ ...p0, compartment: 'c.a' }, d.populations[1]] }, '/populations/0/compartment'],
      [
        { ...d, populations: [...d.populations, { ...p0, id: 'p.loose', entity: 'e.only-a' }] },
        '/populations/2/entity',
      ],
      [
        {
          ...d,
          instances: [{ id: 'i.x', entity: 'e.body-a', compartment: 'c.a', pose: { translation: [0, 0, 0] } }],
        },
        '/instances/0/compartment',
      ],
      [
        { ...d, models: [{ id: 'm.top', kind: 'procedural', method: 'meso.pack', populations: ['p.a'] }] },
        '/models/0/populations/0',
      ],
      [{ ...d, relations: [{ id: 'r.x', kind: 'binds', subjects: ['p.a'] }] }, '/relations/0/subjects/0'],
    ];
    for (const [doc, path] of cases) {
      expect(errs(doc)).toContainEqual(['ref.missing', path]);
      // refused before the runtime, which would throw or ignore it
      const r = await compile(doc, { resolvers: countingResolvers().resolvers });
      expect(r.issues.some((i) => i.severity === 'error' && i.path === path)).toBe(true);
    }
  });

  it("a superstructure does not see a sibling superstructure's contents (FN1)", () => {
    const d = twoSuperstructures();
    const [a, b] = d.superstructures!;
    const bad = {
      ...d,
      superstructures: [
        a,
        {
          ...b,
          populations: [
            {
              id: 'p.b',
              entity: 'e.only-a',
              compartment: 'c.a',
              location: 'interior' as const,
              abundance: { count: 1 },
            },
          ],
        },
      ],
    };
    expect(errs(bad)).toEqual(
      expect.arrayContaining([
        ['ref.missing', '/superstructures/1/populations/0/entity'],
        ['ref.missing', '/superstructures/1/populations/0/compartment'],
      ]),
    );
  });

  it('a problem inside a superstructure is reported at its path, once, and refuses the compile (F4, FN4)', async () => {
    const d = twoSuperstructures();
    const [a, b] = d.superstructures!;
    const withInner = (e: Partial<NonNullable<typeof a.entities>[number]>) => ({
      ...d,
      superstructures: [{ ...a, entities: [{ ...a.entities![0], ...e }] }, b],
    });
    expect(errs(withInner({ radius: -5 }))).toEqual([['value.range', '/superstructures/0/entities/0/radius']]);
    expect(errs(withInner({ id: 'bad id' }))).toContainEqual(['id.invalid', '/superstructures/0/entities/0/id']);
    const r = await compile(withInner({ radius: -5 }), { resolvers: countingResolvers().resolvers });
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.path)).toEqual([
      '/superstructures/0/entities/0/radius',
    ]);
    // a document entity a superstructure uses is the document's: reported once, at its own path
    const top = { ...d, entities: [...d.entities, { id: 'e.top', label: 't', kind: 'protein' as const, radius: -1 }] };
    expect(errs(top)).toEqual([['value.range', '/entities/2/radius']]);
  });
});
