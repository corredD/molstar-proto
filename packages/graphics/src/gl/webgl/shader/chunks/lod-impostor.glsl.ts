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
 * impostor at its bounding sphere; `lodImpostorCenter` the copy's center, by which a copy chooses its level whole
 */
export const assign_lod_impostor = `
#if defined(dLodImpostor)
    #if defined(dSegmented)
        float lodImpostorScale = uLodLevel == 0 ? aSegmentLod.x : (uLodLevel == 1 ? aSegmentLod.y : (uLodLevel == 2 ? aSegmentLod.z : aSegmentLod.w));
    #else
        float lodImpostorScale = uLod.w;
    #endif
    // a model scale draws every level (\`assign_lod_factor\`): the spheres there, not the impostors
    bool lodImpostor = uLod.w != 0.0 && lodImpostorScale < 0.0 && uModelScale == 1.0;
    float lodImpostorShare = -1.0;
    vec4 lodImpostorSphere = InvariantBoundingSphere;
    vec3 lodImpostorCenter = (uModel * transform * vec4(lodImpostorSphere.xyz, 1.0)).xyz;
    if (lodImpostor) position = lodImpostorSphere.xyz;
#endif
`;

/**
 * Within \`assign_lod_factor\`'s range test: the copy's distance chooses its level (\`lodImpostorCenter\`), whole copies
 * switch; no level shrinks its spheres; the impostors' share \`lodImpostorShare\` over the band (the overlap) where both
 * draw, the impostors fading in at their start and the last spheres out at their end
 */
export const assign_lod_impostor_factor = `
    float d = (dot(uCameraPlane.xyz, lodImpostorCenter) + uCameraPlane.w) / uModelScale;
    lodFactor = lodImpostor ? 1.0 : lodScale;
    lodCulled = d < uLod.x || d > uLod.y;
    // the band's share of the next level: a level fading in (its overlap negated) keeps where it is above the dither,
    // one fading out (\`lodImpostorShare\` -1 - share) where it is not
    if (uLod.z < 0.0) {
        lodImpostorShare = smoothstep(uLod.x, uLod.x - uLod.z, d);
    } else if (uLod.z > 0.0) {
        lodImpostorShare = -1.0 - smoothstep(uLod.y - uLod.z, uLod.y, d);
    } else {
        lodImpostorShare = -1.0;
    }
`;

/** After the sphere's view-space center (\`mvPosition\`): the varyings */
export const assign_lod_impostor_varyings = `
#if defined(dLodImpostor)
    {
        // the rows of the copy's rotation into view space: the view's axes in its frame
        mat3 m = mat3(uModelView * transform);
        vImpostorX = vec4(normalize(vec3(m[0][0], m[1][0], m[2][0])), lodImpostor ? -lodImpostorScale - 1.0 : -1.0);
        vImpostorY = vec4(normalize(vec3(m[0][1], m[1][1], m[2][1])), lodImpostorShare);
        if (lodImpostor) vSphere.w = lodImpostorSphere.w * uModelScale;
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

    // coverage and front height (Å along the frame's direction) of frame \`frame\` at its plane coordinates \`uv\` (0 to 1)
    vec2 impostorRead(const in vec3 entry, const in vec2 frame, vec2 uv, const in float radius) {
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec2(0.0, -radius);
        float tile = entry.z;
        uv = clamp(uv, 0.5 / tile, 1.0 - 0.5 / tile);
        vec4 s = texture2D(tImpostor, (entry.xy + (frame + uv) * tile) / uImpostorTexDim);
        return vec2(s.r, (s.g * 2.0 - 1.0) * radius);
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
        vec2 s0 = impostorRead(entry, f0, uv0, radius);
        vec2 s1 = impostorRead(entry, f1, uv1, radius);
        vec2 s2 = impostorRead(entry, f2, uv2, radius);
        vec3 coverage = vec3(s0.x, s1.x, s2.x) * weight;
        float c = coverage.x + coverage.y + coverage.z;
        if (c < 0.5) return false;
        float h = dot(coverage, vec3(s0.y, s1.y, s2.y)) / c;

        // the ray's point at height h toward the camera
        float t = (h - dot(o, w)) / dot(r, w);
        cameraPos = rayOrigin + rayDirection * t;
        modelPos = (uInvView * vec4(cameraPos, 1.0)).xyz;
        fragmentDepth = calcDepth(cameraPos);

        // the normal from the height's slope in the nearest view, into view space
        vec2 fn = f0; vec2 uvn = uv0; vec3 dn = d0; vec3 rn = r0; vec3 un = u0;
        if (weight.y > weight.x && weight.y >= weight.z) { fn = f1; uvn = uv1; dn = d1; rn = r1; un = u1; }
        else if (weight.z > weight.x && weight.z > weight.y) { fn = f2; uvn = uv2; dn = d2; rn = r2; un = u2; }
        float e = 1.0 / entry.z;
        float hx = impostorRead(entry, fn, uvn + vec2(e, 0.0), radius).y - impostorRead(entry, fn, uvn - vec2(e, 0.0), radius).y;
        float hy = impostorRead(entry, fn, uvn + vec2(0.0, e), radius).y - impostorRead(entry, fn, uvn - vec2(0.0, e), radius).y;
        float span = 2.0 * e * 2.0 * radius;
        vec3 n = normalize(vec3(-hx / span, -hy / span, 1.0));
        vec3 nObject = n.x * rn + n.y * un + n.z * dn;
        cameraNormal = normalize(vec3(dot(nObject, X), dot(nObject, Y), dot(nObject, Z)));
        return true;
    }

    // the band where the last spheres and the impostors both draw: a copy's pixel the level fading in's where the
    // dither's threshold is below the share, the one fading out's elsewhere (picking: half and half, no dither)
    bool impostorDithered() {
        bool fadeIn = vImpostorY.w >= 0.0;
        float share = fadeIn ? vImpostorY.w : -1.0 - vImpostorY.w;
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
