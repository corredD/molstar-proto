/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import type { DocumentGroupBy, DocumentRow, DocumentRowKind, DocumentTree } from '@molstar/meso-molstar';
import type { Loci } from '@molstar/model/model/loci';
import { Particle } from '@molstar/model/model/particles/particle-list';
import type { ContextMenuItem } from '@molstar/prism-ui';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { downloadBlob } from '@molstar/prism-viewer/ui/download';

// The open MesoViewSpec document in the Scene tree (prism.md §4): one item of Particles, its compartments, populations,
// instances and parts under it, each row its MesoQL address. Its rows are the owner's (`api.mesoviewspec.treeState`,
// the lazy extension's: types only here); its eye and Show only are look patches (saved in the document, prism.md §11
// question 3); a double click frames its copies (`mesoviewspec.focus`); a hover lights them over every list they are on.

/** The document's own row: `md:`; a row of it: `md:<row id>`. */
export const DocumentKey = 'md:';
export const documentKey = (id: string) => `${DocumentKey}${id}`;

/** What a document row stands for: its id in the outline and its address. */
export interface DocumentRef {
  /** The row's id (`p.lipids`, `p.granules/p.Vamp2`, `@model:m.recipe`); the document's own: '' */
  readonly id: string;
  readonly select: string;
}

/** The kinds of the document's rows, as the tree and the properties name them */
export const DocumentRowKinds: Readonly<Record<DocumentRowKind | 'document', string>> = {
  document: 'mesoviewspec document',
  compartment: 'compartment',
  population: 'population',
  instance: 'instance',
  part: 'part',
  model: 'model group',
  kind: 'kind group',
};

/** Prism's Group by for a document (prism.md §4.2: Kind stands in for Function) */
export const DocumentGroupings: readonly (readonly [DocumentGroupBy, string])[] = [
  ['compartment', 'Compartment'],
  ['model', 'Model'],
  ['kind', 'Kind'],
];

/** A document row as the tree draws it (rows.ts's `Row`, without its place in the tree) */
export interface DocumentRowDraft {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  readonly kind: string;
  readonly count?: string;
  readonly short?: boolean;
  readonly color?: number;
  readonly visible?: boolean;
  readonly hasChildren: boolean;
  readonly icon?: 'file-code';
  readonly doc: DocumentRef;
}

/** "354 of 506" when short of what was asked, else the count */
export function countText(row: Pick<DocumentRow, 'achieved' | 'requested'>): { count: string; short?: true } {
  const n = row.achieved.toLocaleString('en');
  return row.requested !== undefined && row.achieved < row.requested
    ? { count: `${n} of ${row.requested.toLocaleString('en')}`, short: true }
    : { count: n };
}

/** The document's own row: its title, the copies drawn, its eye every row's */
export function documentRootRow(tree: DocumentTree, depth: number): DocumentRowDraft {
  return {
    key: DocumentKey,
    depth,
    label: tree.outline.title,
    kind: DocumentRowKinds.document,
    count: `${tree.outline.copies.toLocaleString('en')} copies`,
    visible: tree.visible,
    hasChildren: tree.outline.roots.length > 0,
    icon: 'file-code',
    doc: { id: '', select: '(all)' },
  };
}

/** A row of the document (its eye: none on a part, read-only in 3D, prism.md §4.1 and §11 question 12) */
export function documentRowOf(tree: DocumentTree, row: DocumentRow, depth: number): DocumentRowDraft {
  const visible = tree.looks.visible(row.id);
  const color = tree.looks.color(row.id);
  return {
    key: documentKey(row.id),
    depth,
    label: row.label,
    kind: DocumentRowKinds[row.kind],
    ...countText(row),
    ...(visible !== undefined ? { visible } : {}),
    ...(color !== undefined ? { color } : {}),
    hasChildren: row.children.length > 0 || !!row.parts,
    doc: { id: row.id, select: row.select },
  };
}

/**
 * The document's rows, in the tree's order, as `push` takes them (a row, then its children if it is open): its own row
 * under the Particles category, then its outline's. A part's rows are made only when its row is opened.
 */
