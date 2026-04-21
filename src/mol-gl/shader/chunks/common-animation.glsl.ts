export const common_animation = `
uniform float uWiggleSpeed;
uniform float uWiggleAmplitude;
uniform float uWiggleFrequency;
uniform int uWiggleMode;
uniform float uTumbleSpeed;
uniform float uTumbleAmplitude;
uniform float uTumbleFrequency;
uniform int uTumbleTranslationMode;
uniform int uTumbleTranslationSync;
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

uniform float uAudioBeatTrigger;     // 1.0 on beat frame, 0.0 otherwise
uniform float uBeatDecayRate;         // e.g., 4.0 (higher = faster decay)

// Accumulated beat impulse with exponential decay, computed per-frame
// This should be computed on the CPU side and passed as a uniform:
//   beatImpulse = max(beatTrigger, beatImpulse * exp(-decayRate * dt));
uniform float uBeatImpulse;

#ifdef dWiggle
    uniform vec2 uWiggleTexDim;
    uniform sampler2D tWiggle;
    uniform float uWiggleStrength;
#endif
float shapeResponse(float value, float power) {
    // Attempt soft-knee: quiet signals stay quieter, loud signals punch through
    return pow(clamp(value, 0.0, 1.0), power);
}

float getAudioSource(int source) {
    if (source == 1) return shapeResponse(uAudioAmplitude, 1.5);
    if (source == 2) return shapeResponse(uAudioPeakAmplitude, 1.2);
    if (source == 3) return uAudioBeatIntensity; // already onset-shaped
    if (source == 4) return shapeResponse(uAudioMix, 1.5);
    // Perceptual loudness compensation (Fletcher-Munson inspired):
    // Sub-bass and bass need a boost because humans are less sensitive there,
    // but the FFT already captures the raw energy accurately.
    // The boost makes visual response match *perceived* loudness.
    if (source == 5) return shapeResponse(uAudioSubBass * 1.75, 2.5);
    if (source == 6) return shapeResponse(uAudioBass * 1.45, 2.0);
    if (source == 7) return shapeResponse(uAudioLowMids, 1.5);
    if (source == 8) return shapeResponse(uAudioMids, 1.3);
    if (source == 9) return shapeResponse(uAudioHighMids, 1.2);
    if (source == 10) return shapeResponse(uAudioTreble, 1.1);
    if (source == 11) return uAudioDominantFrequency;
    return 1.0;
}

/* ================================================================
   PERCEPTUAL AUDIO HELPERS (best visual results)
   ================================================================ */
float perceptualEnergy() {
    // Weighted perceptual mix (human hearing is more sensitive to mids)
    // Sub-bass + bass get extra weight for "feel", mids get clarity, treble adds sparkle
    return uAudioSubBass * 0.35 +
           uAudioBass     * 0.65 +
           uAudioLowMids  * 0.85 +
           uAudioMids     * 1.20 +
           uAudioHighMids * 0.90 +
           uAudioTreble   * 0.45;
}

float getPerceptualDrive(float emphasis) {
    // emphasis = 0..2 (0 = bass-heavy, 1 = neutral, 2 = treble-heavy)
    float bassHeavy  = uAudioSubBass * 1.8 + uAudioBass * 1.4;
    float midHeavy   = uAudioLowMids * 1.1 + uAudioMids * 1.3 + uAudioHighMids * 1.1;
    float trebleHeavy = uAudioTreble * 1.6;
    return mix(bassHeavy, mix(midHeavy, trebleHeavy, emphasis - 1.0), clamp(emphasis, 0.0, 2.0));
}

vec3 getTumbleAxisVector(mat4 transform, int axis, vec3 localRadial) {
    vec3 axisVector = axis == 0 ? vec3(1.0, 0.0, 0.0) : axis == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);

    float axisLength = length(axisVector);
    if (axisLength <= 0.00001) {
        axisVector = axis == 0 ? vec3(1.0, 0.0, 0.0) : axis == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    } else {
        axisVector /= axisLength;
    }

    float radialLength = length(localRadial);
    if (radialLength > 0.00001) {
        float projection = dot(localRadial / radialLength, axisVector);
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
    // Perceptual bass + beat drive (feels most "physical")
    return clamp(uAudioSubBass * 1.4 + uAudioBass * 1.1 + uAudioBeatIntensity * 0.6, 0.0, 3.5);
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
            s = pos;
        } else {
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
        float amplitude = tumbleAmplitude / max(uInvariantBoundingSphere.w, 1.0);
        float t = uTime * uTumbleSpeed;
        float seed = (instanceIndex * 127.1 + uObjectId * 311.7) * uTumbleFrequency;

        vec3 localCenter = mat3(transform) * uInvariantBoundingSphere.xyz;
        vec3 instanceCenter = transform[3].xyz + localCenter;

        bool axisMode = uTumbleTranslationMode == 1;
        bool assemblyAxisMode = axisMode && uTumbleAxisSource == 1 && uAudioAssemblyAxisCount > 0;

        mat3 rot = mat3(1.0);
        if (!axisMode) {
            float rotDrive = getPerceptualDrive(1.2);
            float angleX = (fbm(vec3(seed, t, 0.0)) / 0.4375 - 1.0) * amplitude * rotDrive;
            float angleY = (fbm(vec3(seed, 0.0, t)) / 0.4375 - 1.0) * amplitude * rotDrive;
            float angleZ = (fbm(vec3(0.0, seed, t)) / 0.4375 - 1.0) * amplitude * rotDrive;

            float cx = cos(angleX); float sx = sin(angleX);
            float cy = cos(angleY); float sy = sin(angleY);
            float cz = cos(angleZ); float sz = sin(angleZ);

            rot = mat3(cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
                       -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
                       sy, -sx * cy, cx * cy);
        }

        vec3 offset;
        if (axisMode) {
            vec3 axis = assemblyAxisMode
                ? getResolvedAssemblyTumbleAxisVector(transform, instanceCenter)
                : getTumbleAxisVector(transform, uTumbleAxis, localCenter);

            // === OPTIONAL SYNCHRONIZED AXIS TRANSLATION ===
            float wave;
            if (uTumbleTranslationSync == 1) {
                // All instances move together in perfect sync
                wave = sin(t * 1.61803398875);
            } else {
                // Original organic per-instance variation
                float noisePhase = fbm(vec3(seed + 23.7, seed * 1.61803398875, 0.0)) * 6.28318530718;
                float phase = seed * 0.73 + noisePhase;
                float freq = 1.61803398875 * (1.0 + fract(seed * 0.137) * 0.4 - 0.2);
                wave = sin(t * freq + phase);
            }

            float transDrive = getPerceptualDrive(0.3);
            float axisDrive = uAudioTumbleSource != 0 ? getAssemblyAxisDrive() : 1.0;
            float beatBoost = uAudioTumbleSource != 0 
                ? (1.0 + clamp(uAudioBeatIntensity, 0.0, 1.0) * 0.85)
                : 1.0;

            offset = axis * wave * amplitude * transDrive * axisDrive * uAudioAssemblyAxisAmplitudeScale * beatBoost;
        } else {
            float energy = perceptualEnergy();
            offset = vec3(
                (fbm(vec3(seed + 17.31, t * 1.00, 0.0)) / 0.4375 - 1.0),
                (fbm(vec3(seed + 43.67, 0.0, t * 1.17)) / 0.4375 - 1.0),
                (fbm(vec3(0.0, seed + 71.89, t * 0.89)) / 0.4375 - 1.0)
            ) * amplitude * energy;
        }

        mat4 result = transform;
        result[0].xyz = rot * transform[0].xyz;
        result[1].xyz = rot * transform[1].xyz;
        result[2].xyz = rot * transform[2].xyz;
        result[3].xyz = transform[3].xyz + localCenter - rot * localCenter + offset;

        return result;
    }
    return transform;
}

`;