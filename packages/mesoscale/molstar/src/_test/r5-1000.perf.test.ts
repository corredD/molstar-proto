/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */
// @module-tag heavy

import { describe, it } from 'vitest';
import { defineR5 } from './r5-cases.js';

// The 1,000-list case peaks near 6 GB resident: on a shared 16 GB machine (parallel lanes, dev servers) the heavy lane's
// worker is killed. Opt-in, as Seq*'s heap tiers are: `MESO_R5_1000=1 pnpm exec vitest run --mode heavy <this file>`.
if (process.env.MESO_R5_1000 === '1') defineR5([1000]);
else describe('R5: 1,000 lists (opt-in: MESO_R5_1000=1)', () => it.skip('skipped without MESO_R5_1000=1', () => {}));
