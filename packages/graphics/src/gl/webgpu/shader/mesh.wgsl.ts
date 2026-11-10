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
  apply_occlusion_wgsl,
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
 * kind by a hash of (the plane's key, cell), the kind's spin and offset, and the patch read there with the footprint's gradients
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

// a vertex's shift in its plane, after the 4,096 cells: two vertices a texel (the point drawn off the plane along
// another direction than its normal reads where it stands over, not where it projects)
fn patchShift(vertex: u32) -> vec2<f32> {
    let t = patchTexel(u32(uObject.uPatch.w) + 4096u + vertex / 2u);
    return select(t.xy, t.zw, (vertex & 1u) == 1u);
}

// the patch at a point q of a region's plane: s (Å, in the patch) and its cell's spin (cos, sin)
fn patchAt(region: u32, q: vec2<f32>) -> vec4<f32> {
    let box = uObject.uPatch.yz;
    let side = uObject.uPatch.x;
    let g0 = patchTexel(region * 4u);
    let g1 = patchTexel(region * 4u + 1u);
    let g2 = patchTexel(region * 4u + 2u);
    let g3 = patchTexel(region * 4u + 3u);
    // the plane's p = offset + Rz(θ) q; the cell, its kind's offset e and spin φ: s = e + Rz(φ)(p − its center)
    let p = vec2<f32>(g0.w * box.x, g1.w * box.y) + patchTurn(g2.w, g3.w, q);
    let cell = floor(p / side);
    let cx = bitcast<u32>(i32(cell.x));
    let cy = bitcast<u32>(i32(cell.y));
    // the region's key in the cells' hash over its normal's x (unread here; a part's regions keep the whole mesh's)
    let kind = patchHash(u32(g3.x) ^ patchHash(cx ^ patchHash(cy))) & 4095u;
    let c = patchTexel(u32(uObject.uPatch.w) + kind);
    return vec4<f32>(vec2<f32>(c.x * box.x, c.y * box.y) + patchTurn(c.z, c.w, p - (cell + 0.5) * side), c.z, c.w);
}

struct PatchFrame {
    region: u32,
    // the plane's point, the patch's (s) and its cell's spin
    q: vec2<f32>,
    s: vec2<f32>,
    spin: vec2<f32>,
    // the plane's p on screen (per pixel), a lipid's px
    pdx: vec2<f32>,
    pdy: vec2<f32>,
    px: f32,
}

// a fragment's place in the patch (round 8: split out of the colour for the shells' test and parallax)
fn patchFrame(modelPosition: vec3<f32>, fdx: vec3<f32>, fdy: vec3<f32>, region: u32, shift: vec2<f32>) -> PatchFrame {
    let g0 = patchTexel(region * 4u);
    let g1 = patchTexel(region * 4u + 1u);
    let g2 = patchTexel(region * 4u + 2u);
    let g3 = patchTexel(region * 4u + 3u);
    let w = modelPosition / uGlobal.uModelScale;
    let q = vec2<f32>(dot(w - g0.xyz, g1.xyz), dot(w - g0.xyz, g2.xyz)) + shift;
    let invView = mat3x3<f32>(uGlobal.uInvView[0].xyz, uGlobal.uInvView[1].xyz, uGlobal.uInvView[2].xyz);
    let mdx = (invView * fdx) / uGlobal.uModelScale;
    let mdy = (invView * fdy) / uGlobal.uModelScale;
    let pdx = patchTurn(g2.w, g3.w, vec2<f32>(dot(mdx, g1.xyz), dot(mdx, g2.xyz)));
    let pdy = patchTurn(g2.w, g3.w, vec2<f32>(dot(mdy, g1.xyz), dot(mdy, g2.xyz)));
    let at = patchAt(region, q);
    let px = uObject.uPatchLevels.w / max(max(length(pdx), length(pdy)), 1e-6);
    return PatchFrame(region, q, at.xy, at.zw, pdx, pdy, px);
}

// the patch read at s (a cell of spin \`spin\`), the footprint's gradients turned with it; with an offset in s (Å)
fn patchRead(f: PatchFrame, s: vec2<f32>, spin: vec2<f32>) -> vec4<f32> {
    let box = uObject.uPatch.yz;
    return textureSampleGrad(tPatch, sLinearMipmapRepeat, s / box, patchTurn(spin.x, spin.y, f.pdx) / box, patchTurn(spin.x, spin.y, f.pdy) / box);
}

fn patchColor(f: PatchFrame, far: vec3<f32>) -> vec3<f32> {
    let color = patchRead(f, f.s, f.spin).rgb;
    if (uObject.uPatchLevels.x == 0.0) {
        return color;
    }
    // a lipid's px: the levels' far color below .y, the patch from .z
    return mix(far, color, smoothstep(uObject.uPatchLevels.y, uObject.uPatchLevels.z, f.px));
}

#if defined(dPatchMiddle_shells) || defined(dPatchMiddle_parallax)
// the heads' height at s, Å over lo (\`tPatch\`'s alpha over [lo, hi], \`uPatchShells\`)
fn patchHeight(f: PatchFrame, s: vec2<f32>, spin: vec2<f32>) -> f32 {
    return patchRead(f, s, spin).a * (uObject.uPatchShells.z - uObject.uPatchShells.y);
}

// the heads' profile's normal, from the fragment's (view space, Mol*'s sign): the height's gradient by central
// differences a texel apart, from the patch back through the cell's spin and the plane's turn onto its axes
fn patchNormal(f: PatchFrame, normal: vec3<f32>) -> vec3<f32> {
    let e = uObject.uPatch.y / f32(textureDimensions(tPatch).x);
    let gs = vec2<f32>(
        patchHeight(f, f.s + vec2<f32>(e, 0.0), f.spin) - patchHeight(f, f.s - vec2<f32>(e, 0.0), f.spin),
        patchHeight(f, f.s + vec2<f32>(0.0, e), f.spin) - patchHeight(f, f.s - vec2<f32>(0.0, e), f.spin),
    ) / (2.0 * e);
    let g2 = patchTexel(f.region * 4u + 2u);
    let g3 = patchTexel(f.region * 4u + 3u);
    let gq = patchTurn(g2.w, -g3.w, patchTurn(f.spin.x, -f.spin.y, gs));
    let g1 = patchTexel(f.region * 4u + 1u);
    let grad = gq.x * g1.xyz + gq.y * g2.xyz;
    return normalize(normal + (uGlobal.uView * vec4<f32>(grad, 0.0)).xyz);
}
#endif

#if defined(dPatchMiddle_parallax)
// parallax (round 8 §3): the view ray marched through the heads' layer, hi to lo, from the surface at the mean; the
// patch where it first meets the heads (one secant step after), with the frame's footprint. \`up\` the leaflet's normal
fn patchParallax(f: PatchFrame, modelPosition: vec3<f32>, up: vec3<f32>) -> PatchFrame {
    let g1 = patchTexel(f.region * 4u + 1u);
    let g2 = patchTexel(f.region * 4u + 2u);
    let v = mix(normalize(modelPosition - uGlobal.uCameraPosition), uGlobal.uCameraDir, uGlobal.uIsOrtho);
    let vn = dot(v, up);
    if (vn > -0.05) {
        return f;
    }
    let vq = vec2<f32>(dot(v, g1.xyz), dot(v, g2.xyz));
    let lo = uObject.uPatchShells.y;
    let hi = uObject.uPatchShells.z;
    let mean = uObject.uPatchShells.w;
    // the ray's height over lo at t: mean − lo + t vn; it enters the layer at hi and leaves it at lo
    let t0 = (hi - mean) / vn;
    let t1 = (lo - mean) / vn;
    let steps = i32(mix(16.0, 6.0, -vn));
    let dt = (t1 - t0) / f32(steps);
    var t = t0;
    var before = hi - lo;
    var at = patchAt(f.region, f.q + t * vq);
    for (var i = 0; i < steps; i++) {
        let next = t + dt;
        let nextAt = patchAt(f.region, f.q + next * vq);
        let ray = mean - lo + next * vn;
        let gap = ray - patchHeight(f, nextAt.xy, nextAt.zw);
        if (gap <= 0.0) {
            // the secant between the last step above and this one
            let a = before / max(before - gap, 1e-6);
            at = patchAt(f.region, f.q + (t + a * dt) * vq);
            break;
        }
        t = next;
        at = nextAt;
        before = gap;
    }
    var out = f;
    out.s = at.xy;
    out.spin = at.zw;
    return out;
}
#endif
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
    @location(10) @interpolate(flat) vPatch: vec2<f32>,
    @location(11) vPatchShift: vec2<f32>,
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
    let model = uGlobal.uModel * uObject.uObjectTransform * transform;
    let modelView = uGlobal.uView * model;
    ${assign_wiggle_wgsl}
    var position4 = vec4<f32>(applyWiggle(basePosition, group, wiggle), 1.0);
    #if defined(dPatchMiddle_shells)
        // shell k (the instance) at lo + k (hi − lo) / (N − 1) out of the leaflet, the surface at the mean (round 8 §2)
        let shells = uObject.uPatchShells;
        let shellHeight = shells.y + in.aInstance * (shells.z - shells.y) / max(shells.x - 1.0, 1.0);
        position4 = vec4<f32>(position4.xyz + normalize(baseNormal) * (shellHeight - shells.w), 1.0);
    #endif
    #if defined(dGeometryType_mesh)
        if (uObject.uScreenSize > 0.0) {
            // constant on screen: scaled about the instance's origin by the world size of a CSS pixel there, as
            // \`OverlayCamera\` bounds it
            let originDepth = max(-(modelView * vec4<f32>(0.0, 0.0, 0.0, 1.0)).z, 0.0);
            let pixelDistance = select(2.0 * originDepth, 2.0, uGlobal.uIsOrtho == 1.0);
            let pixelSize = pixelDistance / (uGlobal.uProjection[1][1] * uGlobal.uCssHeight);
            position4 = vec4<f32>(position4.xyz * (uObject.uScreenSize * pixelSize / uGlobal.uModelScale), 1.0);
        }
    #endif
    out.vModelPosition = (model * position4).xyz;
    let mvPosition = modelView * position4;
    out.vViewPosition = mvPosition.xyz;
    out.position = uGlobal.uProjection * mvPosition;
    #if defined(dGeometryType_mesh)
        if (uObject.uDepthOffset > 0.0) {
            // in depth only: its pixels stay; kept in front of the camera and within the depth range (as points'
            // \`uPointDepthOffset\`: closer than the offset, at the near plane)
            var offsetZ = mvPosition.z + uObject.uDepthOffset * uGlobal.uModelScale;
            if (uGlobal.uIsOrtho != 1.0) {
                offsetZ = min(offsetZ, mvPosition.z * 1e-3);
            }
            let offsetPosition = uGlobal.uProjection * vec4<f32>(mvPosition.xy, offsetZ, 1.0);
            out.position.z = clamp(offsetPosition.z / offsetPosition.w, 1e-6, 1.0 - 1e-6) * out.position.w;
        }
    #endif
    #if defined(dGeometryType_textureMesh) && defined(dIsoChunks)
        if (!isDrawn) {
            // outside the clip volume: whole triangles (the drawn count is a multiple of 3) are clipped
            out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
        }
    #endif

    // after the positions: grid data (smoothed colors) is read at the vertex position
    let gridPosition = basePosition;
    // where the instance is placed, without the transient transform: grids are built from \`aTransform\` (\`uModel\` is
    // the camera's uniform scale, its scene group's view the identity)
    let gridModelPosition = (transform * position4).xyz;
    ${assign_varyings_wgsl}

    var normal = normalize(adjoint(modelView) * normalize(baseNormal));
    #if defined(dFlipSided)
        if (uMaterial.uDoubleSided == 0u) {
            normal = -normal;
        }
    #endif
    out.vNormal = normal;
    #if defined(dPatchTexture)
        out.vPatch = vec2<f32>(group, 0.0);
        out.vPatchShift = patchShift(in.vertexIndex);
        #if defined(dPatchMiddle_shells)
            out.vPatch.y = in.aInstance;
            // the shift grows with the lift (\`patchSurface\`: −h P(n)), from the mean's to the shell's
            out.vPatchShift *= select(1.0, shellHeight / shells.w, shells.w != 0.0);
        #endif
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

    #if defined(dPatchTexture) && (defined(dPatchMiddle_shells) || defined(dPatchMiddle_beneath) || defined(dPatchMiddle_parallax))
        // the middle look's handoff and the shells' test in every variant: depth, pick and colour discard alike (round 8)
        var frame = patchFrame(modelPosition, fdx, fdy, u32(in.vPatch.x + 0.5), in.vPatchShift);
        let middle = frame.px >= uObject.uPatchMiddle.x && frame.px < uObject.uPatchMiddle.y;
        #if defined(dPatchMiddle_beneath)
            if (middle) {
                discard;
            }
        #elif defined(dPatchMiddle_shells)
            let shell = in.vPatch.y;
            let shellCut = (shell - 0.5) / max(uObject.uPatchShells.x - 1.0, 1.0);
            if (!middle || (shell > 0.5 && patchRead(frame, frame.s, frame.spin).a < shellCut)) {
                discard;
            }
        #endif
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
    // the patch's colour where colour is drawn (not in the depth, pick or marking variants)
    #if defined(dPatchTexture) && (defined(dRenderVariant_colorBlended) || defined(dRenderVariant_colorWboit) || defined(dRenderVariant_colorDpoit) || defined(dRenderVariant_tracing) || defined(dRenderVariant_emissive))
        #if !defined(dPatchMiddle_shells) && !defined(dPatchMiddle_beneath) && !defined(dPatchMiddle_parallax)
            let frame = patchFrame(modelPosition, fdx, fdy, u32(in.vPatch.x + 0.5), in.vPatchShift);
        #endif
        #if defined(dPatchMiddle_parallax)
            if (middle) {
                let up = normalize((uGlobal.uInvView * vec4<f32>(-normal, 0.0)).xyz);
                frame = patchParallax(frame, modelPosition, up);
            }
        #endif
        #if defined(dPatchMiddle_shells) || defined(dPatchMiddle_parallax)
            // at every px: the mips flatten it far away, so no light steps where the middle look starts
            normal = patchNormal(frame, normal);
        #endif
        material = vec4<f32>(patchColor(frame, material.rgb), material.a);
    #endif
    ${apply_occlusion_wgsl}
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
