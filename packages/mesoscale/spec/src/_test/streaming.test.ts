/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { tiledFixture } from '../examples/streaming.js';
import type { Box, MesoViewSpecDoc, TileManifest } from '../format/doc.js';
import type { Issue } from '../format/issues.js';
import { DocumentCodec, printData, readData } from '../format/sexpr.js';
import { validate, validateManifest } from '../format/validate.js';
import { type IR, type IRNode, irToJson, placementSets, walk } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { createRandom } from '../runtime/random.js';
import { compile, updateView } from '../runtime/runtime.js';
import {
  level0IR,
  planStream,
  type StreamState,
  streamNode,
  type TilePayload,
  type TileProvider,
  TileStreamer,
  tileSet,
  withTiles,
} from '../runtime/streaming.js';

// Streaming (design.md §6.8), quick lane: the format's rules, the manifest's, the planner, the sets, the camera over
// level 0 and the streamer against the fixture's provider.

const small = { grid: [3, 3, 1] as const, perTile: { 'p.a': 20, 'p.b': 10 } };
const { doc, provider } = tiledFixture(small);
const tiles = (p: TileProvider) => (r: string) => (r === 'r.tiles' ? p : undefined);
const open = (d: MesoViewSpecDoc = doc, p: TileProvider = provider) =>
  compile(d, { resolvers: DefaultResolvers, tiles: tiles(p) });
const manifest = () => provider.manifest();
const codes = (xs: readonly Issue[]) => xs.map((i) => i.code);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withView = (d: MesoViewSpecDoc, view: string): MesoViewSpecDoc => ({ ...d, session: { ...d.session, view } });

describe('stream: static validation', () => {
  const model = doc.models![0];
  const edit = (f: (d: MesoViewSpecDoc) => Partial<MesoViewSpecDoc>) => validate({ ...doc, ...f(doc) });
  const resource = (r: object) => edit((d) => ({ resources: d.resources!.map((x) => ({ ...x, ...r })) }));
  const other = { id: 'm.x', kind: 'procedural' as const, method: 'meso.pack', populations: [] };

  it('the fixture is valid', () => {
    expect(validate(doc).filter((i) => i.severity === 'error')).toEqual([]);
    // its populations count as realized, and no default resolver takes them
    expect(codes(validate(doc))).not.toContain('model.unrealized');
  });

  it.each([
    ['a missing resource', () => edit((d) => ({ resources: d.resources!.slice(1) })), 'ref.missing'],
    ['a resource of another kind', () => resource({ kind: 'mesh' }), 'ref.kind'],
    ['a resource of another format', () => resource({ format: 'obj' }), 'value.range'],
    [
      'a model that is not precomputed',
      () => edit((d) => ({ models: [{ ...model, kind: 'procedural' as const }, ...d.models!.slice(1)] })),
      'value.range',
    ],
    [
      'a model with another method',
      () => edit((d) => ({ models: [{ ...model, method: 'meso.pack' }, ...d.models!.slice(1)] })),
      'value.range',
    ],
    [
      'a resource in another frame',
      () =>
        edit((d) => ({
          frames: [
            ...d.frames!,
            { id: 'f.other', kind: 'instrument' as const, units: 'A' as const, handedness: 'right' as const },
          ],
          resources: d.resources!.map((x) => ({ ...x, frame: 'f.other' })),
        })),
      'stream.unsupported',
    ],
    [
      'a model that avoids',
      () => edit((d) => ({ models: [{ ...model, avoid: ['m.x'] }, other] })),
      'stream.unsupported',
    ],
    [
      'a model that refines',
      () => edit((d) => ({ models: [{ ...model, refines: 'm.x' }, other] })),
      'stream.unsupported',
    ],
    [
      'a model avoided by another',
      () => edit((d) => ({ models: [...d.models!, { ...other, avoid: ['m.tiles'] }] })),
      'stream.unsupported',
    ],
    [
      'a model refined by another',
      () => edit((d) => ({ models: [...d.models!, { ...other, refines: 'm.tiles' }] })),
      'stream.unsupported',
    ],
    [
      'an entity with a superstructure',
      () =>
        edit((d) => ({
          entities: d.entities.map((e) => (e.id === 'e.a' ? { ...e, superstructure: 'ss.x' } : e)),
          superstructures: [
            {
              id: 'ss.x',
              label: 'x',
              compartments: [
                {
                  id: 'c.ss',
                  label: 'ss',
                  kind: 'vesicle' as const,
                  geometry: { kind: 'sphere' as const, radius: 10 },
                },
              ],
              populations: [],
            },
          ],
        })),
      'stream.unsupported',
    ],
    [
      'a second stream model',
      () =>
        edit((d) => ({
          models: [
            ...d.models!,
            { ...other, kind: 'precomputed' as const, method: 'meso.stream', stream: model.stream },
          ],
        })),
      'stream.unsupported',
    ],
    [
      'a population realized twice',
      () => edit((d) => ({ models: [...d.models!, { ...other, populations: ['p.a'] }] })),
      'model.overlap',
    ],
  ] as const)('%s', (_, make, code) => {
    expect(codes(make())).toContain(code);
  });

  it('the stream round-trips through the S-expression spelling', () => {
    const text = printData(doc, DocumentCodec);
    expect(text).toContain(':stream');
    const back = readData(text, DocumentCodec);
    expect(back.error).toBeUndefined();
    expect(back.value).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(printData(back.value, DocumentCodec)).toBe(text);
  });
});

