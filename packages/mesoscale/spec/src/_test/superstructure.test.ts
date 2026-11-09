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
import { evaluateMesoQL, lociSize, lociSphere, lociToIds } from '../ir/loci.js';
import { planCommit } from '../runtime/adapter.js';
import { flattenInstances } from '../runtime/instancing.js';
import { compile, updateView } from '../runtime/runtime.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { countingResolvers } from './helpers.js';

// Superstructures (_spec/format.md): reusable, nested, instanced. One description, resolved once, placed many times;
// both levels of detail from the same document; addresses and copy ids through the nesting.

const load = (id: string) => BetaCellResources[id]?.();
const PerGranule = 548 + 940 + 454 + 287;

const runsOf = (runs: readonly number[]) => {
  const out: number[] = [];
  for (let j = 0; j < runs.length; j += 2) for (let i = runs[j]; i < runs[j + 1]; i++) out.push(i);
  return out;
};
/** A template point moved by the pose of copy `i` of `set` (p' = q·p·q⁻¹ + t). */
function rotate(set: { positions: ArrayLike<number>; rotations: ArrayLike<number> }, i: number, p: number[]) {
  const [x, y, z, w] = [0, 1, 2, 3].map((k) => set.rotations[4 * i + k]);
  const [px, py, pz] = p;
  // t = 2 q×p; p' = p + w t + q×t
  const tx = 2 * (y * pz - z * py),
    ty = 2 * (z * px - x * pz),
    tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty) + set.positions[3 * i],
    py + w * ty + (z * tx - x * tz) + set.positions[3 * i + 1],
    pz + w * tz + (x * ty - y * tx) + set.positions[3 * i + 2],
  ];
}

