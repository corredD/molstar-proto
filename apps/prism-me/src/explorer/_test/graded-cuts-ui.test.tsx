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
import { RepresentationClip } from '@molstar/plugin/state/helpers/representation-clip';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { wayOf } from '../clips.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// Graded cuts and Shown in the app (_spec/ui.md §4; lane graded-cuts-ui), set up as clips-category.test.tsx, over a headless viewer in jsdom:
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

const variant = (v: PrismViewer) => v.plugin.managers.structure.component.state.options.clipObjects.variant;
/** The clip's records on the model's particles (Prism's, a part each) */
const records = (v: PrismViewer, ref: string) => v.api.explorer!.cutOf(cuts(v)[0], ref)?.records ?? [];
/** The variant the model's particle representation is cut with */
const repVariant = (v: PrismViewer, ref: string) => {
  const rep = v.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === ref)!
    .representations[0];
  return RepresentationClip.get(rep.cell.transform.params)?.variant;
};
/** The box of a slider (its typed value), by its label */
const box = (el: HTMLElement, label: string) =>
  el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]:not([type=range])`);

async function clipOn(v: PrismViewer, host: HTMLElement, add: object) {
  const r = await v.api.run('clipping.add', add);
  if (!r.ok) throw new Error(r.message);
  const tag = cuts(v)[0].object.tag!;
  await until(() => !!item(host, `k:${tag}`));
  item(host, `k:${tag}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
  await open(host, 'clip');
  return tag;
}

describe("a clip's graded ways (What it cuts)", () => {
  it('a part keeps a layer: one step, its record so, the cuts switched to instance; band and fuzziness one step each', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    await clipOn(v, host, { shape: 'plane', node: `#${hiv}`, particles: { entities: [0] } });
    const clip = () => section(host, 'clip')!;
    await until(() => names(clip()).length === 1);
    expect(variant(v)).toBe('pixel');
    const n = steps(v);
    await choose(clip(), 'What it does to envelope › membrane', 'Keeps a layer');
    await until(() => records(v, hiv)[0]?.mode === 'keep');
    expect(steps(v)).toBe(n + 1);
    expect(variant(v)).toBe('instance');
    expect(repVariant(v, hiv)).toBe('instance');
    // its band and fuzziness, typed: one step each
    await until(() => !!box(clip(), "envelope › membrane: the band's width"));
    const band = box(clip(), "envelope › membrane: the band's width")!;
    band.value = '120';
    band.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => records(v, hiv)[0]?.band === 120);
    expect(steps(v)).toBe(n + 2);
    const fuzz = box(clip(), 'envelope › membrane: fuzziness')!;
    fuzz.value = '40';
    fuzz.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => records(v, hiv)[0]?.fuzziness === 0.4);
    expect(steps(v)).toBe(n + 3);
    expect(records(v, hiv)).toHaveLength(1);
    // the clip moved: the representation stays instance (a cut written takes the scene's variant)
    const moved = await v.api.run('clipping.update', { tag: cuts(v)[0].object.tag!, position: [5, 0, 0] });
    if (!moved.ok) throw new Error(moved.message);
    expect(repVariant(v, hiv)).toBe('instance');
    // undo: back to the plain cut, at once
    await v.api.run('history.undo', {});
    await v.api.run('history.undo', {});
    await v.api.run('history.undo', {});
    await v.api.run('history.undo', {});
    await until(() => records(v, hiv)[0]?.mode === 'cut');
  });

  it('a part of a clip of all the model cut its way; the plain cut leaves the variant as it is', async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const tag = await clipOn(v, host, { shape: 'plane', node: `#${hiv}` });
    const clip = () => section(host, 'clip')!;
    await until(() => names(clip()).length === 1);
    expect(names(clip())).toEqual(['HIV']);
    // the plain cut of the membrane: its record over all of it, one step, the variant kept
    const n = steps(v);
    const r = await v.api.run('explorer.clipWay', {
      tag,
      node: { ref: hiv, particles: { entities: [0] } },
      mode: 'cut',
    });
    if (!r.ok) throw new Error(r.message);
    expect(steps(v)).toBe(n + 1);
    expect(variant(v)).toBe('pixel');
    // cut wider: the model's row and the membrane's, each its way
    const w = await v.api.run('explorer.clipWay', {
      tag,
      node: { ref: hiv, particles: { entities: [0] } },
      mode: 'wider',
      band: 80,
      fuzziness: 0,
    });
    if (!w.ok) throw new Error(w.message);
    expect(steps(v)).toBe(n + 2);
    expect(variant(v)).toBe('instance');
    expect(records(v, hiv).map((x) => [x.entities, x.mode])).toEqual([
      [[], 'cut'],
      [[0], 'wider'],
    ]);
    await until(() => names(clip()).length === 2);
    expect(names(clip())).toEqual(['HIV', 'envelope › membrane']);
    // a structure's: refused, nothing changed
    const crn = refOf('1CRN');
    await v.api.run('explorer.clipUse', { tag, nodes: [{ ref: crn }], on: true });
    const s = await v.api.run('explorer.clipWay', { tag, node: { ref: crn }, mode: 'keep' });
    expect(s.ok).toBe(false);
  });
});

