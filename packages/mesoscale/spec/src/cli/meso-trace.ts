#!/usr/bin/env node
/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { IRCodec, trace, traceToSexprData } from '@molstar/meso-spec/format';
import { type CliIO, command, emit, nodeIO, readDoc, runMain } from './io.js';

// `meso-trace <doc> <id> [--json] [-o file]`: the provenance trace of a node (design.md §3.5) as a tree. Exit 1 when
// the id leads nowhere, 2 for usage and unreadable input.

export const run = (argv: readonly string[], io: CliIO = nodeIO) =>
  command(argv, io, { name: 'meso-trace', usage: 'meso-trace <doc> <id> [--json] [-o file]', positionals: 2 }, (a) => {
    const steps = trace(readDoc(io, a.pos[0]), a.pos[1]);
    if (steps.length === 0) {
      io.err(`meso-trace: ${a.pos[1]} names nothing traceable\n`);
      return 1;
    }
    emit(io, a, traceToSexprData(steps), IRCodec);
    return 0;
  });

runMain(import.meta.url, run);
