/**
 * Copyright (c) 2022-2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

export const shadows_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

#include common

uniform sampler2D tDepth;
uniform vec2 uTexSize;
uniform vec4 uBounds;

uniform float uNear;
uniform float uFar;

#if dLightCount != 0
    uniform vec3 uLightDirection[dLightCount]; // view-space
    uniform vec3 uLightColor[dLightCount];
#endif
uniform vec3 uAmbientColor;

uniform mat4 uProjection;
uniform mat4 uInvProjection;

// -----------------------------------------------------------------------------
// Mode switch:
// 0 = SIMPLE (original method)
// https://panoskarabelas.com/posts/screen_space_shadows/
// 1 = ADVANCED (Bend-style contact shadows)
// https://www.bendstudio.com/blog/inside-bend-screen-space-shadows/
// -----------------------------------------------------------------------------
uniform int uShadowMode;

// ----------------------------- SIMPLE params ---------------------------------
uniform float uMaxDistance;   // e.g. 0.25 (in view units, same as your original)
uniform float uTolerance;     // e.g. 0.01
// dSteps is provided via #define dSteps from your pipeline

// ---------------------------- ADVANCED params --------------------------------
// Depth/thickness & sampling control (Bend-inspired)
uniform float uSurfaceThickness;        // e.g. 0.005
uniform float uBilinearThreshold;       // e.g. 0.02
uniform float uShadowContrast;          // e.g. 4.0
uniform int   uIgnoreEdgePixels;        // 0/1
uniform int   uUsePrecisionOffset;      // 0/1
uniform int   uBilinearSamplingOffsetMode; // 0/1
uniform int   uSampleCount;             // e.g. 60
uniform int   uHardShadowSamples;       // e.g. 4
uniform int   uFadeOutSamples;          // e.g. 8
uniform float uMaxPixelDistance;        // e.g. 120.0 (reach in pixels)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
bool isBackground(const in float depth) { return depth == 1.0; }

bool outsideBounds(const in vec2 p) {
    return p.x < uBounds.x || p.y < uBounds.y || p.x > uBounds.z || p.y > uBounds.w;
}

float getDepth(const in vec2 uv) {
    #ifdef depthTextureSupport
        return texture2D(tDepth, uv).r;
    #else
        return unpackRGBAToDepth(texture2D(tDepth, uv));
    #endif
}

float getViewZ(const in float depth) {
    #if dOrthographic == 1
        return orthographicDepthToViewZ(depth, uNear, uFar);
    #else
        return perspectiveDepthToViewZ(depth, uNear, uFar);
    #endif
}

float screenFade(const in vec2 coords) {
    vec2 c = (coords - uBounds.xy) / (uBounds.zw - uBounds.xy);
    vec2 fade = max(12.0 * abs(c - 0.5) - 5.0, vec2(0.0));
    return saturate(1.0 - dot(fade, fade));
}

// Map clip.z/clip.w to [0,1] depth
float clipToDepth01(vec4 clip) {
    float ndcZ = clip.z / clip.w;      // [-1, 1]
    return ndcZ * 0.5 + 0.5;           // [0, 1]
}

vec3 viewToScreenUvZ(in vec3 viewPos) {
    vec4 clip = uProjection * vec4(viewPos, 1.0);
    vec3 ndc = clip.xyz / clip.w;
    vec2 uv  = ndc.xy * 0.5 + 0.5;
    float depth = clipToDepth01(clip);
    return vec3(uv, depth);
}

vec2 screenDirFromLight(in vec3 viewPos, in vec3 lightDirVS) {
    const float stepVS = 0.05;
    vec3 p0 = viewPos;
    vec3 p1 = viewPos + (-lightDirVS) * stepVS;
    vec2 uv0 = viewToScreenUvZ(p0).xy;
    vec2 uv1 = viewToScreenUvZ(p1).xy;
    vec2 d = uv1 - uv0;
    float len = max(length(d), 1e-6);
    return d / len;
}

// -----------------------------------------------------------------------------
// SIMPLE (your original) — view-space march along -L, depth compare with tolerance
// -----------------------------------------------------------------------------
vec3 screenSpaceShadow_Simple(
    in vec3 position,
    in vec3 lightDirection,
    in vec3 lightColor
){
    vec3 rayPos = position;
    vec3 rayDir = -lightDirection;
    float stepLength = uMaxDistance / float(dSteps);
    vec3 rayStep = rayDir * stepLength;

    for (int i = 0; i < dSteps; ++i) {
        rayPos += rayStep;

        vec4 rayCoords = uProjection * vec4(rayPos, 1.0);
        rayCoords.xyz = (rayCoords.xyz / rayCoords.w) * 0.5 + 0.5;

        if (outsideBounds(rayCoords.xy)) {
            return lightColor;
        }

        float depth = getDepth(rayCoords.xy);
        float viewZ = getViewZ(depth);
        float zDelta = rayPos.z - viewZ;

        if (zDelta < uTolerance) {
            return mix(vec3(0.0), lightColor, 1.0 - screenFade(rayCoords.xy));
        }
    }
    return lightColor;
}

// -----------------------------------------------------------------------------
// ADVANCED (Bend-inspired approximation for a fragment pass)
// -----------------------------------------------------------------------------
vec3 screenSpaceShadow_BendApprox(
    in vec3 selfViewPos,
    in vec3 lightDirVS,
    in vec3 lightColor,
    in vec2 uvSelf
){
    float selfDepth = getDepth(uvSelf);
    if (isBackground(selfDepth)) return vec3(0.0);

    if (uUsePrecisionOffset == 1) {
        selfDepth = mix(selfDepth, 0.0, -1.0 / 65535.0);
    }

    vec2 dirUV = screenDirFromLight(selfViewPos, lightDirVS);
    float maxStepsF = float(uSampleCount);
    float px2uv = 1.0 / max(uTexSize.x, uTexSize.y);
    float stepUV = (uMaxPixelDistance * px2uv) / maxStepsF;

    vec4 acc = vec4(1.0);
    float hardMin = 1.0;

    float startDepth = selfDepth;
    float zSign = (uNear > uFar) ? -1.0 : 1.0;

    vec2 uv = uvSelf;
    float edgeFadeSelf = screenFade(uvSelf);

    for (int i = 0; i < 1024; ++i) {
        if (i >= uSampleCount) break;

        uv += dirUV * stepUV;
        if (outsideBounds(uv)) break;

        vec2 perp = vec2(-dirUV.y, dirUV.x);
        float bilinearSign = (fract(dot(uv * uTexSize, perp)) > 0.5) ? 1.0 : -1.0;
        vec2  off = perp * (0.5 / max(uTexSize.x, uTexSize.y)) * bilinearSign;

        float d0 = getDepth(uv);
        float d1 = getDepth(uv + off);
        float thicknessScale = abs(0.0 - d0);

        bool usePoint = abs(d0 - d1) > thicknessScale * uBilinearThreshold;

        float samplingDepth;
        float shadowingDepth;
        if (uBilinearSamplingOffsetMode == 1) {
            float bilinear = usePoint ? 0.0 : abs(fract(dot(uv * uTexSize, perp)) - 0.5);
            samplingDepth  = mix(d0, d1, bilinear);
            shadowingDepth = (uIgnoreEdgePixels == 1 && usePoint) ? 1e20 : samplingDepth;
        } else {
            samplingDepth  = d0;
            float edgeDepth = (uIgnoreEdgePixels == 1) ? 1e20 : d0;
            float shadowDepthBias = abs(d0 - d1) * zSign;
            shadowingDepth = usePoint ? edgeDepth : (d0 + shadowDepthBias);
        }

        float depthScale = min(float(i+1), 1.0 / max(uSurfaceThickness, 1e-6))
                         * (1.0 / max(thicknessScale, 1e-6));

        float ref = (startDepth) * depthScale - zSign;
        float sampleV = shadowingDepth * depthScale;
        float delta = abs(ref - sampleV);

        if (i < uHardShadowSamples) {
            hardMin = min(hardMin, delta);
        }

        int idx4 = i & 3;
        if (i >= uHardShadowSamples && i < (uSampleCount - uFadeOutSamples)) {
            acc[idx4] = min(acc[idx4], delta);
        }

        if (i >= (uSampleCount - uFadeOutSamples)) {
            float t = float(i + 1 - (uSampleCount - uFadeOutSamples)) / float(uFadeOutSamples + 1);
            float fade = t * 0.75;
            acc[idx4] = min(acc[idx4], delta + fade);
        }
    }

    acc      = clamp(acc * uShadowContrast + (1.0 - uShadowContrast), 0.0, 1.0);
    hardMin  = clamp(hardMin * uShadowContrast + (1.0 - uShadowContrast), 0.0, 1.0);

    float result = dot(acc, vec4(0.25));
    result = min(result, hardMin);

    result = mix(result, 1.0, 1.0 - edgeFadeSelf);

    return lightColor * result;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
void main(void) {
    vec2 invTexSize = 1.0 / uTexSize;
    vec2 selfCoords = gl_FragCoord.xy * invTexSize;

    float selfDepth = getDepth(selfCoords);
    if (isBackground(selfDepth)) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec3 selfViewPos = screenSpaceToViewSpace(vec3(selfCoords, selfDepth), uInvProjection);

    float l = length(uAmbientColor);
    float a = l;

    #if dLightCount != 0
        #pragma unroll_loop_start
        for (int i = 0; i < dLightCount; ++i) {
            vec3 s;
            if (uShadowMode == 0) {
                // SIMPLE
                s = screenSpaceShadow_Simple(selfViewPos, normalize(uLightDirection[i]), uLightColor[i]);
            } else {
                // ADVANCED
                s = screenSpaceShadow_BendApprox(selfViewPos, normalize(uLightDirection[i]), uLightColor[i], selfCoords);
            }
            l += length(s);
            a += length(uLightColor[i]);
        }
        #pragma unroll_loop_end
    #endif

    gl_FragColor = vec4(l / max(a, 1e-6));
}
`;
