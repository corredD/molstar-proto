/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { StateSelection } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { afterEach, describe, expect, it } from 'vitest';
import { expectOk } from '../../../_test/harness.js';
import { DefaultPrismViewerSpec } from '../../../default-spec.js';
import { createPrismViewerHeadless } from '../../../headless.js';
import type { PrismViewer } from '../../../viewer.js';

// `particles.look` (one owner of a particle representation's layers cell): patches, each writer's fields kept, over
// a small Simularium file (several targets) on a headless viewer.

const simularium = () =>
  new File(
    [readFileSync(new URL('../../../../../../../data/examples/particles/small.simularium', import.meta.url))],
    'small.simularium',
  );

let viewer: PrismViewer | undefined;
afterEach(async () => {
  await viewer?.dispose();
  viewer = undefined;
});

async function create() {
  viewer = await createPrismViewerHeadless({ spec: DefaultPrismViewerSpec() });
  expectOk(await viewer.api.load.files({ files: [simularium()] }));
  return viewer;
}

const red = Color(0xff0000);
const blue = Color(0x0000ff);

const list = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];

/** The looks cells, by their representation's ref */
const looks = (v: PrismViewer) => {
  const cells = v.plugin.state.data.select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers));
  return new Map(cells.map((c) => [c.transform.parent, c.transform.params as any]));
};
const lookOf = (v: PrismViewer) => looks(v).get(list(v).representations[0].cell.transform.ref);

