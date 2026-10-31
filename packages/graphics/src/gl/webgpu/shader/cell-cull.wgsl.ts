/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { InstanceDataVec4s } from '../../renderable/merged.js';

/**
 * The tests of a sphere (world space) both culling kernels share: against a frustum plane, and against the previous
 * frame's depth pyramid (`HiZPass.isOccluded`)
 */
const cull_tests_wgsl = /* wgsl */ `
fn outside(plane: vec4<f32>, sphere: vec4<f32>) -> bool {
    return dot(plane.xyz, sphere.xyz) + plane.w < -sphere.w;
}

// the occlusion test of \`HiZPass.isOccluded\` against the pyramid of the previous frame (depth reversed: near at 1)
fn hiZViewZ(depth: f32) -> f32 {
    let near = uParams.uHiZDepthRange.x;
    let far = uParams.uHiZDepthRange.y;
    if (uParams.uHiZProjection[2][3] == -1.0) {
        return -(near * far) / (near + (far - near) * depth);
    }
    return depth * (far - near) - far;
}

/** the screen rectangle (min x, min y, max x, max y in [0, 1]) of a sphere at \`p\` (view space) */
fn hiZProjectSphere(p: vec3<f32>, r: f32) -> vec4<f32> {
    let P = uParams.uHiZProjection;
    if (P[2][3] == -1.0) {
        // Mara and McGuire 2013, as specialized by Kapoulkine (niagara)
        let pr = p * r;
        let pzr2 = p.z * p.z - r * r;
        let vx = sqrt(p.x * p.x + pzr2);
        let minx = ((vx * p.x - pr.z) / (vx * p.z + pr.x)) * P[0][0];
        let maxx = ((vx * p.x + pr.z) / (vx * p.z - pr.x)) * P[0][0];
        let vy = sqrt(p.y * p.y + pzr2);
        let miny = ((vy * p.y - pr.z) / (vy * p.z + pr.y)) * P[1][1];
        let maxy = ((vy * p.y + pr.z) / (vy * p.z - pr.y)) * P[1][1];
        return vec4<f32>(maxx * -0.5 + 0.5, miny * 0.5 + 0.5, minx * -0.5 + 0.5, maxy * 0.5 + 0.5);
    }
    let minx = (p.x + r) * P[0][0];
    let maxx = (p.x - r) * P[0][0];
    let miny = (p.y + r) * P[1][1];
    let maxy = (p.y - r) * P[1][1];
    return vec4<f32>(maxx * 0.5 + 0.5, miny * -0.5 + 0.5, minx * 0.5 + 0.5, maxy * -0.5 + 0.5);
}

fn hiZDepth(x: i32, y: i32) -> f32 {
    return hiZViewZ(textureLoad(tHiZ, vec2<i32>(x, y), 0).r);
}

fn outsideView(sphere: vec4<f32>) -> bool {
    return outside(uParams.uPlane0, sphere) || outside(uParams.uPlane1, sphere) || outside(uParams.uPlane2, sphere) ||
        outside(uParams.uPlane3, sphere) || outside(uParams.uPlane4, sphere) || outside(uParams.uPlane5, sphere);
}

/**
 * The largest signed distance to \`plane\` (inside positive) of the part of \`sphere\` beyond \`beyond\` (its signed
 * distance \`d\` there, |d| < radius): at the sphere's point farthest along the plane's normal where that is beyond,
 * else on the circle where the sphere meets \`beyond\`
 */
fn capReach(plane: vec4<f32>, beyond: vec4<f32>, sphere: vec4<f32>, d: f32) -> f32 {
    if (all(plane == beyond)) {
        // the same plane (a still view): nothing beyond it is in view
        return -1.0;
    }
    let top = sphere.xyz + plane.xyz * sphere.w;
    if (dot(beyond.xyz, top) + beyond.w <= 0.0) {
        return dot(plane.xyz, sphere.xyz) + plane.w + sphere.w;
    }
    let center = sphere.xyz - beyond.xyz * d;
    let along = plane.xyz - beyond.xyz * dot(plane.xyz, beyond.xyz);
    return dot(plane.xyz, center) + plane.w + sqrt(max(sphere.w * sphere.w - d * d, 0.0)) * length(along);
}

/**
 * Whether a part of the sphere beyond the pyramid's frustum plane \`beyond\` (not in the pyramid) may be in the view
 * culled for: the part beyond against each of the view's planes, the whole sphere where all of it is beyond (at the
 * pyramid's own view nothing beyond its planes is)
 */
fn showsBeyond(beyond: vec4<f32>, sphere: vec4<f32>) -> bool {
    let d = dot(beyond.xyz, sphere.xyz) + beyond.w;
    if (d >= sphere.w) {
        return false;
    }
    if (d <= -sphere.w) {
        return !outsideView(sphere);
    }
    let eps = 1e-4 * sphere.w;
    return capReach(uParams.uPlane0, beyond, sphere, d) > eps && capReach(uParams.uPlane1, beyond, sphere, d) > eps &&
        capReach(uParams.uPlane2, beyond, sphere, d) > eps && capReach(uParams.uPlane3, beyond, sphere, d) > eps &&
        capReach(uParams.uPlane4, beyond, sphere, d) > eps && capReach(uParams.uPlane5, beyond, sphere, d) > eps;
}

fn occluded(sphere: vec4<f32>) -> bool {
    if (uParams.uHiZ == 0u) {
        return false;
    }
    let vp = (uParams.uHiZView * vec4<f32>(sphere.xyz, 1.0)).xyz;
    let r = sphere.w * 1.2 + 1.52;
    let z = vp.z + r;
    if (-z < uParams.uHiZDepthRange.x) {
        return false;
    }
    // what was outside the pyramid's view is not in it: not occluded where such a part is in view now (after a turn;
    // at the pyramid's own view nothing beyond its planes is)
    let padded = vec4<f32>(sphere.xyz, r);
    if (showsBeyond(uParams.uHiZPlane0, padded) || showsBeyond(uParams.uHiZPlane1, padded) ||
        showsBeyond(uParams.uHiZPlane2, padded) || showsBeyond(uParams.uHiZPlane3, padded) ||
        showsBeyond(uParams.uHiZPlane4, padded) || showsBeyond(uParams.uHiZPlane5, padded)) {
        return false;
    }
    let aabb = hiZProjectSphere(vp, r);
    let w = aabb.z - aabb.x;
    let h = aabb.w - aabb.y;
    let pr = max(w * uParams.uHiZViewport.x, h * uParams.uHiZViewport.y);
    // a level finer than the one where the rectangle is at most a texel: up to four texels per axis
    let levels = uParams.uHiZLevelCount;
    let minLevel = uParams.uHiZMinLevel;
    let lod = max(i32(ceil(log2(pr / 2.0))) - 1, minLevel);
    if (lod >= levels) {
        return false;
    }
    // the levels from \`minLevel\` side by side: level i of size 2^(levels - 1 - i)
    var offset = 0;
    for (var i = minLevel; i < lod; i++) {
        offset += 1 << u32(levels - 1 - i);
    }
    let ts = 1 << u32(levels - 1 - lod);
    // the texels the rectangle covers, clamped to the pyramid's view (what is beyond it is not in view, above)
    let x0 = max(i32(floor(aabb.x * f32(ts))), 0);
    let x1 = min(i32(floor(aabb.z * f32(ts))), ts - 1);
    let y0 = max(i32(floor(aabb.y * f32(ts))), 0);
    let y1 = min(i32(floor(aabb.w * f32(ts))), ts - 1);
    if (x1 < x0 || y1 < y0 || x1 - x0 > 3 || y1 - y0 > 3) {
        return false;
    }
    for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
            if (z > hiZDepth(x + offset, y)) {
                return false;
            }
        }
    }
    return true;
}
`;

