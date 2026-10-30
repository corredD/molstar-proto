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
  /**
   * null: all; 0 to 1, the share shown: the particles whose stable random (`Clipping.random` of their index) is at or
   * over it are hidden, over every layer, the same ones at every share
   */
  shown: PD.Value<number | null>(null),
};
export type ParticleLayerProps = PD.Values<typeof LayerParams>;

/**
 * A cut of some particles: the representation's clip object tagged `tag` applies to them only, its way (`mode`: cut,
 * keep a layer of the band inside, or cut a band wider, with the band in Å and its fuzziness, `Clipping.Cell`); the
 * other particles ignore it. A cut has a record a part, a later one over an earlier where they overlap. By its tag,
 * not its place: the objects before it may come and go. Other clip objects (a cut of the whole representation) apply
 * to every particle.
 */
const CutParams = {
  ...SelectorParams,
  tag: PD.Text('', { isHidden: true }),
  mode: PD.Select<'cut' | 'keep' | 'wider'>('cut', PD.arrayToOptions(['cut', 'keep', 'wider']), { isHidden: true }),
  band: PD.Numeric(60, { min: 0 }, { isHidden: true }),
  fuzziness: PD.Numeric(0, { min: 0, max: 1 }, { isHidden: true }),
};
export type ParticleCutProps = PD.Values<typeof CutParams>;

/** Clip objects past this place cannot cut some particles: a row of the clipping table has a cell an object */
export const MaxParticleCutIndex = Clipping.TableWidth - 1;

const describe = (l: ParticleLayerProps) =>
  [
    l.visible ? undefined : 'hidden',
    l.color !== null ? Color.toHexStyle(l.color) : undefined,
    l.transparency !== null ? `transparency ${l.transparency}` : undefined,
    l.emissive !== null ? `emissive ${l.emissive}` : undefined,
    (l.shown ?? null) !== null ? `shown ${Math.round(l.shown! * 100)}%` : undefined,
  ]
    .filter((s) => s)
    .join(', ') || 'No change';

const ignore: Clipping.Cell = { mode: 'ignore', band: 0, fuzziness: 0 };

/**
 * The clipping of `cuts` on a representation clipped by `objects`, as a table (`Clipping.table`): each particle's row
 * holds, per object some cuts are of, the way of the last cut covering it, or ignores the object; rows are the
 * distinct combinations (row 0: in no cut, ignoring them all). A cut whose object is not there, or past
 * `MaxParticleCutIndex`, is left out.
 */
export function particleCutClipping(
  cuts: ReadonlyArray<ParticleCutProps>,
  particles: ParticleList,
  objects: ReadonlyArray<{ readonly tag?: string }>,
): Clipping {
  const indexOf = new Map<string, number>();
  for (let i = 0; i < Math.min(objects.length, MaxParticleCutIndex + 1); ++i) {
    const tag = objects[i].tag;
    if (tag && !indexOf.has(tag)) indexOf.set(tag, i);
  }
  const byObject = new Map<number, ParticleCutProps[]>();
  for (const cut of cuts) {
    const i = cut.tag ? indexOf.get(cut.tag) : undefined;
    if (i === undefined) continue;
    const list = byObject.get(i);
    if (list) list.push(cut);
    else byObject.set(i, [cut]);
  }
  if (!byObject.size) return Clipping.Empty;

  const first: Clipping.Cell[] = [];
  for (const i of byObject.keys()) first[i] = ignore;
  const table: Clipping.Cell[][] = [first];
  const row = new Uint8Array(particles.count);
  const way = new Uint8Array(particles.count);
  for (const [i, list] of byObject) {
    // per particle the last of the object's cuts covering it (1-based), 0 for none
    way.fill(0);
    for (let k = 0; k < list.length; ++k) {
      OrderedSet.forEach(Particle.selectLoci(particles, list[k]).indices, (j) => {
        way[j] = k + 1;
      });
    }
    // a particle in none of them keeps its row (which ignores the object); the others take the row of (row, way),
    // each made once: a lookup per particle
    const ways = list.length + 1;
    const next = new Int32Array(table.length * ways).fill(-1);
    for (let j = 0; j < row.length; ++j) {
      if (!way[j]) continue;
      const key = row[j] * ways + way[j];
      let r = next[key];
      if (r < 0) {
        if (table.length >= Clipping.MaxTableRows) {
          throw new Error(`More than ${Clipping.MaxTableRows} distinct ways of cutting particles.`);
        }
        const cut = list[way[j] - 1];
        const cells = table[row[j]].slice();
        cells[i] = { mode: cut.mode ?? 'cut', band: cut.band ?? 60, fuzziness: cut.fuzziness ?? 0 };
        next[key] = r = table.length;
        table.push(cells);
      }
      row[j] = r;
    }
  }

  const byRow = new Map<number, number[]>();
  for (let j = 0; j < row.length; ++j) {
    const r = row[j];
    if (r === 0) continue;
    let list = byRow.get(r);
    if (!list) byRow.set(r, (list = []));
    list.push(j);
  }
  const layers: Clipping.Layer[] = [];
  for (const [r, list] of byRow) {
    layers.push({ loci: Particle.Loci(particles, OrderedSet.ofSortedArray(list)), groups: 0, row: r });
  }
  return { kind: 'element-loci', layers, table } as Clipping;
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
  const thinned: Transparency.Layer[] = [];
  for (const layer of layers) {
    const loci = Particle.selectLoci(particles, layer);
    if (Particle.isLociEmpty(loci)) continue;
    if (layer.color !== null) overpaint.push({ loci, color: layer.color, clear: false });
    if (!layer.visible) transparency.push({ loci, value: 1 });
    else if (layer.transparency !== null) transparency.push({ loci, value: layer.transparency });
    if (layer.emissive !== null) emissive.push({ loci, value: layer.emissive });
    const shown = layer.shown ?? null;
    if (shown !== null && shown < 1) {
      const out: number[] = [];
      OrderedSet.forEach(loci.indices, (j) => {
        if (Clipping.random(j) >= shown) out.push(j);
      });
      if (out.length) thinned.push({ loci: Particle.Loci(particles, OrderedSet.ofSortedArray(out)), value: 1 });
    }
  }
  transparency.push(...thinned);
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
