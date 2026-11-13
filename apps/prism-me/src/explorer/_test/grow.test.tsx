/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { DefaultPaintSettings } from '@molstar/mesoscale-extension/paint-mode';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI, growMenuItem } from '../ui.js';

// Grow from an instance (progress/2026-11-11-grow.md): a particle's right-click makes it the source, the list's Grow
// block names it and grows by its mode (one step), and a paint's last copy is the source too. Over a headless viewer in
// jsdom (no canvas), a mesoscale model made in memory.

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
  name: 'prism-me-test-grow-model',
  display: { name: 'Test Grow Model' },
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

describe('Grow from this instance', () => {
  it("is a particle's right-click: it makes the particle the grow's source and opens its Grow", async () => {
    const { v, hiv } = await viewer();
    let opened = 0;
    const item = growMenuItem(v.api, { list: hiv, index: 1 }, () => opened++);
    expect(item?.label).toBe('Grow from this instance…');
    item!.run();
    expect(v.api.mesoscale!.growSource.value).toEqual({ particles: hiv, index: 1 });
    expect(opened).toBe(1);
  });

  it("names its source in the list's Grow block and grows by its mode, one step", async () => {
    const { v, hiv } = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Grow'));
    const section = button(host, 'Grow')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    await until(() => !!host.textContent?.includes('Right-click a particle'));
    v.api.mesoscale!.growSource.set({ particles: hiv, index: 1 });
    await until(() => !!host.textContent?.includes('CA #1'));
    choice(host, 'Mode', 'Tiling')!.click();
    choice(host, 'Pattern', 'Square')!.click();
    expect(v.api.mesoscale!.growSettings.value).toMatchObject({ mode: 'tiling', pattern: 'square' });
    const steps = v.api.history.steps.value.length;
    const grow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Grow',
    );
    // the section's header and the block's button: the last
    grow[grow.length - 1].click();
    // 3 rings of Square: 48 copies
    await until(() => count(v) === 3 + 48);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });

  it("makes a paint's last copy the grow's source", async () => {
    const { v, hiv } = await viewer();
    const mode = v.api.mesoscale!.paintMode as unknown as {
      host: { paint(...a: unknown[]): Promise<unknown> };
    };
    await mode.host.paint(
      { particles: hiv, entity: 1, name: 'NC' },
      DefaultPaintSettings,
      [0, 50, 0, 10, 50, 0],
      [0, 1, 0, 0, 1, 0],
      1,
      false,
    );
    expect(v.api.mesoscale!.growSource.value).toEqual({ particles: hiv, index: 4 });
  });

  it("grows on the mesh a paint's last copy was painted on (grow-mesh); a right-click's source in space", async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const mode = m.paintMode as unknown as { host: { paint(...a: unknown[]): Promise<unknown> } };
    const brush = { particles: hiv, entity: 1, name: 'NC' };
    await mode.host.paint(brush, DefaultPaintSettings, [0, 50, 0], [0, 1, 0], 1, false, 'vesicle-ref');
    expect(m.growSource.value).toEqual({ particles: hiv, index: 3 });
    expect(m.growSettings.value.mesh).toBe('vesicle-ref');
    await mode.host.paint(brush, DefaultPaintSettings, [0, 60, 0], [0, 1, 0], 1, false);
    expect(m.growSettings.value.mesh).toBe(undefined);
    await mode.host.paint(brush, DefaultPaintSettings, [0, 70, 0], [0, 1, 0], 1, false, 'vesicle-ref');
    m.setGrowSource({ particles: hiv, index: 0 });
    expect(m.growSettings.value.mesh).toBe(undefined);
  });
});

describe('Grow settings', () => {
  it("leave a length set for one source to the next source's size (review G1)", async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    m.setGrowSource({ particles: hiv, index: 0 });
    m.growSettings.set({ ...m.growSettings.value, a: 30, spacing: 12, na: 5 });
    m.setGrowSource({ particles: hiv, index: 0 });
    expect(m.growSettings.value.a).toBe(30);
    m.setGrowSource({ particles: hiv, index: 2 });
    expect(m.growSettings.value.a).toBeUndefined();
    expect(m.growSettings.value.spacing).toBeUndefined();
    expect(m.growSettings.value.na).toBe(5);
  });
});
