/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/**
 * The last level of detail of spheres as octahedral impostors (`lod-impostor.md`), as `lod-impostor.glsl.ts`: the TS
 * rule is `ImpostorAtlas` (the map, the frames, the three views, the entry); the levels and the band are
 * `getLodLevelsValue`'s.
 */

/** The varyings of `VertexOutput`: the view's x and y axes in the copy's frame, the entry (-1 for spheres), the share */
export const lod_impostor_varyings_wgsl = /* wgsl */ `#if defined(dLodImpostor)
    @location(12) @interpolate(flat) vImpostorX: vec4<f32>,
    @location(13) @interpolate(flat) vImpostorY: vec4<f32>,
#endif`;

/**
 * After \`transform\` (before \`out.vModelPosition\`): the level's scale (the member's, merged) below 0 draws the copy
 * as an impostor at its bounding sphere; \`lodImpostorCenter\` the copy's center, by which a copy chooses its level whole
 */
export const assign_lod_impostor_wgsl = /* wgsl */ `
#if defined(dLodImpostor)
    #if defined(dSegmented)
        let lodImpostorScale = segmentLod(in)[clamp(uDraw.uLodLevel, 0, 3)];
    #else
        let lodImpostorScale = uDraw.uLod.w;
    #endif
    // a model scale draws every level (\`assign_lod_factor\`): the spheres there, not the impostors
    let lodImpostor = uDraw.uLod.w != 0.0 && lodImpostorScale < 0.0 && uGlobal.uModelScale == 1.0;
    var lodImpostorShare = -1.0;
    let lodImpostorSphere = invariantBoundingSphere(in);
    let lodImpostorCenter = (uGlobal.uModel * transform * vec4<f32>(lodImpostorSphere.xyz, 1.0)).xyz;
    if (lodImpostor) {
        position = lodImpostorSphere.xyz;
    }
#endif
`;

/**
 * Within \`assign_lod_factor_wgsl\`'s range test: the copy's distance chooses its level (\`lodImpostorCenter\`), whole
 * copies switch; no level shrinks its spheres; the impostors' share over the band (the overlap) where both draw
 */
export const assign_lod_impostor_factor_wgsl = /* wgsl */ `
            let d = (dot(uGlobal.uCameraPlane.xyz, lodImpostorCenter) + uGlobal.uCameraPlane.w) / uGlobal.uModelScale;
            lodFactor = select(lodScale, 1.0, lodImpostor);
            lodCulled = d < lod.x || d > lod.y;
            // the band's share of the next level: a level fading in (its overlap negated) keeps where it is above the
            // dither, one fading out (-1 - share) where it is not
            if (lod.z < 0.0) {
                // beyond the band, the impostors flatten over an octave (\`ImpostorFlatOctaves\`): 1 + flatness
                let bandEnd = lod.x - lod.z;
                lodImpostorShare = smoothstep(lod.x, bandEnd, d) + clamp(log2(max(d, bandEnd) / bandEnd) / ImpostorFlatOctaves, 0.0, 1.0);
            } else if (lod.z > 0.0) {
                lodImpostorShare = -1.0 - smoothstep(lod.y - lod.z, lod.y, d);
            } else {
                lodImpostorShare = -1.0;
            }
`;

/** After \`radius *= lodFactor\`: the varyings, the impostor's radius */
export const assign_lod_impostor_varyings_wgsl = /* wgsl */ `
#if defined(dLodImpostor)
    {
        // the rows of the copy's rotation into view space: the view's axes in its frame
        let m = uGlobal.uModelView * transform;
        let entry = select(-1.0, -lodImpostorScale - 1.0, lodImpostor);
        out.vImpostorX = vec4<f32>(normalize(vec3<f32>(m[0][0], m[1][0], m[2][0])), entry);
        out.vImpostorY = vec4<f32>(normalize(vec3<f32>(m[0][1], m[1][1], m[2][1])), lodImpostorShare);
        if (lodImpostor) {
            radius = lodImpostorSphere.w * modelScale;
        }
    }
#endif
`;

