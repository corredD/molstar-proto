/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @vitest-environment jsdom

import { Vec2, Vec3 } from '@molstar/core/math/linear-algebra';
import { DefaultAssetManager } from '@molstar/core/util/assets';
import { Color } from '@molstar/core/util/color';
import { MarkerAction } from '@molstar/core/util/marker-action';
import { Shape } from '@molstar/model/model/shape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addSphere } from '../../geo/geometry/mesh/builder/sphere.js';
import { Mesh } from '../../geo/geometry/mesh/mesh.js';
import { MeshBuilder } from '../../geo/geometry/mesh/mesh-builder.js';
import { createGl } from '../../gl/_test/gl.shim.js';
import type { Scene } from '../../gl/scene.js';
import { Renderer } from '../../gl/renderer.js';
import { createContext } from '../../gl/webgl/context.js';
import { ShapeRepresentation } from '../../repr/shape/representation.js';
import { Canvas3D, Canvas3DContext } from '../canvas3d.js';
import type { Helper } from '../helper/helper.js';

// The on-top layer of the canvas (`Canvas3D.setOnTop`, `Helper.onTop`) on the gl shim: what draws and picks it and in
// which order, not pixels (the shim draws none; the browser check is the app's).

function sphere(_: unknown, { x }: { x: number }) {
  const state = MeshBuilder.createState(64, 32);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(x, 0, 0), 1, 1);
  return Shape.create(
    's',
    {},
    MeshBuilder.getMesh(state),
    () => Color(0x3f7fbf),
    () => 1,
    () => 's',
    1,
  );
}

/** The calls of the canvas's renderers that draw or clear, the group named: `main` (the scene's), `top` or `other` */
type Call = readonly [name: string, group?: 'main' | 'top' | 'other'];
const Recorded = [
  'renderBlended',
  'renderOpaque',
  'renderBlendedTransparent',
  'renderPick',
  'clearDepth',
  'withoutOcclusion',
];

function setup() {
  const gl = createGl(64, 64, { preserveDrawingBuffer: true });
  // the shim answers 0 for the color mask (an array in GL)
  const getParameter = gl.getParameter.bind(gl);
  (gl as any).getParameter = (p: number) => (p === gl.COLOR_WRITEMASK ? [true, true, true, true] : getParameter(p));
  const graphics = createContext(gl);
  const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());

  const calls: Call[] = [];
  let unoccluded = false;
  const layers: { scene?: Scene; helper?: Helper } = {};
  const groupOf = (g: unknown): Call[1] =>
    g === layers.helper?.onTop
      ? 'top'
      : g === layers.scene?.primitives || g === layers.scene?.volumes || g === layers.scene
        ? 'main'
        : 'other';
  const create = Renderer.create;
  vi.spyOn(Renderer, 'create').mockImplementation((...args) => {
    const renderer = create(...args);
    for (const name of Recorded) {
      const f = (renderer as any)[name];
      (renderer as any)[name] = (...a: unknown[]) => {
        if (name === 'withoutOcclusion') {
          unoccluded = true;
          try {
            return f(...a);
          } finally {
            unoccluded = false;
          }
        }
        // a draw of the on-top layer is never occlusion tested (Hi-Z would cull what is behind the scene)
        if (groupOf(a[0]) === 'top' && name !== 'clearDepth')
          calls.push([unoccluded ? name : `${name} (occluded)`, 'top']);
        else calls.push(name === 'clearDepth' ? [name] : [name, groupOf(a[0])]);
        return f(...a);
      };
    }
    return renderer;
  });
  const plan = ctx.passes.draw.plan.bind(ctx.passes.draw);
  vi.spyOn(ctx.passes.draw, 'plan').mockImplementation((b, c, ...rest) => {
    layers.scene = c.scene;
    layers.helper = c.helper;
    return plan(b, c, ...rest);
  });
  const canvas = Canvas3D.create(ctx);
  return { canvas, calls, layers };
}

async function addSphere3D(canvas: Canvas3D, x = 0) {
  const repr = ShapeRepresentation(sphere, Mesh.Utils, { graphics: canvas.graphics });
  await repr.createOrUpdate({}, { x }).run();
  repr.setState({ syncManually: false });
  canvas.add(repr);
  return repr;
}

function draw(canvas: Canvas3D) {
  canvas.commit(true);
  canvas.requestDraw();
  canvas.tick(0 as any);
}

