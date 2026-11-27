/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Audio routing: each route takes one audio source (a stem, a band, the beat) to one visual channel, with its own gain,
 * floor and release. A channel's drive is the sum of the routes that apply to everyone. A route that names one model,
 * entity, instance, or chain is handed to the shader on its own, so that chain can follow it alone.
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
    ['songLoudness', 'Loudness (vs. the song)'],
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
    ['background', 'Background flash'],
    ['cameraStep', 'Camera step (phrases)'],
    ['duck', 'Duck the other routes'],
] as const;
export type AudioRouteTarget = typeof AudioRouteTargets[number][0];
export type AudioRouteDrives = Record<AudioRouteTarget, number>;

export const AudioRouteCurves = [
    ['linear', 'Linear'],
    ['log', 'Log'],
    ['exp', 'Exp'],
] as const;
export type AudioRouteCurve = typeof AudioRouteCurves[number][0];
const AudioRouteCurveSet = new Set<string>(AudioRouteCurves.map(c => c[0]));

/** how strongly log and exp bend: 0.1 reads 0.29 under log, 0.03 under exp; 0 and 1 stay put */
const CurveBase = 10;
const LogCurveNorm = 1 / Math.log(CurveBase);

/** bends a source value in [0, 1] (and past it, for the bands that exceed 1) */
export function applyAudioRouteCurve(curve: AudioRouteCurve, x: number) {
    if (x <= 0) return 0;
    switch (curve) {
        case 'linear': return x;
        case 'log': return Math.log1p((CurveBase - 1) * x) * LogCurveNorm;
        case 'exp': return (Math.pow(CurveBase, x) - 1) / (CurveBase - 1);
    }
}

export type AudioRoute = {
    id: number,
    enabled: boolean,
    source: AudioRouteSource,
    /** the source's level, or its onsets (how much it just rose, normalized by its running peak) */
    mode: 'level' | 'onset',
    /** how the source is bent before the gain: log lifts the quiet parts, exp keeps only the peaks */
    curve: AudioRouteCurve,
    target: AudioRouteTarget,
    /** the route's value is floor + gain x source, before the release */
    gain: number,
    floor: number,
    /** how long a peak takes to fall back, ms (the rise is immediate) */
    releaseMs: number,
    /** who this route moves. Only structure-motion targets use it; anything else stays All. */
    affect: AudioAffect,
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
        background: 0, cameraStep: 0, duck: 0,
    };
}

