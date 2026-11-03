/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Blosc decode throughput (MB/s of decoded bytes), by hand, never in CI. Bundles blosc.ts with esbuild and decodes
// each file into one preallocated buffer, best of the runs.
//
// usage: node packages/io/src/reader/zarr/_test/bench-blosc.mjs [--runs 10] [file.blosc ...]
//        (default: the largest fixture; a real chunk, e.g. TS_08.zarr/2/0/0/0 from the CryoET Data Portal, by curl)

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as esbuild from 'esbuild';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 10;
const files = args.length ? args : [path.join(here, 'fixtures/blosc/lz4-blocks-f4.bin')];

const { outputFiles } = await esbuild.build({
  stdin: {
    contents: `export { bloscDecode, bloscHeader } from './blosc.ts';
      export { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';`,
    resolveDir: path.join(here, '..'),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  conditions: ['molstar-src'],
  plugins: [
    {
      name: 'js-to-ts',
      setup(build) {
        build.onResolve({ filter: /^\..*\.js$/ }, (a) => {
          const ts = path.join(a.resolveDir, a.path.replace(/\.js$/, '.ts'));
          return fs.existsSync(ts) ? { path: ts } : undefined;
        });
      },
    },
  ],
});
const { bloscDecode, bloscHeader, SyncRuntimeContext } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

for (const file of files) {
  const src = new Uint8Array(fs.readFileSync(file));
  const h = bloscHeader(src);
  const out = new Uint8Array(h.nbytes);
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    await bloscDecode(SyncRuntimeContext, src, out);
    best = Math.min(best, performance.now() - t);
  }
  const mbs = h.nbytes / 1e6 / (best / 1e3);
  console.log(
    `${path.basename(file)}: ${(h.nbytes / 1e6).toFixed(1)} MB decoded (flags 0x${h.flags.toString(16)}, typesize ${h.typesize}, blocksize ${h.blocksize}), best ${best.toFixed(1)} ms, ${mbs.toFixed(0)} MB/s`,
  );
}
