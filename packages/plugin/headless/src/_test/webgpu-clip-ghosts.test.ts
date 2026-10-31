/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { addSphere } from '@molstar/graphics/geo/geometry/mesh/builder/sphere';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import * as Shape from '@molstar/graphics/geo/shape/shape';
import { ShapeRepresentation } from '@molstar/graphics/repr/shape/representation';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

// Ghosts of what is cut (cellview.md §4.3) on WebGPU, far from the camera with the near plane at its 1 Å minimum (a
// camera inside the scene's sphere: cellPACK zoomed in): the transparent edges' depth went through 8 bits of the outline
// target, reversed depth (about near / z) of what lies beyond some 500 times the near plane rounded to 0 there and read
// as no edge, so the ghosts farther than about 500 Å were lost (the WebGL twin: graphics canvas3d/_test/
// clip-ghosts-draw.test.ts)

const Size = 192;
const Ghost = Color(0xff0000);
/** The spheres' x, times their radius: kept, cut */
const Centers = [-3, 3];
const Radius = 200;

function spheres() {
  const state = MeshBuilder.createState(256, 128);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(0, 0, 0), Radius, 3);
  const transforms = Centers.map((x) => Mat4.fromTranslation(Mat4(), Vec3.create(x * Radius, 0, 0)));
  return Shape.create(
    's',
    {},
    MeshBuilder.getMesh(state),
    () => Color(0x3f7fbf),
    () => 1,
    () => 's',
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

describe.skipIf(!WebGPU.module)('ghosts of what clips cut on WebGPU', () => {
  it('outline far ghosts with the near plane at its minimum', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      const canvas = plugin.canvas3d!;
      const postprocessing = {
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
      } as any;
      canvas.setProps({
        renderer: { ...canvas.props.renderer, backgroundColor: Color(0xffffff) },
        multiSample: { ...canvas.props.multiSample, mode: 'off' },
        camera: { ...canvas.props.camera, mode: 'perspective' },
        postprocessing,
      });
      const repr = ShapeRepresentation(spheres, Mesh.Utils, { graphics: canvas.graphics });
      const update = (ghost: boolean) =>
        repr
          .createOrUpdate(
            { ...PD.getDefaultValues(Mesh.Params), clip: { variant: 'pixel', objects: [plane(ghost)] } } as any,
            {},
          )
          .run();
      await update(false);
      canvas.add(repr);
      canvas.requestCameraReset({ durationMs: 0 });
      canvas.commit(true);
      await plugin.getImageRaw({ width: Size, height: Size }, postprocessing);
      // the clipping radius past the camera, as inside a cell's sphere: the near plane at its minimum
      canvas.setProps({ sceneRadiusFactor: 10, cameraClipping: { ...canvas.props.cameraClipping, radius: 0 } });

      /** the pixels tinted by the ghost color (red over white), by the sphere nearest on screen */
      const ghostPixels = async (ghost: boolean) => {
        await update(ghost);
        const { data } = await plugin.getImageRaw({ width: Size, height: Size }, postprocessing);
        const xs = Centers.map((x) => canvas.camera.project(Vec4(), Vec3.create(x * Radius, 0, 0))[0]);
        const bySphere = [0, 0];
        for (let i = 0; i < Size * Size; ++i) {
          const o = i * 4;
          if (data[o] > 200 && data[o] - data[o + 1] > 40 && data[o] - data[o + 2] > 40) {
            const x = i % Size;
            bySphere[Math.abs(xs[1] - x) < Math.abs(xs[0] - x) ? 1 : 0]++;
          }
        }
        return bySphere;
      };
      const off = await ghostPixels(false);
      const on = await ghostPixels(true);
      expect(canvas.camera.near).toBe(1);
      expect(Vec3.distance(canvas.camera.state.position, Vec3.create(3 * Radius, 0, 0))).toBeGreaterThan(1000);
      expect(off).toEqual([0, 0]);
      // the cut sphere's ghost; none over the kept one
      expect(on[1]).toBeGreaterThan(20);
      expect(on[0]).toBe(0);
    } finally {
      plugin.dispose();
    }
  });
});
