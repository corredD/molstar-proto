/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { resolve } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';

// The properties of the row picked are a chunk of their own (ui.tsx `loadProperties`; app.md §1: a static import of a
// lazy part puts it back in the start closure, which the budget counts). The graph is esbuild's, as the app's build
// makes it (type-only imports erased, `molstar-src` sources), over the app and the three extensions it brings; the
// other packages are left external (nothing of theirs imports the app), so the build reads a few dozen files.

const root = resolve(import.meta.dirname, '../../../../..');
const Followed = /^@molstar\/(prism-me-app|cryoet-extension|mesoscale-extension|stage-tools-extension)\//;

async function appGraph(): Promise<Metafile> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['apps/prism-me/src/index.ts'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    splitting: true,
    outdir: 'out',
    logLevel: 'silent',
    conditions: ['molstar-src', 'import', 'default'],
    plugins: [
      {
        name: 'app-only',
        setup(b) {
          // other packages, and assets (the page, the icon): not followed
          b.onResolve({ filter: /^@molstar\// }, (a) => (Followed.test(a.path) ? undefined : { external: true }));
          b.onResolve({ filter: /^[^.@/]/ }, () => ({ external: true }));
          b.onResolve({ filter: /\.(html|ico|png|svg)$/ }, () => ({ external: true }));
        },
      },
    ],
  });
  return result.metafile;
}

/** The inputs the entry reaches by static imports */
function startInputs(meta: Metafile, entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !meta.inputs[file]) continue;
    seen.add(file);
    for (const i of meta.inputs[file].imports) if (i.kind === 'import-statement' && !i.external) stack.push(i.path);
  }
  return seen;
}

describe("the explorer's start", () => {
  it('imports its properties only when they are wanted', async () => {
    const meta = await appGraph();
    const start = startInputs(meta, 'apps/prism-me/src/index.ts');
    // the walk works: the panel and the extensions' operations are in it
    expect(start.has('apps/prism-me/src/explorer/ui.tsx')).toBe(true);
    expect(start.has('packages/extensions/cryoet/src/operations.ts')).toBe(true);
    for (const lazy of [
      'apps/prism-me/src/explorer/properties.tsx',
      'apps/prism-me/src/explorer/distance-properties.tsx',
      'apps/prism-me/src/explorer/properties-view.tsx',
      'packages/extensions/cryoet/src/controls.tsx',
      'packages/extensions/mesoscale/src/controls.tsx',
    ]) {
      expect(start.has(lazy), lazy).toBe(false);
      // and the app does load it, later
      expect(meta.inputs[lazy], lazy).toBeDefined();
    }
    const ui = meta.inputs['apps/prism-me/src/explorer/ui.tsx'].imports;
    expect(ui.some((i) => i.kind === 'dynamic-import' && i.path === 'apps/prism-me/src/explorer/properties.tsx')).toBe(
      true,
    );
  });
});
