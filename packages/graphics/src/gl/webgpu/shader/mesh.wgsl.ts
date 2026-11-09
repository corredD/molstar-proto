/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { animation_wgsl, assign_wiggle_wgsl } from './chunks/animation.wgsl.js';
import { clip_flag_wgsl, clip_functions_wgsl, clip_instance_wgsl, clip_pixel_wgsl } from './chunks/clip.wgsl.js';
import { segment_wgsl } from './chunks/segment.wgsl.js';
import { common_wgsl } from './chunks/common.wgsl.js';
import { color_levels_wgsl } from './chunks/color-levels.wgsl.js';
import { light_wgsl } from './chunks/light.wgsl.js';
import {
  apply_interior_wgsl,
  apply_light_wgsl,
  apply_fog_wgsl,
  apply_marker_wgsl,
  assign_material_wgsl,
  check_transparency_wgsl,
  material_functions_wgsl,
} from './chunks/material.wgsl.js';
import {
  depth_output_wgsl,
  dpoit_output_wgsl,
  emissive_output_wgsl,
  fragment_output_wgsl,
  marking_output_wgsl,
  pick_output_wgsl,
  tracing_output_wgsl,
  wboit_output_wgsl,
} from './chunks/output.wgsl.js';
import { iso_vertex_wgsl } from './marching-cubes-chunks.wgsl.js';
import { packing_wgsl } from './chunks/packing.wgsl.js';
import { read_from_texture_wgsl } from './chunks/read-from-texture.wgsl.js';
import { assign_varyings_wgsl, grid_functions_wgsl, vertex_output_wgsl } from './chunks/varyings.wgsl.js';

/**
 * A periodic patch mapped by planes and cells (`MeshSchema.dPatchTexture`; the lipid cutter's map, `cutter.ts` in the
 * mesoscale extension): the fragment's point in its plane (its group), then in the plane's patch coordinates, its cell's
 * kind by a hash of (plane, cell), the kind's spin and offset, and the patch read there with the footprint's gradients
 * (mipmapped: its mean far away, whatever the scale). From the far color to it by a texel's size on screen
 */
const patch_texture_wgsl = /* wgsl */ `
#if defined(dPatchTexture)
fn patchTexel(i: u32) -> vec4<f32> {
    return textureLoad(tPatchTable, vec2<i32>(i32(i % 1024u), i32(i / 1024u)), 0);
}

fn patchHash(x0: u32) -> u32 {
    var x = x0 ^ (x0 >> 16u);
    x = x * 0x7feb352du;
    x = x ^ (x >> 15u);
    x = x * 0x846ca68bu;
    return x ^ (x >> 16u);
}

fn patchTurn(c: f32, s: f32, v: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn patchColor(modelPosition: vec3<f32>, fdx: vec3<f32>, fdy: vec3<f32>, region: u32, far: vec3<f32>) -> vec3<f32> {
    let box = uObject.uPatch.yz;
    let side = uObject.uPatch.x;
    let g0 = patchTexel(region * 4u);
    let g1 = patchTexel(region * 4u + 1u);
    let g2 = patchTexel(region * 4u + 2u);
    let g3 = patchTexel(region * 4u + 3u);
    // the plane's point q and the patch's p = offset + Rz(θ) q, with their derivatives on screen
    let w = modelPosition / uGlobal.uModelScale;
    let q = vec2<f32>(dot(w - g0.xyz, g1.xyz), dot(w - g0.xyz, g2.xyz));
    let p = vec2<f32>(g0.w * box.x, g1.w * box.y) + patchTurn(g2.w, g3.w, q);
    let invView = mat3x3<f32>(uGlobal.uInvView[0].xyz, uGlobal.uInvView[1].xyz, uGlobal.uInvView[2].xyz);
    let mdx = (invView * fdx) / uGlobal.uModelScale;
    let mdy = (invView * fdy) / uGlobal.uModelScale;
    let pdx = patchTurn(g2.w, g3.w, vec2<f32>(dot(mdx, g1.xyz), dot(mdx, g2.xyz)));
    let pdy = patchTurn(g2.w, g3.w, vec2<f32>(dot(mdy, g1.xyz), dot(mdy, g2.xyz)));
    // the cell, its kind's offset e and spin φ: s = e + Rz(φ)(p − its center)
    let cell = floor(p / side);
    let cx = bitcast<u32>(i32(cell.x));
    let cy = bitcast<u32>(i32(cell.y));
    let kind = patchHash(region ^ patchHash(cx ^ patchHash(cy))) & 4095u;
    let c = patchTexel(u32(uObject.uPatch.w) + kind);
    let s = vec2<f32>(c.x * box.x, c.y * box.y) + patchTurn(c.z, c.w, p - (cell + 0.5) * side);
    let sdx = patchTurn(c.z, c.w, pdx) / box;
    let sdy = patchTurn(c.z, c.w, pdy) / box;
    let color = textureSampleGrad(tPatch, sLinearMipmapRepeat, s / box, sdx, sdy).rgb;
    if (uObject.uPatchLevels.x == 0.0) {
        return color;
    }
    // a lipid's px: the levels' far color below .y, the patch from .z
    let px = uObject.uPatchLevels.w / max(max(length(pdx), length(pdy)), 1e-6);
    return mix(far, color, smoothstep(uObject.uPatchLevels.y, uObject.uPatchLevels.z, px));
}
#endif
`;

