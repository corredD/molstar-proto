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
import { getDispatchSize } from '@molstar/graphics/gl/compute/prefix-sum';
import { UniformSpec } from '@molstar/graphics/gl/renderable/schema';
import {
  DeadInstanceTranslation,
  type GpuInstanceTarget,
  type GpuInstanceWriter,
  MergedCullerLimits,
} from '@molstar/graphics/gl/renderable/merged-culler';
import { CellKinds, cellSide, type CutterRegions, type CutterTable, regionKey } from './cutter.js';
import { type LipidSelection, WholeTriangle } from './procedural.js';

// The cutter on the GPU (`cutter.ts`, its TypeScript reference): one thread a triangle (its region's plane, spin and
// offset read from the CPU's region table; its cells' from the cells' table by the same hash), two passes. The count pass
// writes each (member, triangle)'s hits; the CPU reads them back once, sums them (the merged layout needs each member's
// instance count before any draw: `gpuInstances`) and uploads each (member, triangle)'s first instance; each member's
// writer then runs the write pass, its hits' affine rows into the merged culler's buffers. Deterministic (no atomics).

const common = /* wgsl */ `
const CellKinds = ${CellKinds}u;

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
    region: u32,
    key: u32,
    pmin: vec2<f32>,
    pmax: vec2<f32>,
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
    k.region = regionOf[t];
    // its key in the cells' hash, after the triangles' regions (\`regionKey\`: a part's, the whole mesh's index)
    k.key = regionOf[u32(uParams.uKeys) + k.region];
    let r = k.region * 4u;
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
    // the corners' bounds in the patch's plane: p = off + Rz(θ) q
    let p0 = toPatch(k, k.c0);
    let p1 = toPatch(k, k.c1);
    let p2 = toPatch(k, k.c2);
    k.pmin = min(p0, min(p1, p2));
    k.pmax = max(p0, max(p1, p2));
    return k;
}

fn toPatch(k: Cut, q: vec2<f32>) -> vec2<f32> {
    return k.off + vec2<f32>(k.rot.x * q.x - k.rot.y * q.y, k.rot.y * q.x + k.rot.x * q.y);
}

fn hashU32(x0: u32) -> u32 {
    var x = x0 ^ (x0 >> 16u);
    x = x * 0x7feb352du;
    x = x ^ (x >> 15u);
    x = x * 0x846ca68bu;
    return x ^ (x >> 16u);
}

/** a region's cell, its kind's spin and offset (\`eachHit\`): s = e + Rz(φ)(p − c) */
struct Cell {
    id: vec2<i32>,
    c: vec2<f32>,
    e: vec2<f32>,
    rot: vec2<f32>,
    /** the cell's part of the triangle's bounds: its center in the patch, its half diagonal */
    s: vec2<f32>,
    radius: f32,
    /** its hits' turn: the region's spin plus the cell's */
    turn: vec2<f32>,
}

fn cellAt(k: Cut, cx: i32, cy: i32) -> Cell {
    var c: Cell;
    let side = uParams.uCell;
    c.id = vec2<i32>(cx, cy);
    let kind = hashU32(k.key ^ hashU32(bitcast<u32>(cx) ^ hashU32(bitcast<u32>(cy)))) & (CellKinds - 1u);
    let g = regions[u32(uParams.uCells) + kind];
    c.e = vec2<f32>(g.x * uParams.uBoxX, g.y * uParams.uBoxY);
    c.rot = g.zw;
    c.c = (vec2<f32>(f32(cx), f32(cy)) + 0.5) * side;
    let lo = max(vec2<f32>(f32(cx), f32(cy)) * side, k.pmin);
    let hi = min(vec2<f32>(f32(cx + 1), f32(cy + 1)) * side, k.pmax);
    let r = (lo + hi) / 2.0 - c.c;
    c.s = c.e + vec2<f32>(c.rot.x * r.x - c.rot.y * r.y, c.rot.y * r.x + c.rot.x * r.y);
    c.radius = length(hi - lo) / 2.0;
    c.turn = vec2<f32>(k.rot.x * c.rot.x - k.rot.y * c.rot.y, k.rot.y * c.rot.x + k.rot.x * c.rot.y);
    return c;
}

/** the cells a cut meets: x from .x to .y, y from .z to .w */
fn cellRange(k: Cut) -> vec4<i32> {
    let side = uParams.uCell;
    return vec4<i32>(
        i32(floor(k.pmin.x / side)),
        i32(floor(k.pmax.x / side)),
        i32(floor(k.pmin.y / side)),
        i32(floor(k.pmax.y / side)),
    );
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

/** the images of a lipid's head that may fall in cell c of cut k */
fn imageRange(c: Cell, h: vec2<f32>) -> vec4<i32> {
    let bx = uParams.uBoxX;
    let by = uParams.uBoxY;
    return vec4<i32>(
        i32(ceil((c.s.x - c.radius - h.x) / bx)),
        i32(floor((c.s.x + c.radius - h.x) / bx)),
        i32(ceil((c.s.y - c.radius - h.y) / by)),
        i32(floor((c.s.y + c.radius - h.y) / by)),
    );
}

fn inside(k: Cut, c: Cell, h: vec2<f32>, i: i32, j: i32) -> vec3<f32> {
    // patch → the cell's point p = c + Rz(−φ)(s − e), kept if in the cell; → region q = Rz(−θ)(p − off)
    let d = vec2<f32>(h.x + f32(i) * uParams.uBoxX - c.e.x, h.y + f32(j) * uParams.uBoxY - c.e.y);
    let side = uParams.uCell;
    let lc = vec2<f32>(side / 2.0) + vec2<f32>(c.rot.x * d.x + c.rot.y * d.y, -c.rot.y * d.x + c.rot.x * d.y);
    if (!(lc.x >= 0.0 && lc.x < side && lc.y >= 0.0 && lc.y < side)) {
        return vec3<f32>(0.0);
    }
    // inside the cell: its point (the cell's frame, as \`kindCounts\` tests it) and whether the triangle owns it (z: 1, else 2)
    let p = vec2<f32>(c.id) * side + lc - k.off;
    let q = vec2<f32>(k.rot.x * p.x + k.rot.y * p.y, -k.rot.y * p.x + k.rot.x * p.y);
    let hit = edgeSide(k, k.c0, k.ids.x, k.c1, k.ids.y, q)
        && edgeSide(k, k.c1, k.ids.y, k.c2, k.ids.z, q)
        && edgeSide(k, k.c2, k.ids.z, k.c0, k.ids.x, q);
    return vec3<f32>(q, select(2.0, 1.0, hit));
}

/** a whole cell (cx, cy) of cut k: its kind's spin and offset, the cell's whole square (round 5: a cell a unit) */
fn wholeCellAt(k: Cut, cx: i32, cy: i32) -> Cell {
    var c = cellAt(k, cx, cy);
    c.s = c.e;
    c.radius = uParams.uCell * 0.70710678;
    return c;
}

fn cellKind(k: Cut, cx: i32, cy: i32) -> u32 {
    return hashU32(k.key ^ hashU32(bitcast<u32>(cx) ^ hashU32(bitcast<u32>(cy)))) & (CellKinds - 1u);
}

fn triangleIndex(id: vec3<u32>, groups: vec3<u32>) -> u32 {
    return id.x + id.y * groups.x * WorkgroupSizeX;
}
`;

