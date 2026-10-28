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

// The properties on their mock (_spec/ui.md §4), over a headless viewer in jsdom: 1CRN (data/examples). Prism's
// `SectionList` (open per section from pick to pick), the header naming the kind.

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

    // its entity: a part, Clips open there too
    openRow(host, '1CRN');
    await until(() => !!rowOf(host, 'CRAMBIN'));
    rowOf(host, 'CRAMBIN')!.click();
    await until(() => kindShown(host) === 'Entity');
    expect(isOpen(host, 'clips')).toBe(true);
    expect(isOpen(host, 'look')).toBe(false);

    // folded here: folded back on the structure
    header(host, 'clips')!.click();
    rowOf(host, '1CRN')!.click();
    await until(() => kindShown(host) === 'Structure');
    expect(isOpen(host, 'clips')).toBe(false);
  });
});
