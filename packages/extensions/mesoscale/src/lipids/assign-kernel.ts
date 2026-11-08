/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ValueCell } from '@molstar/core/util/value-cell';
import {
  type ComputeContext,
  type ComputeKernel,
  KernelCode,
  type StorageBuffer,
  StorageBufferSpec,
} from '@molstar/graphics/gl/compute';
import { workgroupRows } from '@molstar/graphics/gl/compute/cell-cull';
import { UniformSpec } from '@molstar/graphics/gl/renderable/schema';
import type { GpuInstanceTarget, GpuInstanceWriter } from '@molstar/graphics/gl/renderable/merged-culler';
import { InstanceDataVec4s } from '@molstar/graphics/gl/renderable/merged';
import type { TileKinds, TriangleSlots } from './assign.js';

// The assignment on the GPU (progress/2026-11-08-lipid-tiles.md, Design: Assignment): `assign.ts`'s per-triangle
// function in WGSL, one thread a triangle of one variant (in its slot order), writing the affine rows of its tile into the
// merged culler's buffers (`GpuInstanceWriter`). The variant it computes is written to `check` (the Dawn test compares
// it with the CPU's, `assignSlots`): the CPU only needs it for the counts per variant.

const wgsl = /* wgsl */ `
fn lowbias32(v0: u32) -> u32 {
    var v = v0;
    v = v ^ (v >> 16u);
    v = v * 0x7feb352du;
    v = v ^ (v >> 15u);
    v = v * 0x846ca68bu;
    return v ^ (v >> 16u);
}

fn seed() -> u32 {
    return bitcast<u32>(uParams.uSeed);
}

fn vertexColor(id: u32) -> u32 {
    return lowbias32(id ^ seed()) % u32(uParams.uVertexColors);
}

fn edgeCode(a: u32, b: u32) -> u32 {
    let lo = min(a, b);
    let hi = max(a, b);
    let t = lowbias32(lowbias32(lo ^ seed()) ^ hi) % u32(uParams.uEdgeTypes);
    return t * 2u + select(1u, 0u, a < b);
}

fn position(i: u32) -> vec3<f32> {
    return vec3<f32>(positions[i * 3u], positions[i * 3u + 1u], positions[i * 3u + 2u]);
}

@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    // the workgroups in rows past the dispatch's limit (\`workgroupRows\`)
    let i = id.x + id.y * groups.x * WorkgroupSizeX;
    if (i >= u32(uParams.uCount)) {
        return;
    }
    let t = order[u32(uParams.uStart) + i];
    let a = indices[t * 3u];
    let b = indices[t * 3u + 1u];
    let c = indices[t * 3u + 2u];
    let C = u32(uParams.uVertexColors);
    let E = 2u * u32(uParams.uEdgeTypes);
    let V = u32(uParams.uVariants);
    let v = lowbias32(t ^ lowbias32(seed())) % V;
    let corners = (vertexColor(a) * C + vertexColor(b)) * C + vertexColor(c);
    let edges = (edgeCode(a, b) * E + edgeCode(b, c)) * E + edgeCode(c, a);
    check[u32(uParams.uStart) + i] = (corners * E * E * E + edges) * V + v;

    // the template (A at the origin, B = (L, 0), C = (L/2, L√3/2)) onto the triangle, z onto its normal (\`triangleAffine\`)
    let p0 = position(a);
    let u = position(b) - p0;
    let w = position(c) - p0;
    let n = normalize(cross(u, w));
    let L = uParams.uEdge;
    let h = L * 0.8660254037844386;
    let cx = u / L;
    let cy = u * (-0.5 / h) + w / h;
    // the rows of the affine (\`affine-rows.ts\`)
    let r0 = vec4<f32>(cx.x, cy.x, n.x, p0.x);
    let r1 = vec4<f32>(cx.y, cy.y, n.y, p0.y);
    let r2 = vec4<f32>(cx.z, cy.z, n.z, p0.z);
    let o = (u32(uParams.uInstanceBase) + i) * ${InstanceDataVec4s}u;
    instanceData[o] = r0;
    instanceData[o + 1u] = r1;
    instanceData[o + 2u] = r2;
    let q = (u32(uParams.uIdentityBase) + u32(uParams.uInstanceBase) + i) * 3u;
    transforms[q] = r0;
    transforms[q + 1u] = r1;
    transforms[q + 2u] = r2;
}
`;

