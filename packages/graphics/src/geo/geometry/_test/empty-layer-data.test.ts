/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { createClipping, createEmptyClipping } from '../clipping-data.js';
import { createEmissive, createEmptyEmissive } from '../emissive-data.js';
import { createEmptyMarkers, createMarkers } from '../marker-data.js';
import { createEmptyOverpaint, createOverpaint } from '../overpaint-data.js';
import { createEmptySubstance, createSubstance } from '../substance-data.js';
import { createEmptyTransparency, createTransparency } from '../transparency-data.js';
import { createEmptyWiggle, createWiggle } from '../wiggle-data.js';

// A layer's data reuses the array it has when large enough (`createDataArray`): two visuals made empty and then given
// a few elements each (a particle target of four copies) must not write into one shared array.

const layers: [string, (d?: any) => any, (n: number, d: any) => any, string][] = [
  ['clipping', createEmptyClipping, (n, d) => createClipping(n, 'instance', d), 'tClipping'],
  ['transparency', createEmptyTransparency, (n, d) => createTransparency(n, 'instance', d), 'tTransparency'],
  ['emissive', createEmptyEmissive, (n, d) => createEmissive(n, 'instance', d), 'tEmissive'],
  ['marker', createEmptyMarkers, (n, d) => createMarkers(n, 'instance', d), 'tMarker'],
  ['overpaint', createEmptyOverpaint, (n, d) => createOverpaint(n, 'instance', d), 'tOverpaint'],
  ['substance', createEmptySubstance, (n, d) => createSubstance(n, 'instance', d), 'tSubstance'],
  ['wiggle', createEmptyWiggle, (n, d) => createWiggle(n, 'instance', d), 'tWiggle'],
];

describe('empty layer data', () => {
  for (const [name, empty, create, key] of layers) {
    it(`${name}: two visuals of one element each have arrays of their own`, () => {
      const a = create(1, empty());
      const b = create(1, empty());
      expect(a[key].ref.value.array).not.toBe(b[key].ref.value.array);
      // emptied again and refilled: still their own
      const c = create(1, empty(a));
      expect(c[key].ref.value.array).not.toBe(b[key].ref.value.array);
    });
  }
});
