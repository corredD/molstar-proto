/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Compartment, Entity, MesoViewSpecDoc, Population } from '@molstar/meso-spec/format';
import { type IR, type IRLook, type IRNode, PlacementBuilder, type PlacementType } from '@molstar/meso-spec/ir';
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  type BulkCase,
  describeScaling,
  isLinear,
  quadraticControl,
  scaling,
} from '../../../../sequences/core/_test/model/scaling.js';
import { documentLooks, documentOutline, OutlineStats } from '../document-tree.js';

// The Scene tree's rows over the open document at n and 4n populations (`test:scaling`; apps/prism-me/AGENTS.md, no
// accidental quadratic): the outline made, every row walked, every row's eye and dot read (`documentLooks`): each
// indexed once, the cost a row and a (set, type), never a scan of the populations per row. And the incremental promise
// (prism.md §4.1): a view edit, which shares every section of the document and the IR's tree, makes no row again.
// Pure: no viewer, a fake IR with one placement set and a type a population.

// The band is 10 for ×4 (the harness's is 8). The tree's maps (every row, every (set, type), the memos) leave the cache as
// n grows, so a linear read costs about ×5 to ×9 in time for ×4 (its allocation reads ×3.9); the controls, which scan
// the populations once a row, read ×14 and more: the band sits between them.
const Band = 10;

/** `SCALING_REPORT=<file>` appends the numbers there, as `checkLinear` does. */
function report(name: string, s: ReturnType<typeof scaling>) {
  if (process.env.SCALING_REPORT) appendFileSync(process.env.SCALING_REPORT, `${name} | ${describeScaling(s)}\n`);
}
const Compartments = 4;
const Kinds = ['protein', 'lipid', 'nucleic-acid', 'complex'] as const;

/** A document of `n` populations (and an entity each) over a few nested compartments, its IR and its counts. */
function synthetic(n: number) {
  const compartments: Compartment[] = Array.from({ length: Compartments }, (_, i) => ({
    id: `c.${i}`,
    label: `Compartment ${i}`,
    kind: 'organelle',
    // c.0 is the top, c.1 and c.2 in it, c.3 in c.1
    ...(i === 0 ? {} : { parent: i === 3 ? 'c.1' : 'c.0' }),
    geometry: { kind: 'sphere', radius: 100 },
  })) as Compartment[];
  const entities: Entity[] = [];
  const populations: Population[] = [];
  const typeTable: PlacementType[] = [];
  const looks: IRLook[] = [];
  const counts: Record<string, { achieved: number; requested?: number }> = {};
  const builder = new PlacementBuilder(n);
  for (let i = 0; i < n; i++) {
    const compartment = `c.${i % Compartments}`;
    entities.push({ id: `e.${i}`, label: `Entity ${i}`, kind: Kinds[i % Kinds.length] } as Entity);
    populations.push({
      id: `p.${i}`,
      entity: `e.${i}`,
      compartment,
      location: 'interior',
      abundance: { count: 1 + (i % 5) },
    } as Population);
    typeTable.push({
      index: i,
      population: `p.${i}`,
      entity: `e.${i}`,
      label: `Entity ${i}`,
      compartment,
      radius: 5,
    });
    builder.push(i, i, 0, 0, [0, 0, 0, 1]);
    counts[`p.${i}`] = { achieved: 1, requested: 1 + (i % 5) };
    looks.push({ set: 'm.pack#0', types: [i], color: i % 0xffffff, visible: i % 7 !== 0 });
  }
  const set = builder.finish({ key: 'm.pack#0', model: 'm.pack', frame: 'f.world', typeTable });
  const root: IRNode = {
    ref: 'scene',
    kind: 'scene',
    params: { units: 'A', title: 'synthetic' },
    children: [{ ref: 'm.pack/placements', kind: 'placements', params: { set } }],
  };
  const doc = {
    format: 'meso_view_spec',
    version: 1,
    metadata: { title: 'Synthetic' },
    compartments,
    entities,
    populations,
    views: [{ id: 'v.a', label: 'A', looks: [] }],
  } as unknown as MesoViewSpecDoc;
  const ir: IR = { root, view: { id: 'v.a', looks } };
  return { doc, ir, counts };
}
type State = ReturnType<typeof synthetic>;

