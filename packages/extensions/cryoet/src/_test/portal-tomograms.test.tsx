/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@molstar/prism-ui';
import { afterEach, describe, expect, it } from 'vitest';
import { PortalPanel, type PortalPanelContext } from '../portal-card.js';
import type { PortalCatalog, PortalDataset } from '../portal-index.js';
import { describePortalRun, type PortalPanelArea } from '../portal-run.js';

// The CryoET Data Portal's card over the shipped index (apps/prism-me/portal), opened on 10518 pt117_ts_001: its
// choice of tomogram, every one of the run as the portal lists them (Ludo, 2026-11-03).

const shipped = <T,>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../../../apps/prism-me/portal/${name}.json`), 'utf8'),
  ) as T;

/** The shipped index, 10518 first (its first run is pt117_ts_001) */
const area: PortalPanelArea = {
  catalog: async () => {
    const c = shipped<PortalCatalog>('index');
    return { ...c, datasets: [...c.datasets].sort((a, b) => +(b.id === 10518) - +(a.id === 10518)) };
  },
  dataset: async (id) => shipped<PortalDataset>(String(id)),
  describe: (ds, run, spacing, tomogram) => describePortalRun(() => true, ds, run, spacing, tomogram),
};

afterEach(() => {
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const field = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
/** A tomogram picked from the open list; done when the form made for it is in place of the old one */
async function pick(id: string) {
  const old = field('Tomogram')!;
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .find((o) => o.textContent?.startsWith(id))!
    .click();
  await until(() => !old.isConnected && !!field('Tomogram')?.textContent?.startsWith(id));
}

const options = () => Array.from(document.querySelectorAll('[role="option"]'), (o) => o.textContent?.trim() ?? '');

describe('the portal card, a run of several tomograms', () => {
  it("lists every tomogram of the run, labelled as the portal's list, the portal's default chosen; one picked is loaded at its spacing", async () => {
    const loads: Record<string, unknown>[] = [];
    const ctx: PortalPanelContext = {
      api: {
        run: async (_, values) => {
          loads.push(values);
          return { ok: true, did: 'Loaded.' };
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PortalPanel ctx={ctx} area={area} />, host);
    await until(() => !!field('Tomogram'));
    // the portal's default (Ludo's screenshot): 64007, WBP filtered at 10.403 Å
    expect(field('Tomogram')!.textContent).toBe('64007 · WBP Filtered · 10.403 Å · 886×630×246 · AreTomo3 v2.3.0');
    // the view of a tomogram is a field of its own, named apart
    expect(field('Show as')).toBeTruthy();
    expect(field('Voxel spacing') ?? field('Spacing')).toBeNull();

    field('Tomogram')!.click();
    await until(() => options().length > 0);
    const labels = options();
    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(8);
    expect(labels.map((l) => l.split(' · ')[0])).toEqual([
      '64004',
      '64005',
      '64006',
      '64007',
      '64008',
      '64009',
      '64010',
      '64011',
    ]);
    expect(labels).toContain('64010 · WBP Denoised · 10.403 Å · 886×630×246 · AreTomo3 v2.3.0, IsoNet2');
    expect(labels).toContain('64011 · WBP Filtered · 5.003 Å · 1842×1310×512 · AreTomo3 v2.3.1');

    // 64010 picked: the form is made again for it (the old one gone), the membrane mask at 10.403 Å offered and checked
    await pick('64010');
    expect(host.textContent).toContain('membrane · SegmentationMask');
    const load = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'))!;
    load.click();
    await until(() => loads.length === 1);
    expect(loads[0]).toMatchObject({
      dataset: 10518,
      run: 'pt117_ts_001',
      spacing: 10.403,
      tomogram: 64010,
      annotations: '183803',
    });

    // 64011 picked: its spacing's (5.003 Å) capsid picks instead
    field('Tomogram')!.click();
    await until(() => options().length > 0);
    await pick('64011');
    expect(host.textContent).toContain('virus-like capsid · OrientedPoint');
    expect(host.textContent).not.toContain('membrane · SegmentationMask');
    dispose();
  });
});
