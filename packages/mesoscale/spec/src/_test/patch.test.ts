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
import { applyPatch, classifyPatch, diff, type Op, type Patch, PatchFormat } from '../format/patch.js';
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
