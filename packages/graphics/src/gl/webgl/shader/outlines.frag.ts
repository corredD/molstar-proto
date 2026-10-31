/**
 * Copyright (c) 2019-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Gianluca Tomasello <giagitom@gmail.com>
 * @author Sebastian Bittrich <sebastian.m.bittrich@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { common } from './chunks/common.glsl.js';

export const outlines_frag = `
precision highp float;
precision highp int;

${common}

float getViewZ(const in float depth) {
    #if dOrthographic == 1
        return orthographicDepthToViewZ(depth, uNear, uFar);
    #else
        return perspectiveDepthToViewZ(depth, uNear, uFar);
    #endif
}

float getDepthOpaque(const in vec2 coords) {
    #ifdef depthTextureSupport
        return texture2D(tDepthOpaque, coords).r;
    #else
        return unpackRGBAToDepth(texture2D(tDepthOpaque, coords));
    #endif
}

vec2 getDepthTransparentWithAlpha(const in vec2 coords) {
    #ifdef dTransparentOutline
        return unpackRGBAToDepthWithAlpha(texture2D(tDepthTransparent, coords));
    #else
        return vec2(0.0, 0.0);
    #endif
}

// depth is reversed: the background (far plane) at 0, nearer is greater
bool isBackground(const in float depth) {
    return depth == 0.0;
}

float getPixelSize(const in vec2 coords, const in float depth) {
    vec3 viewPos0 = screenSpaceToViewSpace(vec3(coords, depth), uInvProjection);
    vec3 viewPos1 = screenSpaceToViewSpace(vec3(coords + vec2(1.0, 0.0) / uTexSize, depth), uInvProjection);
    return distance(viewPos0, viewPos1);
}

void main(void) {
    float backgroundViewZ = 2.0 * uFar;

    vec2 coords = gl_FragCoord.xy / uTexSize;
    vec2 invTexSize = 1.0 / uTexSize;

    float selfDepthOpaque = getDepthOpaque(coords);
    float selfViewZOpaque = isBackground(selfDepthOpaque) ? backgroundViewZ : getViewZ(selfDepthOpaque);
    float pixelSizeOpaque = getPixelSize(coords, selfDepthOpaque) * uOutlineThreshold;

    vec2 selfDepthTransparentWithAlpha = getDepthTransparentWithAlpha(coords);
    float selfDepthTransparent = selfDepthTransparentWithAlpha.x;
    float selfViewZTransparent = isBackground(selfDepthTransparent) ? backgroundViewZ : getViewZ(selfDepthTransparent);
    float pixelSizeTransparent = getPixelSize(coords, selfDepthTransparent) * uOutlineThreshold;

    float bestOpaqueDepth = 0.0;
    float bestTransparentDepth = 0.0;
    float bestTransparentAlpha = 0.0;

    float opaqueOutlineFlag = 0.0;
    float transparentOutlineFlag = 0.0;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 sampleCoords = coords + vec2(float(x), float(y)) * invTexSize;

            // Opaque
            float sampleDepthOpaque = getDepthOpaque(sampleCoords);
            float sampleViewZOpaque = isBackground(sampleDepthOpaque) ? backgroundViewZ : getViewZ(sampleDepthOpaque);
            if (abs(selfViewZOpaque - sampleViewZOpaque) > pixelSizeOpaque && selfDepthOpaque < sampleDepthOpaque && sampleDepthOpaque >= bestOpaqueDepth) {
                bestOpaqueDepth = sampleDepthOpaque;
                opaqueOutlineFlag = 1.0;
            }

            // Transparent
            vec2 sampleDepthTransparentWithAlpha = getDepthTransparentWithAlpha(sampleCoords);
            float sampleDepthTransparent = sampleDepthTransparentWithAlpha.x;
            float sampleAlphaTransparent = sampleDepthTransparentWithAlpha.y;
            float sampleViewZTransparent = isBackground(sampleDepthTransparent) ? backgroundViewZ : getViewZ(sampleDepthTransparent);
            if (abs(selfViewZTransparent - sampleViewZTransparent) > pixelSizeTransparent && selfDepthTransparent < sampleDepthTransparent && sampleDepthTransparent >= bestTransparentDepth) {
                bestTransparentDepth = sampleDepthTransparent;
                bestTransparentAlpha = sampleAlphaTransparent;
                transparentOutlineFlag = 1.0;
            }
        }
    }

    if (transparentOutlineFlag > 0.0 && abs(selfViewZOpaque - getViewZ(bestTransparentDepth)) < pixelSizeOpaque) { // Disable transparent outline close to opaque elements
        transparentOutlineFlag = 0.0;
    }

    // nor where the opaque surface here is in front of it (depth is reversed): the transparent depth's hole where an
    // opaque surface in front covers it (a ghost behind a kept particle) is no edge of it
    if (transparentOutlineFlag > 0.0 && selfDepthOpaque > bestTransparentDepth) {
        transparentOutlineFlag = 0.0;
        bestTransparentDepth = 0.0;
        bestTransparentAlpha = 0.0;
    }

    // lazy curvature veto: only compute if an outline was found and center is not background
    const float kCurvatureGate = 0.75;
    vec2 dx = vec2(invTexSize.x, 0.0);
    vec2 dy = vec2(0.0, invTexSize.y);

    if (opaqueOutlineFlag > 0.0 && !isBackground(selfDepthOpaque)) {
        float dL = getDepthOpaque(coords - dx);
        float dR = getDepthOpaque(coords + dx);
        float dU = getDepthOpaque(coords + dy);
        float dD = getDepthOpaque(coords - dy);

        float vzL = isBackground(dL) ? backgroundViewZ : getViewZ(dL);
        float vzR = isBackground(dR) ? backgroundViewZ : getViewZ(dR);
        float vzU = isBackground(dU) ? backgroundViewZ : getViewZ(dU);
        float vzD = isBackground(dD) ? backgroundViewZ : getViewZ(dD);

        float ddx = abs(vzL + vzR - 2.0 * selfViewZOpaque);
        float ddy = abs(vzU + vzD - 2.0 * selfViewZOpaque);
        float curvOpaque = max(ddx, ddy);

        if (curvOpaque < pixelSizeOpaque * kCurvatureGate) {
            opaqueOutlineFlag = 0.0;
            bestOpaqueDepth = 0.0;
        }
    }

    if (transparentOutlineFlag > 0.0 && !isBackground(selfDepthTransparent)) {
        vec2 daL = getDepthTransparentWithAlpha(coords - dx);
        vec2 daR = getDepthTransparentWithAlpha(coords + dx);
        vec2 daU = getDepthTransparentWithAlpha(coords + dy);
        vec2 daD = getDepthTransparentWithAlpha(coords - dy);

        float dL = daL.x;
        float dR = daR.x;
        float dU = daU.x;
        float dD = daD.x;

        float vzL = isBackground(dL) ? backgroundViewZ : getViewZ(dL);
        float vzR = isBackground(dR) ? backgroundViewZ : getViewZ(dR);
        float vzU = isBackground(dU) ? backgroundViewZ : getViewZ(dU);
        float vzD = isBackground(dD) ? backgroundViewZ : getViewZ(dD);

        float ddx = abs(vzL + vzR - 2.0 * selfViewZTransparent);
        float ddy = abs(vzU + vzD - 2.0 * selfViewZTransparent);
        float curvTransparent = max(ddx, ddy);

        if (curvTransparent < pixelSizeTransparent * kCurvatureGate) {
            transparentOutlineFlag = 0.0;
            bestTransparentDepth = 0.0;
            bestTransparentAlpha = 0.0;
        }
    }

    vec2 depthPacked; // Pack depth in G/B channels
    float outlineTypeFlag = 0.0;
    if (opaqueOutlineFlag > 0.0 && transparentOutlineFlag > 0.0) {
        outlineTypeFlag = 0.75; // Both
        depthPacked = packUnitIntervalToRG(bestOpaqueDepth);
    } else if (transparentOutlineFlag > 0.0) {
        outlineTypeFlag = 0.5;  // Transparent only
        depthPacked = packUnitIntervalToRG(bestTransparentDepth);
    } else if (opaqueOutlineFlag > 0.0) {
        outlineTypeFlag = 0.25; // Opaque only
        depthPacked = packUnitIntervalToRG(bestOpaqueDepth);
    }

    float alpha = clamp(bestTransparentAlpha, 0.0, 0.5) * 2.0; // limiting to range [0.0, 0.5] to improve alpha precision since we don't need a wider range
    float packedFlagWithAlpha = pack2x4(vec2(outlineTypeFlag, alpha)); // pack outlineType with alpha
    // the transparent edge's depth in 8 bits as its square root: reversed depth (about near / z) of what lies beyond 500
    // times the near plane rounds to 0 in 8 bits, its square root beyond some 260,000 times (a transparent edge alone
    // reads gb, 16 bits)
    gl_FragColor = vec4(packedFlagWithAlpha, depthPacked.x, depthPacked.y, sqrt(bestTransparentDepth));
}
`;

/**
 * The compose passes' reading of the outline target (postprocessing, illumination): `getOutline(coords, ...)`, the
 * nearest opaque and transparent outlines within `dOutlineScale` texels; expects `tOutlines`, `uTexSize`, `uFogNear`,
 * `uFogFar`, `getViewZ`, `unpack2x4` and `unpackRGToUnitInterval`. The target is RGBA8: r the outline type and the
 * transparent alpha, gb a 16-bit depth (the opaque edge's, or the transparent edge's where it is alone), a the square root
 * of the transparent edge's depth; an edge counts by its type, whatever its depth
 */
