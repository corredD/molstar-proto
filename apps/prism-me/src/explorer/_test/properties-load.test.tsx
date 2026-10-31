/** @vitest-environment jsdom */

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
import { explorerUI, loadProperties } from '../ui.js';

// The properties' chunk (ui.tsx `loadProperties`, _spec/ui.md §4) as Prism's lazy parts are: said while it loads, and
// when it fails, with Retry (packages/prism/viewer/src/ui/extensions.tsx); over a headless viewer with 1CRN.

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

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const file = new File(
    [readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))],
    '1crn.cif',
  );
  const l = await v.api.load.files({ files: [file] });
  if (!l.ok) throw new Error(l.message);
  return v;
}

function mount(v: PrismViewer, load: typeof loadProperties) {
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers }, load);
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const rowOf = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'))
    .find((r) => r.querySelector('[data-tip-overflow]')?.textContent === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
const says = (host: HTMLElement, text: string) => !!host.textContent?.includes(text);
const retry = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Retry');

describe("the properties' chunk", () => {
  it('says it loads, says it failed with Retry, and Retry loads it (one import at a time)', async () => {
    const v = await viewer();
    let calls = 0;
    let settle: { ok: () => void; fail: () => void } | undefined;
    const load: typeof loadProperties = () => {
      calls++;
      return new Promise((ok, fail) => {
        settle = { ok: () => void loadProperties().then(ok), fail: () => fail(new Error('offline')) };
      });
    };
    const host = mount(v, load);
    await until(() => !!rowOf(host, '1CRN'));
    rowOf(host, '1CRN')!.click();
    await until(() => says(host, 'Loading'));
    // the scene's changes and the pick while it loads ask for no second import
    expect(calls).toBe(1);

    settle!.fail();
    await until(() => says(host, 'could not be loaded') && !!retry(host));
    retry(host)!.click();
    await until(() => says(host, 'Loading'));
    expect(calls).toBe(2);
    settle!.ok();
    await until(() => !!host.querySelector('[data-section]'));
    expect(says(host, 'could not be loaded')).toBe(false);
  });
});
