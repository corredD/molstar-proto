/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/**
 * The last level of detail of spheres as octahedral impostors (`lod-impostor.md`): the TS rule is `ImpostorAtlas`
 * (the map, the frames, the three views, the entry); the levels and the band are `getLodLevelsValue`'s.
 */

/**
 * The varyings (\`out\` in the vertex stage, \`in\` in the fragment stage): the view's x and y axes in the copy's frame,
 * the entry (-1 for spheres) and the impostors' share of the band
 */
export function lod_impostor_varyings(qualifier: 'out' | 'in') {
  return `
#if defined(dLodImpostor)
    #if __VERSION__ == 100
        varying vec4 vImpostorX;
        varying vec4 vImpostorY;
    #else
        flat ${qualifier} vec4 vImpostorX;
        flat ${qualifier} vec4 vImpostorY;
    #endif
#endif
`;
}

/**
 * After `transform` (before `vModelPosition`): the level's scale (the member's, merged) below 0 draws the copy as an
 * impostor at its bounding sphere; `lodImpostorCenter` the copy's center, by which a copy chooses its level whole where
 * the impostors and the last spheres meet (the band's levels: an overlap; the others by sphere, as without impostors:
 * the copy's sphere read per vertex costs where the spheres are many)
 */
export const assign_lod_impostor = `
#if defined(dLodImpostor)
    // octaves of distance beyond the band over which the impostors' shading flattens to their color (Goodsell's look)
    const float ImpostorFlatOctaves = 1.0;
    #if defined(dSegmented)
        float lodImpostorScale = uLodLevel == 0 ? aSegmentLod.x : (uLodLevel == 1 ? aSegmentLod.y : (uLodLevel == 2 ? aSegmentLod.z : aSegmentLod.w));
    #else
        float lodImpostorScale = uLod.w;
    #endif
    // also at a model scale (XR), where one level an object is drawn (\`cullSimple\`), far away the impostors'
    bool lodImpostor = uLod.w != 0.0 && lodImpostorScale < 0.0;
    float lodImpostorShare = -1.0;
    bool lodImpostorWhole = lodImpostor || (uLod.w != 0.0 && uLod.z != 0.0);
    vec4 lodImpostorSphere = vec4(0.0);
    vec3 lodImpostorCenter = vec3(0.0);
    if (lodImpostorWhole) {
        lodImpostorSphere = InvariantBoundingSphere;
        lodImpostorCenter = (uModel * (transform * vec4(lodImpostorSphere.xyz, 1.0))).xyz;
        if (lodImpostor) position = lodImpostorSphere.xyz;
    }
#endif
`;

/**
 * Within \`assign_lod_factor\`'s range test: the copy's distance chooses its level (\`lodImpostorCenter\`), whole copies
 * switch; no level shrinks its spheres; the impostors' share \`lodImpostorShare\` over the band (the overlap) where both
 * draw, the impostors fading in at their start and the last spheres out at their end
 */
export const assign_lod_impostor_factor = `
    // the sphere's distance at the start of a sphere level (as the level before ends), the copy's at the band
    float dSphere = (dot(uCameraPlane.xyz, vModelPosition) + uCameraPlane.w) / uModelScale;
    float d = lodImpostorWhole ? (dot(uCameraPlane.xyz, lodImpostorCenter) + uCameraPlane.w) / uModelScale : dSphere;
    lodFactor = lodImpostor ? 1.0 : lodScale;
    lodCulled = (lodImpostor ? d : dSphere) < uLod.x || d > uLod.y;
    // the band's share of the next level: a level fading in (its overlap negated) keeps where it is above the dither,
    // one fading out (\`lodImpostorShare\` -1 - share) where it is not
    if (uLod.z < 0.0) {
        // beyond the band, the impostors flatten over an octave (\`ImpostorFlatOctaves\`): 1 + flatness
        float bandEnd = uLod.x - uLod.z;
        lodImpostorShare = smoothstep(uLod.x, bandEnd, d) + clamp(log2(max(d, bandEnd) / bandEnd) / ImpostorFlatOctaves, 0.0, 1.0);
    } else if (uLod.z > 0.0) {
        lodImpostorShare = -1.0 - smoothstep(uLod.y - uLod.z, uLod.y, d);
    } else {
        lodImpostorShare = -1.0;
    }
`;

