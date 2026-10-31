/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The properties of the row picked are a chunk of their own (ui.tsx `loadProperties`; app.md §1: a static import of a
// lazy part puts it back in the start closure, which the budget counts). Read from the sources: the app's static
// imports from its page, `import type` left out (erased), dynamic imports left out (a chunk of their own).

const src = resolve(import.meta.dirname, '../..');
const staticImport = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

function startGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(staticImport)) {
      const js = resolve(dirname(file), m[1]);
      for (const ts of [js.replace(/\.js$/, '.ts'), js.replace(/\.js$/, '.tsx')]) {
        try {
          readFileSync(ts);
          stack.push(ts);
          break;
        } catch {}
      }
    }
  }
  return seen;
}

describe("the explorer's start", () => {
  it('imports its properties only when they are wanted', () => {
    const graph = startGraph(resolve(src, 'index.ts'));
    // the walk works: the panel itself is in it
    expect(graph.has(resolve(src, 'explorer/ui.tsx'))).toBe(true);
    for (const lazy of [
      'explorer/properties.tsx',
      'explorer/distance-properties.tsx',
      'explorer/properties-view.tsx',
    ]) {
      expect(graph.has(resolve(src, lazy)), lazy).toBe(false);
    }
    expect(readFileSync(resolve(src, 'explorer/ui.tsx'), 'utf8')).toContain("import('./properties.js')");
  });
});
