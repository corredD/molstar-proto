/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { PlacementSet } from '@molstar/meso-spec/ir/placements';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';

// A placement set as a Mol* particle list (design.md §6.5): positions, rotations and types are handed on as they are
// (the IR's layout is the particle list's), so the only allocations are what the list needs and the set lacks: a radius
// per copy (Mol*'s size theme reads `radii[index]`; there is no radius per target) and a key per copy
// (renderer-recommendations.md R2). The list enters the state through a transform whose only param is the set's key:
// arrays never go through params (the watched-state JSON compare, prism-me AGENTS.md).

/** The lists by set key: what `MesoPlacements` applies. Entries are removed with their set. */
export const MesoPlacementStore = new Map<string, ParticleList>();

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

export const MesoPlacements = PluginStateTransform.BuiltIn({
  name: 'meso-view-spec-placements',
  display: { name: 'MesoViewSpec placements' },
  from: SO.Root,
  to: SO.Particle.List,
  params: { key: PD.Text(''), label: PD.Text('') },
})({
  apply({ params }) {
    const list = MesoPlacementStore.get(params.key);
    if (!list) throw new Error(`No placements ${params.key}`);
    return new SO.Particle.List(list, { label: params.label || list.label || params.key });
  },
});
