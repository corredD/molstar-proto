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

// The CryoET Data Portal's card over the shipped index (apps/prism-me/portal): its Load after a load that failed.

const shipped = <T,>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../../../apps/prism-me/portal/${name}.json`), 'utf8'),
  ) as T;

const area: PortalPanelArea = {
  catalog: async () => shipped<PortalCatalog>('index'),
  dataset: async (id) => shipped<PortalDataset>(String(id)),
  describe: (ds, run, spacing) => describePortalRun(() => true, ds, run, spacing),
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

describe('the portal card', () => {
  it('gives Load back after a load that threw, and says why (Ludo, 2026-11-03: Load was gone)', async () => {
    let calls = 0;
    const ctx: PortalPanelContext = {
      api: {
        run: async () => {
          calls++;
          throw new Error('OME-Zarr: level 1 needs 685 MB, over the 618 MB limit');
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PortalPanel ctx={ctx} area={area} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'));
    await until(() => !!load());
    load()!.click();
    await until(() => calls === 1 && !load()!.disabled);
    expect(host.textContent).toContain('685 MB');
    load()!.click();
    await until(() => calls === 2);
    dispose();
  });

  // night review B4: the form a pick remakes held busy and the result, so both were lost, and a second Load queued
  it('keeps a load in flight across a pick: Load stays busy, its result is shown', async () => {
    let finish!: () => void;
    const calls: Record<string, unknown>[] = [];
    const ctx: PortalPanelContext = {
      api: {
        run: (_, values) => {
          calls.push(values);
          return new Promise((done) => (finish = () => done({ ok: true, did: 'Loaded 10003 TS_01.' })));
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PortalPanel ctx={ctx} area={area} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'));
    await until(() => !!load());
    load()!.click();
    await until(() => calls.length === 1);
    pickOption(host, 'Run', 'TS_02');
    await until(() => !!load() && host.querySelector('[aria-label="Run"]')?.textContent?.includes('TS_02') === true);
    expect(load()!.disabled).toBe(true);
    finish();
    await until(() => /Loaded 10003 TS_01/.test(host.textContent ?? ''));
    expect(load()!.disabled).toBe(false);
    dispose();
  });

  // night review B5, B6 (EMPIAR's S6): a failed read put its select back, and a later read clears its error
  it('goes back to the dataset it shows when a read fails, and clears the error on the next read', async () => {
    let fail = true;
    const flaky: PortalPanelArea = {
      ...area,
      dataset: async (id) => {
        if (id === 10453 && fail) {
          fail = false;
          throw new Error('Could not read dataset 10453.');
        }
        return area.dataset(id);
      },
    };
    const calls: Record<string, unknown>[] = [];
    const ctx: PortalPanelContext = {
      api: {
        run: async (_, values) => {
          calls.push(values);
          return { ok: true, did: 'Loaded.' };
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PortalPanel ctx={ctx} area={flaky} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Load'));
    await until(() => !!load());
    pickOption(host, 'Dataset', '10453');
    await until(() => /Could not read dataset 10453/.test(host.textContent ?? ''));
    await new Promise((r) => setTimeout(r, 50));
    expect(host.querySelector('[aria-label="Dataset"]')?.textContent).toContain('10003');
    load()!.click();
    await until(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ dataset: 10003 });
    pickOption(host, 'Dataset', '10453');
    await until(() => /tomogram_003/.test(host.textContent ?? ''));
    expect(host.textContent).not.toContain('Could not read dataset 10453');
    dispose();
  });
});

/** Opens a select by its row's label and picks the option holding `text` */
function pickOption(host: HTMLElement, label: string, text: string) {
  (host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
  const o = Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find((x) =>
    x.textContent?.includes(text),
  );
  o!.click();
}