export function pushDocumentRows(
  tree: DocumentTree,
  depth: number,
  push: (row: DocumentRowDraft, children: () => void) => void,
) {
  const walk = (ids: readonly DocumentRow[], d: number) => {
    for (const r of ids) push(documentRowOf(tree, r, d), () => walk(tree.outline.children(r.id), d + 1));
  };
  push(documentRootRow(tree, depth), () =>
    walk(
      tree.outline.roots.map((id) => tree.outline.row(id)!),
      depth + 1,
    ),
  );
}

/** The keys above a document row (its groups, the document's, the category's), nearest first; none if absent */
export function documentAncestorKeys(tree: DocumentTree | undefined, key: string): string[] | undefined {
  if (!tree || !key.startsWith(DocumentKey)) return undefined;
  if (key === DocumentKey) return ['c:particles'];
  const up = tree.outline.ancestors(key.slice(DocumentKey.length));
  return up && [...up.map(documentKey), DocumentKey, 'c:particles'];
}

/** A document row by its key, wherever it is (its parts made if need be); none if absent */
export function documentRowByKey(tree: DocumentTree | undefined, key: string): DocumentRowDraft | undefined {
  if (!tree || !key.startsWith(DocumentKey)) return undefined;
  if (key === DocumentKey) return documentRootRow(tree, 1);
  const id = key.slice(DocumentKey.length);
  const row = tree.outline.row(id);
  const depth = (tree.outline.ancestors(id)?.length ?? 0) + 2;
  return row && documentRowOf(tree, row, depth);
}

/** The document row a 3D pick is on (prism.md §4.6: a copy's population, instance or part row); none for another's */
export function documentPicked(
  api: ViewerApi,
  tree: DocumentTree | undefined,
  loci: Loci,
): { key: string; label: string; kind: string; doc: DocumentRef } | undefined {
  if (!tree || !Particle.isLoci(loci) || OrderedSet.size(loci.indices) === 0) return undefined;
  const source = loci.particles.sourceData as { kind?: string; name?: string } | undefined;
  if (source?.kind !== 'meso-view-spec' || !source.name) return undefined;
  const id = api.mesoviewspec?.rowOfCopy(source.name, OrderedSet.getAt(loci.indices, 0));
  const row = id !== undefined ? documentRowByKey(tree, documentKey(id)) : undefined;
  return row && { key: row.key, label: row.label, kind: row.kind, doc: row.doc };
}

/** Lights a document row's copies, over every list they are on (none: the document is not open) */
export function documentLoci(api: ViewerApi, ref: DocumentRef): readonly Loci[] {
  return api.mesoviewspec?.lociOf(ref.select) ?? [];
}

/**
 * A document row's ⋯ and right-click (prism.md §5.2, §6): Focus; Show only this, Show all again (look patches, one
 * step); the document's: Save, Close. A part's: Focus only (read-only in 3D). No Move: a document places its copies.
 */
export function documentMenuItems(
  api: ViewerApi,
  tree: DocumentTree | undefined,
  picked: { readonly label: string; readonly doc: DocumentRef },
): ContextMenuItem[] {
  const { doc, label } = picked;
  const items: ContextMenuItem[] = [];
  if (doc.select) {
    items.push({
      id: 'focus',
      label: `Focus on ${label}`,
      icon: 'scan',
      run: () => void api.run('mesoviewspec.focus', { select: doc.select }),
    });
  }
  const part = doc.id.includes('/');
  if (doc.select && doc.id && !part) {
    items.push({
      id: 'show-only',
      label: 'Show only this',
      icon: 'eye',
      run: () => void api.run('mesoviewspec.showOnly', { select: doc.select }),
    });
  }
  if (tree?.showsOnly) {
    items.push({
      id: 'show-all',
      label: 'Show all again',
      icon: 'eye',
      run: () => void api.run('mesoviewspec.showOnly', {}),
    });
  }
  if (!doc.id) {
    items.push(
      {
        id: 'save',
        label: 'Save the document',
        icon: 'save',
        run: async () => {
          const r = await api.run('mesoviewspec.save', { format: 'json' });
          const v = (r as { value?: { blob: Blob; filename: string } }).value;
          if (r.ok && v) downloadBlob(v.blob, v.filename);
        },
      },
      { id: 'remove', label: 'Close', icon: 'trash-2', run: () => void api.run('mesoviewspec.close', {}) },
    );
  }
  return items;
}
