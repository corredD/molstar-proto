/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Sphere } from '@molstar/graphics/geo/primitive/sphere';
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
    // Undo (⌘Z's and History's: history.undo) takes exactly that grow back, Redo puts it back (paint-refine, item 3)
    expect((await v.api.run('history.undo', {})).ok).toBe(true);
    await until(() => count(v) === 3);
    expect((await v.api.run('history.redo', {})).ok).toBe(true);
    await until(() => count(v) === 3 + 48);
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

describe('Grow On after a paint (paint-refine round 3)', () => {
  it('a copy painted again at the same index (after an undo) on a mesh: On follows it', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const mode = m.paintMode as unknown as { host: { paint(...a: unknown[]): Promise<unknown> } };
    const brush = { particles: hiv, entity: 1, name: 'NC' };
    await mode.host.paint(brush, DefaultPaintSettings, [0, 500, 0], [0, 1, 0], 1, false);
    expect(m.growSource.value).toEqual({ particles: hiv, index: 3 });
    expect(m.growSettings.value.mesh).toBe(undefined);
    await v.api.history.undo();
    await mode.host.paint(brush, DefaultPaintSettings, [0, 50, 0], [0, 1, 0], 1, false, 'vesicle-ref');
    expect(m.growSource.value).toEqual({ particles: hiv, index: 3 });
    expect(m.growSettings.value.mesh).toBe('vesicle-ref');
    // the other way: painted in space at that index again, On None (review 2)
    await v.api.history.undo();
    await mode.host.paint(brush, DefaultPaintSettings, [0, 500, 0], [0, 1, 0], 1, false);
    expect(m.growSource.value).toEqual({ particles: hiv, index: 3 });
    expect(m.growSettings.value.mesh).toBe(undefined);
  });
});

describe("A grown fiber's Rise and Twist (paint-refine)", () => {
  /** Drags a slider of the Grow block to `value` (its knob's: a log slider's power of ten), released there */
  const drag = (host: HTMLElement, label: string, values: number[]) => {
    const range = host.querySelector<HTMLInputElement>(`input[type=range][aria-label="Grow ${label}"]`)!;
    for (const k of values) {
      range.value = String(k);
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('a drag of Rise or Twist after a walk redraws that fiber in place, one step a drag; another source ends it', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Grow'));
    const section = button(host, 'Grow')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    m.growSource.set({ particles: hiv, index: 2 });
    await until(() => !!host.textContent?.includes('NC #2'));
    choice(host, 'Mode', 'Random walk')!.click();
    await until(() => !!host.querySelector('input[aria-label="Grow Rise"]'));
    m.growSettings.set({ ...m.growSettings.value, steps: 10, persistence: 0, seed: 3 });
    const grow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Grow',
    );
    grow[grow.length - 1].click();
    // NC without radii: 10 Å a unit, 10 units
    await until(() => count(v) === 3 + 10);
    const steps = v.api.history.steps.value.length;
    // Rise dragged to 5 Å (log knob) through 7: the same 90 Å path, 19 units; one step
    drag(host, 'Rise', [Math.log10(7), Math.log10(5)]);
    await until(() => count(v) === 3 + 19);
    await until(() => v.api.history.steps.value.length === steps + 1);
    expect(m.growSettings.value.rise).toBe(5);
    // Twist: one more step, the units as many
    drag(host, 'Twist', [10, 20]);
    await until(() => v.api.history.steps.value.length === steps + 2);
    expect(count(v)).toBe(3 + 19);
    // undone: 5 Å, then 10 Å again
    await v.api.history.undo();
    await v.api.history.undo();
    await until(() => count(v) === 3 + 10);
    // the slider follows the fiber's own as the state has it (the undo), not the drag's
    const box = () =>
      host
        .querySelector<HTMLInputElement>('input[type=range][aria-label="Grow Rise"]')!
        .parentElement!.querySelector<HTMLInputElement>('input:not([type=range])')!;
    await until(() => box().value === '10');
    // and the next Grow's is the value shown (review 7)
    await until(() => m.growSettings.value.rise === 10);
    expect(m.growSettings.value.twist).toBe(0);
    // another source: the fiber is not live anymore; its Rise, Twist and Jitter unset, the entity's again (review 4)
    m.setGrowSource({ particles: hiv, index: 1 });
    await until(() => !!host.textContent?.includes('CA #1'));
    expect(m.growSettings.value.rise).toBeUndefined();
    expect(m.growSettings.value.twist).toBeUndefined();
    const now = v.api.history.steps.value.length;
    drag(host, 'Rise', [Math.log10(4)]);
    await new Promise((r) => setTimeout(r, 300));
    expect(v.api.history.steps.value.length).toBe(now);
    expect(m.growSettings.value.rise).toBe(4);
    expect(count(v)).toBe(3 + 10);
  });

  it('a drag after the walk was undone changes the next grow only: no grown-fiber run (review 5)', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Grow'));
    const section = button(host, 'Grow')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    m.growSource.set({ particles: hiv, index: 2 });
    await until(() => !!host.textContent?.includes('NC #2'));
    choice(host, 'Mode', 'Random walk')!.click();
    await until(() => !!host.querySelector('input[aria-label="Grow Rise"]'));
    const grow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Grow',
    );
    grow[grow.length - 1].click();
    await until(() => count(v) > 3);
    await v.api.history.undo();
    await until(() => count(v) === 3);
    const runs: string[] = [];
    const sub = v.api.events.finished.subscribe((r) => runs.push(r.operation));
    drag(host, 'Rise', [Math.log10(4)]);
    await new Promise((r) => setTimeout(r, 300));
    sub.unsubscribe();
    expect(runs).not.toContain('mesoscale.grown-fiber');
    expect(m.growSettings.value.rise).toBe(4);
  });
});