/** Every row of an outline, by walking from its roots. */
function walkRows(outline: ReturnType<typeof documentOutline>): string[] {
  const out: string[] = [];
  const stack = [...outline.roots];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of outline.children(id)) stack.push(c.id);
  }
  return out;
}

/** The tree's whole read of a document: the outline, every row, every row's eye and dot. */
function readTree({ doc, ir, counts }: State): number {
  const outline = documentOutline(doc, ir, counts);
  const looks = documentLooks(outline, ir);
  let shown = 0;
  const rows = walkRows(outline);
  for (const id of rows) {
    if (looks.visible(id)) shown++;
    if (looks.color(id) === -1) shown--;
  }
  if (rows.length < doc.populations.length) throw new Error('rows missing');
  return shown;
}

const treeCase: BulkCase<State> = { setup: synthetic, run: readTree };

// the same read, with a scan of the populations per row: the pattern the guard is for
const scanCase: BulkCase<State> = {
  setup: synthetic,
  run: ({ doc, ir, counts }) => {
    const outline = documentOutline(doc, ir, counts);
    const looks = documentLooks(outline, ir);
    let found = 0;
    for (const id of walkRows(outline)) {
      let same = 0;
      for (const p of doc.populations) if (p.entity === id) same++;
      if (same === 0) found++;
      looks.visible(id);
    }
    if (found < doc.populations.length) throw new Error('control');
  },
};

it('the positive control (a copy per item) is caught', () => {
  const s = scaling(quadraticControl, 4000);
  report('quadratic control', s);
  expect(isLinear(s, Band), describeScaling(s)).toBe(false);
});

it('the measure sees a scan of the populations per row (a pass over them a row: ×16)', () => {
  const s = scaling(scanCase, 2000, { reps: 3 });
  report('a scan per row', s);
  expect(s.timeRatio, describeScaling(s)).toBeGreaterThan(Band);
});

it('the outline, every row, every eye and dot, over n and 4n populations', () => {
  // the time of a read is about ×5 to ×10 here (above): a noisy run (the machine's, a collection in the larger one) is
  // measured again, up to three times; a quadratic path reads ×17 or more every time
  let s = scaling(treeCase, 2000, { reps: 5 });
  report('document tree, N populations', s);
  for (let attempt = 1; attempt < 3 && !isLinear(s, Band); attempt++) {
    s = scaling(treeCase, 2000, { reps: 5 });
    report(`document tree, N populations (attempt ${attempt + 1})`, s);
  }
  expect(isLinear(s, Band), `document tree, N populations: ${describeScaling(s)}`).toBe(true);
});

it('a view edit makes no row again: the same outline, the same row objects, the eyes read again', () => {
  const { doc, ir, counts } = synthetic(2000);
  const outline = documentOutline(doc, ir, counts);
  const ids = walkRows(outline);
  const rows = ids.map((id) => outline.row(id));
  const looks = documentLooks(outline, ir);
  expect(looks.visible('p.0')).toBe(false);
  const made = OutlineStats.made;

  // a look edit: every section the same, the IR's tree the same, a new view (as `updateView` makes it)
  const edited: MesoViewSpecDoc = {
    ...doc,
    views: [{ id: 'v.a', label: 'A', looks: [{ select: '(all)', visible: true }] }],
  };
  expect(edited.populations).toBe(doc.populations);
  const irEdited: IR = {
    root: ir.root,
    view: { ...ir.view, looks: ir.view.looks.map((l) => ({ ...l, visible: true })) },
  };
  const again = documentOutline(edited, irEdited, counts);
  expect(OutlineStats.made).toBe(made);
  expect(again).toBe(outline);
  expect(ids.every((id, i) => again.row(id) === rows[i])).toBe(true);
  const eyes = documentLooks(again, irEdited);
  expect(eyes.visible('p.0')).toBe(true);
  expect(eyes.visible('c.0')).toBe(true);
  expect(looks.visible('p.0')).toBe(false);

  // a model edit (new counts) does make them: the guard can see a rebuild
  const counted = documentOutline(edited, irEdited, { ...counts, 'p.1': { achieved: 7, requested: 7 } });
  expect(OutlineStats.made).toBe(made + 1);
  expect(counted).not.toBe(outline);
  expect(counted.row('p.1')?.achieved).toBe(7);
}, 60_000);