const countWgsl = /* wgsl */ `
${common}

@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    // the triangles cut whole (\`wholeTriangles\`), the w-th of W
    let w = triangleIndex(id, groups);
    let T = u32(uParams.uTriangles);
    if (w >= T) {
        return;
    }
    let k = triangleCut(whole[w]);
    for (var m = 0u; m < u32(uParams.uMembers); m++) {
        var n = 0u;
        if (k.ok) {
            let cr = cellRange(k);
            for (var cx = cr.x; cx <= cr.y; cx++) {
                for (var cy = cr.z; cy <= cr.w; cy++) {
                    let c = cellAt(k, cx, cy);
                    for (var l = memberStart[m]; l < memberStart[m + 1u]; l++) {
                        let h = lipids[l].xy;
                        let r = imageRange(c, h);
                        for (var i = r.x; i <= r.y; i++) {
                            for (var j = r.z; j <= r.w; j++) {
                                n += u32(inside(k, c, h, i, j).z == 1.0);
                            }
                        }
                    }
                }
            }
        }
        counts[m * T + w] = n;
    }
}
`;

const writeWgsl = /* wgsl */ `
${common}

const WholeTriangle = ${WholeTriangle};
const DeadRow = vec4<f32>(0.0, 0.0, 0.0, ${DeadInstanceTranslation.toExponential().replace('+', '')});

fn writeRows(slot: u32, r0: vec4<f32>, r1: vec4<f32>, r2: vec4<f32>) {
    // the culler's \`CulledData\`: three vec4s an instance from 0
    let o = (u32(uParams.uInstanceBase) + slot) * 3u;
    data[o] = r0;
    data[o + 1u] = r1;
    data[o + 2u] = r2;
}

/** a hit's rows: Rz(Δ − θ − φ) in the triangle's plane, the head lifted onto it along the region's normal (\`hitAffine\`) */
fn writeHit(slot: u32, k: Cut, cell: Cell, l: u32, q: vec2<f32>) {
    let dc = lipids[l].z;
    let ds = lipids[l].w;
    let c = dc * cell.turn.x + ds * cell.turn.y;
    let s = ds * cell.turn.x - dc * cell.turn.y;
    let x = c * k.t1 + s * k.t2;
    let y = -s * k.t1 + c * k.t2;
    let w0 = k.o + q.x * k.e1 + q.y * k.e2;
    let p = w0 + (dot(k.a - w0, k.n) / k.dn) * k.rn;
    writeRows(slot, vec4<f32>(x.x, y.x, k.n.x, p.x), vec4<f32>(x.y, y.y, k.n.y, p.y), vec4<f32>(x.z, y.z, k.n.z, p.z));
}

@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    // the selected units of a view (\`procedural.ts\`): the i-th of its part (round 10: the cut band's from 0, the
    // rest's from \`bandCount\`), its first slot the member's base of it
    let i = triangleIndex(id, groups);
    if (i >= u32(uParams.uSelected)) {
        return;
    }
    let u = i + u32(uParams.uUnitStart);
    let t = u32(units[u * 3u]);
    let ucx = units[u * 3u + 1u];
    let ucy = units[u * 3u + 2u];
    let k = triangleCut(t);
    let m = u32(uParams.uMember);
    var slot = bases[m * u32(uParams.uMaxUnits) + u];
    let end = u32(uParams.uCount);
    if (ucx != WholeTriangle) {
        // a cell: its kind's slots, the lipids the triangle does not own (or f32 misses) dead
        let cell = wholeCellAt(k, ucx, ucy);
        let n = memberStart[u32(uParams.uMembers) + 1u + cellKind(k, ucx, ucy) * u32(uParams.uMembers) + m];
        var j = 0u;
        if (k.ok) {
            for (var l = memberStart[m]; l < memberStart[m + 1u]; l++) {
                let h = lipids[l].xy;
                let r = imageRange(cell, h);
                for (var ii = r.x; ii <= r.y; ii++) {
                    for (var jj = r.z; jj <= r.w; jj++) {
                        let q = inside(k, cell, h, ii, jj);
                        if (q.z == 0.0 || j >= n || slot + j >= end) {
                            continue;
                        }
                        if (q.z == 1.0) {
                            writeHit(slot + j, k, cell, l, q.xy);
                        } else {
                            writeRows(slot + j, DeadRow, DeadRow, DeadRow);
                        }
                        j += 1u;
                    }
                }
            }
        }
        for (; j < n && slot + j < end; j++) {
            writeRows(slot + j, DeadRow, DeadRow, DeadRow);
        }
        return;
    }
    if (!k.ok) {
        return;
    }
    let cr = cellRange(k);
    for (var cx = cr.x; cx <= cr.y; cx++) {
        for (var cy = cr.z; cy <= cr.w; cy++) {
            let cell = cellAt(k, cx, cy);
            for (var l = memberStart[m]; l < memberStart[m + 1u]; l++) {
                let h = lipids[l].xy;
                let r = imageRange(cell, h);
                for (var ii = r.x; ii <= r.y; ii++) {
                    for (var jj = r.z; jj <= r.w; jj++) {
                        let q = inside(k, cell, h, ii, jj);
                        if (q.z != 1.0 || slot >= end) {
                            continue;
                        }
                        writeHit(slot, k, cell, l, q.xy);
                        slot += 1u;
                    }
                }
            }
        }
    }
}
`;

