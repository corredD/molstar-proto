/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cellpackLike } from './fixtures.js';
import { findGroup, generateColors, groupEntities, mesoEntities, mesoGroups } from '../model.js';

describe('mesoscale model', () => {
  it('lists the entities with their count, function and main compartment', () => {
    expect(mesoEntities(cellpackLike())).toEqual([
      { id: 0, name: 'lipids', function: 'membrane', count: 2, compartment: 0 },
      { id: 1, name: 'CA', count: 1, compartment: 1 },
      { id: 2, name: 'NC', count: 3, compartment: 1 },
      { id: 3, name: 'loose', count: 1, compartment: -1 },
    ]);
  });

  it('groups the entities in the compartment tree', () => {
    const list = cellpackLike();
    const root = mesoGroups(list, mesoEntities(list), 'compartment');
    const outline = (g: ReturnType<typeof mesoGroups>): unknown => [g.label, g.entities, g.groups.map(outline)];
    expect(outline(root)).toEqual([
      'HIV',
      [3],
      [
        [
          'root',
          [],
          [
            [
              'envelope',
              [],
              [
                ['membrane', [0], []],
                ['capsid', [], [['surface', [1, 2], []]]],
              ],
            ],
          ],
        ],
      ],
    ]);
    expect(groupEntities(findGroup(root, 'root.envelope.capsid')!)).toEqual([1, 2]);
  });

  it('groups the entities by function', () => {
    const list = cellpackLike();
    const root = mesoGroups(list, mesoEntities(list), 'function');
    expect(root.groups.map((g) => [g.label, g.entities])).toEqual([
      ['membrane', [0]],
      ['unknown function', [1, 2, 3]],
    ]);
  });

  it('lists the entities flat when none has a function', () => {
    const list = {
      ...cellpackLike(),
      entityInfo: new Map([
        [0, { name: 'a' }],
        [1, { name: 'b' }],
        [2, { name: 'c' }],
        [3, { name: 'd' }],
      ]),
    };
    const root = mesoGroups(list, mesoEntities(list), 'function');
    expect([root.groups.length, root.entities]).toEqual([0, [0, 1, 2, 3]]);
  });

  it('colors every entity, the members of a group alike, and the same way each time', () => {
    const list = cellpackLike();
    const root = mesoGroups(list, mesoEntities(list), 'compartment');
    const colors = generateColors(root);
    expect(Array.from(colors.keys()).sort()).toEqual([0, 1, 2, 3]);
    expect(generateColors(root)).toEqual(colors);
    expect(new Set(colors.values()).size).toBe(4);
  });
});
