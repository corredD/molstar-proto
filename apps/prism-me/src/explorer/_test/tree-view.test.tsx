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
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// The explorer's tree in the app (_spec/ui.md §3) over a headless viewer in jsdom: cellPACK-like models made in memory,
// `n` entities each in one compartment (root.cytoplasm), one particle an entity.

function modelOf(label: string, n: number): ParticleList {
  return {
    label,
    count: n,
    keys: Int32Array.from({ length: n }, (_, i) => i),
    targets: Int32Array.from({ length: n }, (_, i) => i),
    targetInfo: new Map(Array.from({ length: n }, (_, i) => [i, { entity: i }])),
    entityInfo: new Map(Array.from({ length: n }, (_, i) => [i, { name: `protein ${i}` }])),
    compartments: new Int32Array(n),
    compartmentInfo: new Map([[0, { name: 'root.cytoplasm' }]]),
    coordinates: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? i : 0)),
    getParticleLabel: (i) => `${i}`,
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-tree-model',
  display: { name: 'Test Tree Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: { label: PD.Text('HIV'), n: PD.Numeric(3) },
})({
  apply({ params }) {
    return new SO.Particle.List(modelOf(params.label, params.n), { label: params.label });
  },
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function viewer(models: readonly [string, number][], drawn = false) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  for (const [label, n] of models) await v.plugin.build().toRoot().apply(TestModel, { label, n }).commit();
  if (drawn) {
    for (const l of v.plugin.managers.particles.hierarchy.current.lists) {
      const r = await v.api.particles.representation({ type: 'spacefill', particles: l.cell.transform.ref });
      if (!r.ok) throw new Error(r.message);
    }
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
  const model = sceneModelOf(api.explorer!)!;
  const refOf = (label: string) => api.explorer!.objectsState().value.find((o) => o.label === label)!.ref;
  return { api, host, model, refOf };
}

const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const item = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`) ?? undefined;
const settle = async () => {
  flush();
  await new Promise((r) => setTimeout(r, 0));
  flush();
};
const press = async (el: HTMLElement, key: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await settle();
};
const focused = (host: HTMLElement) =>
  (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-tree-key]');

describe('the tree on a model of thousands of entities', () => {
  it('makes about a screenful of rows, not one a row', async () => {
    const v = await viewer([['HIV', 2400]]);
    const { host, model, refOf } = mount(v);
    const ref = refOf('HIV');
    await until(() => !!model.parts.value.get(ref));
    // the way to its last entity unfolded: the category, the model, root, cytoplasm and its 2,400 entities
    model.reveal({ key: `me:${ref}:2399`, label: 'protein 2399', kind: 'entity', node: { ref } });
    await settle();
    expect(model.open.value.has(`g:${ref}:root.cytoplasm`)).toBe(true);
    const shown = items(host).length;
    expect(shown).toBeGreaterThan(10);
    expect(shown).toBeLessThan(120);
  });
});

describe("the tree's keys and picks (ui.md §3)", () => {
  it('picks a category by a click, as any row', async () => {
    const v = await viewer([['HIV', 3]]);
    const { host, model } = mount(v);
    await until(() => !!item(host, 'c:particles'));
    item(host, 'c:particles')!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await settle();
    expect(model.picked.value?.key).toBe('c:particles');
  });

  it('move the pick: ↓ and ↑, End and Home, → opens then goes in, ← goes to the parent then closes', async () => {
    const v = await viewer([
      ['HIV', 3],
      ['Other', 2],
    ]);
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    const other = refOf('Other');
    await until(() => !!item(host, `o:${other}`));
    const start = item(host, 'c:particles')!;
    start.querySelector<HTMLElement>('[data-tree-row]')!.click();
    start.focus();
    await settle();
    expect(model.picked.value?.key).toBe('c:particles');
    await press(focused(host)!, 'ArrowDown');
    expect(model.picked.value?.key).toBe(`o:${hiv}`);
    await press(focused(host)!, 'End');
    expect(model.picked.value?.key).toBe(`o:${other}`);
    await press(focused(host)!, 'Home');
    expect(model.picked.value?.key).toBe('c:particles');
    await press(focused(host)!, 'ArrowDown');
    // → on a closed row opens it; again, goes to its first child
    await until(() => !!model.parts.value.get(hiv));
    await press(focused(host)!, 'ArrowRight');
    expect(model.open.value.has(`o:${hiv}`)).toBe(true);
    expect(model.picked.value?.key).toBe(`o:${hiv}`);
    await press(focused(host)!, 'ArrowRight');
    expect(model.picked.value?.key).toBe(`g:${hiv}:root`);
    // ← on a closed row goes to its parent; again, closes it
    await press(focused(host)!, 'ArrowLeft');
    expect(model.picked.value?.key).toBe(`o:${hiv}`);
    await press(focused(host)!, 'ArrowLeft');
    expect(model.open.value.has(`o:${hiv}`)).toBe(false);
    // ↑ from the first object: its category (picked too)
    await press(focused(host)!, 'ArrowUp');
    expect(model.picked.value?.key).toBe('c:particles');
  });

  it('picks on a click or a key, not on a focus alone (a row made again takes the focus back)', async () => {
    const v = await viewer([
      ['HIV', 3],
      ['Other', 2],
    ]);
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    const other = refOf('Other');
    await until(() => !!item(host, `o:${other}`) && !!model.parts.value.get(hiv));
    item(host, `o:${hiv}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await settle();
    // the focus put back on a row (its eye or chevron clicked, the row made again): no pick
    item(host, `o:${other}`)!.focus();
    await settle();
    expect(model.picked.value?.key).toBe(`o:${hiv}`);
    // a reveal (a 3D pick, a menu's new row) while a row holds the focus keeps its pick
    model.reveal({ key: `me:${hiv}:1`, label: 'protein 1', kind: 'entity', node: { ref: hiv } });
    await settle();
    await settle();
    expect(model.picked.value?.key).toBe(`me:${hiv}:1`);
  });

  it('names a row by its name alone (not its tools)', async () => {
    const v = await viewer([['HIV', 3]]);
    const { host, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!item(host, `o:${hiv}`));
    const name = (key: string) => {
      const ids = item(host, key)!.getAttribute('aria-labelledby') ?? '';
      return ids
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ');
    };
    expect(name(`o:${hiv}`)).toBe('HIV');
    expect(name('c:particles')).toBe('Particles');
  });

  it("opens the row's right-click menu from its ⋯, under it", async () => {
    const v = await viewer([['HIV', 3]]);
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!item(host, `o:${hiv}`));
    const more = item(host, `o:${hiv}`)!.querySelector<HTMLButtonElement>('button[aria-label="More"]');
    expect(more).toBeTruthy();
    more!.click();
    await settle();
    expect(model.picked.value?.key).toBe(`o:${hiv}`);
    const menu = document.querySelector('[role=menu]');
    expect(menu).toBeTruthy();
    const labels = Array.from(menu!.querySelectorAll('[role=menuitem]')).map((m) => m.textContent?.trim());
    expect(labels).toContain('Focus on HIV');
    // a category has no ⋯ (nothing of its own to act on)
    expect(item(host, 'c:particles')!.querySelector('button[aria-label="More"]')).toBeNull();
  });
});

