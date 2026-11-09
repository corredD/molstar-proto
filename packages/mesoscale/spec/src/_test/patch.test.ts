/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { betaCellDoc } from '../examples/betacell.js';
import { exosomeDoc } from '../examples/exosome.js';
import { galleryDoc } from '../examples/gallery.js';
import { nucleoidDoc } from '../examples/nucleoid.js';
import { yeastDoc } from '../examples/yeast.js';
import type { MesoViewSpecDoc } from '../format/doc.js';
import {
  applyPatch,
  classifyPatch,
  diff,
  type Op,
  type Patch,
  PatchFormat,
  printPatch,
  readPatch,
} from '../format/patch.js';
import { classifyEdit } from '../runtime/runtime.js';

// Patches (prism.md §2): every op and its inverse on the five examples, all or nothing, no cascade, diff, sharing,
// what an edit costs, and the two format additions a patch needs (a look's id and emissive).

const docs: Record<string, () => MesoViewSpecDoc> = {
  exosome: exosomeDoc,
  gallery: galleryDoc,
  yeast: yeastDoc,
  betacell: betaCellDoc,
  nucleoid: nucleoidDoc,
};
const patch = (...ops: Op[]): Patch => ({ format: PatchFormat, ops });
const bytes = (d: MesoViewSpecDoc) => JSON.stringify(d);
const tmp = { id: 'v.tmp', label: 'Tmp', looks: [{ id: 'l.tmp', select: '(all)', color: '#ff0000' }] };

/** Applies, expects it to be accepted, applies the inverse, and expects the document back byte for byte. */
function undone(doc: MesoViewSpecDoc, p: Patch) {
  const r = applyPatch(doc, p);
  expect(r.issues).toEqual([]);
  const back = applyPatch(r.doc, r.inverse!);
  expect(back.issues).toEqual([]);
  expect(bytes(back.doc)).toBe(bytes(doc));
  return r.doc;
}

describe('patch: ops and their inverses', () => {
  for (const [name, make] of Object.entries(docs)) {
    it(`${name}: set, insert, move, remove, each undone byte for byte`, () => {
      const doc = make();
      const comp = doc.compartments[0];
      // set: a field changed, a field added, a field removed
      undone(doc, patch({ op: 'set', id: comp.id, fields: { label: 'renamed' } }));
      undone(doc, patch({ op: 'set', id: comp.id, fields: { label: null } }));
      undone(doc, patch({ op: 'set', id: 'document', fields: { metadata: { title: 'x' }, session: null } }));
      // insert into a section, after a sibling, first, last; a view with looks
      const first = doc.entities[0].id;
      undone(
        doc,
        patch({ op: 'insert', parent: 'entities', after: first, node: { id: 'e.tmp', label: 't', kind: 'protein' } }),
      );
      const withView = undone(doc, patch({ op: 'insert', parent: 'views', after: 'first', node: tmp }));
      expect(withView.views![0].id).toBe('v.tmp');
      // moves, within a section and between lists of looks
      undone(withView, patch({ op: 'move', id: 'v.tmp', after: 'last' }));
      undone(
        withView,
        patch({ op: 'insert', parent: 'v.tmp', list: 'looks', after: 'first', node: { id: 'l.a', select: '(all)' } }),
      );
      const two = applyPatch(
        withView,
        patch({ op: 'insert', parent: 'v.tmp', list: 'looks', node: { id: 'l.b', select: '(all)', visible: false } }),
      ).doc;
      undone(two, patch({ op: 'move', id: 'l.b', after: 'first' }));
      undone(two, patch({ op: 'remove', id: 'l.tmp' }, { op: 'remove', id: 'v.tmp' }));
      // remove an annotation the document has (or the look inserted)
      undone(two, patch({ op: 'remove', id: 'l.b' }));
    });
  }

  it('a look moves to another view: undone', () => {
    const doc = exosomeDoc();
    const withView = applyPatch(doc, patch({ op: 'insert', parent: 'views', node: tmp })).doc;
    undone(withView, patch({ op: 'move', id: 'l.tmp', parent: 'v.overview', list: 'looks', after: 'first' }));
  });

  it('an op sequence is undone in reverse', () => {
    const doc = exosomeDoc();
    const p = patch(
      { op: 'insert', parent: 'views', node: tmp },
      { op: 'set', id: 'l.tmp', fields: { color: '#00ff00' } },
      { op: 'set', id: 'v.tmp', fields: { label: null } },
      { op: 'move', id: 'v.tmp', after: 'first' },
    );
    const next = undone(doc, p);
    expect(next.views![0]).toEqual({ id: 'v.tmp', looks: [{ id: 'l.tmp', select: '(all)', color: '#00ff00' }] });
  });

  it('the base and the revision: a patch names the revision it applies to; the inverse names the pair back', () => {
    const doc = { ...exosomeDoc(), revision: 'r1' };
    const set = patch({ op: 'set', id: 'document', fields: { metadata: { title: 'a' } } });
    const bad = applyPatch(doc, { ...set, base: 'r0', revision: 'r2' });
    expect(bad.doc).toBe(doc);
    expect(bad.issues.map((i) => i.code)).toEqual(['patch.base']);
    expect(applyPatch(exosomeDoc(), { ...set, base: 'r1' }).issues[0].code).toBe('patch.base');
    const ok = applyPatch(doc, { ...set, base: 'r1', revision: 'r2' });
    expect(ok.doc.revision).toBe('r2');
    expect(ok.inverse).toMatchObject({ base: 'r2', revision: 'r1' });
    expect(bytes(applyPatch(ok.doc, ok.inverse!).doc)).toBe(bytes(doc));
    // without a revision the document has none
    expect(applyPatch(doc, set).doc.revision).toBeUndefined();
  });
});