/** An OBJ of a sphere of `radius` about `center` (an icosahedron subdivided: its vertices on the sphere) */
function sphereObj(radius: number, center: [number, number, number]) {
  const { vertices, indices } = Sphere(3);
  const lines: string[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`v ${center.map((c, k) => c + radius * vertices[i + k]).join(' ')}`);
  }
  for (let i = 0; i < indices.length; i += 3) {
    lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
  }
  return lines.join('\n');
}

describe('Grow on a mesh (grow-mesh)', () => {
  it('picks the mesh in On, tiles over it by Count, one step; Crystal grows in space, the select gone', async () => {
    const { v, hiv } = await viewer();
    // CA #1 at (10, 0, 0) on a vesicle of 50 Å about (10, -50, 0)
    const loaded = await v.api.load.files({ files: [new File([sphereObj(50, [10, -50, 0])], 'vesicle.obj')] });
    if (!loaded.ok) throw new Error(loaded.message);
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Grow'));
    const section = button(host, 'Grow')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    v.api.mesoscale!.growSource.set({ particles: hiv, index: 1 });
    await until(() => !!host.textContent?.includes('CA #1'));
    choice(host, 'Mode', 'Tiling')!.click();
    const on = () =>
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Grow on a mesh"] button, button[aria-label="Grow on a mesh"]',
      );
    await until(() => !!on());
    expect(on()!.textContent).toBe('None');
    expect(host.querySelector('[aria-label="Grow Rings"]')).not.toBe(null);
    on()!.click();
    await until(() => !!host.querySelector('[role=option]'));
    Array.from(host.querySelectorAll<HTMLElement>('[role=option]'))
      .find((o) => o.textContent === 'vesicle.obj')!
      .click();
    await until(() => !!v.api.mesoscale!.growSettings.value.mesh);
    // on a mesh, Count (the plane's for Rings: 37) in place of Rings
    await until(() => !!host.querySelector('[aria-label="Grow Count"]'));
    expect(host.querySelector('[aria-label="Grow Rings"]')).toBe(null);
    const steps = v.api.history.steps.value.length;
    const grow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Grow',
    );
    grow[grow.length - 1].click();
    await until(() => count(v) === 3 + 36);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    const list = (
      v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data as unknown as {
        sourceData: ParticleList;
      }
    ).sourceData;
    for (let i = 3; i < 39; ++i) {
      const [x, y, z] = [list.coordinates[i * 3] - 10, list.coordinates[i * 3 + 1] + 50, list.coordinates[i * 3 + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(50, 0);
    }

    // the mesh deleted: On None, Rings back in place of Count (review S3)
    const shape = Array.from(v.plugin.state.data.cells.values()).find((c) => SO.Shape.Provider.is(c.obj))!;
    let root = shape.transform.ref;
    while (v.plugin.state.data.tree.transforms.get(root)!.parent !== v.plugin.state.data.tree.root.ref) {
      root = v.plugin.state.data.tree.transforms.get(root)!.parent;
    }
    await v.plugin.build().delete(root).commit();
    await until(() => on()?.textContent === 'None');
    await until(() => !!host.querySelector('[aria-label="Grow Rings"]'));
    expect(host.querySelector('[aria-label="Grow Count"]')).toBe(null);

    choice(host, 'Mode', 'Crystal')!.click();
    await until(() => !on());
    expect(host.textContent).toContain('A crystal grows in space');
  });
});

