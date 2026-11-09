/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { tiledFixture } from '@molstar/meso-spec/examples/streaming';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { type IR, placementSets } from '@molstar/meso-spec/ir/ir';
import type { CommitReport, RendererAdapter } from '@molstar/meso-spec/runtime/adapter';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { describe, expect, it } from 'vitest';
import { MesoSession } from '../session.js';

// The session without a viewer (quick lane): what it keeps when an edit fails, through an adapter that can be told to.

const options = { resolvers: DefaultResolvers, load: (id: string) => ExosomeResources[id]?.() };

class FakeAdapter implements RendererAdapter {
  readonly id = 'fake';
  fail = false;
  readonly commits: IR[] = [];
  async commit(ir: IR): Promise<CommitReport> {
    if (this.fail) throw new Error('commit failed');
    this.commits.push(ir);
    return { added: [], removed: [], kept: [], looksWritten: 0, cameraSet: false, issues: [], ms: { total: 0 } };
  }
  dispose() {}
}

const withConcentration = (doc: MesoViewSpecDoc, value: number): MesoViewSpecDoc => ({
  ...doc,
  populations: doc.populations.map((p) =>
    p.id === 'p.miRNA' ? { ...p, abundance: { concentration: { value, unit: 'M' as const } } } : p,
  ),
});

describe('MesoSession', () => {
  // gate AN1: the IR was assigned before the commit, so a commit that threw left the session half-updated (the new IR
  // with the old doc and history)
  it.each([
    ['view', (d: MesoViewSpecDoc) => ({ ...d, session: { view: 'v.lumen' } })],
    ['model', (d: MesoViewSpecDoc) => withConcentration(d, 0.0008)],
  ] as const)('a %s edit whose commit fails changes nothing in the session', async (_, edit) => {
    const adapter = new FakeAdapter();
    const s = new MesoSession(exosomeDoc(), options, adapter);
    await s.start();
    const before = { ir: s.ir, doc: s.doc, issues: s.issues, counts: s.counts, history: s.history.length };
    adapter.fail = true;
    await expect(s.edit(edit, 'x')).rejects.toThrow('commit failed');
    expect({ ir: s.ir, doc: s.doc, issues: s.issues, counts: s.counts, history: s.history.length }).toEqual(before);
    expect(s.ir).toBe(before.ir);
    // and the queue goes on
    adapter.fail = false;
    expect((await s.edit(edit, 'y')).label).toBe('y');
  });

  // gate A5: a model edit that does not compile kept the previous IR beside the new (invalid) doc, so the IR panel
  // showed a stale IR and the next view edit ran MesoQL over an IR built from another doc
  it('a model edit that does not compile leaves no IR; the next edit compiles again', async () => {
    const adapter = new FakeAdapter();
    const s = new MesoSession(exosomeDoc(), options, adapter);
    await s.start();
    const bad = withConcentration(exosomeDoc(), -1);
    await s.edit(bad, 'bad');
    expect(s.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(s.doc).toBe(bad);
    expect(s.ir).toBeUndefined();
    expect(adapter.commits.length).toBe(1);
    const view = await s.edit((d) => ({ ...d, session: { view: 'v.lumen' } }), 'view');
    expect(view.compileMs).toBeDefined();
    expect(s.ir).toBeUndefined();
    await s.edit((d) => withConcentration(d, 0.0008), 'good');
    expect(s.ir).toBeDefined();
    expect(adapter.commits.length).toBe(2);
  });
});

// A streamed session without a viewer: the streamer's standing issues stay the session's, and what a failed stream
// commit leaves behind.
describe('MesoSession, streamed', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const open = (adapter: RendererAdapter, fail: string[] = [], delayMs = 0) => {
    const { doc, provider } = tiledFixture({ grid: [3, 3, 1], perTile: { 'p.a': 20, 'p.b': 10 }, fail, delayMs });
    const corner = { ...doc, session: { ...doc.session, view: 'v.corner' } };
    const s = new MesoSession(
      corner,
      { resolvers: DefaultResolvers, tiles: () => provider, stream: { budget: { copies: 60 } } },
      adapter,
    );
    /** Waits until nothing is in flight: an edit that changes nothing returns once the queued steps have run. */
    const settle = async () => {
      do {
        await sleep(5);
        await s.edit((d) => d, 'flush');
      } while (s.streamer!.stats().inFlight > 0);
    };
    return { s, settle };
  };
  const tilesOf = (ir: IR | undefined) => (ir ? placementSets(ir).filter((x) => x.model === 'm.tiles').length : 0);

  it('a model edit keeps the failed-tile warning, once', async () => {
    const { s, settle } = open(new FakeAdapter(), ['t.0.0.0']);
    await s.start();
    await settle();
    const warnings = () => s.issues.filter((i) => i.code === 'stream.tile');
    expect(warnings().length).toBe(1);
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
    expect(warnings().length).toBe(1);
    expect(warnings()[0].message).toContain('t.0.0.0');
    await settle();
    expect(warnings().length).toBe(1);
  });

  it('a stream commit that throws is an issue, and the streamer does not count undrawn tiles as resident', async () => {
    const adapter = new FakeAdapter();
    const { s, settle } = open(adapter);
    // the initial commit is the first; the first stream step's is the second, which throws once
    const commit = adapter.commit.bind(adapter);
    let calls = 0;
    adapter.commit = async (ir) => {
      if (++calls === 2) throw new Error('viewer lost');
      return commit(ir);
    };
    await s.start();
    await sleep(20);
    expect(calls).toBe(2);
    // the failure is on the session, as a render issue, and nothing undrawn counts as resident
    const failed = s.issues.filter((i) => i.phase === 'render');
    expect(failed.length).toBe(1);
    expect(failed[0].severity).toBe('error');
    expect(failed[0].message).toContain('viewer lost');
    expect(tilesOf(s.ir)).toBe(0);
    expect(s.streamer!.stats()).toMatchObject({ resident: 0, copies: 0 });
    // the next step takes the arrivals in again, draws them and clears the issue
    await s.setBudget(60);
    await settle();
    expect(s.issues.filter((i) => i.phase === 'render')).toEqual([]);
    expect(tilesOf(s.ir)).toBe(2);
    expect(s.streamer!.stats()).toMatchObject({ resident: 2, copies: 60 });
  });

  it('a view edit whose commit throws leaves the streamer holding what the viewer still shows', async () => {
    const adapter = new FakeAdapter();
    const { s, settle } = open(adapter, [], 30);
    await s.start();
    await settle();
    expect(s.streamer!.stats().resident).toBe(2);
    adapter.fail = true;
    // the far view evicts both resident tiles in its step (its loads are still in flight), then its commit throws
    await expect(s.edit((d) => ({ ...d, session: { ...d.session, view: 'v.far' } }), 'far')).rejects.toThrow(
      'commit failed',
    );
    expect(tilesOf(s.ir)).toBe(2);
    expect(s.streamer!.stats()).toMatchObject({ resident: 2, copies: 60 });
  });
});
