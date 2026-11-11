/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { StateSelection } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Canvas3DParams } from '@molstar/graphics/canvas3d/canvas3d';
import { type IR, placementSets } from '@molstar/meso-spec/ir';
import type { CommitReport } from '@molstar/meso-spec/runtime';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { createCheckpointPort } from '@molstar/prism-viewer/sources/checkpoint';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import type { MesoViewSpecApi } from '../extension.js';
import { RestMs } from '../camera-feed.js';
import { MesoPlacements, MesoTilePlacements, placementStore } from '../particle-list.js';
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
  const state = v.plugin.state.data;
  const tileCells = () => state.select(StateSelection.Generators.ofTransformer(MesoTilePlacements));
  /** Every resident tile (the session's IR) has one list, drawn by one representation, and no other tile has one. */
  const expectTilesDrawn = () => {
    const ir = area().model.session?.ir;
    const resident = ir ? placementSets(ir).filter((s) => s.model === 'm.tiles') : [];
    const keys = tileCells().map((c) => (c.transform.params as { key: string }).key);
    expect(new Set(keys).size, 'a tile drawn twice').toBe(keys.length);
    expect([...keys].sort()).toEqual(resident.map((s) => s.key).sort());
    for (const c of tileCells()) {
      const reps = state.select(
        StateSelection.Generators.byRef(c.transform.ref).subtree().ofType(SO.Particle.Representation3D),
      );
      expect(reps.length, `representations of ${c.transform.ref}`).toBe(1);
    }
  };
  /** Waits until no tile is in flight and every stream step queued has run; then every resident tile is drawn. */
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      await sleep(10);
      const session = area().model.session;
      if (!session) return;
      await session.exclusive(async () => {});
      if (!session.streamer?.stats().inFlight) {
        await sleep(10);
        await session.exclusive(async () => {});
        if (!session.streamer?.stats().inFlight) return expectTilesDrawn();
      }
    }
    throw new Error('the stream did not settle');
  };
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

type Harness = Awaited<ReturnType<typeof setup>>;

