/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { PlacementSet } from '@molstar/meso-spec/ir';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';

// A placement set as a Mol* particle list (_spec/runtime.md): positions, rotations and types are handed on as they are
// (the IR's layout is the particle list's), so the only allocations are what the list needs and the set lacks: a radius
// per copy (Mol*'s size theme reads `radii[index]`; there is no radius per target) and a key per copy
// (renderer-recommendations.md R2). The list enters the state through a transform whose only param is the set's key:
// arrays never go through params (the watched-state JSON compare, prism-me AGENTS.md).

const Stores = new WeakMap<object, Map<string, ParticleList>>();

/**
 * The lists by set key of one viewer (its plugin): what `MesoPlacements` applies. The document's owner lets entries go
 * (prism.md §7.3, point 3), never the adapter, so an Undo past a re-pack finds the lists it restores.
 */
export function placementStore(plugin: PluginContext | object): Map<string, ParticleList> {
  let store = Stores.get(plugin);
  if (!store) Stores.set(plugin, (store = new Map()));
  return store;
}

export function toParticleList(set: PlacementSet, label: string): ParticleList {
  const n = set.count;
  const radii = new Float32Array(n);
  const keys = new Int32Array(n);
  const typeRadius = Float32Array.from(set.typeTable, (t) => t.radius);
  for (let i = 0; i < n; i++) {
    radii[i] = typeRadius[set.types[i]];
    keys[i] = i;
  }
  const targetInfo = new Map(set.typeTable.map((t) => [t.index, { name: t.label, entity: t.index }]));
  const entityInfo = new Map(set.typeTable.map((t) => [t.index, { name: t.label }]));
  return {
    label,
    count: n,
    keys,
    targets: set.types,
    entities: set.types,
    targetInfo,
    entityInfo,
    coordinates: set.positions,
    rotations: set.rotations,
    radii,
    fibers: set.fibers,
    getParticleLabel: (i) => `${set.typeTable[set.types[i]].population}#${set.ordinals[i]}`,
    sourceData: { kind: 'meso-view-spec', name: set.key, data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  } as ParticleList;
}

/** The list a key the store lacks applies as (a restore before its owner, a session on a fresh page): no copies. */
function missingList(key: string, label: string): ParticleList {
  return {
    label,
    count: 0,
    keys: new Int32Array(0),
    targets: new Int32Array(0),
    entities: new Int32Array(0),
    targetInfo: new Map(),
    entityInfo: new Map(),
    coordinates: new Float32Array(0),
    rotations: new Float32Array(0),
    radii: new Float32Array(0),
    getParticleLabel: () => '',
    sourceData: { kind: 'meso-view-spec', name: key, data: { missing: true } },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  } as unknown as ParticleList;
}

/** Whether a list is the empty one a missing key applied as (`placements.missing`). */
export function isMissingList(list: ParticleList): boolean {
  return !!(list.sourceData as { data?: { missing?: boolean } } | undefined)?.data?.missing;
}

export const MesoPlacements = PluginStateTransform.BuiltIn({
  name: 'meso-view-spec-placements',
  display: { name: 'MesoViewSpec placements' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {
    key: PD.Text(''),
    label: PD.Text(''),
    // raised by the owner when it fills a key a restore found missing: equal params never apply again (mol-state)
    fill: PD.Numeric(0, {}, { isHidden: true }),
  },
})({
  apply({ params }, plugin: PluginContext) {
    const list = placementStore(plugin).get(params.key);
    // a restore never fails on a key the store lacks (prism.md §7.3, point 4): an empty list, which its owner fills
    if (!list) {
      plugin.log?.warn(`MesoViewSpec: no placements for ${params.key} yet (placements.missing)`);
      return new SO.Particle.List(missingList(params.key, params.label), { label: params.label || params.key });
    }
    return new SO.Particle.List(list, { label: params.label || list.label || params.key });
  },
});