describe('validateManifest', () => {
  const model = doc.models![0];
  const check = async (f: (m: TileManifest) => Partial<TileManifest>) => {
    const m = await manifest();
    return validateManifest({ ...m, ...f(m) }, model, doc);
  };
  const tile0 = (m: TileManifest, t: Partial<TileManifest['tiles'][number]>) => [
    { ...m.tiles[0], ...t },
    ...m.tiles.slice(1),
  ];
  const box = (min: number[], max: number[]) => ({ min, max }) as Box;

  it('the fixture manifest is valid, with its path and phase', async () => {
    expect(validateManifest(await manifest(), model, doc)).toEqual([]);
    const [i] = await check(() => ({ levels: [1] }));
    expect([i.code, i.phase, i.path]).toEqual(['stream.manifest', 'load', '/models/0/stream']);
  });

  it.each([
    ['a format that is not meso-tiles', () => ({ format: 'x' as 'meso-tiles' })],
    ['levels without 0', () => ({ levels: [1] as const })],
    ['levels without 1', () => ({ levels: [0] as const })],
    ['an unknown level', () => ({ levels: [0, 1, 3] as never })],
    ['repeated levels', () => ({ levels: [0, 1, 1] as const })],
    ['descending levels', () => ({ levels: [1, 0] as const })],
    ['bounds with min >= max', () => ({ bounds: box([0, 0, 0], [0, 1, 1]) })],
    ['a non-finite bound', () => ({ bounds: box([0, 0, 0], [Number.NaN, 1, 1]) })],
    ['no tiles', () => ({ tiles: [] })],
    ['populations that repeat', () => ({ populations: ['p.a', 'p.a'] })],
    ['an unknown population', () => ({ populations: ['p.a', 'p.z'] })],
    ['a population set that differs from the model', () => ({ populations: ['p.a'] })],
    ['a tile box with min >= max', (m: TileManifest) => ({ tiles: tile0(m, { box: box([1, 1, 1], [1, 5, 5]) }) })],
    ['a tile box outside bounds', (m: TileManifest) => ({ tiles: tile0(m, { box: box([-5, 0, 0], [10, 10, 10]) }) })],
    ['a malformed tile id', (m: TileManifest) => ({ tiles: tile0(m, { id: '3 bad' }) })],
    ['a duplicate tile id', (m: TileManifest) => ({ tiles: [m.tiles[0], { ...m.tiles[1], id: m.tiles[0].id }] })],
    ['a negative count', (m: TileManifest) => ({ tiles: tile0(m, { counts: { 'p.a': -1 } }) })],
    ['a fractional count', (m: TileManifest) => ({ tiles: tile0(m, { counts: { 'p.a': 1.5 } }) })],
    ['a tile with no counts', (m: TileManifest) => ({ tiles: tile0(m, { counts: undefined as never }) })],
    ['a tile with null counts', (m: TileManifest) => ({ tiles: tile0(m, { counts: null as never }) })],
    ['a tile with array counts', (m: TileManifest) => ({ tiles: tile0(m, { counts: [1, 2] as never }) })],
    ['null envelopes', (m: TileManifest) => ({ tiles: tile0(m, { envelopes: null as never }) })],
    ['array envelopes', (m: TileManifest) => ({ tiles: tile0(m, { envelopes: [] as never }) })],
    ['a count of an unknown population', (m: TileManifest) => ({ tiles: tile0(m, { counts: { 'p.z': 1 } }) })],
    [
      'an envelope outside its tile',
      (m: TileManifest) => ({ tiles: tile0(m, { envelopes: { 'p.a': box([0, 0, 0], [3000, 10, 10]) } }) }),
    ],
    [
      'an envelope of a population with no count',
      (m: TileManifest) => ({
        tiles: tile0(m, { counts: { 'p.a': 1 }, envelopes: { 'p.b': m.tiles[0].box } }),
      }),
    ],
  ])('%s is an error', async (_, f) => {
    const issues = await check(f as never);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.severity === 'error' && i.code === 'stream.manifest')).toBe(true);
  });

  it('a level 2 is declared only: an info issue', async () => {
    const issues = await check(() => ({ levels: [0, 1, 2] as const }));
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['stream.manifest', 'info']]);
  });

  it('a tile within the tolerance of bounds is inside', async () => {
    const m = await manifest();
    const t = tile0(m, { box: box([-5e-4, 0, 0], [2000, 2000, 2000]) });
    expect(validateManifest({ ...m, tiles: t }, model, doc)).toEqual([]);
  });
});

