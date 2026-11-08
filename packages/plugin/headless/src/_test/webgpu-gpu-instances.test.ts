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
import type { GpuInstanceWriter } from '@molstar/graphics/gl/renderable/merged-culler';
import { InstanceDataVec4s } from '@molstar/graphics/gl/renderable/merged';
import { Scene } from '@molstar/graphics/gl/scene';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

const Size = 64;
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
function createMember(offset: Vec3, color: number, gpu: boolean) {
  const centers = new Float32Array([0, 0, 0, 1.2, 0, 0, 0, 1.2, 0, -1.2, 0, 0, 0, -1.2, 0]);
  const groups = new Float32Array([0, 1, 2, 3, 4]);
  const spheres = Spheres.create(centers, groups, 5);
  const real = gridTransforms(offset);
  const props = PD.getDefaultValues(Spheres.Params);
  const transform = createTransform(gpu ? new Float32Array(real.length) : real, Copies * Copies, undefined, 0, 0);
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
      for (let i = 0; i < target.count; ++i) {
        const row = rows.subarray(i * 12, i * 12 + 12);
        target.instanceData.write(row, (target.instanceBase + i) * InstanceDataVec4s * 16);
      }
      target.transforms.write(rows, (target.identityBase + target.instanceBase) * 3 * 16);
    };
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
      // culled on the CPU: the identity region of the compacted transforms
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
});
