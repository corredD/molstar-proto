/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @vitest-environment jsdom
// @module-tag medium

import { Interval } from '@molstar/core/data/int';
import { Mat4, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { DefaultAssetManager } from '@molstar/core/util/assets';
import { Color } from '@molstar/core/util/color';
import { EveryLoci } from '@molstar/model/model/loci';
import { Shape } from '@molstar/model/model/shape';
import { describe, expect, it } from 'vitest';
import { addSphere } from '../../geo/geometry/mesh/builder/sphere.js';
import { Mesh } from '../../geo/geometry/mesh/mesh.js';
import { MeshBuilder } from '../../geo/geometry/mesh/mesh-builder.js';
import { getGLContext, tryGetGLContext } from '../../gl/_test/gl.js';
import { ShapeRepresentation } from '../../repr/shape/representation.js';
import { Visual } from '../../repr/visual.js';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Canvas3D, Canvas3DContext } from '../canvas3d.js';

// Ghosts of what is cut (cellview.md §4.3), drawn on the native backend (WebGL1, `pnpm native:install`): three spheres
// along x, a plane cutting x > 0; the middle one is cut, the right one ignores the plane (a clipping layer). With the
// plane ghosted, the cut sphere's outline is drawn in the transparent outline color, and nothing else changes.

const Size = 192;
const Ghost = Color(0xff0000);
/** The spheres' x: kept, cut, ignoring the plane */
const Centers = [-3, 3, 6];

/** The three spheres, of radius `scale` at `Centers` times `scale` */
function spheres(scale = 1) {
  const state = MeshBuilder.createState(256, 128);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(0, 0, 0), scale, 3);
  const transforms = Centers.map((x) => Mat4.fromTranslation(Mat4(), Vec3.create(x * scale, 0, 0)));
  return Shape.create(
    's',
    {},
    MeshBuilder.getMesh(state),
    () => Color(0x3f7fbf),
    () => 1,
    () => 's',
    1,
    transforms,
  );
}

/** Removes x > 0 (a plane's normal is its local y, turned to x) */
const plane = (ghost: boolean) => ({
  type: 'plane' as const,
  invert: false,
  position: Vec3.create(0, 0, 0),
  rotation: { axis: Vec3.create(0, 0, 1), angle: -90 },
  scale: Vec3.create(1, 1, 1),
  transform: Mat4.identity(),
  ghost,
});

/** The pixels tinted by the ghost color (red over white, at the ghosts' alpha), by the sphere nearest on screen */
function ghostPixels(canvas: Canvas3D, scale = 1) {
  canvas.commit(true);
  canvas.requestDraw();
  canvas.tick(0 as any, { isSynchronous: true } as any);
  const gl = (canvas.graphics as any).gl as WebGLRenderingContext;
  const pixels = new Uint8Array(Size * Size * 4);
  gl.readPixels(0, 0, Size, Size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const xs = Centers.map((x) => canvas.camera.project(Vec4(), Vec3.create(x * scale, 0, 0))[0]);
  const bySphere = [0, 0, 0];
  for (let y = 0; y < Size; ++y) {
    for (let x = 0; x < Size; ++x) {
      const o = (y * Size + x) * 4;
      if (pixels[o] > 200 && pixels[o] - pixels[o + 1] > 40 && pixels[o] - pixels[o + 2] > 40) {
        let k = 0;
        for (let i = 1; i < 3; ++i) if (Math.abs(xs[i] - x) < Math.abs(xs[k] - x)) k = i;
        bySphere[k]++;
      }
    }
  }
  return bySphere;
}

/**
 * The three spheres (`spheres(scale)`) on a canvas drawing ghosts in `Ghost` with outlines; `draw(ghost)` draws them with
 * the plane, ghosted or not, and counts the ghost's pixels by sphere (`ghostPixels`)
 */
async function setup(mode: 'orthographic' | 'perspective', scale = 1, extraProps: object = {}) {
  const graphics = getGLContext(Size, Size);
  const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());
  const canvas = Canvas3D.create(ctx);
  canvas.setProps({
    renderer: { backgroundColor: Color(0xffffff) },
    multiSample: { mode: 'off' },
    camera: { mode, helper: { axes: { name: 'off', params: {} } } },
    postprocessing: {
      enabled: true,
      occlusion: { name: 'off', params: {} },
      shadow: { name: 'off', params: {} },
      outline: {
        name: 'on',
        params: {
          scale: 1,
          threshold: 0.33,
          color: Color(0x000000),
          includeTransparent: false,
          transparentColor: Ghost,
        },
      },
    },
    ...extraProps,
  } as any);
  const repr = ShapeRepresentation(() => spheres(scale), Mesh.Utils, { graphics: canvas.graphics });
  const draw = async (ghost: boolean) => {
    await repr
      .createOrUpdate(
        { ...PD.getDefaultValues(Mesh.Params), clip: { variant: 'pixel', objects: [plane(ghost)] } } as any,
        {},
      )
      .run();
    // the right sphere ignores the plane: kept whole, never a ghost
    Visual.setClipping(
      repr.renderObjects[0],
      { kind: 'every-loci', layers: [{ loci: EveryLoci, groups: 1 }] },
      (_, apply) => apply(Interval.ofBounds(2, 3)),
      true,
    );
    return ghostPixels(canvas, scale);
  };
  await repr
    .createOrUpdate(
      { ...PD.getDefaultValues(Mesh.Params), clip: { variant: 'pixel', objects: [plane(false)] } } as any,
      {},
    )
    .run();
  canvas.add(repr);
  canvas.requestCameraReset({ durationMs: 0 });
  canvas.commit(true);

  return { graphics, ctx, canvas, draw };
}

