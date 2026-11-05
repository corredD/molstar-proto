/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import { checkLinear, scaling } from '../../../../../packages/sequences/core/_test/model/scaling.js';
import { wayOf } from '../clips.js';

// `wayOf` for a part of N entities, one record holding all of them (`test:scaling`; A8, AGENTS' "never `includes`"): it
// runs on every state change while a clip's row is shown. `includes` per id reads about x16 at 4n.

it('wayOf of a part of N entities', () => {
  const s = scaling(
    {
      setup: (n) => {
        const ids = Array.from({ length: n }, (_, i) => i);
        const record = { tag: 't', entities: ids, compartments: [], targets: [], mode: 'cut', band: 60, fuzziness: 0 };
        return {
          of: { ref: 'r', on: [], records: [record] } as never,
          node: { ref: 'r', particles: { entities: ids } },
        };
      },
      run: ({ of, node }) => {
        if (!wayOf(of, node)) throw new Error('mixed');
      },
    },
    2000,
  );
  checkLinear('wayOf, N entities', s);
  expect(s.n).toBe(2000);
}, 300_000);
