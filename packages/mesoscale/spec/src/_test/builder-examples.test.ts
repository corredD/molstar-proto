/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { betaCellDoc } from '../examples/betacell.js';
import { exosomeDoc } from '../examples/exosome.js';
import { galleryDoc } from '../examples/gallery.js';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { yeastDoc } from '../examples/yeast.js';
import { printData } from '../format/sexpr.js';
import { validate } from '../format/validate.js';

// The examples are written with the builder (design.md §3.15); their documents are what the literals were. The oracles
// are the literals' own output, frozen: the committed `packages/mesoscale/examples/*.mesoviewspec.json` (the default
// arguments) and `fixtures/builder-oracles.json` (the variants the literals took as arguments). Equal by value
// (`toStrictEqual`) and equal as S-expression text, which also pins the order of keys.

const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'));
const committed = (name: string) => read(new URL(`../../../examples/${name}.mesoviewspec.json`, import.meta.url));
const variants = read(new URL('./fixtures/builder-oracles.json', import.meta.url));

const cases: [string, () => unknown, unknown][] = [
  ['exosome', exosomeDoc, committed('exosome')],
  ['gallery', galleryDoc, committed('gallery')],
  ['yeast', yeastDoc, committed('yeast')],
  ['betacell', betaCellDoc, committed('betacell')],
  ['nucleoid', nucleoidDoc, committed('nucleoid')],
  ['betaCellDoc(7, entity)', () => betaCellDoc(7, 'entity'), variants['betaCellDoc(7,entity)']],
  ['exosomeDoc({ relax })', () => exosomeDoc({ relax: true }), variants['exosomeDoc({relax})']],
  ['nucleoidDoc(90)', () => nucleoidDoc(90), variants['nucleoidDoc(90)']],
];

describe('examples written with the builder', () => {
  for (const [name, make, oracle] of cases)
    it(`${name}: the document is the literal's`, () => {
      const doc = make();
      // through JSON: an importer's nodes (cellPACKgpu) carry undefined keys the committed files cannot show
      expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(oracle);
      expect(printData(doc)).toBe(printData(oracle));
    });
  it('and they are valid', () => {
    for (const [name, make] of cases)
      expect(
        validate(make() as never).filter((i) => i.severity === 'error'),
        name,
      ).toEqual([]);
  });
});
