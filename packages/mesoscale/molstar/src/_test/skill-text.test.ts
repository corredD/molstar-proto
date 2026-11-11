/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import { mesoQLSkill } from '@molstar/meso-spec/format';
import { describe, expect, it } from 'vitest';
import { MesoQLSkillText } from '../mesoql-skill-text.js';

// The MesoQL skill as plain data for the agent's catalog (prism.md §8): the stub imports no code, so it cannot call
// `mesoQLSkill()`; this module holds its text, generated, and kept equal to it as `_spec/reference/mesoql-skill.md` is.
// After a change to the symbol table: `pnpm test:unit packages/mesoscale -u`.

/** A string literal as the formatter writes it: single quotes, double ones when the text has a single quote only. */
function quote(line: string): string {
  const q = line.includes("'") && !line.includes('"') ? '"' : "'";
  return `${q}${line.replaceAll('\\', '\\\\').replaceAll(q, `\\${q}`)}${q}`;
}

/** The module's text, as the formatter lays it out. */
export function skillTextModule(): string {
  const lines = mesoQLSkill().split('\n');
  return [
    '/**',
    ' * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.',
    ' *',
    ' * @author Ludovic Autin <autin@scripps.edu>',
    ' */',
    '',
    "// Generated from the MesoQL symbol table by `_test/skill-text.test.ts` (`-u`): do not edit. The agent's skill text as",
    '// plain data, so the lazy stub (`prism-viewer.ts`) carries it without importing code.',
    '',
    'export const MesoQLSkillText: string = [',
    ...lines.map((l) => `  ${quote(l)},`),
    "].join('\\n');",
    '',
  ].join('\n');
}

describe('the MesoQL skill text in the stub', () => {
  it('is mesoQLSkill(), as generated', () => {
    expect(MesoQLSkillText).toBe(mesoQLSkill());
  });

  it('is the committed module (regenerate with -u)', async () => {
    await expect(skillTextModule()).toMatchFileSnapshot('../mesoql-skill-text.ts');
  });

  it('imports nothing', () => {
    const source = fs.readFileSync(new URL('../mesoql-skill-text.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\b|\bimport\(|\bfrom\s+'/m);
  });
});
