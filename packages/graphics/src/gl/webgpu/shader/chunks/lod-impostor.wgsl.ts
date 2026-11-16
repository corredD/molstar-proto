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
export const lod_impostor_varyings_wgsl = /* wgsl */ `#if defined(dLodImpostorLevel)
    @location(12) @interpolate(flat) vImpostorX: vec4<f32>,
#endif
#if defined(dLodImpostorLevel) || defined(dLodImpostorBand)
    @location(13) @interpolate(flat) vImpostorY: vec4<f32>,
#endif`;

/**
 * After \`transform\` (before \`out.vModelPosition\`): the level's scale (the member's, merged) below 0 draws the copy
 * as an impostor at its bounding sphere; \`lodImpostorCenter\` the copy's center, by which a copy chooses its level whole
 */
export const assign_lod_impostor_wgsl = /* wgsl */ `
#if defined(dLodImpostorLevel) || defined(dLodImpostorBand)
    #if defined(dLodImpostorLevel)
        #if defined(dSegmented)
            let lodImpostorScale = segmentLod(in)[clamp(uDraw.uLodLevel, 0, 3)];
        #else
            let lodImpostorScale = uDraw.uLod.w;
        #endif
        // also at a model scale (XR), where one level an object is drawn (\`cullSimple\`), far away the impostors'
        let lodImpostor = uDraw.uLod.w != 0.0 && lodImpostorScale < 0.0;
    #else
        // the band's program: the last spheres
        let lodImpostor = false;
    #endif
    var lodImpostorShare = -1.0;
    // the copy's sphere where the impostors and the last spheres meet (the band's levels: an overlap), by which a copy
    // chooses its level whole; the other levels by sphere (the copy's sphere read per vertex costs where they are many)
    let lodImpostorWhole = lodImpostor || (uDraw.uLod.w != 0.0 && uDraw.uLod.z != 0.0);
    var lodImpostorSphere = vec4<f32>(0.0);
    var lodImpostorCenter = vec3<f32>(0.0);
    if (lodImpostorWhole) {
        lodImpostorSphere = invariantBoundingSphere(in);
        lodImpostorCenter = (uGlobal.uModel * (transform * vec4<f32>(lodImpostorSphere.xyz, 1.0))).xyz;
        if (lodImpostor) {
            position = lodImpostorSphere.xyz;
        }
    }
#endif
`;

/**
 * Within \`assign_lod_factor_wgsl\`'s range test: the copy's distance chooses its level (\`lodImpostorCenter\`), whole
 * copies switch; no level shrinks its spheres; the impostors' share over the band (the overlap) where both draw
 */
