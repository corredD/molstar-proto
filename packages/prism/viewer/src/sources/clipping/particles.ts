/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import type { State, StateObjectCell } from '@molstar/core/state';
import { StateSelection } from '@molstar/core/state';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  type ParticleCutProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';

// Cuts of some particles (clipping.md §5): a particle representation's layers cell (`ParticleRepresentation3DLayers`)
// holds, per cut, the particles it cuts (a record a part, each its way), by the cut's tag; the others ignore its clip
// object (the representation's clipping table).
// The layers cell is the record, as a structure's clipping layer is for its kept atoms.

/** Which particles a cut cuts: by entity, compartment or target ids (`Particle.Selector`) */
export interface ParticleSelector {
  readonly entities: readonly number[];
  readonly compartments: readonly number[];
  readonly targets: readonly number[];
}

/** A selector with every list given (absent ids: none of that kind) */
export function particleSelector(s: Particle.Selector): ParticleSelector {
  return {
    entities: [...(s.entities ?? [])],
    compartments: [...(s.compartments ?? [])],
    targets: [...(s.targets ?? [])],
  };
}

/** The particles a representation draws, if it is a particle representation */
export function particlesOf(repr: StateObjectCell): ParticleList | undefined {
  return repr.obj && SO.Particle.Representation3D.is(repr.obj) ? repr.obj.data.sourceData : undefined;
}

function layersCell(state: State, reprRef: string): StateObjectCell | undefined {
  return state.select(StateSelection.Generators.ofTransformer(ParticleRepresentation3DLayers, reprRef))[0];
}

const cutsIn = (cell: StateObjectCell | undefined) =>
  ((cell?.transform.params as { cuts?: ParticleCutProps[] } | undefined)?.cuts ?? []) as ParticleCutProps[];

/** The parts of the cut tagged `tag` on a representation (its particles, a selector each), if of some only */
export function particleCutOf(state: State, repr: StateObjectCell, tag: string): ParticleSelector[] | undefined {
  const parts = cutsIn(layersCell(state, repr.transform.ref)).filter((x) => x.tag === tag);
  return parts.length ? parts.map(particleSelector) : undefined;
}

/**
 * What the parts of a cut cut: its first part's selector (the one `clipping.add` made), every part, and how many
 * particles they pick together (their union: a selector intersects its kinds) and in words
 */
export function particleCutInWords(particles: ParticleList, parts: readonly ParticleSelector[]) {
  const selector = parts[0];
  if (parts.length === 1) return { selector, parts, ...particlesInWords(particles, selector) };
  let union = Particle.selectLoci(particles, parts[0]).indices;
  for (let i = 1; i < parts.length; ++i)
    union = OrderedSet.union(union, Particle.selectLoci(particles, parts[i]).indices);
  return { selector, parts, count: OrderedSet.size(union), label: `${parts.length} parts` };
}

/** How many particles a selector picks, and in words (an entity's or a target's name when one) */
export function particlesInWords(particles: ParticleList, selector: ParticleSelector) {
  const n = OrderedSet.size(Particle.selectLoci(particles, selector).indices);
  const names = [
    ...selector.entities.map((e) => particles.entityInfo?.get(e)?.name ?? `Entity ${e}`),
    ...selector.compartments.map((c) => particles.compartmentInfo?.get(c)?.name ?? `Compartment ${c}`),
    ...selector.targets.map((t) => particles.targetInfo.get(t)?.name ?? `Target ${t}`),
  ];
  return { count: n, label: names.length === 1 ? names[0] : `${names.length} groups` };
}
