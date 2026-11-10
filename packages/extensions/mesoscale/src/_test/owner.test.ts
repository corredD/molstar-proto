/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { ParticleRepresentation3DLayers } from '@molstar/plugin/state/transforms/particles/layers';
import { afterEach, describe, expect, it } from 'vitest';
import type { MesoGroup } from '../model.js';
import { type OwnedEdit, type ParticleListOwner, registerParticleListOwner } from '../owner.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { readFileSync } from 'node:fs';
import { setTestTargetStructure, TestParticleList, TestPlainList, TestTargetList } from './fixtures.js';

// The owner port (packages/mesoscale/_spec/prism.md §1.1, §5.1): a list another extension owns (a MesoViewSpec
// document's) is styled by its owner, never by layers this extension writes. The operations read its entities and groups
// from the owner and propose their edits to it, inside the same run: one step, one undo, with other lists alongside.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** The owner's groups: two compartments by their document ids, entities 0 and 1 in the first, 2 and 3 in the second */
const OwnerGroups: MesoGroup = {
  path: '',
  label: 'Document',
  entities: [],
  groups: [
    { path: 'c.envelope', label: 'Envelope', entities: [0, 1], groups: [] },
    { path: 'c.core', label: 'Core', entities: [2, 3], groups: [] },
  ],
};

/** An owner of the first list: records what it is asked and draws it as one layer color (a change, so a step) */
function fakeOwner(v: PrismViewer, owned: string) {
  const proposed: OwnedEdit[] = [];
  const owner: ParticleListOwner = {
    owns: (list) => list === owned,
    info: (list) =>
      list === owned
        ? {
            entities: [0, 1, 2, 3].map((id) => ({ id, name: `pop${id}`, count: 1, compartment: -1 })),
            groups: OwnerGroups,
            groupBy: 'compartment',
            hasCompartments: true,
            aliases: new Map([
              ['p.two', 2],
              ['pop1', 3],
            ]),
          }
        : undefined,
    async propose(edit: OwnedEdit, api: ViewerApi) {
      proposed.push(edit);
      const layers = edit.lists.flatMap((l) =>
        l.looks.map((x) => ({ selector: { entities: [...x.entities] }, color: x.change.color ?? Color(0x123456) })),
      );
      const r = await api.particles!.look({ particles: owned, layers } as never);
      return r;
    },
  };
  const unregister = registerParticleListOwner(v.plugin, owner);
  return { proposed, unregister };
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  await v.plugin.build().toRoot().apply(TestPlainList).commit();
  const [owned, plain] = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
  expectOk(await v.api.particles.representation({ type: 'spacefill', particles: owned }));
  expectOk(await v.api.particles.representation({ type: 'spacefill', particles: plain }));
  const o = fakeOwner(v, owned);
  return { v, owned, plain, ...o, steps: () => v.api.history.steps.value.length };
}

/** The layers the extension wrote on a list's first representation */
function layers(v: PrismViewer, list: string) {
  const l = v.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === list)!;
  const tree = v.plugin.state.data.tree;
  for (const child of tree.children.get(l.representations[0].cell.transform.ref).toArray()) {
    const t = tree.transforms.get(child);
    if (t?.transformer === ParticleRepresentation3DLayers) return (t.params as { layers: unknown[] }).layers;
  }
  return [];
}