describe('Grow › Helix (grow-helix)', () => {
  it('shows Pitch, Turns, Hand, Direction and Radius in space (Axis on a mesh), grows a helix, its Rise live', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = mountScene(v);
    await until(() => !!rowOf(host, 'HIV'));
    rowOf(host, 'HIV')!.click();
    await until(() => !!button(host, 'Grow'));
    const section = button(host, 'Grow')!;
    if (section.getAttribute('aria-expanded') !== 'true') section.click();
    m.growSource.set({ particles: hiv, index: 2 });
    await until(() => !!host.textContent?.includes('NC #2'));
    choice(host, 'Mode', 'Helix')!.click();
    await until(() => !!host.querySelector('input[aria-label="Grow Pitch"]'));
    for (const label of ['Turns', 'Radius', 'Rise', 'Twist', 'Jitter']) {
      expect(host.querySelector(`input[aria-label="Grow ${label}"]`)).not.toBe(null);
    }
    expect(host.querySelector('[aria-label="Grow Steps"]')).toBe(null);
    expect(host.querySelector('[aria-label="Grow Axis"]')).toBe(null);
    choice(host, 'Hand', 'Left')!.click();
    choice(host, 'Direction', 'Down')!.click();
    expect(m.growSettings.value).toMatchObject({ mode: 'helix', hand: 'left', direction: 'down' });
    m.growSettings.set({ ...m.growSettings.value, pitch: 40, turns: 2, helixRadius: 15 });
    const grow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Grow',
    );
    grow[grow.length - 1].click();
    // NC without radii: 10 Å a unit along 2 turns of √((2π·15)² + 40²) ≈ 102 Å: 20 units
    await until(() => count(v) > 3);
    const units = count(v) - 3;
    expect(units).toBe(20);
    const steps = v.api.history.steps.value.length;
    // Rise live on the helix as on a walk: 5 Å along its 195 Å (two turns less the first rise), 39 units; one step
    const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Grow Rise"]')!;
    range.value = String(Math.log10(5));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => count(v) - 3 === 39);
    await until(() => v.api.history.steps.value.length === steps + 1);
    // on a mesh: Axis in place of Radius
    const loaded = await v.api.load.files({ files: [new File([sphereObj(50, [10, -50, 0])], 'vesicle.obj')] });
    if (!loaded.ok) throw new Error(loaded.message);
    const shape = Array.from(v.plugin.state.data.cells.values()).find((c) => SO.Shape.Provider.is(c.obj))!;
    const repr = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => c.transform.parent === shape.transform.ref,
    )!;
    m.growSettings.set({ ...m.growSettings.value, mesh: repr.transform.ref });
    await until(() => !!host.querySelector('[aria-label="Grow Axis"]'));
    expect(host.querySelector('input[aria-label="Grow Radius"]')).toBe(null);
  });
});

/** The Grow section of the list's row open, `index` its source */
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

