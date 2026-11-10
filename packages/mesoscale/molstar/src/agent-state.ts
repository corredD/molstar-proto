/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Issue, MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { quoted } from '@molstar/prism-viewer/agent/account';
import type { Counts } from './document-tree.js';

// What the agent is told of the open document at the start of each turn (prism.md §8, agent.md §5): the document's
// outline joins the scene's as one line a compartment (its populations and their counts), the view shown and the
// issues' count. The ids are the ones a MesoQL address is written with. Text from the document (a title, a label) is
// data: `quoted`. At most `MaxStateLines` lines; `get_mesoviewspec` says the rest.

const MaxStateLines = 24;

export interface DocumentStateInput {
  readonly doc: MesoViewSpecDoc;
  readonly counts: Counts;
  /** The view shown (its id); none: the document's first. */
  readonly shown: string | undefined;
  readonly issues: readonly Issue[];
}

export function documentState({ doc, counts, shown, issues }: DocumentStateInput, max = MaxStateLines): string {
  const copies = Object.values(counts).reduce((n, c) => n + c.achieved, 0);
  const lines = [`MesoViewSpec document ${quoted(doc.metadata?.title || 'Untitled')}: ${copies} copies drawn.`];
  const compartments: string[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const c of doc.compartments.filter((x) => x.parent === parent)) {
      const parts = [
        ...doc.populations
          .filter((p) => p.compartment === c.id)
          .map((p) => {
            const n = counts[p.id];
            return `${p.id} (${p.entity}) ${n ? `${n.achieved}${n.requested !== undefined ? ` of ${n.requested}` : ''}` : 'not placed'}`;
          }),
        ...(doc.instances ?? []).filter((i) => i.compartment === c.id).map((i) => `${i.id} (${i.entity}) instance`),
      ];
      compartments.push(
        `${'  '.repeat(depth)}- compartment ${c.id} ${quoted(c.label)}${parts.length ? `: ${parts.join(', ')}` : ''}`,
      );
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // The two lines that follow the compartments are kept.
  const room = Math.max(1, max - lines.length - 2);
  lines.push(...compartments.slice(0, room));
  if (compartments.length > room) {
    lines.push(`… ${compartments.length - room} more compartments (get_mesoviewspec gives all of it).`);
  }
  const views = doc.views ?? [];
  const view = views.find((v) => v.id === shown) ?? views[0];
  lines.push(
    view
      ? `- shown view ${view.id}${view.label ? ` ${quoted(view.label)}` : ''}; views ${views.map((v) => v.id).join(', ')}`
      : '- shown view: none (the document has no views)',
    `- issues ${issues.length}`,
  );
  return lines.join('\n');
}
