#!/usr/bin/env node
/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { validate } from '@molstar/meso-spec/format';
import { type CliIO, command, emit, nodeIO, readDoc, reportIssues, runMain } from './io.js';

// `meso-validate <doc> [--json] [-o file]`: the static check (design.md §12.1); the issue list is the product.
// Exit 0: no errors; 1: errors; 2: usage, unreadable input.

export const run = (argv: readonly string[], io: CliIO = nodeIO) =>
  command(argv, io, { name: 'meso-validate', usage: 'meso-validate <doc> [--json] [-o file]', positionals: 1 }, (a) => {
    const issues = validate(readDoc(io, a.pos[0]));
    emit(io, a, issues);
    return reportIssues(io, a.pos[0], issues);
  });

runMain(import.meta.url, run);
