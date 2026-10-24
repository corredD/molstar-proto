/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { LabelInfo } from '@molstar/stage-tools-extension/operations';
import { describe, expect, it } from 'vitest';
import type { SceneObject } from '../operations.js';
import { type Row, rowsOf, treeKey } from '../rows.js';

// The scene tree's keys over its rows as shown: a category, an open object with two parts (the first with a child
// part, closed), a closed object.

const row = (key: string, depth: number, kind: string, hasChildren = false): Row => ({
  key,
  depth,
  label: key,
  kind,
  hasChildren,
  ...(kind === 'category' ? {} : { node: { ref: key } }),
});

const rows: Row[] = [
  row('c:structures', 0, 'category', true),
  row('a', 1, 'structure', true),
  row('a1', 2, 'entity', true),
  row('a2', 2, 'entity'),
  row('b', 1, 'structure', true),
];
const open = new Set(['c:structures', 'a']);

describe('the scene tree keys', () => {
  it('go down and up the rows, past the categories, and stop at the ends', () => {
    expect(treeKey(rows, open, undefined, 'ArrowDown')).toEqual({ pick: 'a' });
    expect(treeKey(rows, open, 'a', 'ArrowDown')).toEqual({ pick: 'a1' });
    expect(treeKey(rows, open, 'a2', 'ArrowDown')).toEqual({ pick: 'b' });
    expect(treeKey(rows, open, 'b', 'ArrowDown')).toBeUndefined();
    expect(treeKey(rows, open, 'a1', 'ArrowUp')).toEqual({ pick: 'a' });
    expect(treeKey(rows, open, 'a', 'ArrowUp')).toBeUndefined();
  });

  it('open a closed row, then go to its first child; close an open one, then go to its parent', () => {
    expect(treeKey(rows, open, 'b', 'ArrowRight')).toEqual({ toggle: 'b' });
    expect(treeKey(rows, open, 'a', 'ArrowRight')).toEqual({ pick: 'a1' });
    expect(treeKey(rows, open, 'a2', 'ArrowRight')).toBeUndefined();
    expect(treeKey(rows, open, 'a', 'ArrowLeft')).toEqual({ toggle: 'a' });
    expect(treeKey(rows, open, 'a2', 'ArrowLeft')).toEqual({ pick: 'a' });
    // a top object's parent is a category: nothing to go to
    expect(treeKey(rows, open, 'b', 'ArrowLeft')).toBeUndefined();
  });

  it('leave other keys alone', () => {
    expect(treeKey(rows, open, 'a', 'Enter')).toBeUndefined();
  });
});

// A model's rows (_spec/ui.md §3) from its info, grouped by compartment or by function: lipids (function "membrane")
// in root.membrane, CA in root.capsid.

const model: SceneObject = { ref: 'm', category: 'particles', kind: 'model', label: 'HIV', visible: true };
const group = (path: string, entities: number[], groups: MesoGroup[] = []): MesoGroup => ({
  path,
  label: path.slice(path.lastIndexOf('.') + 1),
  groups,
  entities,
});
const infoOf = (groupBy: MesoscaleInfo['groupBy'], hasCompartments: boolean): MesoscaleInfo => ({
  particles: 'm',
  label: 'HIV',
  count: 3,
  entities: [
    { id: 0, name: 'lipids', function: 'membrane', count: 2, compartment: 0, visible: true },
    { id: 1, name: 'CA', count: 1, compartment: 1, visible: true },
  ],
  groups:
    groupBy === 'compartment'
      ? group('', [], [group('root', [], [group('root.membrane', [0]), group('root.capsid', [1])])])
      : group('', [], [group('membrane', [0]), group('unknown function', [1])]),
  groupBy,
  hasCompartments,
});
const keysOf = (info: MesoscaleInfo, labels: readonly LabelInfo[] = []) =>
  rowsOf([model], new Map([['m', info]]), AllOpen, '', labels).map((r) => `${r.depth}:${r.key}`);
const AllOpen = { has: () => true } as unknown as ReadonlySet<string>;

describe("a model's group rows", () => {
  it('key a function apart from a compartment when the model has compartments, and as before when it has none', () => {
    expect(keysOf(infoOf('function', true))).toContain('2:g:m:fn:membrane');
    // a model without compartments: the keys of sessions saved before the switch (a label's row)
    expect(keysOf(infoOf('function', false))).toContain('2:g:m:membrane');
    expect(keysOf(infoOf('compartment', true))).toContain('3:g:m:root.membrane');
  });
});

describe("a label on a model's group row", () => {
  const label = (node: string) => ({ ref: 'lab', text: 'capsid', node, visible: true }) as LabelInfo;
  it('stays under its model while the group is not shown (another grouping), and goes back under it after', () => {
    const labels = [label('g:m:root.capsid')];
    const byCompartment = keysOf(infoOf('compartment', true), labels);
    expect(byCompartment.slice(byCompartment.indexOf('3:g:m:root.capsid'))).toEqual([
      '3:g:m:root.capsid',
      '4:me:m:1',
      '4:l:lab',
    ]);
    const byFunction = keysOf(infoOf('function', true), labels);
    // under the model: after its own children, one level below it
    expect(byFunction).toContain('2:l:lab');
    expect(byFunction.indexOf('2:l:lab')).toBe(byFunction.length - 1);
    expect(byFunction[byFunction.indexOf('1:o:m')]).toBe('1:o:m');
  });
});
