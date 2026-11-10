/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc } from '../examples/exosome.js';
import { placementSets } from '../ir/ir.js';
import { contentHash } from '../ir/hash.js';
import { BytesPerPlacement, placementBytes, rotateVec } from '../ir/placements.js';
import { planCommit } from '../runtime/adapter.js';
import { classifyEdit, compile, defaultColor, updateView } from '../runtime/runtime.js';
import { DefaultResolvers } from '../resolvers/index.js';
import type { Resolver } from '../runtime/resolver.js';
import { compileExosome, countingResolvers, editPopulation, exosomeOptions, recolor } from './helpers.js';

// The runtime's contracts (design.md §6–7) on the thin slice's document: deterministic results, a color edit that
// resolves nothing and keeps every placement object, a density edit that reruns exactly the model it touches, an unmet
// constraint explained, failures reported where they happen.

describe('runtime', () => {
  it('is deterministic: the same document, the same placements', async () => {
    const a = await compileExosome(exosomeDoc());
    const b = await compileExosome(exosomeDoc());
    const digest = (r: typeof a) => placementSets(r.ir!).map((s) => contentHash([s.positions, s.rotations, s.types]));
    expect(digest(a)).toEqual(digest(b));
    expect(a.stats.resolverRuns).toBe(3);
  });

  it('a color edit is a view edit: no resolver runs, the same placement objects', async () => {
    const counting = countingResolvers();
    const cache = new Map();
    const before = await compile(exosomeDoc(), exosomeOptions({ resolvers: counting.resolvers, cache }));
    expect(counting.total()).toBe(3);
    const edited = recolor(exosomeDoc(), 'p.miRNA', '#00ff00');
    expect(classifyEdit(exosomeDoc(), edited)).toBe('view');

    // the fast path: no compile at all
    const ir = updateView(edited, before.ir!);
    expect(ir.root).toBe(before.ir!.root);
    const look = ir.view.looks.find(
      (l) => placementSets(ir).find((s) => s.key === l.set)?.typeTable[l.types[0]].population === 'p.miRNA',
    );
    expect(look?.color).toBe(0x00ff00);

    // the full path, with the session's cache: every model a cache hit, every set the same object
    const after = await compile(edited, exosomeOptions({ resolvers: counting.resolvers, cache }));
    expect(counting.total()).toBe(3);
    expect(after.stats).toMatchObject({ resolverRuns: 0, cacheHits: 3 });
    const sb = placementSets(before.ir!),
      sa = placementSets(after.ir!);
    sa.forEach((s, i) => expect(s).toBe(sb[i]));
    const plan = planCommit(before.ir, ir);
    expect(plan).toMatchObject({ add: [], remove: [], looksChanged: true });
    expect(plan.keep.length).toBe(3);
  });

  it('a density edit reruns the model it touches, and only that one', async () => {
    const counting = countingResolvers();
    const cache = new Map();
    const before = await compile(exosomeDoc(), exosomeOptions({ resolvers: counting.resolvers, cache }));
    const edited = editPopulation(exosomeDoc(), 'p.miRNA', (p) => ({
      ...p,
      abundance: { concentration: { value: 0.0008, unit: 'M' } },
    }));
    expect(classifyEdit(exosomeDoc(), edited)).toBe('model');
    const after = await compile(edited, exosomeOptions({ resolvers: counting.resolvers, cache }));
    expect(after.stats).toMatchObject({ resolverRuns: 1, cacheHits: 2 });
    expect(counting.calls.get('cellpack-gpu')).toBe(2);
    expect(after.counts['p.miRNA'].requested).toBe(2 * before.counts['p.miRNA'].requested!);
    const plan = planCommit(before.ir, after.ir!);
    expect(plan.add.map((s) => s.model)).toEqual(['m.recipe']);
    expect(plan.remove.length).toBe(1);
    expect(plan.keep.length).toBe(2);
  });

  it('an unmet constraint says what was asked, what came out and why', async () => {
    const r = await compileExosome(exosomeDoc());
    const unmet = r.issues.filter((i) => i.code === 'constraint.unmet');
    expect(unmet.map((i) => i.ids?.[0])).toEqual(['p.catalase']);
    const c = unmet[0].constraint!;
    expect(c.requested).toBe(506);
    expect(c.achieved).toBeLessThan(506);
    expect(c.achieved).toBeGreaterThan(200);
    expect(c.reason).toMatch(/fit in the inside of exosome, now \d+% filled/);
    // fewer asked: met
    const fewer = await compileExosome(
      editPopulation(exosomeDoc(), 'p.catalase', (p) => ({ ...p, abundance: { count: 150 } })),
    );
    expect(fewer.issues.filter((i) => i.code === 'constraint.unmet')).toEqual([]);
    // a looser constraint: met, at the same placements
    const loose = await compileExosome(
      editPopulation(exosomeDoc(), 'p.catalase', (p) => ({
        ...p,
        constraints: [{ kind: 'placed-fraction', min: 0.5 }],
      })),
    );
    expect(loose.issues.filter((i) => i.code === 'constraint.unmet')).toEqual([]);
  });

  it('procedural copies avoid the precomputed ones', async () => {
    const r = await compileExosome(exosomeDoc());
    const [picks, recipe] = ['m.picks', 'm.recipe'].map((m) => placementSets(r.ir!).find((s) => s.model === m)!);
    let closest = Infinity;
    for (let i = 0; i < recipe.count; i++)
      for (let j = 0; j < picks.count; j++) {
        const d = Math.hypot(...[0, 1, 2].map((k) => recipe.positions[3 * i + k] - picks.positions[3 * j + k]));
        closest = Math.min(
          closest,
          d - recipe.typeTable[recipe.types[i]].radius - picks.typeTable[picks.types[j]].radius,
        );
      }
    expect(closest).toBeGreaterThanOrEqual(-1e-3);
  });

  it('frames: picks in voxels end in the world frame in Å', async () => {
    const r = await compileExosome(exosomeDoc());
    const picks = placementSets(r.ir!).find((s) => s.model === 'm.picks')!;
    expect(picks.count).toBe(24);
    // within 30 nm of the vesicle centre, which the alignment puts at the origin
    for (let i = 0; i < picks.count; i++)
      expect(
        Math.hypot(picks.positions[3 * i], picks.positions[3 * i + 1], picks.positions[3 * i + 2]),
      ).toBeLessThanOrEqual(300.5);
  });

  it('placement sets are 36 bytes a copy, with at most 1/8 unused capacity behind them', async () => {
    const r = await compileExosome(exosomeDoc());
    for (const s of placementSets(r.ir!)) {
      expect(placementBytes(s) - (s.fibers ? s.fibers.offsets.byteLength + s.fibers.indices.byteLength : 0)).toBe(
        s.count * BytesPerPlacement,
      );
      expect(s.positions.buffer.byteLength).toBeLessThanOrEqual(Math.ceil((s.count * 12 * 8) / 7) + 12 * 16);
    }
  });

  it('membrane proteins point their axis along the normal', async () => {
    const r = await compileExosome(exosomeDoc());
    const s = placementSets(r.ir!).find((x) => x.model === 'm.recipe')!;
    const rab = s.typeTable.find((t) => t.population === 'p.RAB5A')!;
    // RAB5A's principal vector is -z: its rotation turns -z onto the outward normal, which for this near-sphere
    // points away from the centre
    const v = [0, 0, 0];
    let agree = 0,
      n = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.types[i] !== rab.index) continue;
      rotateVec(v, s.rotations.subarray(4 * i, 4 * i + 4), 0, 0, -1);
      const p = s.positions.subarray(3 * i, 3 * i + 3);
      agree += v[0] * p[0] + v[1] * p[1] + v[2] * p[2] > 0 ? 1 : 0;
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(agree / n).toBeGreaterThan(0.95);
  });

  it('an unavailable resource fails its model and the models that avoid it, and says so', async () => {
    const r = await compile(
      exosomeDoc(),
      exosomeOptions({ load: (id) => (id === 'r.picks' ? undefined : exosomeOptions().load!(id)) }),
    );
    const by = (code: string) => r.issues.filter((i) => i.code === code).map((i) => i.ids?.[0]);
    expect(by('resource.unavailable')).toEqual(['r.picks']);
    expect(by('resolver.failed').sort()).toEqual(['m.picks', 'm.recipe']);
    expect(placementSets(r.ir!).map((s) => s.model)).toEqual(['default:meso.bilayer']);
  });

  it('an unknown method is reported, the rest resolves', async () => {
    const d = exosomeDoc();
    const r = await compileExosome({
      ...d,
      models: d.models!.map((m) => (m.id === 'm.picks' ? { ...m, method: 'nobody' } : m)),
    });
    expect(r.issues.find((i) => i.code === 'resolver.unknown')?.ids).toContain('m.picks');
  });

  it('a new recipe kind plugs in as a resolver, without touching the format or the IR', async () => {
    // a toy recipe kind: copies on a cubic grid inside the compartment's bounds
    const Grid: Resolver<{ n: number; spacing: number; pops: string[] }> = {
      id: 'toy.grid',
      version: '1',
      description: 'copies on a cubic grid',
      arrangements: ['random'],
      locations: ['interior'],
      project: (job) => ({
        n: job.populations[0].requested ?? 0,
        spacing: Number(job.model.params?.spacing ?? 100),
        pops: job.populations.map((p) => p.id),
      }),
      resolve: (input, job) => {
        const p = job.populations[0];
        const positions = new Float32Array(input.n * 3);
        for (let i = 0; i < input.n; i++)
          positions.set(
            [(i % 5) * input.spacing, (Math.floor(i / 5) % 5) * input.spacing, Math.floor(i / 25) * input.spacing],
            3 * i,
          );
        const rotations = new Float32Array(input.n * 4);
        for (let i = 0; i < input.n; i++) rotations[4 * i + 3] = 1;
        return {
          sets: [
            {
              key: '',
              model: job.model.id,
              frame: 'world',
              count: input.n,
              positions,
              rotations,
              types: new Int32Array(input.n),
              ordinals: Int32Array.from({ length: input.n }, (_, i) => i),
              typeTable: [
                {
                  index: 0,
                  population: p.id,
                  entity: p.entity.id,
                  label: p.entity.label,
                  compartment: p.compartment,
                  radius: 10,
                },
              ],
            },
          ],
          achieved: { [p.id]: input.n },
        };
      },
    };
    const d = exosomeDoc();
    const doc = {
      ...d,
      models: [
        ...d.models!.map((m) =>
          m.id === 'm.recipe' ? { ...m, populations: m.populations.filter((x) => x !== 'p.miRNA') } : m,
        ),
        {
          id: 'm.grid',
          kind: 'procedural' as const,
          method: 'toy.grid',
          populations: ['p.miRNA'],
          params: { spacing: 50 },
        },
      ],
    };
    const r = await compile(doc, exosomeOptions({ resolvers: [...DefaultResolvers, Grid] }));
    const s = placementSets(r.ir!).find((x) => x.model === 'm.grid')!;
    expect(s.count).toBe(r.counts['p.miRNA'].requested);
    expect(r.ir!.view.looks.some((l) => l.set === s.key)).toBe(true);
  });
});

