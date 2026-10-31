/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet } from '@molstar/core/data/int';
import { ChunkedArray } from '@molstar/core/data/util';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { EveryLoci } from '@molstar/model/model/loci';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { Lines } from '@molstar/graphics/geo/geometry/lines/lines';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { ShapeMultiRepresentation, ShapeRepresentation } from '../representation.js';

// A mesh picked by triangle marks the triangle, not its group (.v6/plans/gl/triangle-picking.md)

/** A unit square of two triangles, one material (group 0) */
function square(): Mesh {
  const state = MeshBuilder.createState(4, 2);
  ChunkedArray.add3(state.vertices, 0, 0, 0);
  ChunkedArray.add3(state.vertices, 1, 0, 0);
  ChunkedArray.add3(state.vertices, 1, 1, 0);
  ChunkedArray.add3(state.vertices, 0, 1, 0);
  for (let i = 0; i < 4; i++) {
    ChunkedArray.add3(state.normals, 0, 0, 1);
    ChunkedArray.add(state.groups, 0);
  }
  ChunkedArray.add3(state.indices, 0, 1, 2);
  ChunkedArray.add3(state.indices, 0, 2, 3);
  return MeshBuilder.getMesh(state);
}

const Params = {
  ...Mesh.Params,
  ...Lines.Params,
  visuals: PD.MultiSelect(['mesh'], PD.arrayToOptions(['mesh', 'wireframe'] as const)),
};

async function make(byTriangle = true, transforms?: Mat4[]) {
  const mesh = square();
  const meshShape = ShapeUtils.create(
    'square',
    {},
    mesh,
    () => ColorNames.red,
    () => 1,
    () => 'Material',
    transforms,
    1,
  );
  if (byTriangle) ShapeUtils.enableTrianglePicking(meshShape);
  const linesShape = ShapeUtils.create(
    'square-wireframe',
    {},
    Lines.fromMesh(mesh),
    () => ColorNames.red,
    () => 1,
    () => '',
    transforms,
    1,
  );
  const repr = ShapeMultiRepresentation('Test', Params, {
    mesh: ShapeRepresentation(() => meshShape, Mesh.Utils),
    wireframe: ShapeRepresentation(() => linesShape, Lines.Utils),
  });
  await repr.createOrUpdate({ ...PD.getDefaultValues(Params), visuals: ['mesh', 'wireframe'] }, {}).run();
  return { repr, meshShape };
}

const triangle = (shape: Shape, index: number) =>
  ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(0), instance: 0 }], [{ instance: 0, index }]);

const objects = (repr: Awaited<ReturnType<typeof make>>['repr']) => {
  const [mesh, marks, lines] = repr.renderObjects;
  return { mesh, marks, lines };
};
const average = (o: { values: unknown }) => (o.values as any).markerAverage.ref.value as number;
const drawCount = (o: { values: unknown }) => (o.values as any).drawCount.ref.value as number;
const markers = (o: { values: unknown }) => [
  ...(o.values as any).tMarker.ref.value.array.slice(0, (o.values as any).uGroupCount.ref.value),
];

