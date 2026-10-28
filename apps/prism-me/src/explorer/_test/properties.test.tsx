/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';

// The properties on their mock (_spec/ui.md §4), over a headless viewer in jsdom: 1CRN (data/examples), twice where a
// category needs two objects. Prism's `SectionList` (open per section from pick to pick), the header naming the kind,
// a category's Look and Clips, a clip row's shape and invert, the Labels section; each change one step.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const crnFile = (name = '1crn.cif') =>
  new File([readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))], name);

async function viewer(copies = 1) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  for (let i = 0; i < copies; i++) {
    const l = await v.api.load.files({ files: [crnFile(`1crn-${i}.cif`)] });
    if (!l.ok) throw new Error(l.message);
  }
  return v;
}

function mount(v: PrismViewer) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const structures = (v: PrismViewer) => v.plugin.managers.structure.hierarchy.current.structures;
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
/** A row's clickable line (its treeitem holds it), by its name */
const rowOf = (host: HTMLElement, label: string) =>
  items(host)
    .find((r) => r.querySelector('[data-tip-overflow]')?.textContent === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
const openRow = (host: HTMLElement, label: string) =>
  (rowOf(host, label)!.querySelector('button[data-tree-toggle]') as HTMLButtonElement).click();
/** A section of the properties (Prism's `SectionList`: `data-section`), its header and whether it is open */
const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`);
const header = (host: HTMLElement, id: string) => section(host, id)?.querySelector<HTMLButtonElement>('button');
const isOpen = (host: HTMLElement, id: string) => header(host, id)?.getAttribute('aria-expanded') === 'true';
async function open(host: HTMLElement, id: string) {
  await until(() => !!header(host, id));
  if (!isOpen(host, id)) header(host, id)!.click();
}
const buttonIn = (el: HTMLElement | null, text: string) =>
  Array.from(el?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((b) => b.textContent?.trim() === text);
/** The kind the properties' header names (the faint word after the name) */
const kindShown = (host: HTMLElement) => host.querySelector('[data-properties-kind]')?.textContent;

describe('the properties on their mock', () => {
  it("name the kind and keep a section open (or folded) from pick to pick, on Prism's SectionList", async () => {
    const v = await viewer();
    const host = mount(v);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    await until(() => !!header(host, 'clips'));
    expect(kindShown(host)).toBe('Structure');
    // every section starts closed
    expect(isOpen(host, 'look')).toBe(false);
    expect(isOpen(host, 'clips')).toBe(false);
    await open(host, 'clips');

    // its entity: a part, Clips open there too; the category: Clips open
    openRow(host, '1CRN');
    await until(() => !!rowOf(host, 'CRAMBIN'));
    rowOf(host, 'CRAMBIN')!.click();
    await until(() => kindShown(host) === 'Entity');
    expect(isOpen(host, 'clips')).toBe(true);
    expect(isOpen(host, 'look')).toBe(false);
    rowOf(host, 'Structures')!.click();
    await until(() => kindShown(host) === 'Category');
    expect(isOpen(host, 'clips')).toBe(true);

    // folded here: folded back on the structure
    header(host, 'clips')!.click();
    rowOf(host, '1CRN')!.click();
    await until(() => kindShown(host) === 'Structure');
    expect(isOpen(host, 'clips')).toBe(false);
  });

  it("a category's Look: its eye for every object under it and a color theme, one step each", async () => {
    const v = await viewer(2);
    const host = mount(v);
    await until(() => !!rowOf(host, 'Structures'));
    rowOf(host, 'Structures')!.click();
    await open(host, 'look');
    const look = () => section(host, 'look');
    await until(() => !!buttonIn(look(), 'By object'));
    const n = steps(v);

    // 1CRN is colored by chain at first: by object, each its own color
    buttonIn(look(), 'By object')!.click();
    await until(() => steps(v) === n + 1);
    const themes = () =>
      structures(v).flatMap((s) =>
        s.components.flatMap((c) =>
          c.representations.map(
            (r) => (r.cell.transform.params as { colorTheme: { name: string } } | undefined)?.colorTheme.name,
          ),
        ),
      );
    expect(themes().includes('chain-id')).toBe(false);

    // Prism's switch (ParamsForm's): the category's only one
    const visible = () => look()!.querySelector<HTMLElement>('[role=switch]');
    await until(() => !!visible());
    visible()!.click();
    await until(() => structures(v).every((s) => s.cell.state.isHidden));
    expect(steps(v)).toBe(n + 2);
  });

  it("a clip row's properties: its shape and invert, one step each, the row kept picked", async () => {
    const v = await viewer();
    const ref = structures(v)[0].cell.transform.ref;
    const c = await v.api.run('clipping.add', { shape: 'plane', node: ref });
    if (!c.ok) throw new Error(c.message);
    const cut = () => v.api.clipping.cuts.value[0];
    const host = mount(v);
    await until(() => !!rowOf(host, '1CRN'));
    openRow(host, '1CRN');
    await until(() => !!rowOf(host, 'Plane 1'));
    rowOf(host, 'Plane 1')!.click();
    await until(() => kindShown(host) === 'Clip');
    await open(host, 'clip');
    const clip = () => section(host, 'clip')!;
    const n = steps(v);

    // its shape: Prism's clipping (one step), the same cut (its tag), named anew in the header and the tree
    const shape = clip().querySelector<HTMLButtonElement>('button[aria-haspopup=listbox]')!;
    expect(shape.textContent).toBe('Plane');
    shape.click();
    await until(() => !!clip().querySelector('[role=option]'));
    const sphere = Array.from(clip().querySelectorAll<HTMLElement>('[role=option]')).find(
      (o) => o.textContent === 'Sphere',
    )!;
    sphere.click();
    await until(() => cut().object.type === 'sphere');
    expect(steps(v)).toBe(n + 1);
    await until(() => !!rowOf(host, 'Sphere 1'));
    expect(kindShown(host)).toBe('Clip');
    await until(() => host.querySelector('[data-properties-name]')?.textContent === 'Sphere 1');

    // invert: one step
    const invert = clip().querySelector<HTMLElement>('[role=switch]')!;
    invert.click();
    await until(() => cut().object.invert === true);
    expect(steps(v)).toBe(n + 2);
  });

  it("a category's Clips: the cuts of every object under it, each editable, removed in one step", async () => {
    const v = await viewer(2);
    const refs = structures(v).map((s) => `#${s.cell.transform.ref}`);
    const c = await v.api.run('clipping.add', { shape: 'plane', node: refs.join(', ') });
    if (!c.ok) throw new Error(c.message);
    const host = mount(v);
    await until(() => !!rowOf(host, 'Structures'));
    rowOf(host, 'Structures')!.click();
    await open(host, 'clips');
    const clips = () => section(host, 'clips')!;
    await until(() => !!clips().querySelector('[aria-label="Remove it"]'));
    expect(clips().querySelector('button[aria-haspopup=listbox]')?.textContent).toBe('Plane');
    const n = steps(v);
    clips().querySelector<HTMLButtonElement>('[aria-label="Remove it"]')!.click();
    await until(() => v.api.clipping.cuts.value.length === 0);
    expect(steps(v)).toBe(n + 1);
    await until(() => !clips().querySelector('[aria-label="Remove it"]'));
  });

  it('the Labels section: each label made at the node, its text and size edited, removed, one step each', async () => {
    const v = await viewer();
    const ref = structures(v)[0].cell.transform.ref;
    const host = mount(v);
    await until(() => !!rowOf(host, '1CRN'));
    const l = await v.api.run('stage.label', { text: 'Crambin', target: ref, node: `o:${ref}` });
    if (!l.ok) throw new Error(l.message);
    const labels = () => v.api.stage!.labelsState().value;
    rowOf(host, '1CRN')!.click();
    await open(host, 'labels');
    const section_ = () => section(host, 'labels')!;
    const text = () => section_().querySelector<HTMLInputElement>('input[aria-label="The label\'s text"]');
    await until(() => text()?.value === 'Crambin');
    const n = steps(v);

    text()!.value = 'Crambin!';
    text()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => labels()[0].text === 'Crambin!');
    expect(steps(v)).toBe(n + 1);

    // its size: a typed value (the slider's box), one step
    const size = section_().querySelector<HTMLInputElement>('input[aria-label="Size"]:not([type=range])')!;
    size.value = '12';
    size.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => labels()[0].size === 12);
    expect(steps(v)).toBe(n + 2);

    buttonIn(section_(), 'Remove the label')!.click();
    await until(() => labels().length === 0);
    expect(steps(v)).toBe(n + 3);
    await until(() => !text());
  });

  it("a color of none of its own says so, not a white swatch; picked in Prism's ColorPicker, a run of picks one step", async () => {
    const v = await viewer();
    const host = mount(v);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    await open(host, 'look');
    const look = () => section(host, 'look')!;
    await until(() => !!buttonIn(look(), "Its representation's · pick one"));
    expect(look().textContent).not.toContain('255, 255, 255');
    const n = steps(v);

    buttonIn(look(), "Its representation's · pick one")!.click();
    // Prism's color row, its picker opened under it at its swatch
    const swatch = () =>
      Array.from(look().querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((b) =>
        /^\d+, \d+, \d+$/.test(b.textContent ?? ''),
      );
    await until(() => !!swatch());
    swatch()!.click();
    await until(() => look().querySelectorAll('[aria-label="Palette"] [role=option]').length > 2);
    const hues = Array.from(look().querySelectorAll<HTMLButtonElement>('[aria-label="Palette"] [role=option]'));
    hues[0].click();
    hues[1].click();
    await until(() => steps(v) === n + 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(steps(v)).toBe(n + 1);
    await until(() => !buttonIn(look(), "Its representation's · pick one"));
  });
});
