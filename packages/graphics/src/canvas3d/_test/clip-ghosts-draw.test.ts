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

function spheres() {
  const state = MeshBuilder.createState(256, 128);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(0, 0, 0), 1, 3);
  const transforms = Centers.map((x) => Mat4.fromTranslation(Mat4(), Vec3.create(x, 0, 0)));
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
function ghostPixels(canvas: Canvas3D) {
  canvas.commit(true);
  canvas.requestDraw();
  canvas.tick(0 as any, { isSynchronous: true } as any);
  const gl = (canvas.graphics as any).gl as WebGLRenderingContext;
  const pixels = new Uint8Array(Size * Size * 4);
  gl.readPixels(0, 0, Size, Size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const xs = Centers.map((x) => canvas.camera.project(Vec4(), Vec3.create(x, 0, 0))[0]);
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

describe('ghosts of what clips cut, drawn', () => {
  const available = !!tryGetGLContext(Size, Size);

  (available ? it : it.skip)('outline the cut part only, in the transparent outline color', async () => {
    const graphics = getGLContext(Size, Size);
    const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());
    const canvas = Canvas3D.create(ctx);
    canvas.setProps({
      renderer: { backgroundColor: Color(0xffffff) },
      multiSample: { mode: 'off' },
      camera: { mode: 'orthographic', helper: { axes: { name: 'off', params: {} } } },
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
    const repr = ShapeRepresentation(spheres, Mesh.Utils, { graphics: canvas.graphics });
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
      return ghostPixels(canvas);
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

    const off = await draw(false);
    const on = await draw(true);
    expect(off).toEqual([0, 0, 0]);
    // the cut sphere's ghost; none over the kept one nor the one that ignores the plane
    expect(on[1]).toBeGreaterThan(20);
    expect(on[0]).toBe(0);
    expect(on[2]).toBe(0);
    canvas.dispose();
    graphics.destroy();
  });
});
