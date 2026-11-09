#!/usr/bin/env node
/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { irToJson } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { compile } from '@molstar/meso-spec/runtime';
import { IRCodec } from '@molstar/meso-spec/format';
import { type CliIO, command, emit, nodeIO, readDoc, reportIssues, resourceLoader, runMain } from './io.js';

// `meso-compile <doc> [--base dir]... [--json] [-o file]`: the IR summary the runtime makes of the document, the
// shape of examples/*.ir.json (design.md §12.1). Resources are read from files (see `resourceLoader`). Timings go to
// stderr only, so the product is deterministic. Exit 1: errors (the product is still written).

export const run = (argv: readonly string[], io: CliIO = nodeIO) =>
  command(
    argv,
    io,
    {
      name: 'meso-compile',
      usage: 'meso-compile <doc> [--base dir]... [--json] [-o file]',
      positionals: 1,
      options: ['--base'],
    },
    async (a) => {
      const doc = readDoc(io, a.pos[0]);
      const r = await compile(doc, {
        resolvers: DefaultResolvers,
        load: resourceLoader(io, a.pos[0], doc, a.opts('--base')),
      });
      emit(io, a, r.ir ? irToJson(r.ir, r.issues) : { issues: r.issues }, IRCodec);
      const copies = Object.values(r.counts).reduce((n, c) => n + c.achieved, 0);
      io.err(`meso-compile: ${copies} copies, ${r.stats.resolverRuns} resolver run(s)\n`);
      return reportIssues(io, a.pos[0], r.issues);
    },
  );

runMain(import.meta.url, run);
