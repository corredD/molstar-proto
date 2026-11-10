/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { IdPattern, type Issue, type MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { quoted } from '@molstar/prism-viewer/agent/account';
import type { Counts } from './document-tree.js';

// What the agent is told of the open document at the start of each turn (prism.md §8, agent.md §5): the document's
// outline joins the scene's as one line a compartment (its populations and their counts), the view shown and the
// issues' count. The ids are the ones a MesoQL address is written with. Text from the document (a title, a label, an
// issue's message, an id that is not one) is data: `quoted`. At most `MaxStateLines` lines; `get_mesoviewspec` says the
// rest.

const MaxStateLines = 24;

/** An id as written, when it is one (a MesoQL address names it so); else quoted, as any text from the document. */
export function idText(x: unknown, pattern: RegExp = IdPattern): string {
  return typeof x === 'string' && pattern.test(x) ? x : quoted(String(x));
}

/** A version as written (`0.4`), else quoted. */
const VersionPattern = /^[\w.+-]+$/;

export interface DocumentStateInput {
  readonly doc: MesoViewSpecDoc;
  readonly counts: Counts;
  /** The view shown (its id); none: the document's first. */
  readonly shown: string | undefined;
  readonly issues: readonly Issue[];
}

/**
 * Characters a state line says at most (a compartment's line names all its populations: the exosome's 13 with their
 * counts are ~600), and the whole state.
 */
export const MaxStateLineChars = 800;
export const MaxStateChars = 4000;
/** Nesting said by indentation, at most (deeper compartments are said at this depth). */
const MaxDepthShown = 8;

const capped = (line: string) =>
  line.length > MaxStateLineChars ? `${line.slice(0, MaxStateLineChars - 1)}…` : line;

/**
 * `head` and `count` items after it (`first` before the first, `, ` between) while the line has room; the rest counted
 * (`… 480 more populations`). Items are made only as they fit.
 */
function listLine(head: string, first: string, count: number, item: (i: number) => string, rest: string): string {
  let line = head;
  let i = 0;
  for (; i < count; i++) {
    const next = `${i ? ', ' : first}${item(i)}`;
    // the room of the count of the rest
    if (line.length + next.length > MaxStateLineChars - 40) break;
    line += next;
  }
  if (i < count) line += `${i ? ', ' : first}… ${count - i} more ${rest}`;
  return capped(line);
}

type Compartment = MesoViewSpecDoc['compartments'][number];
type Population = MesoViewSpecDoc['populations'][number];
type Instance = NonNullable<MesoViewSpecDoc['instances']>[number];

function groupBy<T>(items: readonly T[], key: (x: T) => unknown): Map<unknown, T[]> {
  const out = new Map<unknown, T[]>();
  for (const x of items) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

export function documentState({ doc, counts, shown, issues }: DocumentStateInput, max = MaxStateLines): string {
  const copies = Object.values(counts).reduce((n, c) => n + c.achieved, 0);
  const head = capped(`MesoViewSpec document ${quoted(doc.metadata?.title || 'Untitled')}: ${copies} copies drawn.`);
  const views = doc.views ?? [];
  const view = views.find((v) => v.id === shown) ?? views[0];
  const tail = [
    view
      ? listLine(
          `- shown view ${idText(view.id)}${view.label ? ` ${quoted(view.label)}` : ''}; views`,
          ' ',
          views.length,
          (i) => idText(views[i].id),
          'views',
        )
      : '- shown view: none (the document has no views)',
    `- issues ${issues.length}`,
  ];

  // indexed once by compartment; the compartments in tree order (each once, whatever their parents say)
  const children = groupBy(doc.compartments, (c) => c.parent);
  const populations = groupBy(doc.populations, (p) => p.compartment);
  const instances = groupBy(doc.instances ?? [], (i) => i.compartment);
  const order: { readonly c: Compartment; readonly depth: number }[] = [];
  const seen = new Set<Compartment>();
  const walk = (parent: unknown, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      order.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);

  const compartmentLine = ({ c, depth }: (typeof order)[number]) => {
    const pops: readonly Population[] = populations.get(c.id) ?? [];
    const insts: readonly Instance[] = instances.get(c.id) ?? [];
    const item = (i: number) => {
      if (i >= pops.length) {
        const x = insts[i - pops.length];
        return `${idText(x.id)} (${idText(x.entity)}) instance`;
      }
      const p = pops[i];
      const n = counts[p.id];
      return `${idText(p.id)} (${idText(p.entity)}) ${n ? `${n.achieved}${n.requested !== undefined ? ` of ${n.requested}` : ''}` : 'not placed'}`;
    };
    return listLine(
      `${'  '.repeat(Math.min(depth, MaxDepthShown))}- compartment ${idText(c.id)} ${quoted(c.label)}`,
      ': ',
      pops.length + insts.length,
      item,
      'populations or instances',
    );
  };

  // the lines of the compartments: those that fit, then the count of the rest (its line in the room)
  const more = (n: number) => `… ${n} more compartments (get_mesoviewspec gives all of it).`;
  const room = Math.max(1, max - 1 - tail.length);
  const fits = order.length <= room ? order.length : room - 1;
  let chars = head.length + tail.reduce((n, l) => n + l.length + 1, 0) + more(order.length).length + 1;
  const body: string[] = [];
  for (let i = 0; i < fits; i++) {
    const line = compartmentLine(order[i]);
    if (chars + line.length + 1 > MaxStateChars) break;
    body.push(line);
    chars += line.length + 1;
  }
  if (body.length < order.length) body.push(more(order.length - body.length));
  return [head, ...body, ...tail].join('\n');
}

const MaxIssuesListed = 5;

/** The issues' messages, the first few (an open's or an edit's warnings, `get`'s Issues). */
export const issueLines = (issues: readonly Issue[]) => {
  const lines = issues.slice(0, MaxIssuesListed).map((i) => idText(i.message));
  if (issues.length > MaxIssuesListed) lines.push(`and ${issues.length - MaxIssuesListed} more`);
  return lines;
};

/** `get_mesoviewspec`'s summary, and with `outline` the compartments' tree. */
export function describeDocument(
  doc: MesoViewSpecDoc,
  counts: Counts,
  issues: readonly Issue[],
  detail: 'summary' | 'outline',
): string {
  const lines = [`${quoted(doc.metadata?.title || 'Untitled')} (${idText(doc.format)} ${idText(doc.version, VersionPattern)})`];
  if (detail === 'outline') {
    const walk = (parent: string | undefined, depth: number) => {
      for (const c of doc.compartments.filter((c) => c.parent === parent)) {
        lines.push(`${'  '.repeat(depth + 1)}${idText(c.id)}: ${quoted(c.label)} (${idText(c.kind)})`);
        for (const p of doc.populations.filter((p) => p.compartment === c.id))
          lines.push(populationLine(p, counts, depth + 2));
        walk(c.id, depth + 1);
      }
    };
    lines.push('Compartments:');
    walk(undefined, 0);
  } else {
    lines.push('Populations:');
    for (const p of doc.populations) lines.push(populationLine(p, counts, 1));
  }
  lines.push(
    `Models: ${doc.models?.length ?? 0}`,
    `Views: ${doc.views?.length ?? 0}`,
    `Issues: ${issues.length}${issues.length ? ` (${issueLines(issues).join('; ')})` : ''}`,
  );
  return lines.join('\n');
}

function populationLine(p: MesoViewSpecDoc['populations'][number], counts: Counts, depth: number): string {
  const c = counts[p.id];
  const n = c ? `${c.achieved}${c.requested !== undefined ? ` of ${c.requested}` : ''}` : 'not placed';
  return `${'  '.repeat(depth)}${idText(p.id)} (${idText(p.entity)}): ${n}`;
}
