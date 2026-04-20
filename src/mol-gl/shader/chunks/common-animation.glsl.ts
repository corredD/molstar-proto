/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

export const common_animation = `
uniform float uWiggleSpeed;
uniform float uWiggleAmplitude;
uniform float uWiggleFrequency;
uniform int uWiggleMode;
uniform float uTumbleSpeed;
uniform float uTumbleAmplitude;
uniform float uTumbleFrequency;
uniform int uTumbleTranslationMode;
uniform int uTumbleAxisSource;
uniform int uTumbleAxis;
uniform int uAudioWiggleSource;
uniform float uAudioWiggleStrength;
uniform float uAudioWiggleFloor;
uniform int uAudioTumbleSource;
uniform float uAudioTumbleStrength;
uniform float uAudioTumbleFloor;

uniform float uAudioAmplitude;
uniform float uAudioPeakAmplitude;
uniform float uAudioBeatIntensity;
uniform float uAudioDominantFrequency;
uniform float uAudioMix;
uniform float uAudioSubBass;
uniform float uAudioBass;
uniform float uAudioLowMids;
uniform float uAudioMids;
uniform float uAudioHighMids;
uniform float uAudioTreble;
uniform float uAudioWiggleScale;
uniform float uAudioTumbleScale;
uniform float uAudioAssemblyAxisAmplitudeScale;
uniform int uAudioAssemblyAxisCount;
uniform vec3 uAudioAssemblyAxisCenter;
uniform vec3 uAudioAssemblyAxes[32];

uniform int uTrailMode;
uniform float uTrailSpeed;
uniform float uTrailAmplitude;
uniform float uTrailFrequency;
uniform float uTrailStep;

#ifdef dWiggle
    uniform vec2 uWiggleTexDim;
    uniform sampler2D tWiggle;
    uniform float uWiggleStrength;
#endif

float getAudioSource(int source) {
    if (source == 1) return uAudioAmplitude;
    if (source == 2) return uAudioPeakAmplitude;
    if (source == 3) return uAudioBeatIntensity;
    if (source == 4) return uAudioMix;
    if (source == 5) return uAudioSubBass * 1.75;
    if (source == 6) return uAudioBass * 1.45;
    if (source == 7) return uAudioLowMids;
    if (source == 8) return uAudioMids;
    if (source == 9) return uAudioHighMids;
    if (source == 10) return uAudioTreble;
    if (source == 11) return uAudioDominantFrequency;
    return 1.0;
}

vec3 getTumbleAxisVector(mat4 transform, int axis, vec3 instanceCenter) {
    vec3 axisVector = axis == 0 ? vec3(1.0, 0.0, 0.0) : axis == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);

    // Resolve the selected axis to the closer signed world-space Cartesian direction
    // (+/-X, +/-Y, +/-Z) using the instance center.
    float radialLength = length(instanceCenter);
    if (radialLength > 0.00001) {
        float projection = dot(instanceCenter / radialLength, axisVector);
        return axisVector * (projection >= 0.0 ? 1.0 : -1.0);
    }

    return axisVector;
}

vec3 getResolvedAssemblyTumbleAxisVector(mat4 transform, vec3 instanceCenter) {
    mat3 basis = mat3(transform);
    vec3 assemblyCenter = transform[3].xyz + basis * uAudioAssemblyAxisCenter;
    vec3 radial = instanceCenter - assemblyCenter;
    float radialLength = length(radial);
    if (radialLength <= 0.00001) {
        radial = instanceCenter;
        radialLength = length(radial);
    }
    radial = radialLength > 0.00001 ? radial / radialLength : vec3(0.0, 0.0, 1.0);

    float bestScore = -1.0;
    vec3 bestAxis = vec3(0.0, 0.0, 1.0);
    float bestSign = 1.0;

    for (int i = 0; i < 32; ++i) {
        if (i >= uAudioAssemblyAxisCount) break;
        vec3 axis = basis * uAudioAssemblyAxes[i];
        float axisLength = length(axis);
        if (axisLength <= 0.00001) continue;
        axis /= axisLength;
        float projection = dot(radial, axis);
        float score = abs(projection);
        if (score > bestScore) {
            bestScore = score;
            bestAxis = axis;
            bestSign = projection >= 0.0 ? 1.0 : -1.0;
        }
    }

    return bestAxis * bestSign;
}

bool hasResolvedAssemblyTumbleAxis() {
    return uTumbleAxisSource != 1 || uAudioAssemblyAxisCount > 0;
}

float getAssemblyAxisDrive() {
    return clamp(uAudioBass * 0.9 + uAudioSubBass * 1.25 + uAudioBeatIntensity * 0.35, 0.0, 3.0);
}

vec3 applyWiggle(vec3 pos, float groupId, float instanceId) {
    if (!uEnableAnimation) return pos;
    float amplitude = uWiggleAmplitude;
    if (uAudioWiggleSource != 0) {
        amplitude *= clamp((uAudioWiggleFloor + getAudioSource(uAudioWiggleSource) * uAudioWiggleStrength) * uAudioWiggleScale, 0.0, 8.0);
    }
    #ifdef dWiggle
        #if defined(dWiggleType_instance)
            amplitude += readFromTexture(tWiggle, instanceId, uWiggleTexDim).a * uWiggleStrength;
        #elif defined(dWiggleType_groupInstance)
            amplitude += readFromTexture(tWiggle, instanceId * float(uGroupCount) + groupId, uWiggleTexDim).a * uWiggleStrength;
        #endif
    #endif
    if (amplitude > 0.0 && uWiggleSpeed > 0.0 && uWiggleFrequency > 0.0) {
        float t = uTime * uWiggleSpeed;
        vec3 s;
        if (uWiggleMode == 0) {
            // Position mode: spatial position correlates nearby atoms
            s = pos;
        } else {
            // Group mode: per-group independent noise
            // Hash groupId into a well-distributed 3D seed to avoid repetition
            s = vec3(
                fract(sin(groupId * 127.1) * 43758.5453) * 1000.0,
                fract(sin(groupId * 269.5) * 21639.7182) * 1000.0,
                fract(sin(groupId * 419.2) * 32517.3926) * 1000.0
            );
        }
        s *= uWiggleFrequency;
        pos.x += (fbm(vec3(s.x, s.y + t, s.z)) / 0.4375 - 1.0) * amplitude;
        pos.y += (fbm(vec3(s.x + 37.0, s.y, s.z + t)) / 0.4375 - 1.0) * amplitude;
        pos.z += (fbm(vec3(s.x + t, s.y + 73.0, s.z)) / 0.4375 - 1.0) * amplitude;
    }
    return pos;
}

mat4 applyTumble(mat4 transform, float instanceIndex, float uObjectId) {
    if (!uEnableAnimation) return transform;
    float tumbleAmplitude = uTumbleAmplitude;
    if (uAudioTumbleSource != 0) {
        tumbleAmplitude *= clamp((uAudioTumbleFloor + getAudioSource(uAudioTumbleSource) * uAudioTumbleStrength) * uAudioTumbleScale, 0.0, 8.0);
    }
    if (tumbleAmplitude > 0.0 && uTumbleSpeed > 0.0 && uTumbleFrequency > 0.0) {
        // Scale amplitude inversely with bounding-sphere radius (Stokes-Einstein: D ~ 1/r)
        float amplitude = tumbleAmplitude / max(uInvariantBoundingSphere.w, 1.0);
        float t = uTime * uTumbleSpeed;
        float seed = (instanceIndex * 127.1 + uObjectId * 311.7) * uTumbleFrequency;
        vec3 localCenter = mat3(transform) * uInvariantBoundingSphere.xyz;
        vec3 instanceCenter = transform[3].xyz + localCenter;
        bool axisMode = uTumbleTranslationMode == 1;
        bool assemblyAxisMode = axisMode && uTumbleAxisSource == 1 && uAudioAssemblyAxisCount > 0;

        // Per-instance rotation angles from layered noise (Brownian-like)
        mat3 rot = mat3(1.0);
        if (!axisMode) {
            float angleX = (fbm(vec3(seed, t, 0.0)) / 0.4375 - 1.0) * amplitude;
            float angleY = (fbm(vec3(seed, 0.0, t)) / 0.4375 - 1.0) * amplitude;
            float angleZ = (fbm(vec3(0.0, seed, t)) / 0.4375 - 1.0) * amplitude;

            float cx = cos(angleX); float sx = sin(angleX);
            float cy = cos(angleY); float sy = sin(angleY);
            float cz = cos(angleZ); float sz = sin(angleZ);

            // Combined rotation matrix (Rz * Ry * Rx)
            rot = mat3(
                cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
                -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
                sy, -sx * cy, cx * cy
            );
        }

        // Per-instance translation offset from layered noise (Brownian-like)
        vec3 offset;
        if (axisMode) {
            vec3 axis = assemblyAxisMode
                ? getResolvedAssemblyTumbleAxisVector(transform, instanceCenter)
                : getTumbleAxisVector(transform, uTumbleAxis, instanceCenter);
            float axisDrive = uAudioTumbleSource != 0 ? getAssemblyAxisDrive() : 1.0;
            offset = axis * amplitude * axisDrive * uAudioAssemblyAxisAmplitudeScale;
        } else {
            offset = vec3(
                (fbm(vec3(seed + 31.7, t, 0.0)) / 0.4375 - 1.0),
                (fbm(vec3(seed + 31.7, 0.0, t)) / 0.4375 - 1.0),
                (fbm(vec3(0.0, seed + 31.7, t)) / 0.4375 - 1.0)
            ) * amplitude;
        }

        // === FINAL MATRIX ASSEMBLY ===
        // Rotation is applied to the object's basis vectors
        // Pivot correction rotates AROUND the local center
        // offset is added in WORLD space
        mat4 result = transform;
        result[0].xyz = rot * transform[0].xyz;
        result[1].xyz = rot * transform[1].xyz;
        result[2].xyz = rot * transform[2].xyz;

        // Adjust translation so rotation pivots around the transformed center
        result[3].xyz = transform[3].xyz + localCenter - rot * localCenter + offset;

        return result;
    }
    return transform;
}
`;