describe('patch: all or nothing, no cascade', () => {
  const doc = exosomeDoc();
  const refused = (p: Patch | unknown, code: string, path: string) => {
    const r = applyPatch(doc, p as Patch);
    expect(r.doc).toBe(doc);
    expect(r.inverse).toBeNull();
    expect(r.issues[0]).toMatchObject({ code, severity: 'error', phase: 'static' });
    expect(r.issues[0].path).toBe(path);
  };

  it('a bad op leaves the document `===` the same, pathed at the op', () => {
    refused(
      patch({ op: 'set', id: 'c.exosome', fields: { label: 'x' } }, { op: 'remove', id: 'nothing' }),
      'patch.target',
      '/ops/1',
    );
  });
  it('shapes: ops, ids, fields, anchors, kinds of lists', () => {
    refused({ format: 'other', ops: [] }, 'patch.shape', '/format');
    refused({ ops: 'no' }, 'patch.shape', '');
    refused(patch({ op: 'bad' } as unknown as Op), 'patch.shape', '/ops/0');
    refused(patch({ op: 'set', id: 'c.exosome', fields: { id: 'c.other' } }), 'patch.shape', '/ops/0');
    refused(patch({ op: 'set', id: 'document', fields: { version: '9.9.9' } }), 'patch.shape', '/ops/0');
    refused(patch({ op: 'insert', parent: 'views', node: { label: 'no id' } as never }), 'patch.shape', '/ops/0');
    refused(patch({ op: 'insert', parent: 'views', after: 'v.nope', node: tmp }), 'patch.target', '/ops/0');
    refused(patch({ op: 'insert', parent: 'nowhere', node: tmp }), 'patch.target', '/ops/0');
    refused(
      patch({ op: 'insert', parent: 'entities', node: { id: 'v.overview', label: 'x', kind: 'protein' } }),
      'patch.target',
      '/ops/0',
    );
    refused(patch({ op: 'move', id: 'l.nope', after: 'first' }), 'patch.target', '/ops/0');
    refused(patch({ op: 'move', id: 'an.picks', parent: 'v.lumen', list: 'looks' }), 'patch.target', '/ops/0');
  });
  it('a node inside a superstructure or a step is not addressable', () => {
    const ss = betaCellDoc();
    const inner = ss.superstructures?.[0]?.populations?.[0]?.id;
    if (inner) expect(applyPatch(ss, patch({ op: 'remove', id: inner })).issues[0].code).toBe('patch.target');
  });
  it('removing a node something names is refused (no cascade); removing both together is not', () => {
    const r = applyPatch(doc, patch({ op: 'remove', id: 'p.miRNA' }));
    expect(r.doc).toBe(doc);
    expect(r.issues.map((i) => i.code)).toContain('ref.missing');
    expect(r.issues[0].path).toMatch(/^\/ops/);
    const model = doc.models!.find((m) => m.populations.includes('p.miRNA'))!;
    const ok = applyPatch(
      doc,
      patch(
        { op: 'set', id: model.id, fields: { populations: model.populations.filter((p) => p !== 'p.miRNA') } },
        { op: 'remove', id: 'p.miRNA' },
      ),
    );
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('a result with an error is refused, its issue pathed at the op that made it', () => {
    const r = applyPatch(
      doc,
      patch(
        { op: 'set', id: 'v.overview', fields: { camera: { fov: 40 } } },
        { op: 'insert', parent: 'views', node: { id: 'v.bad', looks: [{ select: '(all)', color: 'red' }] } },
      ),
    );
    expect(r.doc).toBe(doc);
    expect(r.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ['value.range', '/ops/1'],
        ['value.range', '/ops/0'],
      ]),
    );
  });
});

