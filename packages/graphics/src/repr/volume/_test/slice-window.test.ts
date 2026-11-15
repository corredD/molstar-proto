/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { SliceRing, SliceWindow, SliceWindowBudget, SliceWindowDepth } from '../slice-window.js';

describe('SliceRing', () => {
  it('holds index i at layer i mod N', () => {
    const ring = SliceRing.create(200, 32);
    expect(ring.depth).toBe(32);
    SliceRing.move(ring, 100);
    for (let i = ring.start; i < ring.start + ring.depth; ++i) {
      expect(SliceRing.has(ring, i)).toBe(true);
      expect(SliceRing.layer(ring, i)).toBe(i % 32);
    }
    expect(SliceRing.has(ring, ring.start - 1)).toBe(false);
    expect(SliceRing.has(ring, ring.start + ring.depth)).toBe(false);
  });

  it('fills all of it on the first move, centered', () => {
    const ring = SliceRing.create(200, 32);
    const entered = SliceRing.move(ring, 100);
    expect(entered.length).toBe(32);
    expect(ring.start).toBe(84);
    expect(SliceRing.has(ring, 100)).toBe(true);
  });

  it('moves within its band without a copy', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    for (const i of [92, 93, 100, 107, 92]) expect(SliceRing.move(ring, i)).toEqual([]);
    expect(ring.start).toBe(84);
  });

  it('near an edge, replaces only the slices that left by those that entered, plane by plane', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    // the band is [start + 8, start + 24): 108 is one past it
    expect(SliceRing.move(ring, 108)).toEqual([116]);
    expect(ring.start).toBe(85);
    expect(SliceRing.move(ring, 111)).toEqual([117, 118, 119]);
    expect(ring.start).toBe(88);
    // the other way
    expect(SliceRing.move(ring, 96)).toEqual([]);
    expect(SliceRing.move(ring, 94)).toEqual([86, 87]);
    expect(ring.start).toBe(86);
    // the layers of the entered slices are those the left ones held
    for (let i = ring.start; i < ring.start + 32; ++i) expect(SliceRing.layer(ring, i)).toBe(i % 32);
  });

  it('a jump far away refills it', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    const entered = SliceRing.move(ring, 20);
    expect(entered.length).toBe(32);
    expect(ring.start).toBe(4);
  });

  it('stays at the ends of the axis', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 0);
    expect(ring.start).toBe(0);
    expect(SliceRing.move(ring, 3)).toEqual([]);
    SliceRing.move(ring, 199);
    expect(ring.start).toBe(168);
    expect(SliceRing.move(ring, 197)).toEqual([]);
  });

  it('an axis shorter than N is filled once, never copied again', () => {
    const ring = SliceRing.create(20, 32);
    expect(ring.depth).toBe(20);
    expect(SliceRing.move(ring, 5).length).toBe(20);
    for (const i of [0, 19, 7, 12]) expect(SliceRing.move(ring, i)).toEqual([]);
  });

  it('reset empties it: the next move refills', () => {
    const ring = SliceRing.create(200, 32);
    SliceRing.move(ring, 100);
    SliceRing.reset(ring);
    expect(SliceRing.move(ring, 100).length).toBe(32);
  });
});

describe('SliceWindow memory', () => {
  it('holds fewer planes where 32 would pass its byte budget, at least 4; none past that', () => {
    expect(SliceWindow.getDepth(512 * 720, 225)).toBe(SliceWindowDepth);
    // a 2048² plane of floats is 16 MB: 8 planes in 128 MB
    expect(SliceWindow.getDepth(2048 * 2048, 500)).toBe(8);
    expect(SliceWindow.getDepth(2048 * 2048, 5)).toBe(5);
    expect(SliceWindow.getDepth(8192 * 8192, 500)).toBe(0);
    expect(SliceWindowBudget).toBe(128 * 1024 * 1024);
  });
});
