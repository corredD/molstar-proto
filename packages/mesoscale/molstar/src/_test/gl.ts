/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRequire } from 'node:module';

// The optional native `gl` package (`pnpm native:install`), as packages/plugin/headless/src/_test/context.test.ts probes
// it: undefined when it is missing, so a GL test skips instead of failing.

export function tryGl(): typeof import('gl') | undefined {
  try {
    const gl = createRequire(import.meta.url)('gl') as typeof import('gl');
    const ctx = gl(1, 1);
    if (!ctx) return undefined;
    ctx.getExtension('STACKGL_destroy_context')?.destroy();
    return gl;
  } catch {
    return undefined;
  }
}
