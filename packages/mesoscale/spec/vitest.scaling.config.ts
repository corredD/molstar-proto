/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// `test:scaling`, the meso-spec resolvers' scaling guards (apps/prism-me/AGENTS.md, no accidental quadratic): the
// `*.scaling.ts` cases under `src/**/_test/`, each at n and 4n, time and allocation about linear, with a quadratic
// positive control (the shared harness, `@molstar/test-harness/scaling`). Opt in, at checkpoints; never in CI.
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { heapTests } from '@molstar/test-harness/vitest';

const root = join(import.meta.dirname, 'src');
const base = heapTests();
// biome-ignore lint/style/noDefaultExport: vitest reads the config's default export
export default defineConfig({
  ...base,
  root,
  test: { ...base.test, include: ['**/_test/**/*.scaling.ts'], testTimeout: 300_000 },
});
