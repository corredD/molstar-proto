/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RuntimeContext } from '@molstar/core/task';
import { DefaultAssetManager } from '@molstar/core/util/assets';
import { CIF } from '@molstar/io/reader/cif';
import { parseAtomSpec, transpiler } from '@molstar/query-language/transpilers/chimerax/parser';
import { trajectoryFromMmCIF } from '@molstar/model/formats/structure/mmcif';
import { SecondaryStructureProvider } from '@molstar/model/props/computed/secondary-structure';
import { Script } from '@molstar/model/script/script';
import { StructureSelection } from '../../model/structure/query/selection.js';
import { Structure } from '../../model/structure/structure/structure.js';
import '@molstar/model/script/runtime/query/table'; // (registers the symbols of the queries)
import oracle from './chimerax-oracle.json' with { type: 'json' };

// ChimeraX's atom specs against ChimeraX itself: each spec's atom count in Mol* is the count ChimeraX 1.10 gave on the
// same structure (recorded by chimerax-oracle.py; no ChimeraX here). Where the two read a structure differently, not
// the spec, the difference is listed with why.

const examples = path.resolve(import.meta.dirname, '../../../../../data/examples');

/** Specs whose count differs for a reason outside the transpiler: the spec and Mol*'s count. */
const SecondaryStructure1tup =
  'the files differ, not the specs: 1tup.bcif has helices at A:150-152 and 173 and strands at 103 and 172 that the 1tup.cif ChimeraX fetched has not';
const Known: Record<string, Record<string, { readonly count: number; readonly why: string }>> = {
  '1tup.bcif': {
    helix: { count: 575, why: SecondaryStructure1tup },
    strand: { count: 1671, why: SecondaryStructure1tup },
    coil: { count: 2340, why: SecondaryStructure1tup },
    'protein & /A & helix': { count: 175, why: SecondaryStructure1tup },
  },
};

async function load(name: string): Promise<Structure> {
  const file = path.join(examples, name);
  const data = name.endsWith('.bcif') ? new Uint8Array(fs.readFileSync(file)) : fs.readFileSync(file, 'utf8');
  const parsed = await CIF.parse(data).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0], parsed.result).run();
  const structure = await Structure.ofTrajectory(trajectory, RuntimeContext.Synchronous);
  // `helix`, `strand` and `coil` read the secondary structure, which a viewer computes (the file's, else DSSP).
  await SecondaryStructureProvider.attach(
    { runtime: RuntimeContext.Synchronous, assetManager: new DefaultAssetManager() },
    structure,
  );
  return structure;
}

function count(structure: Structure, spec: string): number {
  const selection = Script.getStructureSelection(transpiler(spec), structure);
  return StructureSelection.unionStructure(selection).elementCount;
}

for (const [name, entry] of Object.entries(oracle.structures) as [string, { counts: Record<string, number> }][]) {
  describe(`ChimeraX atom specs on ${name}, as ChimeraX counts them`, () => {
    let structure: Structure;
    beforeAll(async () => {
      structure = await load(name);
    });
    for (const [spec, expected] of Object.entries(entry.counts)) {
      it(spec, () => {
        const known = Known[name]?.[spec];
        expect(count(structure, spec)).toBe(known ? known.count : expected);
      });
    }
  });
}

// Where a spec ends at the start of a command's arguments (`color /A :12 red`), as ChimeraX's parser reads it: the rest
// is the command's (a quoted spec's used text keeps the blank after it there).
describe('where ChimeraX atom specs end in a command, as ChimeraX reads them', () => {
  for (const [text, used] of Object.entries(oracle.ends.used as Record<string, string>)) {
    it(text, () => {
      if (used.startsWith('error')) expect(() => parseAtomSpec(text)).toThrow();
      else expect(parseAtomSpec(text).text).toBe(used.trimEnd());
    });
  }
});
