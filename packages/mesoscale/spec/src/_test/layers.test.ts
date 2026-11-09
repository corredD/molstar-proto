/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The package's folder graph (design.md §12.2), as Seq*'s core/_test/layers.test.ts has it: what each folder of src/ may
// import of the others. Inside a folder imports are relative; across folders they name the entry
// (`@molstar/meso-spec/format`), never a path into another folder. The package imports nothing of Mol*; Node's
// built-ins only in the CLIs. The tests in _test/ reach internals by path and are not checked here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(PACKAGE, 'src');
/** `file`'s path in `SRC`, with `/` on every platform */
const inSrc = (file: string) => relative(SRC, file).split(sep).join('/');

/** Each folder and the folders it may import (`examples` holds its `fixtures/`). */
const ALLOWED: Record<string, string[]> = {
  format: [],
  ir: ['format'],
  builder: ['format'],
  runtime: ['format', 'ir'],
  resolvers: ['format', 'ir', 'runtime'],
  examples: ['builder', 'format', 'runtime', 'resolvers'],
  cli: ['format', 'ir', 'runtime', 'resolvers'],
};
const NODE_ALLOWED = ['cli'];
const SELF = '@molstar/meso-spec/';
const folderOf = (path: string) => Object.keys(ALLOWED).find((f) => path === f || path.startsWith(`${f}/`));

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) {
      if (name !== '_test') files(f, out);
    } else if (/\.tsx?$/.test(name)) out.push(f);
  }
  return out;
}

/** Static imports and re-exports (up to their `from`), bare imports, and dynamic imports. */
const SPECIFIER =
  /^(?:import|export)\s[^;]*?[\s}*]from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/gm;

/** The imports of `source` that leave their folder or break the graph, as messages. */
export function violations(at: string, source: string, resolveRelative: (spec: string) => string): string[] {
  const own = folderOf(at) as string;
  const wrong: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.')) {
      const target = folderOf(resolveRelative(spec));
      if (target !== own) wrong.push(`${at}: ${spec} leaves ${own}/ (name the entry instead)`);
    } else if (spec.startsWith(SELF)) {
      const target = spec.slice(SELF.length);
      if (target === own) wrong.push(`${at}: ${spec} is its own folder (import it relatively)`);
      else if (!ALLOWED[target] || !ALLOWED[own].includes(target))
        wrong.push(`${at}: ${spec} is not ${own}'s to import`);
    } else if (spec.startsWith('node:')) {
      if (!NODE_ALLOWED.includes(own))
        wrong.push(`${at}: ${spec} (only ${NODE_ALLOWED.join(', ')} import Node's built-ins)`);
    } else wrong.push(`${at}: ${spec} (the package imports its own entries and Node's built-ins in the CLIs only)`);
  }
  return wrong;
}

/** Whether `source` re-exports a module wholesale: `export * from`, `export type * from`, `export * as ns from`. */
export const exportsStar = (source: string) => /^export (?:type )?\*(?: as \w+)? from/m.test(source);

describe("the package's folders", () => {
  const all = files(SRC);

  it('every file sits in a known folder', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.map(inSrc).filter((f) => !folderOf(f))).toEqual([]);
  });

  it('import only what their folder may', () => {
    const wrong = all.flatMap((file) =>
      violations(inSrc(file), readFileSync(file, 'utf8'), (spec) => inSrc(resolve(dirname(file), spec))),
    );
    expect(wrong).toEqual([]);
  });

  it('the check fails when a folder imports what it may not', () => {
    const at = (spec: string, from: string) =>
      violations(from, `import { x } from '${spec}';`, (s) => posix.join(posix.dirname(from), s));
    expect(at('@molstar/meso-spec/runtime', 'format/doc.ts')).toHaveLength(1);
    expect(at('@molstar/meso-spec/format', 'ir/ir.ts')).toEqual([]);
    expect(at('../runtime/runtime.js', 'format/doc.ts')).toHaveLength(1);
    expect(at('./units.js', 'format/doc.ts')).toEqual([]);
    expect(at('./fixtures/synthetic.js', 'examples/exosome.ts')).toEqual([]);
    expect(at('@molstar/meso-spec/format', 'format/doc.ts')).toHaveLength(1);
    expect(at('@molstar/core/util', 'ir/ir.ts')).toHaveLength(1);
    expect(at('node:fs', 'runtime/runtime.ts')).toHaveLength(1);
    expect(at('node:fs', 'cli/io.ts')).toEqual([]);
    expect(at('@molstar/meso-spec/cli', 'examples/yeast.ts')).toHaveLength(1);
    expect(at('@molstar/meso-spec/format', 'builder/ids.ts')).toEqual([]);
    expect(at('@molstar/meso-spec/runtime', 'builder/ids.ts')).toHaveLength(1);
  });

  it('the no-star check sees every wholesale re-export', () => {
    expect(exportsStar("export * from './a.js';")).toBe(true);
    expect(exportsStar("export type * from './a.js';")).toBe(true);
    expect(exportsStar("export * as ns from './a.js';")).toBe(true);
    expect(exportsStar("export { a, type B } from './a.js';")).toBe(false);
    expect(exportsStar("export type { B } from './a.js';")).toBe(false);
  });

  it('each entry names what it exports (no `export *`): a name exported is API a host may use', () => {
    const entries = ['spec', 'molstar'].flatMap((pkg) => {
      const json = join(PACKAGE, '..', pkg, 'package.json');
      const map = JSON.parse(readFileSync(json, 'utf8')).exports as Record<string, { 'molstar-src': string } | null>;
      return Object.values(map)
        .map((t) => t?.['molstar-src'])
        .filter((t): t is string => typeof t === 'string' && t.endsWith('.ts'))
        .map((t) => join(PACKAGE, '..', pkg, t));
    });
    expect(entries.length).toBeGreaterThan(6);
    expect(entries.filter((f) => exportsStar(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('the package exports its seven entries and nothing deeper', () => {
    const map = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')).exports as Record<string, unknown>;
    expect(Object.keys(map).sort()).toEqual(['./_test/*', ...Object.keys(ALLOWED).map((f) => `./${f}`)].sort());
  });
});
