/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ChunkedArray } from '@molstar/core/data/util';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import type { GraphicsRenderObject, MergedGraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import { ColorTheme } from '@molstar/graphics/theme/color';
import { SizeTheme } from '@molstar/graphics/theme/size';
import { canSetParticleFrames, ParticleTargetRepresentationProvider } from '../target/representation.js';

// A drag's preview of some particles (a cellPACK protein moved by its handle, or every protein of its kind): only the
// moved particles' instances written (`setParticleFrames`), drawn as the representation made again on the moved list
// would draw them, the other targets' instances untouched, and put back on `undefined`. Why: a whole rebuild per pointer
// event (geometry, colors, every target) did not keep up with a drag on a whole-cell model (Ludo, 2026-11-05).

/** A triangle off the origin (its geometry's center is subtracted per instance), the object each particle is decorated with */
function triangle() {
  const state = MeshBuilder.createState(3, 1);
  ChunkedArray.add3(state.vertices, 2, 0, 0);
  ChunkedArray.add3(state.vertices, 3, 0, 0);
  ChunkedArray.add3(state.vertices, 2, 1, 0);
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

const target = triangle();

/** Four particles of two targets (0: particles 0 and 1, 1: particles 2 and 3), turned as `rotations` says */
function particleList(
  coordinates: Float32Array,
  rotations?: Float32Array,
  targets = Int32Array.of(0, 0, 1, 1),
): ParticleList {
  return {
    count: 4,
    keys: Int32Array.of(0, 1, 2, 3),
    targets,
    targetInfo: new Map([
      [0, { name: 't0' }],
      [1, { name: 't1' }],
    ]),
    targetMapping: new Map([
      [0, target],
      [1, target],
    ]),
    coordinates,
    rotations,
    getParticleLabel: () => '',
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const coordinates = Float32Array.of(0, 0, 0, 10, 0, 0, 20, 5, 0, 30, 0, 5);
const list = particleList(coordinates);

/** Particle 2 taken to (25, 7, 3) and turned 60° about z: the list as an offset would give it, and the frame alone */
const turn = Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 3);
const movedCoordinates = Float32Array.from(coordinates);
movedCoordinates.set([25, 7, 3], 6);
const rotations = new Float32Array(16);
for (let i = 0; i < 4; i++) Quat.toArray(i === 2 ? turn : Quat.identity(), rotations, i * 4);
const movedList = particleList(movedCoordinates, rotations);
const frame = Mat4.fromQuat(Mat4(), turn);
Mat4.setTranslation(frame, Vec3.create(25, 7, 3));
const frames = { indices: Int32Array.of(2), frames: Float32Array.from(frame) };

const ctx = { colorThemeRegistry: ColorTheme.createRegistry(), sizeThemeRegistry: SizeTheme.createRegistry() };

async function representation(l: ParticleList, renderMerged: boolean) {
  const repr = ParticleTargetRepresentationProvider.factory(ctx, ParticleTargetRepresentationProvider.getParams);
  await repr.createOrUpdate({ renderMerged }, l).run();
  return repr;
}

/** Each render object's transforms and bounds as drawn (a merged one's after its sync, as the renderable's update does) */
function drawn(objects: ReadonlyArray<GraphicsRenderObject>) {
  return objects.map((ro) => {
    (ro as Partial<MergedGraphicsRenderObject>).merged?.sync();
    const v = ro.values;
    const count = v.instanceCount.ref.value;
    const segments = (v as { aSegment?: { ref: { value: Float32Array } } }).aSegment?.ref.value;
    return {
      transforms: Array.from(v.aTransform.ref.value.subarray(0, count * 16)),
      // a merged object's instance ids and segment per instance, written per member by its sync
      instances: Array.from(v.aInstance.ref.value.subarray(0, count)),
      segments: segments ? Array.from(segments.subarray(0, count * 4)) : [],
      sphere: { center: Vec3.clone(v.boundingSphere.ref.value.center), radius: v.boundingSphere.ref.value.radius },
    };
  });
}

/**
 * Drawn as expected; `bounds: 'hold'` (a preview's merged objects: their bounds only grown, `sync`'s `growBounds`):
 * the bounds hold the expected ones, not equal them
 */
function expectDrawnAs(
  actual: ReturnType<typeof drawn>,
  expected: ReturnType<typeof drawn>,
  bounds: 'exact' | 'hold' = 'exact',
) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].instances).toEqual(expected[i].instances);
    expect(actual[i].segments).toEqual(expected[i].segments);
    expect(actual[i].transforms.length).toBe(expected[i].transforms.length);
    for (let j = 0; j < actual[i].transforms.length; j++) {
      expect(actual[i].transforms[j]).toBeCloseTo(expected[i].transforms[j], 4);
    }
    if (bounds === 'exact') {
      expect(Vec3.distance(actual[i].sphere.center, expected[i].sphere.center)).toBeLessThan(1e-3);
      expect(actual[i].sphere.radius).toBeCloseTo(expected[i].sphere.radius, 3);
    }
  }
}