describe('compile: level 0', () => {
  it('a tile without counts fails the stream model, not the scene (no throw)', async () => {
    const m = await manifest();
    const broken = { ...m, tiles: m.tiles.map((t, i) => (i === 0 ? ({ id: t.id, box: t.box } as never) : t)) };
    const r = await compile(doc, {
      resolvers: DefaultResolvers,
      tiles: tiles({ ...provider, manifest: async () => broken }),
    });
    expect(r.ir).toBeDefined();
    expect(streamNode(r.ir!)).toBeUndefined();
    expect(r.issues.filter((i) => i.code === 'stream.manifest' && i.severity === 'error').length).toBe(1);
    // the instances' model still resolved
    expect(placementSets(r.ir!).length).toBe(1);
  });

  it('a stream node with level 0, no placement set, the manifest totals, no unrealized model', async () => {
    const r = await open();
    const m = await manifest();
    const node = streamNode(r.ir!)!;
    expect(node.params).toMatchObject({ model: 'm.tiles', resource: 'r.tiles', levels: [0, 1] });
    expect(node.params.tiles).toBe(m.tiles);
    expect(node.children).toBeUndefined();
    expect(placementSets(r.ir!).some((s) => s.model === 'm.tiles')).toBe(false);
    expect(r.counts['p.a']).toEqual({ requested: 9 * 20, achieved: 9 * 20 });
    expect(r.counts['p.b']).toEqual({ requested: 9 * 10, achieved: 9 * 10 });
    // the stream model is no resolver's: only the instances' model ran
    expect(r.stats.models.map((x) => x.model)).toEqual(['default:meso.instances']);
    expect(codes(r.issues)).not.toContain('model.unrealized');
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(node.params.types.map((t) => [t.population, t.entity, t.radius])).toEqual([
      ['p.a', 'e.a', 40],
      ['p.b', 'e.b', 60],
    ]);
  });

  it('level 0 alone holds counts and envelopes', async () => {
    const r = await open();
    const l0 = level0IR(r.ir!);
    const [proxy] = placementSets(l0).filter((s) => s.model === 'm.tiles');
    // one copy per (tile, population) with a count, at the envelope's centre
    expect(proxy.count).toBe(18);
    expect(proxy.key).toBe(`${streamNode(r.ir!)!.params.key}#level0`);
    expect([...proxy.positions.subarray(0, 3)]).toEqual([1000, 1000, 1000]);
    expect(proxy.typeTable[0].radius).toBeCloseTo(Math.hypot(2000 - 80, 2000 - 80, 2000 - 80) / 2);
    expect(irToJson(r.ir!)).toMatchObject({}); // the stream node prints as a summary
    const json = JSON.stringify(irToJson(r.ir!));
    expect(json).toContain('"tiles":9');
    expect(json).toContain('"copies":{"p.a":180,"p.b":90}');
  });

  it('a manifest that is invalid or unavailable fails the stream model, not the scene', async () => {
    const bad = { ...provider, manifest: async () => ({ ...(await manifest()), levels: [1] as never }) };
    for (const [p, why] of [
      [bad, /levels hold 0 and 1/],
      [undefined, /no provider/],
      [{ ...provider, manifest: async () => Promise.reject(new Error('offline')) }, /offline/],
    ] as const) {
      const r = await compile(doc, { resolvers: DefaultResolvers, tiles: p && tiles(p) });
      expect(r.ir).toBeDefined();
      expect(streamNode(r.ir!)).toBeUndefined();
      expect(r.counts['p.a'].achieved).toBe(0);
      const e = r.issues.filter((i) => i.code === 'stream.manifest' && i.severity === 'error');
      expect(e.length).toBe(1);
      expect(e[0].message).toMatch(why);
      // the instances still resolved
      expect(placementSets(r.ir!).length).toBe(1);
    }
  });
});

// ---- the planner ----

type Tile = TileManifest['tiles'][number];
const dist = (c: readonly number[], b: Box) =>
  Math.hypot(...[0, 1, 2].map((k) => Math.max(b.min[k] - c[k], 0, c[k] - b.max[k])));
const none: StreamState = { loaded: new Map(), pending: new Set(), failed: new Set() };
const copies = (t: Tile) => Object.values(t.counts).reduce((a, b) => a + b, 0);
const at = (x: number, y = 1000, z = 1000) => ({ center: [x, y, z] as [number, number, number], radius: 0 });