export const outline_read_glsl = `
// the 8-bit square root a "both" edge stores, so an in-front test compares like with like
float outlineQuantizedDepth(const in float depth) {
    float q = floor(sqrt(max(depth, 0.0)) * 255.0 + 0.5) / 255.0;
    return q * q;
}

// an outline's fog: none with fog off (fog near and far equal: smoothstep undefined); a depth packed to 0 (in the last
// few Å before the far plane with the near plane at 1 Å) taken at the 16-bit floor, the farthest depth it can hold
float outlineFog(const in float depth) {
    if (uFogFar <= uFogNear) return 0.0;
    return smoothstep(uFogNear, uFogFar, abs(getViewZ(max(depth, 1.0 / 65536.0))));
}

// whether the opaque outline is in front of the transparent one: their 16-bit depths compared as they are, or both
// rounded to the 8-bit square root where the transparent one came from a "both" edge
bool outlineOpaqueInFront(const in float opaqueDepth, const in float transparentDepth, const in bool transparentBoth) {
    return transparentBoth
        ? outlineQuantizedDepth(opaqueDepth) > outlineQuantizedDepth(transparentDepth)
        : opaqueDepth > transparentDepth;
}

int squaredOutlineScale = dOutlineScale * dOutlineScale;
// transparentBoth: the transparent depth came from a "both" edge, an 8-bit square root (else 16 bits)
void getOutline(const in vec2 coords, out bool hasOpaque, out bool hasTransparent, out float opaqueDepth, out float transparentDepth, out float alpha, out bool transparentBoth) {
    vec2 invTexSize = 1.0 / uTexSize;

    hasOpaque = false;
    hasTransparent = false;
    opaqueDepth = 0.0;
    transparentDepth = 0.0;
    alpha = 0.0;
    transparentBoth = false;
    for (int y = -dOutlineScale; y <= dOutlineScale; y++) {
        for (int x = -dOutlineScale; x <= dOutlineScale; x++) {
            if (x * x + y * y > squaredOutlineScale) {
                continue;
            }

            vec2 sampleCoords = coords + vec2(float(x), float(y)) * invTexSize;

            vec4 sampleOutlineCombined = texture2D(tOutlines, sampleCoords);
            float sampleEdgeDepth = unpackRGToUnitInterval(sampleOutlineCombined.gb);
            vec2 sampleFlagWithAlpha = unpack2x4(sampleOutlineCombined.r);

            float sampleFlag = sampleFlagWithAlpha.x;
            float sampleAlpha = clamp(sampleFlagWithAlpha.y * 0.5, 0.01, 1.0);
            bool isTransparent = sampleFlag > 0.45 && sampleFlag < 0.55;
            bool isBoth = sampleFlag > 0.70 && sampleFlag < 0.80;
            // a transparent edge alone: its depth in 16 bits (gb); with an opaque one, in 8 (a, its square root, see
            // outlines.frag); there by its flag, whatever its depth (reversed: far edges round toward 0)
            float sampleTransparentDepth = isTransparent ? sampleEdgeDepth : sampleOutlineCombined.a * sampleOutlineCombined.a;

            if ((sampleFlag > 0.20 && sampleFlag < 0.30) || isBoth) { // opaque || both
                if (!hasOpaque || sampleEdgeDepth > opaqueDepth) {
                    hasOpaque = true;
                    opaqueDepth = sampleEdgeDepth;
                }
            }

            if ((isTransparent || isBoth) && (!hasTransparent || sampleTransparentDepth > transparentDepth)) {
                hasTransparent = true;
                transparentDepth = sampleTransparentDepth;
                alpha = sampleAlpha;
                transparentBoth = isBoth;
            }
        }
    }
}

`;
