/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { domView } from '@molstar/prism-ui';
import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { MembraneDetailControls } from '../controls.js';
import { forgetLipidPatch, registerLipidPatch } from '../lipids/membrane.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A lipid membrane's levels in its properties (`controls.tsx`, prism-me's Look; Ludo tunes them, 2026-11-08), over a
// headless viewer in jsdom: Custom shows each level's start, stride and bias, and the levels as text to copy.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('a membrane’s levels in its properties', () => {
  it('picks custom levels in one step and shows them as text', async () => {
    registerLipidPatch('ui-patch', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch' });
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const host = document.createElement('div');
    document.body.append(host);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    domView(() => <MembraneDetailControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    await until(() => button('Balanced')?.getAttribute('aria-pressed') === 'true');
    expect(host.querySelector('code')).toBeNull();
    button('Custom').click();
    await until(() => !!host.querySelector('code'));
    expect(v.plugin.state.data.cells.get(membrane)!.transform.params).toMatchObject({ detail: 'custom' });
    // the levels after the first: a start, a stride and a bias each; the text Ludo copies
    const labels = new Set(
      [...host.querySelectorAll('[aria-label^="Level "]')].map((e) => e.getAttribute('aria-label')),
    );
    expect([...labels].sort()).toEqual(
      ['Level 2 bias', 'Level 2 from', 'Level 2 stride', 'Level 3 bias', 'Level 3 from', 'Level 3 stride'].sort(),
    );
    expect(host.querySelector('code')!.textContent).toBe('0 Å ×1 b1 · 2000 Å ×8 b2 · 8000 Å ×64 b2');
    // one step: undone, the preset again
    const undo = await v.api.history.undo({});
    expect(undo.ok).toBe(true);
    expect(v.plugin.state.data.cells.get(membrane)!.transform.params).toMatchObject({ detail: 'balanced' });
    forgetLipidPatch('ui-patch');
  });
  it('switches a cut membrane’s far look and its switches in one step each, no switch for tiles', async () => {
    registerLipidPatch('ui-patch-far', syntheticPatchPdb().text);
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
    });
    viewers.push(v);
    const r = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch-far', method: 'cutter' });
    if (!r.ok) throw new Error(r.message);
    const membrane = r.changed!.nodes![0];
    const host = document.createElement('div');
    document.body.append(host);
    const area = v.api.as({ kind: 'person' }).mesoscale!;
    domView(() => <MembraneDetailControls area={area} membrane={membrane} />).mount(
      host,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    await until(() => button('Both')?.getAttribute('aria-pressed') === 'true');
    expect(host.querySelector('[aria-label="Lipids down to"]')).not.toBeNull();
    button('Texture').click();
    await until(() => !!host.querySelector('[aria-label="Lipids from"]'));
    const params = () => v.plugin.state.data.cells.get(membrane)!.transform.params;
    expect(params()).toMatchObject({ far: 'texture' });
    // the operation checks its switches; a valid one is one step
    expect((await area.membraneDetail({ membrane, atomsPx: 100 } as never)).ok).toBe(false);
    expect((await area.membraneDetail({ membrane, atomsPx: 4 } as never)).ok).toBe(true);
    expect(params()).toMatchObject({ far: 'texture', atomsPx: 4 });
    expect((await v.api.history.undo({})).ok).toBe(true);
    expect(params()).toMatchObject({ far: 'texture', atomsPx: 2 });
    // tiles: no far look (they are built whole)
    const t = await v.api.mesoscale!.wrapMembrane({ radius: 300, edge: 80, patch: 'ui-patch-far' });
    const tiles = document.createElement('div');
    document.body.append(tiles);
    domView(() => <MembraneDetailControls area={area} membrane={t.changed!.nodes![0]} />).mount(
      tiles,
      { shell: new ShellModel() } as never,
      undefined as never,
    );
    await until(() => !!tiles.querySelector('button'));
    expect([...tiles.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Texture')).toBe(false);
    forgetLipidPatch('ui-patch-far');
  });
});
