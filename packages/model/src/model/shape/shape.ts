/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Color } from '@molstar/core/util/color';
import { UUID } from '@molstar/core/util';
import { OrderedSet } from '@molstar/core/data/int';
import { Mat4 } from '@molstar/core/math/linear-algebra';
import type { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import type { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import type { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';

/** Data shared by a shape and its graphics integrations. `G` is deliberately
 * structural so the model package does not need to own graphics geometry. */
export interface ShapeGeometry {
  readonly kind: string;
  readonly boundingSphere: Sphere3D;
}

export interface Shape<G extends ShapeGeometry = ShapeGeometry> {
  readonly id: UUID;
  readonly name: string;
  readonly sourceData: unknown;
  readonly geometry: G;
  readonly transforms: Mat4[];
  readonly groupCount: number;
  getGroupBoundingSphere?: (groups: ShapeGroup.Loci['groups'], out?: Sphere3D) => Sphere3D;
  /** Bounds of triangles of a mesh shape: centered on their picked point (one triangle), else their middle */
  getTriangleBoundingSphere?: (triangles: ShapeGroup.Loci['triangles'] & {}, out?: Sphere3D) => Sphere3D;
  /**
   * A mesh shape picked by triangle: the group loci of a pick narrowed to the triangle the ray (world space) hits
   * nearest to `near` (the pick's depth point), within `tolerance` (Å) of it; the loci unchanged when none is found.
   * Absent: the shape is picked by group.
   */
  getTriangleLoci?: (loci: ShapeGroup.Loci, ray: Ray3D, near: Vec3, tolerance: number) => ShapeGroup.Loci;
  getColor(groupId: number, instanceId: number): Color;
  getSize(groupId: number, instanceId: number): number;
  getLabel(groupId: number, instanceId: number): string;
}

export namespace Shape {
  /** Create model-side shape data; rendering consumers should use the graphics Shape.create factory. */
  export function create<G extends ShapeGeometry>(
    name: string,
    sourceData: unknown,
    geometry: G,
    getColor: Shape['getColor'],
    getSize: Shape['getSize'],
    getLabel: Shape['getLabel'],
    groupCount: number,
    transforms?: Mat4[],
  ): Shape<G> {
    return {
      id: UUID.create22(),
      name,
      sourceData,
      geometry,
      transforms: transforms || [Mat4.identity()],
      groupCount,
      getColor,
      getSize,
      getLabel,
    };
  }

  export interface Loci {
    readonly kind: 'shape-loci';
    readonly shape: Shape;
  }
  export function Loci(shape: Shape): Loci {
    return { kind: 'shape-loci', shape };
  }
  export function isLoci(x: any): x is Loci {
    return !!x && x.kind === 'shape-loci';
  }
  export function areLociEqual(a: Loci, b: Loci) {
    return a.shape === b.shape;
  }
  export function isLociEmpty(loci: Loci) {
    return loci.shape.groupCount === 0;
  }
}

export namespace ShapeGroup {
  export interface Location {
    readonly kind: 'group-location';
    shape: Shape;
    group: number;
    instance: number;
  }

  export function Location(shape?: Shape, group = 0, instance = 0): Location {
    return { kind: 'group-location', shape: shape!, group, instance };
  }

  export function isLocation(x: any): x is Location {
    return !!x && x.kind === 'group-location';
  }

  /** A triangle of a mesh shape (its index in the mesh) in an instance, and a point on it */
  export interface Triangle {
    readonly instance: number;
    readonly index: number;
    /** The point picked on it, its barycentric weights of its second and third vertices; absent: its centroid */
    readonly uv?: readonly [number, number];
  }

  export interface Loci {
    readonly kind: 'group-loci';
    readonly shape: Shape;
    readonly groups: ReadonlyArray<{
      readonly ids: OrderedSet<number>;
      readonly instance: number;
    }>;
    /**
     * Triangles of a mesh shape inside its groups (`groups` holds theirs): a pick at the triangle (`getTriangleLoci`).
     * What reads only `groups` takes it as its groups.
     */
    readonly triangles?: ReadonlyArray<Triangle>;
  }

  export function Loci(shape: Shape, groups: Loci['groups'], triangles?: Loci['triangles']): Loci {
    return triangles?.length
      ? { kind: 'group-loci', shape, groups: groups as Loci['groups'], triangles }
      : { kind: 'group-loci', shape, groups: groups as Loci['groups'] };
  }

  export function isLoci(x: any): x is Loci {
    return !!x && x.kind === 'group-loci';
  }

  export function areLociEqual(a: Loci, b: Loci) {
    if (a.shape !== b.shape) return false;
    if (a.groups.length !== b.groups.length) return false;
    for (let i = 0, il = a.groups.length; i < il; ++i) {
      const { ids: idsA, instance: instanceA } = a.groups[i];
      const { ids: idsB, instance: instanceB } = b.groups[i];
      if (instanceA !== instanceB) return false;
      if (!OrderedSet.areEqual(idsA, idsB)) return false;
    }
    return areTrianglesEqual(a.triangles, b.triangles);
  }

  /** The same triangles, in the same order (their picked points aside: the same elements) */
  function areTrianglesEqual(a: Loci['triangles'], b: Loci['triangles']) {
    const n = a?.length ?? 0;
    if (n !== (b?.length ?? 0)) return false;
    for (let i = 0; i < n; ++i) {
      if (a![i].index !== b![i].index || a![i].instance !== b![i].instance) return false;
    }
    return true;
  }

  export function isLociEmpty(loci: Loci) {
    return size(loci) === 0 ? true : false;
  }

  export function size(loci: Loci) {
    let size = 0;
    for (const group of loci.groups) size += OrderedSet.size(group.ids);
    return size;
  }
}
