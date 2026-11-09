#!/usr/bin/env node
/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { indexDoc } from '../format/validate.js';
import { type QType, parseMesoQL, printMesoQL } from '../format/mesoql.js';
import { IRCodec } from '../format/sexpr.js';
import { placementSets } from '../ir/ir.js';
import { evaluateMesoQL, lociSize, lociToIds } from '../ir/loci.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';
import { CliError, type CliIO, command, emit, nodeIO, readDoc, reportIssues, resourceLoader, runMain } from './io.js';

// `meso-query <doc> <address|-> [--limit n] [--check] [--want type] [--base dir]... [--json] [-o file]`: checks a
// MesoQL address against the document and prints the copies it picks: the canonical address, the count, the count per
// population and the first ids (design.md §3.8, §12.1). A site or residues address (or `--check`) is only checked.
// Exit 1: the address has errors; 2: usage, unreadable input.

const Types: readonly string[] = ['selection', 'site', 'residues'];

export const run = (argv: readonly string[], io: CliIO = nodeIO) =>
  command(
    argv,
    io,
    {
      name: 'meso-query',
      usage: 'meso-query <doc> <address|-> [--limit n] [--check] [--want selection|site|residues] [--base dir]...',
      positionals: 2,
      flags: ['--check'],
      options: ['--base', '--limit', '--want'],
    },
    async (a) => {
      const doc = readDoc(io, a.pos[0]);
      const text = (a.pos[1] === '-' ? io.read('-') : a.pos[1]).trim();
      const want = a.opt('--want');
      if (want && !Types.includes(want)) throw new CliError(2, `--want is one of ${Types.join(', ')}`);
      const limit = Number(a.opt('--limit') ?? 20);
      if (!Number.isInteger(limit) || limit < 0) throw new CliError(2, '--limit is a non-negative integer');
      const sites = new Map<string, readonly string[]>();
      for (const e of [...(doc.entities ?? []), ...(doc.superstructures ?? []).flatMap((s) => s.entities ?? [])])
        if (e && !sites.has(e.id))
          sites.set(
            e.id,
            (e.sites ?? []).map((s) => s.id),
          );
      const { expr, issues } = parseMesoQL(
        text,
        { kinds: indexDoc(doc).kinds, sites },
        'query',
        want as QType | undefined,
      );
      if (!expr) return reportIssues(io, 'query', issues);
      const address = printMesoQL(expr);
      const type = expr.symbol.returns;
      if (type !== 'selection' || a.flag('--check')) {
        emit(io, a, { address, type }, IRCodec);
        return reportIssues(io, 'query', issues);
      }
      const r = await compile(doc, {
        resolvers: DefaultResolvers,
        load: resourceLoader(io, a.pos[0], doc, a.opts('--base')),
      });
      if (!r.ir) return reportIssues(io, a.pos[0], r.issues);
      const { loci, issues: found } = evaluateMesoQL(expr, { doc, ir: r.ir });
      const byKey = new Map(placementSets(r.ir).map((s) => [s.key, s]));
      const populations: Record<string, number> = {};
      for (const [key, runs] of loci) {
        const set = byKey.get(/^.*@\d+>(.*)$/.exec(key)?.[1] ?? key);
        if (!set) continue;
        for (let j = 0; j < runs.length; j += 2)
          for (let i = runs[j]; i < runs[j + 1]; i++) {
            const p = set.typeTable[set.types[i]].population;
            populations[p] = (populations[p] ?? 0) + 1;
          }
      }
      emit(io, a, { address, type, copies: lociSize(loci), populations, ids: lociToIds(loci, r.ir, limit) }, IRCodec);
      return reportIssues(io, 'query', [...issues, ...r.issues, ...found]);
    },
  );

runMain(import.meta.url, run);