describe('views', () => {
  it('switching the session view derives its looks, selection and hints over the same IR', async () => {
    const r = await compileExosome(exosomeDoc());
    const lumen = { ...exosomeDoc(), session: { view: 'v.lumen' } };
    expect(classifyEdit(exosomeDoc(), lumen)).toBe('view');
    const ir = updateView(lumen, r.ir!);
    expect(ir.root).toBe(r.ir!.root);
    const sets = placementSets(ir);
    const typeOf = (l: { set: string; types: readonly number[] }) =>
      sets.find((s) => s.key === l.set)!.typeTable[l.types[0]];
    const hidden = ir.view.looks
      .filter((l) => l.visible === false)
      .map((l) => typeOf(l).population)
      .sort();
    expect(hidden).toEqual(['p.ALB', 'p.TF', 'p.lipids']);
    expect(
      ir.view.selection?.flatMap((s) => [
        ...new Set(
          Array.from(
            { length: s.runs.length / 2 },
            (_, k) =>
              sets.find((x) => x.key === s.set)!.typeTable[sets.find((x) => x.key === s.set)!.types[s.runs[2 * k]]]
                .population,
          ),
        ),
      ]),
    ).toEqual(['p.catalase.observed']);
    const hinted = ir.view.looks
      .filter((l) => l.representation === 'structure')
      .map((l) => typeOf(l).population)
      .sort();
    expect(hinted).toEqual(['p.catalase', 'p.catalase.observed']);
    expect(ir.view.camera?.position).toEqual([0, 0, 1600]);
  });
  // review gate R12: tours and metadata are session state, not scene
  it('a tour or title edit is a view edit, and updateView carries the new title', async () => {
    const doc = exosomeDoc();
    const r = await compileExosome(doc);
    const toured = { ...doc, tours: [{ id: 't', steps: [{ view: doc.views![0].id, duration: 1000 }] }] };
    expect(classifyEdit(doc, toured)).toBe('view');
    const renamed = { ...doc, metadata: { ...doc.metadata, title: 'renamed' } };
    expect(classifyEdit(doc, renamed)).toBe('view');
    const ir = updateView(renamed, r.ir!);
    expect((ir.root.params as { title: string }).title).toBe('renamed');
    expect(placementSets(ir)).toEqual(placementSets(r.ir!));
  });
  it('content hashes see into maps and sets', () => {
    expect(contentHash(new Map([['a', 1]]))).not.toBe(contentHash(new Map([['a', 2]])));
    expect(contentHash(new Set([1]))).not.toBe(contentHash(new Set([2])));
    expect(contentHash(new Set([1, 2]))).toBe(contentHash(new Set([2, 1])));
  });
});

