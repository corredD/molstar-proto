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
import { particleTargetObjectCells } from '../../../helpers/particle-targets.js';
import {
  ParticleListOffsets,
  ParticleListTargetsFromAttribute,
  ParticleListTransform,
  ParticleListWithTargets,
} from '../ops.js';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';

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

  it("references a target of another particle list (a model's entity), and depends on that list", async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    // the "model": a list whose target 0 is the map
    const modelData = await plugin.builders.data.rawData({ data: ndjson, label: 'model.ndjson' });
    const { list: model } = await CryoEtDataPortalNdjsonParticlesProvider.parse(plugin, modelData);
    const withMap = await plugin
      .build()
      .to(model)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, {
        targets: [{ targetId: 0, source: { name: 'target', params: { list: withMap.ref, target: 0 } } }],
      })
      .commit();
    const target = (decorated.obj as SO.Particle.List).data.targetMapping!.get(0)!;
    expect(target.kind === 'volume' && target.volume).toBe(vol.obj!.data);
    expect(decorated.cell!.dependencies.dependsOn.map((c) => c.transform.ref)).toEqual([withMap.ref]);
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

  it('lists each object of the state once, not its decorators too', async () => {
    const { plugin, volume } = await setup();
    const [a, b] = [await volume(4), await volume(5)];
    // the volumes' own cells, not their custom properties
    const own = (ref: string) => plugin.state.data.tree.transforms.get(ref)!.parent;
    expect(particleTargetObjectCells(plugin.state.data).map((c) => c.transform.ref)).toEqual([own(a.ref), own(b.ref)]);
  });

  it('offers every loaded object, its own cell first, so a ref is never replaced', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const own = plugin.state.data.tree.transforms.get(vol.ref)!.parent;
    const params = ParticleListWithTargets.definition.params!(list.obj as SO.Particle.List, plugin) as any;
    const options = params.targets.element.source.map('ref').params.ref.options as [string, string][];
    expect(options.map((o) => o[0])).toEqual([own, vol.ref]);
    expect(options[0][1]).toBe(plugin.state.data.cells.get(own)!.obj!.label);
  });

  it('keeps the ref of a decorated cell', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const decorated = await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    expect((decorated.cell!.transform.params as any).targets[0].source.params.ref).toBe(vol.ref);
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

describe('ParticleListTransform', () => {
  it('moves and turns the particles (their positions and orientations), the rest kept', async () => {
    const { plugin, list } = await setup();
    const turn = Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1));
    const matrix = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 5)), turn);
    const moved = await plugin.build().to(list).insert(ParticleListTransform, { transform: matrix }).commit();
    const data = (moved.obj as SO.Particle.List).data;
    const source = (list.obj as SO.Particle.List).data;
    // the second particle (10, 0, 0): turned a quarter about z, then up 5
    expect(Array.from(data.coordinates.slice(3, 6)).map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 10, 5]);
    // its orientation turned so (it had none: the turn itself)
    const q = Quat.fromArray(Quat(), data.rotations!, 4);
    const expected = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 2);
    expect(Math.abs(Quat.dot(q, expected))).toBeCloseTo(1, 5);
    expect(data.count).toBe(source.count);
    expect(data.targets).toBe(source.targets);
    // a decorator: what is under it now takes the moved list
    expect(moved.cell!.transform.transformer.definition.isDecorator).toBe(true);
  });

  it('scales the positions about the origin (Å per unit, a pixel size), then moves and turns them; orientations kept', async () => {
    const { plugin, list } = await setup();
    const up = Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 5));
    const scaled = await plugin.build().to(list).insert(ParticleListTransform, { transform: up, scale: 4 }).commit();
    const data = (scaled.obj as SO.Particle.List).data;
    // the second particle (10, 0, 0): 4 times as far from the origin, then up 5
    expect(Array.from(data.coordinates.slice(3, 6)).map((x) => Math.round(x * 1e4) / 1e4)).toEqual([40, 0, 5]);
    // no turn: the orientation is the identity still
    const q = Quat.fromArray(Quat(), data.rotations!, 4);
    expect(Math.abs(Quat.dot(q, Quat.identity()))).toBeCloseTo(1, 5);
    // scale 1 and no move: the list as it is
    await plugin.build().to(scaled).update({ transform: Mat4.identity(), scale: 1 }).commit();
    const same = plugin.state.data.cells.get(scaled.ref)!.obj as SO.Particle.List;
    expect(same.data.coordinates).toBe((list.obj as SO.Particle.List).data.coordinates);
  });

  it('takes a decoration inserted above it: decorating after a scale (Ludo, 2026-10-31)', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const scaled = await plugin.build().to(list).insert(ParticleListTransform, { scale: 10 }).commit();
    const before = (scaled.obj as SO.Particle.List).data;
    // `cryoet.decorate`: the decoration goes right under the list, the scale under it
    await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    const data = (plugin.state.data.cells.get(scaled.ref)!.obj as SO.Particle.List).data;
    expect(data.targetMapping?.get(0)?.kind).toBe('volume');
    expect(data.coordinates[3]).toBeCloseTo(100);
    expect(data).not.toBe(before);
    // nothing changed above it, nor its params: the same list
    await plugin.build().to(scaled).update({ scale: 10 }).commit();
    expect((plugin.state.data.cells.get(scaled.ref)!.obj as SO.Particle.List).data).toBe(data);
  });
});

