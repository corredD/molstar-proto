/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import { BaseGeometry } from '@molstar/graphics/geo/geometry/base';
import { Renderer } from '@molstar/graphics/gl/renderer';
import { createFrame } from '@molstar/graphics/gl/renderable';
import { packAffineRows } from '@molstar/graphics/gl/affine-rows';
import { createMergedRenderObject, createRenderObject } from '@molstar/graphics/gl/render-object';
import { DeadInstanceTranslation, type GpuInstanceWriter } from '@molstar/graphics/gl/renderable/merged-culler';
import { Scene } from '@molstar/graphics/gl/scene';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

const Size = 64;

/** a pool's live instances as its view hook makes them (`GpuInstanceWriter.view`), and the views it was called for */
interface Pool {
  live: number;
  drawn: number;
  views: number;
}
const Copies = 6;

/** a grid of `Copies` × `Copies` translations in the xy plane (sheared a little: affine, not rigid) from `offset` */
function gridTransforms(offset: Vec3) {
  const transforms = new Float32Array(Copies * Copies * 16);
  for (let i = 0; i < Copies * Copies; ++i) {
    const m = Mat4.fromTranslation(
      Mat4(),
      Vec3.add(Vec3(), offset, Vec3.create((i % Copies) * 6, Math.floor(i / Copies) * 6, 0)),
    );
    m[4] = 0.2; // x += 0.2 y: a shear, as a tile's affine map
    Mat4.toArray(m, transforms, i * 16);
  }
  return transforms;
}

/**
 * Five spheres at the instances of `gridTransforms`, gridless (one cell); `gpu`: the CPU transforms zeros, the rows
 * written by a writer (here buffer writes, as a kernel would)
 */
function createMember(offset: Vec3, color: number, gpu: boolean, count = Copies * Copies, pool?: Pool) {
  const centers = new Float32Array([0, 0, 0, 1.2, 0, 0, 0, 1.2, 0, -1.2, 0, 0, 0, -1.2, 0]);
  const groups = new Float32Array([0, 1, 2, 3, 4]);
  const spheres = Spheres.create(centers, groups, 5);
  const real = gridTransforms(offset).subarray(0, count * 16);
  const props = PD.getDefaultValues(Spheres.Params);
  const transform = createTransform(gpu ? new Float32Array(real.length) : real, count, undefined, 0, 0);
  const simple = BaseGeometry.createSimple(color as never, 1, transform);
  const values = Spheres.Utils.createValues(spheres, simple.transform, simple.locationIterator, simple.theme, props);
  // the bounds the real transforms give (the writer member's CPU transforms are zeros)
  ValueCell.update(values.boundingSphere, Sphere3D.create(Vec3.add(Vec3(), offset, Vec3.create(16, 15, 0)), 30));
  let calls = 0;
  if (gpu) {
    const rows = packAffineRows(real, Copies * Copies, new Float32Array(Copies * Copies * 12));
    const writer: GpuInstanceWriter = (_compute, target) => {
      calls += 1;
      expect(target.count).toBe(Copies * Copies);
      // the culler's data (\`CulledData\`: three vec4s an instance from 0), read by the culled lists and the identity region
      target.data.write(rows, target.instanceBase * 3 * 16);
    };
    if (pool) {
      // a pool made per view: the live ones its rows, the rest dead (the identity region draws every slot: views culled
      // on the CPU)
      const write = (target: Parameters<GpuInstanceWriter>[1], live: number) => {
        // dead: zero rows but a translation past any far plane (`DeadInstanceTranslation`)
        const zeros = new Float32Array((target.count - live) * 12);
        for (let i = 3; i < zeros.length; i += 4) zeros[i] = DeadInstanceTranslation;
        target.data.write(rows.subarray(0, live * 12), target.instanceBase * 3 * 16);
        target.data.write(zeros, (target.instanceBase + live) * 3 * 16);
      };
      Object.assign(writer, {
        view: (_compute: unknown, target: Parameters<GpuInstanceWriter>[1]) => {
          pool.views += 1;
          if (pool.live === pool.drawn) return undefined;
          pool.drawn = pool.live;
          write(target, pool.live);
          return pool.live;
        },
      });
    }
    Object.assign(values, { gpuInstances: ValueCell.create(writer) });
  }
  const object = createRenderObject('spheres', values, Spheres.Utils.createRenderableState(props), -1);
  return { object, calls: () => calls };
}