describe('The last grow live (grow-helix round 2)', () => {
  it('re-grows on any of its settings, one step a drag: Count up continues it, down cuts it; Mode replaces it', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Sphere')!.click();
    m.growSettings.set({ ...m.growSettings.value, count: 10, radius: 30 });
    growButton(host).click();
    await until(() => count(v) === 3 + 10);
    const first = coordinates(v, 3, 13);
    const steps = v.api.history.steps.value.length;
    // Count dragged to 20 through 15: the same grow, 20 copies, the first ten where they were; one step
    dragGrow(host, 'Count', [15, 20]);
    await until(() => count(v) === 3 + 20);
    await until(() => v.api.history.steps.value.length === steps + 1);
    expect(coordinates(v, 3, 13)).toEqual(first);
    expect(strokesOf(v).length).toBe(1);
    // down to 4: the first four
    dragGrow(host, 'Count', [4]);
    await until(() => count(v) === 3 + 4);
    expect(coordinates(v, 3, 7)).toEqual(first.slice(0, 12));
    // its Mode: the same grow, now a tiling
    await until(() => v.api.history.steps.value.length === steps + 2);
    choice(host, 'Mode', 'Tiling')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'tiling');
    expect(strokesOf(v).length).toBe(1);
    // a walk grown, then Helix picked: the walk becomes a helix, its Rise live on it
    choice(host, 'Mode', 'Random walk')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'walk');
    choice(host, 'Mode', 'Helix')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'helix');
    const units = count(v);
    const before = v.api.history.steps.value.length;
    dragGrow(host, 'Rise', [Math.log10(5)]);
    await until(() => count(v) > units);
    await until(() => v.api.history.steps.value.length === before + 1);
    expect(strokesOf(v).length).toBe(1);
    // another source: not live anymore; a drag sets the next grow's only
    m.setGrowSource({ particles: hiv, index: 1 });
    await until(() => !!host.textContent?.includes('CA #1'));
    const now = v.api.history.steps.value.length;
    dragGrow(host, 'Turns', [2]);
    await new Promise((r) => setTimeout(r, 800));
    expect(v.api.history.steps.value.length).toBe(now);
  });

  it('one step a drag: let go, the step ends, as a real drag lands its preview a frame before (review M2)', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Sphere')!.click();
    m.growSettings.set({ ...m.growSettings.value, count: 10, radius: 30 });
    growButton(host).click();
    await until(() => count(v) === 3 + 10);
    const steps = v.api.history.steps.value.length;
    const drag = async (value: number) => {
      const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Grow Count"]')!;
      range.value = String(value);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      // the preview lands (once a frame) before the release
      await new Promise((r) => setTimeout(r, 40));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    };
    await drag(20);
    await new Promise((r) => setTimeout(r, 100));
    await drag(5);
    await until(() => count(v) === 3 + 5);
    await until(() => v.api.history.steps.value.length >= steps + 2, 3000);
    expect(v.api.history.steps.value.length).toBe(steps + 2);
  });

  it('the settings follow the last grow back: an undo, a Mode undone, a drag refused (review S1)', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Sphere')!.click();
    m.growSettings.set({ ...m.growSettings.value, count: 10, radius: 30 });
    growButton(host).click();
    await until(() => count(v) === 3 + 10);
    dragGrow(host, 'Count', [20]);
    await until(() => count(v) === 3 + 20);
    await new Promise((r) => setTimeout(r, 100));
    await v.api.history.undo();
    await until(() => count(v) === 3 + 10);
    await until(() => m.growSettings.value.count === 10);
    // a Radius drag now: 10 copies still (not the undone 20)
    dragGrow(host, 'Radius', [Math.log10(40)]);
    await until(() => strokesOf(v)[0] && v.api.history.steps.value.length > 0 && m.growSettings.value.radius !== 30);
    await new Promise((r) => setTimeout(r, 800));
    expect(count(v)).toBe(3 + 10);
    // a Mode picked, then undone: the settings' mode is the grow's again
    choice(host, 'Mode', 'Tiling')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'tiling');
    await new Promise((r) => setTimeout(r, 100));
    await v.api.history.undo();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'sphere');
    await until(() => m.growSettings.value.mode === 'sphere');
    // a crystal whose β makes no cell: refused, the settings back to the grow's
    choice(host, 'Mode', 'Crystal')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'crystal');
    dragGrow(host, 'α', [10]);
    await until(() => (strokesOf(v)[0]?.grow as { params?: { alpha?: number } })?.params?.alpha === 10);
    dragGrow(host, 'β', [10]);
    await new Promise((r) => setTimeout(r, 1200));
    expect((strokesOf(v)[0]?.grow as { params?: { beta?: number } })?.params?.beta).toBe(90);
    await until(() => m.growSettings.value.beta === 90);
  });

  it('Clear removes every grow from the source, one step; disabled when none; Undo brings them back', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    const clear = () => button(host, 'Clear')!;
    await until(() => !!clear());
    expect(clear().disabled).toBe(true);
    choice(host, 'Mode', 'Sphere')!.click();
    m.growSettings.set({ ...m.growSettings.value, count: 6 });
    growButton(host).click();
    await until(() => count(v) === 3 + 6);
    growButton(host).click();
    await until(() => count(v) === 3 + 12);
    await until(() => !clear().disabled);
    const steps = v.api.history.steps.value.length;
    clear().click();
    await until(() => count(v) === 3);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    await until(() => clear().disabled);
    await v.api.history.undo();
    await until(() => count(v) === 3 + 12);
    await until(() => !clear().disabled);
  });
});