describe('planStream', () => {
  it('a resident tile near the focus never evicts a tile the focus touches', () => {
    const tile = (id: string, x: number): Tile => ({
      id,
      box: { min: [x, 0, 0], max: [x + 10, 10, 10] },
      counts: { 'p.a': 10 },
    });
    const m: TileManifest = {
      format: 'meso-tiles',
      levels: [0, 1],
      bounds: { min: [0, 0, 0], max: [100, 10, 10] },
      populations: ['p.a'],
      // the focus is inside b; a is resident and 10 Å away, which hysteresis 20 turns into 0, a tie that ids settle
      tiles: [tile('a', 20), tile('b', 0)],
    };
    const state = { ...none, loaded: new Map([['a', 10]]) };
    const focus = { center: [5, 5, 5] as [number, number, number], radius: 0 };
    expect(planStream(m, focus, state, { copies: 10, hysteresis: 20 })).toMatchObject({
      focus: ['b'],
      want: ['b'],
      evict: ['a'],
      request: ['b'],
    });
  });

  it('a budget of 0 requests nothing', async () => {
    const plan = planStream(await manifest(), at(100), none, { copies: 0 });
    expect([plan.want, plan.request, plan.evict, plan.overBudget]).toEqual([[], [], [], undefined]);
    expect(plan.level0.length).toBe(9);
  });

  it('requests come nearest first, ties by id', async () => {
    const m = await manifest();
    const focus = { center: [100, 100, 100] as [number, number, number], radius: 0 };
    const plan = planStream(m, focus, none, { copies: 30 * 5 });
    const d = plan.request.map((id) => dist(focus.center, m.tiles.find((t) => t.id === id)!.box));
    expect(plan.request.length).toBe(5);
    expect(plan.request[0]).toBe('t.0.0.0');
    expect(d).toEqual([...d].sort((a, b) => a - b));
    // t.0.1.0 and t.1.0.0 tie at 1900 Å: the lower id first
    expect(plan.request.slice(1, 3)).toEqual(['t.0.1.0', 't.1.0.0']);
    expect(plan.want).toEqual(plan.request);
    expect(plan.copies).toBe(150);
  });

  it('never exceeds the budget, over 200 seeded foci and states', async () => {
    const m = await manifest();
    const rng = createRandom(7);
    for (let n = 0; n < 200; n++) {
      const pick = (p: number) => m.tiles.filter(() => rng.next() < p).map((t) => t.id);
      const loaded = new Map(pick(0.3).map((id) => [id, 30]));
      const pending = new Set(pick(0.2).filter((id) => !loaded.has(id)));
      const failed = new Set(pick(0.1).filter((id) => !loaded.has(id) && !pending.has(id)));
      const budget = { copies: Math.floor(rng.range(0, 300)), hysteresis: rng.next() < 0.5 ? 0 : rng.range(0, 2000) };
      const focus = {
        center: [rng.range(-1000, 7000), rng.range(-1000, 7000), rng.range(-1000, 3000)] as [number, number, number],
        radius: rng.range(0, 3000),
      };
      const plan = planStream(m, focus, { loaded, pending, failed }, budget);
      expect(plan.copies).toBeLessThanOrEqual(budget.copies);
      // what stands after the plan: the resident that stay, the pending that stay, the new requests
      const after = new Set([...loaded.keys(), ...pending, ...plan.request]);
      for (const id of [...plan.evict, ...plan.cancel]) after.delete(id);
      expect([...after].reduce((a, id) => a + copies(m.tiles.find((t) => t.id === id)!), 0)).toBeLessThanOrEqual(
        budget.copies,
      );
      for (const id of plan.request) expect(failed.has(id) || loaded.has(id) || pending.has(id)).toBe(false);
      // a tile the focus touches is wanted whenever all of them fit, whatever the hysteresis keeps resident
      const touched = plan.focus.filter((id) => !failed.has(id));
      if (touched.reduce((a, id) => a + copies(m.tiles.find((t) => t.id === id)!), 0) <= budget.copies)
        for (const id of touched) expect(plan.want).toContain(id);
    }
  });

  it('a focus on a tile boundary wants both tiles', async () => {
    const m = await manifest();
    // x = 2000 is the boundary of t.0.0.0 and t.1.0.0, in the middle of both in y and z
    const plan = planStream(m, at(2000), none, { copies: 60 });
    expect(plan.want).toEqual(['t.0.0.0', 't.1.0.0']);
    expect(plan.focus).toEqual(['t.0.0.0', 't.1.0.0']);
  });

  it('a focus sphere touches the tiles within its radius', async () => {
    const m = await manifest();
    const plan = planStream(m, { center: [1000, 1000, 1000], radius: 1500 }, none, { copies: 30 });
    expect(plan.focus).toEqual(['t.0.0.0', 't.0.1.0', 't.1.0.0', 't.1.1.0'].sort());
    expect(plan.focus[0]).toBe('t.0.0.0');
  });

  it('eviction is farthest first, and the focus tiles stay', async () => {
    const m = await manifest();
    const loaded = new Map(m.tiles.map((t) => [t.id, 30]));
    const focus = at(100, 100, 100);
    const plan = planStream(m, focus, { ...none, loaded }, { copies: 90 });
    expect(plan.evict.length).toBe(6);
    const d = plan.evict.map((id) => dist(focus.center, m.tiles.find((t) => t.id === id)!.box));
    expect(d).toEqual([...d].sort((a, b) => b - a));
    expect(plan.evict).not.toContain('t.0.0.0');
    expect(plan.want).toContain('t.0.0.0');
    expect(plan.request).toEqual([]);
  });

  it('a pending tile out of the plan is cancelled, farthest first', async () => {
    const m = await manifest();
    const plan = planStream(
      m,
      at(100, 100, 100),
      { ...none, pending: new Set(['t.0.0.0', 't.2.2.0', 't.2.1.0']) },
      { copies: 30 },
    );
    expect(plan.cancel).toEqual(['t.2.2.0', 't.2.1.0']);
    expect(plan.request).toEqual([]);
  });

  it('a tile over the budget stops the walk and is reported', () => {
    const box = (x: number): Box => ({ min: [x, 0, 0], max: [x + 10, 10, 10] });
    const m: TileManifest = {
      format: 'meso-tiles',
      levels: [0, 1],
      bounds: { min: [0, 0, 0], max: [100, 10, 10] },
      populations: ['p.a'],
      tiles: [
        { id: 'near', box: box(0), counts: { 'p.a': 10 } },
        { id: 'mid', box: box(20), counts: { 'p.a': 50 } },
        { id: 'far', box: box(40), counts: { 'p.a': 5 } },
      ],
    };
    const plan = planStream(m, at(0, 0, 0), none, { copies: 20 });
    // `far` fits but is never skipped to: the loaded region stays one shell
    expect([plan.want, plan.overBudget]).toEqual([['near'], 'mid']);
    expect(plan.level0).toEqual(['far', 'mid']);
    // a tile that merely does not fit in what is left is not over budget
    expect(planStream(m, at(0, 0, 0), none, { copies: 55 }).overBudget).toBeUndefined();
  });

  it('a tile with no copies is wanted at no cost, and never requested', async () => {
    const m = await manifest();
    const empty = { ...m, tiles: m.tiles.map((t, i) => (i === 0 ? { ...t, counts: { 'p.a': 0, 'p.b': 0 } } : t)) };
    const plan = planStream(empty, at(100, 100, 100), none, { copies: 30 });
    expect(plan.want[0]).toBe('t.0.0.0');
    expect(plan.request).not.toContain('t.0.0.0');
    expect(plan.copies).toBe(30);
  });

  it('is deterministic: the same arguments, and a shuffled manifest, give the same plan', async () => {
    const m = await manifest();
    const state = { loaded: new Map([['t.1.1.0', 30]]), pending: new Set(['t.2.0.0']), failed: new Set(['t.0.2.0']) };
    const focus = { center: [2500, 900, 1000] as [number, number, number], radius: 700 };
    const plan = planStream(m, focus, state, { copies: 120, hysteresis: 100 });
    expect(planStream(m, focus, state, { copies: 120, hysteresis: 100 })).toEqual(plan);
    const rng = createRandom(3);
    const shuffled = [...m.tiles].sort(() => rng.next() - 0.5);
    expect(planStream({ ...m, tiles: shuffled }, focus, state, { copies: 120, hysteresis: 100 })).toEqual(plan);
    expect(plan.want).not.toContain('t.0.2.0');
  });

  it('hysteresis keeps a resident tile at a tie', () => {
    const tile = (id: string, x: number, y: number): Tile => ({
      id,
      box: { min: [x, y, 0], max: [x + 10, y + 10, 10] },
      counts: { 'p.a': 10 },
    });
    const m: TileManifest = {
      format: 'meso-tiles',
      levels: [0, 1],
      bounds: { min: [0, 0, 0], max: [2000, 2000, 10] },
      populations: ['p.a'],
      // a is 1010 Å from the focus and resident, b 1000 Å and new: one tile fits
      tiles: [tile('a', 1010, 0), tile('b', 1000, 100)],
    };
    const state = { ...none, loaded: new Map([['a', 10]]) };
    const focus = { center: [0, 0, 0] as [number, number, number], radius: 0 };
    expect(planStream(m, focus, state, { copies: 10 })).toMatchObject({ want: ['b'], evict: ['a'], request: ['b'] });
    expect(planStream(m, focus, state, { copies: 10, hysteresis: 20 })).toMatchObject({
      want: ['a'],
      evict: [],
      request: [],
    });
  });
});