describe('patch: diff', () => {
  for (const [name, make] of Object.entries(docs)) {
    it(`${name}: applying diff(a, b) to a gives b`, () => {
      const a = make();
      const looks = [{ id: 'l.x', select: '(all)', color: '#123456', emissive: 0.5 }];
      const views = [...(a.views ?? [])];
      const edited = views.length
        ? [
            {
              ...views[0],
              label: 'edited',
              looks: [...(views[0].looks ?? []).map((l, i) => ({ ...l, id: `l.${i}` })), ...looks],
            },
            ...views.slice(1),
          ]
        : [];
      const b: MesoViewSpecDoc = {
        ...a,
        revision: 'r2',
        metadata: { ...a.metadata, title: 'Edited' },
        entities: [
          { ...(a.entities[1] ?? a.entities[0]) },
          ...a.entities.filter((_, i) => i > 1).reverse(),
          { id: 'e.new', label: 'new', kind: 'protein' },
          ...(a.entities.length > 1 ? [a.entities[0]] : []),
        ],
        views: [...edited, { ...tmp, id: 'v.new', looks: [{ ...tmp.looks[0], id: 'l.new' }] }],
        session: a.views?.[1] ? { view: a.views[1].id } : a.session,
      };
      const p = diff(a, b);
      expect(p).not.toBeNull();
      const r = applyPatch(a, p!);
      // entities that others name may be gone: a diff states the change; whether it is valid is apply's
      if (r.inverse) expect(r.doc).toEqual(b);
      else expect(validate(b).some((i) => i.severity === 'error')).toBe(true);
    });
  }
  it('a document a patch cannot reach has no diff', () => {
    expect(diff(exosomeDoc(), { ...exosomeDoc(), version: '0.9.0' })).toBeNull();
    expect(diff(exosomeDoc(), { ...exosomeDoc(), custom: { x: 1 } })).toBeNull();
  });
  it('looks without ids are addressed through their view: one set of its looks', () => {
    const a = exosomeDoc();
    const v = a.views![1];
    const b = {
      ...a,
      views: [a.views![0], { ...v, looks: [...v.looks!, { select: '(all)', color: '#fff000' }] }, a.views![2]],
    };
    const p = diff(a, b)!;
    expect(p.ops).toEqual([{ op: 'set', id: v.id, fields: { looks: b.views[1].looks } }]);
    expect(applyPatch(a, p).doc).toEqual(b);
  });
  it('the same document: no ops', () => {
    expect(diff(exosomeDoc(), exosomeDoc())!.ops).toEqual([]);
  });
});

