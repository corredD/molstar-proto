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
});
