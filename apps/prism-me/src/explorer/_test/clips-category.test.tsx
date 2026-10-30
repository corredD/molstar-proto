/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { StructureElement } from '@molstar/model/model/structure';
import { clipItems } from '../menu.js';
import { whatItCuts } from '../rows.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// Clips in a category of their own (_spec/ui.md §3, §4, §5; lane clips-category), over a headless viewer in jsdom:
// 1CRN (data/examples) and a cellPACK-like model made in memory: lipids in the envelope's membrane, CA and NC in its
// capsid, MA in the envelope itself (so the membrane and the capsid together are not all of the envelope), one entity
// without a compartment. A clip is one Prism cut (its tag) over what it is given; each add or remove is one step.

function hivLike(): ParticleList {
  const rows: [number, number][] = [
    [0, 0],
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, -1],
  ];
  const count = rows.length;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from(rows, (_, i) => i),
    targets: Int32Array.from(rows, ([t]) => t),
    targetInfo: new Map([0, 1, 2, 3, 4].map((t) => [t, { entity: t }])),
    entityInfo: new Map([
      [0, { name: 'lipids' }],
      [1, { name: 'CA' }],
      [2, { name: 'NC' }],
      [3, { name: 'MA' }],
      [4, { name: 'loose' }],
    ]),
    compartments: Int32Array.from(rows, ([, c]) => c),
    compartmentInfo: new Map([
      [0, { name: 'root.envelope.membrane' }],
      [1, { name: 'root.envelope.capsid' }],
      [2, { name: 'root.envelope' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-clips-model',
  display: { name: 'Test Clips Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(hivLike(), { label: 'HIV' });
  },
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = new File(
    [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
    '1crn.cif',
  );
  const l = await v.api.load.files({ files: [crn] });
  if (!l.ok) throw new Error(l.message);
  await v.plugin.build().toRoot().apply(TestModel, {}).commit();
  for (const list of v.plugin.managers.particles.hierarchy.current.lists) {
    const r = await v.api.particles.representation({ type: 'spacefill', particles: list.cell.transform.ref });
    if (!r.ok) throw new Error(r.message);
  }
  return v;
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function mount(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  const area = api.explorer!;
  const model = sceneModelOf(area)!;
  const refOf = (label: string) => area.objectsState().value.find((o) => o.label === label)!.ref;
  return { api, area, host, model, refOf };
}

const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const cuts = (v: PrismViewer) => v.api.clipping.cuts.value;
const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const labelOf = (row: HTMLElement) => row.querySelector('[data-tip-overflow]')?.textContent ?? '';
const item = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`) ?? undefined;
const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`);
const header = (host: HTMLElement, id: string) => section(host, id)?.querySelector<HTMLButtonElement>('button');
async function open(host: HTMLElement, id: string) {
  await until(() => !!header(host, id));
  if (header(host, id)!.getAttribute('aria-expanded') !== 'true') header(host, id)!.click();
}
/** The names a clip's What it cuts lists, or a node's Clips */
const names = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-clip-use]')).map((u) => u.dataset.clipUse);
/** Picks an option of a Select (Prism's: a listbox) labelled `label` in `el` */
async function choose(el: HTMLElement, label: string, option: string) {
  const select = el.querySelector<HTMLButtonElement>(`button[aria-haspopup=listbox][aria-label="${label}"]`);
  expect(select, label).toBeTruthy();
  select!.click();
  await until(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).some((o) => o.textContent === option),
  );
  Array.from(document.querySelectorAll<HTMLElement>('[role=option]'))
    .find((o) => o.textContent === option)!
    .click();
}
/** Whether a cut is through any representation of an object */
const cutsObject = (v: PrismViewer, tag: string, ref: string) =>
  !!cuts(v)
    .find((c) => c.object.tag === tag)
    ?.targets.some((t) => v.api.explorer!.isUnder(t.ref, ref));

describe('the Clips category', () => {
  it('lists every clip of the scene after the other categories, and no clip row under an object', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const crn = refOf('1CRN');
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    for (const add of [
      { shape: 'plane', node: `#${crn}` },
      { shape: 'sphere', node: `#${hiv}`, particles: { entities: [0] } },
    ]) {
      const r = await v.api.run('clipping.add', add);
      if (!r.ok) throw new Error(r.message);
    }
    const [plane, sphere] = cuts(v).map((c) => c.object.tag!);
    // every row open: the objects' and the parts'
    model.open.set(new Set(items(host).map((r) => r.dataset.treeKey!)));
    await until(() => !!item(host, `k:${plane}`));
    model.open.set(
      new Set([...model.open.value, `o:${crn}`, `o:${hiv}`, ...items(host).map((r) => r.dataset.treeKey!)]),
    );
    await new Promise((r) => setTimeout(r, 20));
    const top = items(host).filter((r) => r.getAttribute('aria-level') === '1');
    expect(top.map(labelOf)).toEqual(['Structures', 'Particles', 'Clips']);
    const clipRows = items(host).filter((r) => r.dataset.treeKey!.startsWith('k:'));
    expect(clipRows.map((r) => [r.getAttribute('aria-level'), labelOf(r)])).toEqual([
      ['2', 'Plane 1'],
      ['2', 'Sphere 2'],
    ]);
    // all of them under the Clips category, after every other row
    const all = items(host).map((r) => r.dataset.treeKey);
    expect(all.indexOf('c:clips')).toBe(all.length - 3);
    expect(all.slice(-2)).toEqual([`k:${plane}`, `k:${sphere}`]);
    // each says how many objects or parts it cuts
    expect(item(host, `k:${plane}`)!.textContent).toContain('1 object');
  });
});

describe("the Clips category's eye and ⋯ (with tree-eyes)", () => {
  it('draws every clip in the scene in one step; its ⋯ has New clip…', async () => {
    const v = await viewer();
    const { host, refOf } = mount(v);
    const crn = refOf('1CRN');
    for (const shape of ['plane', 'sphere']) {
      const r = await v.api.run('clipping.add', { shape, node: `#${crn}` });
      if (!r.ok) throw new Error(r.message);
    }
    await until(() => !!item(host, 'c:clips'));
    const n = steps(v);
    item(host, 'c:clips')!.querySelector<HTMLButtonElement>('button[aria-label="Show"]')!.click();
    await until(() => cuts(v).every((c) => !!c.drawing));
    expect(steps(v)).toBe(n + 1);
    // its ⋯: New clip… (a new clip of every object of the scene)
    item(host, 'c:clips')!.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click();
    await until(() => document.querySelectorAll('[role=menuitem]').length > 0);
    expect(Array.from(document.querySelectorAll('[role=menuitem]')).map((m) => m.textContent?.trim())).toEqual([
      'New clip… (every object)',
    ]);
  });
});

describe("a clip's What it cuts", () => {
  it('lists what it is given; Cut also and × are one step each and change what is cut', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const crn = refOf('1CRN');
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}`, particles: { entities: [0] } });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    await until(() => !!item(host, `k:${tag}`));
    item(host, `k:${tag}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'clip');
    const clip = () => section(host, 'clip')!;
    await until(() => names(clip()).length === 1);
    expect(names(clip())).toEqual(['envelope › membrane']);
    // the last one's × is off: a clip cuts something (Remove the clip instead)
    expect(clip().querySelector<HTMLButtonElement>('[data-clip-use] button[aria-label^="No longer"]')!.disabled).toBe(
      true,
    );

    // Cut also: 1CRN, one step
    const n = steps(v);
    await choose(clip(), 'An object or part this clip also cuts', '1CRN');
    await until(() => cutsObject(v, tag, crn));
    expect(steps(v)).toBe(n + 1);
    await until(() => names(clip()).length === 2);
    expect(names(clip())).toEqual(['1CRN', 'envelope › membrane']);

    // Cut also: the capsid, the same cut on the same representations, one step; both parts listed
    await choose(clip(), 'An object or part this clip also cuts', 'envelope › capsid');
    await until(() => names(clip()).length === 3);
    expect(steps(v)).toBe(n + 2);
    expect(cuts(v)).toHaveLength(1);
    expect(names(clip())).toEqual(['1CRN', 'envelope › membrane', 'envelope › capsid']);

    // ×: 1CRN no longer cut, one step
    const drop = (name: string) =>
      clip().querySelector<HTMLButtonElement>(`[data-clip-use="${name}"] button[aria-label^="No longer"]`)!;
    drop('1CRN').click();
    await until(() => !cutsObject(v, tag, crn));
    expect(steps(v)).toBe(n + 3);
    await until(() => names(clip()).length === 2);
    // ×: the membrane, the capsid still cut
    drop('envelope › membrane').click();
    await until(() => names(clip()).length === 1);
    expect(steps(v)).toBe(n + 4);
    expect(names(clip())).toEqual(['envelope › capsid']);
    expect(cutsObject(v, tag, hiv)).toBe(true);

    // undo: each step back, one at a time
    await v.api.run('history.undo', {});
    await until(() => names(clip()).length === 2);
    expect(cutsObject(v, tag, crn)).toBe(false);
  });
});

