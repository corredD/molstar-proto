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
import { cutterBases, type CutterTable } from './cutter.js';

// The cutter on the GPU (`cutter.ts`, its TypeScript reference): one thread a triangle, two passes. The count pass
// writes each (member, triangle)'s hits; the CPU reads them back once, sums them (the merged layout needs each member's
// instance count before any draw: `gpuInstances`) and uploads each (member, triangle)'s first instance; each member's
// writer then runs the write pass, its hits' affine rows into the merged culler's buffers. Deterministic (no atomics).

const common = /* wgsl */ `
fn lowbias32(v0: u32) -> u32 {
    var v = v0;
    v = v ^ (v >> 16u);
    v = v * 0x7feb352du;
    v = v ^ (v >> 15u);
    v = v * 0x846ca68bu;
    return v ^ (v >> 16u);
}

fn random01(i: u32) -> f32 {
    return f32(lowbias32(bitcast<u32>(uParams.uSeed) + i * 0x9e3779b9u)) * (1.0 / 4294967296.0);
}

fn position(i: u32) -> vec3<f32> {
    return vec3<f32>(positions[i * 3u], positions[i * 3u + 1u], positions[i * 3u + 2u]);
}

struct Cut {
    c: vec3<f32>,
    e1: vec3<f32>,
    e2: vec3<f32>,
    n: vec3<f32>,
    a: vec2<f32>,
    b: vec2<f32>,
    d: vec2<f32>,
    radius: f32,
    rot: vec2<f32>,
    o: vec2<f32>,
    ok: bool,
}

fn triangleCut(t: u32) -> Cut {
    var k: Cut;
    let pa = position(indices[t * 3u]);
    let pb = position(indices[t * 3u + 1u]);
    let pc = position(indices[t * 3u + 2u]);
    let c = (pa + pb + pc) / 3.0;
    let nn = cross(pb - pa, pc - pa);
    let e = pa - c;
    k.ok = dot(nn, nn) > 0.0 && dot(e, e) > 0.0;
    if (!k.ok) {
        return k;
    }
    k.c = c;
    k.n = normalize(nn);
    k.e1 = normalize(e);
    k.e2 = cross(k.n, k.e1);
    k.a = vec2<f32>(dot(pa - c, k.e1), dot(pa - c, k.e2));
    k.b = vec2<f32>(dot(pb - c, k.e1), dot(pb - c, k.e2));
    k.d = vec2<f32>(dot(pc - c, k.e1), dot(pc - c, k.e2));
    k.radius = max(length(k.a), max(length(k.b), length(k.d)));
    let theta = 6.283185307179586 * random01(t * 3u);
    k.rot = vec2<f32>(cos(theta), sin(theta));
    k.o = vec2<f32>(random01(t * 3u + 1u) * uParams.uBoxX, random01(t * 3u + 2u) * uParams.uBoxY);
    return k;
}

fn edge(p: vec2<f32>, q: vec2<f32>, x: vec2<f32>) -> f32 {
    return (q.x - p.x) * (x.y - p.y) - (q.y - p.y) * (x.x - p.x);
}

/** the hits of lipid l in cut k, through \`visit\`'s caller: the images' range */
fn imageRange(k: Cut, h: vec2<f32>) -> vec4<i32> {
    let bx = uParams.uBoxX;
    let by = uParams.uBoxY;
    return vec4<i32>(
        i32(ceil((k.o.x - k.radius - h.x) / bx)),
        i32(floor((k.o.x + k.radius - h.x) / bx)),
        i32(ceil((k.o.y - k.radius - h.y) / by)),
        i32(floor((k.o.y + k.radius - h.y) / by)),
    );
}

fn inside(k: Cut, h: vec2<f32>, i: i32, j: i32) -> vec3<f32> {
    let p = vec2<f32>(h.x + f32(i) * uParams.uBoxX - k.o.x, h.y + f32(j) * uParams.uBoxY - k.o.y);
    let q = vec2<f32>(k.rot.x * p.x + k.rot.y * p.y, -k.rot.y * p.x + k.rot.x * p.y);
    let hit = edge(k.a, k.b, q) >= 0.0 && edge(k.b, k.d, q) >= 0.0 && edge(k.d, k.a, q) >= 0.0;
    return vec3<f32>(q, select(0.0, 1.0, hit));
}

fn triangleIndex(id: vec3<u32>, groups: vec3<u32>) -> u32 {
    return id.x + id.y * groups.x * WorkgroupSizeX;
}
`;

