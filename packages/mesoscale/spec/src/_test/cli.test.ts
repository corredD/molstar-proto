/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run as compileCmd } from '../cli/meso-compile.js';
import { run as printCmd } from '../cli/meso-print.js';
import { run as queryCmd } from '../cli/meso-query.js';
import { run as traceCmd } from '../cli/meso-trace.js';
import { run as validateCmd } from '../cli/meso-validate.js';
import type { CliIO } from '../cli/io.js';
import { readData, DocumentCodec, IRCodec } from '../format/sexpr.js';

// The meso-* commands (design.md §12.1), in-process: each `run(argv, io)` on the β-cell with captured output.

const root = fileURLToPath(new URL('../../../', import.meta.url)); // packages/mesoscale
const BETA = 'examples/betacell.mesoviewspec.json';
const BASE = ['--base', 'spec/src'];

function memory(files: Record<string, string> = {}, stdin = '') {
  const o = { out: '', err: '' };
  const io: CliIO = {
    cwd: root,
    out: (s) => void (o.out += s),
    err: (s) => void (o.err += s),
    read: (p) => (p === '-' ? stdin : (files[p] ?? readFileSync(new URL(p, `file://${root}`), 'utf8'))),
    write: (p, s) => void (files[p] = s),
  };
  return { io, o, files };
}

describe('meso-validate', () => {
  it('a clean document exits 0; its notes read back as the JSON list', async () => {
    const { io, o } = memory();
    expect(await validateCmd([BETA], io)).toBe(0);
    const j = memory();
    await validateCmd([BETA, '--json'], j.io);
    expect(readData(o.out, IRCodec).value).toEqual(JSON.parse(j.o.out));
    expect(o.err).toContain('0 error(s)');
  });

  it('a bad address exits 1 with its issue at the document path, one line each', async () => {
    const doc = JSON.parse(readFileSync(`${root}${BETA}`, 'utf8'));
    doc.views[0].looks[0].select = '(population p.nope)';
    const { io, o } = memory({ 'bad.json': JSON.stringify(doc) });
    expect(await validateCmd(['bad.json', '--json'], io)).toBe(1);
    expect(o.err).toMatch(
      /^bad\.json#\/views\/0\/looks\/0\/select: error mesoql\.ref\.missing: p\.nope names nothing/m,
    );
    expect(JSON.parse(o.out).map((i: { code: string }) => i.code)).toContain('mesoql.ref.missing');
  });

  it('usage and unreadable input exit 2', async () => {
    expect(await validateCmd([], memory().io)).toBe(2);
    expect(await validateCmd(['nope.json'], memory().io)).toBe(2);
    expect(await validateCmd([BETA, '--frob'], memory().io)).toBe(2);
    expect(await validateCmd(['junk.txt'], memory({ 'junk.txt': ')(' }).io)).toBe(2);
  });
});

describe('meso-print', () => {
  it('JSON to the S-expression and back is the identity', async () => {
    const json = JSON.parse(readFileSync(`${root}${BETA}`, 'utf8'));
    const s = memory();
    expect(await printCmd([BETA], s.io)).toBe(0);
    expect(s.o.out.startsWith('(meso_view_spec')).toBe(true);
    expect(readData(s.o.out, DocumentCodec).value).toEqual(json);
    const back = memory({ 'doc.sexpr': s.o.out });
    expect(await printCmd(['doc.sexpr', '--json'], back.io)).toBe(0);
    expect(JSON.parse(back.o.out)).toEqual(json);
  });

  it('writes to -o instead of stdout', async () => {
    const { io, o, files } = memory();
    expect(await printCmd([BETA, '-o', 'out.sexpr'], io)).toBe(0);
    expect(o.out).toBe('');
    expect(files['out.sexpr']).toContain('(meso_view_spec');
  });
});

describe('meso-trace', () => {
  it('prints the trace as a tree, equal in both spellings; an unknown id exits 1', async () => {
    const s = memory();
    expect(await traceCmd([BETA, 'p.granules'], s.io)).toBe(0);
    const j = memory();
    expect(await traceCmd([BETA, 'p.granules', '--json'], j.io)).toBe(0);
    expect(readData(s.o.out, IRCodec).value).toEqual(JSON.parse(j.o.out));
    expect(await traceCmd([BETA, 'p.nope'], memory().io)).toBe(1);
  });
});

describe('meso-compile', () => {
  it('makes examples/betacell.ir.json', async () => {
    const { io, o } = memory();
    expect(await compileCmd([BETA, ...BASE, '--json'], io)).toBe(0);
    expect(JSON.parse(o.out)).toEqual(JSON.parse(readFileSync(`${root}examples/betacell.ir.json`, 'utf8')));
    expect(o.err).toMatch(/copies, \d+ resolver run/);
  });
});

describe('meso-query', () => {
  it('counts the copies an address picks, per population, with the first ids', async () => {
    const { io, o } = memory();
    expect(await queryCmd([BETA, '(part (copies p.granules 12) p.Vamp2)', ...BASE, '--json', '--limit', '3'], io)).toBe(
      0,
    );
    const r = JSON.parse(o.out);
    expect(r.address).toBe('(part (copies p.granules 12) p.Vamp2)');
    expect(r.copies).toBeGreaterThan(0);
    expect(r.populations['p.Vamp2']).toBe(r.copies);
    expect(r.ids).toHaveLength(3);
    expect(r.ids[0]).toMatch(/^p\.granules#12\/p\.Vamp2#\d+$/);
  });

  it('reads the address from stdin, as an S-expression result', async () => {
    const { io, o } = memory({}, '(population p.ribosomes)\n');
    expect(await queryCmd([BETA, '-', ...BASE, '--limit', '0'], io)).toBe(0);
    const v = readData(o.out, IRCodec).value as { copies: number };
    expect(v.copies).toBeGreaterThan(0);
  });

  it('an address with errors exits 1 and says where; --check stops there', async () => {
    const bad = memory();
    expect(await queryCmd([BETA, '(population p.nope)'], bad.io)).toBe(1);
    expect(bad.o.err).toContain('query#query: error mesoql.ref.missing');
    expect(bad.o.out).toBe('');
    const chk = memory();
    expect(await queryCmd([BETA, '(entity e.Vamp2)', '--check', '--json'], chk.io)).toBe(0);
    expect(JSON.parse(chk.o.out)).toEqual({ address: '(entity e.Vamp2)', type: 'selection' });
  });

  it('a site address is checked, not evaluated', async () => {
    const { io, o } = memory();
    const code = await queryCmd([BETA, '(site e.Vamp2 nope)', '--json'], io);
    expect(code).toBe(1);
    expect(o.err).toContain('mesoql.site');
  });
});
