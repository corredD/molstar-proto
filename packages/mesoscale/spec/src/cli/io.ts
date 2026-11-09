/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { MesoViewSpecDoc } from '../format/doc.js';
import type { Issue } from '../format/issues.js';
import { type DataCodec, DocumentCodec, IRCodec, printData, readData } from '../format/sexpr.js';

// The meso-* commands' shared parts (design.md §12.1): argument parsing, reading JSON or S-expression text, writing a
// product to stdout or a file, issues to stderr, and resources from files. Each command is `run(argv, io)`, so tests
// call it in-process with an in-memory `CliIO`; this is the only CLI file that touches `node:`.

export interface CliIO {
  readonly cwd: string;
  out(s: string): void;
  err(s: string): void;
  /** A file's text; `-` is stdin. */
  read(path: string): string;
  write(path: string, s: string): void;
}

export const nodeIO: CliIO = {
  cwd: process.cwd(),
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
  read: (p) => readFileSync(p === '-' ? 0 : p, 'utf8'),
  write: (p, s) => writeFileSync(p, s),
};

/** Exit code 1 (errors in the document) or 2 (usage, unreadable input) with a one-line message. */
export class CliError extends Error {
  constructor(
    readonly code: 1 | 2,
    message: string,
  ) {
    super(message);
  }
}

export interface CliSpec {
  readonly name: string;
  readonly usage: string;
  readonly positionals: number;
  /** Flags without a value (`--json`). */
  readonly flags?: readonly string[];
  /** Options with a value, repeatable (`--base d`). `-o` is always one. */
  readonly options?: readonly string[];
}

export interface CliArgs {
  readonly pos: readonly string[];
  flag(n: string): boolean;
  opt(n: string): string | undefined;
  opts(n: string): readonly string[];
}

function parseArgs(argv: readonly string[], spec: CliSpec): CliArgs {
  const flags = new Set(['--json', ...(spec.flags ?? [])]);
  const options = new Set(['-o', ...(spec.options ?? [])]);
  const pos: string[] = [];
  const on = new Set<string>();
  const values = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) on.add(a);
    else if (options.has(a)) {
      if (i + 1 >= argv.length) throw new CliError(2, `${a} needs a value`);
      values.set(a, [...(values.get(a) ?? []), argv[++i]]);
    } else if (a.startsWith('-') && a !== '-') throw new CliError(2, `unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length !== spec.positionals) throw new CliError(2, 'usage');
  return { pos, flag: (n) => on.has(n), opt: (n) => values.get(n)?.at(-1), opts: (n) => values.get(n) ?? [] };
}

/** Runs a command's body: a usage error or a thrown `CliError` is one line on stderr and its code. */
export async function command(
  argv: readonly string[],
  io: CliIO,
  spec: CliSpec,
  body: (a: CliArgs) => Promise<number> | number,
): Promise<number> {
  try {
    return await body(parseArgs(argv, spec));
  } catch (e) {
    const usage = e instanceof CliError && e.message === 'usage';
    io.err(`${spec.name}: ${usage ? `usage: ${spec.usage}` : e instanceof Error ? e.message : String(e)}\n`);
    return e instanceof CliError ? e.code : 2;
  }
}

/** JSON first, then the S-expression (a leading `[` is both). `head` is the S-expression's head, if it was one. */
export function readValue(io: CliIO, path: string): { value: unknown; head?: string } {
  let text: string;
  try {
    text = io.read(path);
  } catch (e) {
    throw new CliError(2, `cannot read ${path}: ${e instanceof Error ? e.message : e}`);
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    const head = /^\s*\(\s*([^\s()]+)/.exec(text)?.[1];
    const r = readData(text, head === 'meso_view_spec' ? DocumentCodec : IRCodec);
    if (r.error) throw new CliError(2, `${path}: neither JSON nor an S-expression (${r.error.message})`);
    return { value: r.value, head };
  }
}

export function readDoc(io: CliIO, path: string): MesoViewSpecDoc {
  const { value } = readValue(io, path);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CliError(2, `${path}: not a MesoViewSpec document`);
  return value as MesoViewSpecDoc;
}

/** The product: S-expression by default, JSON with `--json`; to `-o` or stdout. */
export function emit(io: CliIO, a: CliArgs, value: unknown, codec: DataCodec = DocumentCodec) {
  const text = a.flag('--json') ? `${JSON.stringify(value, null, 2)}\n` : `${printData(value, codec)}\n`;
  const file = a.opt('-o');
  if (file) io.write(file, text);
  else io.out(text);
}

/** One line per issue and a count, to stderr; 1 when there is an error. */
export function reportIssues(io: CliIO, where: string, issues: readonly Issue[]): 0 | 1 {
  for (const i of issues) io.err(`${where}#${i.path ?? ''}: ${i.severity} ${i.code}: ${i.message}\n`);
  const n = (s: string) => issues.filter((i) => i.severity === s).length;
  io.err(`${where}: ${n('error')} error(s), ${n('warning')} warning(s), ${n('info')} note(s)\n`);
  return n('error') ? 1 : 0;
}

/**
 * Resource content from files: a relative uri against each `--base`, then the document's directory, then the cwd;
 * `fixture://x` is `fixtures/x` there, `file://` a path; `.json` is parsed. Never the network.
 */
export function resourceLoader(io: CliIO, docPath: string, doc: MesoViewSpecDoc, bases: readonly string[]) {
  const dirs = [...bases, dirname(docPath), '.'].map((d) => resolve(io.cwd, d));
  return (id: string): unknown => {
    const uri = doc.resources?.find((r) => r.id === id)?.uri;
    if (!uri || /^https?:/.test(uri)) return undefined;
    const rel = uri.startsWith('fixture://')
      ? `fixtures/${uri.slice(10)}`
      : uri.startsWith('file://')
        ? fileURLToPath(uri)
        : uri;
    for (const d of isAbsolute(rel) ? [''] : dirs) {
      const file = resolve(d, rel);
      let text: string;
      try {
        text = io.read(file);
      } catch {
        continue;
      }
      if (!file.endsWith('.json')) return text;
      try {
        return JSON.parse(text);
      } catch {
        return undefined; // the runtime reports it as resource.unavailable, naming the resource
      }
    }
    return undefined;
  };
}

/** Runs `run` when this file is the entry point (also through a bin symlink); `exitCode`, so piped output is whole. */
export function runMain(url: string, run: (argv: readonly string[], io: CliIO) => Promise<number>) {
  if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === url)
    void run(process.argv.slice(2), nodeIO).then((code) => {
      process.exitCode = code;
    });
}
