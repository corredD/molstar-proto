/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { type PaintStroke, paintParticles, paintRotations } from '../paint.js';
import { cellpackLike } from './fixtures.js';

// A stroke of N copies (`test:scaling`; apps/prism-me/AGENTS.md, no accidental quadratic): its orientations
// (`paintRotations`) and the list with its copies (`paintParticles`, the decorator's apply), at n and 4n copies, in
// strokes of 16 (a session's many strokes: no rebuild or scan per stroke), over a list of 4n particles.

const PerStroke = 16;

function strokes(n: number): PaintStroke[] {
  const out: PaintStroke[] = [];
  for (let s = 0; s * PerStroke < n; ++s) {
    const k = Math.min(PerStroke, n - s * PerStroke);
    const positions = Array.from({ length: k * 3 }, (_, i) => s * 100 + i);
    const normals = Array.from({ length: k * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0));
    out.push({ target: 1, entity: 1, compartment: 1, positions, rotations: paintRotations(normals, 'normal', s) });
  }
  return out;
}

/** A cellPACK-like list of `n` particles (the fixture's seven, repeated) */
function list(n: number) {
  const base = cellpackLike();
  const count = n;
  return {
    ...base,
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: Int32Array.from({ length: count }, (_, i) => base.targets[i % base.count]),
    compartments: Int32Array.from({ length: count }, (_, i) => base.compartments![i % base.count]),
    coordinates: new Float32Array(count * 3),
  };
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('the orientations of a stroke of N copies', () => {
  const s = scaling(
    {
      setup: (n) => Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 1 : (i % 7) / 7)),
      run: (normals) => {
        paintRotations(normals, 'normal', 1);
      },
    },
    20000,
  );
  checkLinear('paintRotations, N copies', s);
});

it('a list painted with N copies in strokes of 16', () => {
  const s = scaling(
    {
      setup: (n) => ({ input: list(4 * n), strokes: strokes(n) }),
      run: ({ input, strokes }) => {
        if (
          paintParticles(input, strokes).count !==
          input.count + strokes.reduce((k, x) => k + x.positions.length / 3, 0)
        )
          throw new Error('miscounted');
      },
    },
    20000,
  );
  checkLinear('paintParticles, N copies', s);
});
