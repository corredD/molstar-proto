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
import type { FetchProgress } from '../load-steps.js';
import {
  type EmpiarAsk,
  type EmpiarGrid,
  parseListing,
  readEmpiarEntry,
  walkCondition,
  walkGrid,
} from '../empiar-entry.js';

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

function area(asked: EmpiarAsk, failing?: string): EmpiarPanelArea {
  const entry = readEmpiarEntry(12534, JSON.parse(read('entry.json')));
  const condition = (_: number, root: string) => walkCondition(entry, root, listing);
  return {
    entry: async () => entry,
    condition,
    grid: async (id, root, grid) => {
      if (grid === failing) throw new Error(`Could not read the grid ${grid}.`);
      return walkGrid(entry, await condition(id, root), grid, listing);
    },
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

const tick = () => new Promise((r) => setTimeout(r, 50));
/** A field's button, by its row's label */
const button = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  ) as HTMLButtonElement;
const option = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find((o) => o.textContent?.includes(text))!;

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
    expect(text).toContain(`tomogram · ${Run}.mrc_9.98Apx.mrc · 875 MB`);
    expect(text).toContain(`mask · ${Run}_labels.mrc · 437 MB`);
    expect(text).toContain('particles · 80S_ribosome_CHX.star · 13 MB');
    expect(text).toMatch(new RegExp(`${Run}_labels\\.hff · 4\\.0 MB: needs a reader for EMDB-SFF`));
    expect(text).toMatch(/\.mrc\.st · 3\.5 GB: too large to read whole in a tab/);
    // the total beside Load, in MB of 10^6 bytes, as the portal's
    expect(text).toContain('1.3 GB');
    // and how long EBI usually takes for it
    expect(text).toContain("1.3 GB from EBI: about 2–4 h at its usual speed (EMPIAR's server is often slow");
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

  it('asks again when the files change after a yes (review M1, F3): the size said is the one loaded', async () => {
    const calls: Record<string, unknown>[] = [];
    const ctx: EmpiarPanelContext = {
      api: {
        run: async (_, values) => {
          calls.push(values);
          return values.large
            ? { ok: true, did: 'Loaded.' }
            : { ok: false, code: 'confirm', message: `${values.files}: to read whole.` };
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={area({ id: 12534, run: Run })} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => /^\s*Load/.test(b.textContent ?? ''));
    await until(() => !!load());
    load()!.click();
    await until(() => calls.length === 1 && /Load anyway/.test(load()!.textContent ?? ''));
    // the mask unticked: the yes was for another set
    button(host, 'Files').click();
    await tick();
    option(`${Run}_labels.mrc`).click();
    await until(() => /^\s*Load\s*$/.test(load()!.textContent ?? ''));
    expect(host.textContent).not.toContain('Load anyway?');
    load()!.click();
    await until(() => calls.length === 2);
    expect(calls[1].large).toBe(false);
    dispose();
  });

  it('goes back to the pick it shows when a read fails (review S6): Load sends what the form says', async () => {
    const calls: Record<string, unknown>[] = [];
    const ctx: EmpiarPanelContext = {
      api: {
        run: async (_, values) => {
          calls.push(values);
          return { ok: true, did: 'Loaded.' };
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={area({ id: 12534, run: Run }, 'YTC041_2')} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => /^\s*Load/.test(b.textContent ?? ''));
    await until(() => !!load());
    button(host, 'Grid').click();
    await tick();
    option('YTC041_2').click();
    await until(() => /Could not read the grid YTC041_2/.test(host.textContent ?? ''));
    await tick();
    expect(button(host, 'Grid').textContent).toContain('YTC041_1');
    load()!.click();
    await until(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ grid: 'YTC041_1', run: Run });
    dispose();
  });

  it('shows the latest pick when an older read answers after it (review S8, rendering.md §2.7)', async () => {
    const base = area({ id: 12534, run: Run });
    // YTC041_2 answers slowly, YTC042_2 at once: picked in that order, YTC042_2 stays
    const one = (grid: string) => ({
      condition: 'data/EMPIAR_upload',
      name: grid,
      runs: [{ stem: `${grid}_r`, files: [] }],
      other: [],
    });
    const slow: EmpiarPanelArea = {
      ...base,
      grid: async (id, root, grid) =>
        grid === 'YTC041_2'
          ? new Promise((done) => setTimeout(() => done(one(grid)), 300))
          : grid === 'YTC042_2'
            ? one(grid)
            : base.grid(id, root, grid),
    };
    const ctx: EmpiarPanelContext = { api: { run: async () => ({ ok: true, did: '' }) } };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={slow} />, host);
    await until(() => /YTC041_1_lam1_1_ts_003/.test(host.textContent ?? ''));
    button(host, 'Grid').click();
    await tick();
    option('YTC041_2').click();
    await tick();
    button(host, 'Grid').click();
    await tick();
    option('YTC042_2').click();
    await until(() => /YTC042_2_r/.test(host.textContent ?? ''));
    await new Promise((r) => setTimeout(r, 400));
    expect(host.textContent).toContain('YTC042_2_r');
    expect(host.textContent).not.toContain('YTC041_2_r');
    dispose();
  });

  it("warns of EBI's speed for a large pick, with its time, and not for a small one", async () => {
    const ctx: EmpiarPanelContext = { api: { run: async () => ({ ok: true, did: '' }) } };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={area({ id: 12534, run: Run })} />, host);
    await until(() => /from EBI/.test(host.textContent ?? ''));
    button(host, 'Files').click();
    await tick();
    for (const f of [`${Run}_labels.mrc`, '80S_ribosome_CHX.star', 'co-translation_ribosome_CHX.star']) {
      option(f).click();
      await tick();
    }
    // the tomogram alone
    await until(() => /875 MB from EBI: about 1–2 h at its usual speed/.test(host.textContent ?? ''));
    option(`${Run}.mrc_9.98Apx.mrc`).click();
    await tick();
    option('co-translation_ribosome_CHX.star').click();
    // 493 KB: no warning
    await until(() => !/from EBI/.test(host.textContent ?? ''));
    expect(host.textContent).toContain('505 kB');
    dispose();
  });

  it("shows a download's progress, and Cancel stops it (night review B2)", async () => {
    const fetching = observableState<FetchProgress | undefined>(undefined);
    let signal: AbortSignal | undefined;
    const ctx: EmpiarPanelContext = {
      api: {
        run: (_, _values, options) =>
          new Promise((done) => {
            signal = options?.signal;
            const t0 = Date.now() - 10_000;
            fetching.set({
              name: 'particles 80S_ribosome_CHX.star',
              index: 0,
              count: 1,
              loaded: 2e6,
              total: 12e6,
              started: t0,
            });
            signal?.addEventListener('abort', () => {
              fetching.set(undefined);
              done({ ok: false, code: 'aborted', message: 'Stopped before it finished.' });
            });
          }),
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const fake = { ...area({ id: 12534, run: Run }), fetching: fetching.asReadonly };
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={fake} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => /^\s*Load/.test(b.textContent ?? ''));
    await until(() => !!load());
    load()!.click();
    await until(() => /2 of 12 MB, 0\.20 MB\/s, about 1 min left/.test(host.textContent ?? ''));
    expect(host.textContent).toContain('Reading particles 80S_ribosome_CHX.star');
    button(host, 'Cancel').click();
    await until(() => /Stopped before it finished/.test(host.textContent ?? ''));
    expect(signal?.aborted).toBe(true);
    expect(button(host, 'Cancel')).toBeUndefined();
    dispose();
  });

  // night review B4: busy, the result and "Load anyway?" lived in the form a pick remakes
  it("keeps a load in flight across a pick: Load stays busy, its result and its question are its pick's", async () => {
    let finish!: () => void;
    const calls: Record<string, unknown>[] = [];
    const ctx: EmpiarPanelContext = {
      api: {
        run: (_, values) => {
          calls.push(values);
          return new Promise(
            (done) =>
              (finish = () => done({ ok: false, code: 'confirm', message: `${values.run}: 1263 MB to read whole.` })),
          );
        },
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={area({ id: 12534, run: Run })} />, host);
    const load = () => Array.from(host.querySelectorAll('button')).find((b) => /^\s*Load/.test(b.textContent ?? ''));
    await until(() => !!load());
    load()!.click();
    await until(() => calls.length === 1);
    button(host, 'Run').click();
    await tick();
    option('YTC041_1_lam1_2_ts_002').click();
    await until(() => button(host, 'Run').textContent?.includes('YTC041_1_lam1_2_ts_002') === true);
    expect(load()!.disabled).toBe(true);
    finish();
    await until(() => !load()!.disabled);
    // the question was for the other run: this one is not asked about
    expect(host.textContent).not.toContain('1263 MB to read whole');
    expect(load()!.textContent).not.toContain('Load anyway');
    // back to its run: asked
    button(host, 'Run').click();
    await tick();
    option(Run).click();
    await until(() => /Load anyway/.test(load()!.textContent ?? ''));
    dispose();
  });

  // night review B7: an older read that ended cleared "reading" while a newer one was still walking
  it('stays reading until the latest read ends', async () => {
    const base = area({ id: 12534, run: Run });
    const later = (ms: number, grid: string): Promise<EmpiarGrid> =>
      new Promise((done) =>
        setTimeout(
          () =>
            done({ condition: 'data/EMPIAR_upload', name: grid, runs: [{ stem: `${grid}_r`, files: [] }], other: [] }),
          ms,
        ),
      );
    const slow: EmpiarPanelArea = {
      ...base,
      grid: async (id, root, grid) =>
        grid === 'YTC041_2' ? later(50, grid) : grid === 'YTC042_2' ? later(400, grid) : base.grid(id, root, grid),
    };
    const ctx: EmpiarPanelContext = { api: { run: async () => ({ ok: true, did: '' }) } };
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <EmpiarPanel ctx={ctx} area={slow} />, host);
    const readButton = () =>
      Array.from(host.querySelectorAll('button')).find((b) => /^\s*Read/.test(b.textContent ?? ''))!;
    await until(() => /YTC041_1_lam1_1_ts_003/.test(host.textContent ?? ''));
    button(host, 'Grid').click();
    await tick();
    option('YTC041_2').click();
    button(host, 'Grid').click();
    await tick();
    option('YTC042_2').click();
    await new Promise((r) => setTimeout(r, 200));
    expect(readButton().disabled).toBe(true);
    await until(() => /YTC042_2_r/.test(host.textContent ?? ''));
    expect(readButton().disabled).toBe(false);
    dispose();
  });
});