describe('ParticleListOffsets', () => {
  it("shifts and turns a target's particles in their own frame; others, and no offset, leave them as they are", async () => {
    const { plugin, list } = await setup();
    // every particle turned a quarter about z (its frame: x along the world's y)
    const turn = Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1));
    const turned = await plugin.build().to(list).insert(ParticleListTransform, { transform: turn }).commit();
    const before = (turned.obj as SO.Particle.List).data;
    // another target's offset: nothing moves
    const other = await plugin
      .build()
      .to(turned)
      .apply(ParticleListOffsets, {
        offsets: [{ targets: [7], translation: Vec3.create(1, 0, 0), euler: Vec3.create(0, 0, 0) }],
      })
      .commit();
    expect((other.obj as SO.Particle.List).data.coordinates).toBe(before.coordinates);
    // target 0's (every particle's here): 1 Å along its own x, a quarter more about its own z
    await plugin
      .build()
      .to(other)
      .update({ offsets: [{ targets: [0], translation: Vec3.create(1, 0, 0), euler: Vec3.create(0, 0, 90) }] })
      .commit();
    const data = (plugin.state.data.cells.get(other.ref)!.obj as SO.Particle.List).data;
    // the second particle, (10, 0, 0) turned to (0, 10, 0): its x is the world's y, so up to (0, 11, 0)
    expect(Array.from(data.coordinates.slice(3, 6)).map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 11, 0]);
    // its orientation: half a turn about z now
    const q = Quat.fromArray(Quat(), data.rotations!, 4);
    const half = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI);
    expect(Math.abs(Quat.dot(q, half))).toBeCloseTo(1, 5);
    // an offset for every target (no targets): the same here
    await plugin
      .build()
      .to(other)
      .update({ offsets: [{ targets: [], translation: Vec3.create(1, 0, 0), euler: Vec3.create(0, 0, 90) }] })
      .commit();
    const all = (plugin.state.data.cells.get(other.ref)!.obj as SO.Particle.List).data;
    expect(Array.from(all.coordinates.slice(3, 6)).map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 11, 0]);
  });

  it('takes a decoration inserted above it', async () => {
    const { plugin, list, volume } = await setup();
    const vol = await volume(4);
    const offset = await plugin
      .build()
      .to(list)
      .insert(ParticleListOffsets, {
        offsets: [{ targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3.create(0, 0, 0) }],
      })
      .commit();
    await plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: ref(vol.ref) }] })
      .commit();
    const data = (plugin.state.data.cells.get(offset.ref)!.obj as SO.Particle.List).data;
    expect(data.targetMapping?.get(0)?.kind).toBe('volume');
    expect(data.coordinates[5]).toBeCloseTo(1);
    // nothing changed above it, nor its params: the same list
    await plugin
      .build()
      .to(offset)
      .update({ offsets: [{ targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3.create(0, 0, 0) }] })
      .commit();
    expect((plugin.state.data.cells.get(offset.ref)!.obj as SO.Particle.List).data).toBe(data);
  });

  it("offsets one instance alone (by its index), after its target's offset", async () => {
    const { plugin, list } = await setup();
    const offset = await plugin
      .build()
      .to(list)
      .apply(ParticleListOffsets, {
        offsets: [{ targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3.create(0, 0, 0) }],
        instances: [{ index: 2, translation: Vec3.create(0, 2, 0), euler: Vec3.create(0, 0, 90) }],
      })
      .commit();
    const data = (offset.obj as SO.Particle.List).data;
    const at = (i: number) =>
      Array.from(data.coordinates.slice(i * 3, i * 3 + 3)).map((x) => Math.round(x * 1e4) / 1e4);
    // every particle up 1; the third besides 2 along its own y, and turned about its own z
    expect(at(1)).toEqual([10, 0, 1]);
    expect(at(2)).toEqual([20, 2, 1]);
    const q = Quat.fromArray(Quat(), data.rotations!, 8);
    const quarter = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 2);
    expect(Math.abs(Quat.dot(q, quarter))).toBeCloseTo(1, 5);
    // the others not turned
    expect(Math.abs(Quat.dot(Quat.fromArray(Quat(), data.rotations!, 4), Quat.identity()))).toBeCloseTo(1, 5);
  });
});
