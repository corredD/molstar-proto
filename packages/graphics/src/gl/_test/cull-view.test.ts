/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { createFrame, createCullView, type GraphicsRenderable, LodView } from '../renderable.js';
import { createMergedRenderObject, createRenderObject } from '../render-object.js';
import { Scene } from '../scene.js';
import { createGraphicsStats } from '../stats.js';
import { createContext } from '../webgl/context.js';
import { createGl } from './gl.shim.js';

function createSpheres(x: number) {
  const spheres = Spheres.create(new Float32Array([x, 0, 0, x + 1, 0, 0]), new Float32Array([0, 1]), 2);
  const props = PD.getDefaultValues(Spheres.Params);
  const values = Spheres.Utils.createValuesSimple(spheres, props, ColorNames.orange, 1);
  return createRenderObject('spheres', values, Spheres.Utils.createRenderableState(props), -1);
}

/** whether a still frame (the same view, no occlusion test) reuses the last cull of `r`: a cache hit */
function createStillCull(r: GraphicsRenderable) {
  const stats = createGraphicsStats();
  const lod = { ...LodView(), version: 1 };
  return () => {
    const hits = stats.cacheHits.cull;
    r.cull(Plane3D(), Frustum3D(), null, stats, createFrame(), lod);
    return stats.cacheHits.cull > hits;
  };
}

describe('cull view', () => {
  it('skips a cull of the same view and data only: view version, cell versions, no occlusion test', () => {
    const lod = { ...LodView(), version: 3 };
    const cell = ValueCell.create(1);
    const cells = [cell, undefined];

    const view = createCullView();
    expect(view.isSame(lod, null, cells)).toBe(false);
    view.set(lod, cells);
    expect(view.isSame(lod, null, cells)).toBe(true);

    // an occlusion test reads levels that change between frames
    expect(view.isSame(lod, () => false, cells)).toBe(false);
    // another view (the renderer's version moved), or none known
    expect(view.isSame({ ...lod, version: 4 }, null, cells)).toBe(false);
    view.set(LodView(), cells);
    expect(view.isSame(LodView(), null, cells)).toBe(false);
    view.set(lod, cells);
    // the data: a cell updated, even to the same value
    ValueCell.update(cell, 1);
    expect(view.isSame(lod, null, cells)).toBe(false);
    view.set(lod, cells);
    expect(view.isSame(lod, null, cells)).toBe(true);
    // the lists changed otherwise (`uncull`, `cullSimple`)
    view.invalidate();
    expect(view.isSame(lod, null, cells)).toBe(false);
  });

  // a still frame kept the lists culled without the wiggle's allowance (`getAnimationSlack`): the edge cells stayed
  // culled until the camera moved
  it('culls again where how far the animations move the spheres changed', () => {
    const ctx = createContext(createGl(32, 32, {}));
    const scene = Scene.create(ctx);
    const o = createSpheres(0);
    scene.add(o);
    scene.commit();
    const still = createStillCull(scene.renderables[0]);
    expect(still()).toBe(false);
    expect(still()).toBe(true);
    ValueCell.update(o.values.uWiggleAmplitude, 5);
    expect(still()).toBe(false);
    expect(still()).toBe(true);
    ValueCell.update(o.values.uTumbleSpeed, 1);
    expect(still()).toBe(false);
    ctx.destroy();
  });

  it("a merged object culls again where its animation or a member's wiggle changed", () => {
    const ctx = createContext(createGl(32, 32, {}));
    const scene = Scene.create(ctx);
    const [a, b] = [createSpheres(0), createSpheres(10)];
    const o = createMergedRenderObject([a, b]);
    scene.add(o);
    scene.commit();
    const still = createStillCull(scene.renderables[0]);
    expect(still()).toBe(false);
    expect(still()).toBe(true);
    // the merged object's animation (its material)
    ValueCell.update(o.values.uWiggleAmplitude as ValueCell<number>, 5);
    expect(still()).toBe(false);
    expect(still()).toBe(true);
    // a member's own wiggle, its data synced without an update of the renderable (`repr/merged.ts`)
    ValueCell.update(b.values.uWiggleStrength, 3);
    o.merged.sync();
    expect(still()).toBe(false);
    expect(still()).toBe(true);
    ValueCell.update(a.values.dWiggle, true);
    o.merged.sync();
    expect(still()).toBe(false);
    ctx.destroy();
  });
});
