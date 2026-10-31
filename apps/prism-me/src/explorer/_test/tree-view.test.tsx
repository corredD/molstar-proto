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
/** The ⋯ of a row clicked, then its items along `path` (Color…, then a theme): the items shown at the end */
const viaMore = async (host: HTMLElement, key: string, ...path: string[]) => {
  item(host, key)!.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click();
  await settle();
  for (const label of path) {
    const m = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
      (x) => x.textContent?.trim() === label,
    );
    if (!m) throw new Error(`no menu item ${label}`);
    m.click();
    await settle();
  }
  return Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
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
    // a category has its ⋯ too (Ludo, 2026-10-28: its color theme, a clip of every object in it)
    expect(item(host, 'c:particles')!.querySelector('button[aria-label="More"]')).toBeTruthy();
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

  it("its ⋯'s Add clip… adds one cut of every object under it", async () => {
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
    const plane = (await viaMore(host, 'c:particles', 'Add clip… (every object in it)')).find(
      (m) => m.textContent?.trim() === 'New plane',
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
  it('a clip is a row of the Clips category, none under the node it was made at, its eye its drawing', async () => {
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
    // the way to the entity unfolded: the model's rows, no clip among them; the clips in their category, last
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
      `5:me:${hiv}:2`,
      '1:c:clips',
      `2:k:${whole.object.tag}`,
      `2:k:${part.object.tag}`,
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

describe('the filter and the chevrons (ui.md §1)', () => {
  it('folds a row while filtering, and a new filter opens it again', async () => {
    const v = await viewer([['HIV', 3]]);
    const { host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    model.filter.set('protein 1');
    await settle();
    expect(item(host, `me:${hiv}:1`)).toBeTruthy();
    item(host, `o:${hiv}`)!.querySelector<HTMLButtonElement>('[data-tree-toggle]')!.click();
    await settle();
    expect(item(host, `me:${hiv}:1`)).toBeUndefined();
    expect(item(host, `o:${hiv}`)!.getAttribute('aria-expanded')).toBe('false');
    model.filter.set('protein');
    await settle();
    expect(item(host, `me:${hiv}:1`)).toBeTruthy();
  });
});

describe("a row's ⋯ › Remove (the trash, Ludo 2026-10-27; in the ⋯, Ludo 2026-10-28)", () => {
  it('removes an object, or a clip, in one step; a part has none', async () => {
    const v = await viewer(
      [
        ['HIV', 3],
        ['Other', 2],
      ],
      true,
    );
    const { api, host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    const other = refOf('Other');
    await until(() => !!model.parts.value.get(hiv) && !!item(host, `o:${other}`));
    const removes = async (key: string) => (await viaMore(host, key)).some((m) => m.textContent?.trim() === 'Remove');
    const trash = (key: string) => ({ click: () => void viaMore(host, key, 'Remove') });
    expect(await removes('c:particles')).toBe(false);
    model.open.set(new Set([...model.open.value, `o:${hiv}`, `g:${hiv}:root`, `g:${hiv}:root.cytoplasm`]));
    await settle();
    expect(await removes(`me:${hiv}:0`)).toBe(false);
    // a clip's
    const r = await v.api.run('clipping.add', { shape: 'plane', node: `#${hiv}` });
    if (!r.ok) throw new Error(r.message);
    const tag = v.api.clipping.cuts.value[0].object.tag!;
    await until(() => !!item(host, `k:${tag}`));
    let steps = v.api.history.steps.value.length;
    trash(`k:${tag}`)!.click();
    await until(() => v.api.clipping.cuts.value.length === 0);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    // an object's
    steps = v.api.history.steps.value.length;
    trash(`o:${other}`)!.click();
    await until(() => !api.explorer!.objectsState().value.some((o) => o.ref === other));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });
});

describe("a category's Color… (its brush, Ludo 2026-10-27; in its ⋯, Ludo 2026-10-28)", () => {
  it('offers the themes its kind takes and colors every object under it, one step', async () => {
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
    const items = await viaMore(host, 'c:particles', 'Color…');
    expect(items.map((m) => m.textContent?.trim())).toEqual([
      'By object',
      'By entity',
      'Generate colors',
      'By zoom',
      'Uniform…',
    ]);
    expect(items.some((m) => m.querySelector('svg'))).toBe(false);
    items[0].click();
    const themes = () =>
      v.plugin.managers.particles.hierarchy.current.lists.map(
        (l) => (l.representations[0].cell.transform.params as { colorTheme: { name: string } }).colorTheme.name,
      );
    await until(() => themes().every((t) => t === 'uniform'));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });
});

describe("a label's and a distance's ⋯ › Remove", () => {
  it('removes each, one step', async () => {
    const v = await viewer([['HIV', 3]], true);
    const { api, host, model, refOf } = mount(v);
    const hiv = refOf('HIV');
    await until(() => !!model.parts.value.get(hiv));
    const label = await v.api.run('stage.label', { text: 'Here', target: hiv, node: `o:${hiv}` });
    if (!label.ok) throw new Error(label.message);
    const distance = await v.api.run('stage.distance', { a: `${hiv}#0`, b: `${hiv}#2` });
    if (!distance.ok) throw new Error(distance.message);
    model.open.set(new Set([...model.open.value, `o:${hiv}`]));
    await settle();
    const labels = () => api.stage!.labelsState().value;
    const distances = () => api.stage!.distancesState().value;
    const trash = (key: string) => ({ click: () => void viaMore(host, key, 'Remove') });
    await until(() => !!item(host, `l:${labels()[0]?.ref}`) && !!item(host, `d:${distances()[0]?.ref}`));
    let steps = v.api.history.steps.value.length;
    trash(`l:${labels()[0].ref}`)!.click();
    await until(() => labels().length === 0);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    steps = v.api.history.steps.value.length;
    trash(`d:${distances()[0].ref}`)!.click();
    await until(() => distances().length === 0);
    expect(v.api.history.steps.value.length).toBe(steps + 1);
  });
});

describe("a category's Uniform (Ludo, 2026-10-27)", () => {
  it('opens a color picker; picks change nothing until Apply, which colors them all in one step', async () => {
    const v = await viewer(
      [
        ['HIV', 3],
        ['Other', 2],
      ],
      true,
    );
    const { host } = mount(v);
    await until(() => !!item(host, 'c:particles'));
    const uniform = (await viaMore(host, 'c:particles', 'Color…')).find((m) => m.textContent?.trim() === 'Uniform…');
    expect(uniform).toBeTruthy();
    uniform!.click();
    await settle();
    const field = document.querySelector<HTMLInputElement>('[aria-label="Uniform color"] input');
    expect(field).toBeTruthy();
    const steps = v.api.history.steps.value.length;
    field!.value = '#ff0000';
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(v.api.history.steps.value.length).toBe(steps);
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Uniform color"] button')).find(
      (b) => b.textContent?.includes('Apply'),
    )!;
    apply.click();
    const values = () =>
      v.plugin.managers.particles.hierarchy.current.lists.map(
        (l) =>
          (l.representations[0].cell.transform.params as { colorTheme: { params: { value?: number } } }).colorTheme
            .params.value,
      );
    await until(() => values().every((c) => c === 0xff0000));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    // closed, the focus is back on the ⋯ (the keys go on from the tree)
    await settle();
    expect(document.querySelector('[aria-label="Uniform color"]')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.getAttribute('aria-label')).toBe('More');
  });

  it('closes when its ⋯ leaves the page (its row scrolled out of the tree)', async () => {
    const v = await viewer([['HIV', 3]], true);
    const { host } = mount(v);
    await until(() => !!item(host, 'c:particles'));
    await viaMore(host, 'c:particles', 'Color…', 'Uniform…');
    expect(document.querySelector('[aria-label="Uniform color"]')).toBeTruthy();
    // a virtual list removes a row scrolled away
    item(host, 'c:particles')!.remove();
    document.dispatchEvent(new Event('scroll'));
    await settle();
    expect(document.querySelector('[aria-label="Uniform color"]')).toBeNull();
  });
});

describe("the Meshes category's Color…", () => {
  it('colors every mesh by object in one step, one tree update', async () => {
    const v = await viewer([]);
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    const r = await v.api.load.files({ files: [new File([obj], 'a.obj'), new File([obj], 'b.obj')] });
    if (!r.ok) throw new Error(r.message);
    const { host } = mount(v);
    await until(() => !!item(host, 'c:meshes'));
    const colors = async () => {
      const m = await v.api.run('cryoet.meshes', {});
      return ((m as { value?: { color?: number }[] }).value ?? []).map((x) => x.color);
    };
    const before = await colors();
    await viaMore(host, 'c:meshes', 'Color…');
    const steps = v.api.history.steps.value.length;
    const state = v.plugin.state.data;
    const updateTree = state.updateTree.bind(state);
    let updates = 0;
    (state as { updateTree: typeof updateTree }).updateTree = ((...args: Parameters<typeof updateTree>) => {
      updates++;
      return updateTree(...args);
    }) as typeof updateTree;
    try {
      Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'))
        .find((m) => m.textContent?.trim() === 'By object')!
        .click();
      await until(() => v.api.history.steps.value.length === steps + 1);
    } finally {
      (state as { updateTree: typeof updateTree }).updateTree = updateTree;
    }
    const after = await colors();
    expect(after[0]).not.toEqual(before[0]);
    expect(after[0]).not.toEqual(after[1]);
    expect(updates).toBe(1);
  });
});