const openTiled = async (h: Harness) => {
  const r = await h.person.run('mesoviewspec.open', { example: 'tiled' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await h.settle();
};

const Far = { center: [7000, 7000, 3000] as [number, number, number], radius: 0 };

/**
 * The next stream commit that draws a tile not drawn yet, held midway (its plan made against the lists drawn, at the
 * load of the particles extension before it draws) until the session is disposed: the commit a Close or an Undo of
 * the open meets in flight. `entered` resolves once it is held; `done` is the held commit's end (its failure let go).
 */
function holdArrival(h: Harness) {
  const model = h.area().model;
  const adapter = model.adapter;
  const session = model.session!;
  const extensions = adapter.viewer.extensions;
  const commit = adapter.commit.bind(adapter);
  const load = extensions.load.bind(extensions);
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const dispose = session.dispose.bind(session);
  session.dispose = () => {
    release();
    dispose();
  };
  let armed = false;
  let held: Promise<CommitReport> | undefined;
  adapter.commit = (ir: IR) => {
    const drawn = adapter.tileKeys();
    if (held || !placementSets(ir).some((s) => s.model === 'm.tiles' && !drawn.has(s.key))) return commit(ir);
    armed = true;
    held = commit(ir);
    return held;
  };
  extensions.load = async (id: string) => {
    if (armed) {
      armed = false;
      enter();
      await released;
    }
    return load(id);
  };
  return {
    entered,
    done: async () => {
      await held?.catch(() => {});
      adapter.commit = commit;
      extensions.load = load;
    },
  };
}

/** Nothing of the document is drawn or kept by the adapter: no list, no tile placements, no key. */
function expectNothingDrawn(h: Harness) {
  const adapter = h.area().model.adapter;
  expect(h.tileCells().length, 'tile lists').toBe(0);
  const lists = h.v.plugin.state.data.select(StateSelection.Generators.ofTransformer(MesoPlacements));
  expect(lists.length, 'document lists').toBe(0);
  expect([...placementStore(h.v.plugin).keys()].filter((k) => k.includes('#t.')), 'tile placements').toEqual([]);
  expect([...adapter.tileKeys()], 'tile keys').toEqual([]);
  expect(adapter.keys(), 'document keys').toEqual([]);
}

/** The open's first commit drew a new scene (nothing kept): the one that sets the camera. */
function expectNewScene(h: Harness) {
  const initial = h.area().model.session!.history.find((r) => r.kind === 'initial');
  expect(initial?.commit?.kept, 'kept by the first commit').toEqual([]);
}

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
    // an evicted tile's placements went with its list: the store holds the document's sets and the resident tiles only
    const adapter = h.area().model.adapter;
    const held = new Set([...adapter.keys(), ...adapter.tileKeys()]);
    expect([...placementStore(h.v.plugin).keys()].filter((k) => !held.has(k))).toEqual([]);
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

  it('Undo while tiles are arriving: the tiles the restore takes in are drawn', { tags: ['medium'] }, async () => {
    const h = await setup();
    // 4 tiles: all asked for at once (4 in flight), so no later arrival's commit would draw what the restore took in
    const budget = await h.person.settings.set({
      group: 'behaviors',
      values: { [StreamingBudgetKey]: { budget: 1600 } },
    });
    expect(budget.ok).toBe(true);
    await openTiled(h);
    expect((await h.person.run('mesoviewspec.look', { select: '(population p.a)', color: 'red' })).ok).toBe(true);
    await h.settle();
    const session = h.area().model.session!;
    // the camera to the far corner: its tiles are asked for; the queue is held while they land (150 ms each), and the
    // Undo's restore is queued before the stream step their arrival queues, so the restore takes them in
    void h.area().model.setFocus({ center: [7000, 7000, 3000], radius: 0 });
    const held = session.exclusive(() => sleep(400));
    const undone = h.v.managers.history.undo();
    await held;
    expect((await undone).ok).toBe(true);
    await h.settle();
    expect(h.resident()!.resident).toBeGreaterThan(0);
    expect(h.tileLayers().some((layers) => layers.some((l) => l.color === 0xff0000))).toBe(false);
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

  // gate M1: Close ran outside the session's queue, so a stream commit in flight landed after the lists were cleared
  it('Close while a tile is drawn: nothing is left, and an open again draws anew', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openTiled(h);
    const hold = holdArrival(h);
    void h.area().model.setFocus(Far);
    await hold.entered;
    const closed = await h.person.run('mesoviewspec.close', {});
    expect(closed.ok, JSON.stringify(closed)).toBe(true);
    await hold.done();
    expectNothingDrawn(h);
    await openTiled(h);
    expectNewScene(h);
    expect(h.errors).toEqual([]);
  });

  // gate M1: the same for Undo of the open (the owner's `forget`)
  it('Undo of the open while a tile is drawn: nothing is left, and an open again draws anew', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openTiled(h);
    const hold = holdArrival(h);
    void h.area().model.setFocus(Far);
    await hold.entered;
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    await hold.done();
    expectNothingDrawn(h);
    await openTiled(h);
    expectNewScene(h);
    expect(h.errors).toEqual([]);
  });

  // gate S5: the extension's feed wiring (`feedCanvasCamera` to `setFocus`) was tested over a fake canvas alone
  it('the canvas camera, once it rests, is where the open document streams', { tags: ['medium'] }, async () => {
    const h = await setup();
    const plugin = h.v.plugin as unknown as { canvas3d: unknown };
    // a canvas the feed reads (its draws and its camera), there only while the feed attaches and fires: the
    // representations' sync would draw into it. Its view sees the whole box (|x|, |y|, |z| ≤ 10⁴ Å), so the tiles go by
    // their distance from the eye
    const draws = new Set<() => void>();
    const target = [0, 0, 0];
    const position = [0, 0, 0];
    const projectionView = [1e-4, 0, 0, 0, 0, 1e-4, 0, 0, 0, 0, 1e-4, 0, 0, 0, 0, 1];
    const canvas = {
      camera: { target, position, projectionView },
      didDraw: {
        subscribe(f: () => void) {
          draws.add(f);
          return { unsubscribe: () => draws.delete(f) };
        },
      },
    };
    plugin.canvas3d = canvas;
    // the first call loads the chunk: the area attaches its feed to the canvas there
    expect((await h.person.run('mesoviewspec.close', {})).ok).toBe(true);
    plugin.canvas3d = undefined;
    expect(draws.size).toBe(1);
    await openTiled(h);
    const model = h.area().model;
    const session = model.session!;
    const fed: unknown[] = [];
    const setFocus = model.setFocus.bind(model);
    model.setFocus = (focus) => {
      fed.push(focus);
      plugin.canvas3d = undefined;
      return setFocus(focus);
    };
    plugin.canvas3d = canvas;
    // the target in the middle, the eye at the far corner: the tiles come by the eye
    target.splice(0, 3, 4000, 4000, 2000);
    position.splice(0, 3, ...Far.center);
    for (const f of draws) f();
    await sleep(RestMs + 100);
    plugin.canvas3d = undefined;
    expect(fed).toMatchObject([{ center: [4000, 4000, 2000], radius: 0, view: { eye: Far.center } }]);
    expect((session as unknown as { focus: unknown }).focus).toBe(fed[0]);
    await h.settle();
    const resident = placementSets(session.ir!).filter((s) => s.model === 'm.tiles');
    expect(resident.some((s) => s.key.endsWith('#t.3.3.1'))).toBe(true);
    expect(resident.some((s) => s.key.endsWith('#t.0.0.0'))).toBe(false);
    expect(h.errors).toEqual([]);
  });

  // gate S4: the session a restore made started with no focus, and the feed does not fire again (the canvas stayed)
  it('Undo of Close streams where the camera was fed before the close', { tags: ['medium'] }, async () => {
    const h = await setup();
    await openTiled(h);
    const residentKeys = () =>
      placementSets(h.area().model.session!.ir!)
        .filter((s) => s.model === 'm.tiles')
        .map((s) => s.key)
        .sort();
    const corner = residentKeys();
    await h.area().model.setFocus(Far);
    await h.settle();
    const far = residentKeys();
    expect(far).not.toEqual(corner);
    expect((await h.person.run('mesoviewspec.close', {})).ok).toBe(true);
    expect((await h.v.managers.history.undo()).ok).toBe(true);
    await h.settle();
    expect(residentKeys()).toEqual(far);
    expect(h.errors).toEqual([]);
  });

  // Ludo's app check (2026-11-10): panned, the camera re-centered by itself, and the tiles loaded around the centre, not
  // where he looked. Canvas3D resets the camera on a scene commit whose new renderable lies outside the old bounds
  // (`shouldResetCamera`: a tile at the box's edge, beyond the three landmarks' sphere), unless `camera.manualReset`.
  // Headless has no Canvas3D (no WebGL here): a stand-in canvas that takes the representations as Canvas3D does and,
  // as its frame commit would, re-centers the camera on any scene change committed without `manualReset` (stricter
  // than Canvas3D, which spares a renderable inside the old bounds). What it proves: every tile written in a stream
  // step, after a pan and on an Undo while tiles stream, reaches the canvas committed under the hold; the camera stays
  // where the person left it; `manualReset` is the person's again after, and in the checkpoint.
  it('tiles streamed in after a pan, and an Undo while they stream, leave the camera where the person left it', {
    tags: ['medium'],
  }, async () => {
    const h = await setup();
    await openTiled(h);
    const plugin = h.v.plugin as unknown as { canvas3d: unknown };
    const target = [4000, 4000, 2000];
    const position = [4000, 4000, 30000];
    let manualReset = false;
    let pending = false;
    let resets = 0;
    let written = 0;
    // the canvas props as Canvas3D's (a restore emits `settingsUpdated`, whose readers read them whole)
    const defaults = PD.getDefaultValues(Canvas3DParams);
    const canvas = {
      get props() {
        return { ...defaults, camera: { ...defaults.camera, manualReset } };
      },
      setProps(p: { camera?: { manualReset?: boolean } }) {
        if (p.camera?.manualReset !== undefined) manualReset = p.camera.manualReset;
      },
      add: () => void ((pending = true), written++),
      remove: () => void ((pending = true), written++),
      update() {},
      requestDraw() {},
      commit() {
        if (!pending) return;
        pending = false;
        if (manualReset) return;
        resets++;
        target.splice(0, 3, 4000, 4000, 2000);
        position.splice(0, 3, 4000, 4000, 30000);
      },
      reprCount: { value: 3 },
      boundingSphere: { center: [4000, 4000, 2000], radius: 6000 },
      camera: { target, position, setState() {} },
    };
    plugin.canvas3d = canvas;
    try {
      // the person pans to the far corner: the canvas looks there, and the feed tells the owner
      target.splice(0, 3, ...Far.center);
      position.splice(0, 3, Far.center[0], Far.center[1], Far.center[2] + 20000);
      await h.area().model.setFocus(Far);
      await h.settle();
      canvas.commit(); // a frame: Canvas3D commits what is left
      expect(written, 'tiles reached the canvas').toBeGreaterThan(0);
      expect(resets, 'camera resets').toBe(0);
      expect(target).toEqual(Far.center);
      expect(manualReset).toBe(false);
      // fewer copies: a stream step that only evicts (Canvas3D resets when the camera is left over nothing)
      const before = written;
      const fewer = await h.person.settings.set({ group: 'behaviors', values: { [StreamingBudgetKey]: { budget: 400 } } });
      expect(fewer.ok).toBe(true);
      await h.settle();
      canvas.commit();
      expect(h.resident()!.resident).toBe(1);
      expect(written, 'tiles left the canvas').toBeGreaterThan(before);
      expect(resets, 'camera resets').toBe(0);
      expect(target).toEqual(Far.center);
      // a look edit and its Undo while tiles stream (the restore's adoption writes the tiles' looks)
      expect((await h.person.run('mesoviewspec.look', { select: '(population p.a)', color: 'red' })).ok).toBe(true);
      await h.settle();
      expect((await h.v.managers.history.undo()).ok).toBe(true);
      await h.settle();
      canvas.commit();
      expect(resets, 'camera resets').toBe(0);
      expect(target).toEqual(Far.center);
      expect(manualReset).toBe(false);
      const checkpoint = createCheckpointPort(h.v.plugin).checkpoint();
      expect((checkpoint.plugin.canvas3d?.props as { camera?: { manualReset?: boolean } })?.camera?.manualReset).toBe(
        false,
      );
      expect(h.errors).toEqual([]);
    } finally {
      plugin.canvas3d = undefined;
    }
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
