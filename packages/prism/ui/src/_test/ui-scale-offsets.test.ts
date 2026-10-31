/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepoRoot } from './extension-views.js';

// The UI scale (styling.md §6) over Prism's CSS, its extensions' and prism-me's (read by path, as data): a negative px
// offset that centres a box (a thumb, a grip, a hit area) scales with the box, or the box lands off its line at any
// scale but 100 %. A rule that sizes something by the scale and offsets it by a plain negative px is a finding; a line
// marked `ui-scale: fixed` is meant not to scale.

const Offset = /^\s*(top|right|bottom|left|inset|margin|margin-[a-z]+)\s*:([^;]*);/;
const Negative = /(?<![\w.(])-\d*\.?\d+px\b/;

function* cssFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_generated' || entry.name === 'node_modules' || entry.name === 'lib') continue;
      yield* cssFiles(full);
    } else if (entry.name.endsWith('.css')) yield full;
  }
}

/** `file:line: declaration` for each plain negative px offset in a rule that is sized by the UI scale. */
function unscaledOffsets(root: string): string[] {
  const found: string[] = [];
  for (const file of cssFiles(root)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    // Each rule's own lines (by brace depth; a nested rule's lines are its own).
    const stack: number[][] = [[]];
    const rules: number[][] = [];
    lines.forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, '');
      stack[stack.length - 1].push(i);
      for (const ch of code) {
        if (ch === '{') stack.push([]);
        else if (ch === '}') rules.push(stack.pop() ?? []);
      }
    });
    for (const rule of rules) {
      if (!rule.some((i) => lines[i].includes('--msp-ui-scale'))) continue;
      for (const i of rule) {
        const m = Offset.exec(lines[i].replace(/\/\*.*?\*\//g, ''));
        if (m && Negative.test(m[2]) && !lines[i].includes('ui-scale: fixed')) {
          found.push(`${path.relative(root, file).split(path.sep).join('/')}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
  }
  return found;
}

describe('negative offsets scale with their box (styling.md §6)', () => {
  it('in Prism, its extensions and prism-me: none left in px beside a scaled size', () => {
    const roots = [
      'packages/prism/ui/src',
      'packages/prism/viewer/src',
      'packages/prism/assistant/src',
      'packages/prism/stories/src',
      'packages/extensions',
      'apps/prism-me/src',
    ];
    expect(roots.flatMap((r) => unscaledOffsets(path.join(RepoRoot, r)))).toEqual([]);
  });

  it('catches one (positive control)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-scale-'));
    fs.writeFileSync(
      path.join(dir, 'a.module.css'),
      '.thumb {\n  width: calc(10px * var(--msp-ui-scale, 1));\n  margin-top: -4px;\n}\n',
    );
    expect(unscaledOffsets(dir)).toEqual(['a.module.css:3: margin-top: -4px;']);
    fs.rmSync(dir, { recursive: true });
  });
});