describe('looks: emissive', () => {
  it('a look with an emissive reaches the IR look of its types', async () => {
    const r = await compile(exosomeDoc(), exosomeOptions());
    const doc = exosomeDoc();
    const edited = {
      ...doc,
      views: doc.views!.map((v) =>
        v.id === 'v.overview' ? { ...v, looks: [...v.looks!, { select: '(population p.miRNA)', emissive: 0.7 }] } : v,
      ),
    };
    const ir = updateView(edited, r.ir!);
    const pop = (l: { set: string; types: readonly number[] }) =>
      placementSets(ir).find((s) => s.key === l.set)?.typeTable[l.types[0]].population;
    expect(ir.view.looks.find((l) => pop(l) === 'p.miRNA')?.emissive).toBe(0.7);
    expect(ir.view.looks.filter((l) => l.emissive !== undefined).length).toBe(1);
  });

  it('a stated color is kept apart from the default one (prism.md §5.3): defaults are marked, stated ones are not', async () => {
    const r = await compile(exosomeDoc(), exosomeOptions());
    const doc = exosomeDoc();
    const edited = {
      ...doc,
      session: undefined,
      views: [
        {
          id: 'v.t',
          looks: [
            { select: '(population p.miRNA)', color: '#00ff00' },
            { select: '(population p.lipids)', visible: false },
          ],
        },
      ],
    };
    const ir = updateView(edited, r.ir!);
    const pop = (l: { set: string; types: readonly number[] }) =>
      placementSets(ir).find((s) => s.key === l.set)?.typeTable[l.types[0]].population;
    const whole = ir.view.looks.filter((l) => !l.runs);
    const miRNA = whole.find((l) => pop(l) === 'p.miRNA')!;
    expect(miRNA.color).toBe(0x00ff00);
    expect(miRNA.colorDefault).toBeUndefined();
    // hidden, its color not stated: still the default, marked so
    const lipids = whole.find((l) => pop(l) === 'p.lipids')!;
    expect(lipids).toMatchObject({ visible: false, color: defaultColor('p.lipids'), colorDefault: true });
    for (const l of whole) if (pop(l) !== 'p.miRNA') expect(l.colorDefault).toBe(true);
  });
});
