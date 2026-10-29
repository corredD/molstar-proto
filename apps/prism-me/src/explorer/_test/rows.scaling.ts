/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import { keepRows } from '@molstar/prism-ui';
import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../../packages/sequences/core/_test/model/scaling.js';
import type { SceneObject } from '../operations.js';
import { type ClipAt, type Row, rowsOf, sameRow } from '../rows.js';
import { eyeKeys } from '../tree-view.js';

// The tree's rows of an opened model of N entities (`test:scaling`; AGENTS.md, no accidental quadratic): flattened,
// filtered (a hit kept with the rows it is in), clips placed (a group's by its entities) and kept by key, as each change
// of the scene makes them. At 12000 → 48000 entities the path reads ×4.8; an `indexOf` per row in the filter read ×9.7
// (at 4000 it hid under the fixed cost: ×6.7), 2026-10-27, M-series laptop.

const model: SceneObject = { ref: 'm', category: 'particles', kind: 'model', label: 'HIV', visible: true };
const AllOpen = { has: () => true } as unknown as ReadonlySet<string>;

/** A model of `n` entities in two compartments, every other one colored */
function infoOf(n: number): MesoscaleInfo {
  const entities = Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `E${i}`,
    count: 1,
    compartment: i % 2,
    visible: true,
    ...(i % 2 ? { color: 0xff0000 } : {}),
  }));
  const group = (path: string, ids: number[], groups: MesoGroup[] = []): MesoGroup => ({
    path,
    label: path.slice(path.lastIndexOf('.') + 1),
    groups,
    entities: ids,
  });
  const a = entities.filter((e) => e.compartment === 0).map((e) => e.id);
  const b = entities.filter((e) => e.compartment === 1).map((e) => e.id);
  return {
    particles: 'm',
    label: 'HIV',
    count: n,
    entities,
    groups: group('', [], [group('root', [], [group('root.a', a), group('root.b', b)])]),
    groupBy: 'compartment',
    hasCompartments: true,
  } as MesoscaleInfo;
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it("an opened model's rows, filtered, with clips, kept by key", () => {
  const s = scaling(
    {
      setup: (n) => {
        const info = infoOf(n);
        const clips: ClipAt[] = [
          { tag: 'k1', label: 'Plane 1', node: 'o:m', object: 'm', drawn: false },
          {
            tag: 'k2',
            label: 'Plane 2',
            node: 'o:m',
            object: 'm',
            entities: [0, 2, 4].filter((i) => i < n),
            drawn: false,
          },
          { tag: 'k3', label: 'Plane 3', node: `me:m:${n - 1}`, object: 'm', drawn: false },
        ];
        return { parts: new Map([['m', info]]), clips, keep: keepRows<Row>((r) => r.key, sameRow) };
      },
      run: ({ parts, clips, keep }) => {
        keep(rowsOf([model], parts, AllOpen, '', [], [], clips));
        keep(rowsOf([model], parts, AllOpen, 'e1', [], [], clips));
      },
    },
    12000,
  );
  checkLinear("an opened model's rows, N entities", s);
});

it("the eyes a drag over every row sets (each row's and those under it, each once)", () => {
  const s = scaling(
    {
      setup: (n) => {
        const rows = rowsOf([model], new Map([['m', infoOf(n)]]), AllOpen, '');
        // a drag from the bottom up: each entity first, then their groups, the model, the category
        return { rows, passed: rows.filter((r) => r.visible !== undefined).reverse() };
      },
      run: ({ rows, passed }) => {
        eyeKeys(rows, passed);
      },
    },
    12000,
  );
  checkLinear('the eyes of N rows', s);
});