export const mesh_wgsl = /* wgsl */ `
${common_wgsl}
${read_from_texture_wgsl}
${animation_wgsl}
${light_wgsl}
${material_functions_wgsl}
${segment_wgsl}
${clip_functions_wgsl}
${packing_wgsl}
${color_levels_wgsl}
${grid_functions_wgsl}

${vertex_output_wgsl(`    @location(9) vNormal: vec3<f32>,
#if defined(dPatchTexture)
    @location(10) @interpolate(flat) vPatchRegion: f32,
#endif`)}
${patch_texture_wgsl}
${fragment_output_wgsl(`#if defined(dSolidInterior)
    @builtin(frag_depth) fragDepth: f32,
#endif`)}

#if defined(dGeometryType_textureMesh) && defined(dIsoChunks)
${iso_vertex_wgsl('sIsoTable', 'sIsoVertices')}
#endif

@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    let vertexId = i32(in.vertexIndex);
    #if defined(dGeometryType_textureMesh) && defined(dIsoChunks)
        // unindexed, the vertex data in pages of the vertex arena; vertices beyond the drawn count (the page table's
        // fourth word, e.g. of draws of the CPU's upper bound) are left out below
        let isDrawn = in.vertexIndex < isoDrawn();
        let slot = select(0u, isoSlot(in.vertexIndex), isDrawn);
        let group = f32(isoPackedGroup(slot)) - 1.0;
        let basePosition = isoPosition(slot);
        let baseNormal = isoNormal(slot);
    #elif defined(dGeometryType_textureMesh)
        // unindexed, the vertex data in textures (e.g. computed on the GPU)
        let group = unpackRGBToInt(readFromTexture(tGroup, vertexId).rgb);
        let basePosition = readFromTexture(tPosition, vertexId).xyz;
        let baseNormal = readFromTexture(tNormal, vertexId).xyz;
    #else
        let group = in.aGroup;
        let basePosition = in.aPosition;
        let baseNormal = octDecode(in.aNormal);
    #endif

    let aTransform = affineTransform(in.aTransform0, in.aTransform1, in.aTransform2);
    let transform = applyTumble(aTransform, invariantBoundingSphere(in));
    let model = uGlobal.uModel * transform;
    let modelView = uGlobal.uView * model;
    ${assign_wiggle_wgsl}
    let position4 = vec4<f32>(applyWiggle(basePosition, group, wiggle), 1.0);
    out.vModelPosition = (model * position4).xyz;
    let mvPosition = modelView * position4;
    out.vViewPosition = mvPosition.xyz;
    out.position = uGlobal.uProjection * mvPosition;
    #if defined(dGeometryType_textureMesh) && defined(dIsoChunks)
        if (!isDrawn) {
            // outside the clip volume: whole triangles (the drawn count is a multiple of 3) are clipped
            out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
        }
    #endif

    // after the positions: grid data (smoothed colors) is read at the vertex position
    let gridPosition = basePosition;
    ${assign_varyings_wgsl}

    var normal = normalize(adjoint(modelView) * normalize(baseNormal));
    #if defined(dFlipSided)
        if (uMaterial.uDoubleSided == 0u) {
            normal = -normal;
        }
    #endif
    out.vNormal = normal;
    #if defined(dPatchTexture)
        out.vPatchRegion = group;
    #endif

    #if defined(dSolidInterior)
        if (uDraw.uSolidInteriorPass != 0) {
            // keep the back faces of the cap passes in front of the far plane
            // in front of the far plane (clip z is reversed)
            out.position.z = max(out.position.z, out.position.w * 0.0001);
        }
    #endif
    ${clip_instance_wgsl}
    return out;
}

