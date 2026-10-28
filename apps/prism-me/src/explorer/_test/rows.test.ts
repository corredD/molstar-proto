/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import { describe, expect, it } from 'vitest';
import type { SceneObject } from '../operations.js';
import { rowsOf } from '../rows.js';

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

describe('a label or a distance whose row is not there', () => {
  it("goes under its (first) object's row", () => {
    const label = { ref: 'lab', text: 'here', node: 'me:m:99', target: 'm', visible: true } as LabelInfo;
    const distance = {
      ref: 'dist',
      node: 'e:gone:1',
      label: '5.00 Å',
      a: { ref: 'm', label: 'a', key: 'e:gone:1' },
      b: { ref: 'm', label: 'b', key: '' },
      visible: true,
    } as unknown as DistanceInfo;
    const keys = rowsOf([model], new Map([['m', infoOf('compartment', true)]]), AllOpen, '', [label], [distance]).map(
      (r) => `${r.depth}:${r.key}`,
    );
    expect(keys).toContain('2:l:lab');
    expect(keys).toContain('2:d:dist');
  });

  it('says what it is: a label faint after its text, a distance before its value (as the mock)', () => {
    const label = { ref: 'lab', text: 'here', node: 'o:m', target: 'm', visible: true } as LabelInfo;
    const distance = {
      ref: 'dist',
      node: 'o:m',
      label: '5.00 Å',
      a: { ref: 'm', label: 'a', key: 'o:m' },
      b: { ref: 'm', label: 'b', key: '' },
      visible: true,
    } as unknown as DistanceInfo;
    const rows = rowsOf([model], new Map([['m', infoOf('compartment', true)]]), AllOpen, '', [label], [distance]);
    const of = (key: string) => rows.find((r) => r.key === key)!;
    expect([of('l:lab').label, of('l:lab').count]).toEqual(['here', 'label']);
    expect(of('d:dist').label).toBe('Distance 5.00 Å');
  });
});

describe('the filter (ui.md §1)', () => {
  const crn: SceneObject = {
    ref: 's',
    category: 'structures',
    kind: 'structure',
    label: '1CRN',
    visible: true,
    entities: [{ id: '1', label: 'Crambin', chains: ['A'] }] as SceneObject['entities'],
  };
  const keys = (filter: string) =>
    rowsOf([crn, model], new Map([['m', infoOf('compartment', true)]]), new Set(), filter).map(
      (r) => `${r.depth}:${r.key}`,
    );

  it('keeps a hit with the rows it is in, unopened, and drops the categories with no hit', () => {
    expect(keys('ca')).toEqual(['0:c:particles', '1:o:m', '2:g:m:root', '3:g:m:root.capsid', '4:me:m:1']);
    expect(keys('cramb')).toEqual(['0:c:structures', '1:o:s', '2:e:s:1']);
    expect(keys('nothing')).toEqual([]);
  });
});

describe("a clip of a model's group", () => {
  it("goes under the group whose entities it cuts, in the model's grouping", () => {
    const clip = { tag: 'k1', label: 'Plane 1', node: 'o:m', object: 'm', entities: [1, 0], drawn: false };
    const keys = rowsOf([model], new Map([['m', infoOf('compartment', true)]]), AllOpen, '', [], [], [clip]).map(
      (r) => `${r.depth}:${r.key}`,
    );
    expect(keys.slice(keys.indexOf('2:g:m:root'))).toEqual([
      '2:g:m:root',
      '3:g:m:root.membrane',
      '4:me:m:0',
      '3:g:m:root.capsid',
      '4:me:m:1',
      '3:k:k1',
    ]);
  });
});
