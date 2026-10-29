/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { IconName } from '@molstar/prism-ui';

// The explorer mocks' scene, made in memory (apps/prism-me/_spec/ui.md §3): what the tree shows, by kind, with no viewer
// and no plugin. Its own shape, not the app's (`explorer/rows.ts`): the mocks show the target, not today's code.

/** What a row stands for (ui.md §3, §4): an object, a part of one, or what was made at a node (§5, §7). */
export type MockKind =
  | 'category'
  | 'structure'
  | 'entity'
  | 'chain'
  | 'model'
  | 'group'
  | 'model entity'
  | 'list'
  | 'target'
  | 'volume'
  | 'slice'
  | 'isosurface'
  | 'mesh'
  | 'clip'
  | 'label'
  | 'distance';

/** The kinds that are whole objects: Position, Graphics & Motion, Remove (ui.md §4) */
export const ObjectKinds: ReadonlySet<MockKind> = new Set(['structure', 'model', 'list', 'volume', 'mesh']);

/** How a model's groups are made (ui.md §3, §4 Group by) */
export type GroupBy = 'compartment' | 'function';

export interface MockNode {
  readonly key: string;
  readonly kind: MockKind;
  readonly label: string;
  /** Atoms, particles, entities: faint at the row's end */
  readonly count?: string;
  /** Its one color (a dot), where it has one */
  readonly color?: number;
  /** Its eye: whether shown at first; absent, no eye (a category) */
  readonly visible?: boolean;
  /** Top-level rows only (styling.md §4: icons on top-level tree rows, not child rows) */
  readonly icon?: IconName;
  /** A clip's shape, where it matters (the proposed aperture cut: Explorer/Proposed) */
  readonly shape?: 'plane' | 'aperture';
  /** Made when first opened (thousands of entities cost nothing until looked at, ui.md §3); by the model's grouping */
  readonly children?: (groupBy: GroupBy) => readonly MockNode[];
}

/** A node's children made once per grouping (a lazy part list is read when first opened) */
function lazy(make: (groupBy: GroupBy) => readonly MockNode[]): (groupBy: GroupBy) => readonly MockNode[] {
  const made = new Map<GroupBy, readonly MockNode[]>();
  return (g) => {
    let kids = made.get(g);
    if (!kids) made.set(g, (kids = make(g)));
    return kids;
  };
}

const list =
  (...nodes: MockNode[]) =>
  () =>
    nodes;

const hue = (i: number) => {
  // a generated palette's color (ui.md §4, Generate colors): hues around the wheel by the golden angle, as an RGB integer
  const h = ((i * 0.618034) % 1) * 6;
  const f = (k: number) => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((h + k) % 6) - 3) - 1)) * 0.7 + 60);
  return (f(0) << 16) | (f(4) << 8) | f(2);
};

/** A cellPACK model's compartments, and the functions its entities have */
export const Compartments = ['envelope.membrane', 'envelope.surface', 'capsid.interior', 'capsid.surface', 'cytoplasm'];
const Functions = ['Structural', 'Enzyme', 'Transport', 'Signaling', 'Unknown'];

/**
 * A model of `n` entities (2,400 in the stories: the virtualized tree), grouped as its Group by says (ui.md §3);
 * `proposed`: with the cellVIEW evaluation's rows (a graded plane clip, an aperture cut)
 */
