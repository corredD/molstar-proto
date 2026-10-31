/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { StateTransformer } from '@molstar/core/state';
import { type RuntimeContext, Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { radToDeg } from '@molstar/core/math/misc';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { triangleLoci } from '@molstar/graphics/geo/shape/shape';
import { AngleParams, AngleRepresentation } from '@molstar/graphics/repr/shape/loci/angle';
import { DihedralParams, DihedralRepresentation } from '@molstar/graphics/repr/shape/loci/dihedral';
import { DistanceParams, DistanceRepresentation, type DistanceData } from '@molstar/graphics/repr/shape/loci/distance';
import { Loci } from '@molstar/model/model/loci';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { type Structure, StructureElement } from '@molstar/model/model/structure';
import { Grid, Volume } from '@molstar/model/model/volume';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { drawnObject } from './drawn.js';

// A measurement of the stage (apps/prism-me/_spec/ui.md §7): a distance between two points of the scene, an angle at
// the second of three, a dihedral about the middle two of four; each point an atom, a residue, a chain or a whole
// structure (its bundle of elements), a particle (its index in a list), a voxel or a mesh's triangle (the point picked
// on it). Drawn by Mol*'s distance, angle and dihedral representations. A state transform from the root that depends
// on the objects (`dependsOn`, dependencies.md §1): saved in a session, undone as any change, evaluated again when an
// object is (a mesh moved or scaled: its triangle's point with it), and removed with any. Its lines and text are sized
// to what it measures (the largest), times the person's text size and line width. Kept as `StageDistance` (its two
// points `a` and `b`, a third and fourth `c` and `d`): sessions with distances open as before.

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
  /**
   * A mesh's triangle (the object is the mesh's representation): its index, its instance and the point picked on it,
   * its barycentric weights of its second and third vertices, in the mesh's space (.v6/plans/gl/triangle-picking.md)
   */
  readonly triangle?: { readonly instance: number; readonly index: number; readonly uv: readonly [number, number] };
}

/** What a measurement measures: from its number of points */
export type MeasureKind = 'distance' | 'angle' | 'dihedral';

export const StageDistanceParams = {
  a: PD.Value<DistancePoint>({ ref: '', label: '', key: '' }, { isHidden: true }),
  b: PD.Value<DistancePoint>({ ref: '', label: '', key: '' }, { isHidden: true }),
  /** An angle's third point, a dihedral's third */
  c: PD.Value<DistancePoint | null>(null, { isHidden: true }),
  /** A dihedral's fourth point */
  d: PD.Value<DistancePoint | null>(null, { isHidden: true }),
  /** The explorer's row it is listed under (its key): its first pick's */
  node: PD.Text('', { isHidden: true }),
  textSize: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, { description: "Its text's size, times its own" }),
  lineWidth: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, { description: "Its line's width, times its own" }),
  opacity: PD.Numeric(1, { min: 0, max: 1, step: 0.01 }),
};
export type StageDistanceProps = PD.Values<typeof StageDistanceParams>;

/** What a measurement's shapes stand for: Mol*'s data, and the kind a pick tells it by */
export interface StageDistanceData extends Partial<DistanceData> {
  readonly kind: 'stage-tools-distance';
  readonly measure: MeasureKind;
  /** Its points as drawn */
  readonly points: readonly Loci[];
  /** Its value (Å; an angle's, degrees), measured once when made or updated */
  readonly value: number;
}

/** The points of a measurement, in order */
export function pointsOf(params: StageDistanceProps): DistancePoint[] {
  const out = [params.a, params.b];
  if (params.c) out.push(params.c);
  if (params.c && params.d) out.push(params.d);
  return out;
}

export const measureOf = (count: number): MeasureKind => (count >= 4 ? 'dihedral' : count === 3 ? 'angle' : 'distance');

/** Its value as people read it: "12.34 Å", "109.47°" */
export const valueLabel = (measure: MeasureKind, value: number) =>
  `${value.toFixed(2)}${measure === 'distance' ? ' Å' : '°'}`;

export function isStageDistanceData(x: unknown): x is StageDistanceData {
  return !!x && (x as StageDistanceData).kind === 'stage-tools-distance';
}

