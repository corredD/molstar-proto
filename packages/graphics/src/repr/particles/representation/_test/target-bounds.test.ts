/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ChunkedArray } from '@molstar/core/data/util';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import type { GraphicsRenderObject, MergedGraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { ColorTheme } from '@molstar/graphics/theme/color';
import { SizeTheme } from '@molstar/graphics/theme/size';
import { ParticleTargetRepresentationProvider } from '../target/representation.js';

// The decorations' render objects bounded where their particles are once the list moves (Ludo, 2026-10-31: a list
// scaled after it was decorated, its decorations dropped when zooming in, the camera's planes and the culling from
// bounds left where the particles were). Updated in place, they must be bounded as made again on the moved list.

/** A triangle about 1 Å, the object each particle is decorated with */
function triangle() {
  const state = MeshBuilder.createState(3, 1);
  ChunkedArray.add3(state.vertices, 0, 0, 0);
  ChunkedArray.add3(state.vertices, 1, 0, 0);
  ChunkedArray.add3(state.vertices, 0, 1, 0);
  for (let i = 0; i < 3; i++) ChunkedArray.add(state.groups, 0);
  ChunkedArray.add3(state.indices, 0, 1, 2);
  const mesh = MeshBuilder.getMesh(state);
  const shape = ShapeUtils.create(
    'triangle',
    {},
    mesh,
    () => ColorNames.red as Color,
    () => 1,
    () => '',
  );
  return { kind: 'shape', shape } as ParticleTarget;
}

/** Four particles, of one target or two: two objects each */
function particleList(targets: number): ParticleList {
  const target = triangle();
  const ids = Array.from({ length: targets }, (_, i) => i);
  return {
    count: 4,
    keys: Int32Array.of(0, 1, 2, 3),
    targets: targets === 1 ? new Int32Array(4) : Int32Array.of(0, 0, 1, 1),
    targetInfo: new Map(ids.map((i) => [i, { name: `t${i}` }])),
    targetMapping: new Map(ids.map((i) => [i, target])),
    coordinates: Float32Array.of(0, 0, 0, 10, 0, 0, 20, 5, 0, 30, 0, 5),
    getParticleLabel: () => '',
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

/** The list scaled about the origin, then moved and turned, as `ParticleListTransform` gives it: a new list */
function transformed(list: ParticleList, scale: number, m: Mat4): ParticleList {
  const coordinates = new Float32Array(list.count * 3);
  const p = Vec3();
  for (let i = 0; i < list.count; ++i) {
    Vec3.scale(p, Vec3.fromArray(p, list.coordinates, i * 3), scale);
    Vec3.toArray(Vec3.transformMat4(p, p, m), coordinates, i * 3);
  }
  return { ...list, coordinates, _propertyData: Object.create(null) };
}

const ctx = { colorThemeRegistry: ColorTheme.createRegistry(), sizeThemeRegistry: SizeTheme.createRegistry() };

async function representation(list: ParticleList, renderMerged: boolean) {
  const repr = ParticleTargetRepresentationProvider.factory(ctx, ParticleTargetRepresentationProvider.getParams);
  await repr.createOrUpdate({ renderMerged }, list).run();
  return repr;
}

/** Each render object's bounds (a merged one's after its sync, as the renderable's update does) */
function bounds(objects: ReadonlyArray<GraphicsRenderObject>) {
  return objects.map((ro) => {
    (ro as Partial<MergedGraphicsRenderObject>).merged?.sync();
    return Sphere3D.clone(ro.values.boundingSphere.ref.value);
  });
}

const turn = Mat4.mul(
  Mat4(),
  Mat4.fromTranslation(Mat4(), Vec3.create(100, -50, 400)),
  Mat4.fromRotation(Mat4(), Math.PI / 3, Vec3.create(0, 0, 1)),
);

describe('the decorations of a list that moves', () => {
  for (const [name, targets, merged] of [
    ['one target', 1, false],
    ['two targets, merged', 2, true],
  ] as const) {
    it(`are bounded as made on the moved list (${name})`, async () => {
      const list = particleList(targets);
      const repr = await representation(list, merged);
      if (merged) expect((repr.renderObjects[0] as Partial<MergedGraphicsRenderObject>).merged).toBeDefined();
      const before = bounds(repr.renderObjects);
      for (const moved of [transformed(list, 10, Mat4.identity()), transformed(list, 10, turn)]) {
        await repr.createOrUpdate({}, moved).run();
        const fresh = await representation(moved, merged);
        const expected = bounds(fresh.renderObjects);
        const actual = bounds(repr.renderObjects);
        expect(actual.length).toBe(expected.length);
        for (let i = 0; i < actual.length; ++i) {
          expect(Vec3.distance(actual[i].center, expected[i].center)).toBeLessThan(1e-3);
          expect(actual[i].radius).toBeCloseTo(expected[i].radius, 3);
        }
        fresh.destroy();
      }
      // the control: the first list's bounds are another
      expect(bounds(repr.renderObjects)[0].radius).toBeGreaterThan(before[0].radius * 5);
      repr.destroy();
    });
  }

  it('keep a merged object as its members are, before a renderable syncs it (WebGPU, Ludo 2026-10-31)', async () => {
    // a scene adds a merged object a frame after the representation made it: updated in between (a scale right after
    // the decoration), its renderable is made from its values, which must be its members' already
    const list = particleList(2);
    const repr = await representation(list, true);
    const merged = repr.renderObjects[0];
    const moved = transformed(list, 10, turn);
    await repr.createOrUpdate({}, moved).run();
    expect(repr.renderObjects[0]).toBe(merged);
    const fresh = await representation(moved, true);
    const expected = fresh.renderObjects[0].values;
    const actual = merged.values;
    const floats = expected.instanceCount.ref.value * 16;
    expect(Array.from(actual.aTransform.ref.value.subarray(0, floats))).toEqual(
      Array.from(expected.aTransform.ref.value.subarray(0, floats)),
    );
    expect(
      Vec3.distance(actual.boundingSphere.ref.value.center, expected.boundingSphere.ref.value.center),
    ).toBeLessThan(1e-3);
    fresh.destroy();
    repr.destroy();
  });
});
