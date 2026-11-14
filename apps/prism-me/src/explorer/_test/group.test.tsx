/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI, ungroupMenuItem } from '../ui.js';
import { nodeMenuItems } from '../menu.js';

// Groups in the explorer (progress/2026-11-13-paint-group.md): a list's Group section picks instances and makes a group
// (one step), the group a row of the list ("Group 1 · 2 members") with Paint with, and a group copy's particle has
// Ungroup. Over a headless viewer in jsdom (no canvas), a mesoscale model made in memory.

function model(): ParticleList {
  const count = 3;
  return {
    label: 'HIV',
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: Int32Array.from([0, 0, 1]),
    targetInfo: new Map([
      [0, { entity: 0 }],
      [1, { entity: 1 }],
    ]),
    entityInfo: new Map([
      [0, { name: 'CA' }],
      [1, { name: 'NC' }],
    ]),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-group-model',
  display: { name: 'Test Group Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    return new SO.Particle.List(model(), { label: 'HIV' });
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
  await v.plugin.build().toRoot().apply(TestModel).commit();
  const hiv = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
  const r = await v.api.particles.representation({ type: 'spacefill', particles: hiv });
  if (!r.ok) throw new Error(r.message);
  return { v, hiv };
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function mountScene(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const labelOf = (row: HTMLElement) => row.querySelector('[data-tip-overflow]')?.textContent ?? '';
const rowOf = (host: HTMLElement, label: string) =>
  items(host)
    .find((r) => labelOf(r) === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
const choice = (host: HTMLElement, group: string, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)).find(
    (b) => b.textContent === label,
  );
const count = (v: PrismViewer) =>
  (
    v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data as unknown as {
      sourceData: ParticleList;
    }
  ).sourceData.count;

describe('Group', () => {
  it("picks instances in a list's Group section and makes a group of them: a row of the list, one step", async () => {
    const { v, hiv } = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Group'));
    const section = button(host, 'Group')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    await until(() => !!button(host, 'Pick instances'));
    button(host, 'Pick instances')!.click();
    const m = v.api.mesoscale!;
    expect(m.groupPick.state.value?.particles).toBe(hiv);
    // the clicks in 3D (headless: the area's toggle, as the explorer's click does)
    m.groupPick.toggle(hiv, 0);
    m.groupPick.toggle(hiv, 2);
    await until(() => !!host.textContent?.includes('2 picked'));
    const steps = v.api.history.steps.value.length;
    button(host, 'Make group')!.click();
    await until(() => v.api.history.steps.value.length === steps + 1);
    (rowOf(host, 'HIV')!.querySelector('button[data-tree-toggle]') as HTMLButtonElement).click();
    await until(() => !!rowOf(host, 'Group 1 · 2 members'));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    // made: the picking over
    expect(m.groupPick.state.value).toBeUndefined();
    // its row's right-click: Paint with it
    const id = m.infoState(hiv).value!.paintGroups![0].id;
    const menu = nodeMenuItems(v.api, v.api.explorer!, {
      key: `pg:${hiv}:${id}`,
      label: 'Group 1 · 2 members',
      kind: 'paint group',
      node: { ref: hiv, particles: { entities: [] }, paintGroup: id },
    });
    expect(menu.map((i) => i.label)).toEqual(['Paint with Group 1']);
  });

  it("offers Ungroup on a group copy's particle, none on a particle alone", async () => {
    const { v, hiv } = await viewer();
    const g = await v.api.run('mesoscale.group', { particles: hiv, indices: [0, 2] });
    if (!g.ok) throw new Error(g.message);
    const id = (g.value as { group: number }).group;
    const p = await v.api.run('mesoscale.paint', { entity: '', group: id, positions: [0, 100, 0], seed: 1 });
    if (!p.ok) throw new Error(p.message);
    expect(count(v)).toBe(5);
    expect(ungroupMenuItem(v.api, { list: hiv, index: 1 })).toBeUndefined();
    const item = ungroupMenuItem(v.api, { list: hiv, index: 4 });
    expect(item?.label).toBe('Ungroup this Group 1');
    item!.run();
    await until(() => !v.api.mesoscale!.instanceAt(hiv, 4));
  });

  it("shows the group's row its Paint only: no Look, Labels or Grow that would act on the whole list (review M1)", async () => {
    const { v, hiv } = await viewer();
    const g = await v.api.run('mesoscale.group', { particles: hiv, indices: [0, 2] });
    if (!g.ok) throw new Error(g.message);
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    (rowOf(host, 'HIV')!.querySelector('button[data-tree-toggle]') as HTMLButtonElement).click();
    await until(() => !!rowOf(host, 'Group 1 · 2 members'));
    rowOf(host, 'Group 1 · 2 members')!.click();
    await until(() => !!button(host, 'Paint'));
    await new Promise((r) => setTimeout(r, 100));
    const titles = Array.from(host.querySelectorAll('button[aria-expanded]')).map((b) => b.textContent?.trim());
    expect(titles.filter((t) => ['Look', 'Labels', 'Grow', 'Clips', 'Decoration'].includes(t ?? ''))).toEqual([]);
  });
});