describe('Canvas3D on top', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves a representation to the on-top layer and back, its render objects the same', async () => {
    const { canvas, layers } = setup();
    const model = await addSphere3D(canvas, 0);
    const handle = await addSphere3D(canvas, 0);
    const [ro] = handle.renderObjects;
    draw(canvas);
    const { scene, helper } = layers as Required<typeof layers>;
    expect(scene.has(ro)).toBe(true);
    expect(helper.onTop.count).toBe(0);

    canvas.setOnTop(handle, true);
    draw(canvas);
    expect(handle.renderObjects).toEqual([ro]);
    expect(helper.onTop.has(ro)).toBe(true);
    expect(scene.has(ro)).toBe(false);
    expect(scene.has(model.renderObjects[0])).toBe(true);

    canvas.setOnTop(handle, false);
    draw(canvas);
    expect(scene.has(ro)).toBe(true);
    expect(helper.onTop.count).toBe(0);
    canvas.dispose();
  });

  it('keeps it on top through its updates (moved, rebuilt) and when set before it is added', async () => {
    const { canvas, layers } = setup();
    const repr = ShapeRepresentation(sphere, Mesh.Utils, { graphics: canvas.graphics });
    await repr.createOrUpdate({}, { x: 0 }).run();
    repr.setState({ syncManually: false });
    canvas.setOnTop(repr, true);
    canvas.add(repr);
    draw(canvas);
    const { scene, helper } = layers as Required<typeof layers>;
    expect(helper.onTop.has(repr.renderObjects[0])).toBe(true);

    canvas.update(repr);
    // a new geometry: the canvas follows its `updated` (auto-synced)
    await repr.createOrUpdate({}, { x: 5 }).run();
    draw(canvas);
    for (const ro of repr.renderObjects) expect(helper.onTop.has(ro)).toBe(true);
    expect(scene.count).toBe(0);

    canvas.remove(repr);
    draw(canvas);
    expect(helper.onTop.count).toBe(0);
    canvas.dispose();
  });

  it('draws the on-top layer after the scene without occlusion, and picks it after the scene with the depth cleared', async () => {
    const { canvas, calls } = setup();
    await addSphere3D(canvas, 0);
    const handle = await addSphere3D(canvas, 0);
    canvas.setOnTop(handle, true);
    draw(canvas);
    const drawn = calls.filter(([, g]) => g !== 'other');
    // each frame drawn: the scene, then the on-top layer over it, not occlusion tested
    expect(drawn.length).toBeGreaterThan(0);
    let sceneDrawn = false;
    for (const [name, group] of drawn) {
      if (group === 'main') sceneDrawn = true;
      else {
        expect([name, sceneDrawn]).toEqual(['renderBlended', true]);
        sceneDrawn = false;
      }
    }
    expect(drawn.at(-1)?.[1]).toBe('top');

    calls.length = 0;
    canvas.identify(Vec2.create(32, 32));
    const picks = calls.filter(([n]) => n === 'renderPick' || n === 'clearDepth');
    // each pick variant: the scene, then the depth cleared, then the on-top layer (it wins where it is drawn)
    expect(picks.length).toBeGreaterThan(0);
    for (let i = 0; i < picks.length; i++) {
      if (picks[i][1] !== 'top') continue;
      expect(picks[i - 1]).toEqual(['clearDepth']);
      expect(picks[i - 2]).toEqual(['renderPick', 'main']);
    }
    expect(picks.filter(([, g]) => g === 'top').length).toBeGreaterThan(0);
    canvas.dispose();
  });

  it('draws the whole image again when an on-top representation is marked (its color is its mark)', async () => {
    const { canvas, calls } = setup();
    await addSphere3D(canvas, 0);
    const handle = await addSphere3D(canvas, 0);
    canvas.setOnTop(handle, true);
    draw(canvas);
    calls.length = 0;

    canvas.mark({ repr: handle, loci: handle.getAllLoci()[0] }, MarkerAction.Highlight);
    canvas.tick(1 as any);
    // not the marking pass's redraw over the last image, which has the handle unmarked in it
    expect(calls).toContainEqual(['renderBlended', 'top']);
    canvas.dispose();
  });

  it('moves nothing of the camera when a representation goes on top or back (a look, not a scene change)', async () => {
    const { canvas } = setup();
    await addSphere3D(canvas, 0);
    const handle = await addSphere3D(canvas, 30);
    draw(canvas);
    // the camera on the handle, away from the model
    canvas.camera.setState({ target: Vec3.create(30, 0, 0), position: Vec3.create(30, 0, 5), radius: 1 }, 0);
    draw(canvas);
    const before = { ...canvas.camera.getSnapshot() };

    for (const onTop of [true, false]) {
      canvas.setOnTop(handle, onTop);
      draw(canvas);
      const now = canvas.camera.getSnapshot();
      expect(Array.from(now.target)).toEqual(Array.from(before.target));
      expect(now.radius).toBe(before.radius);
      expect(now.radiusMax).toBe(before.radiusMax);
    }
    canvas.dispose();
  });
});

