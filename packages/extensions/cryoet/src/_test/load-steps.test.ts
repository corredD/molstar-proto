/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { FetchAhead } from '../load-steps.js';

// FetchAhead (_spec/empiar.md §2) over a stubbed `fetch`: nothing reaches the network.

const Url = 'https://example.org/data/a.mrc';
const at = { name: 'tomogram a.mrc', index: 0, count: 1 };

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

async function ahead() {
  const v = await createPrismViewerHeadless({ spec: DefaultPrismViewerSpec() });
  viewers.push(v);
  return { v, ahead: new FetchAhead(v.plugin) };
}

describe('FetchAhead', () => {
  // review F3c: a fetch that found the file there took no hold, so the first load's release let it go under the second
  it('holds a file once a fetch, even one found there: it goes at the last release, a kept one stays', async () => {
    const stub = vi.fn(async () => new Response(new Uint8Array(8), { status: 200 }));
    vi.stubGlobal('fetch', stub);
    const { v, ahead: a } = await ahead();
    await a.fetch(Url, at);
    await a.fetch(Url, at);
    expect(stub).toHaveBeenCalledTimes(1);
    a.release(Url);
    expect(v.plugin.managers.asset.tryFindUrl(Url)).toBeDefined();
    a.release(Url);
    expect(v.plugin.managers.asset.tryFindUrl(Url)).toBeUndefined();
    await a.fetch(Url, at);
    a.release(Url, true);
    expect(v.plugin.managers.asset.tryFindUrl(Url)).toBeDefined();
  });
});