describe('particles.look', () => {
  it('merges layers by their selector (ids sorted), keeping the fields a patch leaves out', async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [2, 1] }, color: red }] }));
    expectOk(await run({ layers: [{ selector: { targets: [0] }, visible: false }] }));
    expectOk(await run({ layers: [{ selector: { targets: [1, 2] }, transparency: 0.5 }] }));
    expect(lookOf(v).layers).toEqual([
      { entities: [], compartments: [], targets: [1, 2], visible: true, color: red, transparency: 0.5, emissive: null },
      { entities: [], compartments: [], targets: [0], visible: false, color: null, transparency: null, emissive: null },
    ]);
  });

  it('clears a field with null, drops a layer left with no change, and the cell when nothing is left', async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: red, emissive: 0.4 }] }));
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: null }] }));
    expect(lookOf(v).layers).toMatchObject([{ targets: [1], color: null, emissive: 0.4 }]);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, emissive: null }] }));
    expect(looks(v).size).toBe(0);
  });

  it('resets a layer, then sets what the same patch gives', async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: red, visible: false }] }));
    expectOk(await run({ layers: [{ selector: { targets: [1] }, reset: true, color: blue }] }));
    expect(lookOf(v).layers).toMatchObject([{ targets: [1], visible: true, color: blue }]);
  });

  it("leaves another writer's fields: the hidden targets and the cuts stay through a layer patch, and back", async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ hidden: [2] }));
    expectOk(
      await v.api.clipping.add({
        shape: 'sphere',
        node: `#${list(v).cell.transform.ref}`,
        particles: { targets: [1] },
      }),
    );
    expectOk(await run({ layers: [{ selector: { targets: [0] }, color: red }] }));
    let look = lookOf(v);
    expect(look.hidden).toEqual([2]);
    expect(look.cuts).toHaveLength(1);
    expect(look.layers).toHaveLength(1);
    // the cut gone: the layer and the hidden targets kept
    expectOk(await v.api.clipping.remove({ cut: 1 }));
    look = lookOf(v);
    expect([look.cuts, look.hidden, look.layers.length]).toEqual([[], [2], 1]);
    // a layer patch with no hidden given keeps them; `hidden: []` clears them
    expectOk(await run({ layers: [{ selector: { targets: [0] }, reset: true }] }));
    expect(lookOf(v).hidden).toEqual([2]);
    expectOk(await run({ hidden: [] }));
    expect(looks(v).size).toBe(0);
  });

  it('is already so when nothing changes, without a history step', async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: red }] }));
    const again = await run({ layers: [{ selector: { targets: [1] }, color: red }] });
    expect(again).toMatchObject({ ok: true, unchanged: true });
    const none = await run({ layers: [{ selector: { targets: [2] }, color: null }] });
    expect(none).toMatchObject({ ok: true, unchanged: true });
    expect(await run({})).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('writes every representation of the list in one step, and one undo takes back one call', async () => {
    const v = await create();
    expectOk(await v.api.particles!.representation({ type: 'orientation' }));
    const refs = list(v).representations.map((r) => r.cell.transform.ref);
    expect(refs).toHaveLength(2);
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: red }] }));
    expectOk(await run({ layers: [{ selector: { targets: [2] }, color: blue }] }));
    for (const ref of refs) expect(looks(v).get(ref)?.layers).toHaveLength(2);
    expectOk(await v.api.run('history.undo', {}));
    for (const ref of refs) expect(looks(v).get(ref)?.layers).toMatchObject([{ targets: [1], color: red }]);
    expectOk(await v.api.run('history.undo', {}));
    expect(looks(v).size).toBe(0);
  });

  it('patches several lists in one call: one tree update, one step, one undo', async () => {
    const v = await create();
    expectOk(await v.api.load.files({ files: [new File([await simularium().arrayBuffer()], 'second.simularium')] }));
    const [a, b] = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
    const lookOfList = (ref: string) => {
      const l = v.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === ref)!;
      return looks(v).get(l.representations[0].cell.transform.ref);
    };
    const state = v.plugin.state.data;
    const updateTree = state.updateTree.bind(state);
    let updates = 0;
    (state as { updateTree: typeof updateTree }).updateTree = ((...args: Parameters<typeof updateTree>) => {
      updates++;
      return updateTree(...args);
    }) as typeof updateTree;
    const steps = v.api.history.steps.value.length;
    try {
      expectOk(
        await v.api.run('particles.look', {
          lists: [
            { particles: a, layers: [{ selector: { targets: [1] }, color: red }] },
            { particles: b, layers: [{ selector: { targets: [2] }, color: blue }], hidden: [0] },
          ],
        }),
      );
    } finally {
      (state as { updateTree: typeof updateTree }).updateTree = updateTree;
    }
    expect(updates).toBe(1);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expect(lookOfList(a)).toMatchObject({ layers: [{ targets: [1], color: red }], hidden: [] });
    expect(lookOfList(b)).toMatchObject({ layers: [{ targets: [2], color: blue }], hidden: [0] });
    // a list that would not change is left as it is; all of them so: already
    expect(
      await v.api.run('particles.look', {
        lists: [{ particles: a, layers: [{ selector: { targets: [1] }, color: red }] }],
      }),
    ).toMatchObject({ ok: true, unchanged: true });
    // one bad list: nothing written
    expect(
      await v.api.run('particles.look', {
        lists: [
          { particles: a, layers: [{ selector: { targets: [3] }, color: blue }] },
          { particles: 'nothing-here', layers: [{ selector: { targets: [1] }, color: red }] },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(lookOfList(a)?.layers).toHaveLength(1);
    expectOk(await v.api.run('history.undo', {}));
    expect(lookOfList(a)).toBeUndefined();
    expect(lookOfList(b)).toBeUndefined();
  });

  it('refuses lists mixed with one patch, a representation or a node, and an entry that is no patch', async () => {
    const v = await create();
    const a = list(v).cell.transform.ref;
    const one = { particles: a, layers: [{ selector: { targets: [1] }, color: red }] };
    for (const extra of [{ representation: 'spacefill' }, { node: 'representation' }, { hidden: [1] }]) {
      expect(await v.api.run('particles.look', { lists: [one], ...extra })).toMatchObject({
        ok: false,
        code: 'invalid',
      });
    }
    expect(await v.api.run('particles.look', { lists: [null] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(looks(v).size).toBe(0);
    // one list given twice: both patches, its representation said once
    const r = await v.api.run('particles.look', {
      lists: [one, { particles: a, layers: [{ selector: { targets: [2] }, color: blue }] }],
    });
    expectOk(r);
    expect(r.did.match(/Spacefill|spacefill/g)?.length ?? 1).toBe(1);
  });

  it("gives a representation added to a list the list's layers (not its cuts, nor its hidden targets)", async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    expectOk(await run({ layers: [{ selector: { targets: [1] }, color: red }], hidden: [2] }));
    expectOk(await v.api.particles!.representation({ type: 'orientation' }));
    const [, added] = list(v).representations.map((r) => r.cell.transform.ref);
    expect(looks(v).get(added)).toMatchObject({ layers: [{ targets: [1], color: red }], hidden: [], cuts: [] });
    // one step: undone with the representation
    expectOk(await v.api.run('history.undo', {}));
    expect(list(v).representations).toHaveLength(1);
  });

  it('refuses a malformed patch as invalid, and keys a selector by its distinct ids', async () => {
    const v = await create();
    const run = (p: Record<string, unknown>) => v.api.run('particles.look', p);
    for (const bad of [
      { layers: [{ color: red }] },
      { layers: 'x' },
      { layers: [{ selector: { targets: ['1'] }, color: red }] },
      { layers: [{ selector: { targets: [1] }, color: 'red' }] },
      { layers: [{ selector: { targets: [1] }, transparency: 7 }] },
      { hidden: ['a', 1] },
      { cuts: { add: [{ targets: [1] }] } },
    ]) {
      expect(await run(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(looks(v).size).toBe(0);
    expectOk(await run({ layers: [{ selector: { targets: [2, 2] }, color: red }] }));
    expectOk(await run({ layers: [{ selector: { targets: [2] }, color: blue }] }));
    expect(lookOf(v).layers).toMatchObject([{ targets: [2], color: blue }]);
  });

  it('writes one representation by node', async () => {
    const v = await create();
    expectOk(await v.api.particles!.representation({ type: 'orientation' }));
    const [first, second] = list(v).representations.map((r) => r.cell.transform.ref);
    expectOk(await v.api.run('particles.look', { node: `#${second}`, hidden: [1] }));
    expect(looks(v).has(first)).toBe(false);
    expect(looks(v).get(second)?.hidden).toEqual([1]);
  });
});