let nextRouteId = 1;
export function createAudioRoute(route: Omit<AudioRoute, 'id' | 'affect' | 'curve'> & { affect?: AudioAffect, curve?: AudioRouteCurve }): AudioRoute {
    const { affect, curve, ...rest } = route;
    return { id: nextRouteId++, ...rest, curve: curve ?? 'linear', affect: affect ? canonicalAudioAffect(affect) : defaultAudioAffect() };
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
/**
 * The duck channel, like a sidechain compressor keyed by the kick: every route not fed by a duck route's own source is
 * scaled by 1 - duck, down to DuckFloor, so a drum hit leaves room for itself (Pack, Sonarworks 2020, sidechain compression: attack under 10 ms,
 * release 20-75 ms or a beat; the duck routes give their own release)
 */
const DuckFloor = 0.1;
/** onsets: the running peak they are normalized by falls back over this long */
const OnsetPeakDecayMs = 3000;
const OnsetPeakFloor = 0.02;
/**
 * 'songLoudness': the loudness read against its running average, as MilkDrop reads its bands (Geiss, preset authoring
 * guide: 1.0 is the average, above 1.3 loud). The raw loudness sits near 0.05 on most tracks, too little for a level
 * route to show; here the average reads 0.5 and twice the average or more reads 1.
 */
const SongAverageMs = 8000;
const SongAverageFloor = 0.005;

export function getAudioRouteSourceValue(source: AudioRouteSource, frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels) {
    const b = frame.frequencyBands;
    switch (source) {
        case 'stemDrums': return stems.drums;
        case 'stemBass': return stems.bass;
        case 'stemOther': return stems.other;
        case 'stemVocals': return stems.vocals;
        case 'beat': return frame.beatIntensity;
        case 'amplitude': case 'songLoudness': return frame.amplitude;
        case 'subBass': return b.subBass;
        case 'bass': return b.bass;
        case 'lowMids': return b.lowMids;
        case 'mids': return b.mids;
        case 'highMids': return b.highMids;
        case 'treble': return b.treble;
        case 'midsTreble': return Math.min(2, frame.mix * 0.25 + b.mids * 0.45 + b.highMids * 0.35 + b.treble * 0.25);
    }
}

type RouteState = { previous: number, peak: number, songAverage: number, value: number };

/** Evaluates the routes each frame: each route's value (for its meter) and each channel's drive */
export class AudioRouter {
    private states = new Map<number, RouteState>();
    readonly drives = createZeroDrives();
    /** each route's current value, by id */
    readonly values = new Map<number, number>();
    /** routes narrowed to one part of the structure. Length matches scopeCount; kind and drive are the shader slots. */
    readonly scopes: AudioScopeSlot[] = [];
    readonly scopeKind = new Array<number>(AudioScopeSlotCount).fill(0);
    readonly scopeDrive = new Array<number>(AudioScopeSlotCount).fill(0);
    scopeCount = 0;

    update(routes: readonly AudioRoute[], frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels, dtMs: number) {
        // a non-finite dt counts as 0: the value follows its target at once, the song average does not step
        if (!Number.isFinite(dtMs)) dtMs = 0;
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = 0;
        this.scopes.length = 0;
        // first every route's value, then the duck they add up to, then each route's share of its channel
        let duckDrive = 0;
        const duckSources = new Set<AudioRouteSource>();
        for (const route of routes) {
            let state = this.states.get(route.id);
            if (!state) this.states.set(route.id, state = { previous: 0, peak: OnsetPeakFloor, songAverage: 0, value: 0 });
            // a non-finite source reads as 0: one NaN frame must not stay in the route's state for good
            const read = getAudioRouteSourceValue(route.source, frame, stems);
            const raw = Number.isFinite(read) ? read : 0;
            let input = raw;
            if (route.source === 'songLoudness' && route.mode === 'level') {
                // the first frame starts the average; after that it follows over SongAverageMs
                state.songAverage = state.songAverage <= 0 ? raw : state.songAverage + (raw - state.songAverage) * (1 - Math.exp(-dtMs / SongAverageMs));
                input = Math.min(1, raw / (2 * Math.max(SongAverageFloor, state.songAverage)));
            } else if (route.mode === 'onset') {
                const rise = Math.max(0, raw - state.previous);
                state.peak = Math.max(rise, OnsetPeakFloor, state.peak * Math.exp(-dtMs / OnsetPeakDecayMs));
                input = Math.min(1, rise / state.peak);
            }
            state.previous = raw;
            input = applyAudioRouteCurve(route.curve, input);
            const target = route.enabled ? Math.max(0, route.floor + route.gain * input) : 0;
            // immediate rise, exponential release
            state.value = target >= state.value || route.releaseMs <= 0 || dtMs <= 0
                ? target
                : state.value + (target - state.value) * (1 - Math.exp(-dtMs / route.releaseMs));
            this.values.set(route.id, state.value);
            if (route.enabled && route.target === 'duck') {
                duckDrive += state.value;
                duckSources.add(route.source);
            }
        }
        const duck = Math.max(DuckFloor, 1 - Math.min(1, duckDrive));
        for (const route of routes) {
            if (!route.enabled) continue;
            const value = this.values.get(route.id) ?? 0;
            // the key itself is never ducked: a kick ducking the rest still hits at full strength
            const scaled = route.target === 'duck' || route.target === 'cameraStep' || duckSources.has(route.source) ? value : value * duck;
            if (route.affect && route.affect.level !== 'all' && routeHasScope(route.target)) {
                // a narrowed route never falls into the global drive: with the slots full it adds nothing (D3)
                if (this.scopes.length < AudioScopeSlotCount) {
                    this.scopes.push({ kind: AudioScopeKinds[route.target], drive: Math.min(MaxDrive, scaled), affect: route.affect });
                }
            } else {
                this.drives[route.target] += scaled;
            }
        }
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = Math.min(MaxDrive, this.drives[t]);
        this.scopeCount = this.scopes.length;
        for (let i = 0; i < AudioScopeSlotCount; i++) {
            const slot = this.scopes[i];
            this.scopeKind[i] = slot ? slot.kind : 0;
            this.scopeDrive[i] = slot ? slot.drive : 0;
        }
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
        this.scopes.length = 0;
        this.scopeCount = 0;
        this.scopeKind.fill(0);
        this.scopeDrive.fill(0);
        for (const t of Object.keys(this.drives) as AudioRouteTarget[]) this.drives[t] = 0;
    }
}

/** shader slot ids for a route that can be limited to one part of the structure */
export const AudioScopeSlotCount = 8;
export const AudioScopeKinds = {
    symAxis: 1,
    instanceRandom: 2,
    instanceAxis: 3,
    instanceNormal: 4,
    instanceWave: 5,
    wiggle: 6,
    object: 7,
    illumination: 8,
    colorSpectrum: 9,
} as const;
export type AudioScopeTarget = keyof typeof AudioScopeKinds;
export type AudioScopeSlot = { kind: number, drive: number, affect: AudioAffect };

export function routeHasScope(target: AudioRouteTarget): target is AudioScopeTarget {
    return Object.prototype.hasOwnProperty.call(AudioScopeKinds, target);
}

/** How far the route's menu goes. Atom wiggle can name one atom; the other structure channels stop at a chain. */
export function maxScopeLevel(target: AudioRouteTarget): AudioAffectLevel {
    // per vertex, so down to one atom: the wiggle, the glow, the hue
    if (target === 'wiggle' || target === 'illumination' || target === 'colorSpectrum') return 'atom';
    if (routeHasScope(target)) return 'chain';
    return 'all';
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
    /** each with its own affect */
    routes: AudioRouteDraft[],
    /** files from before the per-route affect: the one affect every route took; read, not written */
    affect?: AudioAffect,
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

function draftFromUnknown(value: unknown, fallback?: AudioAffect): AudioRouteDraft | undefined {
    if (!value || typeof value !== 'object') return;
    const v = value as Partial<AudioRouteDraft>;
    if (typeof v.source !== 'string' || !AudioRouteSourceSet.has(v.source)) return;
    if (typeof v.target !== 'string' || !AudioRouteTargetSet.has(v.target)) return;
    if (v.mode !== 'level' && v.mode !== 'onset') return;
    const own = (v as { affect?: unknown }).affect;
    let affect = own !== undefined ? affectFromUnknown(own) : (fallback ?? defaultAudioAffect());
    if (!routeHasScope(v.target)) affect = defaultAudioAffect();
    return {
        enabled: v.enabled !== false,
        source: v.source,
        mode: v.mode,
        curve: typeof v.curve === 'string' && AudioRouteCurveSet.has(v.curve) ? v.curve as AudioRouteCurve : 'linear',
        target: v.target,
        gain: clampNumber(v.gain, 0, 40, 1),
        floor: clampNumber(v.floor, 0, 40, 0),
        releaseMs: clampNumber(v.releaseMs, 0, 10000, 250),
        affect,
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
        const fallback = affectFromUnknown(record.affect);
        const routes = Array.isArray(record.routes) ? record.routes.map(item => draftFromUnknown(item, fallback)).filter((d): d is AudioRouteDraft => !!d) : [];
        if (!routes.length) continue;
        const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : 'Routing';
        presets.push({ version: 1, name, routes });
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
    return routes.map(({ enabled, source, mode, curve, target, gain, floor, releaseMs, affect }) => ({
        enabled, source, mode, curve, target, gain, floor, releaseMs, affect: canonicalAudioAffect(affect),
    }));
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
