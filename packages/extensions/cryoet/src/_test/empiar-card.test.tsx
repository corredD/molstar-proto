/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@molstar/prism-ui';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { afterEach, describe, expect, it } from 'vitest';
import { EmpiarPanel, type EmpiarPanelArea, type EmpiarPanelContext } from '../empiar-card.js';
import { type EmpiarAsk, parseListing, readEmpiarEntry, walkCondition, walkGrid } from '../empiar-entry.js';

// The EMPIAR card over EMPIAR-12534's recorded API reply and listings (`empiar-12534/`): the entry asked for (the URL's
// `?empiar=12534&empiar-run=…`), its run's files with their sizes, what cannot load greyed with why, Load asking first.

const dir = resolve(import.meta.dirname, 'empiar-12534');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const Run = 'YTC041_1_lam1_1_ts_003';

const listing = async (folder: string) => {
  const name = `${folder.replace(/^data\/?/, '').replace(/\//g, '~') || 'data'}.html`;
  if (!readdirSync(dir).includes(name)) throw new Error(`not recorded: ${folder}`);
  return parseListing(read(name));
};

function area(asked: EmpiarAsk): EmpiarPanelArea {
  const entry = readEmpiarEntry(12534, JSON.parse(read('entry.json')));
  const condition = (_: number, root: string) => walkCondition(entry, root, listing);
  return {
    entry: async () => entry,
    condition,
    grid: async (id, root, grid) => walkGrid(entry, await condition(id, root), grid, listing),
    asked: observableState<EmpiarAsk | undefined>(asked).asReadonly,
  };
}

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

describe('the EMPIAR card', () => {
  it("shows the entry asked for, its run's files with sizes, the rest greyed with why; Load asks first, then goes on", async () => {
    const calls: Record<string, unknown>[] = [];
    const ctx: EmpiarPanelContext = {
      api: {
        run: async (_, values) => {
          calls.push(values);
          return values.large
            ? { ok: true, did: `Loaded ${values.run}.` }
            : { ok: false, code: 'confirm', message: `${values.run}: 1312 MB to read whole.` };
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={area({ id: 12534, run: Run })} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => /Load/.test(b.textContent ?? ''));
    await until(() => !!load());
    const text = host.textContent ?? '';
    expect(text).toContain('Cytoplasmic ribosomes on mitochondria');
    expect(text).toContain(`tomogram · ${Run}.mrc_9.98Apx.mrc · 834 MB`);
    expect(text).toContain(`mask · ${Run}_labels.mrc · 417 MB`);
    expect(text).toContain('particles · 80S_ribosome_CHX.star · 12 MB');
    expect(text).toMatch(new RegExp(`${Run}_labels\\.hff · 3\\.8 MB: needs a reader for EMDB-SFF`));
    expect(text).toMatch(/\.mrc\.st · 3\.3 GB: too large to read whole in a tab/);
    // the total beside Load, in the listing's units: the sum of the sizes shown
    expect(text).toContain('1263 MB');
    // a condition by its image set's words
    expect(text).toContain('EMPIAR_upload · Reconstructed tomograms of CHX-treated S. cerevisiae lamellae');

    load()!.click();
    await until(() => calls.length === 1 && /Load anyway/.test(load()!.textContent ?? ''));
    expect(calls[0]).toMatchObject({ id: 12534, run: Run, grid: 'YTC041_1', emdb: 'EMD-48752', large: false });
    expect(String(calls[0].files).split(',')).toEqual([
      `${Run}.mrc_9.98Apx.mrc`,
      `${Run}_labels.mrc`,
      '80S_ribosome_CHX.star',
      'co-translation_ribosome_CHX.star',
    ]);
    expect(host.textContent).toContain('1312 MB to read whole. Load anyway?');
    load()!.click();
    await until(() => calls.length === 2 && /Loaded/.test(host.textContent ?? ''));
    expect(calls[1].large).toBe(true);
    dispose();
  });
});
