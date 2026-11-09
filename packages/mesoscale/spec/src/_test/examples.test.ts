/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exosomeDoc, ExosomeResources } from '../examples/exosome.js';
import { syntheticPicksStar, syntheticVesicleObj } from '../examples/fixtures/synthetic.js';
import { galleryDoc } from '../examples/gallery.js';
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { yeastDoc } from '../examples/yeast.js';
import { irToJson } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';

// The paired examples (design.md §10), as files a reader opens without running anything: each document as authored
// and the IR (placement buffers summarized) the runtime makes of it, in packages/mesoscale/examples. This test fails
// when they are stale; `MESO_UPDATE_EXAMPLES=1 pnpm test:unit packages/mesoscale/spec` rewrites them.

const dir = new URL('../../../examples/', import.meta.url);
const update = !!process.env.MESO_UPDATE_EXAMPLES;

function check(name: string, text: string) {
  const file = new URL(name, dir);
  if (update) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `${name} is missing: run with MESO_UPDATE_EXAMPLES=1`).toBe(true);
  const committed = readFileSync(file, 'utf8');
  // JSON by value (the repository's formatter lays the files out its own way), the native formats by text
  if (name.endsWith('.json')) expect(JSON.parse(committed)).toEqual(JSON.parse(text));
  else expect(committed).toBe(text);
}

const json = (x: unknown) => `${JSON.stringify(x, null, 1)}\n`;
const load = (id: string) => ExosomeResources[id]?.() ?? BetaCellResources[id]?.();

describe('paired examples', () => {
  for (const [name, doc] of [
    ['exosome', exosomeDoc()],
    ['gallery', galleryDoc()],
    ['yeast', yeastDoc()],
    ['betacell', betaCellDoc()],
    ['nucleoid', nucleoidDoc()],
  ] as const) {
    it(`${name}: the document and its IR`, async () => {
      check(`${name}.mesoviewspec.json`, json(doc));
      const r = await compile(doc, { resolvers: DefaultResolvers, load });
      check(`${name}.ir.json`, json(r.ir ? irToJson(r.ir, r.issues) : { issues: r.issues }));
    });
  }
  it('the synthetic fixtures, in their native formats', () => {
    check('fixtures/membrane.obj', syntheticVesicleObj());
    check('fixtures/catalase_picks.star', syntheticPicksStar());
  });
});

// A relative `uri` resolves against the document's own location (format.md, Resources), as the CLIs and prism-me's open
// read it; `fixture://x` is `fixtures/x` beside the document. The data a reader of the examples is given (recipes,
// meshes, STAR tables) is a file there; the binary volumes and the yeast pipeline files are named, not shipped.
describe('the committed examples name their resources from their own folder', () => {
  const shipped = new Set(['cellpack-gpu-serialized', 'obj', 'relion-star']);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mesoviewspec.json'))) {
    it(`${file}: every shipped format's relative uri is a file`, () => {
      const doc = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
        resources?: { id: string; format?: string; uri?: string }[];
      };
      for (const r of doc.resources ?? []) {
        const remote = /^[a-z][a-z0-9+.-]*:/i.test(r.uri ?? '') && !r.uri?.startsWith('fixture://');
        if (!r.uri || remote || !shipped.has(r.format ?? '')) continue;
        const rel = r.uri.startsWith('fixture://') ? `fixtures/${r.uri.slice(10)}` : r.uri;
        const path = fileURLToPath(new URL(rel, dir));
        expect(existsSync(path), `${r.id}: ${r.uri} is not at ${path}`).toBe(true);
      }
    });
  }
});
