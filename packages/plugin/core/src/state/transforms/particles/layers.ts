/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StateTransformer } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { OrderedSet } from '@molstar/core/data/int';
import { Clipping } from '@molstar/graphics/theme/clipping';
import { Emissive } from '@molstar/graphics/theme/emissive';
import { Overpaint } from '@molstar/graphics/theme/overpaint';
import { Transparency } from '@molstar/graphics/theme/transparency';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';

/** Which particles a layer is for, see `Particle.Selector`; no ids: every particle. */
const SelectorParams = {
  entities: PD.Value<number[]>([], { isHidden: true }),
  compartments: PD.Value<number[]>([], { isHidden: true }),
  targets: PD.Value<number[]>([], { isHidden: true }),
};

const LayerParams = {
  ...SelectorParams,
  /** Hidden: fully transparent, over any `transparency` */
  visible: PD.Boolean(true),
  /** null: unchanged */
  color: PD.Value<Color | null>(null),
  /** null: unchanged; 0 (opaque) to 1 */
  transparency: PD.Value<number | null>(null),
  /** null: unchanged; 0 to 1 */
  emissive: PD.Value<number | null>(null),
};
export type ParticleLayerProps = PD.Values<typeof LayerParams>;

/**
 * A cut of some particles: the representation's clip object tagged `tag` applies to them only; the other particles
 * ignore it (Mol*'s clipping groups). By its tag, not its place: the objects before it may come and go. Other clip
 * objects (a cut of the whole representation) apply to every particle.
 */
const CutParams = { ...SelectorParams, tag: PD.Text('', { isHidden: true }) };
export type ParticleCutProps = PD.Values<typeof CutParams>;

/** Clip objects past this place have no group (Mol*'s groups one to six): their cuts cannot be of some particles */
export const MaxParticleCutIndex = 5;

const describe = (l: ParticleLayerProps) =>
  [
    l.visible ? undefined : 'hidden',
    l.color !== null ? Color.toHexStyle(l.color) : undefined,
    l.transparency !== null ? `transparency ${l.transparency}` : undefined,
    l.emissive !== null ? `emissive ${l.emissive}` : undefined,
  ]
    .filter((s) => s)
    .join(', ') || 'No change';

/**
 * The clipping groups of `cuts` on a representation clipped by `objects`: each particle ignores the objects of the
 * cuts it is not in (as one layer per distinct set of ignored objects); a cut whose object is not there, or past
 * `MaxParticleCutIndex`, is left out
 */
export function particleCutClipping(
  cuts: ReadonlyArray<ParticleCutProps>,
  particles: ParticleList,
  objects: ReadonlyArray<{ readonly tag?: string }>,
): Clipping {
  const bits: { bit: number; cut: ParticleCutProps }[] = [];
  for (const cut of cuts) {
    const index = cut.tag ? objects.findIndex((o) => o.tag === cut.tag) : -1;
    if (index >= 0 && index <= MaxParticleCutIndex) bits.push({ bit: 1 << index, cut });
  }
  if (!bits.length) return Clipping.Empty;
  const all = bits.reduce((m, b) => m | b.bit, 0);
  const ignored = new Uint8Array(particles.count).fill(all);
  for (const { bit, cut } of bits) {
    OrderedSet.forEach(Particle.selectLoci(particles, cut).indices, (j) => {
      ignored[j] &= ~bit;
    });
  }
  const byMask = new Map<number, number[]>();
  for (let j = 0; j < ignored.length; ++j) {
    const m = ignored[j];
    if (m === 0) continue;
    let list = byMask.get(m);
    if (!list) byMask.set(m, (list = []));
    list.push(j);
  }
  const layers: Clipping.Layer[] = [];
  for (const [m, list] of byMask) {
    layers.push({ loci: Particle.Loci(particles, OrderedSet.ofSortedArray(list)), groups: Clipping.Groups.create(m) });
  }
  return { kind: 'element-loci', layers } as Clipping;
}

/** The clip objects a particle representation draws with */
const clipObjectsOf = (repr: { props: { clip?: { objects: ReadonlyArray<{ tag?: string }> } } }) =>
  repr.props.clip?.objects ?? [];

/**
 * The overpaint, transparency and emissive of `layers` over `particles`, later layers over earlier ones; the `hidden`
 * targets left out (fully transparent, over every layer)
 */
