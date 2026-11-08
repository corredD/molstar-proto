/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { createTransform, type TransformData } from '@molstar/graphics/geo/geometry/transform-data';
import { packAffineRows } from '../affine-rows.js';
import type { ComputeContext, KernelCode, StorageBuffer } from '../compute.js';
import type { GraphicsResources } from '../context.js';
import { LodView } from '../renderable.js';
import { createMergedRenderObject, createRenderObject, type GraphicsRenderObject } from '../render-object.js';
import { createMergedCuller } from '../renderable/merged-culler.js';
import { InstanceDataVec4s, type MergeableValues, packInstanceData } from '../renderable/merged.js';

// The GPU culler of a merged object (merged-culler.ts) on a fake compute context: what it writes to its buffers, read
// back from memory. A drag's preview moves the instances of one member of thousands each pointer event (Ludo,
// 2026-11-06: MG lags on WebGPU, not on WebGL): the culler must write that member's cells and instances, not every
// member's, and every instance must stay in a cell holding its sphere (the instance kernel tests only the instances of
// the cells drawn: one in a stale cell vanishes when that cell is culled).

interface FakeBuffer extends StorageBuffer {
  readonly label: string;
  readonly bytes: Uint8Array;
}

/** `limit`: the kernels ready, a dispatch over more workgroups than it in a dimension throwing as WebGPU's does */
function fakeCompute(limit?: number) {
  let written = 0;
  const dispatches: { kernel: string; x: number; y: number; z: number }[] = [];
  let nextId = 0;
  const latest = new Map<string, FakeBuffer>();
  const createBuffer = (byteLength: number, label = '') => {
    const bytes = new Uint8Array(byteLength);
    const b: FakeBuffer = {
      id: nextId++,
      label,
      bytes,
      byteLength,
      write(data, byteOffset = 0) {
        bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), byteOffset);
        written += data.byteLength;
      },
      clear(byteOffset = 0, length = byteLength - byteOffset) {
        bytes.fill(0, byteOffset, byteOffset + length);
      },
      copyTo() {},
      readAsync: async () => bytes.slice().buffer,
      getByteCount: () => byteLength,
      destroy() {},
    };
    latest.set(label, b);
    return b;
  };
  const compute = {
    maxStorageBufferSize: 2 ** 31,
    getStorageBufferByteCount: () => 0,
    isKernelSupported: () => true,
    maxWorkgroupsPerDimension: limit ?? 65535,
    createKernel: (code: KernelCode) => ({
      dispatch: (x: number, y = 1, z = 1) => {
        if (limit !== undefined && (x > limit || y > limit || z > limit)) {
          throw new Error(`kernel '${code.name}': ${x} × ${y} × ${z} workgroups exceed ${limit} per dimension`);
        }
        dispatches.push({ kernel: code.name, x, y, z });
      },
    }),
    // without a limit never ready: the culler culls on the CPU meanwhile, its buffers written all the same
    prepareKernels: () => new Promise<void>(() => {}),
    hasKernels: () => limit !== undefined,
    createBuffer,
    tryCreateBuffer: async (n: number, label?: string) => createBuffer(n, label),
    ownsBuffer: () => true,
    beginComputePass() {},
    endComputePass() {},
  } as unknown as ComputeContext;
  const resources = { texture: () => ({ load() {} }) } as unknown as GraphicsResources;
  return {
    compute,
    resources,
    dispatches,
    get written() {
      return written;
    },
    reset() {
      written = 0;
    },
    floats: (label: string) => {
      const b = latest.get(label)!;
      return new Float32Array(b.bytes.buffer, 0, b.byteLength / 4);
    },
    uints: (label: string) => {
      const b = latest.get(label)!;
      return new Uint32Array(b.bytes.buffer, 0, b.byteLength / 4);
    },
  };
}

const Invariant = Sphere3D.create(Vec3(), 2);
const PerMember = 8;

/** `count` spheres objects of `PerMember` instances each, in a row along y, gridded (cells of 20 Å) */
function scene(count: number, limit?: number) {
  const builder = SpheresBuilder.create(2, 1);
  builder.add(0, 0, 0, 0);
  builder.add(1, 0, 0, 1);
  const geometry = builder.getSpheres();
  const props = PD.getDefaultValues(Spheres.Params);
  const objects: GraphicsRenderObject[] = [];
  for (let m = 0; m < count; ++m) {
    const transforms = new Float32Array(PerMember * 16);
    for (let i = 0; i < PerMember; ++i) {
      Mat4.toArray(Mat4.fromTranslation(Mat4(), Vec3.create(m * 30, i * 10, 0)), transforms, i * 16);
    }
    const transform = createTransform(transforms, PerMember, Invariant, 20, 64);
    const values = Spheres.Utils.createValuesSimple(geometry, props, ColorNames.orange, 1, transform);
    objects.push(createRenderObject('spheres', values, Spheres.Utils.createRenderableState(props), -1));
  }
  const ro = createMergedRenderObject(objects, { gpuCulling: true });
  ro.merged.sync();
  const fake = fakeCompute(limit);
  const members = objects.map((o) => o.values as MergeableValues);
  const culler = createMergedCuller(fake.compute, fake.resources, ro.merged, members, false);

  /** member `m`'s instances `which` moved by `by`, as a drag's preview does (`setParticleFrames`), then synced */
  const move = (m: number, which: readonly number[], by: Vec3) => {
    const values = objects[m].values as unknown as TransformData;
    const transforms = new Float32Array(values.transform.ref.value);
    for (const i of which) {
      transforms[i * 16 + 12] += by[0];
      transforms[i * 16 + 13] += by[1];
      transforms[i * 16 + 14] += by[2];
    }
    createTransform(transforms, PerMember, Invariant, 20, 64, values);
    Spheres.Utils.updateBoundingSphere(objects[m].values as never, geometry);
    ro.merged.sync({ growBounds: true });
    fake.reset();
    culler.sync();
    return fake.written;
  };
  return { ro, fake, culler, move };
}