// ---- sets and the camera ----

const payloads = async (ids: readonly string[]) =>
  new Map(
    await Promise.all(ids.map(async (id) => [id, await provider.load(id, 1, new AbortController().signal)] as const)),
  );

describe('stream sets', () => {
  it('global ordinals make copy ids unique across tiles', async () => {
    const r = await open();
    const node = streamNode(r.ir!)!;
    const m = await manifest();
    const loaded = await payloads(m.tiles.map((t) => t.id));
    const sets = m.tiles.map((t) => tileSet(node, t, loaded.get(t.id)!));
    const ids = new Set<string>();
    for (const s of sets)
      for (let i = 0; i < s.count; i++) ids.add(`${s.typeTable[s.types[i]].population}#${s.ordinals[i]}`);
    expect(ids.size).toBe(9 * 30);
    // p.a: 0..179, p.b: 0..89, each exactly once, in manifest order
    expect(sets[0].ordinals[0]).toBe(0);
    expect(sets[1].ordinals[0]).toBe(20);
    expect(ids.has('p.a#179') && ids.has('p.b#89') && !ids.has('p.a#180')).toBe(true);
    // the payload's buffers are shared, the type table is the node's
    expect(sets[0].positions).toBe(loaded.get('t.0.0.0')!.positions);
    expect(sets[0].typeTable).toBe(node.params.types);
    expect(sets[0].key).toBe(`${node.params.key}#t.0.0.0`);
  });

  it('keys are stable across two compiles, and change with the stream types', async () => {
    const [a, b] = [streamNode((await open()).ir!)!, streamNode((await open()).ir!)!];
    expect(a.params.key).toBe(b.params.key);
    expect(a.params.key).toMatch(/^m\.tiles@[0-9a-f]{16}$/);
    const fat = { ...doc, entities: doc.entities.map((e) => (e.id === 'e.a' ? { ...e, radius: 50 } : e)) };
    expect(streamNode((await open(fat)).ir!)!.params.key).not.toBe(a.params.key);
  });

  it('level 0 is built once per stream node: steps with other tiles spliced in read the same proxy set', async () => {
    const r = await open();
    const [a, b] = [...(await payloads(['t.0.0.0', 't.1.0.0']))];
    const node = streamNode(r.ir!)!;
    const one = withTiles(r.ir!, new Map([[a[0], tileSet(node, node.params.tiles[0], a[1])]]));
    const two = withTiles(r.ir!, new Map([[b[0], tileSet(node, node.params.tiles[1], b[1])]]));
    expect(one.root).not.toBe(two.root);
    const proxy = (ir: IR) => placementSets(level0IR(ir)).filter((x) => x.model === 'm.tiles');
    expect(proxy(one).length).toBe(1);
    expect(proxy(one)[0]).toBe(proxy(two)[0]);
    expect(proxy(r.ir!)[0]).toBe(proxy(one)[0]);
    // another stream (new params) reads its own
    const copy = (n: IRNode): IRNode =>
      ({
        ...n,
        ...(n.kind === 'stream' ? { params: { ...n.params } } : {}),
        ...(n.children ? { children: n.children.map(copy) } : {}),
      }) as IRNode;
    const other: IR = { root: copy(r.ir!.root), view: r.ir!.view };
    expect(proxy(other)[0]).not.toBe(proxy(one)[0]);
  });

  it('withTiles puts the sets in manifest order and keeps every other node object', async () => {
    const r = await open();
    const node = streamNode(r.ir!)!;
    const m = await manifest();
    const loaded = await payloads(['t.1.0.0', 't.0.0.0']);
    const sets = new Map([...loaded].map(([id, p]) => [id, tileSet(node, m.tiles.find((t) => t.id === id)!, p)]));
    const ir = withTiles(r.ir!, sets);
    expect(
      placementSets(ir)
        .filter((s) => s.model === 'm.tiles')
        .map((s) => s.key.split('#')[1]),
    ).toEqual(['t.0.0.0', 't.1.0.0']);
    expect(streamNode(ir)!.children!.map((c) => c.ref)).toEqual(['m.tiles/stream/t.0.0.0', 'm.tiles/stream/t.1.0.0']);
    expect(ir.view).toBe(r.ir!.view);
    const nodes = (x: IR) => new Map([...walk(x.root)].map(([n]) => [n.ref, n]));
    const [before, after] = [nodes(r.ir!), nodes(ir)];
    const spine = new Set(['scene', 'frame:f.world', 'm.tiles/stream']);
    for (const [ref, n] of before) if (!spine.has(ref)) expect(after.get(ref)).toBe(n);
    // the same sets back again: the same tile nodes' sets
    expect(placementSets(withTiles(ir, sets)).map((s) => s)).toEqual(placementSets(ir));
    expect(streamNode(withTiles(ir, new Map()))!.children).toEqual([]);
  });

  it('the camera reads level 0: the same camera with no tiles and with every tile loaded', async () => {
    const r = await open();
    const node = streamNode(r.ir!)!;
    const m = await manifest();
    const loaded = await payloads(m.tiles.map((t) => t.id));
    const all = withTiles(r.ir!, new Map(m.tiles.map((t) => [t.id, tileSet(node, t, loaded.get(t.id)!)])));
    for (const v of ['v.all', 'v.corner', 'v.middle', 'v.far']) {
      const d = withView(doc, v);
      const [a, b] = [updateView(d, r.ir!).view.camera, updateView(d, all).view.camera];
      expect(a).toBeDefined();
      expect(b).toEqual(a);
    }
    // v.all frames the envelopes of every tile of p.a: the grid's centre, a sphere that holds it
    const cam = updateView(doc, r.ir!).view.camera!;
    expect(cam.target.map(Math.round)).toEqual([3000, 3000, 1000]);
    expect(cam.focus!.radius).toBeGreaterThan(Math.hypot(3000, 3000, 1000) * 0.9);
  });

  it('a stream looks like every set: one look per tile set and type, when loaded', async () => {
    const r = await open();
    const node = streamNode(r.ir!)!;
    const m = await manifest();
    const loaded = await payloads(['t.0.0.0']);
    const ir = withTiles(r.ir!, new Map([['t.0.0.0', tileSet(node, m.tiles[0], loaded.get('t.0.0.0')!)]]));
    const looks = updateView(doc, ir).view.looks.filter((l) => l.set.startsWith('m.tiles'));
    expect(looks.map((l) => l.types)).toEqual([[0], [1]]);
  });
});