type Ball = { readonly center: Vec3; readonly radius: number };

/**
 * Spheres `balls` on a canvas of `size` pixels drawing outlines (ghosts in `Ghost`), a plane removing z < 0 (ghosted or
 * not); the camera at `position` looking at the origin, after the reset (then `after`'s props);
 * `draw(ghost)` returns the canvas's pixels (rows bottom to top)
 */
async function behindScene(options: {
  size: number;
  balls: readonly Ball[];
  position: Vec3;
  /** props set after the camera reset (e.g. its clipping radius) */
  after?: object;
  fov?: number;
  fog?: boolean;
}) {
  const { size, balls, position, fov = 45, fog = false } = options;
  const graphics = getGLContext(size, size);
  const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());
  const canvas = Canvas3D.create(ctx);
  canvas.setProps({
    renderer: { backgroundColor: Color(0xffffff) },
    multiSample: { mode: 'off' },
    camera: { mode: 'perspective', fov, helper: { axes: { name: 'off', params: {} } } },
    cameraFog: fog ? { name: 'on', params: { intensity: 50 } } : { name: 'off', params: {} },
    postprocessing: {
      enabled: true,
      occlusion: { name: 'off', params: {} },
      shadow: { name: 'off', params: {} },
      outline: {
        name: 'on',
        params: {
          scale: 1,
          threshold: 0.33,
          color: Color(0x000000),
          includeTransparent: false,
          transparentColor: Ghost,
        },
      },
    },
  } as any);
  const state = MeshBuilder.createState(512, 256);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(0, 0, 0), 1, 3);
  const mesh = MeshBuilder.getMesh(state);
  const transforms = balls.map(({ center, radius }) =>
    Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), center), Mat4.fromUniformScaling(Mat4(), radius)),
  );
  const shape = () =>
    Shape.create(
      's',
      {},
      mesh,
      () => Color(0x3f7fbf),
      () => 1,
      () => 's',
      1,
      transforms,
    );
  // a plane's normal is its local y: turned to -z, it removes z < 0
  const behind = (ghost: boolean) => ({ ...plane(ghost), rotation: { axis: Vec3.create(1, 0, 0), angle: -90 } });
  const repr = ShapeRepresentation(shape, Mesh.Utils, { graphics: canvas.graphics });
  const update = (ghost: boolean) =>
    repr
      .createOrUpdate(
        { ...PD.getDefaultValues(Mesh.Params), clip: { variant: 'pixel', objects: [behind(ghost)] } } as any,
        {},
      )
      .run();
  const frame = () => {
    canvas.commit(true);
    canvas.requestDraw();
    canvas.tick(0 as any, { isSynchronous: true } as any);
  };
  await update(false);
  canvas.add(repr);
  canvas.requestCameraReset({ durationMs: 0 });
  frame();
  canvas.camera.setState({ target: Vec3.create(0, 0, 0), position, up: Vec3.create(0, 1, 0) }, 0);
  if (options.after) canvas.setProps(options.after as any);
  const draw = async (ghost: boolean) => {
    await update(ghost);
    frame();
    const gl = (canvas.graphics as any).gl as WebGLRenderingContext;
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  /** the sphere's projected center and radius (pixels) */
  const project = ({ center, radius }: Ball) => {
    const c = canvas.camera.project(Vec4(), center);
    const view = Vec3.sub(Vec3(), center, canvas.camera.state.position);
    const side = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), view, Vec3.create(0, 1, 0)));
    const e = canvas.camera.project(Vec4(), Vec3.scaleAndAdd(Vec3(), center, side, radius));
    return { x: c[0], y: c[1], r: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  };
  const dispose = () => {
    canvas.dispose();
    graphics.destroy();
  };
  return { canvas, draw, project, dispose };
}