/**
 * Per cell: its sphere tested against the frustum and the object's distance range as `cullSegment` tests cells; the
 * levels whose distance range it overlaps as bits (see `cell-cull.ts`)
 */
export const cell_cull_wgsl = /* wgsl */ `
${cull_tests_wgsl}
@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let cell = id.x;
    if (cell >= u32(uParams.uCellCount)) {
        return;
    }
    let sphere = cellSpheres[cell];
    if (outside(uParams.uPlane0, sphere) || outside(uParams.uPlane1, sphere) || outside(uParams.uPlane2, sphere) ||
        outside(uParams.uPlane3, sphere) || outside(uParams.uPlane4, sphere) || outside(uParams.uPlane5, sphere)) {
        cellLevels[cell] = 0u;
        return;
    }
    let d = dot(uParams.uCameraPlane.xyz, sphere.xyz) + uParams.uCameraPlane.w;
    let range = uParams.uLodRange;
    if ((range.z > 0.0 && (d + sphere.w < range.x || d - sphere.w > range.y)) || occluded(sphere)) {
        cellLevels[cell] = 0u;
        return;
    }
    let levels = u32(uParams.uLevelCount);
    if (levels == 0u) {
        cellLevels[cell] = 1u;
        return;
    }
    var mask = 0u;
    for (var j = 0u; j < levels; j++) {
        let level = uParams.uLevels[j];
        if (!(d + sphere.w < level.x || d - sphere.w > level.y)) {
            mask |= 1u << j;
        }
    }
    cellLevels[cell] = mask;
}
`;

/**
 * Per instance of a drawn cell: its own sphere tested at the cell's levels (`instanceLevels`), its data copied into a
 * slot of its segment's region at each level it passed. The instances of a workgroup are consecutive, mostly of one segment: those of the workgroup's first segment take their
 * slots from a workgroup counter, reserved by one global atomic per level (100k instances on a counter per segment
 * contend otherwise); the others take theirs from the global counter
 */