describe("a row's eye", () => {
  it('clicked twice before the scene answers, ends as the second click asked', async () => {
    const v = await viewer([['HIV', 3]]);
    const { api, host, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!item(host, `o:${hiv}`));
    const visible = () => api.explorer!.objectsState().value[0].visible;
    const eye = (label: string) =>
      item(host, `o:${hiv}`)!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    eye('Hide').click();
    await until(() => !visible());
    // shown again at once, before the first flip is settled
    eye('Show').click();
    await until(() => visible());
    await new Promise((r) => setTimeout(r, 100));
    expect(visible()).toBe(true);
    expect(eye('Hide')).toBeTruthy();
  });
});

describe("a category's tools (ui.md §3)", () => {
  it('its eye hides every object under it, one step, and shows them again', async () => {
    const v = await viewer([
      ['HIV', 3],
      ['Other', 2],
    ]);
    const { api, host } = mount(v);
    await until(() => !!item(host, 'c:particles'));
    const shown = () => api.explorer!.objectsState().value.map((o) => o.visible);
    const steps = v.api.history.steps.value.length;
    item(host, 'c:particles')!.querySelector<HTMLButtonElement>('button[aria-label="Hide"]')!.click();
    await until(() => shown().every((s) => !s));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    // all hidden: its eye stays in view, and shows them
    await until(() => !!item(host, 'c:particles')!.querySelector('button[aria-label="Show"]'));
    item(host, 'c:particles')!.querySelector<HTMLButtonElement>('button[aria-label="Show"]')!.click();
    await until(() => shown().every((s) => s));
  });

  it('its scissors add one cut of every object under it', async () => {
    const v = await viewer(
      [
        ['HIV', 3],
        ['Other', 2],
      ],
      true,
    );
    const { host } = mount(v);
    await until(() => !!item(host, 'c:particles'));
    const steps = v.api.history.steps.value.length;
    item(host, 'c:particles')!.querySelector<HTMLButtonElement>('button[aria-label="Add a clip"]')!.click();
    await settle();
    const plane = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
      (m) => m.textContent?.trim() === 'Plane',
    );
    expect(plane).toBeTruthy();
    plane!.click();
    await until(() => v.api.clipping.cuts.value.length === 1);
    const lists = v.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref);
    const cut = v.api.clipping.cuts.value[0];
    for (const ref of lists) expect(cut.targets.some((t) => v.api.explorer!.isUnder(t.ref, ref))).toBe(true);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });
});

