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
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { nodeMenuItems } from '../menu.js';
import { explorerUI } from '../ui.js';

// Paint with … (progress/2026-11-08-paint.md; _spec/ui.md §4 Paint, §5): a model's entity is a brush, from its
// right-click and its properties; the model and its groups are not. Over a headless viewer in jsdom (no canvas: the
// mode itself is paint-mode.test.ts's), a mesoscale model made in memory.

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
  name: 'prism-me-test-paint-model',
  display: { name: 'Test Paint Model' },
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

describe('Paint with …', () => {
  it("is in an entity's right-click (Stop painting while it is the brush), not a model's", async () => {
    const { v, hiv } = await viewer();
    const area = v.api.explorer!;
    const ca = { key: 'e', label: 'CA', kind: 'entity', node: { ref: hiv, particles: { entities: [0] } } };
    const paint = () => nodeMenuItems(v.api, area, ca).find((i) => i.id === 'paint');
    expect(paint()?.label).toBe('Paint with CA');
    const mode = v.api.mesoscale!.paintMode;
    mode.brush.set({ particles: hiv, entity: 0, name: 'CA' });
    expect(paint()?.label).toBe('Stop painting');
    paint()!.run();
    expect(mode.brush.value).toBeUndefined();
    // headless, no canvas to paint on: the mode stays off
    paint()!.run();
    expect(mode.brush.value).toBeUndefined();
    const whole = nodeMenuItems(v.api, area, { key: 'm', label: 'HIV', kind: 'mesoscale model', node: { ref: hiv } });
    expect(whole.some((i) => i.id === 'paint')).toBe(false);
  });

  it("shows an entity's brush in its properties: Paint, how it turns copies, the side, the spin", async () => {
    const { v } = await viewer();
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Graphics & Motion'));
    expect(button(host, 'Paint')).toBeUndefined();
    (rowOf(host, 'HIV')!.querySelector('button[data-tree-toggle]') as HTMLButtonElement).click();
    await until(() => !!rowOf(host, 'CA'));
    rowOf(host, 'CA')!.click();
    await until(() => !!button(host, 'Paint'));
    const section = button(host, 'Paint')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    await until(() => !!choice(host, 'Turn', 'Random'));
    const steps = v.api.history.steps.value.length;
    const mode = v.api.mesoscale!.paintMode;
    choice(host, 'Turn', 'Random')!.click();
    expect(mode.settings.value.orient).toBe('random');
    choice(host, 'Side', 'In')!.click();
    expect(mode.settings.value.side).toBe('in');
    button(host, 'Random spin')!.click();
    expect(mode.settings.value.spin).toBe(0);
    // the brush's settings are the mode's: no history step
    expect(v.api.history.steps.value.length).toBe(steps);
  });
});

describe('Paint on: its section in the properties (paint-refine round 3)', () => {
  it("opens the brush's row and its Paint section, in view, from anywhere the mode starts; off leaves them", async () => {
    const { v, hiv } = await viewer();
    const crn = readFileSync('data/examples/1crn.cif');
    const loaded = await v.api.load.files({ files: [new File([crn], '1crn.cif')] });
    if (!loaded.ok) throw new Error(loaded.message);
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const scrolled: string[] = [];
    // jsdom has no scrolling: what is brought into view, recorded
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element) {
        const id = this.getAttribute('data-section');
        if (id) scrolled.push(id);
      },
    });
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    const section = (id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`);
    const open = (id: string) => section(id)?.querySelector('button')?.getAttribute('aria-expanded') === 'true';
    const picked = () => host.querySelector('[aria-selected="true"] [data-tip-overflow]')?.textContent;
    const mode = v.api.mesoscale!.paintMode;
    // an entity brush (as Paint with, the Paint button, ⌘K, the assistant: the mode's brush set)
    mode.brush.set({ particles: hiv, entity: 0, name: 'CA' });
    await until(() => open('paint'));
    expect(picked()).toBe('CA');
    await until(() => scrolled.includes('paint'));
    // off: the panel as it is
    mode.brush.set(undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(open('paint')).toBe(true);
    // a structure brush: its row, its Paint
    mode.brush.set({ particles: '', entity: -1, name: '1CRN', structure });
    await until(() => open('paint-structure'));
    expect(picked()).toBe('1CRN');
    await until(() => scrolled.includes('paint-structure'));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
