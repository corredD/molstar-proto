/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { StateSelection } from '@molstar/core/state';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { createCheckpointPort } from '@molstar/prism-viewer/sources/checkpoint';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import type { MesoViewSpecApi } from '../extension.js';
import { MesoPlacements, MesoTilePlacements } from '../particle-list.js';
import { StreamingBudgetKey } from '../streaming-settings.js';
import { stubCanvasForLabels } from './canvas.js';

stubCanvasForLabels();

// A streamed document in prism-me (prism.md §9, lane `mvs-streaming-app`), headless, through the person's API: the
// tiled fixture opened as the app opens it (`mesoviewspec.open` `example`). What it proves: tiles come and go with no
// History step, no change outside the API and no `particles.*` run; a checkpoint holds the document's lists and no
// tile; Undo of a look edit gives the kept tiles the undone looks; Undo of the open takes the tiles away; the budget is
// a viewer setting (Settings, Behaviors) that Undo restores; the camera fed is where tiles load.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  viewers.push(v);
  const person = v.api.as({ kind: 'person' });
  const runs: string[] = [];
  v.api.events.started.subscribe((r) => runs.push(r.operation));
  const errors: string[] = [];
  v.plugin.events.log.subscribe((e) => {
    if (e.type === 'error') errors.push(String(e.message));
  });
  const area = () => (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec;
  /** Waits until no tile is in flight and every stream step queued has run. */
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      await sleep(10);
      const session = area().model.session;
      if (!session) return;
      await session.exclusive(async () => {});
      if (!session.streamer?.stats().inFlight) {
        await sleep(10);
        await session.exclusive(async () => {});
        if (!session.streamer?.stats().inFlight) return;
      }
    }
    throw new Error('the stream did not settle');
  };
  const state = v.plugin.state.data;
  const tileCells = () => state.select(StateSelection.Generators.ofTransformer(MesoTilePlacements));
  const tileRefs = () => tileCells().map((c) => c.transform.ref);
  /** Each tile list's representations' layers (by tile ref): what its looks are drawn with. */
  const tileLayers = () =>
    tileCells().map((c) =>
      state
        .select(StateSelection.Generators.byRef(c.transform.ref).subtree())
        .filter((l) => l.transform.transformer === ParticleRepresentation3DLayers)
        .flatMap((l) => (l.transform.params as { layers: { color: number | null }[] }).layers),
    );
  const steps = () => v.managers.history.steps.value;
  const unsafe = () => steps().filter((s) => s.unsafe !== undefined);
  const resident = () => area().model.session?.streamer?.stats();
  return { v, person, runs, errors, area, settle, tileCells, tileRefs, tileLayers, steps, unsafe, resident };
}

const openTiled = async (h: Awaited<ReturnType<typeof setup>>) => {
  const r = await h.person.run('mesoviewspec.open', { example: 'tiled' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await h.settle();
};

describe('a streamed document in prism-me (headless)', () => {
  it('tiles load and leave with no History step, no change outside the API and no particles run', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openTiled(h);
    expect(h.steps().length).toBe(1);
    const stats = h.resident()!;
    expect(stats.resident).toBeGreaterThan(0);
    expect(stats.copies).toBeLessThanOrEqual(stats.budget);
    expect(h.tileCells().length).toBe(stats.resident);
    // every tile list is drawn: a representation under it
    for (const c of h.tileCells()) {
      const reps = h.v.plugin.state.data.select(
        StateSelection.Generators.byRef(c.transform.ref).subtree().ofType(SO.Particle.Representation3D),
      );
      expect(reps.length).toBe(1);
    }
    const before = h.runs.length;
    // the camera moved to the far corner: tiles there load, the corner's leave
    await h.area().model.setFocus({ center: [7000, 7000, 3000], radius: 0 });
    await h.settle();
    expect(h.resident()!.evicted).toBeGreaterThan(0);
    expect(h.resident()!.copies).toBeLessThanOrEqual(h.resident()!.budget);
    expect(h.runs.slice(before)).toEqual([]);
    expect(h.steps().length).toBe(1);
    expect(h.unsafe()).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it("a checkpoint holds the document's lists and no tile", async () => {
    const h = await setup();
    await openTiled(h);
    expect(h.tileCells().length).toBeGreaterThan(0);
    const transformers = createCheckpointPort(h.v.plugin)
      .checkpoint()
      .plugin.data!.tree.transforms.map((t) => t.transformer);
    expect(transformers).toContain(MesoPlacements.id);
    expect(transformers).not.toContain(MesoTilePlacements.id);
  });

  it('Undo of a look edit while tiles stream: the same tile lists, with the undone looks', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openTiled(h);
    const red = 0xff0000;
    const hasRed = () => h.tileLayers().map((layers) => layers.some((l) => l.color === red));
    expect((await h.person.run('mesoviewspec.look', { select: '(population p.a)', color: 'red' })).ok).toBe(true);
    await h.settle();
    const refs = h.tileRefs();
    expect(hasRed().every(Boolean)).toBe(true);
    expect(h.steps().length).toBe(2);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    await h.settle();
    expect(h.tileRefs()).toEqual(refs);
    expect(hasRed().some(Boolean)).toBe(false);
    expect(h.steps().length).toBe(1);
    // Redo: red again
    expect((await h.v.managers.history.redo()).ok).toBe(true);
    await h.settle();
    expect(hasRed().every(Boolean)).toBe(true);
    expect(h.unsafe()).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it('Undo of the open takes the tiles away', async () => {
    const h = await setup();
    await openTiled(h);
    expect(h.tileCells().length).toBeGreaterThan(0);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    await sleep(50);
    expect(h.tileCells().length).toBe(0);
    expect(h.area().model.doc).toBeUndefined();
  });

  it('a .molj of a streamed document opens on a new viewer: no tile list comes with it, no error', async () => {
    const h = await setup();
    await openTiled(h);
    const saved = await h.person.run('session.save', { kind: 'state' });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const text = saved.ok ? await (saved.value as { blob: Blob }).blob.text() : '';
    const g = await setup();
    const opened = await g.person.run('session.open', { data: text, type: 'molj' });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    await g.settle();
    expect(g.area().model.doc).toBeDefined();
    // a tile the session held is left out or deleted: its provider is code, not in the file (stream.manifest)
    expect(g.tileCells().length).toBe(0);
    expect(g.errors).toEqual([]);
  });

  it('the budget is a viewer setting: fewer copies resident, and Undo restores it', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openTiled(h);
    const got = (await h.person.settings.get({ group: 'behaviors' })) as {
      ok: boolean;
      value: { values: Record<string, { budget: number }> }[];
    };
    expect(got.ok).toBe(true);
    const budget = got.value[0].values[StreamingBudgetKey].budget;
    expect(h.resident()!.budget).toBe(budget);
    expect(h.resident()!.resident).toBeGreaterThan(1);
    const set = await h.person.settings.set({ group: 'behaviors', values: { [StreamingBudgetKey]: { budget: 400 } } });
    expect(set.ok, JSON.stringify(set)).toBe(true);
    await h.settle();
    expect(h.resident()).toMatchObject({ budget: 400, resident: 1, copies: 400 });
    expect(h.tileCells().length).toBe(1);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    await h.settle();
    expect(h.resident()!.budget).toBe(budget);
    expect(h.resident()!.resident).toBeGreaterThan(1);
    expect(h.unsafe()).toEqual([]);
  });
});
