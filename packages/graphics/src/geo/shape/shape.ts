/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Shape, ShapeGroup } from '@molstar/model/model/shape/shape';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Sphere3D } from '@molstar/core/math/geometry';
import { CentroidHelper } from '@molstar/core/math/geometry/centroid-helper';
import type { GroupMapping } from '../util.js';
import { ShapeGroupSizeTheme } from '@molstar/graphics/theme/size/shape-group';
import { ShapeGroupColorTheme } from '@molstar/graphics/theme/color/shape-group';
import type { Theme } from '@molstar/graphics/theme/theme';
import { type TransformData, createTransform as createGeometryTransform } from '../geometry/transform-data.js';
import { createRenderObject as createGlRenderObject, getNextMaterialId } from '@molstar/graphics/gl/render-object';
import type { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { LocationIterator } from '../util/location-iterator.js';
import { Geometry } from '../geometry/geometry.js';
import { OrderedSet } from '@molstar/core/data/int';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import type { Mesh } from '../geometry/mesh/mesh.js';
import { getMeshTriangleLookup, MeshTrianglePick } from '../geometry/mesh/triangle-pick.js';

export function getTheme(shape: Shape): Theme {
  return {
    color: ShapeGroupColorTheme({ shape }, {}),
    size: ShapeGroupSizeTheme({ shape }, {}),
  };
}

export function groupIterator(shape: Shape): LocationIterator {
  const instanceCount = shape.transforms.length;
  const location = ShapeGroup.Location(shape);
  const getLocation = (groupIndex: number, instanceIndex: number) => {
    location.group = groupIndex;
    location.instance = instanceIndex;
    return location;
  };
  return LocationIterator(shape.groupCount, instanceCount, 1, getLocation);
}

export function createTransform(
  transforms: Mat4[],
  invariantBoundingSphere: Sphere3D,
  cellSize: number,
  batchSize: number,
  transformData?: TransformData,
) {
  const transformArray =
    transformData && transformData.aTransform.ref.value.length >= transforms.length * 16
      ? transformData.aTransform.ref.value
      : new Float32Array(transforms.length * 16);
  for (let i = 0, il = transforms.length; i < il; ++i) Mat4.toArray(transforms[i], transformArray, i * 16);
  return createGeometryTransform(
    transformArray,
    transforms.length,
    invariantBoundingSphere,
    cellSize,
    batchSize,
    transformData,
  );
}

export function createRenderObject<G extends Geometry>(shape: Shape<G>, props: PD.Values<Geometry.Params<G>>) {
  const theme = getTheme(shape);
  const utils = Geometry.getUtils(shape.geometry);
  const materialId = getNextMaterialId();
  const locationIt = groupIterator(shape);
  const transform = createTransform(shape.transforms, shape.geometry.boundingSphere, props.cellSize, props.batchSize);
  const values = utils.createValues(shape.geometry, transform, locationIt, theme, props);
  const state = utils.createRenderableState(props);
  return createGlRenderObject(shape.geometry.kind, values, state, materialId);
}

const sphereHelper = new CentroidHelper(),
  tmpPos = Vec3.zero();

function sphereHelperInclude(
  groups: ShapeGroup.Loci['groups'],
  mapping: GroupMapping,
  positions: Float32Array,
  transforms: Mat4[],
) {
  const { indices, offsets } = mapping;
  for (const { ids, instance } of groups) {
    OrderedSet.forEach(ids, (v) => {
      for (let i = offsets[v], il = offsets[v + 1]; i < il; ++i) {
        Vec3.fromArray(tmpPos, positions, indices[i] * 3);
        Vec3.transformMat4(tmpPos, tmpPos, transforms[instance]);
        sphereHelper.includeStep(tmpPos);
      }
    });
  }
}

function sphereHelperRadius(
  groups: ShapeGroup.Loci['groups'],
  mapping: GroupMapping,
  positions: Float32Array,
  transforms: Mat4[],
) {
  const { indices, offsets } = mapping;
  for (const { ids, instance } of groups) {
    OrderedSet.forEach(ids, (v) => {
      for (let i = offsets[v], il = offsets[v + 1]; i < il; ++i) {
        Vec3.fromArray(tmpPos, positions, indices[i] * 3);
        Vec3.transformMat4(tmpPos, tmpPos, transforms[instance]);
        sphereHelper.radiusStep(tmpPos);
      }
    });
  }
}

/** Graphics-side implementation for bounds of selected shape groups. */
export function getGroupBoundingSphere(loci: ShapeGroup.Loci, boundingSphere?: Sphere3D) {
  if (!boundingSphere) boundingSphere = Sphere3D();
  sphereHelper.reset();
  let padding = 0;
  const geometry = loci.shape.geometry as Geometry;
  const { transforms } = loci.shape;
  if (geometry.kind === 'mesh' || geometry.kind === 'points') {
    const positions = geometry.kind === 'mesh' ? geometry.vertexBuffer.ref.value : geometry.centerBuffer.ref.value;
    sphereHelperInclude(loci.groups, geometry.groupMapping, positions, transforms);
    sphereHelper.finishedIncludeStep();
    sphereHelperRadius(loci.groups, geometry.groupMapping, positions, transforms);
  } else if (geometry.kind === 'lines') {
    const start = geometry.startBuffer.ref.value,
      end = geometry.endBuffer.ref.value;
    sphereHelperInclude(loci.groups, geometry.groupMapping, start, transforms);
    sphereHelperInclude(loci.groups, geometry.groupMapping, end, transforms);
    sphereHelper.finishedIncludeStep();
    sphereHelperRadius(loci.groups, geometry.groupMapping, start, transforms);
    sphereHelperRadius(loci.groups, geometry.groupMapping, end, transforms);
  } else if (geometry.kind === 'spheres' || geometry.kind === 'text') {
    const positions = geometry.centerBuffer.ref.value;
    sphereHelperInclude(loci.groups, geometry.groupMapping, positions, transforms);
    sphereHelper.finishedIncludeStep();
    sphereHelperRadius(loci.groups, geometry.groupMapping, positions, transforms);
    for (const { ids, instance } of loci.groups)
      OrderedSet.forEach(ids, (v) => {
        const value = loci.shape.getSize(v, instance);
        if (padding < value) padding = value;
      });
  } else {
    return Sphere3D.copy(boundingSphere, geometry.boundingSphere);
  }
  Vec3.copy(boundingSphere.center, sphereHelper.center);
  boundingSphere.radius = Math.sqrt(sphereHelper.radiusSq);
  Sphere3D.expand(boundingSphere, boundingSphere, padding);
  return boundingSphere;
}

/** Create a shape with graphics-derived group counts and selected-group bounds. */
export function create<G extends Geometry>(
  name: string,
  sourceData: unknown,
  geometry: G,
  getColor: Shape['getColor'],
  getSize: Shape['getSize'],
  getLabel: Shape['getLabel'],
  transforms?: Mat4[],
  groupCount?: number,
): Shape<G> {
  const shape = Shape.create(
    name,
    sourceData,
    geometry,
    getColor,
    getSize,
    getLabel,
    groupCount ?? Geometry.getGroupCount(geometry),
    transforms,
  );
  shape.getGroupBoundingSphere = (groups, out) => getGroupBoundingSphere(ShapeGroup.Loci(shape, groups), out);
  return shape;
}

// --- triangles of a mesh shape ---------------------------------------------------------------------------------------

const tmpA = Vec3();
const tmpB = Vec3();
const tmpC = Vec3();
const tmpInv = Mat4();
const identity = Mat4.identity();
const tmpRay = Ray3D();
const tmpNear = Vec3();
const tmpPick = MeshTrianglePick();

function triangleVertex(out: Vec3, mesh: Mesh, index: number, k: number, transform: Mat4) {
  Vec3.fromArray(out, mesh.vertexBuffer.ref.value, mesh.indexBuffer.ref.value[3 * index + k] * 3);
  return Vec3.transformMat4(out, out, transform);
}

/** The point of a triangle at barycentric weights `uv` of its second and third vertices, in its instance (world) */
export function trianglePoint(out: Vec3, shape: Shape<Mesh>, triangle: ShapeGroup.Triangle): Vec3 {
  const m = shape.transforms[triangle.instance] ?? identity;
  const [u, v] = triangle.uv ?? [1 / 3, 1 / 3];
  triangleVertex(tmpA, shape.geometry, triangle.index, 0, m);
  triangleVertex(tmpB, shape.geometry, triangle.index, 1, m);
  triangleVertex(tmpC, shape.geometry, triangle.index, 2, m);
  Vec3.scale(out, tmpA, 1 - u - v);
  Vec3.scaleAndAdd(out, out, tmpB, u);
  return Vec3.scaleAndAdd(out, out, tmpC, v);
}

/**
 * Bounds of triangles of a mesh shape: one triangle's are centered on its point (its picked point, else its centroid:
 * what a measurement measures from), several triangles' on their vertices' middle; each reaching all their vertices
 */
export function getTriangleBoundingSphere(
  shape: Shape<Mesh>,
  triangles: ReadonlyArray<ShapeGroup.Triangle>,
  boundingSphere?: Sphere3D,
): Sphere3D {
  if (!boundingSphere) boundingSphere = Sphere3D();
  const valid = triangles.filter((t) => t.index >= 0 && t.index < shape.geometry.triangleCount);
  if (!valid.length) return Sphere3D.copy(boundingSphere, shape.geometry.boundingSphere);
  const eachVertex = (f: (v: Vec3) => void) => {
    for (const t of valid) {
      const m = shape.transforms[t.instance] ?? identity;
      for (let k = 0; k < 3; ++k) f(triangleVertex(tmpA, shape.geometry, t.index, k, m));
    }
  };
  if (valid.length === 1) {
    trianglePoint(boundingSphere.center, shape, valid[0]);
  } else {
    sphereHelper.reset();
    eachVertex((v) => sphereHelper.includeStep(v));
    sphereHelper.finishedIncludeStep();
    Vec3.copy(boundingSphere.center, sphereHelper.center);
  }
  let r = 0;
  eachVertex((v) => (r = Math.max(r, Vec3.distance(v, boundingSphere.center))));
  boundingSphere.radius = r;
  return boundingSphere;
}

/** The group of a triangle: its first vertex's (a group varying across it is the pick's provoking vertex's) */
export function triangleGroup(mesh: Mesh, index: number): number {
  return mesh.groupBuffer.ref.value[mesh.indexBuffer.ref.value[3 * index]];
}

/** A loci of one triangle of a mesh shape, at a point on it (barycentric weights `uv`), in its group */
export function triangleLoci(shape: Shape<Mesh>, triangle: ShapeGroup.Triangle): ShapeGroup.Loci {
  const group = triangleGroup(shape.geometry, triangle.index);
  return ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(group), instance: triangle.instance }], [triangle]);
}