describe('Grow › Spiral (grow-helix round 3)', () => {
  it('shows Count, Arm spacing, Hand, Step and the Turns it reaches; Count and Step live (more continue it)', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Spiral')!.click();
    await until(() => !!host.querySelector('input[aria-label="Grow Arm spacing"]'));
    for (const label of ['Count', 'Step', 'Twist', 'Jitter']) {
      expect(host.querySelector(`input[aria-label="Grow ${label}"]`)).not.toBe(null);
    }
    for (const label of ['Turns', 'Rise', 'Pitch'])
      expect(host.querySelector(`input[aria-label="Grow ${label}"]`)).toBe(null);
    expect(choice(host, 'Hand', 'Left')).toBeDefined();
    m.growSettings.set({ ...m.growSettings.value, spacing: 20, count: 20 });
    growButton(host).click();
    await until(() => count(v) === 3 + 20);
    expect(strokesOf(v)[0]?.grow?.mode).toBe('spiral');
    // the turns it reached, shown
    const turns = (strokesOf(v)[0]?.grow?.params as { turns: number }).turns;
    await until(() => !!host.textContent?.includes(`${turns}, 20 copies`));
    const first = coordinates(v, 3, 23);
    const steps = v.api.history.steps.value.length;
    dragGrow(host, 'Count', [30, 40]);
    await until(() => count(v) === 3 + 40);
    await until(() => v.api.history.steps.value.length === steps + 1);
    expect(coordinates(v, 3, 23)).toEqual(first);
    // Step: the grow made again, its Count kept
    dragGrow(host, 'Step', [Math.log10(6)]);
    await until(() => (strokesOf(v)[0] as { own?: { rise?: number } })?.own?.rise === 6);
    await until(() => v.api.history.steps.value.length === steps + 2);
    expect(count(v)).toBe(3 + 40);
    choice(host, 'Hand', 'Left')!.click();
    await until(() => (strokesOf(v)[0]?.grow?.params as { hand?: string } | undefined)?.hand === 'left');
    expect(v.api.history.steps.value.length).toBe(steps + 3);
  });
});

describe('Grow › Spiral from a Sphere of one copy (second review 4)', () => {
  it('Mode Spiral on a live Sphere of Count 1 makes a spiral of 2 (its least), not a refusal', async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    const host = await openGrow(v, hiv, 2);
    choice(host, 'Mode', 'Sphere')!.click();
    m.growSettings.set({ ...m.growSettings.value, count: 1 });
    growButton(host).click();
    await until(() => count(v) === 3 + 1);
    choice(host, 'Mode', 'Spiral')!.click();
    await until(() => strokesOf(v)[0]?.grow?.mode === 'spiral');
    expect(count(v)).toBe(3 + 2);
    expect(m.growSettings.value.count).toBe(2);
  });
});

describe('Grow settings', () => {
  it("leave a length set for one source to the next source's size (review G1)", async () => {
    const { v, hiv } = await viewer();
    const m = v.api.mesoscale!;
    m.setGrowSource({ particles: hiv, index: 0 });
    m.growSettings.set({ ...m.growSettings.value, a: 30, spacing: 12, na: 5, pitch: 200, helixRadius: 40, turns: 3 });
    m.setGrowSource({ particles: hiv, index: 0 });
    expect(m.growSettings.value.a).toBe(30);
    m.setGrowSource({ particles: hiv, index: 2 });
    expect(m.growSettings.value.a).toBeUndefined();
    expect(m.growSettings.value.spacing).toBeUndefined();
    expect(m.growSettings.value.na).toBe(5);
    // a helix's Pitch and Radius too (grow-helix review S1); its Turns kept
    expect(m.growSettings.value.pitch).toBeUndefined();
    expect(m.growSettings.value.helixRadius).toBeUndefined();
    expect(m.growSettings.value.turns).toBe(3);
  });
});