describe('Look › Shown', () => {
  it("a group's share shown, typed: one step, its layer's share; 100 %: its share cleared", async () => {
    const v = await viewer();
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    model.reveal({
      key: `g:${hiv}:root.envelope.membrane`,
      label: 'membrane',
      kind: 'group',
      node: { ref: hiv, particles: { entities: [0] } },
    });
    await until(() => !!item(host, `g:${hiv}:root.envelope.membrane`));
    item(host, `g:${hiv}:root.envelope.membrane`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await open(host, 'look');
    const look = () => section(host, 'look')!;
    await until(() => !!box(look(), 'Shown'));
    const shown = v.api.explorer!.shownState({ ref: hiv, particles: { entities: [0] } });
    expect(shown.value).toBe(1);
    const n = steps(v);
    box(look(), 'Shown')!.value = '30';
    box(look(), 'Shown')!.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => shown.value === 0.3);
    expect(steps(v)).toBe(n + 1);
    box(look(), 'Shown')!.value = '100';
    box(look(), 'Shown')!.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => shown.value === 1);
    expect(steps(v)).toBe(n + 2);
  });
});

describe('explorer.clipWay on a clip of all the model (review)', () => {
  const ok = async (v: PrismViewer, params: object) => {
    const r = await v.api.run('explorer.clipWay', params);
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  const ways = (v: PrismViewer, ref: string) =>
    records(v, ref).map((x) => [x.entities, x.mode, x.band, x.fuzziness] as const);

  it("grades the part only (M1); the model's own way and its band kept apart (M2, S4); no step when nothing changes (S5)", async () => {
    const v = await viewer();
    const { area, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}` });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const membrane = { ref: hiv, particles: { entities: [0] } };
    // M1: the membrane cut wider, the rest of the model still cut plainly
    await ok(v, { tag, node: membrane, mode: 'wider', band: 80, fuzziness: 0 });
    expect(ways(v, hiv)).toEqual([
      [[], 'cut', 60, 0],
      [[0], 'wider', 80, 0],
    ]);
    // the model kept a layer of: its record, the membrane's left as it is
    await ok(v, { tag, node: { ref: hiv }, mode: 'keep', band: 100, fuzziness: 0 });
    expect(ways(v, hiv)).toEqual([
      [[], 'keep', 100, 0],
      [[0], 'wider', 80, 0],
    ]);
    // M2: the model reads its own way
    const of = () => area.cutOf(cuts(v)[0], hiv);
    expect(wayOf(of(), { ref: hiv })).toEqual({ mode: 'keep', band: 100, fuzziness: 0 });
    // S4: its band changed, the membrane's way kept
    await ok(v, { tag, node: { ref: hiv }, mode: 'keep', band: 150, fuzziness: 0 });
    expect(ways(v, hiv)).toEqual([
      [[], 'keep', 150, 0],
      [[0], 'wider', 80, 0],
    ]);
    // S8: a group of the membrane and the capsid (CA) has no one way
    expect(wayOf(of(), { ref: hiv, particles: { entities: [0, 1] } })).toBeUndefined();
    // S5: a group given in the tree's order (not sorted), twice: the second, no step
    const envelope = { ref: hiv, particles: { entities: [3, 1, 2] } };
    await ok(v, { tag, node: envelope, mode: 'wider', band: 90, fuzziness: 0 });
    const n = steps(v);
    const again = await ok(v, { tag, node: envelope, mode: 'wider', band: 90, fuzziness: 0 });
    expect(again.unchanged).toBe(true);
    expect(steps(v)).toBe(n);
  });

  it('switches to instance again when the scene went back to pixel (S6); one undo puts the variant back (11)', async () => {
    const v = await viewer();
    const { model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}`, particles: { entities: [0] } });
    if (!r.ok) throw new Error(r.message);
    const tag = cuts(v)[0].object.tag!;
    const membrane = { ref: hiv, particles: { entities: [0] } };
    await ok(v, { tag, node: membrane, mode: 'keep', band: 60, fuzziness: 0 });
    expect(variant(v)).toBe('instance');
    await v.api.run('history.undo', {});
    expect(variant(v)).toBe('pixel');
    expect(records(v, hiv)[0].mode).toBe('cut');
    await v.api.run('history.redo', {});
    expect(variant(v)).toBe('instance');
    const p = await v.api.run('clipping.settings', { variant: 'pixel' });
    if (!p.ok) throw new Error(p.message);
    await ok(v, { tag, node: membrane, mode: 'keep', band: 60, fuzziness: 0 });
    expect(variant(v)).toBe('instance');
  });
});
