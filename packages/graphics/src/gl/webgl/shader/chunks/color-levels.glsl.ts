/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/** Colors by size on screen (`color-levels.md`): the TS rule is `ColorLevels.blend`; needs `vModelPosition` set */
export const color_levels = `
#if defined(dColorLevels)
    vec3 toOklab(const in vec3 c) {
        vec3 r = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
        vec3 lms = pow(vec3(
            dot(vec3(0.4122214708, 0.5363325363, 0.0514459929), r),
            dot(vec3(0.2119034982, 0.6806995451, 0.1073969566), r),
            dot(vec3(0.0883024619, 0.2817188376, 0.6299787005), r)
        ), vec3(1.0 / 3.0));
        return vec3(
            dot(vec3(0.2104542553, 0.793617785, -0.0040720468), lms),
            dot(vec3(1.9779984951, -2.428592205, 0.4505937099), lms),
            dot(vec3(0.0259040371, 0.7827717662, -0.808675766), lms)
        );
    }

    vec3 fromOklab(const in vec3 c) {
        vec3 lms = vec3(
            dot(vec3(1.0, 0.3963377774, 0.2158037573), c),
            dot(vec3(1.0, -0.1055613458, -0.0638541728), c),
            dot(vec3(1.0, -0.0894841775, -1.291485548), c)
        );
        lms = lms * lms * lms;
        vec3 r = clamp(vec3(
            dot(vec3(4.0767416621, -3.3077115913, 0.2309699292), lms),
            dot(vec3(-1.2684380046, 2.6097574011, -0.3413193965), lms),
            dot(vec3(-0.0041960863, -0.7034186147, 1.707614701), lms)
        ), 0.0, 1.0);
        return mix(12.92 * r, 1.055 * pow(r, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), r));
    }

    // the pixels an atom (3.4 Å, \`ColorLevels.AtomSize\`) covers: the unit, in one place
    float colorLevelSize(const in vec3 modelPosition) {
        float pixel = 2.0 * uPixelRatio / (uProjection[1][1] * uDrawingBufferSize.y);
        if (uIsOrtho == 0.0) pixel *= max((dot(uCameraPlane.xyz, modelPosition) + uCameraPlane.w) / uModelScale, 0.01);
        return 3.4 / pixel;
    }

    // \`entity\` toward the far color below the entity edge, its chain's, then the element's (\`near\`)
    vec3 colorLevels(const in vec3 entity, const in vec3 far, const in vec4 near, const in float size) {
        float h = 0.5 * uColorLevelBand;
        vec3 t = smoothstep(vec3(-h), vec3(h), vec3(log2(size)) - uColorLevelEdges);
        vec3 e = toOklab(entity);
        vec3 c = mix(toOklab(far), e, t.x);
        float o = (floor(near.a * 255.0 + 0.5) - 128.0) / 127.0;
        float angle = 0.5 * o * uColorLevelChainHue;
        float ca = cos(angle);
        float sa = sin(angle);
        c = mix(c, vec3(e.x + 0.05 * o, e.y * ca - e.z * sa, e.y * sa + e.z * ca), t.y);
        return fromOklab(mix(c, toOklab(near.rgb), t.z));
    }
#endif
`;

/** The color of the vertex by its size on screen, after \`vColor\` is read (overpaint mixes over it) */
export const assign_color_levels = `
#if defined(dColorLevels) && defined(dColorType_texture)
    vColor.rgb = colorLevels(vColor.rgb, read_tColorFar(aInstance).rgb, read_tColorNear(groupIndex(group)), colorLevelSize(vModelPosition));
#endif
`;
