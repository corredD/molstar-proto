/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';
import { CellpackCif as cif } from '../../_test/fixtures.js';

// An entity's description under its name in the properties (_spec/ui.md §4; the Mesoscale Explorer's Focus Info), over
// a headless viewer in jsdom, from the cellPACK mmCIF of `_test/fixtures.ts`: the Exosome's rows (the sentence in
// `_entity.pdbx_parent_entity_id`, one with a Markdown link) and an MG-like row (its compartment there, `details` a
// function: no description).

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

async function mounted() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const l = await v.api.load.files({ files: [new File([cif], 'exosome.cif')] });
  if (!l.ok) throw new Error(l.message);
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const rowOf = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'))
    .find((r) => r.querySelector('[data-tip-overflow]')?.textContent === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
/** Every folded row unfolded (once a step: its children show after the next render) */
const unfoldAll = (host: HTMLElement) => {
  for (const r of host.querySelectorAll<HTMLElement>('[role=treeitem][aria-expanded=false]')) {
    r.querySelector<HTMLButtonElement>('button[data-tree-toggle]')?.click();
  }
};
const nameShown = (host: HTMLElement) => host.querySelector('[data-properties-name]')?.textContent;
const description = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-properties-description]');

describe("an entity's description in the properties", () => {
  it('shows under its name, a Markdown link as a link (no brackets); none for an entity without one', async () => {
    const host = await mounted();
    await until(() => {
      unfoldAll(host);
      return !!rowOf(host, 'RNA_POLYMERASE') && !!rowOf(host, 'ITG');
    });
    rowOf(host, 'ITG')!.click();
    await until(() => nameShown(host) === 'ITG');
    expect(description(host)?.textContent).toBe('Integrin alpha-5, important for cell adhesion and signaling.');

    rowOf(host, 'CD81')!.click();
    await until(() => nameShown(host) === 'CD81');
    expect(description(host)?.textContent).toBe('CD81 antigen PDB entry 5TCX');
    expect(description(host)?.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.rcsb.org/pdb/explore.do?structureId=5TCX',
    );

    rowOf(host, 'RNA_POLYMERASE')!.click();
    await until(() => nameShown(host) === 'RNA_POLYMERASE');
    expect(description(host)).toBeNull();
  });
});