export const assign_lod_impostor_factor_wgsl = /* wgsl */ `
            // the sphere's distance at the start of a sphere level (as the level before ends), the copy's at the band
            let plane = uGlobal.uCameraPlane;
            let dSphere = (dot(plane.xyz, out.vModelPosition) + plane.w) / uGlobal.uModelScale;
            let d = select(dSphere, (dot(plane.xyz, lodImpostorCenter) + plane.w) / uGlobal.uModelScale, lodImpostorWhole);
            lodFactor = select(lodScale, 1.0, lodImpostor);
            lodCulled = select(dSphere, d, lodImpostor) < lod.x || d > lod.y;
            // the band's share of the next level: a level fading in (its overlap negated) keeps where it is above the
            // dither, one fading out (-1 - share) where it is not
            let sw = uObject.uLodImpostorSwitch;
            if (sw.x > 0.0 && lodImpostorWhole) {
                // a switch per copy (\`ImpostorAtlas.switchShare\`): by its own size on screen (its bounding sphere, in CSS
                // pixels) or its distance from the eye; the band half an octave each way of the threshold, then the
                // flattening
                // the culling's view (\`LodView.set\`): the camera's CSS height, the lod scale (coarser while moving)
                let pixel = 2.0 * uGlobal.uLodScale / (uGlobal.uProjection[1][1] * uGlobal.uCssHeight) * select(d, 1.0, uGlobal.uIsOrtho == 1.0);
                let ratio = select(
                    distance(lodImpostorCenter, uGlobal.uCameraPosition) / uGlobal.uModelScale / sw.y,
                    sw.y * pixel / (2.0 * select(lodImpostorSphere.w, min(lodImpostorSphere.w, sw.w), sw.w > 0.0)),
                    sw.x == 1.0
                );
                let l = log2(max(ratio, 1e-30));
                let h = sw.z;
                let s = smoothstep(-h, h, l);
                // the role by the overlap's sign (\`LodView.getRange\`): the last level fades in (also a small item's spheres)
                let fadeIn = lod.z < 0.0;
                lodImpostorShare = select(-1.0 - s, s + clamp((l - h) / ImpostorFlatOctaves, 0.0, 1.0), fadeIn);
                if (select(s >= 1.0, s <= 0.0, fadeIn)) {
                    lodCulled = true;
                }
            } else if (lod.z < 0.0) {
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
#if defined(dLodImpostorBand)
    out.vImpostorY = vec4<f32>(0.0, 0.0, 0.0, lodImpostorShare);
#elif defined(dLodImpostorLevel)
    // the rows of the copy's rotation into view space: the view's axes in its frame (impostors only: per vertex, the
    // spheres' vertex stage is what far views cost)
    out.vImpostorX = vec4<f32>(0.0, 0.0, 0.0, -1.0);
    out.vImpostorY = vec4<f32>(0.0, 0.0, 0.0, lodImpostorShare);
    if (lodImpostor) {
        let mv = uGlobal.uModelView;
        let m = mat3x3<f32>(mv[0].xyz, mv[1].xyz, mv[2].xyz) * mat3x3<f32>(transform[0].xyz, transform[1].xyz, transform[2].xyz);
        out.vImpostorX = vec4<f32>(normalize(vec3<f32>(m[0][0], m[1][0], m[2][0])), -lodImpostorScale - 1.0);
        out.vImpostorY = vec4<f32>(normalize(vec3<f32>(m[0][1], m[1][1], m[2][1])), lodImpostorShare);
        radius = lodImpostorSphere.w * modelScale;
        // stochastic simplification (\`ImpostorAtlas.thinFactor\`): below \`uImpostorThin.x\` px across a share of the
        // copies kept by their hash, larger; the others shrink out, then are culled (the GPU culling drops them first)
        let thin = uObject.uImpostorThin.x;
        if (thin > 0.0) {
            let dCopy = (dot(uGlobal.uCameraPlane.xyz, lodImpostorCenter) + uGlobal.uCameraPlane.w) / uGlobal.uModelScale;
            let pixelT = 2.0 * uGlobal.uLodScale / (uGlobal.uProjection[1][1] * uGlobal.uCssHeight) * select(dCopy, 1.0, uGlobal.uIsOrtho == 1.0);
            let size = 2.0 * lodImpostorSphere.w / pixelT;
            if (size < thin) {
                let p = max(ImpostorThinMinKeep, (size / thin) * (size / thin));
                #if defined(dSegmented)
                    let hash = impostorCopyHash(u32(in.aSegment.w), u32(in.aInstance));
                #else
                    let hash = impostorCopyHash(0u, u32(in.aInstance));
                #endif
                let end = p * (1.0 + ImpostorThinFade);
                let t = smoothstep(p, end, hash);
                let factor = select(inverseSqrt(min(1.0, p * ImpostorThinArea)) * (1.0 - t), 0.0, hash >= end);
                if (factor <= 0.0) {
                    lodCulled = true;
                }
                radius *= factor;
            }
        }
    }
#endif
`;

