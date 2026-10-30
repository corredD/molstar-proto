/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The tracks' gutter sits over Seq*'s rows (22px, set inline by Seq*'s layout): it does not follow the UI scale
// (prism-ui styling.md §6), or its icons would grow past their rows. No scaled token, no scaled px; its icons pinned.

const css = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../track-gutter.module.css'),
  'utf8',
);

describe('the track gutter does not scale', () => {
  it('uses no scaled size', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/--msp-ui-scale/);
    expect(body).not.toMatch(/var\(--msp-(space|font-size|radius|icon|inset)/);
  });

  it('pins its icons at their size (an icon hands its size to CSS, which scales it)', () => {
    expect(css).toMatch(/\.icon svg \{\s*width: 16px;\s*height: 16px;/);
  });
});
