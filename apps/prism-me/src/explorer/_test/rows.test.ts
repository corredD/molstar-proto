/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoGroup } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import { describe, expect, it } from 'vitest';
import type { ExplorerApi, NodeRef, SceneObject } from '../operations.js';
import { keepRows } from '@molstar/prism-ui';
import { allItCuts, type Row, rowsOf, sameRow, whatItCuts } from '../rows.js';

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

describe('the Clips category (Ludo, 2026-10-28)', () => {
  it('holds every clip after the other categories, none under an object, each with its count', () => {
    const clips = [
      { tag: 'k1', label: 'Plane 1', count: 2, drawn: false },
      { tag: 'k2', label: 'Sphere 2', count: 1, drawn: true },
    ];
    const rows = rowsOf([model], new Map([['m', infoOf('compartment', true)]]), AllOpen, '', [], [], clips);
    expect(rows.map((r) => `${r.depth}:${r.key}`).slice(-3)).toEqual(['0:c:clips', '1:k:k1', '1:k:k2']);
    expect(rows.filter((r) => r.kind === 'clip').map((r) => [r.label, r.count, r.visible, r.clip])).toEqual([
      ['Plane 1', '2 objects', false, 'k1'],
      ['Sphere 2', '1 object', true, 'k2'],
    ]);
    // the category has no objects: no brush, scissors nor eye of its own
    const category = rows.find((r) => r.key === 'c:clips')!;
    expect([category.objects, category.visible]).toEqual([undefined, undefined]);
  });
});

describe("what a clip cuts of a model's particles", () => {
  const area = (entities: number[]) =>
    ({
      cutOf: () => ({ ref: 'm', on: ['m:repr'], particles: { entities, compartments: [], targets: [] } }),
    }) as unknown as ExplorerApi;
  const cut = { index: 1, object: { type: 'plane', tag: 'k1' }, targets: [] } as unknown as Parameters<
    typeof whatItCuts
  >[1];
  const uses = (entities: number[]) =>
    whatItCuts(area(entities), cut, [model], new Map([['m', infoOf('compartment', true)]])).map((u) => [
      u.key,
      u.label,
    ]);
  it("is the largest groups it cuts all of, in the model's grouping, then entities", () => {
    expect(uses([0])).toEqual([['g:m:root.membrane', 'root › membrane']]);
    expect(uses([0, 1])).toEqual([['g:m:root', 'HIV › root']]);
  });
});

describe("a category row's objects", () => {
  it('are new when one object is replaced by another (as many as before), so its eye acts on them', () => {
    const keep = keepRows<Row>((r) => r.key, sameRow);
    const other = (ref: string): SceneObject => ({ ...model, ref, label: ref });
    const category = (objects: SceneObject[]) =>
      keep(rowsOf(objects, new Map(), new Set(), '')).find((r) => r.key === 'c:particles')!;
    category([model, other('a')]);
    expect(category([model, other('b')]).objects).toEqual(['m', 'b']);
  });
});

describe('the last thing a clip cuts (review S1)', () => {
  const use = (key: string, node: NodeRef) => ({ key, label: key, node });
  const membrane = use('g:m:root.membrane', { ref: 'm', particles: { entities: [0] } });
  const capsid = use('g:m:root.capsid', { ref: 'm', particles: { entities: [1] } });
  it('is all it cuts in the node: an object cut in two parts, one part alone; not a part of two', () => {
    expect(allItCuts([membrane, capsid], { ref: 'm' })).toBe(true);
    expect(allItCuts([membrane], membrane.node)).toBe(true);
    expect(allItCuts([membrane, capsid], membrane.node)).toBe(false);
    expect(allItCuts([use('o:m', { ref: 'm' })], membrane.node)).toBe(false);
  });
});
