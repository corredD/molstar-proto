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
    ['instanceWave', 'Instances: position wave'],
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
        symAxis: 0, instanceRandom: 0, instanceAxis: 0, instanceNormal: 0, instanceWave: 0, wiggle: 0, object: 0,
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

/** Who the structure motion follows, coarse to fine. Camera, clipping, colour and light stay on the whole view. */
export const AudioAffectLevels = [
    ['all', 'All models'],
    ['model', 'One model'],
    ['entity', 'One entity'],
    ['instance', 'One instance'],
    ['chain', 'One chain'],
    ['residue', 'One residue'],
    ['atom', 'One atom'],
] as const;
export type AudioAffectLevel = typeof AudioAffectLevels[number][0];

export type AudioAffect = {
    level: AudioAffectLevel,
    /** hierarchy model ref, filled when the model is in the scene */
    modelRef?: string,
    entryId?: string,
    modelNum?: number,
    entityId?: string,
    /** assembly operator name; which copy */
    operatorName?: string,
    asymId?: string,
    /** auth seq id */
    seqId?: number,
    insCode?: string,
    atomId?: string,
    altId?: string,
};

export function defaultAudioAffect(): AudioAffect {
    return { level: 'all' };
}

/** a route as stored: no runtime id */
export type AudioRouteDraft = Omit<AudioRoute, 'id'>;

export type AudioRoutingPreset = {
    version: 1,
    name: string,
    routes: AudioRouteDraft[],
    affect: AudioAffect,
};

const AudioRoutingStorageKey = 'vor.audioRouting.v1';
const MaxStoredAudioRoutingPresets = 50;

const AudioRouteSourceSet = new Set<string>(AudioRouteSources.map(s => s[0]));
const AudioRouteTargetSet = new Set<string>(AudioRouteTargets.map(t => t[0]));
const AudioAffectLevelSet = new Set<string>(AudioAffectLevels.map(l => l[0]));

export function canonicalAudioAffect(affect: AudioAffect): AudioAffect {
    const out: AudioAffect = { level: affect.level };
    if (affect.modelRef) out.modelRef = affect.modelRef;
    if (affect.entryId) out.entryId = affect.entryId;
    if (affect.modelNum !== undefined) out.modelNum = affect.modelNum;
    if (affect.entityId) out.entityId = affect.entityId;
    if (affect.operatorName) out.operatorName = affect.operatorName;
    if (affect.asymId) out.asymId = affect.asymId;
    if (affect.seqId !== undefined) out.seqId = affect.seqId;
    if (affect.insCode) out.insCode = affect.insCode;
    if (affect.atomId) out.atomId = affect.atomId;
    if (affect.altId) out.altId = affect.altId;
    return out;
}

export function sameAudioAffect(a: AudioAffect, b: AudioAffect) {
    const x = canonicalAudioAffect(a);
    const y = canonicalAudioAffect(b);
    return (Object.keys(x) as (keyof AudioAffect)[]).length === (Object.keys(y) as (keyof AudioAffect)[]).length
        && (Object.keys(x) as (keyof AudioAffect)[]).every(k => x[k] === y[k]);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function draftFromUnknown(value: unknown): AudioRouteDraft | undefined {
    if (!value || typeof value !== 'object') return;
    const v = value as Partial<AudioRouteDraft>;
    if (typeof v.source !== 'string' || !AudioRouteSourceSet.has(v.source)) return;
    if (typeof v.target !== 'string' || !AudioRouteTargetSet.has(v.target)) return;
    if (v.mode !== 'level' && v.mode !== 'onset') return;
    return {
        enabled: v.enabled !== false,
        source: v.source,
        mode: v.mode,
        target: v.target,
        gain: clampNumber(v.gain, 0, 40, 1),
        floor: clampNumber(v.floor, 0, 40, 0),
        releaseMs: clampNumber(v.releaseMs, 0, 10000, 250),
    };
}

function affectFromUnknown(value: unknown): AudioAffect {
    if (!value || typeof value !== 'object') return defaultAudioAffect();
    const v = value as Partial<AudioAffect>;
    if (typeof v.level !== 'string' || !AudioAffectLevelSet.has(v.level)) return defaultAudioAffect();
    const affect: AudioAffect = { level: v.level as AudioAffectLevel };
    if (typeof v.modelRef === 'string' && v.modelRef) affect.modelRef = v.modelRef;
    if (typeof v.entryId === 'string' && v.entryId) affect.entryId = v.entryId;
    if (typeof v.modelNum === 'number' && Number.isFinite(v.modelNum)) affect.modelNum = v.modelNum;
    if (typeof v.entityId === 'string' && v.entityId) affect.entityId = v.entityId;
    if (typeof v.operatorName === 'string' && v.operatorName) affect.operatorName = v.operatorName;
    if (typeof v.asymId === 'string' && v.asymId) affect.asymId = v.asymId;
    if (typeof v.seqId === 'number' && Number.isFinite(v.seqId)) affect.seqId = v.seqId;
    if (typeof v.insCode === 'string' && v.insCode) affect.insCode = v.insCode;
    if (typeof v.atomId === 'string' && v.atomId) affect.atomId = v.atomId;
    if (typeof v.altId === 'string' && v.altId) affect.altId = v.altId;
    return affect;
}

/** One preset, or a library file `{ presets: [...] }` / a bare array. Unknown routes are dropped. */
export function parseAudioRouting(text: string): AudioRoutingPreset[] | undefined {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return;
    }
    const list = Array.isArray(data) ? data
        : data && typeof data === 'object' && Array.isArray((data as { presets?: unknown }).presets) ? (data as { presets: unknown[] }).presets
            : [data];
    const presets: AudioRoutingPreset[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Partial<AudioRoutingPreset> & { routes?: unknown };
        const routes = Array.isArray(record.routes) ? record.routes.map(draftFromUnknown).filter((d): d is AudioRouteDraft => !!d) : [];
        if (!routes.length) continue;
        const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : 'Routing';
        presets.push({ version: 1, name, routes, affect: affectFromUnknown(record.affect) });
    }
    return presets.length ? presets : undefined;
}

export function serializeAudioRouting(presets: readonly AudioRoutingPreset[]) {
    return JSON.stringify({ version: 1, presets }, null, 2);
}

export function routesFromDrafts(routes: readonly AudioRouteDraft[]) {
    return routes.map(route => createAudioRoute(route));
}

/** Drop the runtime id. Loading assigns a fresh one. */
export function draftsFromRoutes(routes: readonly AudioRoute[]): AudioRouteDraft[] {
    return routes.map(({ enabled, source, mode, target, gain, floor, releaseMs }) => ({ enabled, source, mode, target, gain, floor, releaseMs }));
}

function storage(): Storage | undefined {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export function loadStoredAudioRouting(): AudioRoutingPreset[] {
    const raw = storage()?.getItem(AudioRoutingStorageKey);
    if (!raw) return [];
    return parseAudioRouting(raw) ?? [];
}

export function storeAudioRouting(presets: readonly AudioRoutingPreset[]) {
    const kept = presets.slice(0, MaxStoredAudioRoutingPresets);
    try {
        // private mode and a full store throw; the caller still keeps the list in memory
        storage()?.setItem(AudioRoutingStorageKey, serializeAudioRouting(kept));
    } catch {
        // ignored
    }
    return kept;
}
