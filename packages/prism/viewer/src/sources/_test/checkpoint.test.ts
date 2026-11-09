/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { StateTransform, StateTree } from '@molstar/core/state';
import { StructureFocusRepresentationTags } from '@molstar/plugin/behavior/dynamic/selection/structure-focus-representation';
import { PluginStateObject, PluginStateTransform } from '@molstar/plugin/state/objects';
import { CreateGroup } from '@molstar/plugin/state/transforms/misc/group';
import { describe, expect, it } from 'vitest';
import { cbs, crambin, expectOk, headlessViewer } from '../../_test/harness.js';
import { checkpointSize, createCheckpointPort, isBehaviorOwned, registerBehaviorOwned } from '../checkpoint.js';

// The history's checkpoints (sequence.md §7.2, §7.4): what they hold, what they measure, and what Undo and Redo give
// back from them.

/** The full size the budget estimates: the checkpoint's JSON without data payloads. */
const fullSize = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'string' && v.length > 1024 ? '' : ArrayBuffer.isView(v) ? '' : v))
    .length;

/** The data tree as JSON: what a restore must give back. */
const treeOf = (v: Awaited<ReturnType<typeof headlessViewer>>) =>
  JSON.stringify(StateTree.toJSON(v.plugin.state.data.tree));

describe('checkpoints', () => {
  it('hold the data tree as the plugin serializes it, and follow each change', async () => {
    const v = await headlessViewer({ files: [cbs(), crambin()] });
    const port = createCheckpointPort(v.plugin);
    const a = port.checkpoint();
    expect(a.plugin.data?.tree).toEqual(StateTree.toJSON(v.plugin.state.data.tree));
    expect(a.plugin.camera).toBeUndefined();
    expect(a.plugin.structureSelection).toBeUndefined();

    expectOk(await v.api.representation.color({ target: 'polymer', theme: 'hydrophobicity' }));
    const b = port.checkpoint();
    expect(b.plugin.data?.tree).toEqual(StateTree.toJSON(v.plugin.state.data.tree));
    expect(b.plugin.data?.tree).not.toEqual(a.plugin.data?.tree);
  });

  it('share the transforms a step did not change, and see state flags changed in place', async () => {
    const v = await headlessViewer({ files: [cbs(), crambin()] });
    const port = createCheckpointPort(v.plugin);
    const a = port.checkpoint();
    expectOk(await v.api.representation.color({ target: 'polymer', theme: 'hydrophobicity' }));
    const b = port.checkpoint();
    const byRef = new Map(a.plugin.data!.tree.transforms.map((t) => [t.ref, t]));
    const shared = b.plugin.data!.tree.transforms.filter((t) => byRef.get(t.ref) === t);
    const changed = b.plugin.data!.tree.transforms.filter((t) => byRef.get(t.ref) !== t);
    expect(changed.length).toBeGreaterThan(0);
    expect(shared.length).toBeGreaterThan(changed.length);
    for (const t of changed) expect(t.version).not.toBe(byRef.get(t.ref)?.version);

    // The state's transient tree merges a second flag update into the same transform object.
    const ref = [...v.plugin.state.data.cells.values()].find((c) =>
      c.transform.transformer.id.endsWith('structure-representation-3d'),
    )!.transform.ref;
    const hidden = (c: ReturnType<typeof port.checkpoint>) =>
      !!c.plugin.data!.tree.transforms.find((t) => t.ref === ref)?.state?.isHidden;
    v.plugin.state.data.updateCellState(ref, { isHidden: true });
    expect(hidden(port.checkpoint())).toBe(true);
    v.plugin.state.data.updateCellState(ref, { isHidden: false });
    expect(hidden(port.checkpoint())).toBe(false);
    v.plugin.state.data.updateCellState(ref, { isHidden: true });
    const c = port.checkpoint();
    expect(hidden(c)).toBe(true);
    expect(c.plugin.data?.tree).toEqual(StateTree.toJSON(v.plugin.state.data.tree));
  });

  it('measure the JSON size without payloads', async () => {
    const v = await headlessViewer({ files: [cbs(), crambin()] });
    const port = createCheckpointPort(v.plugin);
    const c = port.checkpoint();
    const size = port.size!(c);
    expect(size).toBeGreaterThan(1000);
    expect(Math.abs(size - fullSize(c.plugin)) / fullSize(c.plugin)).toBeLessThan(0.02);
    expect(Math.abs(checkpointSize(c) - size)).toBeLessThan(0.02 * size);
    // A change is measured: another style changes the size.
    expectOk(await v.api.styles.apply({ style: 'spacefill' }));
    const d = port.checkpoint();
    expect(port.size!(d)).not.toBe(size);
    expect(Math.abs(port.size!(d) - fullSize(d.plugin)) / fullSize(d.plugin)).toBeLessThan(0.02);
  });

  it('undo and redo walk back and forth through several steps', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const states = [treeOf(v)];
    for (const theme of ['hydrophobicity', 'secondary-structure', 'element-symbol'] as const) {
      expectOk(await v.api.representation.color({ target: 'polymer', theme }));
      states.push(treeOf(v));
    }
    expect(new Set(states).size).toBe(4);
    for (let i = 3; i > 0; i--) {
      expectOk(await v.api.history.undo({}));
      expect(treeOf(v)).toEqual(states[i - 1]);
    }
    for (let i = 1; i <= 3; i++) {
      expectOk(await v.api.history.redo({}));
      expect(treeOf(v)).toEqual(states[i]);
    }
    // Undo after redo still restores the step before.
    expectOk(await v.api.history.undo({}));
    expect(treeOf(v)).toEqual(states[2]);
  });
});

