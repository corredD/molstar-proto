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
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { flush } from '@molstar/prism-ui/dom/scope';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { lostReleases, pointer, stubPointerCapture } from '@molstar/prism-ui/testing/gestures';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { nodeMenuItems } from '../menu.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// The tree's eyes and ⋯ (_spec/ui.md §3, §5; lane tree-eyes, Ludo 2026-10-28) over a headless viewer in jsdom: a
// cellPACK-like model made in memory, six entities, one particle each, in cellPACK's paths (root.<compartment>.
// (surface|interior).<group>): 0, 1 in root.cell.surface.proteins; 2, 3 in root.cell.interior.proteins; 4, 5 in
// root.other.

const Compartments = ['root.cell.surface.proteins', 'root.cell.interior.proteins', 'root.other'];

function modelOf(label: string, n: number, grouped: boolean): ParticleList {
  const compartment = (i: number) => (grouped ? Math.min(2, Math.floor(i / 2)) : 0);
  return {
    label,
    count: n,
    keys: Int32Array.from({ length: n }, (_, i) => i),
    targets: Int32Array.from({ length: n }, (_, i) => i),
    targetInfo: new Map(Array.from({ length: n }, (_, i) => [i, { entity: i }])),
    entityInfo: new Map(Array.from({ length: n }, (_, i) => [i, { name: `protein ${i}` }])),
    compartments: Int32Array.from({ length: n }, (_, i) => compartment(i)),
    compartmentInfo: new Map(
      grouped ? Compartments.map((name, i) => [i, { name }]) : [[0, { name: 'root.cytoplasm' }]],
    ),
    coordinates: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? i : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-eyes-model',
  display: { name: 'Test Eyes Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: { label: PD.Text('HIV'), n: PD.Numeric(6), grouped: PD.Boolean(true) },
})({
  apply({ params }) {
    return new SO.Particle.List(modelOf(params.label, params.n, params.grouped), { label: params.label });
  },
});

beforeAll(stubPointerCapture);
const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function viewer(grouped = true, n = 6) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestModel, { label: 'HIV', n, grouped }).commit();
  for (const l of v.plugin.managers.particles.hierarchy.current.lists) {
    const r = await v.api.particles.representation({ type: 'spacefill', particles: l.cell.transform.ref });
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

const settle = async () => {
  flush();
  await new Promise((r) => setTimeout(r, 0));
  flush();
};

async function mounted(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  const model = sceneModelOf(api.explorer!)!;
  const ref = api.explorer!.objectsState().value[0].ref;
  await until(() => !!model.parts.value.get(ref));
  // every row unfolded
  const groups = [...Compartments, 'root.cytoplasm'].flatMap((c) =>
    c.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.')),
  );
  model.open.set(new Set([...model.open.value, `o:${ref}`, ...groups.map((g) => `g:${ref}:${g}`)]));
  await settle();
  const item = (key: string) => host.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`) ?? undefined;
  const eye = (key: string) => item(key)?.querySelector<HTMLButtonElement>('button[data-tree-eye]') ?? undefined;
  const says = (key: string) => eye(key)?.getAttribute('aria-label');
  const entities = () => api.mesoscale!.infoState(ref).value?.entities ?? [];
  const shownIds = () => entities().flatMap((e) => (e.visible ? [e.id] : []));
  const drawn = () => api.explorer!.objectsState().value[0].visible;
  const steps = () => v.api.history.steps.value.length;
  /** The ⋯ of a row opened: its items' labels */
  const more = async (key: string) => {
    for (const m of document.querySelectorAll('[role=menu]')) m.remove();
    item(key)!.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click();
    await settle();
    return menuItems();
  };
  return { api, host, model, ref, item, eye, says, entities, shownIds, drawn, steps, more };
}

const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
const labelsOf = (items: HTMLElement[]) => items.map((m) => m.textContent?.trim() ?? '');
const clickItem = async (label: string) => {
  const m = menuItems().find((x) => x.textContent?.trim() === label);
  if (!m) throw new Error(`no item ${label}: ${labelsOf(menuItems()).join(', ')}`);
  m.click();
  await settle();
};
const undo = async (v: PrismViewer) => {
  const r = await v.api.run('history.undo', {});
  if (!r.ok) throw new Error(r.message);
};

describe("every row's eye and ⋯ (Ludo, 2026-10-28)", () => {
  it('each row has its eye and its ⋯, a category too; no brush, scissors or trash in a row', async () => {
    const v = await viewer();
    const { host, ref, item } = await mounted(v);
    for (const key of ['c:particles', `o:${ref}`, `g:${ref}:root.cell`, `me:${ref}:0`]) {
      expect(item(key)!.querySelector('button[data-tree-eye]'), key).toBeTruthy();
      expect(item(key)!.querySelector('button[aria-label="More"]'), key).toBeTruthy();
    }
    for (const tool of ['Color all of it', 'Add a clip', 'Remove']) {
      expect(host.querySelector(`[data-tree-row] button[aria-label="${tool}"]`), tool).toBeNull();
    }
  });

  it("the ⋯ holds Color…, Add clip… and Remove (an object's), a category's Color… and Add clip…", async () => {
    const v = await viewer();
    const { ref, more } = await mounted(v);
    const object = labelsOf(await more(`o:${ref}`));
    expect(object).toContain('Color…');
    expect(object).toContain('Add clip…');
    expect(object).toContain('Remove');
    const part = labelsOf(await more(`me:${ref}:0`));
    expect(part).toContain('Color…');
    expect(part).toContain('Add clip…');
    expect(part).not.toContain('Remove');
    const category = labelsOf(await more('c:particles'));
    expect(category).toContain('Color…');
    expect(category.some((l) => l.startsWith('Add clip…'))).toBe(true);
    // a category's Color…: its themes, one step for every object under it
    const steps = v.api.history.steps.value.length;
    await clickItem('Color…');
    expect(labelsOf(menuItems())).toEqual(['By object', 'By entity', 'Generate colors', 'Uniform…']);
    await clickItem('By object');
    await until(() => v.api.history.steps.value.length === steps + 1);
  });

  it('no menu has Hide: not the ⋯ of any row, not the right-click', async () => {
    const v = await viewer();
    const { api, ref, more } = await mounted(v);
    const label = await v.api.run('stage.label', { text: 'Here', target: ref, node: `o:${ref}` });
    if (!label.ok) throw new Error(label.message);
    const distance = await v.api.run('stage.distance', { a: `${ref}#0`, b: `${ref}#2` });
    if (!distance.ok) throw new Error(distance.message);
    await settle();
    const l = api.stage!.labelsState().value[0].ref;
    const d = api.stage!.distancesState().value[0].ref;
    await until(() => !!document.querySelector(`[data-tree-key="l:${l}"]`));
    const hides = (labels: string[]) => labels.filter((x) => /^Hide\b/.test(x) && x !== 'Hide the handles');
    for (const key of ['c:particles', `o:${ref}`, `g:${ref}:root.cell`, `me:${ref}:0`, `l:${l}`, `d:${d}`]) {
      expect(hides(labelsOf(await more(key))), key).toEqual([]);
    }
    const nodes = [
      { key: `o:${ref}`, label: 'HIV', kind: 'mesoscale model', node: { ref } },
      { key: `me:${ref}:0`, label: 'protein 0', kind: 'entity', node: { ref, particles: { entities: [0] } } },
      { key: `l:${l}`, label: 'Here', kind: 'label', node: { ref: l } },
      { key: `d:${d}`, label: 'Distance', kind: 'distance', node: { ref: d } },
    ];
    for (const n of nodes) {
      const items = nodeMenuItems(api, api.explorer!, n);
      expect(
        items.filter((i) => i.id === 'hide').map((i) => i.label),
        n.kind,
      ).toEqual([]);
    }
  });
});

