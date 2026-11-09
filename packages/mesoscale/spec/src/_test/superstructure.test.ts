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
import { DefaultResolvers } from '../resolvers/index.js';
import { countingResolvers } from './helpers.js';

// Superstructures (design.md §3.9): reusable, nested, instanced. One description, resolved once, placed many times;
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
});