/** Three outer bodies of four inner bodies of five x: superstructures two deep. */
const nested: MesoViewSpecDoc = {
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
      populations: [{ id: 'p.x', entity: 'e.x', compartment: 'c.in', location: 'interior', abundance: { count: 5 } }],
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

  // lane mvs-tree: an eye on a population drawn as parts hid only its (already hidden) instance spheres; its parts, the
  // expansions, took only the template's looks and stayed shown
  it('a look hiding a population drawn as parts hides its parts; one instance hidden hides that instance only', async () => {
    const r = await compile(betaCellDoc(), { resolvers: countingResolvers().resolvers, load });
    const hide = (select: string) =>
      flattenInstances(
        updateView({ ...betaCellDoc(), views: [{ id: 'v', looks: [{ select, visible: false }] }] }, r.ir!),
      ).ir;
    /** Whether every type of a drawn set is shown, by its last look (later looks win). */
    const shown = (ir: ReturnType<typeof hide>, key: string) => {
      const set = placementSets(ir).find((s) => s.key === key)!;
      return set.typeTable.every((t) => {
        const last = ir.view.looks.filter((l) => l.set === key && !l.runs && l.types.includes(t.index)).pop();
        return last?.visible !== false;
      });
    };
    const expansions = (ir: ReturnType<typeof hide>, of: string) =>
      placementSets(ir)
        .map((s) => s.key)
        .filter((k) => k.startsWith(`${of}|`));
    const base = r.ir!;
    const packed = placementSets(base).find((s) => s.typeTable.some((t) => t.population === 'p.granules'))!.key;
    const named = placementSets(base).find((s) => s.typeTable.some((t) => t.population === 'i.granule-docked'))!.key;
    const granules = hide('(population p.granules)');
    expect(expansions(granules, packed).length).toBeGreaterThan(0);
    for (const k of expansions(granules, packed)) expect(shown(granules, k)).toBe(false);
    for (const k of expansions(granules, named)) expect(shown(granules, k)).toBe(true);
    const docked = hide('(instance i.granule-docked)');
    const [dockedKey, deepKey] = ['0', '1'].map(
      (t) => expansions(docked, named).find((k) => k.startsWith(`${named}|${t}*`))!,
    );
    expect(shown(docked, dockedKey)).toBe(false);
    expect(shown(docked, deepKey)).toBe(true);
    for (const k of expansions(docked, packed)) expect(shown(docked, k)).toBe(true);
  });

  it('nests: a superstructure of superstructures, flattened through both levels', async () => {
    const doc = nested;
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
  it('nests: looks reach both levels of the flattening (inner bodies hidden over their parts, p.x colored)', async () => {
    const doc = { ...nested, views: [{ id: 'v', looks: [{ select: '(population p.x)', color: '#ff0000' }] }] };
    const r = await compile(doc, { resolvers: countingResolvers().resolvers });
    const f = flattenInstances(r.ir!);
    const sets = placementSets(f.ir);
    const keys = new Set(sets.map((s) => s.key));
    // every look lands on a set that is drawn
    expect(f.ir.view.looks.filter((l) => !keys.has(l.set))).toEqual([]);
    const typeOf = (s: (typeof sets)[number], pop: string) => s.typeTable.find((t) => t.population === pop)?.index;
    const looksOn = (pop: string) =>
      sets.flatMap((s) => {
        const t = typeOf(s, pop);
        return t === undefined
          ? []
          : [{ s, looks: f.ir.view.looks.filter((l) => l.set === s.key && l.types.includes(t)) }];
      });
    // the 12 inner bodies (4 in each of 3 outer) are drawn as their parts: their own type hidden
    const inner = looksOn('p.inner');
    expect(inner.reduce((n, x) => n + x.s.count, 0)).toBe(12);
    for (const x of inner) expect(x.looks.some((l) => l.visible === false)).toBe(true);
    // the 60 x, all red
    const xs = looksOn('p.x');
    expect(xs.reduce((n, x) => n + x.s.count, 0)).toBe(60);
    for (const x of xs) expect(x.looks.some((l) => l.color === 0xff0000)).toBe(true);
  });
  // review gate R1: `within` over copies inside one instance (`part`, virtual sets) reads them in the world
  it('within reads the copies of a part where they are in the world, on either side', async () => {
    const doc = betaCellDoc();
    const r = await compile(doc, { resolvers: DefaultResolvers, load });
    const kinds = indexDoc(doc).kinds as ReadonlyMap<string, string>;
    const ev = (q: string) => evaluateMesoQL(parseMesoQL(q, { kinds }).expr!, { doc, ir: r.ir! });
    const sets = placementSets(r.ir!);
    // brute force: the docked granule's Vamp2, moved by its pose; the ribosomes as they are
    const [[instKey, [i0]]] = [...ev('(instance i.granule-docked)').loci];
    const inst = sets.find((s) => s.key === instKey)!;
    const part = ev('(part (instance i.granule-docked) p.Vamp2)').loci;
    const [[virtual, vRuns]] = [...part];
    const tpl = sets.find((s) => s.key === virtual.slice(virtual.lastIndexOf('>') + 1))!;
    const vamp2 = runsOf(vRuns).map((i) =>
      rotate(inst, i0, [tpl.positions[3 * i], tpl.positions[3 * i + 1], tpl.positions[3 * i + 2]]),
    );
    const ribo = [...ev('(population p.ribosomes)').loci].flatMap(([k, runs]) => {
      const s = sets.find((x) => x.key === k)!;
      return runsOf(runs).map((i) => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]]);
    });
    const d = 500; // Å
    const near = (a: number[][], b: number[][]) =>
      a.filter((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= d)).length;
    const riboNear = near(ribo, vamp2);
    expect(riboNear).toBeGreaterThan(0);
    const a = ev('(within (population p.ribosomes) :of (part (instance i.granule-docked) p.Vamp2) :distance 50)');
    expect(lociSize(a.loci)).toBe(riboNear);
    const b = ev('(within (part (instance i.granule-docked) p.Vamp2) :of (population p.ribosomes) :distance 50)');
    expect([...b.loci.keys()]).toEqual([virtual]);
    expect(lociSize(b.loci)).toBe(near(vamp2, ribo));
    // and through a view (a cutaway), without throwing
    const v = {
      ...doc,
      views: [
        ...doc.views!,
        {
          id: 'v.x',
          cutaway: '(within (population p.ribosomes) :of (part (instance i.granule-docked) p.Vamp2) :distance 50)',
        },
      ],
      session: { view: 'v.x' },
    };
    expect(validate(v).filter((i) => i.severity === 'error')).toEqual([]);
    expect(
      updateView(v, r.ir!).view.cutaway!.reduce((n, c) => n + c.runs.reduce((x, e, j) => x + (j % 2 ? e : -e), 0), 0),
    ).toBe(riboNear);
  });
  // review gate R10: an address of a template set (copies of a population inside a superstructure) stands for its copies
  // in every instance; a spatial operation reads them there, never at the template's own coordinates
  it('within and the camera read a template population through every instance of it', async () => {
    const doc = betaCellDoc();
    const r = await compile(doc, { resolvers: DefaultResolvers, load });
    const kinds = indexDoc(doc).kinds as ReadonlyMap<string, string>;
    const ev = (q: string) => evaluateMesoQL(parseMesoQL(q, { kinds }).expr!, { doc, ir: r.ir! });
    // the same copies, spelled per instance (the path checked against brute force above)
    const every =
      '(or (part (population p.granules) p.Vamp2) (part (instance i.granule-docked) p.Vamp2) (part (instance i.granule-deep) p.Vamp2))';
    const of = ev('(within (population p.ribosomes) :of (population p.Vamp2) :distance 50)');
    expect(lociSize(of.loci)).toBeGreaterThan(0);
    expect(of.loci).toEqual(ev(`(within (population p.ribosomes) :of ${every} :distance 50)`).loci);
    const a = ev('(within (population p.Vamp2) :of (population p.ribosomes) :distance 50)');
    expect(lociSize(a.loci)).toBeGreaterThan(0);
    expect(a.loci).toEqual(ev(`(within ${every} :of (population p.ribosomes) :distance 50)`).loci);
    // the camera frames the Vamp2 of all 122 granules, across the cell, not one template at the origin
    const cam = (focus: string) =>
      updateView({ ...doc, views: [...doc.views!, { id: 'v.t', camera: { focus } }], session: { view: 'v.t' } }, r.ir!)
        .view.camera!;
    const c = cam('(population p.Vamp2)');
    const e = cam(every);
    // the same points, summed in another order
    expect(Math.hypot(...c.target.map((v, k) => v - e.target[k]))).toBeLessThan(1e-6);
    // the radius an upper bound (each instance's ball moved, not each copy), within a few per cent
    expect(c.focus!.radius).toBeGreaterThanOrEqual(e.focus!.radius - 1e-6);
    expect(c.focus!.radius).toBeLessThan(e.focus!.radius * 1.05);
    expect(c.focus!.radius).toBeGreaterThan(3000);
  });
  it('two superstructures deep: the camera frames every copy; within says what it leaves out', async () => {
    const r = await compile(nested, { resolvers: countingResolvers().resolvers });
    const kinds = indexDoc(nested).kinds as ReadonlyMap<string, string>;
    const ev = (q: string) => evaluateMesoQL(parseMesoQL(q, { kinds }).expr!, { doc: nested, ir: r.ir! });
    // 60 x in the world, spread over the 3 outer bodies: the flattening's positions are the reference
    const flat = placementSets(flattenInstances(r.ir!).ir).filter((s) =>
      s.typeTable.some((t) => t.population === 'p.x'),
    );
    const c = [0, 0, 0];
    for (const s of flat)
      for (let i = 0; i < s.count; i++) for (let k = 0; k < 3; k++) c[k] += s.positions[3 * i + k] / 60;
    const sphere = lociSphere(ev('(population p.x)').loci, r.ir!)!;
    expect(Math.hypot(...sphere.center.map((v, k) => v - c[k]))).toBeLessThan(1e-3);
    expect(ev('(within (population p.x) :of (all) :distance 10)').issues.map((i) => i.code)).toContain('mesoql.empty');
  });
  it('a look on a part names every type its runs cover (two populations merged into one run)', async () => {
    const doc = betaCellDoc();
    const r = await compile(doc, { resolvers: DefaultResolvers, load });
    const select = '(or (part (instance i.granule-docked) p.Vamp2) (part (instance i.granule-docked) p.Rab3a))';
    const ir = updateView(
      { ...doc, views: [{ id: 'v.o', looks: [{ select, color: '#00ff00' }] }], session: { view: 'v.o' } },
      r.ir!,
    );
    const [look] = ir.view.looks.filter((l) => /@\d+>/.test(l.set));
    const tpl = placementSets(r.ir!).find((s) => s.key === look.set.slice(look.set.lastIndexOf('>') + 1))!;
    const covered = new Set<number>();
    for (let j = 0; j < look.runs!.length; j += 2)
      for (let i = look.runs![j]; i < look.runs![j + 1]; i++) covered.add(tpl.types[i]);
    expect([...look.types].sort()).toEqual([...covered].sort());
    expect(covered.size).toBe(2);
  });
});

/** Two superstructures and a cell that places both: a superstructure's contents are its own (_spec/format.md). */
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
