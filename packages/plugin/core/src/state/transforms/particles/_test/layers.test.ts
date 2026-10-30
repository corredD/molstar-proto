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
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { RepresentationClip } from '../../../helpers/representation-clip.js';
import type { Grid } from '@molstar/model/model/volume';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { isMergedRenderObject } from '@molstar/graphics/gl/render-object';
import { ComplexParticleVisuals } from '../../../formats/particles/provider.js';
import { RelionStarParticles, RelionStarParticlesProvider } from '../../../formats/particles/star.js';
import { Ccp4, Ccp4Provider } from '../../../formats/volume/ccp4.js';
import { Clipping } from '@molstar/graphics/theme/clipping';
import { ParticleRepresentation3DLayers, type ParticleCutProps, type ParticleLayerProps } from '../layers.js';
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

const none = { entities: [] as number[], compartments: [] as number[], targets: [] as number[] };

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

/** The representation's clip objects: planes tagged `tags`, in order */
async function setObjects(plugin: PluginContext, repr: Awaited<ReturnType<typeof setup>>['repr'], tags: string[]) {
  const objects = tags.map((tag) => ({
    type: 'plane' as const,
    invert: false,
    position: Vec3(),
    rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
    scale: Vec3.create(1, 1, 1),
    transform: Mat4.identity(),
    tag,
  }));
  await plugin
    .build()
    .to(repr)
    .update((p: any) => RepresentationClip.set(p, { ...RepresentationClip.get(p)!, objects }))
    .commit();
}

const clippingOf = (repr: { obj?: unknown }) => (repr.obj as SO.Particle.Representation3D).data.repr.state.clipping!;

/** A row's cells in words: per clip object its mode, `-` where it cuts (the default) */
const words = (row: Clipping.Table[number], width: number) =>
  Array.from({ length: width }, (_, i) => {
    const c = row[i];
    if (!c || c.mode === 'cut') return '-';
    return c.mode === 'ignore' ? 'ignore' : `${c.mode} ${c.band} ${c.fuzziness}`;
  });

/**
 * The clipping of a representation in words: the particles of each row (row 0: those in no layer) and its cells over
 * `width` objects
 */
function rows(repr: { obj?: unknown }, width: number, count = 4) {
  const { layers, table } = clippingOf(repr);
  if (!table) return [];
  const inLayer = new Set<number>();
  const out = layers.map((l) => {
    for (const j of indices(l.loci)) inLayer.add(j);
    return [indices(l.loci), words(table[l.row!], width)] as [number[], string[]];
  });
  const rest = Array.from({ length: count }, (_, j) => j).filter((j) => !inLayer.has(j));
  if (rest.length) out.push([rest, words(table[0], width)]);
  return out.sort((a, b) => a[0][0] - b[0][0]);
}

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

describe('ParticleRepresentation3DLayers hidden', () => {
  it('leaves the hidden targets out (fully transparent), over the layers', async () => {
    const { plugin, repr } = await setup();
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, { layers: [layer({ targets: [2], transparency: 0.5 })], hidden: [0, 2] })
      .commit();
    const t = (repr.obj as SO.Particle.Representation3D).data.repr.state.transparency!;
    // the layer's, then the hidden targets' (0: particles 0 and 2; 2: particle 3), over it
    expect(t.layers.map((l) => [indices(l.loci), l.value])).toEqual([
      [[3], 0.5],
      [[0, 2, 3], 1],
    ]);
  });
});

const cut = (c: Partial<ParticleCutProps>): ParticleCutProps => ({
  ...none,
  tag: '',
  mode: 'cut',
  band: 60,
  fuzziness: 0,
  ...c,
});