// Cells a behavior owns (sequence.md §7.2, §7.3): a group stands for a transformer of a lazy extension's behavior.
const Tile = PluginStateTransform.BuiltIn({ name: 'test-tile', from: [], to: PluginStateObject.Group, params: {} })({
  apply: () => new PluginStateObject.Group({}, { label: 'tile' }),
});

describe('behavior-owned cells', () => {
  type Viewer = Awaited<ReturnType<typeof headlessViewer>>;
  const unsafe = (v: Viewer) => v.managers.history.steps.value[0].unsafe;
  const addGroup = async (v: Viewer, parent?: string, tags?: string[]) => {
    const b = v.plugin.state.data.build();
    const group = (parent ? b.to(parent) : b.toRoot()).apply(CreateGroup, { label: 'tiles' }, { tags });
    await b.commit();
    return group.ref;
  };
  const refsOf = (c: ReturnType<ReturnType<typeof createCheckpointPort>['checkpoint']>) =>
    c.plugin.data!.tree.transforms.map((t) => t.ref);

  it('are no change outside the API when their transformer is registered, and are one when it is not', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    expect(unsafe(v)).toBeUndefined();
    const unregister = registerBehaviorOwned(v.plugin, [CreateGroup]);
    const tiles = await addGroup(v);
    // Made, updated and removed by the behavior: the steps before stay undoable.
    await v.plugin.state.data.build().to(tiles).update({ label: 'more tiles' }).commit();
    await v.plugin.state.data.build().delete(tiles).commit();
    expect(unsafe(v)).toBeUndefined();
    // Taken back: the same cell is a change like any other.
    unregister();
    await addGroup(v);
    expect(unsafe(v)).toMatch(/outside/);
  });

  it('count a registration once whoever registers, and per plugin', async () => {
    const a = await headlessViewer({ files: [crambin()] });
    const b = await headlessViewer({ files: [crambin()] });
    const group = StateTransform.create('ms-plugin.root', CreateGroup, { label: 'x' }, { ref: 'g' });
    const one = registerBehaviorOwned(a.plugin, [CreateGroup.id]);
    const two = registerBehaviorOwned(a.plugin, [CreateGroup]);
    expect(isBehaviorOwned(group, a.plugin)).toBe(true);
    expect(isBehaviorOwned(group, b.plugin)).toBe(false);
    expect(isBehaviorOwned(group)).toBe(false);
    one();
    one();
    expect(isBehaviorOwned(group, a.plugin)).toBe(true);
    two();
    expect(isBehaviorOwned(group, a.plugin)).toBe(false);
  });

  it('are left out of a checkpoint with what hangs from them, and a restore keeps them', async () => {
    const v = await headlessViewer({ files: [cbs(), crambin()] });
    registerBehaviorOwned(v.plugin, [CreateGroup]);
    const port = createCheckpointPort(v.plugin);
    const before = port.checkpoint();
    const tiles = await addGroup(v);
    const nested = await addGroup(v, tiles);
    // A cell of the person's, made under a tile: a tile's descendants are the tile's.
    const ownedCells = [tiles, nested];
    const after = port.checkpoint();
    for (const ref of ownedCells) expect(refsOf(after)).not.toContain(ref);
    expect(refsOf(after)).toEqual(refsOf(before));
    expect(port.size!(after)).toBe(port.size!(before));

    // A step after the checkpoint is undone; the tiles stay, as the same cells (not made again).
    const cell = v.plugin.state.data.cells.get(tiles)!;
    expectOk(await v.api.representation.color({ target: 'polymer', theme: 'hydrophobicity' }));
    await port.restore(before);
    expect(treeOf(v)).toContain(tiles);
    expect(v.plugin.state.data.cells.get(tiles)).toBe(cell);
    expect(v.plugin.state.data.tree.children.get(tiles).toArray()).toEqual([nested]);
    expect(v.plugin.state.data.tree.transforms.get(tiles)!.parent).toBe(StateTransform.RootRef);
    // The scene is what the checkpoint held.
    expect(refsOf(port.checkpoint())).toEqual(refsOf(before));
    const colors = (c: typeof before) => JSON.stringify(c.plugin.data!.tree);
    expect(colors(port.checkpoint())).toBe(colors(before));
  });

  it('go with a parent a restore removes', async () => {
    const v = await headlessViewer({});
    registerBehaviorOwned(v.plugin, [CreateGroup]);
    const port = createCheckpointPort(v.plugin);
    const empty = port.checkpoint();
    expectOk(await v.api.load.files({ files: [crambin()] }));
    const structure = [...v.plugin.state.data.cells.values()].find((c) =>
      c.transform.transformer.id.endsWith('structure-from-model'),
    )!.transform.ref;
    const tiles = await addGroup(v, structure);
    expect(v.plugin.state.data.cells.has(tiles)).toBe(true);
    await port.restore(empty);
    expect(v.plugin.state.data.cells.has(structure)).toBe(false);
    expect(v.plugin.state.data.cells.has(tiles)).toBe(false);
  });

  it('keep the fixed list: the focus, streaming and custom properties cells', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    const port = createCheckpointPort(v.plugin);
    const before = port.checkpoint();
    // Not registered by anyone.
    const focus = await addGroup(v, undefined, [StructureFocusRepresentationTags.TargetRepr]);
    expect(unsafe(v)).toBeUndefined();
    // The fixed list is no change outside the API; it is not left out of checkpoints (custom properties are the
    // structures' parents).
    expect(refsOf(port.checkpoint())).toEqual([...refsOf(before), focus]);
    for (const id of ['ms-plugin.volume-streaming', 'ms-plugin.custom-model-properties']) {
      const t = StateTransform.create('ms-plugin.root', { ...CreateGroup, id } as never, {}, { ref: id });
      expect(isBehaviorOwned(t)).toBe(true);
    }
    expect(refsOf(before)).toContain(
      [...v.plugin.state.data.cells.values()].find((c) =>
        c.transform.transformer.id.endsWith('custom-model-properties'),
      )!.transform.ref,
    );
  });

  it('hide nothing under the fixed list: the structures are under custom properties and changes there are outside', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    expect(unsafe(v)).toBeUndefined();
    const rep = [...v.plugin.state.data.cells.values()].find((c) =>
      c.transform.transformer.id.endsWith('structure-representation-3d'),
    )!;
    await v.plugin.state.data.build().delete(rep.transform.ref).commit();
    expect(unsafe(v)).toMatch(/outside/);
  });

  it('are no outside change when a commit removes a tile with a child and makes another, among many', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    registerBehaviorOwned(v.plugin, [Tile]);
    const b = v.plugin.state.data.build();
    for (let i = 0; i < 140; i++) {
      b.toRoot().apply(Tile, {}, { ref: `t${i}` }).apply(CreateGroup, { label: 'rep' }, { ref: `t${i}-c` });
    }
    await b.commit();
    const next = v.plugin.state.data.build();
    next.delete('t0');
    next.toRoot().apply(Tile, {}, { ref: 'new' });
    await next.commit();
    expect(unsafe(v)).toBeUndefined();
  });

  it('are no outside change when registered after they exist', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    registerBehaviorOwned(v.plugin, [Tile])();
    const b = v.plugin.state.data.build();
    b.toRoot().apply(Tile, {}, { ref: 't' }).apply(CreateGroup, { label: 'rep' }, { ref: 't-c' });
    await b.commit();
    // The creation above was outside; a step after it is the one watched.
    expectOk(await v.api.representation.color({ target: 'polymer', theme: 'hydrophobicity' }));
    expect(unsafe(v)).toBeUndefined();
    registerBehaviorOwned(v.plugin, [Tile]);
    await v.plugin.state.data.build().delete('t').commit();
    expect(unsafe(v)).toBeUndefined();
  });

  it('go with a dependency a restore removes', async () => {
    const v = await headlessViewer({});
    registerBehaviorOwned(v.plugin, [Tile]);
    const port = createCheckpointPort(v.plugin);
    const empty = port.checkpoint();
    expectOk(await v.api.load.files({ files: [crambin()] }));
    const structure = [...v.plugin.state.data.cells.values()].find((c) =>
      c.transform.transformer.id.endsWith('structure-from-model'),
    )!.transform.ref;
    await v.plugin.state.data.build().toRoot().apply(Tile, {}, { ref: 'dep', dependsOn: [structure] }).commit();
    await port.restore(empty);
    expect(v.plugin.state.data.cells.has('dep')).toBe(false);
  });
});

