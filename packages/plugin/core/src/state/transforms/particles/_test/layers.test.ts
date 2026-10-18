/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet } from '@molstar/core/data/int';
import { Color } from '@molstar/core/util/color';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { PluginContext } from '@molstar/plugin/context';
import type { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { RelionStarParticles, RelionStarParticlesProvider } from '../../../formats/particles/star.js';
import { ParticleRepresentation3DLayers, type ParticleLayerProps } from '../layers.js';
import { ParticleListTargetsFromAttribute } from '../ops.js';
import { ParticlesRepresentation3D } from '../representation.js';

// four particles in classes 1, 2, 1, 3: after `ParticleListTargetsFromAttribute`, targets 0, 1, 0, 2
const star = `data_particles

loop_
_rlnCoordinateX #1
_rlnCoordinateY #2
_rlnCoordinateZ #3
_rlnClassNumber #4
10 0 0 1
20 0 0 2
30 0 0 1
40 0 0 3
`;

async function setup() {
  const plugin = new PluginContext({ behaviors: [], registry: [RelionStarParticles] });
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: star, label: 'particles.star' });
  const { list } = await RelionStarParticlesProvider.parse(plugin, data);
  const repr = await plugin
    .build()
    .to(list)
    .apply(ParticleListTargetsFromAttribute, { attribute: 'class' })
    .apply(ParticlesRepresentation3D)
    .commit();
  return { plugin, repr };
}

const layer = (l: Partial<ParticleLayerProps>): ParticleLayerProps => ({
  entities: [],
  compartments: [],
  targets: [],
  visible: true,
  color: null,
  transparency: null,
  emissive: null,
  ...l,
});

const indices = (loci: unknown) => OrderedSet.toArray((loci as Particle.Loci).indices);

describe('ParticleRepresentation3DLayers', () => {
  it('colors, hides and lights particles by target on the representation', async () => {
    const { plugin, repr } = await setup();
    const red = Color(0xff0000);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [layer({ targets: [0], color: red, emissive: 0.5 }), layer({ targets: [2], visible: false })],
      })
      .commit();
    const state = (repr.obj as SO.Particle.Representation3D).data.repr.state;
    expect(state.overpaint!.layers.map((l) => [indices(l.loci), l.color])).toEqual([[[0, 2], red]]);
    expect(state.emissive!.layers.map((l) => [indices(l.loci), l.value])).toEqual([[[0, 2], 0.5]]);
    expect(state.transparency!.layers.map((l) => [indices(l.loci), l.value])).toEqual([[[3], 1]]);
  });

  it('updates the layers in place and restores the representation when removed', async () => {
    const { plugin, repr } = await setup();
    const layers = await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, { layers: [layer({ targets: [1], transparency: 0.5 })] })
      .commit();
    const r = (repr.obj as SO.Particle.Representation3D).data.repr;
    const obj = layers.obj;
    await plugin
      .build()
      .to(layers)
      .update({ layers: [layer({ targets: [1], transparency: 0.25 })] })
      .commit();
    expect(layers.cell!.obj).toBe(obj);
    expect(r.state.transparency!.layers.map((l) => l.value)).toEqual([0.25]);

    await plugin.build().delete(layers).commit();
    expect(r.state.transparency!.layers).toEqual([]);
  });
});