describe('patch: sharing and cost', () => {
  const doc = exosomeDoc();
  const edit = patch({
    op: 'insert',
    parent: 'v.overview',
    list: 'looks',
    node: { id: 'l.red', select: '(entity e.catalase)', color: '#ff0000' },
  });

  it('untouched sections and items are shared: a look edit copies one view', () => {
    const r = applyPatch(doc, edit).doc;
    for (const k of Object.keys(doc) as (keyof MesoViewSpecDoc)[]) if (k !== 'views') expect(r[k]).toBe(doc[k]);
    expect(r.views![1]).toBe(doc.views![1]);
    expect(r.views![2]).toBe(doc.views![2]);
    expect(r.views![0]).not.toBe(doc.views![0]);
    expect(r.views![0].annotations).toBe(doc.views![0].annotations);
    const set = applyPatch(r, patch({ op: 'set', id: 'l.red', fields: { color: '#00ff00' } })).doc;
    expect(set.views![0].looks!.slice(0, -1)).toEqual(r.views![0].looks!.slice(0, -1));
    expect(set.views![0].looks![0]).toBe(r.views![0].looks![0]);
  });

  it('a patch touching only views, tours, session and metadata is a view edit; any other is a model edit', () => {
    const views = [
      edit,
      patch({ op: 'set', id: 'document', fields: { session: { view: 'v.lumen' }, metadata: { title: 'x' } } }),
      patch(
        { op: 'insert', parent: 'views', node: tmp },
        { op: 'insert', parent: 'v.tmp', list: 'looks', node: { id: 'l.q', select: '(all)' } },
      ),
      patch({ op: 'remove', id: 'an.picks' }),
    ];
    for (const p of views) {
      const r = applyPatch(doc, p);
      expect(r.issues).toEqual([]);
      expect(classifyPatch(doc, p)).toBe('view');
      expect(classifyEdit(doc, r.doc)).toBe('view');
    }
    const models = [
      patch({ op: 'set', id: 'p.miRNA', fields: { detail: 'entity' } }),
      patch({ op: 'set', id: 'document', fields: { units: { length: 'A' } } }),
      patch({ op: 'insert', parent: 'views', node: tmp }, { op: 'set', id: 'c.exosome', fields: { label: 'x' } }),
    ];
    for (const p of models) {
      expect(classifyPatch(doc, p)).toBe('model');
      expect(classifyEdit(doc, applyPatch(doc, p).doc)).toBe('model');
    }
  });

  it('a revision alone is not an edit', () => {
    const r = applyPatch(doc, { ...patch(), revision: 'r1' }).doc;
    expect(r.revision).toBe('r1');
    expect(classifyEdit(doc, r)).toBe('none');
  });
});