describe("a parent's eye (Ludo, 2026-10-28)", () => {
  it('sets every row under it, all the way down; each its own after: hide the model, show one group alone', async () => {
    const v = await viewer();
    const { ref, eye, says, shownIds, drawn, steps } = await mounted(v);
    const before = steps();
    eye(`o:${ref}`)!.click();
    await until(() => shownIds().length === 0 && !drawn());
    expect(steps()).toBe(before + 1);
    await settle();
    for (const key of [`o:${ref}`, `g:${ref}:root`, `g:${ref}:root.cell`, `me:${ref}:0`, `me:${ref}:5`]) {
      expect(says(key), key).toBe('Show');
    }
    // one group shown alone: drawn, the model's eye its own (closed), its sibling's too
    eye(`g:${ref}:root.cell.surface.proteins`)!.click();
    await until(() => shownIds().join() === '0,1' && drawn());
    expect(steps()).toBe(before + 2);
    await settle();
    expect(says(`g:${ref}:root.cell.surface.proteins`)).toBe('Hide');
    expect(says(`me:${ref}:0`)).toBe('Hide');
    expect(says(`o:${ref}`)).toBe('Show');
    expect(says(`g:${ref}:root.cell.interior.proteins`)).toBe('Show');
    // a parent is never "some shown": the model's eye shows all of it again
    eye(`o:${ref}`)!.click();
    await until(() => shownIds().length === 6);
    expect(steps()).toBe(before + 3);
  });

  it("a category's eye sets each object and all its parts", async () => {
    const v = await viewer();
    const { ref, eye, says, shownIds, drawn } = await mounted(v);
    eye('c:particles')!.click();
    await until(() => shownIds().length === 0 && !drawn());
    await settle();
    expect(says(`me:${ref}:3`)).toBe('Show');
    eye('c:particles')!.click();
    await until(() => shownIds().length === 6 && drawn());
  });
});

