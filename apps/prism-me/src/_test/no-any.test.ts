/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The app is only a spec (_spec/architecture.md §7.5): what edits the scene's params is an extension's operation,
// typed there, so the app's own code (not its tests or stories) has no `any`. In the code, not its comments or
// strings ("picks a row as any other"); a template literal is skipped whole, its `${…}` too.

const src = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name !== '_test' && e.name !== '_stories') sources(join(dir, e.name), out);
    } else if (/\.tsx?$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

/** The text with its comments and strings blanked (newlines kept, so lines keep their numbers) */
export function codeOf(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  const blank = (to: number) => {
    for (; i < to; i++) out += text[i] === '\n' ? '\n' : ' ';
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      blank(end < 0 ? n : end);
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      blank(end < 0 ? n : end + 2);
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      // a quote ends at its line (an apostrophe in JSX text opens none past it)
      while (j < n && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      blank(Math.min(n, j + 1));
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function anys(file: string): string[] {
  return codeOf(readFileSync(file, 'utf8'))
    .split('\n')
    .flatMap((line, i) => (/\bany\b/.test(line) ? [`${relative(src, file)}:${i + 1}`] : []));
}

describe('the app', () => {
  it('reads code, not comments or strings', () => {
    expect(codeOf("const a = x as any; // as any other\nconst b = 'as any';").split('\n')).toEqual([
      'const a = x as any;                ',
      'const b =         ;',
    ]);
  });

  it('has no `any` in its own code', () => {
    expect(sources(src).flatMap(anys)).toEqual([]);
  });
});
