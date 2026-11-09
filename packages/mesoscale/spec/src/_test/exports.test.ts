/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The contract check, as Seq*'s scripts/exports.ts has it (contractGaps): every type a public signature names (an
// exported interface's, type's or class's public members, a function's parameters and result) is exported by some
// entry of the two packages, so a host can name it. Walked with the TypeScript checker, which takes a while: heavy.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = ['spec', 'molstar'];

interface Entry {
  readonly pkg: string;
  readonly subpath: string;
  readonly file: string;
}

/** Every `.ts` entry of both packages (`molstar-src` of each `exports` value; a null target hides a subpath). */
export function entries(): Entry[] {
  return PACKAGES.flatMap((pkg) => {
    const map = JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8')).exports as Record<
      string,
      string | Record<string, string> | null
    >;
    return Object.entries(map).flatMap(([subpath, value]) => {
      const target = typeof value === 'string' ? value : value?.['molstar-src'];
      return target?.endsWith('.ts') ? [{ pkg, subpath, file: join(ROOT, pkg, target) }] : [];
    });
  });
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  customConditions: ['molstar-src'],
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** Per export of each entry, the package's types its declaration's signature names that no entry exports. */
export function contractGaps(list: readonly Entry[]): string[] {
  const program = ts.createProgram(
    list.map((e) => e.file),
    OPTIONS,
  );
  const checker = program.getTypeChecker();
  const resolve = (s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const shown = new Set<ts.Symbol>();
  const by: [string, ts.Symbol[]][] = [];
  for (const e of list) {
    const file = program.getSourceFile(e.file);
    const module = file && checker.getSymbolAtLocation(file);
    if (!module) continue;
    const names = checker.getExportsOfModule(module);
    for (const s of names) shown.add(resolve(s));
    by.push([`@molstar/meso-${e.pkg}${e.subpath.slice(1)}`, names]);
  }
  const hidden = (n: ts.Node) =>
    ((ts.isPropertyDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n)) &&
      (ts.isPrivateIdentifier(n.name) ||
        n.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
        ))) ||
    ts.isBlock(n) ||
    (ts.isPropertyDeclaration(n) && !!n.initializer && !n.type);
  const out = new Set<string>();
  for (const [entry, names] of by)
    for (const s of names)
      for (const d of resolve(s).declarations ?? []) {
        const visit = (n: ts.Node) => {
          if (hidden(n)) return;
          if (ts.isTypeReferenceNode(n) || ts.isExpressionWithTypeArguments(n)) {
            const id = ts.isTypeReferenceNode(n) ? n.typeName : n.expression;
            const left = ts.isQualifiedName(id) ? checker.getSymbolAtLocation(id.left) : undefined;
            const sym = checker.getSymbolAtLocation(ts.isQualifiedName(id) ? id.right : id);
            const t = sym && resolve(sym);
            const file = t?.declarations?.[0]?.getSourceFile().fileName ?? '';
            if (
              t &&
              !(left && shown.has(resolve(left))) &&
              file.startsWith(ROOT) &&
              !file.includes('/_test/') &&
              !shown.has(t) &&
              !(t.flags & ts.SymbolFlags.TypeParameter)
            )
              out.add(`${entry}: ${s.name} mentions ${t.name} (${relative(ROOT, file)})`);
          }
          ts.forEachChild(n, visit);
        };
        // A variable: its type annotation only; a function: its signature, not its body.
        if (ts.isVariableDeclaration(d)) {
          if (d.type) visit(d.type);
        } else if (ts.isFunctionDeclaration(d)) {
          for (const p of d.parameters) visit(p);
          if (d.type) visit(d.type);
          for (const p of d.typeParameters ?? []) visit(p);
        } else visit(d);
      }
  return [...out];
}

describe("the packages' contract", { tags: ['heavy'] }, () => {
  it('every type a public signature names is exported by some entry', () => {
    const list = entries();
    expect(list.length).toBeGreaterThan(6);
    expect(list.filter((e) => !existsSync(e.file))).toEqual([]);
    expect(contractGaps(list)).toEqual([]);
  });
});
