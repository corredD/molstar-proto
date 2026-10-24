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
import { MesoscaleExtension } from '../prism-viewer.js';
import { EntitiesTab, mesoscaleUI } from '../prism-viewer-ui.js';
import { TestParticleList } from './fixtures.js';

// The Entities tab over a headless viewer, in jsdom, on the cellPACK-like list of fixtures.ts (lipids in the
// membrane, the only entity with a function; CA and NC in the capsid surface; one without a compartment).

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  await v.plugin.build().toRoot().apply(TestParticleList).commit();
  const r = await v.api.particles.representation({ type: 'spacefill' });
  if (!r.ok) throw new Error(r.message);
  return v;
}

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function mountTab(v: PrismViewer) {
  const ui = mesoscaleUI({ api: v.api.as({ kind: 'person' }), sources: v.sources, managers: v.managers });
  const tab = ui.tabs!.find((t) => t.id === EntitiesTab)!;
  const host = document.createElement('div');
  document.body.append(host);
  tab.render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

/** The labels of the top-level group rows (a group's row: its fold button, its eye, its label) */
const groupLabels = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button[aria-label="Fold"], button[aria-label="Unfold"]')).map(
    (b) => b.parentElement!.querySelector('span[style*="flex: 1"]')?.textContent,
  );

const choice = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Group by"] button')).find(
    (b) => b.textContent === label,
  );

describe('the Entities tab', () => {
  it('regroups the rows by function and back when its switch is toggled, and acts on the group shown', async () => {
    const v = await viewer();
    const host = mountTab(v);
    await until(() => groupLabels(host).length > 0);
    expect(groupLabels(host)).toEqual(['root']);
    expect(choice(host, 'Compartment')?.getAttribute('aria-pressed')).toBe('true');

    choice(host, 'Function')!.click();
    await until(() => groupLabels(host).includes('membrane'));
    expect(groupLabels(host)).toEqual(['membrane', 'unknown function']);
    expect(choice(host, 'Function')?.getAttribute('aria-pressed')).toBe('true');

    // the group's eye hides the function's entities: the group resolved by function
    const row = Array.from(host.querySelectorAll('span')).find((s) => s.textContent === 'unknown function')!
      .parentElement!;
    (row.querySelector('button[aria-label^="Show or hide "]') as HTMLButtonElement).click();
    await until(() => {
      const i = v.api.mesoscale!.infoState().value;
      return !!i && i.entities.filter((e) => !e.visible).length === 3;
    });
    const i = v.api.mesoscale!.infoState().value!;
    expect(i.entities.filter((e) => !e.visible).map((e) => e.name)).toEqual(['CA', 'NC', 'loose']);

    choice(host, 'Compartment')!.click();
    await until(() => groupLabels(host)[0] === 'root');
    expect(groupLabels(host)).toEqual(['root']);
  });
});