const countWgsl = /* wgsl */ `
${common}

@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = triangleIndex(id, groups);
    let T = u32(uParams.uTriangles);
    if (t >= T) {
        return;
    }
    let k = triangleCut(t);
    for (var m = 0u; m < u32(uParams.uMembers); m++) {
        var n = 0u;
        if (k.ok) {
            for (var l = memberStart[m]; l < memberStart[m + 1u]; l++) {
                let h = lipids[l].xy;
                let r = imageRange(k, h);
                for (var i = r.x; i <= r.y; i++) {
                    for (var j = r.z; j <= r.w; j++) {
                        n += u32(inside(k, h, i, j).z);
                    }
                }
            }
        }
        counts[m * T + t] = n;
    }
}
`;

const writeWgsl = /* wgsl */ `
${common}

@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = triangleIndex(id, groups);
    let T = u32(uParams.uTriangles);
    if (t >= T) {
        return;
    }
    let k = triangleCut(t);
    if (!k.ok) {
        return;
    }
    let m = u32(uParams.uMember);
    var slot = bases[m * T + t];
    let end = u32(uParams.uCount);
    for (var l = memberStart[m]; l < memberStart[m + 1u]; l++) {
        let h = lipids[l].xy;
        let r = imageRange(k, h);
        for (var i = r.x; i <= r.y; i++) {
            for (var j = r.z; j <= r.w; j++) {
                let q = inside(k, h, i, j);
                if (q.z == 0.0 || slot >= end) {
                    continue;
                }
                // Rz(Δ − θ) in the triangle's frame (\`hitAffine\`)
                let dc = lipids[l].z;
                let ds = lipids[l].w;
                let c = dc * k.rot.x + ds * k.rot.y;
                let s = ds * k.rot.x - dc * k.rot.y;
                let x = c * k.e1 + s * k.e2;
                let y = -s * k.e1 + c * k.e2;
                let p = k.c + q.x * k.e1 + q.y * k.e2;
                let r0 = vec4<f32>(x.x, y.x, k.n.x, p.x);
                let r1 = vec4<f32>(x.y, y.y, k.n.y, p.y);
                let r2 = vec4<f32>(x.z, y.z, k.n.z, p.z);
                let o = (u32(uParams.uInstanceBase) + slot) * ${InstanceDataVec4s}u;
                instanceData[o] = r0;
                instanceData[o + 1u] = r1;
                instanceData[o + 2u] = r2;
                let w = (u32(uParams.uIdentityBase) + u32(uParams.uInstanceBase) + slot) * 3u;
                transforms[w] = r0;
                transforms[w + 1u] = r1;
                transforms[w + 2u] = r2;
                slot += 1u;
            }
        }
    }
}
`;

export const LipidCutCountKernel = KernelCode('lipid-cut-count', [64], { wgsl: countWgsl });
export const LipidCutWriteKernel = KernelCode('lipid-cut-write', [64], { wgsl: writeWgsl });

const Uniforms = {
  uSeed: UniformSpec('i'),
  uBoxX: UniformSpec('f'),
  uBoxY: UniformSpec('f'),
  uTriangles: UniformSpec('i'),
  uMembers: UniformSpec('i'),
};
const Inputs = {
  positions: StorageBufferSpec('f32', 'read'),
  indices: StorageBufferSpec('u32', 'read'),
  memberStart: StorageBufferSpec('u32', 'read'),
  lipids: StorageBufferSpec('vec4<f32>', 'read'),
};
export const LipidCutCountSchema = { ...Uniforms, ...Inputs, counts: StorageBufferSpec('u32', 'read-write') };
export const LipidCutWriteSchema = {
  ...Uniforms,
  uMember: UniformSpec('i'),
  uCount: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  uIdentityBase: UniformSpec('i'),
  ...Inputs,
  bases: StorageBufferSpec('u32', 'read'),
  instanceData: StorageBufferSpec('vec4<f32>', 'read-write'),
  transforms: StorageBufferSpec('vec4<f32>', 'read-write'),
};