describe('ParticleRepresentation3DLayers cuts', () => {
  it("lets a cut clip only its particles, by its clip object's tag: the others ignore that object", async () => {
    const { plugin, repr } = await setup();
    await setObjects(plugin, repr, ['a', 'b']);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: [cut({ tag: 'b', targets: [0] }), cut({ tag: 'a', targets: [2] })],
      })
      .commit();
    // object a cuts target 2 (particle 3), b target 0 (particles 0 and 2); particle 1 ignores both
    expect(rows(repr, 2)).toEqual([
      [
        [0, 2],
        ['ignore', '-'],
      ],
      [[1], ['ignore', 'ignore']],
      [[3], ['-', 'ignore']],
    ]);
    // a removed: b is the first object now, and its particles are still the ones it cuts
    await setObjects(plugin, repr, ['b']);
    expect(rows(repr, 1)).toEqual([
      [[0, 2], ['-']],
      [[1, 3], ['ignore']],
    ]);
  });

  it('cuts some particles by each of 8 objects, past the six clipping groups', async () => {
    const { plugin, repr } = await setup();
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    await setObjects(plugin, repr, tags);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: tags.map((tag, i) => cut({ tag, targets: [i % 3] })),
      })
      .commit();
    // target 0 (particles 0, 2) is cut by a, d, g; target 1 (particle 1) by b, e, h; target 2 (particle 3) by c, f
    const i = 'ignore';
    expect(rows(repr, 8)).toEqual([
      [
        [0, 2],
        ['-', i, i, '-', i, i, '-', i],
      ],
      [[1], [i, '-', i, i, '-', i, i, '-']],
      [[3], [i, i, '-', i, i, '-', i, i]],
    ]);
  });

  it('keeps a layer, cuts wider, by part: several parts a cut, each its own way', async () => {
    const { plugin, repr } = await setup();
    await setObjects(plugin, repr, ['a']);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: [
          cut({ tag: 'a', targets: [0], mode: 'keep', band: 60, fuzziness: 0.3 }),
          cut({ tag: 'a', targets: [1], mode: 'wider', band: 80, fuzziness: 0.6 }),
          cut({ tag: 'a', targets: [2] }),
        ],
      })
      .commit();
    expect(rows(repr, 1)).toEqual([
      [[0, 2], ['keep 60 0.3']],
      [[1], ['wider 80 0.6']],
      [[3], ['-']],
    ]);
  });

  it('reads a cut of before (no mode) as a plain cut, a later part over an earlier one', async () => {
    const { plugin, repr } = await setup();
    await setObjects(plugin, repr, ['a']);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: [
          { ...none, tag: 'a', targets: [0, 1] } as ParticleCutProps,
          cut({ tag: 'a', targets: [1], mode: 'keep', band: 20 }),
        ],
      })
      .commit();
    expect(rows(repr, 1)).toEqual([
      [[0, 2], ['-']],
      [[1], ['keep 20 0']],
      [[3], ['ignore']],
    ]);
  });

  it('ignores a cut whose object is not on the representation, or past the sixteenth', async () => {
    const { plugin, repr } = await setup();
    const tags = Array.from({ length: 17 }, (_, i) => `t${i}`);
    await setObjects(plugin, repr, tags);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: [cut({ tag: 'gone', targets: [0] }), cut({ tag: 't16', targets: [0] })],
      })
      .commit();
    expect(clippingOf(repr).layers).toEqual([]);
    expect(clippingOf(repr).table).toBeUndefined();
  });

  it('has no clipping layers without cuts', async () => {
    const { plugin, repr } = await setup();
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, { layers: [layer({ targets: [0], visible: false })] })
      .commit();
    expect((repr.obj as SO.Particle.Representation3D).data.repr.state.clipping!.layers).toEqual([]);
  });

  it('writes the rows and the table on the target visuals', async () => {
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
      .apply(ParticleListWithTargets, { targets: [0, 1, 2].map((targetId) => ({ targetId, source: ref })) })
      .apply(ParticlesRepresentation3D, { type: { name: 'target', params: {} } } as any)
      .commit();
    await setObjects(plugin, repr, ['a']);
    await plugin
      .build()
      .to(repr)
      .apply(ParticleRepresentation3DLayers, {
        layers: [],
        cuts: [cut({ tag: 'a', targets: [0], mode: 'keep', band: 60, fuzziness: 0.3 })],
      })
      .commit();
    const r = (repr.obj as SO.Particle.Representation3D).data.repr;
    const members = r.renderObjects.flatMap((o) => (isMergedRenderObject(o) ? o.members : [o]));
    for (const o of members) {
      const v = o.values as any;
      expect([v.dClipping.ref.value, v.dClipTable.ref.value]).toEqual([true, true]);
      expect(v.tClipTable.ref.value.count).toBe(2 * Clipping.TableWidth);
    }
    // target 0 (particles 0 and 2) in row 1, keeping a layer; the others in row 0, ignoring the cut
    const rowsOf = members.map((o) => Array.from((o.values as any).tClipping.ref.value.array.slice(0, 2)));
    expect(rowsOf.map((r) => r[0])).toEqual([1, 0, 0]);
    const cells = (members[0].values as any).tClipTable.ref.value.array as Float32Array;
    expect(Array.from(cells.slice(0, 3))).toEqual([Clipping.ModeCode.ignore, 0, 0]);
    expect(Array.from(cells.slice(64, 67)).map((x) => Math.round(x * 100) / 100)).toEqual([
      Clipping.ModeCode.keep,
      60,
      0.3,
    ]);
  });
});

describe('ParticleRepresentation3DLayers shown', () => {
  /** The particles hidden by a share, of `count` particles of one target */
  async function hiddenAt(shares: number[], count = 200) {
    const lines = Array.from({ length: count }, (_, i) => `${i} 0 0 1`).join('\n');
    const plugin = new PluginContext({ behaviors: [], registry: [RelionStarParticles] });
    await plugin.init();
    const data = await plugin.builders.data.rawData({ data: star.replace(/10 0 0 1[\s\S]*$/, `${lines}\n`) });
    const { list } = await RelionStarParticlesProvider.parse(plugin, data);
    const repr = await plugin
      .build()
      .to(list)
      .apply(ParticleListTargetsFromAttribute, { attribute: 'class' })
      .apply(ParticlesRepresentation3D)
      .commit();
    const out: number[][] = [];
    for (const shown of shares) {
      await plugin
        .build()
        .to(repr)
        .apply(ParticleRepresentation3DLayers, { layers: [layer({ targets: [0], shown })] })
        .commit();
      const t = (repr.obj as SO.Particle.Representation3D).data.repr.state.transparency!;
      out.push(t.layers.filter((l) => l.value === 1).flatMap((l) => indices(l.loci)));
      await plugin
        .build()
        .delete(plugin.state.data.selectQ((q) => q.ofTransformer(ParticleRepresentation3DLayers))[0])
        .commit();
    }
    return out;
  }

  it('hides the particles whose stable random is at or over the share, the same ones at every share', async () => {
    const [at30, at60, at30again, all] = await hiddenAt([0.3, 0.6, 0.3, 1]);
    expect(at30).toEqual(Array.from({ length: 200 }, (_, j) => j).filter((j) => Clipping.random(j) >= 0.3));
    // about 70 % hidden at 30 % shown
    expect(at30.length).toBeGreaterThan(120);
    expect(at30.length).toBeLessThan(160);
    // a higher share hides a subset: the ones shown at 30 % stay shown at 60 %
    expect(at60.every((j) => at30.includes(j))).toBe(true);
    expect(at30again).toEqual(at30);
    expect(all).toEqual([]);
  });
});