// a pool's dead slots (the identity region draws every slot): zero rows but a translation past any far plane (`DeadInstanceTranslation`)
const deadWgsl = /* wgsl */ `
@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = id.x + id.y * groups.x * WorkgroupSizeX;
    if (i >= u32(uParams.uDeadCount)) {
        return;
    }
    let w = (u32(uParams.uInstanceBase) + u32(uParams.uDeadStart) + i) * 3u;
    let r = vec4<f32>(0.0, 0.0, 0.0, ${DeadInstanceTranslation.toExponential().replace('+', '')});
    data[w] = r;
    data[w + 1u] = r;
    data[w + 2u] = r;
}
`;

/**
 * The workgroups of 64 for `n` threads, in rows past the per-dimension limit (the culler's, `MergedCullerLimits`), as
 * the kernels linearize their id (\`id.x + id.y * groups.x * WorkgroupSizeX\`)
 */
export function dispatchRows(n: number): [x: number, y: number] {
  const { x, y } = getDispatchSize(Math.ceil(n / 64), MergedCullerLimits.maxWorkgroupsPerDimension);
  return [x, y];
}

export const LipidCutCountKernel = KernelCode('lipid-cut-count', [64], { wgsl: countWgsl });
export const LipidDeadKernel = KernelCode('lipid-dead-slots', [64], { wgsl: deadWgsl });
export const LipidDeadSchema = {
  uDeadStart: UniformSpec('i'),
  uDeadCount: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  data: StorageBufferSpec('vec4<f32>', 'read-write'),
};
export const LipidCutWriteKernel = KernelCode('lipid-cut-write', [64], { wgsl: writeWgsl });

