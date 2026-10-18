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
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import type { Grid } from '@molstar/model/model/volume';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { isMergedRenderObject } from '@molstar/graphics/gl/render-object';
import { ComplexParticleVisuals } from '../../../formats/particles/provider.js';
import { RelionStarParticles, RelionStarParticlesProvider } from '../../../formats/particles/star.js';
import { Ccp4, Ccp4Provider } from '../../../formats/volume/ccp4.js';
import { ParticleRepresentation3DLayers, type ParticleLayerProps } from '../layers.js';
import { ParticleListTargetsFromAttribute, ParticleListWithTargets } from '../ops.js';
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

/** A 12³ map of one Gaussian blob, as MRC bytes */
function blobMap() {
  const n = 12;
  const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
  const data = new Float32Array(n * n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        data[space.dataOffset(i, j, k)] = Math.exp(-((i - 5.5) ** 2 + (j - 5.5) ** 2 + (k - 5.5) ** 2) / 8);
      }
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min: 0, max: 1, mean: 0.1, sigma: 0.2 },
  };
  return CCP4Writer.writeMrc(grid, data);
}

describe('ParticleRepresentation3DLayers on the target representation', () => {
  it('paints and fades the instances of the decorated particles', async () => {
    const plugin = new PluginContext({ behaviors: [], registry: [Ccp4, RelionStarParticles, ComplexParticleVisuals] });
    await plugin.init();
    const data = await plugin.builders.data.rawData({ data: star, label: 'particles.star' });
    const { list } = await RelionStarParticlesProvider.parse(plugin, data);
    const vol = (
      await Ccp4Provider.parse(plugin, await plugin.builders.data.rawData({ data: blobMap(), label: 'blob.mrc' }))
    ).volume;
    const ref = { name: 'ref' as const, params: { ref: vol.ref } };
    const repr = await plugin
      .build()
      .to(list)
      .apply(ParticleListTargetsFromAttribute, { attribute: 'class' })
      .apply(ParticleListWithTargets, {
        targets: [0, 1, 2].map((targetId) => ({ targetId, source: ref })),
      })
      .apply(ParticlesRepresentation3D, { type: { name: 'target', params: {} } } as any)
      .commit();
    const red = Color(0xff0000);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [layer({ targets: [0], color: red }), layer({ targets: [2], visible: false })],
      })
      .commit();

    const r = (repr.obj as SO.Particle.Representation3D).data.repr;
    const members = r.renderObjects.flatMap((o) => (isMergedRenderObject(o) ? o.members : [o]));
    // one render object per target (class 1: particles 0 and 2, class 2: particle 1, class 3: particle 3)
    expect(members.length).toBe(3);
    const painted = members.map((o) => {
      const v = o.values as any;
      const rgba = v.tOverpaint.ref.value.array as Uint8Array;
      const alpha = v.tTransparency.ref.value.array as Uint8Array;
      const n = v.instanceCount.ref.value as number;
      return {
        overpaint: v.dOverpaint.ref.value as boolean,
        firstColor: v.dOverpaint.ref.value ? Array.from(rgba.slice(0, 4)) : undefined,
        instances: n,
        transparent: v.dTransparency.ref.value ? Array.from(alpha.slice(0, n)) : undefined,
      };
    });
    // every member gets the layers' textures; what a layer does not cover is left as it is (alpha 0)
    expect(painted).toEqual([
      { overpaint: true, firstColor: [255, 0, 0, 255], instances: 2, transparent: [0, 0] },
      { overpaint: true, firstColor: [0, 0, 0, 0], instances: 1, transparent: [0] },
      { overpaint: true, firstColor: [0, 0, 0, 0], instances: 1, transparent: [255] },
    ]);
  });
});
