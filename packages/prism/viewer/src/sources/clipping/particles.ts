/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import type { State, StateBuilder, StateObjectCell } from '@molstar/core/state';
import { StateSelection } from '@molstar/core/state';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import {
  MaxParticleCutIndex,
  type ParticleCutProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';

// Cuts of some particles (clipping.md §5): a particle representation's layers cell (`ParticleRepresentation3DLayers`)
// holds, per cut, the particles it cuts, by the cut's tag; the others ignore its clip object (Mol*'s clipping groups).
// The layers cell is the record, as a structure's clipping layer is for its kept atoms.

export { MaxParticleCutIndex };

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

/** The cut tagged `tag` made of only `selector`'s particles on the representation, in `b` */
export function addParticleCut(
  state: State,
  b: StateBuilder.Root,
  repr: StateObjectCell,
  tag: string,
  selector: ParticleSelector,
) {
  const cell = layersCell(state, repr.transform.ref);
  const entry: ParticleCutProps = { tag, ...particleSelector(selector) } as ParticleCutProps;
  if (cell) b.to(cell.transform.ref).update((p: any) => ({ ...p, cuts: [...cutsIn(cell), entry] }));
  else b.to(repr.transform.ref).apply(ParticleRepresentation3DLayers, { layers: [], cuts: [entry] });
}

/** The cut tagged `tag` no longer of some particles on the representation, in `b` (the cell goes when left empty) */
export function removeParticleCut(state: State, b: StateBuilder.Root, repr: StateObjectCell, tag: string) {
  const cell = layersCell(state, repr.transform.ref);
  const cuts = cutsIn(cell);
  if (!cell || !cuts.some((c) => c.tag === tag)) return;
  const rest = cuts.filter((c) => c.tag !== tag);
  const { layers = [], hidden = [] } = cell.transform.params as { layers?: unknown[]; hidden?: number[] };
  if (!rest.length && !layers.length && !hidden.length) b.delete(cell.transform.ref);
  else b.to(cell.transform.ref).update((p: any) => ({ ...p, cuts: rest }));
}

/** The particles the cut tagged `tag` cuts on a representation, if of some only */
export function particleCutOf(state: State, repr: StateObjectCell, tag: string): ParticleSelector | undefined {
  const c = cutsIn(layersCell(state, repr.transform.ref)).find((x) => x.tag === tag);
  return c ? particleSelector(c) : undefined;
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
