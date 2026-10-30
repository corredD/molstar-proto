/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { tokenBasePx } from '../sequence-control.js';

// Seq*'s letters take the host's font size token at 100 %: the band does not follow the UI scale (prism-ui
// styling.md §6), and the token is a calc() of its 100 % size, which a parseFloat read as NaN.

describe('the font size token, unscaled', () => {
  it('reads the 100 % size of the token as theme.css writes it, and as a browser computes it', () => {
    // theme.css's `--msp-font-size-sm` (its form is held by prism-ui's ui-scale-tokens.test.ts).
    expect(tokenBasePx('calc(12px * var(--msp-ui-scale, 1))')).toBe(12);
    // The variable substituted (a browser's computed custom property).
    expect(tokenBasePx('calc(12px * 1.5)')).toBe(12);
    expect(tokenBasePx('12px')).toBe(12);
    expect(tokenBasePx('')).toBeUndefined();
  });
});
