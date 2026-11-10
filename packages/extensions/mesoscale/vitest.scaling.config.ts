/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// `test:scaling`, the mesoscale extension's bulk paths' scaling guards (packages/prism/AGENTS.md: bulk operations are
// one change): the `*.scaling.ts` cases under any `_test/` of `src/`, each at n and 4n, time and allocation about
// linear, with a quadratic positive control (the shared harness, `@molstar/test-harness/scaling`). The heap
// tier's process (one thread, `--expose-gc`). Opt in, at checkpoints; never in CI.
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { heapTests } from '@molstar/test-harness/vitest';

const root = join(import.meta.dirname, 'src');
const base = heapTests();
export default defineConfig({
  ...base,
  root,
  test: { ...base.test, include: ['**/_test/**/*.scaling.ts'], testTimeout: 300_000 },
});
