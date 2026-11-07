/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import { ChunkedArray } from '@molstar/core/data/util';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { offsetParticles } from '@molstar/plugin/state/transforms/particles/ops';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import {
  type ParticleTargetRepresentation,
  ParticleTargetRepresentationProvider,
} from '@molstar/graphics/repr/particles/representation/target/representation';
import { ColorTheme } from '@molstar/graphics/theme/color';
import { SizeTheme } from '@molstar/graphics/theme/size';
import {
  checkLinear,
  describeScaling,
  quadraticControl,
  scaling,
  scalingAsync,
} from '../../../../sequences/core/_test/model/scaling.js';
import { movedIndices, offsetFrames } from '../particle-handle.js';

// A particle handle's preview over a list of n targets (`test:scaling`; apps/prism-me/AGENTS.md, no accidental
// quadratic; Ludo 2026-11-05: on a whole-cell cellPACK model the drag showed nothing until the release). Each step of a
// drag of one particle, or of every particle of its kind, writes the moved instances (`setParticleFrames`): about linear
// in the list (the merged objects' instances copied once), never a rebuild of every target. And the step against the
// rebuild it replaces (the offset list made, every target made again), logged.

const PerTarget = 50;

function triangle(): ParticleTarget {
  const state = MeshBuilder.createState(3, 1);
  ChunkedArray.add3(state.vertices, 0, 0, 0);
  ChunkedArray.add3(state.vertices, 1, 0, 0);
  ChunkedArray.add3(state.vertices, 0, 1, 0);
  for (let i = 0; i < 3; i++) ChunkedArray.add(state.groups, 0);
  ChunkedArray.add3(state.indices, 0, 1, 2);
  const shape = ShapeUtils.create(
    'triangle',
    {},
    MeshBuilder.getMesh(state),
    () => ColorNames.red as Color,
    () => 1,
    () => '',
  );
  return { kind: 'shape', shape } as ParticleTarget;
}

/** `n` targets of `PerTarget` particles each, on a grid */
function manyTargets(n: number): ParticleList {
  const count = n * PerTarget;
  const target = triangle();
  return {
    count,
    keys: Int32Array.from({ length: count }, (_, i) => i),
    targets: Int32Array.from({ length: count }, (_, i) => Math.floor(i / PerTarget)),
    targetInfo: new Map(Array.from({ length: n }, (_, i) => [i, { name: `t${i}` }])),
    targetMapping: new Map(Array.from({ length: n }, (_, i) => [i, target])),
    coordinates: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 10 : (i % 7) * 3)),
    getParticleLabel: () => '',
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

const ctx = { colorThemeRegistry: ColorTheme.createRegistry(), sizeThemeRegistry: SizeTheme.createRegistry() };

interface Drag {
  list: ParticleList;
  repr: ParticleTargetRepresentation;
  stack: { input: ParticleList; offsets: never[]; instances: { index: number; translation: Vec3; euler: Vec3 }[] };
  indices: Int32Array;
  frames: Float32Array;
}

/** A list drawn by its target representation, and the drag of particle 0 (alone, or with its kind) */
async function drag(n: number, kind: boolean): Promise<Drag> {
  const list = manyTargets(n);
  const repr = ParticleTargetRepresentationProvider.factory(ctx, ParticleTargetRepresentationProvider.getParams);
  await repr.createOrUpdate({}, list).run();
  const indices = movedIndices(list, 0, kind ? { kind: 'offset', targets: '0' } : { kind: 'instance' });
  return {
    list,
    repr,
    stack: { input: list, offsets: [], instances: [{ index: 0, translation: Vec3.create(5, 0, 0), euler: Vec3() }] },
    indices,
    frames: new Float32Array(indices.length * 16),
  };
}

/** One step of the drag as previewed now: the moved particles' frames, their instances written */
function step(d: Drag) {
  d.stack.instances[0].translation[0] += 1;
  offsetFrames(d.stack, d.indices, d.frames);
  d.repr.setParticleFrames(d);
}

/** A drag: steps one after another, as pointer moves are (the first ones' cost is the same as the later ones') */
const DragSteps = 30;

for (const kind of [false, true]) {
  it(`a drag preview of a ${kind ? "particle's kind" : 'particle'} over n targets`, async () => {
    const s = await scalingAsync(
      {
        setup: (n) => drag(n, kind),
        run: (d) => {
          for (let i = 0; i < DragSteps; i++) step(d);
        },
        teardown: (d) => d.repr.destroy(),
      },
      200,
      { alloc: true },
    );
    checkLinear(`particle preview: a drag of ${DragSteps} steps (${kind ? 'kind' : 'particle'})`, s);
  });
}

it('a preview step against the rebuild it replaces (logged)', async () => {
  for (const n of [200, 800, 3200]) {
    const d = await drag(n, false);
    // each step of a drag: the first and the slowest kept (a drag starts lagging or does not)
    const times: number[] = [];
    for (let r = 0; r < DragSteps; r++) {
      const t0 = performance.now();
      step(d);
      times.push(performance.now() - t0);
    }
    const preview = Math.max(...times);
    const reps = 3;
    let rebuild = Number.POSITIVE_INFINITY;
    for (let r = 0; r < reps; r++) {
      d.stack.instances[0].translation[0] += 1;
      const t0 = performance.now();
      // the step as it was: the offset list made, the representation made again from it
      await d.repr.createOrUpdate({}, offsetParticles(d.list, [], d.stack.instances)).run();
      rebuild = Math.min(rebuild, performance.now() - t0);
    }
    console.log(
      `particle preview, ${n * PerTarget} instances in ${n} targets: a step at most ${preview.toFixed(2)} ms ` +
        `(the first ${times[0].toFixed(2)}, the median ${[...times].sort((a, b) => a - b)[DragSteps >> 1].toFixed(2)}), ` +
        `the rebuild ${rebuild.toFixed(2)} ms (×${(rebuild / preview).toFixed(0)})`,
    );
    expect(preview).toBeLessThan(rebuild);
    d.repr.destroy();
  }
});

it('catches the quadratic control', () => {
  const s = scaling(quadraticControl, 2000);
  expect(s.timeRatio, describeScaling(s)).toBeGreaterThan(8);
});