// ---- the streamer ----

/** A provider that records its loads and what its signals did. */
function spy(base: TileProvider, wrap: (id: string, p: TilePayload) => TilePayload = (_, p) => p) {
  const loads: string[] = [];
  const signals = new Map<string, AbortSignal>();
  const p: TileProvider = {
    manifest: (s) => base.manifest(s),
    async load(id, level, signal) {
      loads.push(id);
      signals.set(id, signal);
      return wrap(id, await base.load(id, level, signal));
    },
  };
  return { p, loads, signals };
}

async function streamer(d: MesoViewSpecDoc, p: TileProvider, budget = 60, maxInFlight = 4) {
  const r = await open(d, p);
  let settled = 0;
  const s = new TileStreamer(tiles(p), { budget: { copies: budget }, maxInFlight }, () => settled++);
  const issues: Issue[] = [];
  const state = { ir: r.ir!, last: undefined as IR | undefined };
  /** One step on the document's current view, over the compiled IR. */
  const step = (view: string) => {
    const ir = updateView(withView(d, view), state.ir);
    const out = s.step(ir);
    issues.push(...out.issues);
    state.last = updateView(withView(d, view), out.ir);
    return out;
  };
  /** Steps until nothing is in flight and nothing more is asked for. */
  const drain = async (view: string) => {
    let out = step(view);
    for (let i = 0; i < 100 && (s.stats().inFlight > 0 || out.plan!.request.length > 0); i++) {
      await sleep(3);
      out = step(view);
    }
    return out;
  };
  const resident = () =>
    placementSets(state.last!)
      .filter((x) => x.model === 'm.tiles')
      .map((x) => x.key.split('#')[1]);
  return { s, step, drain, issues, resident, settled: () => settled, state };
}