export function particleLayerState(
  layers: ReadonlyArray<ParticleLayerProps>,
  particles: ParticleList,
  hidden: ReadonlyArray<number> = [],
) {
  const overpaint: Overpaint.Layer[] = [];
  const transparency: Transparency.Layer[] = [];
  const emissive: Emissive.Layer[] = [];
  for (const layer of layers) {
    const loci = Particle.selectLoci(particles, layer);
    if (Particle.isLociEmpty(loci)) continue;
    if (layer.color !== null) overpaint.push({ loci, color: layer.color, clear: false });
    if (!layer.visible) transparency.push({ loci, value: 1 });
    else if (layer.transparency !== null) transparency.push({ loci, value: layer.transparency });
    if (layer.emissive !== null) emissive.push({ loci, value: layer.emissive });
  }
  if (hidden.length) {
    const loci = Particle.selectLoci(particles, { targets: hidden });
    if (!Particle.isLociEmpty(loci)) transparency.push({ loci, value: 1 });
  }
  return {
    overpaint: { kind: 'element-loci', layers: overpaint } as Overpaint,
    transparency: { kind: 'element-loci', layers: transparency } as Transparency,
    emissive: { kind: 'element-loci', layers: emissive } as Emissive,
  };
}

const Initial = {
  overpaint: Overpaint.Empty,
  transparency: Transparency.Empty,
  emissive: Emissive.Empty,
  clipping: Clipping.Empty,
};

export { ParticleRepresentation3DLayers };
type ParticleRepresentation3DLayers = typeof ParticleRepresentation3DLayers;
/**
 * Colors, transparency (or hiding) and emissive of a particle representation by entity, compartment or target: one
 * representation for the whole list, its parts styled by layers (the Mesoscale Explorer's per-entity controls).
 */
const ParticleRepresentation3DLayers = PluginStateTransform.BuiltIn({
  name: 'particle-representation-3d-layers',
  display: {
    name: 'Particle Layers',
    description: 'Color, transparency, visibility and emissive of particles by entity, compartment or target.',
  },
  from: SO.Particle.Representation3D,
  to: SO.Particle.Representation3DState,
  params: () => ({
    layers: PD.ObjectList(LayerParams, describe, { defaultValue: [] }),
    cuts: PD.ObjectList<ParticleCutProps>(
      CutParams,
      (c) => `Cut of ${c.entities.length + c.compartments.length + c.targets.length} groups`,
      {
        defaultValue: [],
        description:
          "Cuts of some particles: each the representation's clip object of its tag, on those particles only.",
      },
    ),
    hidden: PD.Value<number[]>([], {
      isHidden: true,
      description: 'Targets another representation draws (their objects, a decoration): left out of this one.',
    }),
  }),
})({
  canAutoUpdate() {
    return true;
  },
  apply({ a, params }) {
    const particles = a.data.sourceData;
    const state = {
      ...particleLayerState(params.layers, particles, params.hidden ?? []),
      clipping: particleCutClipping(params.cuts ?? [], particles, clipObjectsOf(a.data.repr)),
    };
    return new SO.Particle.Representation3DState(
      { state, initialState: Initial, info: particles, repr: a.data.repr },
      { label: `Layers (${params.layers.length})` },
    );
  },
  update({ a, b, newParams }) {
    if (a.data.repr !== b.data.repr) return StateTransformer.UpdateResult.Recreate;
    const particles = a.data.sourceData;
    const state = {
      ...particleLayerState(newParams.layers, particles, newParams.hidden ?? []),
      clipping: particleCutClipping(newParams.cuts ?? [], particles, clipObjectsOf(a.data.repr)),
    };
    const old = b.data.state;
    if (
      b.data.info === particles &&
      Overpaint.areEqual(old.overpaint!, state.overpaint) &&
      Transparency.areEqual(old.transparency!, state.transparency) &&
      Emissive.areEqual(old.emissive!, state.emissive) &&
      Clipping.areEqual(old.clipping!, state.clipping)
    ) {
      return StateTransformer.UpdateResult.Unchanged;
    }
    b.data.state = state;
    b.data.info = particles;
    b.label = `Layers (${newParams.layers.length})`;
    return StateTransformer.UpdateResult.Updated;
  },
});
