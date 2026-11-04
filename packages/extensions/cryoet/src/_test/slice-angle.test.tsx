/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { afterEach, describe, expect, it } from 'vitest';
import { Slice, tiltAngleText } from '../controls.js';
import type { CryoetApi, SliceAxis, SliceInfo } from '../operations.js';

// A tilt series' Slice row (prism-me's properties, _spec/portal.md §4): the Z slice's image and, on a line under it, its
// tilt angle, the image counted from 1 in the box, its angle by its index from 0 (10003 TS_08: 41 images, −60.005° first).

afterEach(() => {
  document.body.innerHTML = '';
});

/** 10003 TS_08's angles, at the ends and the middle; the rest a step of 3° */
const angles = Array.from({ length: 41 }, (_, i) =>
  i === 0 ? -60.005 : i === 20 ? -0.0074 : i === 40 ? 59.9898 : -60 + 3 * i,
);

function mounted(axis: SliceAxis, angleList: readonly number[] | undefined = angles) {
  const info = observableState<SliceInfo | undefined>({
    // x as many as z: only the axis tells the Z slice
    dimensions: [41, 928, 41],
    slices: [{ axis, index: 0, ref: 's', visible: true }],
    obliques: [],
    radius: 1,
  });
  const area = { sliceState: () => info.asReadonly } as unknown as CryoetApi;
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Slice area={area} volume="v" axis={axis} angles={angleList} />, host);
  const at = (index: number) => info.set({ ...info.value!, slices: [{ ...info.value!.slices[0], index }] });
  return { host, at };
}

describe("a tilt series' angle", () => {
  it('is the angle of the image at an index from 0: the ends and the middle', () => {
    expect(tiltAngleText(angles, 0)).toBe('−60.005°');
    expect(tiltAngleText(angles, 20)).toBe('−0.007°');
    expect(tiltAngleText(angles, 40)).toBe('59.99°');
    expect(tiltAngleText(angles, 41)).toBe('');
    expect(tiltAngleText(undefined, 0)).toBe('');
  });

  it("follows the Z slice on a Tilt line of its own: image 1 of 41 is the first angle's", () => {
    const { host, at } = mounted('z');
    const spans = () => Array.from(host.querySelectorAll('span'), (x) => x.textContent ?? '');
    // the slider's unit stays the count: its track's width never depends on the angle (review S1)
    const unit = () => spans().filter((t) => t.startsWith('/ '));
    const tilt = () => spans()[spans().indexOf('Tilt') + 1];
    expect(unit()).toEqual(['/ 41']);
    expect(tilt()).toBe('−60.005°');
    at(20);
    expect(tilt()).toBe('−0.007°');
    at(40);
    expect(tilt()).toBe('59.99°');
    expect(unit()).toEqual(['/ 41']);
  });

  it('is not on another axis, nor without angles for each image', () => {
    expect(mounted('x').host.textContent).not.toContain('°');
    document.body.innerHTML = '';
    expect(mounted('z', angles.slice(1)).host.textContent).not.toContain('°');
  });
});