describe('TileStreamer', () => {
  it('loads the tiles around the focus, within the budget, and tells when a load settles', async () => {
    const { s, drain, resident, settled } = await streamer(doc, provider);
    const out = await drain('v.corner');
    expect(resident()).toEqual(['t.0.0.0', 't.0.1.0']);
    expect(s.stats()).toMatchObject({
      tiles: 9,
      resident: 2,
      inFlight: 0,
      requested: 2,
      loaded: 2,
      evicted: 0,
      copies: 60,
      budget: 60,
      level0Copies: 270,
    });
    expect(out.plan!.want.length).toBe(2);
    expect(settled()).toBeGreaterThan(0);
  });

  it('a tour: tiles come and go, resident copies stay within the budget on every step', async () => {
    const { s, drain, step, resident } = await streamer(doc, provider, 90);
    for (const v of ['v.all', 'v.corner', 'v.middle', 'v.far']) {
      await sleep(1);
      for (let i = 0; i < 40; i++) {
        step(v);
        expect(s.stats().copies).toBeLessThanOrEqual(90);
        if (!s.stats().inFlight) break;
        await sleep(2);
      }
      await drain(v);
      expect(s.stats().copies).toBeLessThanOrEqual(90);
    }
    expect(resident().length).toBe(3);
    expect(resident()).toContain('t.2.2.0');
    expect(s.stats().evicted).toBeGreaterThan(0);
    // after the tour's end the corner is evicted
    expect(resident()).not.toContain('t.0.0.0');
  });

  it('a focus on the boundary loads both sides', async () => {
    const { drain, resident } = await streamer(doc, provider, 60);
    await drain('v.middle');
    expect(resident()).toEqual(['t.0.0.0', 't.1.0.0']);
  });

  it('a tile evicted while in flight is aborted, and its late result is dropped', async () => {
    // a provider that ignores its signal: the result arrives after the abort anyway
    const late: TileProvider = {
      manifest: () => provider.manifest(),
      load: async (id, level, signal) => {
        await sleep(30);
        return provider.load(id, level, signal);
      },
    };
    const sp = spy(late);
    const { s, step, drain, resident } = await streamer(doc, sp.p, 60);
    step('v.corner');
    expect(s.stats().inFlight).toBe(2);
    const corner = [...sp.signals.keys()];
    step('v.far');
    expect(corner.length).toBe(2);
    expect(s.stats().cancelled).toBe(2);
    await sleep(60);
    await drain('v.far');
    expect(resident().sort()).toEqual(['t.1.2.0', 't.2.2.0']);
    for (const id of corner) expect(resident()).not.toContain(id);
    expect(s.stats()).toMatchObject({ resident: 2, loaded: 2, cancelled: 2, failed: 0 });
    for (const id of corner) expect(sp.signals.get(id)!.aborted).toBe(true);
  });

  it('a stream key change aborts what is in flight and drops every resident tile', async () => {
    const sp = spy(tiledFixture({ ...small, delayMs: 20 }).provider);
    const { s, drain, resident } = await streamer(doc, sp.p, 60);
    await drain('v.corner');
    expect(resident().length).toBe(2);
    // a new key: the stream node of a compile with another entity radius
    const fat = { ...doc, entities: doc.entities.map((e) => (e.id === 'e.a' ? { ...e, radius: 50 } : e)) };
    const next = (await open(fat, provider)).ir!;
    const out = s.step(updateView(withView(fat, 'v.corner'), next));
    expect(s.stats()).toMatchObject({ resident: 0, loaded: 0, requested: 2, inFlight: 2 });
    expect(streamNode(out.ir)!.children).toEqual([]);
    expect(sp.loads.length).toBe(4);
    // and a second change while those two are in flight aborts them
    const signals = [...sp.signals.values()];
    s.step(updateView(doc, (await open()).ir!));
    expect(signals.every((x) => x.aborted)).toBe(true);
    expect(s.stats()).toMatchObject({ requested: 2, inFlight: 2 });
    s.dispose();
    expect(s.stats().inFlight).toBe(0);
  });

  it('a failed tile is reported once and not asked for again', async () => {
    const f = tiledFixture({ ...small, fail: ['t.0.0.0'] });
    const sp = spy(f.provider);
    const { s, drain, issues, resident, step } = await streamer(doc, sp.p, 60);
    await drain('v.corner');
    for (let i = 0; i < 5; i++) {
      step('v.corner');
      await sleep(2);
    }
    expect(sp.loads.filter((id) => id === 't.0.0.0').length).toBe(1);
    expect(issues.filter((i) => i.code === 'stream.tile').length).toBe(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', phase: 'load' });
    expect(issues[0].message).toContain('t.0.0.0');
    expect(s.stats().failed).toBe(1);
    // the standing issues keep the warning after the steps that reported it, and list it once
    expect(s.issues()).toEqual([issues[0]]);
    expect(resident()).not.toContain('t.0.0.0');
    // the budget goes to the next tiles instead
    expect(resident().length).toBe(2);
  });

  it('an AbortError the streamer did not cause is a failed tile, reported once and not retried', async () => {
    const loads: string[] = [];
    const foreign: TileProvider = {
      manifest: () => provider.manifest(),
      load: async (id, level, signal) => {
        loads.push(id);
        // a network layer's own abort: the streamer's signal is untouched
        if (id === 't.0.0.0') throw new DOMException('connection reset', 'AbortError');
        return provider.load(id, level, signal);
      },
    };
    const { s, drain, issues, resident, step } = await streamer(doc, foreign, 60);
    await drain('v.corner');
    for (let i = 0; i < 3; i++) {
      step('v.corner');
      await sleep(2);
    }
    expect(loads.filter((id) => id === 't.0.0.0').length).toBe(1);
    expect(issues.filter((i) => i.code === 'stream.tile').length).toBe(1);
    expect(issues[0].message).toContain('t.0.0.0');
    // its in-flight slot is free, and the budget went to the next tiles
    expect(s.stats()).toMatchObject({ failed: 1, inFlight: 0, resident: 2 });
    expect(resident()).not.toContain('t.0.0.0');
  });

  it('a provider that throws synchronously fails the tile; step does not throw and pending stays consistent', async () => {
    const loads: string[] = [];
    const sync: TileProvider = {
      manifest: () => provider.manifest(),
      load: (id, level, signal) => {
        loads.push(id);
        if (id === 't.0.0.0') throw new Error('no connection');
        return provider.load(id, level, signal);
      },
    };
    const { s, step, drain, issues, resident } = await streamer(doc, sync, 60);
    expect(() => step('v.corner')).not.toThrow();
    // the throwing tile is in flight until its rejection settles, like any other load
    expect(s.stats().inFlight).toBe(2);
    await drain('v.corner');
    for (let i = 0; i < 3; i++) {
      step('v.corner');
      await sleep(2);
    }
    expect(loads.filter((id) => id === 't.0.0.0').length).toBe(1);
    expect(issues.filter((i) => i.code === 'stream.tile').length).toBe(1);
    expect(issues[0].message).toMatch(/t\.0\.0\.0.*no connection/);
    expect(s.stats()).toMatchObject({ failed: 1, inFlight: 0, resident: 2 });
    expect(resident()).not.toContain('t.0.0.0');
  });

  it("a stream key change drops the old key's issues: none is reported under the new key", async () => {
    const f = tiledFixture({ ...small, fail: ['t.0.0.0'] });
    const { s, step, issues, state } = await streamer(doc, f.provider, 60);
    step('v.corner');
    await sleep(10);
    // the failure is recorded, not yet reported (the next step does)
    expect(s.stats().failed).toBe(1);
    // a new key: the same document with another entity radius
    const fat = { ...doc, entities: doc.entities.map((e) => (e.id === 'e.a' ? { ...e, radius: 50 } : e)) };
    state.ir = (await open(fat, f.provider)).ir!;
    const out = s.step(updateView(withView(fat, 'v.corner'), state.ir));
    expect(out.issues.filter((i) => i.code === 'stream.tile')).toEqual([]);
    expect(issues.filter((i) => i.code === 'stream.tile')).toEqual([]);
    expect(s.stats()).toMatchObject({ failed: 0, requested: 2 });
  });

  it('a payload whose counts disagree with the manifest is rejected', async () => {
    const wrong = spy(provider, (id, p) => {
      if (id !== 't.0.0.0') return p;
      const types = Int32Array.from(p.types);
      types[0] = 1;
      return { ...p, types };
    });
    const { s, drain, issues, resident } = await streamer(doc, wrong.p, 60);
    await drain('v.corner');
    expect(issues.map((i) => i.code)).toEqual(['stream.tile']);
    expect(issues[0].message).toMatch(/rejected.*manifest says/);
    expect(resident()).not.toContain('t.0.0.0');
    expect(s.stats()).toMatchObject({ failed: 1, resident: 2 });
    // buffers that do not match the count are rejected too
    const short = spy(provider, (_, p) => ({ ...p, positions: p.positions.subarray(3) }));
    const t = await streamer(doc, short.p, 60);
    await t.drain('v.corner');
    // every tile in turn is rejected, and none is asked for again
    expect(t.s.stats()).toMatchObject({ failed: 9, resident: 0, copies: 0 });
  });

  it('a tile over the budget is reported once as stream.budget', async () => {
    const { s, step, issues, resident } = await streamer(doc, provider, 20);
    step('v.corner');
    step('v.corner');
    expect(issues.map((i) => i.code)).toEqual(['stream.budget']);
    expect(s.stats()).toMatchObject({ requested: 0, resident: 0 });
    expect(resident()).toEqual([]);
    // it stands while the tile is over the budget, and leaves with the budget's rise
    expect(s.issues()).toEqual(issues);
    s.setBudget(30);
    step('v.corner');
    expect(s.issues()).toEqual([]);
    s.setBudget(20);
    step('v.corner');
    expect(s.issues().map((i) => i.code)).toEqual(['stream.budget']);
    expect(issues.length).toBe(1);
  });

  it('at most maxInFlight loads at once, in the plan order', async () => {
    const sp = spy(tiledFixture({ ...small, delayMs: 5 }).provider);
    const { s, step, drain } = await streamer(doc, sp.p, 30 * 9, 2);
    step('v.corner');
    expect(s.stats().inFlight).toBe(2);
    expect(sp.loads).toEqual(['t.0.0.0', 't.0.1.0']);
    await drain('v.corner');
    expect(s.stats()).toMatchObject({ resident: 9, requested: 9, copies: 270 });
  });

  it('a model edit with the same stream key keeps the tile sets', async () => {
    const { s, drain } = await streamer(doc, provider, 60);
    const first = await drain('v.corner');
    const before = placementSets(first.ir).filter((x) => x.model === 'm.tiles');
    const more = {
      ...doc,
      instances: [
        ...doc.instances!,
        {
          id: 'i.extra',
          entity: 'e.a',
          compartment: 'c.box',
          pose: { translation: [5, 5, 5] as [number, number, number] },
        },
      ],
    };
    const r2 = await open(more);
    const out = s.step(updateView(withView(more, 'v.corner'), r2.ir!));
    const after = placementSets(out.ir).filter((x) => x.model === 'm.tiles');
    expect(after.length).toBe(2);
    after.forEach((x, i) => expect(x).toBe(before[i]));
    expect(out.plan!.request).toEqual([]);
  });

  it('setBudget changes what the next step plans: 0 holds level 0 only, a budget then loads tiles', async () => {
    const { s, step } = await streamer(doc, provider, 0);
    expect(step('v.corner').plan!.request).toEqual([]);
    expect(s.stats()).toMatchObject({ copies: 0, budget: 0 });
    s.setBudget(60);
    expect(step('v.corner').plan!.request.length).toBeGreaterThan(0);
    expect(s.stats().budget).toBe(60);
  });

  it('with no stream node it does nothing', () => {
    const s = new TileStreamer(
      () => undefined,
      { budget: { copies: 10 } },
      () => {},
    );
    const ir = {
      root: { ref: 'scene', kind: 'scene', params: { units: 'A', title: '' } } as IRNode,
      view: { id: 'v', looks: [] },
    };
    expect(s.step(ir)).toEqual({ ir, issues: [] });
    expect(s.stats()).toMatchObject({ tiles: 0, resident: 0 });
  });
});
