/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import type { IR } from '@molstar/meso-spec/ir/ir';
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
