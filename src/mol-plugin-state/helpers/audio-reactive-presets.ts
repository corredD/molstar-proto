/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AnimationProps, AudioReactiveSourceName } from '../../mol-geo/geometry/animation';
import { AudioReactiveAnimationManagerValues } from '../manager/audio-reactive-animation';
import { AudioRoute, AudioRouteSource, AudioRouteTarget, createAudioRoute, getDefaultAudioRoutes } from '../manager/audio-routing';

export type AudioReactivePresetName =
    | 'drums-bass-burst'
    | 'punchy-drums'
    | 'bass-groove'
    | 'bass-groove-strong'
    | 'bass-spectrum'
    | 'subtle-drift'
    | 'stem-drift'
    | 'ambient-pulse'
    | 'performance'
    | 'full-spectrum';

export type AudioReactivePresetDefinition = {
    name: AudioReactivePresetName,
    label: string,
    description: string,
    analysis: Partial<AudioReactiveAnimationManagerValues>,
    /** the shape of each motion (amplitudes, speeds) and which motions are on */
    animation: Partial<AnimationProps>,
    /** which audio drives which channel; without it, made from the animation's audio sources (getPresetRoutes) */
    routes?: () => AudioRoute[],
};

export const AudioReactivePresetDefinitions: readonly AudioReactivePresetDefinition[] = [
    {
        name: 'drums-bass-burst',
        label: 'Drums & Bass Burst',
        description: 'Drum hits and the bass burst the capsid out along its symmetry axes (with the beat cycle), the other instruments wiggle the atoms, the voice lights it. Best with Stem Separation on.',
        analysis: {
            fftSize: 1024,
            analysisSampleRate: 24000,
            bandNormalizationGain: 12,
            amplitudeAttackMs: 10,
            amplitudeReleaseMs: 160,
            bandAttackMs: 12,
            bandReleaseMs: 220,
            beatAttackMs: 0,
            beatReleaseMs: 190,
            dominantFrequencyAttackMs: 10,
            dominantFrequencyReleaseMs: 130,
            beatThreshold: 1.1,
            beatSensitivity: 12,
            beatBaselineMs: 210,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 6,
            wiggleAmplitude: 0.7,
            wiggleFrequency: 0.18,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.05,
            tumbleAmplitude: 8,
            tumbleFrequency: 0.18,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            // on, but still until a route drives it
            objectTransformEnabled: true,
            objectTransformSpeed: 0.55,
            objectTransformAmplitude: 0.8,
        },
        routes: getDefaultAudioRoutes,
    },
    {
        name: 'punchy-drums',
        label: 'Punchy Drums',
        description: 'Strong beat-driven translation with fast onset and medium decay.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1,
            fftSize: 1024,
            analysisSampleRate: 24000,
            bandNormalizationGain: 12,
            amplitudeAttackMs: 8,
            amplitudeReleaseMs: 120,
            bandAttackMs: 8,
            bandReleaseMs: 180,
            beatAttackMs: 0,
            beatReleaseMs: 240,
            dominantFrequencyAttackMs: 8,
            dominantFrequencyReleaseMs: 120,
            beatThreshold: 1.08,
            beatSensitivity: 16,
            beatBaselineMs: 180,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 7,
            wiggleAmplitude: 0.45,
            wiggleFrequency: 0.2,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.2,
            tumbleAmplitude: 8,
            tumbleFrequency: 0.2,
            audioWiggleSource: 'highMids',
            audioWiggleStrength: 0.8,
            audioWiggleFloor: 0,
            audioTumbleSource: 'beat',
            audioTumbleStrength: 2.6,
            audioTumbleFloor: 0,
        }
    },
    {
        name: 'bass-groove',
        label: 'Bass Groove',
        description: 'Sustained low-end motion with smoother translation.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1.25,
            fftSize: 2048,
            analysisSampleRate: 24000,
            bandNormalizationGain: 10,
            amplitudeAttackMs: 12,
            amplitudeReleaseMs: 180,
            bandAttackMs: 20,
            bandReleaseMs: 280,
            beatAttackMs: 0,
            beatReleaseMs: 180,
            dominantFrequencyAttackMs: 12,
            dominantFrequencyReleaseMs: 160,
            beatThreshold: 1.18,
            beatSensitivity: 10,
            beatBaselineMs: 240,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 6,
            wiggleAmplitude: 0.35,
            wiggleFrequency: 0.18,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.0,
            tumbleAmplitude: 6,
            tumbleFrequency: 0.18,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'lowMids',
            audioWiggleStrength: 0.7,
            audioWiggleFloor: 0.05,
            audioTumbleSource: 'bass',
            audioTumbleStrength: 3.1,
            audioTumbleFloor: 0.14,
        }
    },
    {
        name: 'bass-groove-strong',
        label: 'Bass Groove Strong',
        description: 'Stronger low-end translation with a bit more visual weight.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1.35,
            fftSize: 1024,
            analysisSampleRate: 24000,
            bandNormalizationGain: 12,
            amplitudeAttackMs: 10,
            amplitudeReleaseMs: 170,
            bandAttackMs: 14,
            bandReleaseMs: 240,
            beatAttackMs: 0,
            beatReleaseMs: 180,
            dominantFrequencyAttackMs: 10,
            dominantFrequencyReleaseMs: 140,
            beatThreshold: 1.12,
            beatSensitivity: 12,
            beatBaselineMs: 220,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 5.5,
            wiggleAmplitude: 0.2,
            wiggleFrequency: 0.16,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.0,
            tumbleAmplitude: 9,
            tumbleFrequency: 0.18,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'lowMids',
            audioWiggleStrength: 0.4,
            audioWiggleFloor: 0.02,
            audioTumbleSource: 'bass',
            audioTumbleStrength: 4.0,
            audioTumbleFloor: 0.22,
        }
    },
    {
        name: 'bass-spectrum',
        label: 'Bass + Spectrum',
        description: 'Strong bass translation combined with broad full-spectrum motion.',
        analysis: {
            wiggleEffectScale: 1.05,
            tumbleEffectScale: 1.35,
            fftSize: 1024,
            analysisSampleRate: 24000,
            bandNormalizationGain: 12,
            amplitudeAttackMs: 10,
            amplitudeReleaseMs: 160,
            bandAttackMs: 12,
            bandReleaseMs: 220,
            beatAttackMs: 0,
            beatReleaseMs: 190,
            dominantFrequencyAttackMs: 10,
            dominantFrequencyReleaseMs: 130,
            beatThreshold: 1.1,
            beatSensitivity: 12,
            beatBaselineMs: 210,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 7.2,
            wiggleAmplitude: 0.75,
            wiggleFrequency: 0.18,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.05,
            tumbleAmplitude: 8,
            tumbleFrequency: 0.18,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'midsTreble',
            audioWiggleStrength: 1.65,
            audioWiggleFloor: 0.14,
            audioTumbleSource: 'bass',
            audioTumbleStrength: 3.8,
            audioTumbleFloor: 0.18,
            objectTransformEnabled: true,
            objectTransformSpeed: 0.55,
            objectTransformAmplitude: 0.8,
            objectTransformSource: 'midsTreble',
            objectTransformStrength: 0.9,
            objectTransformFloor: 0.08,
        }
    },
    {
        name: 'subtle-drift',
        label: 'Subtle Drift',
        description: 'Gentle motion: slow envelopes, small displacements, the bass breathing and the rest shimmering.',
        analysis: {
            fftSize: 2048,
            analysisSampleRate: 24000,
            bandNormalizationGain: 8,
            amplitudeAttackMs: 60,
            amplitudeReleaseMs: 450,
            bandAttackMs: 60,
            bandReleaseMs: 500,
            beatAttackMs: 20,
            beatReleaseMs: 380,
            dominantFrequencyAttackMs: 40,
            dominantFrequencyReleaseMs: 300,
            beatThreshold: 1.3,
            beatSensitivity: 6,
            beatBaselineMs: 400,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 5,
            wiggleAmplitude: 0.55,
            wiggleFrequency: 0.15,
            instanceTumbleEnabled: true,
            tumbleSpeed: 0.8,
            tumbleAmplitude: 6,
            tumbleFrequency: 0.15,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'midsTreble',
            audioWiggleStrength: 1.2,
            audioWiggleFloor: 0.1,
            audioTumbleSource: 'bass',
            audioTumbleStrength: 2.4,
            audioTumbleFloor: 0.12,
            objectTransformEnabled: true,
            objectTransformSpeed: 0.45,
            objectTransformAmplitude: 0.6,
            objectTransformSource: 'midsTreble',
            objectTransformStrength: 0.7,
            objectTransformFloor: 0.06,
        }
    },
    {
        name: 'stem-drift',
        label: 'Stem Drift',
        description: 'One stem per motion: the drums burst the subunits out along the symmetry axes on each hit, the bass sways the whole capsid, the other instruments shimmer the atoms. Picked when Stem Separation is turned on.',
        analysis: {
            fftSize: 2048,
            analysisSampleRate: 24000,
            bandNormalizationGain: 8,
            amplitudeAttackMs: 60,
            amplitudeReleaseMs: 450,
            bandAttackMs: 40,
            bandReleaseMs: 450,
            beatAttackMs: 20,
            beatReleaseMs: 380,
            dominantFrequencyAttackMs: 40,
            dominantFrequencyReleaseMs: 300,
            beatThreshold: 1.3,
            beatSensitivity: 6,
            beatBaselineMs: 400,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 5,
            wiggleAmplitude: 0.55,
            wiggleFrequency: 0.15,
            instanceTumbleEnabled: true,
            tumbleSpeed: 0.8,
            tumbleAmplitude: 6,
            tumbleFrequency: 0.15,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'stemOther',
            audioWiggleStrength: 1.3,
            audioWiggleFloor: 0.1,
            audioTumbleSource: 'stemDrums',
            audioTumbleStrength: 2.8,
            audioTumbleFloor: 0.04,
            objectTransformEnabled: true,
            objectTransformSpeed: 0.45,
            objectTransformAmplitude: 0.6,
            objectTransformSource: 'stemBass',
            objectTransformStrength: 0.8,
            objectTransformFloor: 0.05,
        }
    },
    {
        name: 'ambient-pulse',
        label: 'Ambient Pulse',
        description: 'Low continuous motion for slower or softer tracks.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1,
            fftSize: 2048,
            analysisSampleRate: 22050,
            bandNormalizationGain: 8,
            amplitudeAttackMs: 25,
            amplitudeReleaseMs: 260,
            bandAttackMs: 30,
            bandReleaseMs: 320,
            beatAttackMs: 10,
            beatReleaseMs: 260,
            dominantFrequencyAttackMs: 30,
            dominantFrequencyReleaseMs: 220,
            beatThreshold: 1.25,
            beatSensitivity: 8,
            beatBaselineMs: 320,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 4.2,
            wiggleAmplitude: 0.95,
            wiggleFrequency: 0.12,
            instanceTumbleEnabled: false,
            tumbleSpeed: 0.8,
            tumbleAmplitude: 2.2,
            tumbleFrequency: 0.16,
            audioWiggleSource: 'midsTreble',
            audioWiggleStrength: 1.35,
            audioWiggleFloor: 0.22,
            audioTumbleSource: 'amplitude',
            audioTumbleStrength: 1.4,
            audioTumbleFloor: 0.18,
            objectTransformEnabled: true,
            objectTransformSpeed: 0.45,
            objectTransformAmplitude: 1.35,
            objectTransformSource: 'midsTreble',
            objectTransformStrength: 1.25,
            objectTransformFloor: 0.18,
        }
    },
    {
        name: 'performance',
        label: 'Performance',
        description: 'Lower-cost audio motion with tumble emphasized and wiggle mostly disabled.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1.15,
            fftSize: 1024,
            analysisSampleRate: 22050,
            bandNormalizationGain: 9,
            amplitudeAttackMs: 15,
            amplitudeReleaseMs: 160,
            bandAttackMs: 20,
            bandReleaseMs: 220,
            beatAttackMs: 0,
            beatReleaseMs: 180,
            dominantFrequencyAttackMs: 15,
            dominantFrequencyReleaseMs: 140,
            beatThreshold: 1.16,
            beatSensitivity: 10,
            beatBaselineMs: 220,
        },
        animation: {
            atomWiggleEnabled: false,
            wiggleMode: 'position',
            wiggleSpeed: 5,
            wiggleAmplitude: 0,
            wiggleFrequency: 0.16,
            instanceTumbleEnabled: true,
            tumbleSpeed: 0.95,
            tumbleAmplitude: 5.5,
            tumbleFrequency: 0.18,
            tumbleTranslationMode: 'axis',
            tumbleAxisSource: 'assembly',
            tumbleAxis: 'z',
            audioWiggleSource: 'off',
            audioWiggleStrength: 0,
            audioWiggleFloor: 0,
            audioTumbleSource: 'bass',
            audioTumbleStrength: 2.8,
            audioTumbleFloor: 0.14,
        }
    },
    {
        name: 'full-spectrum',
        label: 'Full Spectrum',
        description: 'Broad energy response with stronger mids and highs.',
        analysis: {
            wiggleEffectScale: 1,
            tumbleEffectScale: 1,
            fftSize: 1024,
            analysisSampleRate: 0,
            bandNormalizationGain: 11,
            amplitudeAttackMs: 10,
            amplitudeReleaseMs: 150,
            bandAttackMs: 12,
            bandReleaseMs: 200,
            beatAttackMs: 0,
            beatReleaseMs: 200,
            dominantFrequencyAttackMs: 10,
            dominantFrequencyReleaseMs: 120,
            beatThreshold: 1.12,
            beatSensitivity: 12,
            beatBaselineMs: 220,
        },
        animation: {
            atomWiggleEnabled: true,
            wiggleMode: 'position',
            wiggleSpeed: 7.5,
            wiggleAmplitude: 0.9,
            wiggleFrequency: 0.2,
            instanceTumbleEnabled: true,
            tumbleSpeed: 1.1,
            tumbleAmplitude: 5,
            tumbleFrequency: 0.2,
            audioWiggleSource: 'midsTreble',
            audioWiggleStrength: 1.55,
            audioWiggleFloor: 0.12,
            audioTumbleSource: 'mix',
            audioTumbleStrength: 1.7,
            audioTumbleFloor: 0.06,
            objectTransformEnabled: true,
            objectTransformSpeed: 0.7,
            objectTransformAmplitude: 0.9,
            objectTransformSource: 'midsTreble',
            objectTransformStrength: 1,
            objectTransformFloor: 0.1,
            objectTransformMode: 'spectral',
        }
    },
] as const;

