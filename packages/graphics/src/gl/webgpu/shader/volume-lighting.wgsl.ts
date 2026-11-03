/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { VolumeLightingMaxAlpha } from '../../compute/volume-lighting.js';
import { clip_storage_wgsl } from './chunks/clip.wgsl.js';

/**
 * Level 1 of the extinction pyramid (`volume-lighting.md` §A1): per texel the mean extinction of its 2³ cells of the
 * grid, `-ln(1 - alpha)` of the transfer function's opacity per cell (`transfer`, its 256 entries filtered as the
 * sampler does), cells beyond the grid and cells the clip objects remove counted as 0: the march's \`clipTest\` of the
 * cell's center in model space (\`uCellToModel\`), the clip objects in \`clipObjects\` (\`clip_storage_wgsl\`)
 */
export const vl_extinction_wgsl = /* wgsl */ `
const MaxAlpha = ${VolumeLightingMaxAlpha};

${clip_storage_wgsl('clipObjects', '0u', 'uParams.uClipObjectCount')}

fn extinction(cell: vec3<i32>) -> f32 {
    if (uParams.uClipObjectCount > 0 && clipTest((uParams.uCellToModel * vec4<f32>(vec3<f32>(cell), 1.0)).xyz, 0)) {
        return 0.0;
    }
    let s = textureLoad(tGridTex, cell, 0);
    #if defined(dPackedGroup)
        let v = s.a;
    #else
        let v = s.r;
    #endif
    let x = clamp(v * 256.0 - 0.5, 0.0, 255.0);
    let i = u32(x);
    let tf = mix(transfer[i], transfer[min(i + 1u, 255u)], x - f32(i));
    return -log(1.0 - min(clamp(tf * uParams.uAlpha, 0.0, 1.0), MaxAlpha));
}

@compute @workgroup_size(WorkgroupSizeX, WorkgroupSizeY, WorkgroupSizeZ)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let p = vec3<i32>(id);
    if (any(p >= uParams.uLevelDim)) {
        return;
    }
    let gridDim = uParams.uGridDim;
    var sum = 0.0;
    for (var k = 0; k < 8; k++) {
        let cell = 2 * p + vec3<i32>(k & 1, (k >> 1) & 1, k >> 2);
        if (all(cell < gridDim)) {
            sum += extinction(cell);
        }
    }
    textureStore(outLevel, p, vec4<f32>(sum * 0.125));
}
`;

/** A level of the extinction pyramid from the one below: the mean of a texel's 8 children */
export const vl_downsample_wgsl = /* wgsl */ `
@compute @workgroup_size(WorkgroupSizeX, WorkgroupSizeY, WorkgroupSizeZ)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let p = vec3<i32>(id);
    if (any(p >= uParams.uLevelDim)) {
        return;
    }
    var sum = 0.0;
    for (var k = 0; k < 8; k++) {
        sum += textureLoad(tSource, 2 * p + vec3<i32>(k & 1, (k >> 1) & 1, k >> 2), 0).r;
    }
    textureStore(outLevel, p, vec4<f32>(sum * 0.125));
}
`;
