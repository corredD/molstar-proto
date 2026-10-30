/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The UI scale (styling.md §6) is carried by the size tokens: each is its 100 % size times `--msp-ui-scale`, so a
// view that sizes by tokens grows with it and nothing else is written. A list row is a whole number of pixels at
// every scale (a virtual list places rows by index × the measured height: a fraction would drift).

const here = path.dirname(fileURLToPath(import.meta.url));
const theme = fs.readFileSync(path.resolve(here, '../theme.css'), 'utf8');

const Scaled = [
  '--msp-font-size-xs',
  '--msp-font-size-sm',
  '--msp-font-size-md',
  '--msp-font-size-lg',
  '--msp-row-height',
  '--msp-control-height',
  '--msp-label-width',
  '--msp-space-1',
  '--msp-space-2',
  '--msp-space-3',
  '--msp-space-4',
  '--msp-space-5',
  '--msp-space-6',
  '--msp-icon-sm',
  '--msp-icon-md',
  '--msp-radius-md',
  '--msp-radius-lg',
];

function token(name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(theme)?.[1].trim();
}

describe('the size tokens follow the UI scale', () => {
  it.each(Scaled)('%s is its size times --msp-ui-scale', (name) => {
    expect(token(name)).toMatch(/^calc\(\d+(\.\d+)?px \* var\(--msp-ui-scale, 1\)\)$/);
  });

  it('a list row is rounded to whole pixels', () => {
    expect(token('--msp-list-row')).toBe('round(calc(26px * var(--msp-ui-scale, 1)), 1px)');
  });
});