describe('the eyes dragged along the column (C4D, Ludo 2026-10-28)', () => {
  it('a press and a release on one eye toggles it once (its click after is not a second)', async () => {
    const v = await viewer(false);
    const { ref, eye, shownIds, steps } = await mounted(v);
    const before = steps();
    const e0 = eye(`me:${ref}:0`)!;
    e0.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    e0.dispatchEvent(pointer('pointerup', { x: 0, y: 0 }));
    e0.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    await until(() => !shownIds().includes(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(shownIds()).toEqual([1, 2, 3, 4, 5]);
    expect(steps()).toBe(before + 1);
  });

  it('drags down six eyes: each takes the first one’s new state, one step; one undo shows them again', async () => {
    const v = await viewer(false, 8);
    const { ref, eye, says, shownIds, steps } = await mounted(v);
    const before = steps();
    const keys = [0, 1, 2, 3, 4, 5].map((i) => `me:${ref}:${i}`);
    eye(keys[0])!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    // the rows passed hidden at once (a preview), nothing run yet
    for (let i = 1; i < keys.length; i++) eye(keys[i])!.dispatchEvent(pointer('pointermove', { x: 0, y: 26 * i }));
    await settle();
    expect(says(keys[5])).toBe('Show');
    expect(steps()).toBe(before);
    eye(keys[5])!.dispatchEvent(pointer('pointerup', { x: 0, y: 26 * 5 }));
    await until(() => shownIds().join() === '6,7');
    expect(steps()).toBe(before + 1);
    await undo(v);
    await until(() => shownIds().length === 8);
    // the eyes follow the scene again once the drag's step is settled
    await until(() => keys.every((k) => says(k) === 'Hide'));
  });

  it('a row skipped by a fast move is set too (the rows between)', async () => {
    const v = await viewer(false, 8);
    const { ref, eye, shownIds } = await mounted(v);
    eye(`me:${ref}:0`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    eye(`me:${ref}:4`)!.dispatchEvent(pointer('pointermove', { x: 0, y: 104 }));
    eye(`me:${ref}:4`)!.dispatchEvent(pointer('pointerup', { x: 0, y: 104 }));
    await until(() => shownIds().join() === '5,6,7');
  });
});

describe('the eyes dragged: what a drag sets, and how it ends (review)', () => {
  it('a label passed by a drag is set; a click on its parent leaves its eye as it is', async () => {
    const v = await viewer(false);
    const { api, ref, eye, says, item, drawn } = await mounted(v);
    const r = await v.api.run('stage.label', { text: 'Here', target: ref, node: `o:${ref}` });
    if (!r.ok) throw new Error(r.message);
    const l = `l:${api.stage!.labelsState().value[0].ref}`;
    await until(() => !!item(l));
    // the model's eye clicked: its label keeps its own eye, at once too
    eye(`o:${ref}`)!.click();
    await settle();
    expect(says(l)).toBe('Hide');
    await until(() => !drawn());
    eye(`o:${ref}`)!.click();
    await until(() => drawn());
    // a drag from the model's eye onto its label: both hidden
    eye(`o:${ref}`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    eye(l)!.dispatchEvent(pointer('pointermove', { x: 0, y: 200 }));
    eye(l)!.dispatchEvent(pointer('pointerup', { x: 0, y: 200 }));
    await until(() => !drawn() && api.stage!.labelsState().value[0].visible === false);
  });

  it('Esc cancels a drag: the eyes put back, no step', async () => {
    const v = await viewer(false);
    const { ref, eye, says, shownIds, steps } = await mounted(v);
    const before = steps();
    eye(`me:${ref}:0`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    eye(`me:${ref}:1`)!.dispatchEvent(pointer('pointermove', { x: 0, y: 26 }));
    await settle();
    expect(says(`me:${ref}:1`)).toBe('Show');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    eye(`me:${ref}:1`)!.dispatchEvent(pointer('pointerup', { x: 0, y: 26 }));
    await settle();
    await new Promise((r) => setTimeout(r, 50));
    expect(says(`me:${ref}:0`)).toBe('Hide');
    expect(says(`me:${ref}:1`)).toBe('Hide');
    expect(shownIds().length).toBe(6);
    expect(steps()).toBe(before);
  });

  it('a pointercancel puts the eyes back, no step', async () => {
    const v = await viewer(false);
    const { ref, eye, says, steps } = await mounted(v);
    const before = steps();
    eye(`me:${ref}:0`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    eye(`me:${ref}:1`)!.dispatchEvent(pointer('pointermove', { x: 0, y: 26 }));
    eye(`me:${ref}:1`)!.dispatchEvent(pointer('pointercancel', { x: 0, y: 26 }, 0));
    await settle();
    await new Promise((r) => setTimeout(r, 50));
    expect([says(`me:${ref}:0`), says(`me:${ref}:1`)]).toEqual(['Hide', 'Hide']);
    expect(steps()).toBe(before);
  });

  it('leaves no listener after lost releases, and the next drag sets the eyes', async () => {
    const v = await viewer(false);
    const { ref, eye, says } = await mounted(v);
    const r = lostReleases({
      target: () => eye(`me:${ref}:0`)!,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      worked: () => {
        flush();
        return says(`me:${ref}:0`) === 'Show';
      },
    });
    expect(r.grown).toBe(0);
    expect(r.worked).toBe(true);
  });

  it("reads the row under the pointer in the eyes' column (moves on the tree, as with the capture)", async () => {
    const v = await viewer(false);
    const { host, ref, eye, shownIds } = await mounted(v);
    const tree = host.querySelector<HTMLElement>('[role=tree]')!;
    // jsdom lays nothing out: the row at a y is the one of that index (26 px a row)
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-tree-key]'));
    const at = (y: number) => rows()[Math.floor(y / 26)] ?? null;
    (document as { elementFromPoint?: unknown }).elementFromPoint = (_x: number, y: number) => at(y);
    try {
      const i0 = rows().findIndex((r) => r.dataset.treeKey === `me:${ref}:0`);
      eye(`me:${ref}:0`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: i0 * 26 + 5 }));
      tree.dispatchEvent(pointer('pointermove', { x: 0, y: (i0 + 2) * 26 + 5 }));
      tree.dispatchEvent(pointer('pointerup', { x: 0, y: (i0 + 2) * 26 + 5 }));
      await until(() => shownIds().join() === '3,4,5');
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }
  });
  it("a drag over a model's entities is one change: a few updates, not one a row", async () => {
    const v = await viewer(false, 40);
    const { ref, eye, shownIds } = await mounted(v);
    await until(() => !!eye(`me:${ref}:39`));
    const state = v.plugin.state.data;
    const updateTree = state.updateTree.bind(state);
    let updates = 0;
    (state as { updateTree: typeof updateTree }).updateTree = ((...args: Parameters<typeof updateTree>) => {
      updates++;
      return updateTree(...args);
    }) as typeof updateTree;
    try {
      eye(`me:${ref}:0`)!.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
      eye(`me:${ref}:39`)!.dispatchEvent(pointer('pointermove', { x: 0, y: 1000 }));
      eye(`me:${ref}:39`)!.dispatchEvent(pointer('pointerup', { x: 0, y: 1000 }));
      await until(() => shownIds().length === 0);
    } finally {
      (state as { updateTree: typeof updateTree }).updateTree = updateTree;
    }
    expect(updates).toBeLessThanOrEqual(2);
  });
});

describe('Show only (cellVIEW, Ludo 2026-10-28)', () => {
  it("on a part's ⋯: only this, its group, its compartment, all again; one step each, one undo", async () => {
    const v = await viewer();
    const { ref, more, shownIds, drawn, steps } = await mounted(v);
    const labels = labelsOf(await more(`me:${ref}:0`));
    for (const l of ['Show only this', 'Show only its group', 'Show only its compartment', 'Show all again']) {
      expect(labels).toContain(l);
    }
    let before = steps();
    await clickItem('Show only this');
    await until(() => shownIds().join() === '0');
    expect(steps()).toBe(before + 1);
    await undo(v);
    await until(() => shownIds().length === 6);
    // its group: the group it is under; its compartment: root.cell, its surface and interior
    await more(`me:${ref}:0`);
    await clickItem('Show only its group');
    await until(() => shownIds().join() === '0,1');
    await more(`me:${ref}:0`);
    await clickItem('Show only its compartment');
    await until(() => shownIds().join() === '0,1,2,3');
    // the model hidden: Show only draws it again (one step)
    before = steps();
    await v.api.run('particles.visibility', { particles: ref, visible: false });
    await until(() => !drawn());
    await more(`me:${ref}:4`);
    await clickItem('Show only its group');
    await until(() => shownIds().join() === '4,5' && drawn());
    expect(steps()).toBe(before + 2);
    await more(`me:${ref}:4`);
    await clickItem('Show all again');
    await until(() => shownIds().length === 6);
  });

  it("a group's ⋯: Show only this", async () => {
    const v = await viewer();
    const { ref, more, shownIds } = await mounted(v);
    const labels = labelsOf(await more(`g:${ref}:root.other`));
    expect(labels).toContain('Show only this');
    expect(labels).not.toContain('Show only its compartment');
    await clickItem('Show only this');
    await until(() => shownIds().join() === '4,5');
  });
});

describe("a row's color dot", () => {
  it('opens its colors, as Color…', async () => {
    const v = await viewer();
    const { ref, item } = await mounted(v);
    const r = await v.api.run('mesoscale.style', { particles: ref, entities: '0', color: 'tomato' });
    if (!r.ok) throw new Error(r.message);
    await until(() => !!item(`me:${ref}:0`)?.querySelector('button[aria-label="Colors"]'));
    item(`me:${ref}:0`)!.querySelector<HTMLButtonElement>('button[aria-label="Colors"]')!.click();
    await settle();
    expect(labelsOf(menuItems())).toContain('Red');
    await clickItem('Blue');
    await until(() => v.api.mesoscale!.infoState(ref).value?.entities[0].color === 0x1e90ff);
  });
});
