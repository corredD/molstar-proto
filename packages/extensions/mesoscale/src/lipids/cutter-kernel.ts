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
import {
  DeadInstanceTranslation,
  type GpuInstanceTarget,
  type GpuInstanceWriter,
} from '@molstar/graphics/gl/renderable/merged-culler';
import { InstanceDataVec4s } from '@molstar/graphics/gl/renderable/merged';
import { cutterBases, type CutterRegions, type CutterTable } from './cutter.js';
import type { LipidSelection } from './procedural.js';

// The cutter on the GPU (`cutter.ts`, its TypeScript reference): one thread a triangle (its region's plane, spin and
// offset read from the CPU's region table), two passes. The count pass
// writes each (member, triangle)'s hits; the CPU reads them back once, sums them (the merged layout needs each member's
// instance count before any draw: `gpuInstances`) and uploads each (member, triangle)'s first instance; each member's
// writer then runs the write pass, its hits' affine rows into the merged culler's buffers. Deterministic (no atomics).

const common = /* wgsl */ `
fn position(i: u32) -> vec3<f32> {
    return vec3<f32>(positions[i * 3u], positions[i * 3u + 1u], positions[i * 3u + 2u]);
}

struct Cut {
    o: vec3<f32>,
    e1: vec3<f32>,
    e2: vec3<f32>,
    rn: vec3<f32>,
    a: vec3<f32>,
    n: vec3<f32>,
    dn: f32,
    t1: vec3<f32>,
    t2: vec3<f32>,
    c0: vec2<f32>,
    c1: vec2<f32>,
    c2: vec2<f32>,
    ids: vec3<u32>,
    orient: f32,
    p: vec2<f32>,
    radius: f32,
    rot: vec2<f32>,
    off: vec2<f32>,
    ok: bool,
}

/** a vertex in the region's frame: the same expression in every triangle that has it (\`triangleCut\`) */
fn project(k: Cut, i: u32) -> vec2<f32> {
    let d = position(i) - k.o;
    return vec2<f32>(dot(d, k.e1), dot(d, k.e2));
}

fn triangleCut(t: u32) -> Cut {
    var k: Cut;
    let r = regionOf[t] * 4u;
    let g0 = regions[r];
    let g1 = regions[r + 1u];
    let g2 = regions[r + 2u];
    let g3 = regions[r + 3u];
    k.o = g0.xyz;
    k.e1 = g1.xyz;
    k.e2 = g2.xyz;
    k.rn = g3.xyz;
    k.off = vec2<f32>(g0.w * uParams.uBoxX, g1.w * uParams.uBoxY);
    k.rot = vec2<f32>(g2.w, g3.w);
    let ia = indices[t * 3u];
    let ib = indices[t * 3u + 1u];
    let ic = indices[t * 3u + 2u];
    let pa = position(ia);
    let nn = cross(position(ib) - pa, position(ic) - pa);
    k.ok = dot(nn, nn) > 0.0;
    if (!k.ok) {
        return k;
    }
    k.n = normalize(nn);
    k.dn = dot(k.n, k.rn);
    k.ok = k.dn >= 0.5;
    if (!k.ok) {
        return k;
    }
    k.a = pa;
    k.t1 = normalize(k.e1 - dot(k.e1, k.n) * k.n);
    k.t2 = cross(k.n, k.t1);
    k.ids = vec3<u32>(ia, ib, ic);
    k.c0 = project(k, ia);
    k.c1 = project(k, ib);
    k.c2 = project(k, ic);
    let area2 = (k.c1.x - k.c0.x) * (k.c2.y - k.c0.y) - (k.c1.y - k.c0.y) * (k.c2.x - k.c0.x);
    k.ok = area2 != 0.0;
    k.orient = select(-1.0, 1.0, area2 > 0.0);
    let q = (k.c0 + k.c1 + k.c2) / 3.0;
    k.radius = max(length(k.c0 - q), max(length(k.c1 - q), length(k.c2 - q)));
    k.p = k.off + vec2<f32>(k.rot.x * q.x - k.rot.y * q.y, k.rot.y * q.x + k.rot.x * q.y);
    return k;
}

/** edge from the lower vertex id to the higher, its sign the triangle's (\`owns\`) */
fn edgeSide(k: Cut, a: vec2<f32>, ia: u32, b: vec2<f32>, ib: u32, q: vec2<f32>) -> bool {
    let forward = ia < ib;
    let lo = select(b, a, forward);
    let hi = select(a, b, forward);
    let e = (hi.x - lo.x) * (q.y - lo.y) - (hi.y - lo.y) * (q.x - lo.x);
    let sign = select(-k.orient, k.orient, forward);
    let v = sign * e;
    return !(v < 0.0 || (v == 0.0 && sign < 0.0));
}

/** the images of a lipid's head that may fall in cut k */
fn imageRange(k: Cut, h: vec2<f32>) -> vec4<i32> {
    let bx = uParams.uBoxX;
    let by = uParams.uBoxY;
    return vec4<i32>(
        i32(ceil((k.p.x - k.radius - h.x) / bx)),
        i32(floor((k.p.x + k.radius - h.x) / bx)),
        i32(ceil((k.p.y - k.radius - h.y) / by)),
        i32(floor((k.p.y + k.radius - h.y) / by)),
    );
}

fn inside(k: Cut, h: vec2<f32>, i: i32, j: i32) -> vec3<f32> {
    let p = vec2<f32>(h.x + f32(i) * uParams.uBoxX - k.off.x, h.y + f32(j) * uParams.uBoxY - k.off.y);
    let q = vec2<f32>(k.rot.x * p.x + k.rot.y * p.y, -k.rot.y * p.x + k.rot.x * p.y);
    let hit = edgeSide(k, k.c0, k.ids.x, k.c1, k.ids.y, q)
        && edgeSide(k, k.c1, k.ids.y, k.c2, k.ids.z, q)
        && edgeSide(k, k.c2, k.ids.z, k.c0, k.ids.x, q);
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
    // the selected triangles of a view (\`procedural.ts\`): the i-th, its first slot the member's base of it
    let i = triangleIndex(id, groups);
    if (i >= u32(uParams.uSelected)) {
        return;
    }
    let t = selected[i];
    let T = u32(uParams.uTriangles);
    let k = triangleCut(t);
    if (!k.ok) {
        return;
    }
    let m = u32(uParams.uMember);
    var slot = bases[m * T + i];
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
                // Rz(Δ − θ) in the triangle's plane, the head lifted onto it along the region's normal (\`hitAffine\`)
                let dc = lipids[l].z;
                let ds = lipids[l].w;
                let c = dc * k.rot.x + ds * k.rot.y;
                let s = ds * k.rot.x - dc * k.rot.y;
                let x = c * k.t1 + s * k.t2;
                let y = -s * k.t1 + c * k.t2;
                let w0 = k.o + q.x * k.e1 + q.y * k.e2;
                let p = w0 + (dot(k.a - w0, k.n) / k.dn) * k.rn;
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

// a pool's dead slots in the identity region: zero rows but a translation past any far plane (`DeadInstanceTranslation`)
const deadWgsl = /* wgsl */ `
@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = id.x + id.y * groups.x * WorkgroupSizeX;
    if (i >= u32(uParams.uDeadCount)) {
        return;
    }
    let w = (u32(uParams.uIdentityBase) + u32(uParams.uInstanceBase) + u32(uParams.uDeadStart) + i) * 3u;
    let r = vec4<f32>(0.0, 0.0, 0.0, ${DeadInstanceTranslation.toExponential().replace('+', '')});
    transforms[w] = r;
    transforms[w + 1u] = r;
    transforms[w + 2u] = r;
}
`;

export const LipidCutCountKernel = KernelCode('lipid-cut-count', [64], { wgsl: countWgsl });
export const LipidDeadKernel = KernelCode('lipid-dead-slots', [64], { wgsl: deadWgsl });
export const LipidDeadSchema = {
  uDeadStart: UniformSpec('i'),
  uDeadCount: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  uIdentityBase: UniformSpec('i'),
  transforms: StorageBufferSpec('vec4<f32>', 'read-write'),
};
export const LipidCutWriteKernel = KernelCode('lipid-cut-write', [64], { wgsl: writeWgsl });

const Uniforms = {
  uBoxX: UniformSpec('f'),
  uBoxY: UniformSpec('f'),
  uTriangles: UniformSpec('i'),
  uMembers: UniformSpec('i'),
};
const Inputs = {
  positions: StorageBufferSpec('f32', 'read'),
  indices: StorageBufferSpec('u32', 'read'),
  regionOf: StorageBufferSpec('u32', 'read'),
  regions: StorageBufferSpec('vec4<f32>', 'read'),
  memberStart: StorageBufferSpec('u32', 'read'),
  lipids: StorageBufferSpec('vec4<f32>', 'read'),
};
export const LipidCutCountSchema = { ...Uniforms, ...Inputs, counts: StorageBufferSpec('u32', 'read-write') };
export const LipidCutWriteSchema = {
  ...Uniforms,
  uMember: UniformSpec('i'),
  uCount: UniformSpec('i'),
  uSelected: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  uIdentityBase: UniformSpec('i'),
  ...Inputs,
  bases: StorageBufferSpec('u32', 'read'),
  selected: StorageBufferSpec('u32', 'read'),
  instanceData: StorageBufferSpec('vec4<f32>', 'read-write'),
  transforms: StorageBufferSpec('vec4<f32>', 'read-write'),
};

/** A leaflet cut on the GPU: its counts per (member, triangle) (`m * T + t`, read back once), a writer a member */
export interface LipidCutter {
  readonly counts: Uint32Array;
  readonly totals: Uint32Array;
  /**
   * member `m`'s writer: the hits of the triangles `selection` holds (a view's, `procedural.ts`; all without one), its
   * live count returned, the slots past it zeros in the identity region (views culled on the CPU draw nothing of them)
   */
  writer: (m: number, selection?: LipidSelection) => GpuInstanceWriter;
  destroy: () => void;
}

/**
 * The mesh and the table uploaded, the count pass run and read back: then a writer per member. Byte cost: 12 B a vertex
 * and a triangle, 4 B a triangle (its region; its selection), 64 B a region, 16 B a patch lipid, 4 B a (member,
 * triangle) on the GPU (a selected one's first instance) and on the CPU (its count)
 */
export async function createLipidCutter(
  compute: ComputeContext,
  flush: () => void,
  table: CutterTable,
  positions: Float32Array,
  indices: Uint32Array,
  regions: CutterRegions,
): Promise<LipidCutter> {
  const T = indices.length / 3;
  const M = table.members.length;
  // a count and a first instance a member and triangle, each one buffer (review S4: past the device's size, a WebGPU
  // error and an empty membrane)
  if (M * T * 4 > compute.maxStorageBufferSize) {
    throw new Error(
      `The cutter has too many triangles (${T.toLocaleString()}) for this GPU's buffers: remesh the mesh coarser, or wrap it with tiles.`,
    );
  }
  const buffers: StorageBuffer[] = [];
  const buffer = (data: ArrayBufferView & { byteLength: number }, label: string) => {
    const b = compute.createBuffer(Math.max(16, data.byteLength), label);
    b.write(data);
    buffers.push(b);
    return b;
  };
  const uniforms = {
    uBoxX: ValueCell.create(table.box[0]),
    uBoxY: ValueCell.create(table.box[1]),
    uTriangles: ValueCell.create(T),
    uMembers: ValueCell.create(M),
  };
  const inputs = {
    positions: ValueCell.create(buffer(positions, 'lipid cut: positions')),
    indices: ValueCell.create(buffer(indices, 'lipid cut: indices')),
    regionOf: ValueCell.create(buffer(regions.regionOf, 'lipid cut: region of each triangle')),
    regions: ValueCell.create(buffer(regions.table, 'lipid cut: regions')),
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
  let counts: Uint32Array;
  try {
    counts = new Uint32Array(await countBuffer.readAsync(0, M * T * 4));
  } catch (e) {
    // nothing left on the GPU by a failed readback (review N2)
    for (const b of buffers) b.destroy();
    throw e;
  } finally {
    countKernel.destroy();
    countBuffer.destroy();
  }
  const { bases: allBases, totals } = cutterBases(counts, M);
  const all = new Uint32Array(T);
  for (let t = 0; t < T; ++t) all[t] = t;
  const values = {
    ...uniforms,
    uMember: ValueCell.create(0),
    uCount: ValueCell.create(0),
    uSelected: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    uIdentityBase: ValueCell.create(0),
    ...inputs,
    bases: ValueCell.create(buffer(allBases, 'lipid cut: bases')),
    selected: ValueCell.create(buffer(all, 'lipid cut: selected triangles')),
    instanceData: ValueCell.create(inputs.positions.ref.value),
    transforms: ValueCell.create(inputs.positions.ref.value),
  };
  /** what `bases` and `selected` hold: all triangles (-1) or a selection's version */
  let uploaded: { selection: LipidSelection | undefined; version: number } = { selection: undefined, version: -1 };
  const upload = (selection: LipidSelection | undefined) => {
    const version = selection?.version ?? -1;
    if (uploaded.selection === selection && uploaded.version === version) return;
    uploaded = { selection, version };
    if (!selection) {
      values.bases.ref.value.write(allBases);
      values.selected.ref.value.write(all);
      return;
    }
    const n = selection.count;
    if (n === 0) return;
    values.selected.ref.value.write(selection.selected.subarray(0, n));
    for (let m = 0; m < M; ++m) values.bases.ref.value.write(selection.bases.subarray(m * T, m * T + n), m * T * 4);
  };
  let kernel: ComputeKernel | undefined;
  const dead = {
    uDeadStart: ValueCell.create(0),
    uDeadCount: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    uIdentityBase: ValueCell.create(0),
    transforms: ValueCell.create(inputs.positions.ref.value),
  };
  let deadKernel: ComputeKernel | undefined;
  /** per member what its identity region holds: its buffer, base and live slots (the rest dead rows) */
  const cleared = Array.from({ length: M }, () => ({ buffer: -1, base: -1, live: 0 }));
  const write = (m: number, target: GpuInstanceTarget, selection: LipidSelection | undefined) => {
    upload(selection);
    const count = Math.min(target.count, selection ? selection.live[m] : totals[m]);
    // the slots past the live ones: zeros where views culled on the CPU read them; only those live before (review S3:
    // the whole rest a frame), all of them in a new buffer or place
    const last = cleared[m];
    const fresh = last.buffer !== target.transforms.id || last.base !== target.identityBase + target.instanceBase;
    const end = fresh ? target.count : Math.min(target.count, last.live);
    if (count < end) {
      ValueCell.update(dead.uDeadStart, count);
      ValueCell.update(dead.uDeadCount, end - count);
      ValueCell.update(dead.uInstanceBase, target.instanceBase);
      ValueCell.update(dead.uIdentityBase, target.identityBase);
      ValueCell.updateIfChanged(dead.transforms, target.transforms);
      deadKernel ??= compute.createKernel(LipidDeadKernel, LipidDeadSchema, dead);
      compute.beginComputePass({ label: 'lipid cut: dead slots' });
      deadKernel.dispatch(...workgroupRows(end - count, 64, compute.maxWorkgroupsPerDimension));
      compute.endComputePass();
    }
    last.buffer = target.transforms.id;
    last.base = target.identityBase + target.instanceBase;
    last.live = count;
    if (count === 0) return 0;
    const n = selection ? selection.count : T;
    ValueCell.update(values.uMember, m);
    ValueCell.update(values.uCount, count);
    ValueCell.update(values.uSelected, n);
    ValueCell.update(values.uInstanceBase, target.instanceBase);
    ValueCell.update(values.uIdentityBase, target.identityBase);
    ValueCell.updateIfChanged(values.instanceData, target.instanceData);
    ValueCell.updateIfChanged(values.transforms, target.transforms);
    kernel ??= compute.createKernel(LipidCutWriteKernel, LipidCutWriteSchema, values);
    compute.beginComputePass({ label: 'lipid cut: write' });
    kernel.dispatch(...workgroupRows(n, 64, compute.maxWorkgroupsPerDimension));
    compute.endComputePass();
    return count;
  };
  return {
    counts,
    totals,
    writer: (m, selection) => (_compute, target) => write(m, target, selection),
    destroy: () => {
      kernel?.destroy();
      deadKernel?.destroy();
      for (const b of buffers) b.destroy();
    },
  };
}