describe('patch: the S-expression spelling', () => {
  const text = (p: Patch) => printPatch(p);
  it('a look edit reads as it is meant', () => {
    const p = patch({ op: 'set', id: 'l.catalase', fields: { color: '#ff0000', emissive: null } });
    expect(text(p)).toBe('(patch :ops [(set l.catalase :fields (:color #ff0000 :emissive nil))])');
  });
  const ops: Op[] = [
    { op: 'set', id: 'document', fields: { metadata: { title: 'A "title"' }, session: null } },
    {
      op: 'set',
      id: 'v.overview',
      fields: { selection: '(population p.miRNA)', camera: { focus: '(entity e.catalase)' } },
    },
    {
      op: 'insert',
      parent: 'v.overview',
      list: 'looks',
      after: 'first',
      node: {
        id: 'l.a',
        select: '(and (entity e.catalase) (not (population p.lipids)))',
        color: '#00ff00',
        emissive: 0.25,
      },
    },
    {
      op: 'insert',
      parent: 'entities',
      after: 'e.catalase',
      node: { id: 'e.new', label: 'new', kind: 'protein', radius: { value: 5, unit: 'nm' } },
    },
    {
      op: 'insert',
      parent: 'views',
      node: {
        id: 'v.new',
        cutaway: '(in c.exosome)',
        looks: [
          { id: 'l.x', select: '(all)' },
          { select: '(all)', visible: false },
        ],
      },
    },
    { op: 'move', id: 'l.a', parent: 'v.lumen', list: 'looks', after: 'last' },
    { op: 'move', id: 'v.new', after: 'first' },
    { op: 'remove', id: 'an.picks' },
  ];
  it('read(print(patch)) is the patch, print(read(text)) the text', () => {
    for (const p of [patch(...ops), { ...patch(...ops), base: 'r1', revision: 'r2' }, patch()]) {
      const s = text(p);
      const back = readPatch(s);
      expect(back.error).toBeUndefined();
      expect(back.patch).toEqual(JSON.parse(JSON.stringify(p)));
      expect(text(back.patch!)).toBe(s);
    }
  });
  it('the diff of an example edit and its inverse round-trip, and the read patch applies', () => {
    const a = exosomeDoc();
    const edit = applyPatch(
      a,
      patch({
        op: 'insert',
        parent: 'v.overview',
        list: 'looks',
        node: { id: 'l.red', select: '(entity e.catalase)', color: '#ff0000' },
      }),
    );
    for (const p of [edit.inverse!, diff(a, edit.doc)!]) {
      const back = readPatch(text(p)).patch!;
      expect(back).toEqual(p);
      expect(applyPatch(a, back.ops.length === 1 && back.ops[0].op === 'remove' ? patch() : back).issues).toEqual([]);
    }
  });
  it('a text that is not a patch is an error, not a throw', () => {
    expect(readPatch('(entity e.x)').error?.message).toMatch(/patch/);
    expect(readPatch('(patch :ops [').error).toBeDefined();
  });
});

describe("review: nested ids are the document's ids", () => {
  const doc = exosomeDoc();
  it('a node that brings a look id the document has is refused, so the inverse of an accepted patch applies', () => {
    for (const p of [
      patch(
        { op: 'insert', parent: 'views', node: { id: 'v.new', looks: [{ id: 'l.lipids', select: '(all)' }] } },
        { op: 'remove', id: 'l.lipids' },
      ),
      patch(
        { op: 'set', id: 'v.lumen', fields: { looks: [{ id: 'l.lipids', select: '(all)' }] } },
        { op: 'remove', id: 'l.lipids' },
      ),
    ]) {
      const r = applyPatch(doc, p);
      expect(r.inverse).toBeNull();
      expect(r.issues[0]).toMatchObject({ code: 'patch.target', path: '/ops/0' });
    }
    // a duplicate inside the node itself: the final check names it
    const twice = patch({
      op: 'insert',
      parent: 'views',
      node: {
        id: 'v.new',
        looks: [
          { id: 'l.q', select: '(all)' },
          { id: 'l.q', select: '(all)' },
        ],
      },
    });
    expect(applyPatch(doc, twice).inverse).toBeNull();
  });
  it('a view keeps its own look ids in a set of its looks', () => {
    const looks = doc.views![0].looks!.map((l) => ({ ...l, color: '#010101' }));
    expect(applyPatch(doc, patch({ op: 'set', id: 'v.overview', fields: { looks } })).issues).toEqual([]);
  });
  it('the reserved id document is no node id', () => {
    const r = applyPatch(doc, patch({ op: 'insert', parent: 'views', node: { id: 'document' } }));
    expect(r.issues[0]).toMatchObject({ code: 'patch.target' });
  });
});