export const instance_copy_wgsl = /* wgsl */ `
${cull_tests_wgsl}

/**
 * The levels of \`mask\` (the cell's) at which the instance's own sphere touches the view: the frustum, the object's
 * distance range and each level's, then the depth pyramid. Its sphere is the member's (\`aSegmentSphere\`) moved by its
 * transform; at level j grown by the padding (the member's largest sphere radius) times the level's sphere scale less
 * one, so a coarse level's enlarged spheres at the view's edge are kept
 */
fn instanceLevels(o: u32, padding: f32, cellMask: u32) -> u32 {
    let t0 = instanceData[o].xyz;
    let t1 = instanceData[o + 1u].xyz;
    let t2 = instanceData[o + 2u].xyz;
    let t3 = instanceData[o + 3u].xyz;
    let local = instanceData[o + 5u];
    let scales = instanceData[o + 6u];
    let center = t0 * local.x + t1 * local.y + t2 * local.z + t3;
    let scale = sqrt(max(dot(t0, t0), max(dot(t1, t1), dot(t2, t2))));
    let d = dot(uParams.uCameraPlane.xyz, center) + uParams.uCameraPlane.w;
    let range = uParams.uLodRange;
    let levels = u32(uParams.uLevelCount);
    var mask = 0u;
    var radius = 0.0;
    for (var j = 0u; j < 4u; j++) {
        if ((cellMask & (1u << j)) == 0u) {
            continue;
        }
        let r = (local.w + padding * max(scales[j] - 1.0, 0.0)) * scale;
        let sphere = vec4<f32>(center, r);
        if (outside(uParams.uPlane0, sphere) || outside(uParams.uPlane1, sphere) ||
            outside(uParams.uPlane2, sphere) || outside(uParams.uPlane3, sphere) ||
            outside(uParams.uPlane4, sphere) || outside(uParams.uPlane5, sphere)) {
            continue;
        }
        if (range.z > 0.0 && (d + r < range.x || d - r > range.y)) {
            continue;
        }
        if (levels > 0u) {
            let level = uParams.uLevels[j];
            if (d + r < level.x || d - r > level.y) {
                continue;
            }
        }
        mask |= 1u << j;
        radius = max(radius, r);
    }
    if (mask != 0u && occluded(vec4<f32>(center, radius))) {
        return 0u;
    }
    return mask;
}

var<workgroup> wgCount: atomic<u32>;
var<workgroup> wgBase: u32;

fn copyInstance(o: u32, t: u32) {
    transforms[t * 4u] = instanceData[o];
    transforms[t * 4u + 1u] = instanceData[o + 1u];
    transforms[t * 4u + 2u] = instanceData[o + 2u];
    transforms[t * 4u + 3u] = instanceData[o + 3u];
    let is = instanceData[o + 4u];
    instances[t] = is.x;
    segments[t * 3u] = is.y;
    segments[t * 3u + 1u] = is.z;
    segments[t * 3u + 2u] = is.w;
    spheres[t] = instanceData[o + 5u];
    lods[t] = instanceData[o + 6u];
}

@compute @workgroup_size(WorkgroupSizeX)
fn main(
    @builtin(global_invocation_id) id: vec3<u32>,
    @builtin(local_invocation_index) local: u32,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let instance = id.x;
    let instanceCount = u32(uParams.uInstanceCount);
    let segmentCount = u32(uParams.uSegmentCount);
    let valid = instance < instanceCount;
    var mask = 0u;
    var segment = 0u;
    let o = instance * ${InstanceDataVec4s}u;
    if (valid) {
        let cs = instanceCells[instance];
        segment = cs.y;
        mask = cellLevels[cs.x];
        if (mask != 0u) {
            mask = instanceLevels(o, bitcast<f32>(segmentBases[segment].y), mask);
        }
    }
    // the segment of the workgroup's first instance (always valid)
    let wgSegment = instanceCells[wid.x * WorkgroupSizeX].y;
    let firstSegment = segment == wgSegment;
    for (var j = 0u; j < 4u; j++) {
        let drawn = (mask & (1u << j)) != 0u;
        if (local == 0u) {
            atomicStore(&wgCount, 0u);
        }
        workgroupBarrier();
        var slot = 0u;
        if (drawn && firstSegment) {
            slot = atomicAdd(&wgCount, 1u);
        }
        workgroupBarrier();
        if (local == 0u) {
            let total = atomicLoad(&wgCount);
            if (total > 0u) {
                wgBase = atomicAdd(&counters[j * segmentCount + wgSegment], total);
            }
        }
        workgroupBarrier();
        if (drawn) {
            if (firstSegment) {
                slot += wgBase;
            } else {
                slot = atomicAdd(&counters[j * segmentCount + segment], 1u);
            }
            let s = select(segment, wgSegment, firstSegment);
            copyInstance(o, j * instanceCount + segmentBases[s].x + slot);
        }
        workgroupBarrier();
    }
}
`;

/** Per (level, segment) record: the instances drawn as its instance count */
export const cull_args_wgsl = /* wgsl */ `
@compute @workgroup_size(WorkgroupSizeX)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let k = id.x;
    if (k >= u32(uParams.uRecordCount)) {
        return;
    }
    args[k * u32(uParams.uRecordWords) + 1u] = counters[k];
}
`;