// A custom state is measured once per value (sequence.md §7.4).
describe('custom state in the size', () => {
  it('is measured once for a value that is the same object, and again for a new one', async () => {
    const v = await headlessViewer({ files: [crambin()] });
    const doc = { version: 1, items: Array.from({ length: 200 }, (_, i) => ({ id: i, text: `item ${i}` })) };
    let current: unknown = doc;
    let gets = 0;
    v.plugin.state.registerCustomState('test.document', { get: () => (gets++, current), set: () => {} });
    const port = createCheckpointPort(v.plugin);
    let measured = 0;
    const real = JSON.stringify;
    const spy = (value: unknown, ...rest: unknown[]) => {
      if (value === doc) measured++;
      return (real as (...a: unknown[]) => string)(value, ...rest);
    };
    const original = JSON.stringify;
    JSON.stringify = spy as typeof JSON.stringify;
    try {
      const a = port.checkpoint();
      const b = port.checkpoint();
      const sizeA = port.size!(a);
      expect(port.size!(b)).toBe(sizeA);
      expect(measured).toBe(1);
      // The size is the checkpoint's JSON (the document counted whole).
      expect(Math.abs(sizeA - fullSize(a.plugin)) / fullSize(a.plugin)).toBeLessThan(0.02);
      expect(sizeA).toBeGreaterThan(real(doc).length);
      // A new object is measured.
      current = { ...doc, version: 2 };
      const c = port.checkpoint();
      expect(port.size!(c)).toBeGreaterThan(0);
      expect(real(c.plugin.custom!['test.document'])).toContain('"version":2');
    } finally {
      JSON.stringify = original;
    }
    expect(gets).toBeGreaterThan(0);
  });
});