describe("a node's Clips", () => {
  it('lists the clips on it, makes a new one that cuts it, and uses one of the scene on a second object', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const crn = refOf('1CRN');
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    // the membrane's Clips: none, then a new plane, one step, cutting the membrane only
    model.reveal({
      key: `g:${hiv}:root.envelope.membrane`,
      label: 'membrane',
      kind: 'group',
      node: { ref: hiv, particles: { entities: [0] } },
    });
    await until(() => !!item(host, `g:${hiv}:root.envelope.membrane`));
    item(host, `g:${hiv}:root.envelope.membrane`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'clips');
    const clips = () => section(host, 'clips')!;
    await until(() => !!clips().querySelector('button[aria-label="A new clip that cuts it"]'));
    expect(names(clips())).toEqual([]);
    const n = steps(v);
    await choose(clips(), 'A new clip that cuts it', 'Plane');
    await until(() => cuts(v).length === 1);
    expect(steps(v)).toBe(n + 1);
    const tag = cuts(v)[0].object.tag!;
    expect(cuts(v)[0].particles?.selector.entities).toEqual([0]);
    await until(() => names(clips()).length === 1);
    expect(names(clips())).toEqual(['Plane 1']);

    // 1CRN, a second object: Use a clip, one step; listed there, and under the clip
    item(host, `o:${crn}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await until(() => !!clips().querySelector('button[aria-label="A clip of the scene, used on it too"]'));
    expect(names(clips())).toEqual([]);
    await choose(clips(), 'A clip of the scene, used on it too', 'Plane 1');
    await until(() => cutsObject(v, tag, crn));
    expect(steps(v)).toBe(n + 2);
    await until(() => names(clips()).length === 1);
    expect(names(clips())).toEqual(['Plane 1']);
    // the membrane is still cut alone, one clip in the scene
    expect(cuts(v)).toHaveLength(1);
    expect(cuts(v)[0].particles?.selector.entities).toEqual([0]);
  });
});

describe('Add clip…', () => {
  it('lists a new clip of each shape and every clip of the scene, those on it already greyed', async () => {
    const v = await viewer();
    const { api, area, model, refOf } = mount(v);
    const crn = refOf('1CRN');
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    for (const add of [
      { shape: 'plane', node: `#${crn}` },
      { shape: 'sphere', node: `#${hiv}` },
    ]) {
      const r = await v.api.run('clipping.add', add);
      if (!r.ok) throw new Error(r.message);
    }
    const [plane, sphere] = cuts(v).map((c) => c.object.tag!);
    const menu = clipItems(api, area, { key: `o:${crn}`, label: '1CRN', kind: 'structure', node: { ref: crn } });
    expect(menu.map((i) => i.label)).toEqual([
      'New plane',
      'New sphere',
      'New box',
      'New cylinder',
      'New cone',
      'Use Plane 1',
      'Use Sphere 2',
    ]);
    expect(menu.find((i) => i.id === `use-${plane}`)!.disabled).toBeTruthy();
    expect(menu.find((i) => i.id === `use-${sphere}`)!.disabled).toBeFalsy();
    // using one: one step, it cuts 1CRN too
    const n = steps(v);
    menu.find((i) => i.id === `use-${sphere}`)!.run();
    await until(() => cutsObject(v, sphere, crn));
    expect(steps(v)).toBe(n + 1);
  });
});