function toRouteSource(source: AudioReactiveSourceName): AudioRouteSource | undefined {
    switch (source) {
        case 'off': return undefined;
        case 'peakAmplitude': case 'mix': return 'amplitude';
        case 'dominantFrequency': return 'midsTreble';
        default: return source;
    }
}

/** the motion switch (an AnimationProps flag) a route target needs on to move anything; instanceWave and the rest need none */
export const MotionFlagOfTarget: Partial<Record<AudioRouteTarget, 'atomWiggleEnabled' | 'instanceTumbleEnabled' | 'objectTransformEnabled'>> = {
    wiggle: 'atomWiggleEnabled',
    symAxis: 'instanceTumbleEnabled',
    instanceRandom: 'instanceTumbleEnabled',
    instanceAxis: 'instanceTumbleEnabled',
    instanceNormal: 'instanceTumbleEnabled',
    object: 'objectTransformEnabled',
};

/**
 * A preset's routes: its own, or made from its animation's audio sources (the presets from before the routing): the
 * wiggle source to the wiggle, the tumble source to the symmetry axes, an axis or random by its translation mode, the
 * object source to the whole object
 */
export function getPresetRoutes(preset: AudioReactivePresetDefinition): AudioRoute[] {
    // no route on a motion the preset turns off: it would move nothing (the defaults: wiggle and tumble on, object off)
    const a = preset.animation;
    const on = { atomWiggleEnabled: a.atomWiggleEnabled !== false, instanceTumbleEnabled: a.instanceTumbleEnabled !== false, objectTransformEnabled: a.objectTransformEnabled === true };
    const moves = (r: AudioRoute) => { const flag = MotionFlagOfTarget[r.target]; return !flag || on[flag]; };
    if (preset.routes) return preset.routes().filter(moves);
    const routes: AudioRoute[] = [];
    const add = (source: AudioReactiveSourceName | undefined, target: AudioRouteTarget, gain = 1, floor = 0, mode: 'level' | 'onset' = 'level') => {
        const s = source && toRouteSource(source);
        if (!s) return;
        routes.push(createAudioRoute({ enabled: true, source: s, mode, target, gain, floor, releaseMs: 200 }));
    };
    add(a.audioWiggleSource, 'wiggle', a.audioWiggleStrength, a.audioWiggleFloor);
    const tumbleTarget: AudioRouteTarget = a.tumbleTranslationMode === 'axis'
        ? (a.tumbleAxisSource === 'assembly' ? 'symAxis' : 'instanceAxis')
        : 'instanceRandom';
    // the old symmetry-axis motion was also multiplied by the bass: a bass route alongside
    if (tumbleTarget === 'symAxis') {
        add(a.audioTumbleSource, tumbleTarget, (a.audioTumbleStrength ?? 1) * 0.5, a.audioTumbleFloor);
        add('bass', 'symAxis', 0.8);
    } else {
        add(a.audioTumbleSource, tumbleTarget, a.audioTumbleStrength, a.audioTumbleFloor);
    }
    add(a.objectTransformSource, 'object', a.objectTransformStrength, a.objectTransformFloor);
    return routes.filter(moves);
}

export function getAudioReactivePreset(name: AudioReactivePresetName) {
    const preset = AudioReactivePresetDefinitions.find(p => p.name === name);
    if (!preset) throw new Error(`Unknown audio reactive preset '${name}'.`);
    return preset;
}