export const LipidTileAssignKernel = KernelCode('lipid-tile-assign', [64], { wgsl });

export const LipidTileAssignSchema = {
  uEdge: UniformSpec('f'),
  uEdgeTypes: UniformSpec('i'),
  uVertexColors: UniformSpec('i'),
  uVariants: UniformSpec('i'),
  uSeed: UniformSpec('i'),
  uStart: UniformSpec('i'),
  uCount: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  uIdentityBase: UniformSpec('i'),
  positions: StorageBufferSpec('f32', 'read'),
  indices: StorageBufferSpec('u32', 'read'),
  order: StorageBufferSpec('u32', 'read'),
  instanceData: StorageBufferSpec('vec4<f32>', 'read-write'),
  transforms: StorageBufferSpec('vec4<f32>', 'read-write'),
  check: StorageBufferSpec('u32', 'read-write'),
};

/** A leaflet's mesh and slots on the GPU, and one writer per variant (a member of the merged object) */
export interface LipidTileAssigner {
  /** the writer of variant `v`'s tiles */
  writer: (v: number) => GpuInstanceWriter;
  /** the variant each thread computed, in slot order (`TriangleSlots.order`): the test's */
  readonly check: StorageBuffer;
  destroy: () => void;
}

/**
 * The mesh (`positions`, `indices`) and its slots (`assignSlots`) uploaded once, the kernel created on the first write.
 * Byte cost: 12 B a vertex, 12 B a triangle, 4 B its slot, 4 B the check: nothing a lipid.
 */
export function createLipidTileAssigner(
  compute: ComputeContext,
  kinds: TileKinds,
  edge: number,
  positions: Float32Array,
  indices: Uint32Array,
  slots: TriangleSlots,
): LipidTileAssigner {
  const buffer = (data: ArrayBufferView & { byteLength: number }, label: string) => {
    const b = compute.createBuffer(Math.max(16, data.byteLength), label);
    b.write(data);
    return b;
  };
  const positionBuffer = buffer(positions, 'lipid tiles: positions');
  const indexBuffer = buffer(indices, 'lipid tiles: indices');
  const orderBuffer = buffer(slots.order, 'lipid tiles: order');
  const check = compute.createBuffer(Math.max(16, slots.order.byteLength), 'lipid tiles: check');
  const values = {
    uEdge: ValueCell.create(edge),
    uEdgeTypes: ValueCell.create(kinds.edgeTypes),
    uVertexColors: ValueCell.create(kinds.vertexColors),
    uVariants: ValueCell.create(kinds.variants),
    // the seed's bits as an i32 (`bitcast<u32>` in the kernel)
    uSeed: ValueCell.create(kinds.seed | 0),
    uStart: ValueCell.create(0),
    uCount: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    uIdentityBase: ValueCell.create(0),
    positions: ValueCell.create(positionBuffer),
    indices: ValueCell.create(indexBuffer),
    order: ValueCell.create(orderBuffer),
    instanceData: ValueCell.create(positionBuffer),
    transforms: ValueCell.create(positionBuffer),
    check: ValueCell.create(check),
  };
  let kernel: ComputeKernel | undefined;
  const write = (v: number, target: GpuInstanceTarget) => {
    const start = slots.starts[v];
    const count = Math.min(target.count, slots.counts[v]);
    if (count === 0) return;
    ValueCell.update(values.uStart, start);
    ValueCell.update(values.uCount, count);
    ValueCell.update(values.uInstanceBase, target.instanceBase);
    ValueCell.update(values.uIdentityBase, target.identityBase);
    ValueCell.updateIfChanged(values.instanceData, target.instanceData);
    ValueCell.updateIfChanged(values.transforms, target.transforms);
    kernel ??= compute.createKernel(LipidTileAssignKernel, LipidTileAssignSchema, values);
    compute.beginComputePass({ label: 'lipid tiles' });
    kernel.dispatch(...workgroupRows(count, 64, compute.maxWorkgroupsPerDimension));
    compute.endComputePass();
  };
  return {
    writer: (v) => (_compute, target) => write(v, target),
    check,
    destroy: () => {
      kernel?.destroy();
      for (const b of [positionBuffer, indexBuffer, orderBuffer, check]) b.destroy();
    },
  };
}