describe('explorer.clipUse on structure parts and some compartments (review M1, M2, M3)', () => {
  const cbs = () =>
    new File([readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1cbs_updated.cif'))], '1cbs.cif');

  it("gives a part of a second structure, then all of it, without cutting the first's kept atoms again", async () => {
    const v = await viewer();
    for (const name of ['a.cif', 'b.cif']) {
      const l = await v.api.load.files({ files: [new File([await cbs().arrayBuffer()], name)] });
      if (!l.ok) throw new Error(l.message);
    }
    const { area } = mount(v);
    const objects = () => area.objectsState().value;
    const [a, b] = objects()
      .filter((o) => o.kind === 'structure')
      .slice(-2);
    const [e1, e2] = a.entities!.map((e) => e.id);
    const ok = async (params: object) => {
      const r = await v.api.run('explorer.clipUse', params);
      if (!r.ok) throw new Error(r.message);
    };
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${a.ref}` });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const cut = () => cuts(v).find((c) => c.object.tag === tag)!;
    const cutOn = (ref: string) => {
      const of = area.cutOf(cut(), ref);
      return of?.atoms ? StructureElement.Loci.size(of.atoms) : of ? 'all' : 0;
    };
    // a's second entity kept whole
    await ok({ tag, nodes: [{ ref: a.ref, entity: e2 }], on: false });
    const before = cutOn(a.ref);
    expect(typeof before).toBe('number');
    // b's first entity, then its second: a's kept atoms stay kept
    await ok({ tag, nodes: [{ ref: b.ref, entity: e1 }], on: true });
    await ok({ tag, nodes: [{ ref: b.ref, entity: e2 }], on: true });
    expect(cutOn(a.ref)).toBe(before);
    // all of b: a's too
    await ok({ tag, nodes: [{ ref: b.ref }], on: true });
    expect(cutOn(a.ref)).toBe(before);
    // all of b again: nothing changes, a's kept atoms stay kept (N1)
    const n = steps(v);
    await ok({ tag, nodes: [{ ref: b.ref }], on: true });
    expect(steps(v)).toBe(n);
    expect(cutOn(a.ref)).toBe(before);
    // b is cut whole: listed as itself, not by entities (M3)
    expect(cutOn(b.ref)).toBe('all');
    const uses = whatItCuts(area, cut(), objects(), new Map()).map((u) => u.key);
    expect(uses).toContain(`o:${b.ref}`);
  });

  it("keeps a clip's compartments when an entity is given to it, and lists them (M2)", async () => {
    const v = await viewer();
    const { area, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}`, particles: { compartments: [0] } });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const cut = () => cuts(v).find((c) => c.object.tag === tag)!;
    const uses = () => whatItCuts(area, cut(), area.objectsState().value, model.parts.value).map((u) => u.key);
    expect(uses()).not.toContain(`o:${hiv}`);
    const u = await v.api.run('explorer.clipUse', {
      tag,
      nodes: [{ ref: hiv, particles: { entities: [1] } }],
      on: true,
    });
    if (!u.ok) throw new Error(u.message);
    const of = area.cutOf(cut(), hiv)!;
    expect([of.particles?.compartments, of.particles?.entities]).toEqual([[0], [1]]);
    // two records, not one of both (Prism's selector intersects its kinds: compartment 0's entity 1 only)
    expect(of.records?.map((r) => [r.compartments, r.entities])).toEqual([
      [[0], []],
      [[], [1]],
    ]);
  });

  it('takes a part off every record of a clip, the last record of a part still last (review of clip-records)', async () => {
    const v = await viewer();
    const { area, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}`, particles: { entities: [1, 2] } });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const records = () => area.cutOf(cuts(v)[0], hiv)!.records!;
    // the capsid's compartment kept a layer of, then NC cut wider over it (the agent's, ⌘K's)
    const look = await v.api.run('particles.look', {
      particles: hiv,
      cuts: {
        add: [
          { tag, compartments: [1], mode: 'keep' },
          { tag, entities: [2], mode: 'wider' },
        ],
      },
    });
    if (!look.ok) throw new Error(look.message);
    const off = await v.api.run('explorer.clipUse', {
      tag,
      nodes: [{ ref: hiv, particles: { entities: [1] } }],
      on: false,
    });
    if (!off.ok) throw new Error(off.message);
    // NC's records are one, after the compartment's: NC still cut wider
    expect(records().map((x) => [x.entities, x.compartments, x.mode])).toEqual([
      [[], [1], 'keep'],
      [[2], [], 'wider'],
    ]);
  });

  it('takes a part off a clip of all of a model: a record of every other entity', async () => {
    const v = await viewer();
    const { area, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}` });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const off = await v.api.run('explorer.clipUse', {
      tag,
      nodes: [{ ref: hiv, particles: { entities: [0] } }],
      on: false,
    });
    if (!off.ok) throw new Error(off.message);
    const of = area.cutOf(cuts(v)[0], hiv)!;
    expect(of.records?.map((x) => x.entities)).toEqual([[1, 2, 3, 4]]);
  });
});

