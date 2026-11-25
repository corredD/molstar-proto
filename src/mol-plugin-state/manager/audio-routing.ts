/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Audio routing: each route takes one audio source (a stem, a band, the beat) to one visual channel, with its own gain,
 * floor and release. A channel's drive is the sum of its routes, computed on the CPU each frame and handed to the
 * shaders (motion, illumination) or to the app (camera, clipping) as one number per channel.
 */

import type { AudioReactiveFrame, DefaultAudioBandKey } from './audio-reactor';
import type { StemLevels } from './audio-stems/stem-separator';

export const AudioRouteSources = [
    ['stemDrums', 'Drums (stem)'],
    ['stemBass', 'Bass (stem)'],
    ['stemOther', 'Other (stem)'],
    ['stemVocals', 'Vocals (stem)'],
    ['beat', 'Beat'],
    ['amplitude', 'Loudness'],
    ['subBass', 'Sub-bass'],
    ['bass', 'Bass band'],
    ['lowMids', 'Low-mids'],
    ['mids', 'Mids'],
    ['highMids', 'High-mids'],
    ['treble', 'Treble'],
    ['midsTreble', 'Mids/Treble'],
] as const;
export type AudioRouteSource = typeof AudioRouteSources[number][0];

export const AudioRouteTargets = [
    ['symAxis', 'Symmetry axes (beat cycle)'],
    ['instanceRandom', 'Instances: random'],
    ['instanceAxis', 'Instances: along an axis'],
    ['instanceNormal', 'Instances: along the normal'],
    ['wiggle', 'Atoms: wiggle'],
    ['object', 'Whole object'],
    ['illumination', 'Illumination'],
    ['cameraZoom', 'Camera zoom'],
    ['cameraSpin', 'Camera spin'],
    ['cameraRock', 'Camera rock'],
    ['colorSpectrum', 'Colors: spectrum'],
    ['opacity', 'Opacity (fade)'],
    ['clipPosition', 'Clip object: position'],
    ['clipSize', 'Clip object: size'],
] as const;
export type AudioRouteTarget = typeof AudioRouteTargets[number][0];
export type AudioRouteDrives = Record<AudioRouteTarget, number>;

export type AudioRoute = {
    id: number,
    enabled: boolean,
    source: AudioRouteSource,
    /** the source's level, or its onsets (how much it just rose, normalized by its running peak) */
    mode: 'level' | 'onset',
    target: AudioRouteTarget,
    /** the route's value is floor + gain x source, before the release */
    gain: number,
    floor: number,
    /** how long a peak takes to fall back, ms (the rise is immediate) */
    releaseMs: number,
};

export function getAudioRouteSourceLabel(source: AudioRouteSource) {
    return AudioRouteSources.find(s => s[0] === source)?.[1] ?? source;
}

export function getAudioRouteTargetLabel(target: AudioRouteTarget) {
    return AudioRouteTargets.find(t => t[0] === target)?.[1] ?? target;
}

export function createZeroDrives(): AudioRouteDrives {
    return {
        symAxis: 0, instanceRandom: 0, instanceAxis: 0, instanceNormal: 0, wiggle: 0, object: 0,
        illumination: 0, cameraZoom: 0, cameraSpin: 0, cameraRock: 0, colorSpectrum: 0, opacity: 0, clipPosition: 0, clipSize: 0,
    };
}

let nextRouteId = 1;
export function createAudioRoute(route: Omit<AudioRoute, 'id'>): AudioRoute {
    return { id: nextRouteId++, ...route };
}

/** The starting routes: drums and bass explode the capsid along its symmetry axes, the rest of the band wiggles the atoms, the voice lights it */
export function getDefaultAudioRoutes(): AudioRoute[] {
    return [
        // the symmetry axes at 6.5 (Ludo's pick, 2026-11-25)
        createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'symAxis', gain: 6.5, floor: 0, releaseMs: 260 }),
        createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 6.5, floor: 0, releaseMs: 220 }),
        createAudioRoute({ enabled: true, source: 'stemOther', mode: 'level', target: 'wiggle', gain: 2, floor: 0.2, releaseMs: 350 }),
        createAudioRoute({ enabled: true, source: 'stemVocals', mode: 'level', target: 'illumination', gain: 0.6, floor: 0, releaseMs: 400 }),
    ];
}

/** the most a channel's drive reaches, whatever the sum of its routes */
const MaxDrive = 40;
/** onsets: the running peak they are normalized by falls back over this long */
const OnsetPeakDecayMs = 3000;
const OnsetPeakFloor = 0.02;

export function getAudioRouteSourceValue(source: AudioRouteSource, frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels) {
    const b = frame.frequencyBands;
    switch (source) {
        case 'stemDrums': return stems.drums;
        case 'stemBass': return stems.bass;
        case 'stemOther': return stems.other;
        case 'stemVocals': return stems.vocals;
        case 'beat': return frame.beatIntensity;
        case 'amplitude': return frame.amplitude;
        case 'subBass': return b.subBass;
        case 'bass': return b.bass;
        case 'lowMids': return b.lowMids;
        case 'mids': return b.mids;
        case 'highMids': return b.highMids;
        case 'treble': return b.treble;
        case 'midsTreble': return Math.min(2, frame.mix * 0.25 + b.mids * 0.45 + b.highMids * 0.35 + b.treble * 0.25);
    }
}

type RouteState = { previous: number, peak: number, value: number };

/** Evaluates the routes each frame: each route's value (for its meter) and each channel's drive */
export class AudioRouter {
    private states = new Map<number, RouteState>();
    readonly drives = createZeroDrives();
    /** each route's current value, by id */
    readonly values = new Map<number, number>();

    update(routes: readonly AudioRoute[], frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels, dtMs: number) {
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = 0;
        for (const route of routes) {
            let state = this.states.get(route.id);
            if (!state) this.states.set(route.id, state = { previous: 0, peak: OnsetPeakFloor, value: 0 });
            const raw = getAudioRouteSourceValue(route.source, frame, stems);
            let input = raw;
            if (route.mode === 'onset') {
                const rise = Math.max(0, raw - state.previous);
                state.peak = Math.max(rise, OnsetPeakFloor, state.peak * Math.exp(-dtMs / OnsetPeakDecayMs));
                input = Math.min(1, rise / state.peak);
            }
            state.previous = raw;
            const target = route.enabled ? Math.max(0, route.floor + route.gain * input) : 0;
            // immediate rise, exponential release
            state.value = target >= state.value || route.releaseMs <= 0 || dtMs <= 0
                ? target
                : state.value + (target - state.value) * (1 - Math.exp(-dtMs / route.releaseMs));
            this.values.set(route.id, state.value);
            if (route.enabled) this.drives[route.target] += state.value;
        }
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = Math.min(MaxDrive, this.drives[t]);
        // forget removed routes
        if (this.states.size > routes.length) {
            const ids = new Set(routes.map(r => r.id));
            for (const id of this.states.keys()) {
                if (!ids.has(id)) {
                    this.states.delete(id);
                    this.values.delete(id);
                }
            }
        }
        return this.drives;
    }

    reset() {
        this.states.clear();
        this.values.clear();
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = 0;
    }
}
