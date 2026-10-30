/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The empty canvas's mark is centred by subtracting half its drawn size; the wordmark is drawn at its own size on the
// pixel grid (scaled, its lines blur). Both stay out of the UI scale (styling.md §6), or the mark sits off-centre.

const here = path.dirname(fileURLToPath(import.meta.url));
const rule = (file: string, selector: string) => {
  const css = fs.readFileSync(path.resolve(here, file), 'utf8');
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};

describe('the empty canvas mark', () => {
  it('is centred by its drawn size, and neither the offset nor the size follows the UI scale', () => {
    const mark = rule('../empty-canvas.module.css', '.mark');
    const wordmark = rule('../../../components/icon/wordmark.module.css', '.wordmark');
    expect(mark).not.toContain('--msp-ui-scale');
    expect(wordmark).not.toContain('--msp-ui-scale');
    // Half of 171 × 66 (the mark at 3×).
    expect(mark).toContain('85.5px');
    expect(mark).toContain('33px');
  });
});