export function cellPackModel(n: number, proposed = false): MockNode {
  const entities = Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${['GAG', 'ENV', 'NEF', 'VPR', 'POL', 'MA', 'CA'][i % 7]}_${String(i + 1).padStart(4, '0')}`,
    compartment: Compartments[i % Compartments.length],
    fn: Functions[(i * 7) % Functions.length],
    count: 40 + ((i * 37) % 900),
  }));
  const entityRow = (e: (typeof entities)[number]): MockNode => ({
    key: `me:hiv:${e.id}`,
    kind: 'model entity',
    label: e.name,
    count: e.count.toLocaleString('en'),
    color: hue(e.id),
    visible: e.id % 11 !== 3,
  });
  // the groups of one grouping, made from its dotted names (compartments) or flat (functions); indexed once
  const groups = (by: GroupBy): MockNode[] => {
    const byName = new Map<string, (typeof entities)[number][]>();
    for (const e of entities) {
      const name = by === 'compartment' ? e.compartment : e.fn;
      const members = byName.get(name);
      if (members) members.push(e);
      else byName.set(name, [e]);
    }
    const top = new Map<string, MockNode[]>();
    const out: MockNode[] = [];
    for (const [name, members] of byName) {
      const [parent, leaf] = name.includes('.') ? name.split('.') : [undefined, name];
      const row: MockNode = {
        key: `g:hiv:${by === 'function' ? 'fn:' : ''}${name}`,
        kind: 'group',
        label: leaf,
        count: members.length.toLocaleString('en'),
        visible: true,
        children: lazy(() => members.map(entityRow)),
      };
      if (!parent) out.push(row);
      else if (top.has(parent)) top.get(parent)!.push(row);
      else {
        const kids = [row];
        top.set(parent, kids);
        out.push({ key: `g:hiv:${parent}`, kind: 'group', label: parent, visible: true, children: () => kids });
      }
    }
    return out;
  };
  return {
    key: 'o:hiv',
    kind: 'model',
    label: 'HIV-1 virion (cellPACK)',
    count: `${n.toLocaleString('en')} entities`,
    visible: true,
    icon: 'shapes',
    children: lazy((by) => [
      ...groups(by),
      proposed
        ? { key: 'k:hiv:1', kind: 'clip', label: 'Plane clip', count: '4 of 5 parts', visible: true, shape: 'plane' }
        : { key: 'k:hiv:1', kind: 'clip', label: 'Plane clip', visible: true },
      ...(proposed
        ? [
            {
              key: 'k:hiv:2',
              kind: 'clip',
              label: 'Aperture cut',
              count: 'onto the capsid',
              visible: true,
              shape: 'aperture',
            } as const,
          ]
        : []),
      { key: 'l:hiv:1', kind: 'label', label: 'HIV-1 capsid', visible: true },
    ]),
  };
}

export const Crambin: MockNode = {
  key: 'o:1crn',
  kind: 'structure',
  label: '1CRN',
  count: '327 atoms',
  visible: true,
  icon: 'structure',
  children: list(
    {
      key: 'e:1crn:1',
      kind: 'entity',
      label: 'Crambin',
      count: '2 chains',
      color: 0x4e9ad6,
      visible: true,
      children: list(
        {
          key: 'ch:1crn:A',
          kind: 'chain',
          label: 'Chain A',
          visible: true,
          children: list({ key: 'd:1crn:1', kind: 'distance', label: 'Distance 10.67 Å', visible: true }),
        },
        { key: 'ch:1crn:B', kind: 'chain', label: 'Chain B', visible: true },
      ),
    },
    { key: 'e:1crn:2', kind: 'entity', label: 'Ethanol', count: '3 atoms', visible: false },
  ),
};

export const Ribosomes: MockNode = {
  key: 'o:star',
  kind: 'list',
  label: 'run_data.star',
  count: '1,846 particles',
  visible: true,
  icon: 'locate',
  children: list(
    { key: 't:star:1', kind: 'target', label: 'Class 1 · 4V6X', count: '1,102', visible: true },
    { key: 't:star:2', kind: 'target', label: 'Class 2 · spheres', count: '744', visible: true },
  ),
};

export const Tomogram: MockNode = {
  key: 'o:tomo',
  kind: 'volume',
  label: 'tomogram.mrc',
  count: '928 × 928 × 464',
  visible: true,
  icon: 'volume',
  children: list(
    { key: 'r:tomo:z', kind: 'slice', label: 'Slice Z', visible: true },
    { key: 'r:tomo:x', kind: 'slice', label: 'Slice X', visible: false },
    { key: 'r:tomo:y', kind: 'slice', label: 'Slice Y', visible: false },
    { key: 'r:tomo:iso', kind: 'isosurface', label: 'Isosurface 2.5σ', color: 0xc9a227, visible: true },
  ),
};

export const Membrane: MockNode = {
  key: 'o:mesh',
  kind: 'mesh',
  label: 'membrane.obj',
  count: '48,210 faces',
  color: 0xb58bd6,
  visible: true,
  icon: 'box',
};

/** The four categories, shown when they hold something (ui.md §3) */
export function categories(objects: readonly MockNode[]): MockNode[] {
  const of = (kinds: MockKind[]) => objects.filter((o) => kinds.includes(o.kind));
  const all: [string, string, MockNode[]][] = [
    ['structures', 'Structures', of(['structure'])],
    ['particles', 'Particles', of(['model', 'list'])],
    ['volumes', 'Volumes', of(['volume'])],
    ['meshes', 'Meshes', of(['mesh'])],
  ];
  return all
    .filter(([, , items]) => items.length > 0)
    .map(([id, label, items]) => ({
      key: `c:${id}`,
      kind: 'category',
      label,
      count: String(items.length),
      // its eye shows or hides every object under it
      visible: true,
      children: () => items,
    }));
}

/**
 * A scene with every kind of row: a structure, a model of `entities` entities, a particle list, a volume, a mesh;
 * `proposed`: the model with the cellVIEW evaluation's rows
 */
export function fullScene(entities = 2400, proposed = false): MockNode[] {
  return categories([Crambin, cellPackModel(entities, proposed), Ribosomes, Tomogram, Membrane]);
}

/** Whether `key` may be under `node` (its object's id is the second part of both keys; categories hold everything) */
function wayTo(node: MockNode, key: string) {
  return node.kind === 'category' || node.key.split(':')[1] === key.split(':')[1];
}

/** The keys of the rows above `key`, to open the way to it */
export function pathTo(roots: readonly MockNode[], key: string, groupBy: GroupBy = 'compartment'): string[] {
  const walk = (nodes: readonly MockNode[], above: string[]): string[] | undefined => {
    for (const n of nodes) {
      if (n.key === key) return above;
      if (!n.children || !wayTo(n, key)) continue;
      const found = walk(n.children(groupBy), [...above, n.key]);
      if (found) return found;
    }
    return undefined;
  };
  return walk(roots, []) ?? [];
}