/** The fragment stage's functions (\`ImpostorAtlas\`'s rule) */
export const lod_impostor_wgsl = /* wgsl */ `
#if defined(dLodImpostorLevel) || defined(dLodImpostorBand)
/** octaves of distance beyond the band over which the impostors' shading flattens to their color (Goodsell's look) */
const ImpostorFlatOctaves = 1.0;
#endif
#if defined(dLodImpostorLevel)
/** stochastic simplification (\`ImpostorAtlas\`: ThinMinKeep, ThinFade, ThinArea, copyHash) */
const ImpostorThinMinKeep = 1.0 / 64.0;
const ImpostorThinFade = 0.25;
const ImpostorThinArea = 1.0 + ImpostorThinFade * 13.0 / 35.0;
fn impostorCopyHash(segment: u32, instance: u32) -> f32 {
    var x = (segment * 0x9e3779b1u) ^ instance;
    x = x * 747796405u + 2891336453u;
    let word = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    return f32((word >> 22u) ^ word) / 4294967296.0;
}
const ImpostorViews = 9.0;
/** a copy of a radius below this many pixels reads its nearest view alone */
const ImpostorOneViewPixels = 4.0;

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
    // in integers: a float division may round across a bit at the top of the 22
    let c = u32(code + 0.5);
    let t = c >> 20u;
    let y = (c >> 10u) & 1023u;
    let x = c & 1023u;
    return vec3<f32>(f32(x) * 8.0, f32(y) * 8.0, 8.0 * exp2(f32(t)));
}

/**
 * coverage, front height (Å along the frame's direction) and the front's normal's x, y in the frame, of frame \`frame\`
 * at its plane coordinates \`uv\` (0 to 1)
 */
fn impostorRead(entry: vec3<f32>, frame: vec2<f32>, uvIn: vec2<f32>, radius: f32) -> vec4<f32> {
    if (uvIn.x < 0.0 || uvIn.y < 0.0 || uvIn.x > 1.0 || uvIn.y > 1.0) {
        return vec4<f32>(0.0, -radius, 0.0, 0.0);
    }
    let tile = entry.z;
    let uv = clamp(uvIn, vec2<f32>(0.5 / tile), vec2<f32>(1.0 - 0.5 / tile));
    let s = textureSampleLevel(tImpostor, sLinear, (entry.xy + (frame + uv) * tile) / uObject.uImpostorTexDim, 0.0);
    return vec4<f32>(s.r, (s.g * 2.0 - 1.0) * radius, s.ba * 2.0 - 1.0);
}


/** a frame's direction (toward the camera), right and up (right x up = d), from the pole (z), or y along it */
struct ImpostorFrame {
    d: vec3<f32>,
    right: vec3<f32>,
    up: vec3<f32>,
    /** where the ray meets the frame's plane, in its uv */
    uv: vec2<f32>,
};

/** where the ray (\`o\` + t \`r\`, in the copy's frame from its center) meets frame \`f\`'s plane at height \`h\`, in its uv */
fn impostorPlaneAt(f: ImpostorFrame, o: vec3<f32>, r: vec3<f32>, radius: f32, h: f32) -> vec2<f32> {
    let p = o + r * ((h - dot(o, f.d)) / dot(r, f.d));
    return vec2<f32>(dot(p, f.right), dot(p, f.up)) / (2.0 * radius) + 0.5;
}

/** frame \`frame\`, the ray meeting its plane at the height of the ray's point nearest the center (\`nearest\`: in the tile) */
fn impostorFrame(frame: vec2<f32>, o: vec3<f32>, r: vec3<f32>, radius: f32, nearest: vec3<f32>) -> ImpostorFrame {
    var f: ImpostorFrame;
    f.d = impostorDecode(frame / (ImpostorViews - 1.0));
    let u = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(f.d.z) < 0.999);
    f.right = normalize(cross(u, f.d));
    f.up = cross(f.d, f.right);
    f.uv = impostorPlaneAt(f, o, r, radius, dot(nearest, f.d));
    return f;
}

/** reads of a view at the height read before (\`ImpostorAtlas.ParallaxSteps\`) */
const ImpostorParallaxSteps = 1;

/**
 * a view read where the ray meets its front (\`ImpostorAtlas.hit\`): at its uv, then at the height read there, so that
 * the three views agree on what lies off their planes (an elongated copy's views ghosted, jumping as it turned)
 */
fn impostorReadFront(entry: vec3<f32>, frame: vec2<f32>, f: ImpostorFrame, o: vec3<f32>, r: vec3<f32>, radius: f32) -> vec4<f32> {
    var s = impostorRead(entry, frame, f.uv, radius);
    for (var i = 0; i < ImpostorParallaxSteps; i++) {
        if (s.x <= 0.0) {
            break;
        }
        s = impostorRead(entry, frame, impostorPlaneAt(f, o, r, radius, s.y), radius);
    }
    return s;
}

/** a view's normal (x, y in its frame, z toward the camera) in the copy's frame */
fn impostorNormal(n: vec2<f32>, f: ImpostorFrame) -> vec3<f32> {
    return n.x * f.right + n.y * f.up + sqrt(max(1.0 - dot(n, n), 0.0)) * f.d;
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
    var f0 = ij + vec2<f32>(1.0, 0.0);
    let f1 = ij + vec2<f32>(0.0, 1.0);
    var f2 = ij;
    var weight = vec3<f32>(fr.x, fr.y, 1.0 - fr.x - fr.y);
    if (fr.x + fr.y > 1.0) {
        f2 = ij + vec2<f32>(1.0);
        weight = vec3<f32>(1.0 - fr.y, 1.0 - fr.x, fr.x + fr.y - 1.0);
    }
    // a copy a few pixels across: its nearest view alone (one read, not three: millions of small copies far away)
    let pixel = 2.0 * uGlobal.uLodScale / (uGlobal.uProjection[1][1] * uGlobal.uCssHeight) * select(-center.z, 1.0, ortho);
    let oneView = radius < ImpostorOneViewPixels * pixel;
    if (oneView) {
        if (weight.y > weight.x && weight.y >= weight.z) {
            f0 = f1;
        } else if (weight.z > weight.x && weight.z > weight.y) {
            f0 = f2;
        }
        weight = vec3<f32>(1.0, 0.0, 0.0);
    }

    let entry = impostorEntry(impostorX.w);
    // the ray's point nearest the copy's center
    let nearest = o - r * dot(o, r);
    let v0 = impostorFrame(f0, o, r, radius, nearest);
    let v1 = impostorFrame(f1, o, r, radius, nearest);
    let v2 = impostorFrame(f2, o, r, radius, nearest);
    var s0 = vec4<f32>(0.0);
    var s1 = vec4<f32>(0.0);
    var s2 = vec4<f32>(0.0);
    if (oneView) {
        s0 = impostorRead(entry, f0, v0.uv, radius);
    } else {
        s0 = impostorReadFront(entry, f0, v0, o, r, radius);
        s1 = impostorReadFront(entry, f1, v1, o, r, radius);
        s2 = impostorReadFront(entry, f2, v2, o, r, radius);
    }
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

    // the views' normals blended as their heights, into view space
    let nObject = coverage.x * impostorNormal(s0.zw, v0) + coverage.y * impostorNormal(s1.zw, v1) + coverage.z * impostorNormal(s2.zw, v2);
    h.normal = normalize(vec3<f32>(dot(nObject, X), dot(nObject, Y), dot(nObject, Z)));
    // far away flat: the normal toward the camera (the share 1 + flatness)
    h.normal = normalize(mix(h.normal, -normalize(h.viewPosition), clamp(impostorY.w - 1.0, 0.0, 1.0)));
    h.hit = true;
    return h;
}

#endif

#if defined(dLodImpostorLevel) || defined(dLodImpostorBand)
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
