/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { StateTransformer } from '@molstar/core/state';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { DistanceParams, DistanceRepresentation, type DistanceData } from '@molstar/graphics/repr/shape/loci/distance';
import { Loci } from '@molstar/model/model/loci';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { type Structure, StructureElement } from '@molstar/model/model/structure';
import { Grid, Volume } from '@molstar/model/model/volume';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { drawnObject } from './drawn.js';

// A distance of the stage (apps/prism-me/_spec/ui.md §7): between two points of the scene, each an atom, a residue, a
// chain or a whole structure (its bundle of elements) or a particle (its index in a list), drawn by Mol*'s distance
// representation (its dashed line and its label). A state transform from the root that depends on the two objects
// (`dependsOn`, dependencies.md §1): saved in a session, undone as any change, evaluated again when either object is,
// and removed with either. Its line and text are sized to what it measures (the larger of the two), times the person's
// text size and line width.

/** One end of a distance: its object (a structure, a particle list or a volume, by state ref) and the point on it */
export interface DistancePoint {
  readonly ref: string;
  /** What it is, for people ("ALA 10 CA", "HIV1_CA_P1 #12") */
  readonly label: string;
  /** The explorer's row of the pick (its key): where it is revealed */
  readonly key: string;
  /** A structure's elements (an atom, a residue, a chain, all of it) */
  readonly bundle?: StructureElement.Bundle;
  /** A particle list's particle */
  readonly particle?: number;
  /** A particle list's particles, when the pick was several (a fiber): measured from their middle */
  readonly particles?: readonly number[];
  /**
   * A volume's voxels (its cell indices) and the instance they are in: a voxel picked on an isosurface or a slice; none
   * (`volume` alone): the whole volume, at a coarse granularity (Ludovic, 2026-10-25)
   */
  readonly voxels?: readonly number[];
  readonly instance?: number;
  /** A volume point: its voxels, else all of it */
  readonly volume?: true;
}

export const StageDistanceParams = {
  a: PD.Value<DistancePoint>({ ref: '', label: '', key: '' }, { isHidden: true }),
  b: PD.Value<DistancePoint>({ ref: '', label: '', key: '' }, { isHidden: true }),
  /** The explorer's row it is listed under (its key): its first pick's */
  node: PD.Text('', { isHidden: true }),
  textSize: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, { description: "Its text's size, times its own" }),
  lineWidth: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, { description: "Its line's width, times its own" }),
  opacity: PD.Numeric(1, { min: 0, max: 1, step: 0.01 }),
};
export type StageDistanceProps = PD.Values<typeof StageDistanceParams>;

/** What a distance's shapes stand for: Mol*'s distance data, and the kind a pick tells it by */
export interface StageDistanceData extends DistanceData {
  readonly kind: 'stage-tools-distance';
  /** Its value (Å), measured once when made or updated */
  readonly value: number;
}

export function isStageDistanceData(x: unknown): x is StageDistanceData {
  return !!x && (x as StageDistanceData).kind === 'stage-tools-distance';
}

/** A point's loci on its object as drawn (moved, decorated), and the size of what it is; undefined when gone */
export function pointLoci(plugin: PluginContext, p: DistancePoint): { loci: Loci; radius: number } | undefined {
  const obj = drawnObject({ plugin }, p.ref);
  if (p.bundle && SO.Molecule.Structure.is(obj)) {
    const loci = StructureElement.Bundle.toLoci(p.bundle, obj.data as Structure);
    if (StructureElement.Loci.isEmpty(loci)) return undefined;
    return { loci, radius: StructureElement.Loci.getBoundingSphere(loci).radius };
  }
  if (p.volume && SO.Volume.Data.is(obj)) {
    const volume = obj.data as Volume;
    const instances = OrderedSet.ofSingleton((p.instance ?? 0) as Volume.InstanceIndex);
    const cells = volume.grid.cells.data.length;
    if (p.voxels?.some((i) => i < 0 || i >= cells)) return undefined;
    const loci: Loci = p.voxels?.length
      ? Volume.Cell.Loci(volume, [{ indices: OrderedSet.ofSortedArray(sorted(p.voxels)) as never, instances }])
      : Volume.Loci(volume, instances);
    // its size: a voxel's (the grid's spacing, as Mol*'s Volume.Cell sphere takes it), else the volume's
    const size = p.voxels?.length ? Mat4.getMaxScaleOnAxis(Grid.getGridToCartesianTransform(volume.grid)) : undefined;
    return { loci, radius: size ?? Loci.getBoundingSphere(loci)?.radius ?? 5 };
  }
  const indices = p.particles ?? (p.particle !== undefined ? [p.particle] : undefined);
  if (indices?.length && SO.Particle.List.is(obj)) {
    const list = obj.data as ParticleList;
    if (indices.some((i) => i < 0 || i >= list.count)) return undefined;
    let radius = 0;
    for (const i of indices) radius = Math.max(radius, particleRadius(list, i));
    return { loci: Particle.Loci(list, OrderedSet.ofSortedArray(sorted(indices))), radius };
  }
  return undefined;
}

const sorted = (indices: readonly number[]) => [...indices].sort((a, b) => a - b);

