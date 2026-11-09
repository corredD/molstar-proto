/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { LazyViewerExtension } from '@molstar/prism-viewer/spec';

// The MesoViewSpec extension as a lazy stub (prism.md §3, §5.3): the operations and commands it will bring, and the
// files it opens as documents. This file imports types only: the document model, the resolvers and the format are in
// the chunk (`extension.ts`), loaded at the first call or the first dropped document.

const category = 'MesoViewSpec';

/** The document files `.mesoviewspec.json`, and any json that says so in its first 64 KiB. */
const FormatText = /"format"\s*:\s*"meso_view_spec"/;
const SniffedBytes = 64 * 1024;

function claims(file: { readonly name: string }, content: string | Uint8Array): boolean {
  if (/\.mesoviewspec\.json$/i.test(file.name)) return true;
  const head =
    typeof content === 'string'
      ? content.slice(0, SniffedBytes)
      : new TextDecoder().decode(content.subarray(0, SniffedBytes));
  return FormatText.test(head);
}

/**
 * What an open reaches (prism.md §3, the agent's policy): the document's address, and every absolute address a
 * document given as data names (its resources), read before anything is fetched. A URL's resources are known only once
 * it is read: its own address is what is judged.
 */
export function openAddresses(v: { readonly url?: string; readonly data?: string }): string[] {
  const out = v.url ? [v.url] : [];
  if (typeof v.data === 'string') for (const m of v.data.matchAll(/https?:\/\/[^\s"'()[\]{}<>\\]+/g)) out.push(m[0]);
  return out;
}

export const MesoViewSpecLazyExtension: LazyViewerExtension = {
  id: 'mesoviewspec',
  title: 'MesoViewSpec',
  stub: {
    parts: [],
    operations: [
      {
        id: 'mesoviewspec.open',
        title: 'Open a MesoViewSpec document',
        approval: 'network',
        addresses: openAddresses,
      },
      { id: 'mesoviewspec.close', title: 'Close the MesoViewSpec document', approval: 'destructive' },
      { id: 'mesoviewspec.get', title: 'Describe the MesoViewSpec document', read: true },
      { id: 'mesoviewspec.edit', title: 'Edit the MesoViewSpec document' },
      { id: 'mesoviewspec.save', title: 'Save the MesoViewSpec document', history: false, undoable: false },
    ],
    commands: [
      { id: 'mesoviewspec.open', title: 'Open a MesoViewSpec document', category, icon: 'folder-open' },
      { id: 'mesoviewspec.close', title: 'Close the MesoViewSpec document', category, icon: 'x' },
      { id: 'mesoviewspec.get', title: 'Describe the MesoViewSpec document', category, icon: 'info' },
      { id: 'mesoviewspec.edit', title: 'Edit the MesoViewSpec document', category, icon: 'pencil' },
      { id: 'mesoviewspec.save', title: 'Save the MesoViewSpec document', category, icon: 'save' },
    ],
    owns: {
      transformers: ['ms-plugin.meso-view-spec-placements'],
      fileExtensions: ['mesoviewspec'],
      sniff: { extensions: ['json'], test: claims },
      opens: 'mesoviewspec.open',
    },
  },
  load: async () => (await import('./extension.js')).MesoViewSpecExtension,
};