describe('an owned list (prism.md §1.1)', () => {
  it('entities: the entities and groups are the owner’s', async () => {
    const { v, owned } = await viewer();
    const r = await v.api.run('mesoscale.entities', { particles: owned });
    expectOk(r);
    const info = r.value as { groups: MesoGroup; entities: { name: string }[] };
    expect(info.groups).toEqual(OwnerGroups);
    expect(info.entities.map((e) => e.name)).toEqual(['pop0', 'pop1', 'pop2', 'pop3']);
  });

  it('style: one proposal of the entities’ change, one step; the group is named; no layer of its own', async () => {
    const { v, owned, proposed, steps } = await viewer();
    const s0 = steps();
    expectOk(await v.api.run('mesoscale.style', { particles: owned, group: 'c.core', color: '#ff0000' }));
    expect(steps()).toBe(s0 + 1);
    expect(proposed).toEqual([
      {
        label: 'style',
        lists: [{ list: owned, looks: [{ entities: [2, 3], group: 'c.core', change: { color: Color(0xff0000) } }] }],
      },
    ]);
    // the fake owner drew it as one layer: the extension wrote none of its own
    expect(layers(v, owned)).toHaveLength(1);
  });

  it('colors: generated over the owner’s groups, one look an entity, one proposal', async () => {
    const { v, owned, proposed } = await viewer();
    expectOk(await v.api.run('mesoscale.colors', { particles: owned, scheme: 'generate' }));
    expect(proposed).toHaveLength(1);
    const looks = proposed[0].lists[0].looks;
    expect(looks.map((l) => l.entities)).toEqual([[0], [1], [2], [3]]);
    // a hue per compartment: the two in a group are near each other, unlike across
    for (const l of looks) expect(l.change.color).toBeTypeOf('number');
    expectOk(await v.api.run('mesoscale.colors', { particles: owned, scheme: 'theme' }));
    expect(proposed[1].lists[0].looks.every((l) => l.change.color === null)).toBe(true);
  });

  it('importColors: the matched entities in one proposal, by the owner’s names', async () => {
    const { v, owned, proposed, steps } = await viewer();
    const s0 = steps();
    const r = await v.api.run('mesoscale.importColors', {
      particles: owned,
      json: JSON.stringify({ pop1: '#00ff00', pop3: 'blue', nothing: 'red' }),
    });
    expectOk(r);
    expect(steps()).toBe(s0 + 1);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].label).toBe('import colors');
    expect(proposed[0].lists[0].looks.map((l) => [l.entities, l.change.color])).toEqual([
      [[1], Color(0x00ff00)],
      [[3], Color(0x0000ff)],
    ]);
    expect((r.value as { unmatched: string[] }).unmatched).toEqual(['nothing']);
  });

  it('names: an entity is found by its name, then by the owner’s other name for it (a population id)', async () => {
    const { v, owned, proposed } = await viewer();
    const r = await v.api.run('mesoscale.importColors', {
      particles: owned,
      json: JSON.stringify({ 'p.two': '#ff00ff', pop1: '#00ffff' }),
    });
    expectOk(r);
    // the name wins over another entity's alias of the same text
    expect(proposed[0].lists[0].looks.map((l) => [l.entities, l.change.color])).toEqual([
      [[2], Color(0xff00ff)],
      [[1], Color(0x00ffff)],
    ]);
    expectOk(await v.api.run('mesoscale.style', { particles: owned, entities: 'p.two', visible: false }));
    expect(proposed[1].lists[0].looks[0].entities).toEqual([2]);
  });

  it('theme over an owned list and a plain one: one step, one undo; the owner proposes, the plain list takes the theme', async () => {
    const { v, owned, plain, proposed, steps } = await viewer();
    const themeName = () =>
      (
        v.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === plain)!
          .representations[0].cell.transform.params as { colorTheme: { name: string } }
      ).colorTheme.name;
    const before = themeName();
    const s0 = steps();
    expectOk(await v.api.run('mesoscale.theme', { objects: [owned, plain], theme: 'uniform', color: '#808080' }));
    expect(steps()).toBe(s0 + 1);
    expect(themeName()).toBe('uniform');
    expect(proposed).toHaveLength(1);
    expect(proposed[0].label).toBe('theme');
    // one color for all the owner draws (prism.md §5.1: "one document, one color")
    expect(proposed[0].lists[0].looks).toEqual([
      { entities: [0, 1, 2, 3], whole: true, change: { color: Color(0x808080) } },
    ]);
    expect(layers(v, owned)).toHaveLength(1);
    expectOk(await v.api.run('history.undo', {}));
    expect(themeName()).toBe(before);
    expect(layers(v, owned)).toHaveLength(0);
  });

  it('a list the owner does not own is styled by layers, as before', async () => {
    const { v, plain, proposed } = await viewer();
    expectOk(await v.api.run('mesoscale.style', { particles: plain, entities: '0', color: '#ff0000' }));
    expect(proposed).toHaveLength(0);
    expect(layers(v, plain)).toHaveLength(1);
  });
});

describe('an owned list’s theme changed by zoom (prism.md §5.3)', () => {
  /** An owned list drawn as targets (1CRN at every target): an owner told when its colors follow the zoom */
  async function targets() {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
    expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
    setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
    await v.plugin.build().toRoot().apply(TestTargetList).commit();
    expectOk(await v.api.particles.representation({ type: 'target' }));
    const ref = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const told: string[][] = [];
    const owner: ParticleListOwner = {
      owns: (list) => list === ref,
      info: () => undefined,
      propose: async () => ApiResult.already('so'),
      themeChanged: async (lists) => {
        told.push([...lists]);
      },
    };
    registerParticleListOwner(v.plugin, owner);
    return { v, ref, told, steps: () => v.api.history.steps.value.length };
  }

  it('colorLevels on and off: the owner draws its looks again, each one step', async () => {
    const { v, ref, told, steps } = await targets();
    const s0 = steps();
    expectOk(await v.api.run('mesoscale.colorLevels', { on: true }));
    expect(told).toEqual([[ref]]);
    expect(steps()).toBe(s0 + 1);
    expectOk(await v.api.run('mesoscale.colorLevels', { on: false }));
    expect(told).toEqual([[ref], [ref]]);
    expect(steps()).toBe(s0 + 2);
  });

  it('theme by zoom: the owner draws its looks again, in the one step', async () => {
    const { v, ref, told, steps } = await targets();
    const s0 = steps();
    expectOk(await v.api.run('mesoscale.theme', { objects: [ref], theme: 'zoom' }));
    expect(told).toEqual([[ref]]);
    expect(steps()).toBe(s0 + 1);
  });
});