describe('a mesh marked by triangle', () => {
  it('has a render object for its marked triangles from the start, empty, not pickable', async () => {
    const { repr } = await make();
    expect(repr.renderObjects.map((o) => o.type)).toEqual(['mesh', 'mesh', 'lines']);
    const { marks } = objects(repr);
    expect(drawCount(marks)).toBe(0);
    expect(marks.state.pickable).toBe(false);
  });

  it('highlights only the triangle: its copies marked, its group (the material) not', async () => {
    const { repr, meshShape } = await make();
    expect(repr.mark(triangle(meshShape, 1), MarkerAction.Highlight)).toBe(true);
    const { mesh, marks, lines } = objects(repr);
    // two copies (one off each side), 3 vertices each
    expect(drawCount(marks)).toBe(6);
    expect(markers(marks)).toEqual([1]);
    expect(average(mesh)).toBe(0);
    expect(average(lines)).toBe(0);
    // where triangle 1 is: (0,0), (1,1), (0,1)
    const vb = (marks.values as any).aPosition.ref.value as Float32Array;
    expect(Math.round(vb[3 * 1 + 0] * 100) / 100).toBe(1);
    expect(Math.round(vb[3 * 1 + 1] * 100) / 100).toBe(1);
  });

  it('reuses its buffers from hover to hover (nothing new a pointer move but what grows)', async () => {
    const { repr, meshShape } = await make();
    repr.mark(triangle(meshShape, 0), MarkerAction.Highlight);
    const before = (objects(repr).marks.values as any).aPosition.ref.value;
    repr.mark(triangle(meshShape, 0), MarkerAction.RemoveHighlight);
    repr.mark(triangle(meshShape, 1), MarkerAction.Highlight);
    expect((objects(repr).marks.values as any).aPosition.ref.value).toBe(before);
  });

  it('moves the highlight from triangle to triangle of the same group, and clears it', async () => {
    const { repr, meshShape } = await make();
    repr.mark(triangle(meshShape, 0), MarkerAction.Highlight);
    repr.mark(triangle(meshShape, 0), MarkerAction.RemoveHighlight);
    repr.mark(triangle(meshShape, 1), MarkerAction.Highlight);
    expect(drawCount(objects(repr).marks)).toBe(6);
    expect(repr.mark(EveryLoci, MarkerAction.RemoveHighlight)).toBe(true);
    expect(drawCount(objects(repr).marks)).toBe(0);
  });

  it('selects triangles by toggles, highlighted over selected, deselected whole', async () => {
    const { repr, meshShape } = await make();
    repr.mark(triangle(meshShape, 0), MarkerAction.Toggle);
    repr.mark(triangle(meshShape, 1), MarkerAction.Toggle);
    repr.mark(triangle(meshShape, 1), MarkerAction.Highlight);
    expect(drawCount(objects(repr).marks)).toBe(12);
    // selected 2, selected and highlighted 3
    expect(markers(objects(repr).marks)).toEqual([2, 3]);
    repr.mark(triangle(meshShape, 0), MarkerAction.Toggle);
    expect(markers(objects(repr).marks)).toEqual([3]);
    repr.mark(Shape.Loci(meshShape), MarkerAction.Deselect);
    expect(markers(objects(repr).marks)).toEqual([1]);
  });

  it('copies an instance where its transform puts it', async () => {
    const { repr, meshShape } = await make(true, [Mat4.fromTranslation(Mat4(), Vec3.create(10, 0, 0))]);
    repr.mark(triangle(meshShape, 0), MarkerAction.Highlight);
    const vb = (objects(repr).marks.values as any).aPosition.ref.value as Float32Array;
    expect(Math.round(vb[0])).toBe(10);
  });

  it('keeps its marks when the mesh is moved (a new shape of the same mesh), drawn where it went', async () => {
    const mesh = square();
    const at = (x: number) =>
      ShapeUtils.enableTrianglePicking(
        ShapeUtils.create(
          'square',
          {},
          mesh,
          () => ColorNames.red,
          () => 1,
          () => '',
          [Mat4.fromTranslation(Mat4(), Vec3.create(x, 0, 0))],
          1,
        ),
      );
    let shape = at(0);
    const repr = ShapeRepresentation(() => shape, Mesh.Utils);
    await repr.createOrUpdate(PD.getDefaultValues(Mesh.Params), {}).run();
    repr.mark(triangle(shape, 0), MarkerAction.Select);
    shape = at(10);
    await repr.createOrUpdate({}, {}).run();
    const marks = repr.renderObjects[1];
    expect(drawCount(marks)).toBe(6);
    expect(Math.round((marks.values as any).aPosition.ref.value[0])).toBe(10);
    // another mesh: its triangles are others, the marks go
    shape = ShapeUtils.enableTrianglePicking(
      ShapeUtils.create(
        'square',
        {},
        square(),
        () => ColorNames.red,
        () => 1,
        () => '',
        undefined,
        1,
      ),
    );
    await repr.createOrUpdate({}, {}).run();
    expect(drawCount(repr.renderObjects[1])).toBe(0);
  });

  it('removes a highlight made before the mesh moved, when that same loci is cleared', async () => {
    const mesh = square();
    const at = (x: number) =>
      ShapeUtils.enableTrianglePicking(
        ShapeUtils.create(
          'square',
          {},
          mesh,
          () => ColorNames.red,
          () => 1,
          () => '',
          [Mat4.fromTranslation(Mat4(), Vec3.create(x, 0, 0))],
          1,
        ),
      );
    let shape = at(0);
    const linesShape = ShapeUtils.create(
      'square-wireframe',
      {},
      Lines.fromMesh(mesh),
      () => ColorNames.red,
      () => 1,
      () => '',
      undefined,
      1,
    );
    const repr = ShapeMultiRepresentation('Test', Params, {
      mesh: ShapeRepresentation(() => shape, Mesh.Utils),
      wireframe: ShapeRepresentation(() => linesShape, Lines.Utils),
    });
    await repr.createOrUpdate({ ...PD.getDefaultValues(Params), visuals: ['mesh', 'wireframe'] }, {}).run();
    const loci = triangle(shape, 0);
    expect(repr.mark(loci, MarkerAction.Highlight)).toBe(true);
    shape = at(8);
    await repr.createOrUpdate({}, {}).run();
    expect(drawCount(objects(repr).marks)).toBe(6);
    // the loci still names the shape from before the move; leaving the triangle must clear it
    expect(repr.mark(loci, MarkerAction.RemoveHighlight)).toBe(true);
    expect(drawCount(objects(repr).marks)).toBe(0);
  });

  it('a mesh picked by group has no marked triangles: a group loci marks its group as before', async () => {
    const { repr, meshShape } = await make(false);
    expect(repr.renderObjects.map((o) => o.type)).toEqual(['mesh', 'lines']);
    repr.mark(ShapeGroup.Loci(meshShape, [{ ids: OrderedSet.ofSingleton(0), instance: 0 }]), MarkerAction.Highlight);
    expect(average(repr.renderObjects[0])).toBeGreaterThan(0);
  });
});