/** The fragment stage's functions (\`ImpostorAtlas\`'s rule) */
export const lod_impostor_wgsl = /* wgsl */ `
#if defined(dLodImpostor)
const ImpostorViews = 9.0;
/** octaves of distance beyond the band over which the impostors' shading flattens to their color (Goodsell's look) */
const ImpostorFlatOctaves = 1.0;

fn impostorEncode(direction: vec3<f32>) -> vec2<f32> {
    let d = direction / (abs(direction.x) + abs(direction.y) + abs(direction.z));
    var p = d.xy;
    if (d.z < 0.0) {
        p = (1.0 - abs(d.yx)) * vec2<f32>(select(-1.0, 1.0, d.x >= 0.0), select(-1.0, 1.0, d.y >= 0.0));
    }
    return p * 0.5 + 0.5;
}

fn impostorDecode(uv: vec2<f32>) -> vec3<f32> {
    var p = uv * 2.0 - 1.0;
    let z = 1.0 - abs(p.x) - abs(p.y);
    let t = max(-z, 0.0);
    p += vec2<f32>(select(t, -t, p.x >= 0.0), select(t, -t, p.y >= 0.0));
    return normalize(vec3<f32>(p, z));
}

/** the entry's corner (texels) and tile from its code (\`ImpostorAtlas.decodeEntry\`) */
fn impostorEntry(code: f32) -> vec3<f32> {
    let t = floor(code / 262144.0 + 1e-4);
    let rest = code - t * 262144.0;
    let y = floor(rest / 512.0 + 1e-4);
    return vec3<f32>((rest - y * 512.0) * 8.0, y * 8.0, 8.0 * exp2(t));
}

/** coverage and front height (Å along the frame's direction) of frame \`frame\` at its plane coordinates \`uv\` (0 to 1) */
fn impostorRead(entry: vec3<f32>, frame: vec2<f32>, uvIn: vec2<f32>, radius: f32) -> vec2<f32> {
    if (uvIn.x < 0.0 || uvIn.y < 0.0 || uvIn.x > 1.0 || uvIn.y > 1.0) {
        return vec2<f32>(0.0, -radius);
    }
    let tile = entry.z;
    let uv = clamp(uvIn, vec2<f32>(0.5 / tile), vec2<f32>(1.0 - 0.5 / tile));
    let s = textureSampleLevel(tImpostor, sLinear, (entry.xy + (frame + uv) * tile) / uObject.uImpostorTexDim, 0.0);
    return vec2<f32>(s.r, (s.g * 2.0 - 1.0) * radius);
}

/** a frame's direction (toward the camera), right and up (right x up = d), from the pole (z), or y along it */
struct ImpostorFrame {
    d: vec3<f32>,
    right: vec3<f32>,
    up: vec3<f32>,
    /** where the ray meets the frame's plane, in its uv */
    uv: vec2<f32>,
};

fn impostorFrame(frame: vec2<f32>, o: vec3<f32>, r: vec3<f32>, radius: f32) -> ImpostorFrame {
    var f: ImpostorFrame;
    f.d = impostorDecode(frame / (ImpostorViews - 1.0));
    let u = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(f.d.z) < 0.999);
    f.right = normalize(cross(u, f.d));
    f.up = cross(f.d, f.right);
    let p = o - r * (dot(o, f.d) / dot(r, f.d));
    f.uv = vec2<f32>(dot(p, f.right), dot(p, f.up)) / (2.0 * radius) + 0.5;
    return f;
}

struct ImpostorHit {
    hit: bool,
    modelPosition: vec3<f32>,
    viewPosition: vec3<f32>,
    /** outward, view space */
    normal: vec3<f32>,
    depth: f32,
};

/** the copy's surface along the fragment's ray from the three views nearest the camera's direction, blended */
fn impostorHit(sphere: vec4<f32>, point: vec3<f32>, impostorX: vec4<f32>, impostorY: vec4<f32>) -> ImpostorHit {
    var h: ImpostorHit;
    h.hit = false;
    let X = impostorX.xyz;
    let Y = impostorY.xyz;
    let Z = cross(X, Y);
    let center = -sphere.xyz;
    let radius = sphere.w;
    let ortho = uGlobal.uIsOrtho == 1.0;
    let rayOrigin = select(vec3<f32>(0.0), point, ortho);
    let rayDirection = select(normalize(point), vec3<f32>(0.0, 0.0, -1.0), ortho);
    let a = rayOrigin - center;
    let o = a.x * X + a.y * Y + a.z * Z;
    let r = rayDirection.x * X + rayDirection.y * Y + rayDirection.z * Z;
    let v = select(normalize(-center), vec3<f32>(0.0, 0.0, 1.0), ortho);
    let w = v.x * X + v.y * Y + v.z * Z;

    let g = impostorEncode(w) * (ImpostorViews - 1.0);
    let ij = min(floor(g), vec2<f32>(ImpostorViews - 2.0));
    let fr = g - ij;
    let f0 = ij + vec2<f32>(1.0, 0.0);
    let f1 = ij + vec2<f32>(0.0, 1.0);
    var f2 = ij;
    var weight = vec3<f32>(fr.x, fr.y, 1.0 - fr.x - fr.y);
    if (fr.x + fr.y > 1.0) {
        f2 = ij + vec2<f32>(1.0);
        weight = vec3<f32>(1.0 - fr.y, 1.0 - fr.x, fr.x + fr.y - 1.0);
    }

    let entry = impostorEntry(impostorX.w);
    let v0 = impostorFrame(f0, o, r, radius);
    let v1 = impostorFrame(f1, o, r, radius);
    let v2 = impostorFrame(f2, o, r, radius);
    let s0 = impostorRead(entry, f0, v0.uv, radius);
    let s1 = impostorRead(entry, f1, v1.uv, radius);
    let s2 = impostorRead(entry, f2, v2.uv, radius);
    let coverage = vec3<f32>(s0.x, s1.x, s2.x) * weight;
    let c = coverage.x + coverage.y + coverage.z;
    if (c < 0.35) {
        return h;
    }
    let height = dot(coverage, vec3<f32>(s0.y, s1.y, s2.y)) / c;

    // the ray's point at that height toward the camera
    let t = (height - dot(o, w)) / dot(r, w);
    h.viewPosition = rayOrigin + rayDirection * t;
    h.modelPosition = (uGlobal.uInvView * vec4<f32>(h.viewPosition, 1.0)).xyz;
    h.depth = calcDepth(h.viewPosition);

    // the normal from the height's slope in the nearest view, into view space
    var fn_ = f0;
    var vn = v0;
    if (weight.y > weight.x && weight.y >= weight.z) {
        fn_ = f1;
        vn = v1;
    } else if (weight.z > weight.x && weight.z > weight.y) {
        fn_ = f2;
        vn = v2;
    }
    let e = 1.0 / entry.z;
    let hx = impostorRead(entry, fn_, vn.uv + vec2<f32>(e, 0.0), radius).y - impostorRead(entry, fn_, vn.uv - vec2<f32>(e, 0.0), radius).y;
    let hy = impostorRead(entry, fn_, vn.uv + vec2<f32>(0.0, e), radius).y - impostorRead(entry, fn_, vn.uv - vec2<f32>(0.0, e), radius).y;
    let span = 2.0 * e * 2.0 * radius;
    let n = normalize(vec3<f32>(-hx / span, -hy / span, 1.0));
    let nObject = n.x * vn.right + n.y * vn.up + n.z * vn.d;
    h.normal = normalize(vec3<f32>(dot(nObject, X), dot(nObject, Y), dot(nObject, Z)));
    // far away flat: the normal toward the camera (the share 1 + flatness)
    h.normal = normalize(mix(h.normal, -normalize(h.viewPosition), clamp(impostorY.w - 1.0, 0.0, 1.0)));
    h.hit = true;
    return h;
}

/**
 * the band where the last spheres and the impostors both draw: a copy's pixel the level fading in's where the dither's
 * threshold is below the share, the one fading out's elsewhere (picking: half and half, no dither); coordinates
 * with a bottom-left origin as on WebGL
 */
fn impostorDithered(position: vec4<f32>, impostorY: vec4<f32>) -> bool {
    let fadeIn = impostorY.w >= 0.0;
    let share = select(-1.0 - impostorY.w, min(impostorY.w, 1.0), fadeIn);
    #if defined(dRenderVariant_pick)
        let at = 0.5;
    #else
        let coord = vec2<f32>(position.x, uGlobal.uDrawingBufferSize.y - position.y) + uGlobal.uViewOffset * 0.25;
        let thresholds = mat4x4<f32>(
            1.0 / 17.0, 9.0 / 17.0, 3.0 / 17.0, 11.0 / 17.0,
            13.0 / 17.0, 5.0 / 17.0, 15.0 / 17.0, 7.0 / 17.0,
            4.0 / 17.0, 12.0 / 17.0, 2.0 / 17.0, 10.0 / 17.0,
            16.0 / 17.0, 8.0 / 17.0, 14.0 / 17.0, 6.0 / 17.0
        );
        let at = thresholds[i32(coord.x) % 4][i32(coord.y) % 4];
    #endif
    return select(share > at, share <= at, fadeIn);
}
#endif
`;
