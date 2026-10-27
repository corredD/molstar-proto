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
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';

// Handles on top in an object's properties (_spec/ui.md §4, Position and Clips), over a headless viewer in jsdom with
// a fake canvas: 1CRN (data/examples) and a plane clip on it. One setting: the On top of Position and of the clip's
// line show the same state and flip it for every handle, no history step.

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

const buttons = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === text);
const items = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'));
const rowOf = (host: HTMLElement, label: string) =>
  items(host).find((r) => r.querySelector('span[style*="flex: 1; min-width: 0"]')?.textContent === label);

describe('handles on top in the properties', () => {
  it('shows one state in Position and in a clip line, and flips it there, no history step', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
    });
    viewers.push(v);
    const canvas = mountGizmoCanvas(v.plugin);
    const crn = new File(
      [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
      '1crn.cif',
    );
    const l = await v.api.load.files({ files: [crn] });
    if (!l.ok) throw new Error(l.message);
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const c = await v.api.run('clipping.add', { shape: 'plane', node: ref });
    if (!c.ok) throw new Error(c.message);

    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    for (const title of ['Position', 'Clips']) {
      await until(() => buttons(host, title).length > 0);
      const section = buttons(host, title)[0];
      if (section.getAttribute('aria-expanded') !== 'true') section.click();
    }
    await until(() => buttons(host, 'On top').length === 2);
    const pressed = () => buttons(host, 'On top').map((b) => b.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['false', 'false']);
    const steps = v.api.history.steps.value.length;

    buttons(host, 'On top')[0].click();
    await until(() => pressed().every((p) => p === 'true'));
    expect(v.api.canvas.handleLook.onTop).toBe(true);
    buttons(host, 'On top')[1].click();
    await until(() => pressed().every((p) => p === 'false'));
    expect(v.api.history.steps.value.length).toBe(steps);
    canvas.remove();
  });
});