describe("a clip's Clip whole (lane clip-whole)", () => {
  it('shows Clip whole for the decorated object it cuts; a pick there runs stage.clipWhole, in step with its Clips', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const crn = refOf('1CRN');
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const d = await v.api.run('cryoet.decorate', { particles: hiv, with: 'object', object: '1crn' });
    if (!d.ok) throw new Error(d.message);
    await until(() => v.api.stage!.clipWholeState(hiv).value === 'pixel');
    // a plane on HIV and on 1CRN: Clip whole for HIV only (1CRN draws no objects)
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}` });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const u = await v.api.run('explorer.clipUse', { tag, nodes: [{ ref: crn }], on: true });
    if (!u.ok) throw new Error(u.message);
    await until(() => !!item(host, `k:${tag}`));
    item(host, `k:${tag}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'clip');
    const clip = () => section(host, 'clip')!;
    const button = (el: HTMLElement, label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label);
    await until(() => !!button(clip(), 'Proteins'));
    expect(clip().querySelectorAll('[data-clip-whole]')).toHaveLength(1);
    // Proteins: one step, the objects clipped whole
    const n = steps(v);
    button(clip(), 'Proteins')!.click();
    await until(() => v.api.stage!.clipWholeState(hiv).value === 'instance');
    expect(steps(v)).toBe(n + 1);
    // Atoms from HIV's own Clips: the clip's follows
    item(host, `o:${hiv}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'clips');
    await until(() => !!button(section(host, 'clips')!, 'Atoms'));
    button(section(host, 'clips')!, 'Atoms')!.click();
    await until(() => v.api.stage!.clipWholeState(hiv).value === 'element');
    item(host, `k:${tag}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'clip');
    await until(() => button(clip(), 'Atoms')?.getAttribute('aria-pressed') === 'true');
  });
});
