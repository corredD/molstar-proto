/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { tiledFixture } from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { type IR, placementSets } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { type CommitReport, type RendererAdapter, shownViewOf } from '@molstar/meso-spec/runtime';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CameraCanvas, PrismMesoAdapter } from '../prism-adapter.js';
import { MesoSession } from '../session.js';
import { stubCanvasForLabels } from './canvas.js';

stubCanvasForLabels();

// Streaming through the real Prism viewer (design.md §6.8.7, headless): a session over the fixture's provider plays the
// tour. What it proves: each step commits only the tiles that arrived and left, a tile kept keeps its list, the resident
// copies never pass the budget, and an edit that leaves the stream alone touches no tile.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const budget = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTile = (key: string) => key.startsWith('m.tiles@');
const tiles = (ir: IR) => placementSets(ir).filter((s) => s.model === 'm.tiles');

async function open(change: (d: MesoViewSpecDoc) => MesoViewSpecDoc = (d) => d) {
  const fixture = tiledFixture({ delayMs: 4 });
  const doc = change(fixture.doc);
  const provider = fixture.provider;
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  viewers.push(v);
  const prism = new PrismMesoAdapter(v);
  const commits: { report: CommitReport; ir: IR; lists: Map<string, unknown> }[] = [];
  const adapter: RendererAdapter = {
    id: prism.id,
    async commit(ir) {
      const report = await prism.commit(ir);
      commits.push({ report, ir, lists: new Map(tiles(ir).map((s) => [s.key, prism.listObject(s.key)])) });
      return report;
    },
    dispose: () => prism.dispose(),
  };
  const s = new MesoSession(
    doc,
    { resolvers: DefaultResolvers, tiles: () => provider, stream: { budget: { copies: budget } } },
    adapter,
  );
  /** Edits and settled stream steps run one after the other: a no-op edit returns once every queued step has. */
  const settle = async () => {
    do {
      await sleep(12);
      await s.edit((d) => d, 'flush');
    } while (s.streamer!.stats().inFlight > 0);
  };
  return { v, s, doc, commits, settle, prism };
}

const view = (id: string) => (d: MesoViewSpecDoc) => ({ ...d, session: { ...d.session, view: id } });

