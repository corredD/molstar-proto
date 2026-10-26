/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// One owner for the particle looks (_spec/architecture.md §7.1): only Prism's `patchParticleLook` makes a particle
// representation's layers cell; the app and its extensions call `particles.look`. What this checks of it: no other
// source of the app, its extensions or Prism's viewer applies `ParticleRepresentation3DLayers`. Not an update or a
// delete of the cell found another way: that is the review's.

const root = join(import.meta.dirname, '../../../..');
const scanned = [
  'apps/prism-me/src',
  'packages/extensions/mesoscale/src',
  'packages/extensions/cryoet/src',
  'packages/extensions/stage-tools/src',
  'packages/prism/viewer/src',
];
const owner = 'packages/prism/viewer/src/sources/particles/look.ts';

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '_test' || name === 'node_modules') continue;
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

it('only the looks helper applies a particle layers cell', () => {
  const writers = scanned
    .flatMap((d) => sources(join(root, d)))
    .filter((f) => /\.apply\(\s*ParticleRepresentation3DLayers\b/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f));
  expect(writers).toEqual([owner]);
});
