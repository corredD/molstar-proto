/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import type { Grid } from '@molstar/model/model/volume';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { PluginContext } from '@molstar/plugin/context';
import type { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { Ccp4, Ccp4Provider, VolumeFromCcp4 } from '../../../formats/volume/ccp4.js';
import {
  CryoEtDataPortalNdjsonParticles,
  CryoEtDataPortalNdjsonParticlesProvider,
} from '../../../formats/particles/ndjson.js';
import { RelionStarParticles, RelionStarParticlesProvider } from '../../../formats/particles/star.js';
import { ParticleListTargetsFromAttribute, ParticleListWithTargets } from '../ops.js';

/** An n³ map of one value as MRC bytes */
function mapBytes(n: number, value: number) {
  const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
  const data = new Float32Array(n * n * n).fill(value);
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min: value, max: value, mean: value, sigma: 0 },
  };
  return CCP4Writer.writeMrc(grid, data);
}

const ndjson = [0, 1, 2]
  .map((i) =>
    JSON.stringify({
      type: 'orientedPoint',
      location: { x: i * 10, y: 0, z: 0 },
      xyz_rotation_matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    }),
  )
  .join('\n');

async function setup() {
  const plugin = new PluginContext({
    behaviors: [],
    registry: [Ccp4, CryoEtDataPortalNdjsonParticles, RelionStarParticles],
  });
  await plugin.init();
  const listData = await plugin.builders.data.rawData({ data: ndjson, label: 'particles.ndjson' });
  const { list } = await CryoEtDataPortalNdjsonParticlesProvider.parse(plugin, listData);
  const volume = async (n: number) => {
    const data = await plugin.builders.data.rawData({ data: mapBytes(n, n), label: `map${n}.mrc` });
    return (await Ccp4Provider.parse(plugin, data)).volume;
  };
  return { plugin, list, volume };
}

const ref = (r: string) => ({ name: 'ref' as const, params: { ref: r } });

describe('ParticleListWithTargets', () => {
  it('references a volume in the state, and depends on it', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    const target = (decorated.obj as SO.Particle.List).data.targetMapping!.get(0)!;
    expect(target.kind).toBe('volume');
    expect(target.kind === 'volume' && target.volume).toBe(vol.obj!.data);
    expect(decorated.cell!.dependencies.dependsOn.map((c) => c.transform.ref)).toEqual([vol.ref]);
  });

  it('swaps one target in place and keeps the others', async () => {
    const { plugin, list, volume } = await setup();
    const [a, b, c] = [await volume(4), await volume(5), await volume(6)];
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, {
        targets: [
          { targetId: 0, source: ref(a.ref) },
          { targetId: 1, source: ref(b.ref) },
        ],
      })
      .commit();
    const before = decorated.obj as SO.Particle.List;
    const kept = before.data.targetMapping!.get(0);

    await plugin
      .build()
      .to(decorated)
      .update({
        targets: [
          { targetId: 0, source: ref(a.ref) },
          { targetId: 1, source: ref(c.ref) },
        ],
      })
      .commit();
    const after = decorated.cell!.obj as SO.Particle.List;
    // updated, not recreated: the same state object, its representations updated in place
    expect(after).toBe(before);
    expect(after.data.targetMapping!.get(0)).toBe(kept);
    const swapped = after.data.targetMapping!.get(1)!;
    expect(swapped.kind === 'volume' && swapped.volume).toBe(c.obj!.data);
    expect(decorated.cell!.dependencies.dependsOn.map((x) => x.transform.ref).sort()).toEqual([a.ref, c.ref].sort());
  });

  it('follows a referenced object that changes', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    // rebuild the volume: its `VolumeFromCcp4` cell (the parent of the volume `Ccp4Provider` returns) with new params
    const fromCcp4 = plugin.state.data.select(vol.ref)[0].transform.parent;
    expect(plugin.state.data.cells.get(fromCcp4)!.transform.transformer).toBe(VolumeFromCcp4);
    await plugin.build().to(fromCcp4).update({ entryId: 'changed' }).commit();
    const target = (decorated.cell!.obj as SO.Particle.List).data.targetMapping!.get(0)!;
    const current = plugin.state.data.cells.get(vol.ref)!.obj!.data;
    expect(target.kind === 'volume' && target.volume).toBe(current);
  });
});

const star = `data_particles

loop_
_rlnCoordinateX #1
_rlnCoordinateY #2
_rlnCoordinateZ #3
_rlnClassNumber #4
10 0 0 2
20 0 0 1
30 0 0 2
`;

describe('ParticleListTargetsFromAttribute', () => {
  it('decorates each class of a RELION list with its own object', async () => {
    const { plugin, volume } = await setup();
    const data = await plugin.builders.data.rawData({ data: star, label: 'particles.star' });
    const { list } = await RelionStarParticlesProvider.parse(plugin, data);
    const [one, two] = [await volume(4), await volume(5)];
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListTargetsFromAttribute, { attribute: 'class' })
      .apply(ParticleListWithTargets, {
        targets: [
          { targetId: 0, source: ref(one.ref) },
          { targetId: 1, source: ref(two.ref) },
        ],
      })
      .commit();
    const { targets, targetInfo, targetMapping } = (decorated.obj as SO.Particle.List).data;
    expect(Array.from(targets)).toEqual([1, 0, 1]);
    expect(Array.from(targetInfo.values()).map((t) => t.name)).toEqual(['Class 1', 'Class 2']);
    const second = targetMapping!.get(1)!;
    expect(second.kind === 'volume' && second.volume).toBe(two.obj!.data);
  });
});
