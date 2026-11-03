/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { createExtinctionPyramid, isVolumeLightingSupported } from '@molstar/graphics/gl/compute/volume-lighting';
import { BufferUsage, MapMode, TextureUsage } from '@molstar/graphics/gl/webgpu/constants';
import type { WebGPUContext } from '@molstar/graphics/gl/webgpu/context';
import { volume_lighting_wgsl } from '@molstar/graphics/gl/webgpu/shader/direct-volume.wgsl';
import { VolumeNeuralWeights } from '@molstar/graphics/gl/webgpu/shader/_generated/volume-neural-weights';
import { evaluateVolumeNetwork, getVolumeNetworkWgsl } from '@molstar/graphics/gl/webgpu/shader/volume-neural.wgsl';
import { asWebGPUTexture } from '@molstar/graphics/gl/webgpu/texture';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

/** written by tools/volume-lighting/fixtures.py: what the Python tools compute, and the filters' precision bound */
const Fixture = JSON.parse(readFileSync(new URL('./_generated/volume-descriptors.json', import.meta.url), 'utf8')) as {
  dim: number[];
  points: number[];
  lights: number[];
  cosines: number[];
  descriptors: number[];
  bounds: number[];
};

/** fixtures.py's grid (x fastest) and transfer function, by the same integer formulas */
function gridBytes([gx, gy, gz]: number[]) {
  const out = new Uint8Array(gx * gy * gz);
  for (let z = 0; z < gz; ++z) {
    for (let y = 0; y < gy; ++y) {
      for (let x = 0; x < gx; ++x) {
        const b =
          Math.max(0, 255 - 9 * (Math.abs(x - 12) + Math.abs(y - 10) + Math.abs(z - 9))) +
          ((x * 7 + y * 3 + z * 5) % 13);
        out[x + gx * (y + gy * z)] = Math.min(b, 255);
      }
    }
  }
  return out;
}
const transferBytes = () => Uint8Array.from({ length: 256 }, (_, i) => (i < 40 ? 0 : Math.min(255, (i - 40) * 2)));

/** what the ray marcher declares and `volume_lighting_wgsl` reads, bound for a compute pass */
const Prelude = /* wgsl */ `
struct Material { uAlpha: f32 };
const uMaterial = Material(1.0);
struct Global { uLightColor: array<vec3<f32>, 1>, uAmbientColor: vec3<f32> };
var<private> uGlobal: Global;
const oLightCount = 1;
struct Object { uGridDim: vec3<f32>, count: u32 };
@group(0) @binding(0) var<uniform> uObject: Object;
@group(0) @binding(1) var<storage, read> inputs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputs: array<f32>;
@group(0) @binding(3) var sLinear: sampler;
@group(1) @binding(0) var tGridTex: texture_3d<f32>;
@group(1) @binding(1) var tTransferTex: texture_2d<f32>;
@group(1) @binding(2) var tExtinction: texture_3d<f32>;

fn transferFunction(value: f32) -> f32 {
    return textureSampleLevel(tTransferTex, sLinear, vec2<f32>(value, 0.0), 0.0).r;
}
fn volumeClipped(x: vec3<f32>) -> bool {
    return false;
}

fn textureVal(pos: vec3<f32>) -> vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, textureSampleLevel(tGridTex, sLinear, pos + vec3<f32>(0.5) / uObject.uGridDim, 0.0).r);
}
`;

const DescriptorsWgsl = /* wgsl */ `
${Prelude}
${volume_lighting_wgsl}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= uObject.count) {
        return;
    }
    let x = inputs[2u * i].xyz;
    let dim = uObject.uGridDim;
    let d = volumeDescriptors(x, cellExtinction(textureVal((x - 0.5) / dim).a), inputs[2u * i + 1u].xyz, inputs[2u * i].w, dim);
    let o = 13u * i;
    outputs[o] = d.around0.x; outputs[o + 1u] = d.around0.y; outputs[o + 2u] = d.around0.z;
    outputs[o + 3u] = d.around1.x; outputs[o + 4u] = d.around1.y; outputs[o + 5u] = d.around1.z;
    outputs[o + 6u] = d.light0.x; outputs[o + 7u] = d.light0.y; outputs[o + 8u] = d.light0.z;
    outputs[o + 9u] = d.light1.x; outputs[o + 10u] = d.light1.y; outputs[o + 11u] = d.light1.z;
    outputs[o + 12u] = d.cosine;
}
`;

