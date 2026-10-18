/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StateTransformer } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
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

const describe = (l: ParticleLayerProps) =>
  [
    l.visible ? undefined : 'hidden',
    l.color !== null ? Color.toHexStyle(l.color) : undefined,
    l.transparency !== null ? `transparency ${l.transparency}` : undefined,
    l.emissive !== null ? `emissive ${l.emissive}` : undefined,
  ]
    .filter((s) => s)
    .join(', ') || 'No change';

/** The overpaint, transparency and emissive of `layers` over `particles`, later layers over earlier ones */
export function particleLayerState(layers: ReadonlyArray<ParticleLayerProps>, particles: ParticleList) {
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
  return {
    overpaint: { kind: 'element-loci', layers: overpaint } as Overpaint,
    transparency: { kind: 'element-loci', layers: transparency } as Transparency,
    emissive: { kind: 'element-loci', layers: emissive } as Emissive,
  };
}

const Initial = { overpaint: Overpaint.Empty, transparency: Transparency.Empty, emissive: Emissive.Empty };

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
  }),
})({
  canAutoUpdate() {
    return true;
  },
  apply({ a, params }) {
    const particles = a.data.sourceData;
    const state = particleLayerState(params.layers, particles);
    return new SO.Particle.Representation3DState(
      { state, initialState: Initial, info: particles, repr: a.data.repr },
      { label: `Layers (${params.layers.length})` },
    );
  },
  update({ a, b, newParams }) {
    if (a.data.repr !== b.data.repr) return StateTransformer.UpdateResult.Recreate;
    const particles = a.data.sourceData;
    const state = particleLayerState(newParams.layers, particles);
    const old = b.data.state;
    if (
      b.data.info === particles &&
      Overpaint.areEqual(old.overpaint!, state.overpaint) &&
      Transparency.areEqual(old.transparency!, state.transparency) &&
      Emissive.areEqual(old.emissive!, state.emissive)
    ) {
      return StateTransformer.UpdateResult.Unchanged;
    }
    b.data.state = state;
    b.data.info = particles;
    b.label = `Layers (${newParams.layers.length})`;
    return StateTransformer.UpdateResult.Updated;
  },
});
