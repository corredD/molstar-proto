/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */
import { common } from './chunks/common.glsl.js';
import { read_from_texture } from './chunks/read-from-texture.glsl.js';
import { common_frag_params } from './chunks/common-frag-params.glsl.js';
import { common_clip } from './chunks/common-clip.glsl.js';
import { fade_lod } from './chunks/fade-lod.glsl.js';
import { clip_pixel } from './chunks/clip-pixel.glsl.js';
import { check_picking_alpha } from './chunks/check-picking-alpha.glsl.js';
import { apply_marking } from './chunks/apply-marking.glsl.js';
import { apply_marker_color } from './chunks/apply-marker-color.glsl.js';
import { apply_fog } from './chunks/apply-fog.glsl.js';
import { wboit_write } from './chunks/wboit-write.glsl.js';
import { dpoit_write } from './chunks/dpoit-write.glsl.js';

export const image_frag = `
precision highp float;
precision highp int;

${common}
${read_from_texture}
${common_frag_params}
${common_clip}

#if defined(dRenderVariant_color) || defined(dRenderVariant_tracing)
    #ifdef dOverpaint
        #if defined(dOverpaintType_texture)
            varying vec4 vOverpaint;
        #endif
    #endif
#endif

#if defined(dRenderVariant_color) || defined(dRenderVariant_tracing) || defined(dRenderVariant_emissive)
    #ifdef dEmissive
        #if defined(dEmissiveType_texture)
            varying float vEmissive;
        #endif
    #endif
#endif

#ifdef dTransparency
    #if defined(dTransparencyType_texture)
        varying float vTransparency;
    #endif
#endif

varying vec2 vUv;
varying float vInstance;
varying vec3 vPosition;

#if defined(dInterpolation_catmulrom) || defined(dInterpolation_mitchell) || defined(dInterpolation_bspline)
    #define dInterpolation_cubic
#endif

#ifdef dSliceWindow
    // a window of the slice's planes (ImageSchema.dSliceWindow): the raw value of the image's texel at uv, as the
    // texture of the image samples it (nearest, clamped), its rows flipped (the image's are uploaded flipped)
    float sliceValueAt(ivec2 p) {
        ivec2 size = ivec2(uImageTexDim);
        p = clamp(p, ivec2(0), size - 1);
        return texelFetch(tSliceTex, ivec3(p.x, size.y - 1 - p.y, uSliceLayer), 0).r;
    }

    float sliceValue(vec2 uv) {
        return sliceValueAt(ivec2(floor(uv * uImageTexDim)));
    }

    /** the value in the colors' domain, clamped: what the image's color stands for */
    vec4 sampleImage(vec2 uv) {
        float t = clamp((sliceValue(uv) - uSliceDomain.z) / (uSliceDomain.w - uSliceDomain.z), 0.0, 1.0);
        return vec4(t);
    }

    /** the value in the grid's range, as the image's texture of values samples it (linear) */
    float sliceRangeValue(vec2 uv) {
        vec2 st = uv * uImageTexDim - 0.5;
        vec2 f = fract(st);
        ivec2 p = ivec2(floor(st));
        float v = mix(
            mix(sliceValueAt(p), sliceValueAt(p + ivec2(1, 0)), f.x),
            mix(sliceValueAt(p + ivec2(0, 1)), sliceValueAt(p + ivec2(1, 1)), f.x),
            f.y
        );
        return (v - uSliceDomain.x) / (uSliceDomain.y - uSliceDomain.x);
    }
#else
    vec4 sampleImage(vec2 uv) {
        return texture2D(tImageTex, uv);
    }
#endif

#if defined(dInterpolation_cubic)
    #if defined(dInterpolation_catmulrom) || defined(dInterpolation_mitchell)
        #if defined(dInterpolation_catmulrom)
            const float B = 0.0;
            const float C = 0.5;
        #elif defined(dInterpolation_mitchell)
            const float B = 0.333;
            const float C = 0.333;
        #endif

        float cubicFilter(float x){
            float f = x;
            if (f < 0.0) {
                f = -f;
            }
            if (f < 1.0) {
                return ((12.0 - 9.0 * B - 6.0 * C) * (f * f * f) +
                    (-18.0 + 12.0 * B + 6.0 * C) * (f * f) +
                    (6.0 - 2.0 * B)) / 6.0;
            }else if (f >= 1.0 && f < 2.0){
                return ((-B - 6.0 * C) * ( f * f * f)
                    + (6.0 * B + 30.0 * C) * (f * f) +
                    (-(12.0 * B) - 48.0 * C) * f +
                    8.0 * B + 24.0 * C) / 6.0;
            }else{
                return 0.0;
            }
        }
    #elif defined(dInterpolation_bspline)
        float cubicFilter(float x) {
            float f = x;
            if (f < 0.0) {
                f = -f;
            }
            if (f >= 0.0 && f <= 1.0){
                return (2.0 / 3.0) + (0.5) * (f * f * f) - (f * f);
            } else if (f > 1.0 && f <= 2.0) {
                return 1.0 / 6.0 * pow((2.0 - f), 3.0);
            }
            return 1.0;
        }
    #endif

    vec4 biCubic(vec2 texCoord) {
        vec2 texelSize = 1.0 / uImageTexDim;
        texCoord -= texelSize / 2.0;
        vec4 nSum = vec4(0.0);
        float nDenom = 0.0;
        vec2 cell = fract(texCoord * uImageTexDim);
        for (float m = -1.0; m <= 2.0; ++m) {
            for (float n = -1.0; n <= 2.0; ++n) {
                vec4 vecData = sampleImage(texCoord + texelSize * vec2(m, n));
                float c = abs(cubicFilter(m - cell.x) * cubicFilter(-n + cell.y));
                nSum += vecData * c;
                nDenom += c;
            }
        }
        return nSum / nDenom;
    }
#endif

void main() {
    if (uTrimType != 0 && getSignedDistance(vPosition, uTrimType, uTrimCenter, uTrimRotation, uTrimScale, uTrimTransform) > 0.0) discard;

    ${fade_lod}
    ${clip_pixel}

    #if defined(dInterpolation_cubic)
        #if defined(dUsePalette) && !defined(dSliceWindow)
            vec4 material = sampleImage(vUv);
            if (material.rgb != vec3(1.0)) {
                material = biCubic(vUv);
            }
        #else
            vec4 material = biCubic(vUv);
        #endif
    #else
        vec4 material = sampleImage(vUv);
    #endif

    #ifdef dSliceWindow
        // the value in the domain (filtered) to its color: the palette's, or the uniform color times it
        #ifdef dUsePalette
            material.rgb = texture2D(tPalette, vec2(material.r, 0.0)).rgb;
        #else
            material.rgb = uColor * material.r;
        #endif
        material.a = 0.0;
    #endif

    if (uIsoLevel >= 0.0) {
        #ifdef dSliceWindow
            if (sliceRangeValue(vUv) < uIsoLevel) discard;
        #else
            if (texture2D(tValueTex, vUv).r < uIsoLevel) discard;
        #endif

        material.a = uAlpha;
    } else {
        if (material.a == 0.0) discard;

        material.a *= uAlpha;
    }

    float fragmentDepth = gl_FragCoord.z;

    vec3 packedGroup = texture2D(tGroupTex, vUv).rgb;
    float group = packedGroup == vec3(0.0) ? -1.0 : unpackRGBToInt(packedGroup);

    // apply per-group transparency
    #if defined(dTransparency) && (defined(dRenderVariant_pick) || defined(dRenderVariant_color) || defined(dRenderVariant_emissive) || defined(dRenderVariant_tracing) || defined(dRenderVariant_marking))
        float transparency = 0.0;
        #if defined(dTransparencyType_texture)
            // an empty pixel (no group) has no data
            if (group != -1.0) transparency = read_tTransparency((uInstanceGranularity ? vInstance : vInstance * float(uGroupCount) + group)).r;
        #endif
        transparency *= uTransparencyStrength;

        float ta = 1.0 - transparency;
        if (transparency < 0.09) ta = 1.0; // hard cutoff looks better

        #if defined(dRenderVariant_pick)
            if (ta * uAlpha < uPickingAlphaThreshold)
                discard; // ignore so the element below can be picked
        #elif defined(dRenderVariant_emissive)
            if (ta < 1.0)
                discard; // emissive not supported with transparency
        #elif defined(dRenderVariant_color) || defined(dRenderVariant_tracing) || defined(dRenderVariant_marking)
            material.a *= ta;
        #endif
    #endif

    if ((uRenderMask == MaskOpaque && material.a < 1.0) ||
        (uRenderMask == MaskTransparent && material.a == 1.0)
    ) {
        discard;
    }

    #if defined(dNeedsMarker)
        float marker = uMarker;
        if (group == -1.0) {
            marker = 0.0;
        } else if (uMarker == -1.0) {
            marker = read_tMarker((uInstanceGranularity ? vInstance : vInstance * float(uGroupCount) + group)).r;
            marker = floor(marker * 255.0 + 0.5); // rounding required to work on some cards on win
        }
    #endif

    #if defined(dRenderVariant_color) || defined(dRenderVariant_tracing) || defined(dRenderVariant_emissive)
        float emissive = uEmissive;
        if (group == -1.0) {
            emissive = 0.0;
        } else {
            #ifdef dEmissive
                #if defined(dEmissiveType_texture)
                    emissive += read_tEmissive((uInstanceGranularity ? vInstance : vInstance * float(uGroupCount) + group)).r * uEmissiveStrength;
                #endif
            #endif
        }
    #endif

    #if defined(dRenderVariant_pick)
        if (group == -1.0) discard;

        ${check_picking_alpha}
        #ifdef requiredDrawBuffers
            gl_FragColor = vec4(packIntToRGB(float(uObjectId)), 1.0);
            gl_FragData[1] = vec4(packIntToRGB(vInstance), 1.0);
            gl_FragData[2] = vec4(packIntToRGB(group), 1.0);
            gl_FragData[3] = packDepthToRGBA(fragmentDepth);
        #else
            if (uPickType == 1) {
                gl_FragColor = vec4(packIntToRGB(float(uObjectId)), 1.0);
            } else if (uPickType == 2) {
                gl_FragColor = vec4(packIntToRGB(vInstance), 1.0);
            } else {
                gl_FragColor = vec4(packIntToRGB(group), 1.0);
            }
        #endif
    #elif defined(dRenderVariant_depth)
        if (uRenderMask == MaskOpaque) {
            gl_FragColor = packDepthToRGBA(fragmentDepth);
        } else if (uRenderMask == MaskTransparent) {
            gl_FragColor = packDepthWithAlphaToRGBA(fragmentDepth, material.a);
        }
    #elif defined(dRenderVariant_marking)
        ${apply_marking}
        gl_FragColor = material;
    #elif defined(dRenderVariant_emissive)
        gl_FragColor = vec4(emissive);
    #elif defined(dRenderVariant_color) || defined(dRenderVariant_tracing)
        #if defined(dUsePalette) && !defined(dSliceWindow)
            if (material.rgb == vec3(1.0)) {
                material.rgb = uPaletteDefault;
            } else {
                float v = ((material.r * 256.0 * 256.0 * 255.0 + material.g * 256.0 * 255.0 + material.b * 255.0) - 1.0) / PALETTE_SCALE;
                material.rgb = texture2D(tPalette, vec2(v, 0.0)).rgb;
            }
        #endif

        // mix material with overpaint
        #if defined(dOverpaint)
            vec4 overpaint = vec4(0.0);
            if (group != -1.0) {
                #if defined(dOverpaintType_texture)
                    overpaint = read_tOverpaint((uInstanceGranularity ? vInstance : vInstance * float(uGroupCount) + group));
                #endif
                overpaint *= uOverpaintStrength;
            }
            material.rgb = mix(material.rgb, overpaint.rgb, overpaint.a);
        #endif

        gl_FragColor = material;
        ${apply_marker_color}

        #if defined(dRenderVariant_color)
            ${apply_fog}
            ${wboit_write}
            ${dpoit_write}
        #elif defined(dRenderVariant_tracing)
            gl_FragData[1] = packNormalToRGBA(normalize(vViewPosition), emissive);
            gl_FragData[2] = vec4(material.rgb, uDensity);
        #endif
    #endif
}
`;