const NetworkWgsl = /* wgsl */ `
struct VolumeDescriptors { around0: vec3<f32>, around1: vec3<f32>, light0: vec3<f32>, light1: vec3<f32>, cosine: f32 };
struct Object { uGridDim: vec3<f32>, count: u32 };
@group(0) @binding(0) var<uniform> uObject: Object;
@group(0) @binding(1) var<storage, read> inputs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputs: array<f32>;
${getVolumeNetworkWgsl()}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= uObject.count) {
        return;
    }
    let a = inputs[4u * i];
    let b = inputs[4u * i + 1u];
    let c = inputs[4u * i + 2u];
    let e = inputs[4u * i + 3u];
    let d = VolumeDescriptors(a.xyz, vec3<f32>(a.w, b.xy), vec3<f32>(b.zw, c.x), c.yzw, e.x);
    let o = volumeNetwork(d, e.y);
    outputs[2u * i] = o.x;
    outputs[2u * i + 1u] = o.y;
}
`;

/** Runs `code`'s `main` over `count` items: `inputs` as group 0's storage, `textures` as group 1, `stride` floats out */
async function run(
  graphics: WebGPUContext,
  code: string,
  inputs: Float32Array,
  count: number,
  stride: number,
  dim: number[],
  textures?: GPUTextureView[],
) {
  const { device } = graphics;
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  expect(info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}: ${m.message}`)).toEqual([]);
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const uniform = device.createBuffer({ size: 16, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
  const u = new ArrayBuffer(16);
  new Float32Array(u, 0, 3).set(dim);
  new Uint32Array(u, 12, 1)[0] = count;
  device.queue.writeBuffer(uniform, 0, u);
  const input = device.createBuffer({ size: inputs.byteLength, usage: BufferUsage.STORAGE | BufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, inputs);
  const size = count * stride * 4;
  const output = device.createBuffer({ size, usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC });
  const read = device.createBuffer({ size, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST });
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: uniform } },
    { binding: 1, resource: { buffer: input } },
    { binding: 2, resource: { buffer: output } },
  ];
  if (textures)
    entries.push({ binding: 3, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
  if (textures) {
    pass.setBindGroup(
      1,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: textures.map((resource, binding) => ({ binding, resource })),
      }),
    );
  }
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  encoder.copyBufferToBuffer(output, 0, read, 0, size);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(MapMode.READ);
  const out = new Float32Array(read.getMappedRange().slice(0));
  for (const b of [uniform, input, output, read]) b.destroy();
  return out;
}

/** a seeded generator (mulberry32) */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!WebGPU.module)('neural volume lighting on WebGPU', () => {
  async function withGraphics(f: (graphics: WebGPUContext) => Promise<void>) {
    const plugin = await HeadlessPluginContext.create(
      { webgpu: WebGPU.module! },
      DefaultPluginSpec(),
      { width: 16, height: 16 },
      { backend: 'webgpu' },
    );
    try {
      await plugin.init();
      await f(plugin.canvas3d!.graphics as WebGPUContext);
    } finally {
      plugin.dispose();
    }
  }

  it("the shader's descriptors are the Python tools', within the filters' precision", async () => {
    await withGraphics(async (graphics) => {
      expect(isVolumeLightingSupported(graphics)).toBe(true);
      if (!isVolumeLightingSupported(graphics)) return;
      const { device } = graphics;
      const dim = Fixture.dim;
      const gridTexture = graphics.resources.texture('volume-uint8', 'r', 'ubyte', 'linear');
      gridTexture.load({ array: gridBytes(dim), width: dim[0], height: dim[1], depth: dim[2] });
      const transfer = transferBytes();
      const pyramid = createExtinctionPyramid(graphics);
      pyramid.build({
        gridTexture,
        gridDim: Vec3.create(dim[0], dim[1], dim[2]),
        transfer,
        alpha: 1,
        packedGroup: false,
      });
      graphics.flush();
      const transferTexture = device.createTexture({
        size: [256, 1],
        format: 'r8unorm',
        usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: transferTexture }, transfer, { bytesPerRow: 256 }, [256, 1]);

      const n = Fixture.cosines.length;
      const inputs = new Float32Array(8 * n);
      for (let i = 0; i < n; ++i) {
        inputs.set([...Fixture.points.slice(3 * i, 3 * i + 3), Fixture.cosines[i]], 8 * i);
        inputs.set(Fixture.lights.slice(3 * i, 3 * i + 3), 8 * i + 4);
      }
      const views = [
        asWebGPUTexture(gridTexture).getGPUTexture()!.createView(),
        transferTexture.createView(),
        asWebGPUTexture(pyramid.texture).getGPUTexture()!.createView(),
      ];
      const gpu = await run(graphics, DescriptorsWgsl, inputs, n, 13, dim, views);
      let worst = 0;
      let exact = 0;
      for (let i = 0; i < 13 * n; ++i) {
        const err = Math.abs(gpu[i] - Fixture.descriptors[i]);
        if (Fixture.bounds[i] === 0 && i % 13 !== 12)
          expect(gpu[i], `descriptor ${i % 13} of ${(i / 13) | 0}: 0 outside`).toBe(0);
        else if (i % 13 === 12) expect(gpu[i]).toBe(Fixture.descriptors[i]);
        else worst = Math.max(worst, err / Fixture.bounds[i]);
        if (err === 0) exact++;
      }
      expect(worst, `worst error over its bound (${exact} of ${13 * n} exact)`).toBeLessThanOrEqual(1);
      expect(graphics.takeErrors()).toEqual([]);
      pyramid.destroy();
      gridTexture.destroy();
      transferTexture.destroy();
    });
  }, 60_000);

  it('the WGSL network is the TypeScript one on 1,000 random inputs of the training range, within 1e-4', async () => {
    await withGraphics(async (graphics) => {
      const rand = random(3);
      const n = 1000;
      const { lo, hi } = VolumeNeuralWeights;
      const inputs = new Float32Array(16 * n);
      for (let i = 0; i < n; ++i) {
        // the 12 extinctions correlated, as a sample's are (one density around it, each read a part of it), thin ones
        // more often, within the training range; the cosine and the albedo uniform in it
        const base = rand() ** 2;
        for (let k = 0; k < 14; ++k) {
          const t = k < 12 ? Math.min(1, base * (0.3 + rand())) : rand();
          inputs[16 * i + k] = lo[k] + (hi[k] - lo[k]) * t;
        }
      }
      const gpu = await run(graphics, NetworkWgsl, inputs, n, 2, [1, 1, 1]);
      let worst = 0;
      const clamped = [0, 0];
      for (let i = 0; i < n; ++i) {
        const ts = evaluateVolumeNetwork(inputs.subarray(16 * i, 16 * i + 14));
        for (let k = 0; k < 2; ++k) {
          worst = Math.max(worst, Math.abs(gpu[2 * i + k] - ts[k]) / Math.max(1, ts[k]));
          if (ts[k] >= VolumeNeuralWeights.outMax[k]) clamped[k]++;
        }
      }
      expect(worst).toBeLessThanOrEqual(1e-4);
      // the outputs are mostly the network's, not its clamps (an ambient of 1, the sky unblocked, is often right)
      expect(clamped[0]).toBeLessThan(n / 10);
      expect(clamped[1]).toBeLessThan(n / 2);
      expect(graphics.takeErrors()).toEqual([]);
    });
  }, 60_000);
});
