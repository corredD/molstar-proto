/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { exosomeDoc, ExosomeResources } from '../examples/exosome.js';
import { galleryDoc } from '../examples/gallery.js';
import { yeastDoc } from '../examples/yeast.js';
import { betaCellDoc, BetaCellResources } from '../examples/betacell.js';
import { DocumentCodec, IRCodec, printData, readData, readSexpr } from '../format/sexpr.js';
import { irToJson } from '../ir/ir.js';
import { DefaultResolvers } from '../resolvers/index.js';
import { compile } from '../runtime/runtime.js';

// The S-expression spelling (design.md §3.7): a real second spelling of the same tree. read(print(json)) is the JSON;
// print(read(text)) is the text (a fixed point).

const docs = { exosome: exosomeDoc(), gallery: galleryDoc(), yeast: yeastDoc(), betacell: betaCellDoc() };

describe('S-expression spelling', () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name}: the document round-trips`, () => {
      const text = printData(doc, DocumentCodec);
      const back = readData(text, DocumentCodec);
      expect(back.error).toBeUndefined();
      expect(back.value).toEqual(JSON.parse(JSON.stringify(doc)));
      expect(printData(back.value, DocumentCodec)).toBe(text);
    });
    it(`${name}: the IR summary round-trips`, async () => {
      const r = await compile(doc, {
        resolvers: DefaultResolvers,
        load: (id) => ExosomeResources[id]?.() ?? BetaCellResources[id]?.(),
      });
      const json = JSON.parse(
        JSON.stringify(
          irToJson(
            r.ir ?? {
              root: { ref: 'scene', kind: 'scene', params: { units: 'A', title: '' } },
              view: { id: 'v', looks: [] },
            },
            r.issues,
          ),
        ),
      );
      const text = printData(json, IRCodec);
      expect(readData(text, IRCodec).value).toEqual(json);
    });
  }

  it('reads as people write it: ids with . : #, quantities, vectors, quoted strings, comments', () => {
    const text = `(meso_view_spec :version 0.1.0 ; a comment
      :populations [(population p.catalase#12 :entity e.catalase :abundance (:concentration (0.4 mM)))]
      :frames [(frame default:f.model :kind world :voxel-size (1 nm) :convention "origin at the centre")]
      :views [(view v :camera (:position [0 0 260] :target [0 0 0]) :looks [(:select (entity e.catalase) :color #d0453a)])])`;
    const r = readData(text);
    expect(r.error).toBeUndefined();
    expect(r.value).toEqual({
      format: 'meso_view_spec',
      version: '0.1.0',
      populations: [
        { id: 'p.catalase#12', entity: 'e.catalase', abundance: { concentration: { value: 0.4, unit: 'mM' } } },
      ],
      frames: [
        {
          id: 'default:f.model',
          kind: 'world',
          voxelSize: { value: 1, unit: 'nm' },
          convention: 'origin at the centre',
        },
      ],
      views: [
        {
          id: 'v',
          camera: { position: [0, 0, 260], target: [0, 0, 0] },
          looks: [{ select: '(entity e.catalase)', color: '#d0453a' }],
        },
      ],
    });
  });

  it('keys that are not camelCase words read back exactly', () => {
    const json = { params: { ingredients: { 'p.ALB': { path: 'root.proteins.ALB' } }, 'dna-entry': 1 } };
    const text = printData(json);
    expect(text).toContain(':"p.ALB"');
    expect(readData(text).value).toEqual(json);
  });

  it('errors say where', () => {
    expect(readSexpr('(a (b c]').error?.message).toMatch(/closes a \(/);
    expect(readSexpr('(a "x').error?.message).toMatch(/unterminated/);
    expect(readData('(a :Bad 1)').error?.message).toMatch(/bad keyword/);
  });
});