/** A leaflet cut on the GPU: each member's instance count (read back once), a writer a member */
export interface LipidCutter {
  readonly totals: Uint32Array;
  writer: (m: number) => GpuInstanceWriter;
  destroy: () => void;
}

/**
 * The mesh and the table uploaded, the count pass run and read back, the bases uploaded: then a writer per member. Byte
 * cost: 12 B a vertex and a triangle, 16 B a patch lipid, 8 B a (member, triangle) (its count and first instance)
 */
export async function createLipidCutter(
  compute: ComputeContext,
  flush: () => void,
  table: CutterTable,
  positions: Float32Array,
  indices: Uint32Array,
  seed: number,
): Promise<LipidCutter> {
  const buffers: StorageBuffer[] = [];
  const buffer = (data: ArrayBufferView & { byteLength: number }, label: string) => {
    const b = compute.createBuffer(Math.max(16, data.byteLength), label);
    b.write(data);
    buffers.push(b);
    return b;
  };
  const T = indices.length / 3;
  const M = table.members.length;
  const uniforms = {
    uSeed: ValueCell.create(seed | 0),
    uBoxX: ValueCell.create(table.box[0]),
    uBoxY: ValueCell.create(table.box[1]),
    uTriangles: ValueCell.create(T),
    uMembers: ValueCell.create(M),
  };
  const inputs = {
    positions: ValueCell.create(buffer(positions, 'lipid cut: positions')),
    indices: ValueCell.create(buffer(indices, 'lipid cut: indices')),
    memberStart: ValueCell.create(buffer(table.memberStart, 'lipid cut: members')),
    lipids: ValueCell.create(buffer(table.lipids, 'lipid cut: lipids')),
  };
  const countBuffer = compute.createBuffer(Math.max(16, M * T * 4), 'lipid cut: counts');
  const countKernel = compute.createKernel(LipidCutCountKernel, LipidCutCountSchema, {
    ...uniforms,
    ...inputs,
    counts: ValueCell.create(countBuffer),
  });
  compute.beginComputePass({ label: 'lipid cut: count' });
  countKernel.dispatch(...workgroupRows(T, 64, compute.maxWorkgroupsPerDimension));
  compute.endComputePass();
  flush();
  const counts = new Uint32Array(await countBuffer.readAsync(0, M * T * 4));
  countKernel.destroy();
  countBuffer.destroy();
  const { bases, totals } = cutterBases(counts, M);
  const values = {
    ...uniforms,
    uMember: ValueCell.create(0),
    uCount: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    uIdentityBase: ValueCell.create(0),
    ...inputs,
    bases: ValueCell.create(buffer(bases, 'lipid cut: bases')),
    instanceData: ValueCell.create(inputs.positions.ref.value),
    transforms: ValueCell.create(inputs.positions.ref.value),
  };
  let kernel: ComputeKernel | undefined;
  const write = (m: number, target: GpuInstanceTarget) => {
    const count = Math.min(target.count, totals[m]);
    if (count === 0) return;
    ValueCell.update(values.uMember, m);
    ValueCell.update(values.uCount, count);
    ValueCell.update(values.uInstanceBase, target.instanceBase);
    ValueCell.update(values.uIdentityBase, target.identityBase);
    ValueCell.updateIfChanged(values.instanceData, target.instanceData);
    ValueCell.updateIfChanged(values.transforms, target.transforms);
    kernel ??= compute.createKernel(LipidCutWriteKernel, LipidCutWriteSchema, values);
    compute.beginComputePass({ label: 'lipid cut: write' });
    kernel.dispatch(...workgroupRows(T, 64, compute.maxWorkgroupsPerDimension));
    compute.endComputePass();
  };
  return {
    totals,
    writer: (m) => (_compute, target) => write(m, target),
    destroy: () => {
      kernel?.destroy();
      for (const b of buffers) b.destroy();
    },
  };
}
