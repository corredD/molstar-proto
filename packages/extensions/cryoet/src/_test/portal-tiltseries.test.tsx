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

// The CryoET Data Portal's card over the shipped index (apps/prism-me/portal), opened on 10003 TS_08: its choice of
// tilt series, none by default, labelled as the portal's, with its own level (Ludo, 2026-11-03).

const shipped = <T,>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../../../apps/prism-me/portal/${name}.json`), 'utf8'),
  ) as T;

/** The shipped index, opened on 10003 (its first) TS_08 */
const area: PortalPanelArea = {
  catalog: async () => shipped<PortalCatalog>('index'),
  dataset: async (id) => shipped<PortalDataset>(String(id)),
  describe: (ds, run, spacing, tomogram) => describePortalRun(() => true, ds, run || 'TS_08', spacing, tomogram),
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
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
/** The size beside Load, MB */
const total = () =>
  Number(
    Array.from(document.querySelectorAll('span'), (x) => x.textContent ?? '')
      .find((t) => /^\d+ MB$/.test(t))
      ?.split(' ')[0],
  );
const loadButton = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'))!;

describe('the portal card, a run with a tilt series', () => {
  it('lists its tilt series, none chosen; one picked offers its levels and is loaded with Load', async () => {
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
    await until(() => !!field('Tilt series'));
    // none by default: the tomogram's load as before
    expect(field('Tilt series')!.textContent).toBe('None');
    expect(field('Series level')).toBeNull();
    loadButton().click();
    await until(() => loads.length === 1);
    expect(loads[0]).not.toHaveProperty('tiltSeries');
    const before = total();
    expect(before).toBeGreaterThan(0);

    field('Tilt series')!.click();
    await until(() => options().length > 0);
    expect(options().map((o) => o.textContent?.trim())).toEqual([
      'None',
      'TS-17086 · 1.7005 Å · 3838×3710×41 · −60°…+60° step 3°',
    ]);
    options()[1].click();
    await until(() => !!field('Series level'));
    // the coarsest, level 2, by default; its size in the total beside Load
    expect(field('Series level')!.textContent).toBe('2: 960×928×41 at 6.8 Å, 146 MB');
    expect(total()).toBe(before + 146);
    loadButton().click();
    await until(() => loads.length === 2);
    expect(loads[1]).toMatchObject({ dataset: 10003, run: 'TS_08', tiltSeries: 17086, tiltSeriesLevel: 2 });
    dispose();
  });
});