/** A point's loci on its object as drawn (moved, decorated), and the size of what it is; undefined when gone */
export function pointLoci(
  plugin: PluginContext,
  p: DistancePoint,
  /** Meshes not drawn as surfaces now (a wireframe only), by their representation's ref: `hiddenMeshShapes` */
  meshes?: ReadonlyMap<string, Shape<Mesh>>,
): { loci: Loci; radius: number } | undefined {
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
  if (p.triangle) {
    const shape = meshShapeOf(plugin, p.ref) ?? meshes?.get(p.ref);
    if (!shape || p.triangle.index < 0 || p.triangle.index >= shape.geometry.triangleCount) return undefined;
    if (!shape.transforms[p.triangle.instance]) return undefined;
    const loci = triangleLoci(shape, p.triangle);
    return { loci, radius: Loci.getBoundingSphere(loci)?.radius ?? 1 };
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

/** A mesh's shape picked by triangle, as its representation (by state ref) draws it now */
export function meshShapeOf(plugin: PluginContext, ref: string): Shape<Mesh> | undefined {
  const obj = plugin.state.data.cells.get(ref)?.obj;
  if (!SO.Shape.Representation3D.is(obj)) return undefined;
  for (const l of obj.data.repr.getAllLoci()) {
    if (Shape.isLoci(l) && l.shape.geometry.kind === 'mesh' && l.shape.getTriangleLoci) return l.shape as Shape<Mesh>;
  }
  return undefined;
}

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

/** A measurement's value between its points' centers, as Mol* draws it: Å, or degrees for an angle and a dihedral */
export function measureValue(points: readonly Loci[]): number {
  const c = points.map((l) => Loci.getBoundingSphere(l)?.center);
  if (c.some((x) => !x)) return NaN;
  const [a, b, x, y] = c as Vec3[];
  if (points.length === 2) return Vec3.distance(a, b);
  if (points.length === 3) return radToDeg(Vec3.angle(Vec3.sub(Vec3(), a, b), Vec3.sub(Vec3(), x, b)));
  return radToDeg(Vec3.dihedralAngle(a, b, x, y));
}

/**
 * Mol*'s distance props for a distance of this size: its text and line scaled by the larger of the two things it
 * measures (an atom: 2 Å, Mol*'s own; a protein of a cellPACK model: its radius), times the person's factors. Mol*'s
 * text is already scaled by its loci's spheres (`max(2, r) / 2`): taken out, so a particle without a radius (its
 * sphere a point) is sized by its decoration.
 */
export function distanceProps(params: StageDistanceProps, a: { loci: Loci; radius: number }, b: typeof a) {
  return measureProps(DistanceParams, params, [a, b]);
}

/** Mol*'s props of a measurement's representation, sized as `distanceProps` says, for any number of points */
function measureProps<P extends PD.Params>(
  defs: P,
  params: StageDistanceProps,
  points: readonly { loci: Loci; radius: number }[],
) {
  const size = Math.max(2, ...points.map((p) => p.radius)) / 2;
  const own = Math.max(2, ...points.map((p) => Loci.getBoundingSphere(p.loci)?.radius ?? 0)) / 2;
  const d = PD.getDefaultValues(defs) as PD.Values<P> & { textSize: number; linesSize: number; dashLength: number };
  return {
    ...d,
    textColor: Color(0xffffff),
    textSize: (d.textSize * params.textSize * size) / own,
    linesSize: d.linesSize * params.lineWidth * size,
    dashLength: d.dashLength * size,
    alpha: params.opacity,
  };
}

/**
 * The shapes of the meshes a measurement's triangles are on whose representation does not draw the surface now (its
 * visuals a wireframe only: Mol*'s multi-representation lists the shown visuals' loci only), from the mesh's provider
 * (its getter is memoized: the shape it draws with these props, its transforms current)
 */
export async function hiddenMeshShapes(
  plugin: PluginContext,
  points: readonly DistancePoint[],
  runtime: RuntimeContext,
): Promise<Map<string, Shape<Mesh>>> {
  const out = new Map<string, Shape<Mesh>>();
  const { cells } = plugin.state.data;
  for (const p of points) {
    if (!p.triangle || out.has(p.ref) || meshShapeOf(plugin, p.ref)) continue;
    const repr = cells.get(p.ref);
    const provider = repr && cells.get(repr.transform.parent)?.obj;
    if (!SO.Shape.Representation3D.is(repr?.obj) || !SO.Shape.Provider.is(provider)) continue;
    const shape = await provider.data.getShape(runtime, provider.data.data, repr.obj.data.repr.props as never);
    if (shape.geometry.kind === 'mesh' && shape.getTriangleLoci) out.set(p.ref, shape as Shape<Mesh>);
  }
  return out;
}

async function dataOf(plugin: PluginContext, params: StageDistanceProps, runtime: RuntimeContext) {
  const meshes = await hiddenMeshShapes(plugin, pointsOf(params), runtime);
  const points = pointsOf(params).map((p) => pointLoci(plugin, p, meshes));
  if (points.some((p) => !p)) throw new Error('A point of the measurement is gone.');
  const at = points as { loci: Loci; radius: number }[];
  const loci = at.map((p) => p.loci);
  const measure = measureOf(loci.length);
  const value = measureValue(loci);
  const base = { kind: 'stage-tools-distance' as const, measure, points: loci, value };
  if (measure === 'angle') {
    const data = { ...base, triples: [{ loci: loci as unknown as Loci.Bundle<3>['loci'] }] };
    return { data, props: measureProps(AngleParams, params, at), value, measure };
  }
  if (measure === 'dihedral') {
    const data = { ...base, quads: [{ loci: loci as unknown as Loci.Bundle<4>['loci'] }] };
    return { data, props: measureProps(DihedralParams, params, at), value, measure };
  }
  const data = { ...base, pairs: [{ loci: loci as unknown as Loci.Bundle<2>['loci'] }] };
  return { data, props: measureProps(DistanceParams, params, at), value, measure };
}

/** Mol*'s representation of a measurement */
function representationOf(plugin: PluginContext, measure: MeasureKind) {
  const ctx = { graphics: plugin.canvas3d?.graphics, ...plugin.representation.structure.themes };
  if (measure === 'angle') return AngleRepresentation(ctx, () => AngleParams);
  if (measure === 'dihedral') return DihedralRepresentation(ctx, () => DihedralParams);
  return DistanceRepresentation(ctx, () => DistanceParams);
}

/** A measurement's kind as people read it */
export const MeasureNames = { distance: 'Distance', angle: 'Angle', dihedral: 'Dihedral' } as const;

export type StageDistance = typeof StageDistance;
export const StageDistance = PluginStateTransform.BuiltIn({
  name: 'stage-tools-distance',
  display: { name: 'Distance', description: 'A distance, an angle or a dihedral between points of the scene' },
  from: SO.Root,
  to: SO.Shape.Representation3D,
  params: StageDistanceParams,
})({
  canAutoUpdate: () => true,
  apply({ params }, plugin: PluginContext) {
    return Task.create('Measurement', async (ctx) => {
      const { data, props, value, measure } = await dataOf(plugin, params, ctx);
      const repr = representationOf(plugin, measure);
      await repr.createOrUpdate(props as never, data as never).runInContext(ctx);
      return new SO.Shape.Representation3D(
        { repr: repr as never, sourceData: data },
        { label: valueLabel(measure, value), description: MeasureNames[measure] },
      );
    });
  },
  update({ b, newParams }, plugin: PluginContext) {
    return Task.create('Measurement', async (ctx) => {
      const { data, props, value, measure } = await dataOf(plugin, newParams, ctx);
      // the same number of points (an edit of its look, a move of an object): the same representation
      if ((b.data.sourceData as StageDistanceData | undefined)?.measure !== measure) {
        return StateTransformer.UpdateResult.Recreate;
      }
      await b.data.repr.createOrUpdate(props as never, data as never).runInContext(ctx);
      b.data.sourceData = data;
      b.label = valueLabel(measure, value);
      return StateTransformer.UpdateResult.Updated;
    });
  },
});

/** A point from a pick (a structure's, a particle list's, a volume's, a mesh's): what to keep of it in a measurement */
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
  // a mesh's triangle, at the point picked on it (its centroid when none was)
  if (ShapeGroup.isLoci(loci) && loci.triangles?.length === 1) {
    const { instance, index, uv } = loci.triangles[0];
    return { ...object, triangle: { instance, index, uv: uv ? [uv[0], uv[1]] : [1 / 3, 1 / 3] } };
  }
  return undefined;
}