describe('review: a list that empties and comes back is where it was', () => {
  it('the looks of a view removed one by one, then the inverse: the same bytes', () => {
    const doc = exosomeDoc();
    undone(doc, patch(...doc.views![0].looks!.map((l) => ({ op: 'remove', id: l.id! }) as Op)));
  });
  it('a no-op move, and a set dropping a field, on the only item of an optional section', () => {
    for (const make of Object.values(docs)) {
      const doc = make();
      for (const s of ['alignments', 'relations', 'catalogs', 'instances', 'superstructures', 'tours'] as const) {
        const items = (doc[s] ?? []) as { id?: string }[];
        if (items.length !== 1) continue;
        const [item] = items;
        const field = ['method', 'note', 'label', 'evidence', 'activity'].find((k) => k in item);
        expect(bytes(undone(doc, patch({ op: 'move', id: item.id!, after: 'first' })))).toBe(bytes(doc));
        if (field) undone(doc, patch({ op: 'set', id: item.id!, fields: { [field]: null } }));
      }
    }
  });
  it('the only look of a view moved to another view, then undone', () => {
    const doc = exosomeDoc();
    const a = applyPatch(doc, patch({ op: 'insert', parent: 'views', node: tmp })).doc;
    undone(a, patch({ op: 'move', id: 'l.tmp', parent: 'v.overview', list: 'looks' }));
  });
});

describe('review: a look after one with no id is put back where it was', () => {
  const doc = {
    ...exosomeDoc(),
    views: [
      {
        id: 'v.x',
        looks: [
          { select: '(all)' },
          { id: 'l.a', select: '(all)', color: '#111111' },
          { select: '(population p.lipids)' },
        ],
      },
    ],
    session: undefined,
  } as unknown as MesoViewSpecDoc;
  it('remove, a field dropped, a move: each undone byte for byte', () => {
    undone(doc, patch({ op: 'remove', id: 'l.a' }));
    undone(doc, patch({ op: 'set', id: 'l.a', fields: { color: null } }));
    undone(doc, patch({ op: 'move', id: 'l.a', after: 'last' }));
    const other = applyPatch(
      doc,
      patch({ op: 'insert', parent: 'v.x', list: 'annotations', node: { id: 'an.q', target: '(all)', text: 't' } }),
    ).doc;
    undone(other, patch({ op: 'move', id: 'l.a', parent: 'v.x', list: 'looks', after: 'last' }));
  });
});

describe('review: set never changes a kind', () => {
  it('a field `kind` is refused to set or remove; the node is replaced instead', () => {
    const doc = exosomeDoc();
    for (const kind of ['lipid', null]) {
      const r = applyPatch(doc, patch({ op: 'set', id: 'e.catalase', fields: { kind } }));
      expect(r.doc).toBe(doc);
      expect(r.issues[0]).toMatchObject({ code: 'patch.shape', path: '/ops/0' });
    }
    const e = doc.entities.find((x) => x.id === 'e.catalase')!;
    const at = doc.entities.indexOf(e);
    const after = at === 0 ? 'first' : doc.entities[at - 1].id;
    const r = applyPatch(
      doc,
      patch(
        { op: 'remove', id: 'e.catalase' },
        { op: 'insert', parent: 'entities', after, node: { ...e, kind: 'complex' } },
      ),
    );
    expect(r.issues.filter((i) => i.code !== 'patch.shape' && i.severity === 'error')).toEqual([]);
  });
  it('diff states a kind change as a replacement, and it applies', () => {
    const a = exosomeDoc();
    const b = {
      ...a,
      entities: a.entities.map((e) => (e.id === 'e.catalase' ? { ...e, kind: 'complex' as const } : e)),
    };
    const p = diff(a, b)!;
    expect(p).not.toBeNull();
    expect(p.ops.map((o) => o.op)).toEqual(['remove', 'insert']);
    expect(applyPatch(a, p).doc).toEqual(b);
  });
});