@fragment
fn fragmentMain(in: VertexOutput, @builtin(front_facing) frontFacing: bool) -> FragmentOutput {
    var out: FragmentOutput;
    ${clip_flag_wgsl('in.vMarkerClipping.y')}

    // derivatives in uniform control flow; framebuffer y points down, so dpdy has the opposite sign of GL's dFdy
    let fdx = dpdx(in.vViewPosition);
    let fdy = dpdy(in.vViewPosition);

    #if defined(dSolidInterior)
        // solid interior caps: the back faces seen through the cut (near plane or clip object), drawn where the stencil
        // of the mark pass (\`uSolidInteriorPass\` 2) counts more back than front faces, at the cut (pass 1)
        var fragmentDepth = in.position.z;
        let capPass = uDraw.uSolidInteriorPass != 0;
        var viewPosition = in.vViewPosition;
        var modelPosition = in.vModelPosition;
        if (capPass) {
            let nearZ = -uGlobal.uNear * 1.0001;
            let vp = in.vViewPosition;
            let nearPosition = vec3<f32>(mix(vp.xy * (nearZ / vp.z), vp.xy, uGlobal.uIsOrtho), nearZ);
            var s = 0.0;
            #if defined(dClipObjects)
                if (uDraw.uSolidInteriorClip >= 0) {
                    // exempt parts are not cut by this clip object, so they neither count nor fill
                    if (clipIgnored(uDraw.uSolidInteriorClip, clipFlag)) {
                        discard;
                    }
                    let nearModelPosition = (uGlobal.uInvView * vec4<f32>(nearPosition, 1.0)).xyz;
                    s = clipCapExit(nearModelPosition / uGlobal.uModelScale, in.vModelPosition / uGlobal.uModelScale, uGlobal.uDepthBack != 0u);
                    if (s < 0.0 || s > 1.0) {
                        discard;
                    }
                }
            #endif
            if (uDraw.uSolidInteriorPass == 2) {
                // stencil marks only
                out.fragDepth = fragmentDepth;
                return out;
            }
            viewPosition = mix(nearPosition, in.vViewPosition, s);
            modelPosition = (uGlobal.uInvView * vec4<f32>(viewPosition, 1.0)).xyz;
            fragmentDepth = mix(calcDepth(viewPosition), in.position.z, 0.0001);
            // beyond the far plane (depth is reversed)
            if (fragmentDepth < 0.0) {
                discard;
            }
        }
        out.fragDepth = fragmentDepth;
        ${clip_pixel_wgsl('modelPosition')}
        // after the mark pass returned (it needs every face) and at the cap position
        if (fadeLod(in.position, modelPosition)) {
            discard;
        }
    #else
        if (fadeLod(in.position, in.vModelPosition)) {
            discard;
        }
        ${clip_pixel_wgsl('in.vModelPosition')}

        let fragmentDepth = in.position.z;
        let modelPosition = in.vModelPosition;
        let viewPosition = in.vViewPosition;
    #endif

    var interior = !frontFacing;
    #if defined(dSolidInterior)
        // the fill may draw front faces (reflected instances), a cap is always interior
        #if defined(dRenderVariant_depth)
            // a cap is the visible surface, so the depth passes must not discard it as interior
            if (capPass) {
                interior = false;
            }
        #else
            if (capPass) {
                interior = true;
            }
        #endif
    #endif

    #if defined(dFlatShaded)
        var normal = normalize(cross(fdx, fdy));
    #else
        var normal = -normalize(in.vNormal);
        if (uMaterial.uDoubleSided != 0u) {
            normal *= select(-1.0, 1.0, frontFacing);
        }
    #endif
    #if defined(dFlipSided)
        normal = -normal;
    #endif
    #if defined(dSolidInterior)
        if (capPass) {
            normal = vec3<f32>(0.0, 0.0, -1.0);
            #if defined(dClipObjects)
                if (uDraw.uSolidInteriorClip >= 0) {
                    let invView = uGlobal.uInvView;
                    let invView3 = mat3x3<f32>(invView[0].xyz, invView[1].xyz, invView[2].xyz);
                    normal = normalize(clipCapNormal(modelPosition / uGlobal.uModelScale) * invView3);
                }
            #endif
        }
    #endif

    ${assign_material_wgsl}
    #if defined(dPatchTexture)
        material = vec4<f32>(patchColor(modelPosition, fdx, fdy, u32(in.vPatchRegion + 0.5), material.rgb), material.a);
    #endif
    ${check_transparency_wgsl}

    #if defined(dRenderVariant_pick)
        ${pick_output_wgsl}
        #if defined(dSolidInterior)
            if (capPass) {
                // 16777214 is PickingId.Null, the cap picks the whole instance
                out.group = vec4<f32>(packIntToRGB(16777214.0), 1.0);
            }
        #endif
    #elif defined(dRenderVariant_marking)
        ${marking_output_wgsl}
    #elif defined(dRenderVariant_emissive)
        ${emissive_output_wgsl}
    #elif defined(dRenderVariant_depth)
        ${depth_output_wgsl()}
    #else
        ${apply_interior_wgsl}
        ${apply_light_wgsl}
        ${apply_marker_wgsl}
        #if defined(dRenderVariant_tracing)
            ${tracing_output_wgsl('normal')}
        #else
            ${apply_fog_wgsl}
            ${wboit_output_wgsl}
            ${dpoit_output_wgsl}
            out.color = color;
        #endif
    #endif
    return out;
}
`;
