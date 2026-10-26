/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChimeraxCommands } from '../chimerax/commands.js';

// Every example of the ChimeraX table is a line ChimeraX itself takes (1CBS open as #1, 1TQN as #2), as recorded by
// chimerax-oracle.py (no ChimeraX here). `UPDATE_SPEC=1` writes the lines when the examples change; the recorder fills
// in what ChimeraX said. ChimeraX without a window cannot draw: the lines that need it are listed.

const file = new URL('./chimerax-oracle.json', import.meta.url);

/**
 * Lines ChimeraX reads but refuses there: without a window (it draws them in one), or with nothing to undo (the
 * recorder runs each line in a fresh session). Their message there.
 */
const NeedsWindow: Record<string, string> = {
  undo: 'Undo',
  redo: 'redo',
  'save image.png': 'OpenGL',
  'save figure.png width 1200 height 900 transparentBackground true': 'OpenGL',
  'camera ortho': 'opengl_context',
  'camera mono': 'opengl_context',
};

const lines = ChimeraxCommands.flatMap((c) => c.examples);

describe('the ChimeraX table’s examples, as ChimeraX reads them', () => {
  const fixture = JSON.parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"lines":[]}') as {
    lines: string[];
    results?: Record<string, string>;
  };

  it('records every example', () => {
    if (process.env.UPDATE_SPEC && JSON.stringify(fixture.lines) !== JSON.stringify(lines)) {
      fs.writeFileSync(
        file,
        `${JSON.stringify({ about: 'Written by chimerax-oracle.test.ts (lines) and chimerax-oracle.py (results).', lines, results: fixture.results ?? {} }, null, 2)}\n`,
      );
      return;
    }
    expect(fixture.lines).toEqual(lines);
  });

  for (const line of lines) {
    it(line, () => {
      const said = fixture.results?.[line];
      if (NeedsWindow[line]) expect(said).toContain(NeedsWindow[line]);
      else expect(said).toBe('ok');
    });
  }
});
