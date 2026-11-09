/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// `test:perf`, the quick allocation tier of the mesoscale extension's hot paths (`*.quick.ts` under any `_test/` of
// src/, against `src/_test/perf-baseline.json`): Seq*'s tier (`perfTests`, packages/sequences/vitest.shared.ts and its
// AGENTS.md, Tests), rooted at src/. Opt in, never in CI.
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { perfTests } from '../../sequences/vitest.shared.js';

const root = join(import.meta.dirname, 'src');
const base = perfTests(root);
export default defineConfig({ ...base, root, test: { ...base.test, include: ['**/_test/**/*.quick.ts'] } });