const Uniforms = {
  uBoxX: UniformSpec('f'),
  uBoxY: UniformSpec('f'),
  uCell: UniformSpec('f'),
  uCells: UniformSpec('i'),
  uKeys: UniformSpec('i'),
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
export const LipidCutCountSchema = {
  ...Uniforms,
  ...Inputs,
  whole: StorageBufferSpec('u32', 'read'),
  counts: StorageBufferSpec('u32', 'read-write'),
};
export const LipidCutWriteSchema = {
  ...Uniforms,
  uMember: UniformSpec('i'),
  uCount: UniformSpec('i'),
  uSelected: UniformSpec('i'),
  uUnitStart: UniformSpec('i'),
  uMaxUnits: UniformSpec('i'),
  uInstanceBase: UniformSpec('i'),
  ...Inputs,
  bases: StorageBufferSpec('u32', 'read'),
  units: StorageBufferSpec('i32', 'read'),
  data: StorageBufferSpec('vec4<f32>', 'read-write'),
};

function regionsAndKeys(regions: CutterRegions) {
  const T = regions.regionOf.length;
  const all = new Uint32Array(T + regions.count);
  all.set(regions.regionOf);
  for (let r = 0; r < regions.count; ++r) all[T + r] = regionKey(regions, r);
  return all;
}

function regionsAndCells(regions: CutterRegions) {
  const all = new Float32Array(regions.table.length + regions.cells.length);
  all.set(regions.table);
  all.set(regions.cells, regions.table.length);
  return all;
}

/**
 * A leaflet cut on the GPU: its whole triangles' counts per member (`m * W + w`, the count pass read back once at the
 * wrap; none for a mesh of large triangles), a writer a member over a selection's units
 */
/** A part of a selection (round 10): its cut band's units (their lipids' levels kept), or the rest */
export type LipidSelectionPart = 'rest' | 'band';

export interface LipidCutter {
  readonly counts: Uint32Array;
  /** member `m`'s writer of a part of the selection (round 10): the cut band's units, or the rest */
  writer: (m: number, selection: LipidSelection, part?: LipidSelectionPart) => GpuInstanceWriter;
  destroy: () => void;
}

export async function createLipidCutter(
  compute: ComputeContext,
  flush: () => void,
  table: CutterTable,
  positions: Float32Array,
  indices: Uint32Array,
  regions: CutterRegions,
  whole: Uint32Array,
  kinds: Uint32Array,
): Promise<LipidCutter> {
  const T = indices.length / 3;
  const W = whole.length;
  const M = table.members.length;
  // a count a member and whole triangle, one buffer (review S4: past the device's size, a WebGPU error)
  if (M * W * 4 > compute.maxStorageBufferSize) {
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
    uCell: ValueCell.create(cellSide(table.box)),
    uCells: ValueCell.create(regions.count * 4),
    uKeys: ValueCell.create(T),
    uTriangles: ValueCell.create(W),
    uMembers: ValueCell.create(M),
  };
  // the members' starts, then the kinds' counts (`kindCounts`), one buffer (the write pass is at the stage's 10)
  const membersAndKinds = new Uint32Array(M + 1 + kinds.length);
  membersAndKinds.set(table.memberStart);
  membersAndKinds.set(kinds, M + 1);
  const inputs = {
    positions: ValueCell.create(buffer(positions, 'lipid cut: positions')),
    indices: ValueCell.create(buffer(indices, 'lipid cut: indices')),
    // each triangle's region, then each region's key in the cells' hash (one buffer: the write pass is at the stage's
    // limit; review X1)
    regionOf: ValueCell.create(buffer(regionsAndKeys(regions), 'lipid cut: region of each triangle, their keys')),
    // the cells' kinds after the regions, one buffer
    regions: ValueCell.create(buffer(regionsAndCells(regions), 'lipid cut: regions and cells')),
    memberStart: ValueCell.create(buffer(membersAndKinds, 'lipid cut: members and kinds')),
    lipids: ValueCell.create(buffer(table.lipids, 'lipid cut: lipids')),
  };
  let counts = new Uint32Array(0);
  if (W > 0) {
    const countBuffer = compute.createBuffer(Math.max(16, M * W * 4), 'lipid cut: counts');
    const wholeBuffer = compute.createBuffer(Math.max(16, W * 4), 'lipid cut: whole triangles');
    wholeBuffer.write(whole);
    const countKernel = compute.createKernel(LipidCutCountKernel, LipidCutCountSchema, {
      ...uniforms,
      ...inputs,
      whole: ValueCell.create(wholeBuffer),
      counts: ValueCell.create(countBuffer),
    });
    compute.beginComputePass({ label: 'lipid cut: count' });
    countKernel.dispatch(...dispatchRows(W));
    compute.endComputePass();
    flush();
    try {
      counts = new Uint32Array(await countBuffer.readAsync(0, M * W * 4));
    } catch (e) {
      // nothing left on the GPU by a failed readback (review N2)
      for (const b of buffers) b.destroy();
      throw e;
    } finally {
      countKernel.destroy();
      countBuffer.destroy();
      wholeBuffer.destroy();
    }
  }
  /** the selection's units and bases on the GPU, grown to its largest */
  let unitBuffer: StorageBuffer | undefined;
  let baseBuffer: StorageBuffer | undefined;
  const values = {
    ...uniforms,
    uTriangles: ValueCell.create(T),
    uMember: ValueCell.create(0),
    uCount: ValueCell.create(0),
    uSelected: ValueCell.create(0),
    uUnitStart: ValueCell.create(0),
    uMaxUnits: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    ...inputs,
    bases: ValueCell.create(inputs.positions.ref.value),
    units: ValueCell.create(inputs.positions.ref.value),
    data: ValueCell.create(inputs.positions.ref.value),
  };
  /** what `bases` and `units` hold: a selection's version (two variables, not an object a new selection: review S3) */
  let uploadedSelection: LipidSelection | undefined;
  let uploadedVersion = -1;
  const upload = (selection: LipidSelection) => {
    const { version, count: n, maxUnits } = selection;
    if (uploadedSelection === selection && uploadedVersion === version) return;
    uploadedSelection = selection;
    uploadedVersion = version;
    if (n === 0) return;
    if (!unitBuffer || unitBuffer.byteLength < maxUnits * 12) {
      unitBuffer?.destroy();
      baseBuffer?.destroy();
      unitBuffer = compute.createBuffer(maxUnits * 12, 'lipid cut: units');
      baseBuffer = compute.createBuffer(M * maxUnits * 4, 'lipid cut: bases');
      ValueCell.update(values.units, unitBuffer);
      ValueCell.update(values.bases, baseBuffer);
    }
    ValueCell.update(values.uMaxUnits, maxUnits);
    // a view of each array a new selection (the buffer's write takes no length): M + 1 small objects a changed view
    unitBuffer.write(selection.units.subarray(0, n * 3));
    for (let m = 0; m < M; ++m)
      baseBuffer!.write(selection.bases.subarray(m * maxUnits, m * maxUnits + n), m * maxUnits * 4);
  };
  let kernel: ComputeKernel | undefined;
  const dead = {
    uDeadStart: ValueCell.create(0),
    uDeadCount: ValueCell.create(0),
    uInstanceBase: ValueCell.create(0),
    data: ValueCell.create(inputs.positions.ref.value),
  };
  let deadKernel: ComputeKernel | undefined;
  /**
   * per member and part (`m * 2`: the rest, `+ 1` the band) what its rows hold: its buffer, base, the CPU's writes and
   * live slots (the rest dead rows)
   */
  const cleared = Array.from({ length: M * 2 }, () => ({ buffer: -1, base: -1, cpuWrites: -1, live: 0 }));
  const write = (m: number, target: GpuInstanceTarget, selection: LipidSelection, band: boolean) => {
    upload(selection);
    // both parts share the upload: each reads its own range of the units (round 10)
    const count = Math.min(target.count, band ? selection.bandLive[m] : selection.live[m]);
    // the slots past the live ones: zeros where views culled on the CPU read them; only those live before (review S3:
    // the whole rest a frame), all of them in a new buffer or place or after the CPU wrote its placeholders
    const last = cleared[m * 2 + (band ? 1 : 0)];
    const fresh =
      last.buffer !== target.data.id || last.base !== target.instanceBase || last.cpuWrites !== target.cpuWrites;
    const end = fresh ? target.count : Math.min(target.count, last.live);
    if (count < end) {
      ValueCell.update(dead.uDeadStart, count);
      ValueCell.update(dead.uDeadCount, end - count);
      ValueCell.update(dead.uInstanceBase, target.instanceBase);
      ValueCell.updateIfChanged(dead.data, target.data);
      deadKernel ??= compute.createKernel(LipidDeadKernel, LipidDeadSchema, dead);
      compute.beginComputePass({ label: 'lipid cut: dead slots' });
      deadKernel.dispatch(...dispatchRows(end - count));
      compute.endComputePass();
    }
    last.buffer = target.data.id;
    last.base = target.instanceBase;
    last.cpuWrites = target.cpuWrites;
    last.live = count;
    if (count === 0) return 0;
    const n = band ? selection.bandCount : selection.count - selection.bandCount;
    ValueCell.update(values.uMember, m);
    ValueCell.update(values.uCount, count);
    ValueCell.update(values.uSelected, n);
    ValueCell.update(values.uUnitStart, band ? 0 : selection.bandCount);
    ValueCell.update(values.uInstanceBase, target.instanceBase);
    ValueCell.updateIfChanged(values.data, target.data);
    kernel ??= compute.createKernel(LipidCutWriteKernel, LipidCutWriteSchema, values);
    compute.beginComputePass({ label: 'lipid cut: write' });
    kernel.dispatch(...dispatchRows(n));
    compute.endComputePass();
    return count;
  };
  return {
    counts,
    writer:
      (m, selection, part = 'rest') =>
      (_compute, target) =>
        write(m, target, selection, part === 'band'),
    destroy: () => {
      kernel?.destroy();
      deadKernel?.destroy();
      unitBuffer?.destroy();
      baseBuffer?.destroy();
      for (const b of buffers) b.destroy();
    },
  };
}
