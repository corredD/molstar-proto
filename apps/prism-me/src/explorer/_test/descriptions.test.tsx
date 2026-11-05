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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { descriptionText } from '../description-text.js';
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
    .find((r) => r.querySelector('[id^=me-tree-name]')?.textContent === label)
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

describe("an entity's description in the tree", () => {
  it("is its row's tooltip card, its name then the description as text; none for an entity without one", async () => {
    const host = await mounted();
    await until(() => {
      unfoldAll(host);
      return !!rowOf(host, 'RNA_POLYMERASE') && !!rowOf(host, 'ITG');
    });
    // Prism's row tip: shown always (`data-tip`), its parts' text (the name, then the muted rest)
    const parts = (label: string) => {
      const row = rowOf(host, label)!;
      if (row.dataset.tipRow === undefined || row.dataset.tip === undefined) return undefined;
      return Array.from(row.querySelectorAll('[data-tip-part]'), (p) => p.textContent);
    };
    expect(parts('ITG')).toEqual(['ITG', 'Integrin alpha-5, important for cell adhesion and signaling.']);
    expect(parts('CD81')).toEqual(['CD81', 'CD81 antigen PDB entry 5TCX']);
    expect(parts('RNA_POLYMERASE')).toBeUndefined();
    // its accessible description (a screen reader's), the card being a pointer's only
    const item = rowOf(host, 'ITG')!.closest<HTMLElement>('[role=treeitem]')!;
    expect(document.getElementById(item.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Integrin alpha-5, important for cell adhesion and signaling.',
    );
    expect(rowOf(host, 'RNA_POLYMERASE')!.querySelector('[data-tip-overflow]')?.textContent).toBe('RNA_POLYMERASE');
  });
});

describe('descriptionText', () => {
  it('cuts a long description at a word past 200 characters', () => {
    const long = `${'word '.repeat(100)}end`;
    const text = descriptionText(long);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(201);
    expect(descriptionText('Short [link](http://x)')).toBe('Short link');
  });
});

describe("a portal annotation's words in the properties (Ludo, 2026-11-04: the portal's description and method)", () => {
  it("shows the ribosomes' description, their method on one line, and their GO term as a link", async () => {
    // the ribosomes' ndjson of 10003 TS_08 (two points), nothing else: the decoration and the average fail, warned
    const points = [1, 2].map((x) => JSON.stringify({ type: 'point', location: { x, y: x, z: x } })).join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
        return url.endsWith('chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson')
          ? new Response(points, { status: 200 })
          : new Response('not found', { status: 404 });
      }),
    );
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
    });
    viewers.push(v);
    const r = await v.api.run('cryoetPortal.load', { dataset: 10003, run: 'TS_08', annotations: '1212', as: 'none' });
    if (!r.ok) throw new Error(r.message);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    const name = 'chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson';
    await until(() => !!rowOf(host, name));
    rowOf(host, name)!.click();
    await until(() => nameShown(host) === name);
    const text = description(host)?.textContent ?? '';
    expect(text).toContain('cytosolic ribosome: chloramphenicol bound 70S ribosome');
    expect(text).toContain('Template matching + manual filtering + 3D classification filtering');
    const link = description(host)?.querySelector('a');
    expect(link?.textContent).toBe('GO:0022626');
    expect(link?.getAttribute('href')).toBe('https://amigo.geneontology.org/amigo/term/GO:0022626');
  });
});
