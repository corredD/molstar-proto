/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { type Row, rowsOf, toggleVisible } from '../rows.js';

// The tree's eyes on a cellPACK-like model (_spec/ui.md §3), a model made in memory: lipids in the membrane, CA and NC
// in the capsid, one entity without a compartment. A model's eye closed closes every eye under it; an entity's eye
// opened under it shows that entity alone (the model shown, the others hidden), one step.

function cellpackLike(): ParticleList {
  const rows: [number, number][] = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, -1],
  ];
  const count = rows.length;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from(rows, (_, i) => i),
    targets: Int32Array.from(rows, ([t]) => t),
    targetInfo: new Map([0, 1, 2, 3].map((t) => [t, { entity: t }])),
    entityInfo: new Map([
      [0, { name: 'lipids' }],
      [1, { name: 'CA' }],
      [2, { name: 'NC' }],
      [3, { name: 'loose' }],
    ]),
    compartments: Int32Array.from(rows, ([, c]) => c),
    compartmentInfo: new Map([
      [0, { name: 'root.envelope.membrane' }],
      [1, { name: 'root.envelope.capsid' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-tree-eyes-model',
  display: { name: 'Test Tree Eyes Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(cellpackLike(), { label: 'HIV' });
  },
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const AllOpen = { has: () => true } as unknown as ReadonlySet<string>;

describe("the tree's eyes on a model", () => {
  it('a model hidden closes every eye under it; an entity opened under it is shown alone, in one step', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
    });
    viewers.push(v);
    await v.plugin.build().toRoot().apply(TestModel, {}).commit();
    const list = v.plugin.managers.particles.hierarchy.current.lists[0];
    const ref = list.cell.transform.ref;
    const r0 = await v.api.particles.representation({ type: 'spacefill', particles: ref });
    if (!r0.ok) throw new Error(r0.message);

    const objects = v.api.explorer!.objectsState();
    const info = v.api.mesoscale!.infoState(ref);
    const sub = info.subscribe(() => {});
    const rows = () =>
      rowsOf(objects.value, new Map([[ref, info.value as MesoscaleInfo | undefined]]), AllOpen, '').filter(
        (r) => r.depth >= 1,
      );
    const eyes = () => Object.fromEntries(rows().map((r) => [r.label, r.visible]));
    const row = (label: string) => rows().find((r) => r.label === label) as Row;
    await until(() => rows().some((r) => r.label === 'CA'));
    expect(eyes()).toMatchObject({ HIV: true, lipids: true, CA: true, NC: true, loose: true });

    // the model's eye closed: every eye under it closed
    const r1 = await toggleVisible(v.api, row('HIV'));
    expect(r1?.ok).toBe(true);
    await until(() => eyes().HIV === false);
    expect(eyes()).toMatchObject({ HIV: false, root: false, lipids: false, CA: false, NC: false, loose: false });

    // CA's eye opened: the model shown with CA alone, one step
    const steps = v.api.history.steps.value.length;
    const r2 = await toggleVisible(v.api, row('CA'));
    expect(r2?.ok).toBe(true);
    await until(() => eyes().CA === true);
    expect(eyes()).toMatchObject({
      HIV: true,
      root: true,
      capsid: true,
      CA: true,
      lipids: false,
      NC: false,
      loose: false,
    });
    expect(v.plugin.state.data.cells.get(ref)!.state.isHidden).toBeFalsy();
    expect(v.api.history.steps.value.length).toBe(steps + 1);

    // its undo: the model hidden again, its eyes closed
    await v.api.run('history.undo', {});
    await until(() => eyes().HIV === false);
    expect(eyes()).toMatchObject({ CA: false, lipids: false });

    // the model opened again: the eyes as they were before it was hidden
    const r3 = await toggleVisible(v.api, row('HIV'));
    expect(r3?.ok).toBe(true);
    await until(() => eyes().HIV === true);
    expect(eyes()).toMatchObject({ lipids: true, CA: true, NC: true, loose: true });
    sub.unsubscribe();
  });
});