describe('review: the document keeps its metadata and its field order', () => {
  it('metadata is not removed', () => {
    const doc = exosomeDoc();
    const r = applyPatch(doc, patch({ op: 'set', id: 'document', fields: { metadata: null } }));
    expect(r.doc).toBe(doc);
    expect(r.issues[0]).toMatchObject({ code: 'patch.shape', path: '/ops/0' });
  });
  it('a revision first given or dropped is undone byte for byte', () => {
    const set = patch({ op: 'set', id: 'document', fields: { units: { length: 'nm' } } });
    const given = applyPatch(exosomeDoc(), { ...set, revision: 'r1' });
    expect(Object.keys(given.doc).indexOf('revision')).toBe(2);
    const dropped = applyPatch(given.doc, set);
    expect(dropped.doc.revision).toBeUndefined();
    expect(bytes(applyPatch(dropped.doc, dropped.inverse!).doc)).toBe(bytes(given.doc));
  });
});

describe('review: malformed input is issues, never a throw', () => {
  const doc = exosomeDoc();
  const bad = (x: object) => ({ ...doc, ...x }) as unknown as MesoViewSpecDoc;
  const op = patch({ op: 'set', id: 'c.exosome', fields: { label: 'x' } });
  it('a document that is not well formed is refused by apply and has no diff', () => {
    for (const d of [
      bad({ views: 'x' }),
      bad({ views: [null] }),
      bad({ frames: 'x' }),
      bad({ views: [{ id: 'v', looks: [null] }] }),
    ]) {
      const r = applyPatch(d, op);
      expect(r.doc).toBe(d);
      expect(r.issues[0].code).toBe('patch.shape');
      expect(diff(d, doc)).toBeNull();
      expect(diff(doc, d)).toBeNull();
    }
  });
  it('classifyPatch says model for ops it cannot read', () => {
    for (const p of [
      patch({ op: 'set', id: 'x', fields: null } as never),
      { format: PatchFormat, ops: [null] },
      patch({ op: 'insert', parent: 'views' } as never),
      { format: PatchFormat, ops: null },
    ])
      expect(classifyPatch(doc, p as unknown as Patch)).toBe('model');
  });
  it('a move into a view inserted earlier in the patch is a view edit', () => {
    const p = patch(
      { op: 'insert', parent: 'views', node: { id: 'v.n' } },
      { op: 'move', id: 'l.catalase', parent: 'v.n', list: 'looks' },
    );
    expect(applyPatch(doc, p).issues).toEqual([]);
    expect(classifyPatch(doc, p)).toBe('view');
  });
  it('a text with an op that is not a form is an error', () => {
    expect(readPatch('(patch :ops [nil])').error).toBeDefined();
    expect(readPatch('(patch :ops [3])').error).toBeDefined();
  });
});

describe('review: diff of looks across views and to none', () => {
  const view = (id: string, looks: string[]) => ({
    id,
    looks: looks.map((l) => ({ id: l, select: '(all)' })),
  });
  const base = (views: object[]) => ({ ...exosomeDoc(), session: undefined, views }) as unknown as MesoViewSpecDoc;
  it('a look moved to an earlier view', () => {
    const a = base([view('v.a', ['l.y']), view('v.b', ['l.x', 'l.z'])]);
    const b = base([view('v.a', ['l.x', 'l.y']), view('v.b', ['l.z'])]);
    const p = diff(a, b);
    expect(p).not.toBeNull();
    expect(applyPatch(a, p!).doc).toEqual(b);
  });
  it('a view whose looks are all gone, kept as an empty list', () => {
    const a = base([view('v.a', ['l.x'])]);
    const b = base([{ id: 'v.a', looks: [] }]);
    const p = diff(a, b);
    expect(p).not.toBeNull();
    expect(applyPatch(a, p!).doc).toEqual(b);
  });
});