describe('a streamed session over the Prism adapter (headless)', () => {
  it('plays the tour: every commit adds and removes only the tiles that arrived and left', {
    tags: ['medium'],
  }, async () => {
    const { s, doc, commits, settle } = await open();
    await s.start();
    await settle();
    for (const step of doc.tours![0].steps) {
      await s.edit(view(step.view), step.view);
      await settle();
    }
    expect(commits.length).toBeGreaterThan(5);
    let before = new Map<string, unknown>();
    for (const c of commits) {
      const now = c.lists;
      const arrived = [...now.keys()].filter((k) => !before.has(k)).sort();
      const left = [...before.keys()].filter((k) => !now.has(k)).sort();
      expect(c.report.added.filter(isTile).sort()).toEqual(arrived);
      expect(c.report.removed.filter(isTile).sort()).toEqual(left);
      // never a full rebuild: the one non-tile list stays, and no tile is both added and removed
      expect(c.report.removed.filter((k) => !isTile(k))).toEqual([]);
      expect(c.report.kept.length + c.report.added.length).toBe(placementSets(c.ir).length);
      // a tile kept keeps its list object
      for (const [k, list] of now) if (before.has(k)) expect(list).toBe(before.get(k));
      // the resident copies stay within the budget
      expect(tiles(c.ir).reduce((n, x) => n + x.count, 0)).toBeLessThanOrEqual(budget);
      before = now;
    }
    // tiles did come and go: a tour from one corner to the other loads, evicts and ends around the last view
    const stats = s.streamer!.stats();
    expect(stats.evicted).toBeGreaterThan(0);
    expect(stats.copies).toBeLessThanOrEqual(budget);
    expect(stats.resident).toBe(7);
    expect(commits.some((c) => c.report.removed.some(isTile))).toBe(true);
    expect(s.history.some((r) => r.kind === 'stream')).toBe(true);
    expect(s.history.filter((r) => r.kind !== 'none').at(-1)!.stream).toMatchObject({
      budget,
      inFlight: 0,
      resident: 7,
    });
  });

  it('a model edit that leaves the stream alone keeps every tile list', { tags: ['medium'] }, async () => {
    const { s, commits, settle, prism } = await open();
    await s.start();
    await settle();
    const keys = tiles(s.ir!).map((x) => x.key);
    const lists = keys.map((k) => prism.listObject(k));
    expect(keys.length).toBe(7);
    const n = commits.length;
    const record = await s.edit(
      (d) => ({
        ...d,
        instances: [
          ...d.instances!,
          {
            id: 'i.extra',
            entity: 'e.a',
            compartment: 'c.box',
            pose: { translation: [10, 10, 10] as [number, number, number] },
          },
        ],
      }),
      'an added instance',
    );
    expect(record.kind).toBe('model');
    await settle();
    // the instance's list was replaced; no tile key removed or added
    const added = commits.slice(n).flatMap((c) => c.report.added);
    const removed = commits.slice(n).flatMap((c) => c.report.removed);
    expect(removed.filter(isTile)).toEqual([]);
    expect(added.filter(isTile)).toEqual([]);
    expect(removed.length).toBe(1);
    expect(tiles(s.ir!).map((x) => x.key)).toEqual(keys);
    keys.forEach((k, i) => expect(prism.listObject(k)).toBe(lists[i]));
  });

  it('a tile arrival neither moves an annotation’s label nor adds a History step', { tags: ['medium'] }, async () => {
    // an annotation on a streamed population, in the view shown
    const { v, s, settle, commits, prism } = await open((d) => {
      const shown = shownViewOf(d)!.id;
      return {
        ...d,
        views: d.views!.map((x) =>
          x.id === shown ? { ...x, annotations: [{ id: 'an.a', target: '(population p.a)', text: 'A' }] } : x,
        ),
      };
    });
    const label = () =>
      [...v.plugin.state.data.cells.values()]
        .map((c) => c.transform.params as { node?: string; position?: ArrayLike<number> } | undefined)
        .filter((p) => p?.node === 'md:#an:an.a')
        .map((p) => Array.from(p!.position ?? []));
    // the opening step draws the label inside a step, as the owner does
    await prism.bound(v.api, () => s.start());
    const at = label();
    expect(at.length).toBe(1);
    const labels: string[] = [];
    const sub = v.api.events.started.subscribe((r) => {
      if (r.operation === 'stage.label') labels.push(r.operation);
    });
    const n = commits.length;
    await settle();
    sub.unsubscribe();
    // tiles arrived (stream commits); the label stayed where level 0 put it, and no stage.label ran (a History step of
    // its own: a stream commit is in no run)
    expect(commits.slice(n).some((c) => c.report.added.some(isTile))).toBe(true);
    expect(label()).toEqual(at);
    expect(labels).toEqual([]);
  });

  // gate S2: a stream commit keeps no set when the only sets are tiles and one is swapped; it set the IR camera again
  it('a stream commit with no set kept leaves the camera alone', { tags: ['medium'] }, async () => {
    const fixture = tiledFixture({ delayMs: 4 });
    // tiles only (no landmark instance), a numeric camera over the first tiles
    const doc: MesoViewSpecDoc = {
      ...fixture.doc,
      instances: [],
      views: [{ id: 'v.n', camera: { position: [1000, 1000, 20000], target: [1000, 1000, 1000], up: [0, 1, 0] } }],
      session: { view: 'v.n' },
      tours: undefined,
    };
    const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
    viewers.push(v);
    // a canvas the adapter's camera step sees (the plugin's own stays none, headless), recording it
    const camera = { setState: vi.fn() };
    const resets = vi.fn();
    const canvas: CameraCanvas = { camera, commit: () => {}, requestCameraReset: resets } as unknown as CameraCanvas;
    const plugin = new Proxy(v.plugin, {
      get: (t, p) => (p === 'canvas3d' ? canvas : Reflect.get(t, p)),
    });
    // no viewer API: a commit outside `bound` is the owner's stream step
    const prism = new PrismMesoAdapter({ plugin, extensions: { load: (id) => v.extensions.load(id) } });
    const s = new MesoSession(
      doc,
      { resolvers: DefaultResolvers, tiles: () => fixture.provider, stream: { budget: { copies: 400 } } },
      prism,
    );
    const settle = async () => {
      do {
        await sleep(12);
        await s.exclusive(async () => {});
      } while (s.streamer!.stats().inFlight > 0);
    };
    try {
      await prism.bound(v.api, () => s.start());
      await settle();
      expect(s.streamer!.stats().resident).toBe(1);
      const first = tiles(s.ir!).map((x) => x.key);
      // the only tile swapped for one at the far corner
      await s.setFocus({ center: [7000, 7000, 3000], radius: 0 });
      await settle();
      expect(tiles(s.ir!).map((x) => x.key)).not.toEqual(first);
      const streamed = s.history.filter((r) => r.kind === 'stream' && r.commit);
      expect(streamed.length).toBeGreaterThan(1);
      for (const r of streamed) expect(r.commit!.kept).toEqual([]);
      for (const r of streamed) expect(r.commit!.cameraSet, 'a stream commit set the camera').toBe(false);
      expect(camera.setState).toHaveBeenCalledTimes(1);
      expect(resets).not.toHaveBeenCalled();
    } finally {
      s.dispose();
    }
  });

  it('a view edit that is a color adds and removes no tile', { tags: ['medium'] }, async () => {
    const { s, settle, commits } = await open();
    await s.start();
    await settle();
    const n = commits.length;
    await s.edit(
      (d) => ({
        ...d,
        views: d.views!.map((x) =>
          x.id === 'v.all' ? { ...x, looks: [{ select: '(population p.a)', color: '#00ff00' }] } : x,
        ),
      }),
      'color',
    );
    await settle();
    const after = commits.slice(n);
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) expect(c.report).toMatchObject({ added: [], removed: [] });
    expect(after[0].report.looksWritten).toBeGreaterThan(0);
  });
});