/** A merged object's bounds hold each of its members' (what each target draws: the list made unmerged) */
async function expectBoundsHold(objects: ReadonlyArray<GraphicsRenderObject>, l: ParticleList) {
  const unmerged = await representation(l, false);
  const sphere = drawn(objects)[0].sphere;
  for (const member of drawn(unmerged.renderObjects)) {
    const d = Vec3.distance(sphere.center, member.sphere.center);
    expect(d + member.sphere.radius).toBeLessThanOrEqual(sphere.radius + 1e-3);
  }
  unmerged.destroy();
}

describe("a target representation's particles drawn at other frames (a drag's preview)", () => {
  for (const merged of [false, true]) {
    it(`draws the moved particle as made on the moved list, then as before (${merged ? 'merged' : 'one object a target'})`, async () => {
      const repr = await representation(list, merged);
      expect(canSetParticleFrames(repr)).toBe(true);
      if (merged) expect((repr.renderObjects[0] as Partial<MergedGraphicsRenderObject>).merged).toBeDefined();
      const before = drawn(repr.renderObjects);
      const moved = await representation(movedList, merged);
      const expected = drawn(moved.renderObjects);
      // the control: the move changes what is drawn
      expect(expected.some((e, i) => e.transforms.some((x, j) => Math.abs(x - before[i].transforms[j]) > 1e-3))).toBe(
        true,
      );

      expect(repr.setParticleFrames(frames)).toBe(true);
      expectDrawnAs(drawn(repr.renderObjects), expected, merged ? 'hold' : 'exact');
      if (merged) await expectBoundsHold(repr.renderObjects, movedList);
      // back to the list's frames
      expect(repr.setParticleFrames(undefined)).toBe(true);
      expectDrawnAs(drawn(repr.renderObjects), before);
      // nothing previewed: nothing to put back
      expect(repr.setParticleFrames(undefined)).toBe(false);
      moved.destroy();
      repr.destroy();
    });
  }

  it("writes the moved particles' target only: the other's instances and colors untouched", async () => {
    const repr = await representation(list, false);
    // one object a target, in the order of the targets
    const [other, own] = repr.renderObjects;
    const versions = (ro: GraphicsRenderObject) => ({
      aTransform: ro.values.aTransform.ref.version,
      transform: ro.values.transform.ref.version,
      tColor: ro.values.tColor.ref.version,
    });
    const otherBefore = versions(other);
    const ownBefore = versions(own);
    expect(repr.setParticleFrames(frames)).toBe(true);
    expect(versions(other)).toEqual(otherBefore);
    expect(versions(own).transform).toBeGreaterThan(ownBefore.transform);
    // colors are not made again for a move
    expect(versions(own).tColor).toBe(ownBefore.tColor);
    // a particle of no drawn target, or out of the list: nothing drawn changes
    expect(repr.setParticleFrames({ indices: Int32Array.of(9), frames: Float32Array.from(frame) })).toBe(false);
    repr.destroy();
  });

  it('draws frames of several targets in any order, each at its particle', async () => {
    // particles 3 (target 1), 0 (target 0) and 2 (target 1 again, after another): target 1 is met twice
    const moved = Float32Array.from(coordinates);
    moved.set([31, 1, 5], 9);
    moved.set([1, 2, 3], 0);
    moved.set([25, 7, 3], 6);
    const expected = await representation(particleList(moved, rotations), true);
    const frameAt = (q: Quat, p: number[]) => {
      const m = Mat4.fromQuat(Mat4(), q);
      return Mat4.setTranslation(m, Vec3.create(p[0], p[1], p[2]));
    };
    const all = new Float32Array(48);
    Mat4.toArray(frameAt(Quat.identity(), [31, 1, 5]), all, 0);
    Mat4.toArray(frameAt(Quat.identity(), [1, 2, 3]), all, 16);
    Mat4.toArray(frameAt(turn, [25, 7, 3]), all, 32);
    const repr = await representation(list, true);
    expect(repr.setParticleFrames({ indices: Int32Array.of(3, 0, 2), frames: all })).toBe(true);
    expectDrawnAs(drawn(repr.renderObjects), drawn(expected.renderObjects), 'hold');
    await expectBoundsHold(repr.renderObjects, particleList(moved, rotations));
    expected.destroy();
    repr.destroy();
  });

  it('keeps the merged bounds holding what is drawn while previewed, and exact again when put back', async () => {
    const repr = await representation(list, true);
    const before = drawn(repr.renderObjects)[0].sphere;
    // particle 2 taken far out: the bounds grown to hold it
    const far = Mat4.fromTranslation(Mat4(), Vec3.create(500, 0, 0));
    expect(repr.setParticleFrames({ indices: Int32Array.of(2), frames: Float32Array.from(far) })).toBe(true);
    const grown = repr.renderObjects[0].values.boundingSphere.ref.value;
    expect(Vec3.distance(grown.center, Vec3.create(500, 0, 0))).toBeLessThan(grown.radius);
    // put back: exact again, as before the preview
    expect(repr.setParticleFrames(undefined)).toBe(true);
    const back = repr.renderObjects[0].values.boundingSphere.ref.value;
    expect(Vec3.distance(back.center, before.center)).toBeLessThan(1e-3);
    expect(back.radius).toBeCloseTo(before.radius, 3);
    repr.destroy();
  });

  // A commit's list is the old one with some particles moved (`offsetParticles`: its coordinates and rotations new, the
  // rest shared). On a whole-cell model every target made again for one moved particle was the release's lag (Ludo,
  // 2026-11-06: MG, 4470 targets, seconds, the page frozen by the upload of them all): a target none of whose particles
  // moved keeps its instances and colors.
  const committed: ParticleList = {
    ...list,
    coordinates: movedCoordinates,
    rotations,
    _propertyData: Object.create(null),
  };
  const versions = (ro: GraphicsRenderObject) => ({
    aTransform: ro.values.aTransform.ref.version,
    transform: ro.values.transform.ref.version,
    tColor: ro.values.tColor.ref.version,
    boundingSphere: ro.values.boundingSphere.ref.version,
  });

  it("makes again on a commit only the targets whose particles moved: the others' instances and colors kept", async () => {
    const repr = await representation(list, false);
    const [other, own] = repr.renderObjects;
    const otherBefore = versions(other);
    const ownBefore = versions(own);
    await repr.createOrUpdate({}, committed).run();
    expect(versions(other)).toEqual(otherBefore);
    expect(versions(own).transform).toBeGreaterThan(ownBefore.transform);
    const fresh = await representation(committed, false);
    expectDrawnAs(drawn(repr.renderObjects), drawn(fresh.renderObjects));
    fresh.destroy();
    repr.destroy();
  });

  it('keeps the unmoved targets on a commit where their particles are not contiguous (their sets made again)', async () => {
    // targets 0 and 1 interleaved (as cellPACK's): each target's particles a sorted array, made again from the
    // commit's list (its computed properties reset)
    const interleaved = Int32Array.of(0, 1, 0, 1);
    const before = particleList(coordinates, undefined, interleaved);
    const repr = await representation(before, false);
    const [other, own] = repr.renderObjects;
    const otherBefore = versions(other);
    // particle 3 (target 1) moved
    const moved = Float32Array.from(coordinates);
    moved.set([31, 1, 5], 9);
    const commit: ParticleList = { ...before, coordinates: moved, _propertyData: Object.create(null) };
    await repr.createOrUpdate({}, commit).run();
    expect(versions(other)).toEqual(otherBefore);
    expect(versions(own).transform).toBeGreaterThan(0);
    const fresh = await representation(commit, false);
    expectDrawnAs(drawn(repr.renderObjects), drawn(fresh.renderObjects));
    fresh.destroy();
    repr.destroy();
  });

  it('draws a commit as made on its list, merged', async () => {
    const repr = await representation(list, true);
    await repr.createOrUpdate({}, committed).run();
    const fresh = await representation(committed, true);
    expectDrawnAs(drawn(repr.renderObjects), drawn(fresh.renderObjects));
    fresh.destroy();
    repr.destroy();
  });

  it('puts back on a commit a previewed target none of whose particles the commit moved', async () => {
    const repr = await representation(list, false);
    // particle 0 (target 0) previewed elsewhere; the commit moves particle 2 (target 1) alone
    const far = Mat4.fromTranslation(Mat4(), Vec3.create(500, 0, 0));
    expect(repr.setParticleFrames({ indices: Int32Array.of(0), frames: Float32Array.from(far) })).toBe(true);
    await repr.createOrUpdate({}, committed).run();
    const fresh = await representation(committed, false);
    expectDrawnAs(drawn(repr.renderObjects), drawn(fresh.renderObjects));
    fresh.destroy();
    repr.destroy();
  });

  it('draws the list as it is on the next update (a commit), the preview gone', async () => {
    const repr = await representation(list, false);
    expect(repr.setParticleFrames(frames)).toBe(true);
    await repr.createOrUpdate({}, movedList).run();
    const fresh = await representation(movedList, false);
    expectDrawnAs(drawn(repr.renderObjects), drawn(fresh.renderObjects));
    fresh.destroy();
    repr.destroy();
  });
});
