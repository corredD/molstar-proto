/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

/** Colors by size on screen (`color-levels.md`): the TS rule is `ColorLevels.blend`; as `color-levels.glsl.ts` */
export const color_levels_wgsl = /* wgsl */ `
#if defined(dColorLevels)
    fn toOklab(c: vec3<f32>) -> vec3<f32> {
        let r = select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c < vec3<f32>(0.04045));
        let lms = pow(vec3<f32>(
            dot(vec3<f32>(0.4122214708, 0.5363325363, 0.0514459929), r),
            dot(vec3<f32>(0.2119034982, 0.6806995451, 0.1073969566), r),
            dot(vec3<f32>(0.0883024619, 0.2817188376, 0.6299787005), r)
        ), vec3<f32>(1.0 / 3.0));
        return vec3<f32>(
            dot(vec3<f32>(0.2104542553, 0.793617785, -0.0040720468), lms),
            dot(vec3<f32>(1.9779984951, -2.428592205, 0.4505937099), lms),
            dot(vec3<f32>(0.0259040371, 0.7827717662, -0.808675766), lms)
        );
    }

    fn fromOklab(c: vec3<f32>) -> vec3<f32> {
        var lms = vec3<f32>(
            dot(vec3<f32>(1.0, 0.3963377774, 0.2158037573), c),
            dot(vec3<f32>(1.0, -0.1055613458, -0.0638541728), c),
            dot(vec3<f32>(1.0, -0.0894841775, -1.291485548), c)
        );
        lms = lms * lms * lms;
        let r = clamp(vec3<f32>(
            dot(vec3<f32>(4.0767416621, -3.3077115913, 0.2309699292), lms),
            dot(vec3<f32>(-1.2684380046, 2.6097574011, -0.3413193965), lms),
            dot(vec3<f32>(-0.0041960863, -0.7034186147, 1.707614701), lms)
        ), vec3<f32>(0.0), vec3<f32>(1.0));
        return select(1.055 * pow(r, vec3<f32>(1.0 / 2.4)) - 0.055, 12.92 * r, r < vec3<f32>(0.0031308));
    }

    // the pixels an atom (3.4 Å, \`ColorLevels.AtomSize\`) covers: the unit, in one place
    fn colorLevelSize(modelPosition: vec3<f32>) -> f32 {
        var pixel = 2.0 * uGlobal.uPixelRatio / (uGlobal.uProjection[1][1] * uGlobal.uDrawingBufferSize.y);
        if (uGlobal.uIsOrtho == 0.0) {
            pixel *= (dot(uGlobal.uCameraPlane.xyz, modelPosition) + uGlobal.uCameraPlane.w) / uGlobal.uModelScale;
        }
        return 3.4 / pixel;
    }

    // \`entity\` toward the far color below the entity edge, its chain's, then the element's (\`near\`)
    fn colorLevels(entity: vec3<f32>, far: vec3<f32>, near: vec4<f32>, size: f32) -> vec3<f32> {
        let h = 0.5 * uMaterial.uColorLevelBand;
        let t = smoothstep(vec3<f32>(-h), vec3<f32>(h), vec3<f32>(log2(size)) - uMaterial.uColorLevelEdges);
        let e = toOklab(entity);
        var c = mix(toOklab(far), e, t.x);
        let o = (floor(near.a * 255.0 + 0.5) - 128.0) / 127.0;
        let angle = 0.5 * o * uMaterial.uColorLevelChainHue;
        let ca = cos(angle);
        let sa = sin(angle);
        c = mix(c, vec3<f32>(e.x + 0.05 * o, e.y * ca - e.z * sa, e.y * sa + e.z * ca), t.y);
        return fromOklab(mix(c, toOklab(near.rgb), t.z));
    }
#endif
`;

/** The color of the vertex by its size on screen, after `vColor` is read (overpaint mixes over it) */
export const assign_color_levels_wgsl = /* wgsl */ `
#if defined(dColorLevels) && defined(dColorType_texture)
    out.vColor = vec4<f32>(colorLevels(out.vColor.rgb, read_tColorFar(instanceIndex).rgb, read_tColorNear(groupIndex), colorLevelSize(out.vModelPosition)), 1.0);
#endif
`;
