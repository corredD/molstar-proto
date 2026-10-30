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

// A clip's Ghosts (_spec/ui.md §4, cellview.md §4.3; lane ghosts): Outline what it cuts, over a headless viewer in
// jsdom with 1CRN (data/examples); each press one step.

let viewer: PrismViewer | undefined;
afterEach(async () => {
  await viewer?.dispose();
  viewer = undefined;
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("a clip's Ghosts", () => {
  it('outlines what it cuts and back, one step each', async () => {
    const base = DefaultPrismViewerSpec();
    const v = (viewer = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
    }));
    const crn = new File(
      [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
      '1crn.cif',
    );
    expect((await v.api.load.files({ files: [crn] })).ok).toBe(true);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);

    expect((await v.api.run('clipping.add', { shape: 'plane', everything: true })).ok).toBe(true);
    const tag = v.api.clipping.cuts.value[0].object.tag!;
    const row = () => host.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(`k:${tag}`)}"] [data-tree-row]`);
    await until(() => !!row());
    row()!.click();
    const header = () => host.querySelector<HTMLElement>('[data-section="clip"]')?.querySelector('button');
    await until(() => !!header());
    if (header()!.getAttribute('aria-expanded') !== 'true') header()!.click();
    // the switch labelled Ghosts (Invert's is another)
    const toggle = () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('[data-section="clip"] [role=switch]')).find(
        (b) => document.getElementById(b.getAttribute('aria-labelledby') ?? '')?.textContent === 'Ghosts',
      );
    await until(() => !!toggle());

    const ghost = () => !!v.api.clipping.cuts.value[0].object.ghost;
    const steps = () => v.api.history.steps.value.length;
    const n = steps();
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    toggle()!.click();
    await until(ghost);
    expect(steps()).toBe(n + 1);
    await until(() => toggle()!.getAttribute('aria-checked') === 'true');

    toggle()!.click();
    await until(() => !ghost());
    expect(steps()).toBe(n + 2);
  });
});
