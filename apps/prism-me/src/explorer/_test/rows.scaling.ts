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
import type { ExplorerApi, SceneObject } from '../operations.js';
import { type ClipRow, type Row, rowsOf, sameRow, whatItCuts } from '../rows.js';
import { eyeKeys } from '../tree-view.js';

// The tree's rows of an opened model of N entities (`test:scaling`; AGENTS.md, no accidental quadratic): flattened,
// filtered (a hit kept with the rows it is in), with the Clips category and kept by key, as each change of the scene
// makes them; and what a clip of every other entity cuts (its What it cuts, the clip rows' counts). At 12000 → 48000 entities the path reads ×4.8; an `indexOf` per row in the filter read ×9.7
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
        const clips: ClipRow[] = [
          { tag: 'k1', label: 'Plane 1', count: 1, drawn: false },
          { tag: 'k2', label: 'Plane 2', count: 3, drawn: false },
        ];
        // a clip of every other entity: one compartment cut all of, half of the other's entities
        const entities = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0 || i % 4 === 1);
        const area = {
          cutOf: () => ({ ref: 'm', on: ['r'], particles: { entities, compartments: [], targets: [] } }),
        } as unknown as ExplorerApi;
        const cut = { index: 2, object: { type: 'plane', tag: 'k2' }, targets: [] } as unknown as Parameters<
          typeof whatItCuts
        >[1];
        return { parts: new Map([['m', info]]), clips, keep: keepRows<Row>((r) => r.key, sameRow), area, cut };
      },
      run: ({ parts, clips, keep, area, cut }) => {
        keep(rowsOf([model], parts, AllOpen, '', [], [], clips));
        keep(rowsOf([model], parts, AllOpen, 'e1', [], [], clips));
        whatItCuts(area, cut, [model], parts);
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