/** what the culler holds is what a fresh one would cull with: every instance in a cell holding it, the data current */
function expectCurrent({ ro, fake, culler }: ReturnType<typeof scene>) {
  const values = ro.merged.values;
  const count: number = values.instanceCount.ref.value;
  const transforms = values.aTransform.ref.value as Float32Array;
  const cells = fake.uints('culled instance cells');
  const spheres = fake.floats('culled cell spheres');
  const center = Vec3();
  for (let i = 0; i < count; ++i) {
    const c = cells[i * 2];
    const s = cells[i * 2 + 1];
    expect(s).toBe(values.aSegment.ref.value[i * 4 + 3]);
    Vec3.transformMat4(center, Invariant.center, Mat4.fromArray(Mat4(), transforms, i * 16));
    const d = Vec3.distance(center, Vec3.create(spheres[c * 4], spheres[c * 4 + 1], spheres[c * 4 + 2]));
    expect(d + Invariant.radius).toBeLessThanOrEqual(spheres[c * 4 + 3] + 1e-3);
  }
  const data = new Float32Array(count * InstanceDataVec4s * 4);
  packInstanceData(values, data);
  expect(Array.from(fake.floats('culled instance data').subarray(0, data.length))).toEqual(Array.from(data));
  // the identity region: all instances in their own order, as views not culled on the GPU draw them
  const rows = packAffineRows(transforms, count, new Float32Array(count * 12));
  const drawn = fake.floats('culled transforms').subarray(culler.identityBase * 12, (culler.identityBase + count) * 12);
  expect(Array.from(drawn)).toEqual(Array.from(rows));
}

describe('the GPU culler of a merged object', () => {
  it('keeps every instance in a cell holding it as members move', () => {
    const s = scene(6);
    expectCurrent(s);
    // one instance far out of its cells
    s.move(2, [3], Vec3.create(500, 0, 0));
    expectCurrent(s);
    // every instance of a member scattered: more cells than it had
    s.move(4, [0, 1, 2, 3, 4, 5, 6, 7], Vec3.create(0, 0, 0));
    for (let i = 0; i < PerMember; ++i) s.move(4, [i], Vec3.create(i * 97, -i * 61, i * 43));
    expectCurrent(s);
    // and back
    s.move(2, [3], Vec3.create(-500, 0, 0));
    expectCurrent(s);
  });

  it("writes the moved member's cells and instances, not every member's (O(moved))", () => {
    const written = (members: number) => {
      const s = scene(members);
      s.move(1, [3], Vec3.create(5, 0, 0));
      const bytes = s.move(1, [3], Vec3.create(5, 0, 0));
      expectCurrent(s);
      return bytes;
    };
    const small = written(50);
    const large = written(200);
    // the control: a full layout writes about 4x at 4x the members
    expect(large).toBeLessThan(small * 1.5);
  });

  it('dispatches more workgroups than a dimension holds in rows (a yeast slab: 6.7M instances, 104k groups)', () => {
    // 40 members of 8: 320 instances, 5 workgroups of 64, over a limit of 4 a dimension
    const s = scene(40, 4);
    const dispatched = s.culler.dispatch(Plane3D.create(Vec3.create(0, 0, -1), 0), Frustum3D(), LodView());
    expect(dispatched).toBe(true);
    // every kernel's dispatch within the limit (the fake throws past it, as WebGPU does)
    expect(new Set(s.fake.dispatches.map((d) => d.kernel))).toEqual(
      new Set(['cell-cull', 'instance-copy', 'cull-args']),
    );
    for (const d of s.fake.dispatches) expect(Math.max(d.x, d.y, d.z)).toBeLessThanOrEqual(4);
    const copy = s.fake.dispatches.find((d) => d.kernel === 'instance-copy')!;
    // every instance has a thread: the kernels index workgroups by `wid.x + wid.y * num_workgroups.x`
    expect(copy.x * copy.y * copy.z * 64).toBeGreaterThanOrEqual(320);
  });
});