const changedAt = (a: Uint8Array, b: Uint8Array, o: number) =>
  [0, 1, 2].some((k) => Math.abs(a[o + k] - b[o + k]) > 16);

describe('ghosts of what clips cut, drawn', () => {
  const available = !!tryGetGLContext(Size, Size);

  (available ? it : it.skip)('outline the cut part only, in the transparent outline color', async () => {
    const { graphics, ctx, canvas, draw } = await setup('orthographic');
    const off = await draw(false);
    const on = await draw(true);
    // the ghost depth at each sphere's center: the cut one only, not the one that ignores the plane (drawn whole there
    // before a ghost needed a ghosted object it does not ignore)
    const gl = (canvas.graphics as any).gl as WebGLRenderingContext;
    ctx.passes.draw.depthTargetTransparent.bind();
    const depth = Centers.map((x) => {
      const px = new Uint8Array(4);
      const sx = Math.round(canvas.camera.project(Vec4(), Vec3.create(x, 0, 0))[0]);
      gl.readPixels(sx, Size / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px.some((v) => v !== 0);
    });
    expect(depth).toEqual([false, true, false]);
    expect(off).toEqual([0, 0, 0]);
    // the cut sphere's ghost; none over the kept one nor the one that ignores the plane
    expect(on[1]).toBeGreaterThan(20);
    expect(on[0]).toBe(0);
    expect(on[2]).toBe(0);
    canvas.dispose();
    graphics.destroy();
  });
  // the transparent edges' depth went through 8 bits of the outline target: reversed depth (about near / z) of what lies
  // beyond some 500 times the near plane rounded to 0 there, read as no edge, so a camera inside the scene's sphere (near
  // at its 1 Å minimum, cellPACK zoomed in) lost the ghosts farther than about 500 Å
  (available ? it : it.skip)('outline far ghosts with the near plane at its minimum (perspective)', async () => {
    const { graphics, canvas, draw } = await setup('perspective', 100);
    // drawn once (the camera reset), then the clipping radius past the camera, as inside a cell's sphere: the near
    // plane at its minimum
    await draw(false);
    canvas.setProps({ sceneRadiusFactor: 10, cameraClipping: { radius: 0 } } as any);
    const off = await draw(false);
    const on = await draw(true);
    // the near plane at its minimum, the cut sphere over 1000 Å away
    expect(canvas.camera.near).toBe(1);
    expect(Vec3.distance(canvas.camera.state.position, Vec3.create(300, 0, 0))).toBeGreaterThan(1000);
    expect(off).toEqual([0, 0, 0]);
    expect(on[1]).toBeGreaterThan(20);
    expect(on[0]).toBe(0);
    expect(on[2]).toBe(0);
    canvas.dispose();
    graphics.destroy();
  });
  // a kept sphere in front of a larger cut one, far from the camera (near 1 Å): the ghost depth has a hole where the kept
  // sphere covers it, and its edge lies just inside the kept silhouette; drawn there, the ghost painted a band of its
  // color over the kept sphere (the hole is not an edge of the ghost: it goes on behind)
  (available ? it : it.skip)('draw no ghost over an opaque sphere in front of it', async () => {
    const Kept = { center: Vec3.create(0, 0, 100), radius: 100 };
    const scene = await behindScene({
      size: Size,
      balls: [Kept, { center: Vec3.create(0, 0, -500), radius: 300 }],
      position: Vec3.create(0, 0, 2100),
      // the clipping radius past the camera, as inside a cell's sphere: the near plane at its minimum
      after: { sceneRadiusFactor: 10, cameraClipping: { radius: 0 } },
    });
    const off = await scene.draw(false);
    const on = await scene.draw(true);
    expect(scene.canvas.camera.near).toBe(1);
    const k = scene.project(Kept);
    let inside = 0;
    let all = 0;
    for (let y = 0; y < Size; ++y) {
      for (let x = 0; x < Size; ++x) {
        if (!changedAt(on, off, (y * Size + x) * 4)) continue;
        all++;
        if (Math.hypot(x - k.x, y - k.y) < k.r - 0.5) inside++;
      }
    }
    // the cut sphere's ghost (its silhouette, beyond the kept one), nothing over the kept sphere
    expect(k.r).toBeGreaterThan(5);
    expect(all).toBeGreaterThan(20);
    expect(inside).toBe(0);
    scene.dispose();
  });

  // the same, the cut sphere some 130 Å behind the kept one's silhouette: their edges' depths, both 16 bits, compared
  // after an 8-bit square root, tied (within hundreds of Å at near 1 Å) and the ghost was drawn over the kept sphere's
  // opaque outline
  (available ? it : it.skip)('draw no ghost over the opaque outline of a sphere in front of it', async () => {
    const size = 512;
    const Kept = { center: Vec3.create(0, 0, 100), radius: 100 };
    const scene = await behindScene({
      size,
      balls: [Kept, { center: Vec3.create(0, 0, -310), radius: 300 }],
      position: Vec3.create(0, 0, 2100),
      // the clipping radius past the camera, as inside a cell's sphere: the near plane at its minimum
      after: { sceneRadiusFactor: 10, cameraClipping: { radius: 0 } },
    });
    const off = await scene.draw(false);
    const on = await scene.draw(true);
    expect(scene.canvas.camera.near).toBe(1);
    const k = scene.project(Kept);
    // the kept sphere's outline: dark without ghosts, within 3 px of its silhouette
    let outline = 0;
    let painted = 0;
    for (let y = 0; y < size; ++y) {
      for (let x = 0; x < size; ++x) {
        const o = (y * size + x) * 4;
        if (Math.abs(Math.hypot(x - k.x, y - k.y) - k.r) > 3 || off[o] > 60) continue;
        outline++;
        if (changedAt(on, off, o)) painted++;
      }
    }
    expect(outline).toBeGreaterThan(50);
    expect(painted).toBe(0);
    scene.dispose();
  });

  // an outline at the back of the scene, within the last Å before the far plane: its 16-bit depth packs to 0. Fogged as
  // there (0bee02d89 drew it unfogged, black over the fog); without fog drawn (the base dropped an edge at depth 0)
  (available ? it : it.skip)('fog an outline at the far plane, and draw it without fog', async () => {
    // a small sphere at the back of a scene of radius about 1000 Å (kept: the plane removes z < 0, the camera's side), the
    // camera 300 Å from its center (near at 1 Å, far at 1300 Å), a narrow view so that the sphere fills some pixels
    const Back = { center: Vec3.create(0, 0, 994), radius: 6 };
    const scene = await behindScene({
      size: Size,
      balls: [Back, { center: Vec3.create(0, 0, -1000), radius: 1 }],
      position: Vec3.create(0, 0, -300),
      fov: 4,
      fog: true,
    });
    // the clipping radius 1000 Å (a share of the scene's): far 1300 Å from the camera, 6 Å behind the sphere's rim
    const sceneRadius = scene.canvas.boundingSphere.radius;
    scene.canvas.setProps({ cameraClipping: { radius: 100 * (1 - 1000 / sceneRadius) } } as any);
    const off = await scene.draw(false);
    const b = scene.project(Back);
    const far = scene.canvas.camera.far;
    expect(scene.canvas.camera.near).toBe(1);
    expect(far - (300 + Back.center[2])).toBeLessThan(12);
    let dark = 0;
    for (let y = 0; y < Size; ++y) {
      for (let x = 0; x < Size; ++x) {
        const o = (y * Size + x) * 4;
        if (Math.hypot(x - b.x, y - b.y) > b.r + 3) continue;
        if (off[o] < 200 || off[o + 1] < 200 || off[o + 2] < 200) dark++;
      }
    }
    expect(b.r).toBeGreaterThan(5);
    expect(dark).toBe(0);
    // without fog: the outline drawn (the image with outlines against without, around the sphere)
    scene.canvas.setProps({ cameraFog: { name: 'off', params: {} } } as any);
    const outlined = await scene.draw(false);
    const pp = scene.canvas.props.postprocessing;
    scene.canvas.setProps({ postprocessing: { ...pp, outline: { name: 'off', params: {} } } } as any);
    const plain = await scene.draw(false);
    let outline = 0;
    for (let y = 0; y < Size; ++y) {
      for (let x = 0; x < Size; ++x) {
        if (Math.hypot(x - b.x, y - b.y) > b.r + 3) continue;
        if (changedAt(outlined, plain, (y * Size + x) * 4)) outline++;
      }
    }
    expect(outline).toBeGreaterThan(10);
    scene.dispose();
  });
});
