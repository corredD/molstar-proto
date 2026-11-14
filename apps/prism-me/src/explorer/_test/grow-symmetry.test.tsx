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
import { explorerUI } from '../ui.js';

// Grow › Symmetry (progress/2026-11-13-symmetry.md) in the Grow section: its Group, n (Cn, Dn), Radius, Side and Axis,
// every one live on the last grow (one step a drag or a pick), Clear and Undo. Over a headless viewer in jsdom (no
// canvas), a mesoscale model made in memory (grow.test.tsx's).

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

async function openGrow(v: PrismViewer, hiv: string, index: number) {
  const host = mountScene(v);
  await until(() => !!rowOf(host, 'HIV'));
  rowOf(host, 'HIV')!.click();
  await until(() => !!button(host, 'Grow'));
  const section = button(host, 'Grow')!;
  if (section.getAttribute('aria-expanded') !== 'true') section.click();
  v.api.mesoscale!.growSource.set({ particles: hiv, index });
  await until(() => !!host.textContent?.includes(`#${index}`));
  return host;
}

/** The Grow button (the section's header is named Grow too: the last) */
const growButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .filter((b) => b.textContent?.trim() === 'Grow')
    .at(-1)!;

/** A slider of the Grow section dragged through `values` (its knob's) and let go */
function dragGrow(host: HTMLElement, label: string, values: number[]) {
  const range = host.querySelector<HTMLInputElement>(`input[type=range][aria-label="Grow ${label}"]`)!;
  for (const k of values) {
    range.value = String(k);
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }
  range.dispatchEvent(new Event('change', { bubbles: true }));
}

const strokesOf = (v: PrismViewer) =>
  (
    Array.from(v.plugin.state.data.cells.values()).find((c) => Array.isArray(c.transform.params?.strokes))?.transform
      .params as { strokes: { grow?: { mode: string; id: number; params?: Record<string, unknown> } }[] } | undefined
  )?.strokes ?? [];

const coordinates = (v: PrismViewer, from: number, to: number) =>
  Array.from(
    (
      v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data as unknown as {
        sourceData: ParticleList;
      }
    ).sourceData.coordinates.slice(from * 3, to * 3),
  );

describe('Grow › Symmetry', () => {
  it('shows Group, n (Cn, Dn), Radius, Side and Axis; grows a C6 ring, n and Group live, one step each; Clear, Undo', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Symmetry')!.click();
    await until(() => !!host.querySelector('input[aria-label="Grow n"]'));
    expect(host.querySelector('input[aria-label="Grow Radius"]')).not.toBe(null);
    expect(host.querySelector('[aria-label="Grow Symmetry Axis"]')).not.toBe(null);
    for (const g of ['Cn', 'Dn', 'T', 'O', 'I']) expect(choice(host, 'Group', g)).toBeDefined();
    expect(choice(host, 'Side', 'Outside')).toBeDefined();
    // no mesh: no Snap
    expect(host.textContent).not.toContain('Snap');
    m.growSettings.set({ ...m.growSettings.value, group: 'c', n: 6, symmetryRadius: 40 });
    growButton(host).click();
    await until(() => count(v) === 3 + 5);
    expect(strokesOf(v)[0]?.grow?.mode).toBe('symmetry');
    const steps = v.api.history.steps.value.length;
    // n dragged to 8 through 7: the same grow, 7 copies, one step
    dragGrow(host, 'n', [7, 8]);
    await until(() => count(v) === 3 + 7);
    await until(() => v.api.history.steps.value.length === steps + 1);
    expect(strokesOf(v).length).toBe(1);
    // I: 59 copies, n hidden, one more step
    choice(host, 'Group', 'I')!.click();
    await until(() => count(v) === 3 + 59);
    await until(() => v.api.history.steps.value.length === steps + 2);
    expect(host.querySelector('input[aria-label="Grow n"]')).toBe(null);
    // Radius live: the same 59, further out
    const before = coordinates(v, 3, 4);
    dragGrow(host, 'Radius', [Math.log10(80)]);
    await until(() => (strokesOf(v)[0]?.grow?.params as { radius?: number }).radius === 80);
    await until(() => v.api.history.steps.value.length === steps + 3);
    expect(coordinates(v, 3, 4)).not.toEqual(before);
    expect(count(v)).toBe(3 + 59);
    // Side: one step
    choice(host, 'Side', 'Outside')!.click();
    await until(() => (strokesOf(v)[0]?.grow?.params as { side?: string }).side === 'outside');
    // the settings follow the live grow back after an undo
    expect((await v.api.run('history.undo', {})).ok).toBe(true);
    await until(() => m.growSettings.value.side === 'inside');
    // Clear: the copies gone, one step; Undo: back
    await until(() => !button(host, 'Clear')!.disabled);
    button(host, 'Clear')!.click();
    await until(() => count(v) === 3);
    expect((await v.api.run('history.undo', {})).ok).toBe(true);
    await until(() => count(v) === 3 + 59);
  });

  it('Radius unset stays unset on the live grow: Group I after C6 touches again (review S1)', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Symmetry')!.click();
    m.growSettings.set({ ...m.growSettings.value, group: 'c', n: 6, symmetryRadius: undefined });
    growButton(host).click();
    await until(() => count(v) === 3 + 5);
    // C6's contact is 1: its Radius is the copy's diameter
    const diameter = strokesOf(v)[0]!.grow!.params!.radius as number;
    await new Promise((r) => setTimeout(r, 100));
    expect(m.growSettings.value.symmetryRadius).toBe(undefined);
    choice(host, 'Group', 'I')!.click();
    await until(() => count(v) === 3 + 59);
    const xs = coordinates(v, 2, 3 + 59);
    let min = Infinity;
    for (let i = 0; i < xs.length; i += 3) {
      for (let j = i + 3; j < xs.length; j += 3) {
        min = Math.min(min, Math.hypot(xs[i] - xs[j], xs[i + 1] - xs[j + 1], xs[i + 2] - xs[j + 2]));
      }
    }
    expect(min).toBeCloseTo(diameter, 1);
  });
});
