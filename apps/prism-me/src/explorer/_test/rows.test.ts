/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { type Row, treeKey } from '../rows.js';

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