describe('clips as rows (ui.md §3)', () => {
  it('a clip made at a node is a row under it, its eye its drawing in the scene', async () => {
    const v = await viewer([['HIV', 3]], true);
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const add = async (shape: string, params: object = {}) => {
      const r = await v.api.run('clipping.add', { shape, node: `#${hiv}`, ...params });
      if (!r.ok) throw new Error(r.message);
    };
    await add('plane');
    await add('sphere', { particles: { entities: [1] } });
    const [whole, part] = v.api.clipping.cuts.value;
    // the way to the entity unfolded: the model's rows, its clip after its children; the entity's under it
    model.reveal({ key: `me:${hiv}:1`, label: 'protein 1', kind: 'entity', node: { ref: hiv } });
    model.open.set(new Set([...model.open.value, `me:${hiv}:1`]));
    await settle();
    const outline = items(host).map((r) => `${r.getAttribute('aria-level')}:${r.dataset.treeKey}`);
    expect(outline).toEqual([
      '1:c:particles',
      `2:o:${hiv}`,
      `3:g:${hiv}:root`,
      `4:g:${hiv}:root.cytoplasm`,
      `5:me:${hiv}:0`,
      `5:me:${hiv}:1`,
      `6:k:${part.object.tag}`,
      `5:me:${hiv}:2`,
      `3:k:${whole.object.tag}`,
    ]);
    expect(item(host, `k:${whole.object.tag}`)!.textContent).toContain('Plane 1');
    // its eye draws it in the scene
    item(host, `k:${whole.object.tag}`)!.querySelector<HTMLButtonElement>('button[aria-label="Show"]')!.click();
    await until(() => !!v.api.clipping.cuts.value[0].drawing);
    // picked, it shows no properties of its object
    item(host, `k:${whole.object.tag}`)!.querySelector<HTMLElement>('[data-tree-row]')!.click();
    await settle();
    expect(model.picked.value?.key).toBe(`k:${whole.object.tag}`);
    expect(model.picked.value?.node).toBeUndefined();
  });
});

describe('+ Open and the empty tree (ui.md §2)', () => {
  it('says what to drop or open, and + Open lists its four, worded as ui.md, no icons', async () => {
    const v = await viewer([]);
    const { host } = mount(v);
    await settle();
    expect(host.textContent).toContain('Drop files here, or + Open:');
    expect(host.textContent).toContain('Simularium');
    const open = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Open'),
    )!;
    open.click();
    await settle();
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
    expect(items.map((m) => m.textContent?.trim())).toEqual([
      'Files…',
      'PDB / PDB-IHM / EMDB id…',
      'Examples…',
      'Session…',
    ]);
    expect(items.some((m) => m.querySelector('svg'))).toBe(false);
  });
});
