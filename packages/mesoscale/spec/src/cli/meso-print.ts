#!/usr/bin/env node
/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { DocumentCodec, IRCodec } from '@molstar/meso-spec/format';
import { type CliIO, command, emit, nodeIO, readValue, runMain } from './io.js';

// `meso-print <file> [--json] [-o file]`: JSON or S-expression text as the S-expression (default) or JSON
// (`--json`), laid out canonically. A document uses the document codec, anything else (an IR summary, an issue list,
// a trace) the IR codec. Does not validate. Exit 0, or 2 for usage and unreadable input.

export const run = (argv: readonly string[], io: CliIO = nodeIO) =>
  command(argv, io, { name: 'meso-print', usage: 'meso-print <file> [--json] [-o file]', positionals: 1 }, (a) => {
    const { value, head } = readValue(io, a.pos[0]);
    const isDoc = head === 'meso_view_spec' || (value as { format?: unknown } | null)?.format === 'meso_view_spec';
    emit(io, a, value, isDoc ? DocumentCodec : IRCodec);
    return 0;
  });

runMain(import.meta.url, run);