/** After the sphere's view-space center (\`mvPosition\`): the varyings */
export const assign_lod_impostor_varyings = `
#if defined(dLodImpostor)
    // the rows of the copy's rotation into view space: the view's axes in its frame (impostors only: per vertex, the
    // spheres' vertex stage is what far views cost)
    if (lodImpostor) {
        mat3 m = mat3(uModelView) * mat3(transform);
        vImpostorX = vec4(normalize(vec3(m[0][0], m[1][0], m[2][0])), -lodImpostorScale - 1.0);
        vImpostorY = vec4(normalize(vec3(m[0][1], m[1][1], m[2][1])), lodImpostorShare);
        vSphere.w = lodImpostorSphere.w * uModelScale;
    } else {
        vImpostorX = vec4(0.0, 0.0, 0.0, -1.0);
        vImpostorY = vec4(0.0, 0.0, 0.0, lodImpostorShare);
    }
#endif
`;

/** The fragment stage's functions (\`ImpostorAtlas\`'s rule) */
export const lod_impostor_frag = `
#if defined(dLodImpostor)
    const float ImpostorViews = 9.0;

    vec2 impostorEncode(vec3 d) {
        d /= abs(d.x) + abs(d.y) + abs(d.z);
        vec2 p = d.xy;
        if (d.z < 0.0) {
            p = (1.0 - abs(d.yx)) * vec2(d.x >= 0.0 ? 1.0 : -1.0, d.y >= 0.0 ? 1.0 : -1.0);
        }
        return p * 0.5 + 0.5;
    }

    vec3 impostorDecode(vec2 uv) {
        vec2 p = uv * 2.0 - 1.0;
        float z = 1.0 - abs(p.x) - abs(p.y);
        float t = max(-z, 0.0);
        p += vec2(p.x >= 0.0 ? -t : t, p.y >= 0.0 ? -t : t);
        return normalize(vec3(p, z));
    }

    // the frame's right and up (right x up = d), from the pole (z), or y along it
    void impostorBasis(const in vec3 d, out vec3 right, out vec3 up) {
        vec3 u = abs(d.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        right = normalize(cross(u, d));
        up = cross(d, right);
    }

    // the entry's corner (texels) and tile from its code (\`ImpostorAtlas.decodeEntry\`)
    vec3 impostorEntry(const in float code) {
        float t = floor(code / 262144.0 + 1e-4);
        float rest = code - t * 262144.0;
        float y = floor(rest / 512.0 + 1e-4);
        return vec3((rest - y * 512.0) * 8.0, y * 8.0, 8.0 * exp2(t));
    }

    // coverage, front height (Å along the frame's direction) and the front's normal's x, y in the frame, of frame
    // \`frame\` at its plane coordinates \`uv\` (0 to 1)
    vec4 impostorRead(const in vec3 entry, const in vec2 frame, vec2 uv, const in float radius) {
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0, -radius, 0.0, 0.0);
        float tile = entry.z;
        uv = clamp(uv, 0.5 / tile, 1.0 - 0.5 / tile);
        vec4 s = texture2D(tImpostor, (entry.xy + (frame + uv) * tile) / uImpostorTexDim);
        return vec4(s.r, (s.g * 2.0 - 1.0) * radius, s.ba * 2.0 - 1.0);
    }

    // a view's normal (x, y in its frame, z toward the camera) in the copy's frame
    vec3 impostorNormal(const in vec2 n, const in vec3 d, const in vec3 right, const in vec3 up) {
        return n.x * right + n.y * up + sqrt(max(1.0 - dot(n, n), 0.0)) * d;
    }

    // where the ray (\`o\` + t \`r\`, in the copy's frame from its center) meets the plane of frame \`frame\`, in its uv
    vec2 impostorPlane(const in vec2 frame, const in vec3 o, const in vec3 r, const in float radius, out vec3 d, out vec3 right, out vec3 up) {
        d = impostorDecode(frame / (ImpostorViews - 1.0));
        impostorBasis(d, right, up);
        vec3 p = o - r * (dot(o, d) / dot(r, d));
        return vec2(dot(p, right), dot(p, up)) / (2.0 * radius) + 0.5;
    }

    // the copy's surface along the fragment's ray from the three views nearest the camera's direction, blended
    bool impostorHit(out vec3 modelPos, out vec3 cameraPos, out vec3 cameraNormal, out float fragmentDepth) {
        vec3 X = vImpostorX.xyz;
        vec3 Y = vImpostorY.xyz;
        vec3 Z = cross(X, Y);
        vec3 center = -vSphere.xyz;
        float radius = vSphere.w;
        vec3 rayOrigin = uIsOrtho == 1.0 ? vPoint : vec3(0.0);
        vec3 rayDirection = uIsOrtho == 1.0 ? vec3(0.0, 0.0, -1.0) : normalize(vPoint);
        vec3 a = rayOrigin - center;
        vec3 o = a.x * X + a.y * Y + a.z * Z;
        vec3 r = rayDirection.x * X + rayDirection.y * Y + rayDirection.z * Z;
        vec3 v = uIsOrtho == 1.0 ? vec3(0.0, 0.0, 1.0) : normalize(-center);
        vec3 w = v.x * X + v.y * Y + v.z * Z;

        vec2 g = impostorEncode(w) * (ImpostorViews - 1.0);
        vec2 ij = min(floor(g), vec2(ImpostorViews - 2.0));
        vec2 f = g - ij;
        vec2 f0 = ij + vec2(1.0, 0.0);
        vec2 f1 = ij + vec2(0.0, 1.0);
        vec2 f2 = ij;
        vec3 weight = vec3(f.x, f.y, 1.0 - f.x - f.y);
        if (f.x + f.y > 1.0) {
            f2 = ij + vec2(1.0);
            weight = vec3(1.0 - f.y, 1.0 - f.x, f.x + f.y - 1.0);
        }

        vec3 entry = impostorEntry(vImpostorX.w);
        vec3 d0, r0, u0, d1, r1, u1, d2, r2, u2;
        vec2 uv0 = impostorPlane(f0, o, r, radius, d0, r0, u0);
        vec2 uv1 = impostorPlane(f1, o, r, radius, d1, r1, u1);
        vec2 uv2 = impostorPlane(f2, o, r, radius, d2, r2, u2);
        vec4 s0 = impostorRead(entry, f0, uv0, radius);
        vec4 s1 = impostorRead(entry, f1, uv1, radius);
        vec4 s2 = impostorRead(entry, f2, uv2, radius);
        vec3 coverage = vec3(s0.x, s1.x, s2.x) * weight;
        float c = coverage.x + coverage.y + coverage.z;
        if (c < 0.35) return false;
        float h = dot(coverage, vec3(s0.y, s1.y, s2.y)) / c;

        // the ray's point at height h toward the camera
        float t = (h - dot(o, w)) / dot(r, w);
        cameraPos = rayOrigin + rayDirection * t;
        modelPos = (uInvView * vec4(cameraPos, 1.0)).xyz;
        fragmentDepth = calcDepth(cameraPos);

        // the views' normals blended as their heights, into view space
        vec3 nObject = coverage.x * impostorNormal(s0.zw, d0, r0, u0) + coverage.y * impostorNormal(s1.zw, d1, r1, u1) + coverage.z * impostorNormal(s2.zw, d2, r2, u2);
        cameraNormal = normalize(vec3(dot(nObject, X), dot(nObject, Y), dot(nObject, Z)));
        // far away flat: the normal toward the camera (\`lodImpostorShare\` 1 + flatness)
        cameraNormal = normalize(mix(cameraNormal, -normalize(cameraPos), clamp(vImpostorY.w - 1.0, 0.0, 1.0)));
        return true;
    }

    // the band where the last spheres and the impostors both draw: a copy's pixel the level fading in's where the
    // dither's threshold is below the share, the one fading out's elsewhere (picking: half and half, no dither)
    bool impostorDithered() {
        bool fadeIn = vImpostorY.w >= 0.0;
        float share = fadeIn ? min(vImpostorY.w, 1.0) : -1.0 - vImpostorY.w;
        #if defined(dRenderVariant_pick)
            float at = 0.5;
        #else
            vec2 coord = gl_FragCoord.xy + uViewOffset * 0.25;
            int ci = int(intMod(coord.x, 4.0));
            int ri = int(intMod(coord.y, 4.0));
            const mat4 thresholdMatrix = mat4(
                1.0 / 17.0,  9.0 / 17.0,  3.0 / 17.0, 11.0 / 17.0,
                13.0 / 17.0,  5.0 / 17.0, 15.0 / 17.0,  7.0 / 17.0,
                4.0 / 17.0, 12.0 / 17.0,  2.0 / 17.0, 10.0 / 17.0,
                16.0 / 17.0,  8.0 / 17.0, 14.0 / 17.0,  6.0 / 17.0
            );
            #if __VERSION__ == 100
                vec4 i = vec4(float(ci * 4 + ri));
                vec4 m = thresholdMatrix[0] * vec4(equal(i, vec4(0.0, 1.0, 2.0, 3.0))) +
                    thresholdMatrix[1] * vec4(equal(i, vec4(4.0, 5.0, 6.0, 7.0))) +
                    thresholdMatrix[2] * vec4(equal(i, vec4(8.0, 9.0, 10.0, 11.0))) +
                    thresholdMatrix[3] * vec4(equal(i, vec4(12.0, 13.0, 14.0, 15.0)));
                float at = m.x + m.y + m.z + m.w;
            #else
                float at = thresholdMatrix[ci][ri];
            #endif
        #endif
        return fadeIn ? share <= at : share > at;
    }
#endif
`;