/** A particle's size: its own radius, else what decorates it (its structure's, volume's, shape's), else a few Å */
export function particleRadius(list: ParticleList, i: number): number {
  const own = list.radii?.[i];
  if (own) return own;
  const target = list.targetMapping?.get(list.targets[i]);
  if (target?.kind === 'structure') return target.structure.boundary.sphere.radius;
  if (target?.kind === 'volume') return Grid.getBoundingSphere(target.volume.grid).radius;
  return (target?.shape.geometry as { boundingSphere?: Sphere3D } | undefined)?.boundingSphere?.radius || 5;
}

/** The distance between two points' centers (Å), as Mol* measures it: the centers of the spheres around them */
export function distanceOf(a: Loci, b: Loci): number {
  const sa = Loci.getBoundingSphere(a);
  const sb = Loci.getBoundingSphere(b);
  return sa && sb ? Vec3.distance(sa.center, sb.center) : NaN;
}

/**
 * Mol*'s distance props for a distance of this size: its text and line scaled by the larger of the two things it
 * measures (an atom: 2 Å, Mol*'s own; a protein of a cellPACK model: its radius), times the person's factors. Mol*'s
 * text is already scaled by its loci's spheres (`max(2, r) / 2`): taken out, so a particle without a radius (its
 * sphere a point) is sized by its decoration.
 */
export function distanceProps(params: StageDistanceProps, a: { loci: Loci; radius: number }, b: typeof a) {
  const size = Math.max(2, a.radius, b.radius) / 2;
  const own = Math.max(2, Loci.getBoundingSphere(a.loci)?.radius ?? 0, Loci.getBoundingSphere(b.loci)?.radius ?? 0) / 2;
  const d = PD.getDefaultValues(DistanceParams);
  return {
    ...d,
    textColor: Color(0xffffff),
    textSize: (d.textSize * params.textSize * size) / own,
    linesSize: d.linesSize * params.lineWidth * size,
    dashLength: d.dashLength * size,
    alpha: params.opacity,
  };
}

function dataOf(plugin: PluginContext, params: StageDistanceProps) {
  const a = pointLoci(plugin, params.a);
  const b = pointLoci(plugin, params.b);
  if (!a || !b) throw new Error('A point of the distance is gone.');
  const value = distanceOf(a.loci, b.loci);
  const data: StageDistanceData = { pairs: [{ loci: [a.loci, b.loci] }], kind: 'stage-tools-distance', value };
  return { data, props: distanceProps(params, a, b), value };
}

export type StageDistance = typeof StageDistance;
export const StageDistance = PluginStateTransform.BuiltIn({
  name: 'stage-tools-distance',
  display: { name: 'Distance', description: 'The distance between two points of the scene' },
  from: SO.Root,
  to: SO.Shape.Representation3D,
  params: StageDistanceParams,
})({
  canAutoUpdate: () => true,
  apply({ params }, plugin: PluginContext) {
    return Task.create('Distance', async (ctx) => {
      const { data, props, value } = dataOf(plugin, params);
      const repr = DistanceRepresentation(
        { graphics: plugin.canvas3d?.graphics, ...plugin.representation.structure.themes },
        () => DistanceParams,
      );
      await repr.createOrUpdate(props, data).runInContext(ctx);
      return new SO.Shape.Representation3D(
        { repr, sourceData: data },
        { label: `${value.toFixed(2)} Å`, description: 'Distance' },
      );
    });
  },
  update({ b, newParams }, plugin: PluginContext) {
    return Task.create('Distance', async (ctx) => {
      const { data, props, value } = dataOf(plugin, newParams);
      await b.data.repr.createOrUpdate(props, data).runInContext(ctx);
      b.data.sourceData = data;
      b.label = `${value.toFixed(2)} Å`;
      return StateTransformer.UpdateResult.Updated;
    });
  },
});

/** A structure's or a particle list's point from a pick: what to keep of it in a distance */
export function pointOf(
  loci: Loci,
  object: { readonly ref: string; readonly label: string; readonly key: string },
): DistancePoint | undefined {
  if (StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)) {
    return { ...object, bundle: StructureElement.Bundle.fromLoci(loci) };
  }
  if (Particle.isLoci(loci) && !Particle.isLociEmpty(loci)) {
    if (OrderedSet.size(loci.indices) === 1) return { ...object, particle: OrderedSet.getAt(loci.indices, 0) };
    return { ...object, particles: OrderedSet.toArray(loci.indices) };
  }
  // a voxel picked (its first element's cells, in its instance); else any other pick of a volume: all of it
  if (Volume.Cell.isLoci(loci) && loci.elements.length) {
    const { indices, instances } = loci.elements[0];
    if (OrderedSet.size(indices) === 0) return undefined;
    return { ...object, volume: true, voxels: OrderedSet.toArray(indices), instance: OrderedSet.getAt(instances, 0) };
  }
  if (Volume.isLoci(loci) || Volume.Isosurface.isLoci(loci)) {
    const instance = OrderedSet.size(loci.instances) ? OrderedSet.getAt(loci.instances, 0) : 0;
    return { ...object, volume: true, instance };
  }
  if (Volume.Segment.isLoci(loci)) return { ...object, volume: true };
  return undefined;
}