describe.skipIf(!WebGPU.module)('GPU-written instances of merged render objects', () => {
  it('draws the instances a writer puts on the GPU as their CPU transforms, culled on the GPU and on the CPU', async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      const graphics = plugin.canvas3d!.graphics;
      const offsets = [Vec3.create(0, 0, 0), Vec3.create(2.5, 2.5, 1)];
      const colors = [ColorNames.orange, ColorNames.green];
      // the writer member second: its instance base is not 0
      const reference = offsets.map((o, i) => createMember(o, colors[i], false));
      const written = [createMember(offsets[0], colors[0], false), createMember(offsets[1], colors[1], true)];
      const scenes = [reference, written].map((members) => {
        const scene = Scene.create(graphics);
        scene.add(
          createMergedRenderObject(
            members.map((m) => m.object),
            { gpuCulling: true },
          ),
        );
        scene.commit();
        return scene;
      });
      // the writer ran when the culler laid the instances out
      expect(written[1].calls()).toBeGreaterThan(0);

      const camera = new Camera();
      Viewport.set(camera.viewport, 0, 0, Size, Size);
      const { center, radius } = scenes[0].boundingSphere;
      camera.setState(camera.getFocus(Vec3.add(Vec3(), center, Vec3.create(radius * 0.3, 0, 0)), radius * 0.4), 0);
      camera.update();

      const renderer = Renderer.create(graphics, { sphereRaster: 'off' });
      const target = graphics.createRenderTarget(Size, Size, 'depth-stencil');
      for (const scene of scenes) {
        await graphics.resources.preparePipelines(
          renderer.collect({ name: 'opaque' }, scene, graphics.describeTarget(target)),
        );
      }
      const frame = async (scene: Scene, cullOnGpu: boolean) => {
        renderer.update(camera, scene, createFrame());
        if (cullOnGpu) renderer.prepareCull(scene);
        graphics.beginRenderPass(target);
        renderer.clear(true);
        renderer.setViewport(0, 0, Size, Size);
        renderer.renderOpaque(scene, camera);
        graphics.flush();
        const pixels = Array.from(await graphics.readRenderTarget(target, 0, 0, Size, Size));
        await graphics.resources.pending.whenReady();
        return pixels;
      };
      // the culling kernels compile in the background: a few frames
      for (let i = 0; i < 20; ++i) for (const scene of scenes) await frame(scene, true);
      const [gpuReference, gpuWritten] = [await frame(scenes[0], true), await frame(scenes[1], true)];
      expect(new Set(gpuReference).size).toBeGreaterThan(2);
      expect(gpuWritten).toEqual(gpuReference);
      // culled on the CPU: the identity region (every instance by index, the same rows)
      const [cpuReference, cpuWritten] = [await frame(scenes[0], false), await frame(scenes[1], false)];
      expect(cpuWritten).toEqual(cpuReference);
      // the writer member's CPU transforms written again (a member update, `syncMembers`): its rows written again after
      const calls = written[1].calls();
      const member = written[1].object.values;
      ValueCell.update(member.aTransform, new Float32Array(member.aTransform.ref.value.length));
      scenes[1].update(void 0, false);
      scenes[1].commit();
      for (let i = 0; i < 4; ++i) await frame(scenes[1], true);
      expect(written[1].calls()).toBeGreaterThan(calls);
      expect(await frame(scenes[1], true)).toEqual(gpuReference);
      expect(await frame(scenes[1], false)).toEqual(cpuReference);
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });
  it("draws a pool's live instances alone, as its view hook sets them, culled on the GPU and on the CPU", async () => {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: Size, height: Size },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      const graphics = plugin.canvas3d!.graphics;
      // nothing at the origin, where zero rows would put a dead slot's spheres (review M1, N2)
      const offsets = [Vec3.create(-200, 0, 0), Vec3.create(2.5, 2.5, 1)];
      const colors = [ColorNames.orange, ColorNames.green];
      const Live = 14;
      const pool: Pool = { live: Live, drawn: Copies * Copies, views: 0 };
      // the reference: the pool's member with its live instances alone
      const reference = [createMember(offsets[0], colors[0], false), createMember(offsets[1], colors[1], false, Live)];
      const written = [
        createMember(offsets[0], colors[0], false),
        createMember(offsets[1], colors[1], true, Copies * Copies, pool),
      ];
      const scenes = [reference, written].map((members) => {
        const scene = Scene.create(graphics);
        scene.add(
          createMergedRenderObject(
            members.map((m) => m.object),
            { gpuCulling: true },
          ),
        );
        scene.commit();
        return scene;
      });
      const camera = new Camera();
      Viewport.set(camera.viewport, 0, 0, Size, Size);
      const { center, radius } = scenes[1].boundingSphere;
      camera.setState(camera.getFocus(center, radius * 1.2), 0);
      camera.update();
      const renderer = Renderer.create(graphics, { sphereRaster: 'off' });
      const target = graphics.createRenderTarget(Size, Size, 'depth-stencil');
      for (const scene of scenes) {
        await graphics.resources.preparePipelines(
          renderer.collect({ name: 'opaque' }, scene, graphics.describeTarget(target)),
        );
      }
      const frame = async (scene: Scene, cullOnGpu: boolean) => {
        renderer.update(camera, scene, createFrame());
        if (cullOnGpu) renderer.prepareCull(scene);
        graphics.beginRenderPass(target);
        renderer.clear(true);
        renderer.setViewport(0, 0, Size, Size);
        renderer.renderOpaque(scene, camera);
        graphics.flush();
        const pixels = Array.from(await graphics.readRenderTarget(target, 0, 0, Size, Size));
        await graphics.resources.pending.whenReady();
        return pixels;
      };
      for (let i = 0; i < 20; ++i) for (const scene of scenes) await frame(scene, true);
      expect(pool.views).toBeGreaterThan(0);
      const gpuReference = await frame(scenes[0], true);
      expect(new Set(gpuReference).size).toBeGreaterThan(2);
      expect(await frame(scenes[1], true)).toEqual(gpuReference);
      // the camera at rest: no view hook again
      const views = pool.views;
      for (let i = 0; i < 3; ++i) await frame(scenes[1], true);
      expect(pool.views).toBe(views);
      // culled on the CPU (a new view, no GPU dispatch): the dead slots draw nothing (review M1, N2: zero rows drew
      // them at the origin), the origin in view
      camera.setState(camera.getFocus(Vec3.create(0, 0, 0), 12), 0);
      camera.update();
      const cpuReference = await frame(scenes[0], false);
      expect(await frame(scenes[1], false)).toEqual(cpuReference);
      expect(graphics.takeErrors?.() ?? []).toEqual([]);
    } finally {
      plugin.dispose();
    }
  });
});