/**
 * Picks the mesh shape by triangle (`Shape.getTriangleLoci`): a pick of a group becomes one of the triangle under the
 * pointer and the point on it, its bounds that point's. A file's mesh (OBJ, PLY, VTP) opts in; meshes whose groups are
 * their meaning (a plane's, a handle's) do not.
 */
export function enableTrianglePicking(shape: Shape<Mesh>) {
  shape.getTriangleBoundingSphere = (triangles, out) => getTriangleBoundingSphere(shape, triangles, out);
  shape.getTriangleLoci = (loci, ray, near, tolerance) => {
    const g = loci.groups[0];
    const m = g && shape.transforms[g.instance];
    if (!m || loci.shape !== shape) return loci;
    // in the mesh's space: the ray, the depth point and the tolerance (a scaled instance's)
    Mat4.invert(tmpInv, m);
    Ray3D.transform(tmpRay, ray, tmpInv);
    Vec3.transformMat4(tmpNear, near, tmpInv);
    const scale = Mat4.getMaxScaleOnAxis(m) || 1;
    if (!getMeshTriangleLookup(shape.geometry).pick(tmpPick, tmpRay, tmpNear, tolerance / scale)) return loci;
    const triangle = { instance: g.instance, index: tmpPick.index, uv: [tmpPick.u, tmpPick.v] as const };
    return ShapeGroup.Loci(shape, loci.groups, [triangle]);
  };
  return shape;
}
