/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BehaviorSubject } from 'rxjs';
import { StemModelId, StemModels, StemName } from './audio-stems/stem-models';
import { AudioAffect, AudioAffectLevel, AudioRoute, AudioRouteDrives, AudioRouter, AudioScopeSlot, canNarrowRoute, canonicalAudioAffect, createZeroDrives, defaultAudioAffect, getDefaultAudioRoutes, limitNarrowedRoutes, maxScopeLevel, sameAudioAffect } from './audio-routing';
import { audioAffectFromLoci, clampAffectToLevel, resolveAudioAffect, specializeAudioAffect } from '../helpers/audio-affect';
import { StructureElement } from '../../mol-model/structure';
import { StemLevels, StemSeparator, StemSeparatorOptions, StemSeparatorStatus } from './audio-stems/stem-separator';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { PluginContext } from '../../mol-plugin/context';
import {
    AudioReactiveFrame,
    AudioReactor,
    createEmptyAudioReactiveFrame,
    DefaultAudioBandDefinitions,
    DefaultAudioBandKey,
    DefaultAudioReactorParams,
    getAudioReactorAnalyserFftSize,
} from './audio-reactor';
import { AudioReactiveAssemblyAxisOrder, AudioReactiveAssemblyAxisOrderOptions } from '../helpers/assembly-symmetry-axis';

const AudioReactorFftSizeOptions = [
    [256, '256'],
    [512, '512'],
    [1024, '1024'],
    [2048, '2048'],
    [4096, '4096'],
] as const;

const AudioReactorSampleRateOptions = [
    [0, 'Context'],
    [11025, '11025 Hz'],
    [22050, '22050 Hz'],
    [24000, '24000 Hz'],
    [32000, '32000 Hz'],
    [44100, '44100 Hz'],
] as const;

export const AudioReactiveAnimationManagerParams = {
    lodScaleEnabled: PD.Boolean(false, { category: 'Effect', description: 'Scale all motion amplitudes based on camera distance so motion stays visible when zoomed out.' }),
    wiggleEffectScale: PD.Numeric(1, { min: 0, max: 16, step: 0.05 }, { category: 'Effect', description: 'Global multiplier applied to reactive values when driving wiggle.' }),
    tumbleEffectScale: PD.Numeric(1, { min: 0, max: 200, step: 0.05 }, { category: 'Effect', description: 'Global multiplier applied to reactive values when driving tumble.' }),
    objectTransformEffectScale: PD.Numeric(1, { min: 0, max: 32, step: 0.05 }, { category: 'Effect', description: 'Global multiplier applied to reactive values when driving whole-object transform.' }),
    assemblyAxisOrder: PD.Select<AudioReactiveAssemblyAxisOrder>('highest', AudioReactiveAssemblyAxisOrderOptions, { category: 'Effect', description: 'Preferred assembly symmetry axis order when using assembly-based tumble translation.' }),
    assemblyAxisAmplitudeScale: PD.Numeric(1, { min: 0, max: 200, step: 0.05 }, { category: 'Effect', description: 'Extra distance multiplier applied only to assembly-axis tumble translation.' }),
    fftSize: PD.Select(DefaultAudioReactorParams.fftSize, AudioReactorFftSizeOptions, { category: 'Analysis', description: 'FFT size used for the audio analysis window.' }),
    analysisSampleRate: PD.Select(DefaultAudioReactorParams.analysisSampleRate, AudioReactorSampleRateOptions, { category: 'Analysis', label: 'Sample Rate', description: 'Optional analysis resampling rate. Context uses the audio context sample rate.' }),
    bandNormalizationGain: PD.Numeric(DefaultAudioReactorParams.bandNormalizationGain, { min: 0.5, max: 32, step: 0.1 }, { category: 'Analysis', description: 'Gain applied before band values are normalized to 0–1.' }),
    amplitudeAttackMs: PD.Numeric(DefaultAudioReactorParams.amplitudeAttackMs, { min: 0, max: 1000, step: 1 }, { category: 'Smoothing' }),
    amplitudeReleaseMs: PD.Numeric(DefaultAudioReactorParams.amplitudeReleaseMs, { min: 0, max: 2000, step: 1 }, { category: 'Smoothing' }),
    bandAttackMs: PD.Numeric(DefaultAudioReactorParams.bandAttackMs, { min: 0, max: 1000, step: 1 }, { category: 'Smoothing' }),
    bandReleaseMs: PD.Numeric(DefaultAudioReactorParams.bandReleaseMs, { min: 0, max: 2000, step: 1 }, { category: 'Smoothing' }),
    beatAttackMs: PD.Numeric(DefaultAudioReactorParams.beatAttackMs, { min: 0, max: 500, step: 1 }, { category: 'Smoothing' }),
    beatReleaseMs: PD.Numeric(DefaultAudioReactorParams.beatReleaseMs, { min: 0, max: 2000, step: 1 }, { category: 'Smoothing' }),
    dominantFrequencyAttackMs: PD.Numeric(DefaultAudioReactorParams.dominantFrequencyAttackMs, { min: 0, max: 1000, step: 1 }, { category: 'Smoothing' }),
    dominantFrequencyReleaseMs: PD.Numeric(DefaultAudioReactorParams.dominantFrequencyReleaseMs, { min: 0, max: 2000, step: 1 }, { category: 'Smoothing' }),
    beatThreshold: PD.Numeric(DefaultAudioReactorParams.beatThreshold, { min: 0.5, max: 4, step: 0.01 }, { category: 'Beat Detection', description: 'Energy threshold above the running spectral flux baseline.' }),
    beatSensitivity: PD.Numeric(DefaultAudioReactorParams.beatSensitivity, { min: 0.1, max: 32, step: 0.1 }, { category: 'Beat Detection', description: 'Scales beat onset strength after thresholding.' }),
    beatBaselineMs: PD.Numeric(DefaultAudioReactorParams.beatBaselineMs, { min: 10, max: 2000, step: 1 }, { category: 'Beat Detection', description: 'Averaging window used for the onset baseline.' }),
    onsetHalfLifeMs: PD.Numeric(DefaultAudioReactorParams.onsetHalfLifeMs, { min: 0, max: 2000, step: 1 }, { category: 'Prominence', description: 'How long a band keeps credit for a sudden jump in level. Shorter tracks fast rhythms, longer holds the spike.' }),
    onsetWeight: PD.Numeric(DefaultAudioReactorParams.onsetWeight, { min: 0, max: 16, step: 0.1 }, { category: 'Prominence', description: 'How much a sudden jump counts against a steady level. Raise it so a quiet transient can out-rank a loud sustained band.' }),
    temperature: PD.Numeric(DefaultAudioReactorParams.temperature, { min: 0, max: 40, step: 0.5 }, { category: 'Prominence', description: 'Sharpness of the prominence distribution. High values let the loudest band claim almost all the weight.' }),
    activityThreshold: PD.Numeric(DefaultAudioReactorParams.activityThreshold, { min: 0, max: 1, step: 0.005 }, { category: 'Prominence', description: 'Bands quieter than this are treated as silent and excluded, so the rest share the full weight.' }),
    stemModel: PD.Select<'off' | StemModelId>('off', [['off', 'Off'], ...Object.values(StemModels).map(m => [m.id, m.label] as [StemModelId, string])], { category: 'Stems', label: 'Separation', description: 'Split the audio into drums, bass, other and vocals with a model run in the browser (WebGPU). The audio is delayed so the stems line up with what is heard.' }),
    stemExecutionProvider: PD.Select<'webgpu' | 'wasm'>('webgpu', [['webgpu', 'WebGPU'], ['wasm', 'CPU (WASM)']], { category: 'Stems', label: 'Run On', hideIf: p => p.stemModel === 'off' }),
    stemDelaySeconds: PD.Numeric(0, { min: 0, max: 25, step: 0.5 }, { category: 'Stems', label: 'Audio Delay', hideIf: p => p.stemModel === 'off', description: 'How late the audio is heard, seconds; 0 uses the model\'s default. It must cover the model\'s latency, or the stems fall back to the band analysis.' }),
} as const;
export type AudioReactiveAnimationManagerParams = typeof AudioReactiveAnimationManagerParams
export type AudioReactiveAnimationManagerValues = PD.Values<AudioReactiveAnimationManagerParams>;

export type AudioReactiveVisualizationFrame = {
    waveform: Float32Array<ArrayBuffer>,
    spectrum: Float32Array<ArrayBuffer>,
};

export type AudioReactiveStatus = {
    sourceLabel?: string,
    loaded: boolean,
    playing: boolean,
    analysisBlocked: boolean,
    sampleRate?: number,
    frame: AudioReactiveFrame<DefaultAudioBandKey>,
    visualization: AudioReactiveVisualizationFrame,
    /** each stem's level (0-1): from the separation model where it runs and keeps up, else from the bands */
    stems: StemLevels,
    /** whether `stems` came from the separation model this frame */
    stemsSeparated: boolean,
    stemStatus: StemSeparatorStatus,
    /** each visual channel's drive this frame (the sum of its routes) */
    drives: AudioRouteDrives,
    /** each route's value this frame, by route id */
    routeValues: ReadonlyMap<number, number>,
    error?: string,
};

const ZeroStems: StemLevels = { drums: 0, bass: 0, other: 0, vocals: 0 };

/** stand-ins for the stems from the band analysis, when no model separates them */
/** the kick's onset (sub-bass, bass) or a detected beat: what stands in for the drums with no separation */
function getBandDrumsOnset(frame: AudioReactiveFrame<DefaultAudioBandKey>) {
    return Math.max(frame.bandOnsets.subBass, frame.bandOnsets.bass, frame.beatIntensity);
}

/** the band onsets span a few hundredths to a few tenths by track: normalized by their running peak */
const BandDrumsPeakDecayMs = 3000;
const BandDrumsPeakFloor = 0.05;

function getBandStems(frame: AudioReactiveFrame<DefaultAudioBandKey>, drums: number): StemLevels {
    const b = frame.frequencyBands;
    return {
        drums,
        bass: Math.max(b.subBass, b.bass),
        other: (b.lowMids + b.highMids + b.treble) / 3,
        vocals: b.mids,
    };
}

export function getStemDelaySeconds(params: AudioReactiveAnimationManagerValues) {
    if (params.stemModel === 'off') return 0;
    return params.stemDelaySeconds > 0 ? params.stemDelaySeconds : StemModels[params.stemModel].delaySeconds;
}

export type { StemName, StemLevels };

const AudioReactiveWaveformSampleCount = 96;
const AudioReactiveSpectrumSampleCount = 56;
const EmptyAudioReactiveFrame = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);
const EmptyAudioReactiveVisualization = createAudioReactiveVisualizationFrame();
const InitialAudioReactiveStatus: AudioReactiveStatus = {
    loaded: false,
    playing: false,
    analysisBlocked: false,
    frame: EmptyAudioReactiveFrame,
    visualization: EmptyAudioReactiveVisualization,
    stems: ZeroStems,
    stemsSeparated: false,
    stemStatus: { state: 'off' },
    drives: createZeroDrives(),
    routeValues: new Map(),
};

function getAudioContextCtor(): (new() => AudioContext) | undefined {
    const ctx = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    return ctx.AudioContext ?? ctx.webkitAudioContext;
}

function areFramesClose(a: AudioReactiveFrame<DefaultAudioBandKey>, b: AudioReactiveFrame<DefaultAudioBandKey>, epsilon = 1e-3) {
    if (Math.abs(a.amplitude - b.amplitude) > epsilon) return false;
    if (Math.abs(a.peakAmplitude - b.peakAmplitude) > epsilon) return false;
    if (Math.abs(a.beatIntensity - b.beatIntensity) > epsilon) return false;
    if (Math.abs(a.dominantFrequency - b.dominantFrequency) > 0.5) return false;
    if (Math.abs(a.mix - b.mix) > epsilon) return false;
    for (const band of DefaultAudioBandDefinitions) {
        if (Math.abs(a.frequencyBands[band.key] - b.frequencyBands[band.key]) > epsilon) return false;
        if (Math.abs(a.bandOnsets[band.key] - b.bandOnsets[band.key]) > epsilon) return false;
        if (Math.abs(a.bandProminence[band.key] - b.bandProminence[band.key]) > epsilon) return false;
    }
    return true;
}

function createAudioReactiveVisualizationFrame(): AudioReactiveVisualizationFrame {
    return {
        waveform: new Float32Array(AudioReactiveWaveformSampleCount),
        spectrum: new Float32Array(AudioReactiveSpectrumSampleCount),
    };
}

function clearAudioReactiveVisualization(frame: AudioReactiveVisualizationFrame) {
    frame.waveform.fill(0);
    frame.spectrum.fill(0);
}

function writeWaveformSamples(source: Float32Array, target: Float32Array) {
    const lastIndex = Math.max(0, source.length - 1);
    if (source.length === 0) {
        target.fill(0);
        return;
    }

    for (let i = 0, il = target.length; i < il; ++i) {
        const t = il > 1 ? i / (il - 1) : 0;
        const position = t * lastIndex;
        const left = Math.floor(position);
        const right = Math.min(lastIndex, left + 1);
        const alpha = position - left;
        target[i] = source[left] * (1 - alpha) + source[right] * alpha;
    }
}

function writeSpectrumSamples(source: Uint8Array, target: Float32Array) {
    const lastIndex = Math.max(0, source.length - 1);
    if (source.length === 0) {
        target.fill(0);
        return;
    }

    for (let i = 0, il = target.length; i < il; ++i) {
        const startT = il > 0 ? i / il : 0;
        const endT = il > 0 ? (i + 1) / il : 1;
        const start = Math.min(lastIndex, Math.floor(Math.pow(startT, 1.75) * lastIndex));
        const end = Math.max(start + 1, Math.min(source.length, Math.ceil(Math.pow(endT, 1.75) * source.length)));
        let sumSq = 0;
        let count = 0;
        for (let j = start; j < end; ++j) {
            const value = source[j] / 255;
            sumSq += value * value;
            count += 1;
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        target[i] = 1 - Math.exp(-rms * 2.5);
    }
}

export class AudioReactiveAnimationManager {
    readonly state = {
        audioPlayer: new BehaviorSubject<HTMLAudioElement | null>(null),
        status: new BehaviorSubject<AudioReactiveStatus>(InitialAudioReactiveStatus),
        params: new BehaviorSubject<AudioReactiveAnimationManagerValues>(PD.getDefaultValues(AudioReactiveAnimationManagerParams)),
        /** which audio source drives which visual channel, and who each route moves (audio-routing.ts) */
        routes: new BehaviorSubject<AudioRoute[]>(getDefaultAudioRoutes()),
    };

    private router = new AudioRouter();

    private objectUrl?: string;
    private sourceLabel?: string;
    private audioContext?: AudioContext;
    private analyser?: AnalyserNode;
    private sourceNode?: MediaElementAudioSourceNode;
    private timeDomainData?: Float32Array<ArrayBuffer>;
    private frequencyDomainData?: Uint8Array<ArrayBuffer>;
    private silenceData?: Float32Array<ArrayBuffer>;
    private readonly visualization = createAudioReactiveVisualizationFrame();
    private currentFrame = EmptyAudioReactiveFrame;
    private lastUiUpdateMs = 0;
    private lastTickMs = 0;
    private silenceWhilePlayingMs = 0;
    private reactor = new AudioReactor();
    /** what is heard runs through this, late by the stem model's latency (0 with no model) */
    private delayNode?: DelayNode;
    private separator?: StemSeparator;
    private stemStatus: StemSeparatorStatus = { state: 'off' };
    private currentStems: StemLevels = ZeroStems;
    private stemsSeparated = false;
    private bandDrumsPeak = BandDrumsPeakFloor;

    /** where the stem worker, the onnxruntime files and local weights are; next to the app page by default */
    stemSeparatorOptions: StemSeparatorOptions = {
        workerUrl: new URL('stem-worker.js', globalThis.document?.baseURI ?? 'http://localhost/').href,
        wasmPath: new URL('ort/', globalThis.document?.baseURI ?? 'http://localhost/').href,
        localBaseUrls: [
            new URL('models/stems/', globalThis.document?.baseURI ?? 'http://localhost/').href,
            // the dev server serves the repository at the root, the app under build/<app>/
            new URL('../../models/stems/', globalThis.document?.baseURI ?? 'http://localhost/').href,
        ],
    };

    constructor(readonly plugin: PluginContext) {
        this.syncReactorParams();
    }

    get frame() {
        return this.currentFrame;
    }

    /** each route's value this frame, by route id (read-only; the offline pipeline spec reads them per frame) */
    get routeValues(): ReadonlyMap<number, number> {
        return this.router.values;
    }

    /** each visual channel's drive this frame, from the routes on All */
    get drives(): Readonly<AudioRouteDrives> {
        return this.router.drives;
    }

    /** the routes narrowed to one part of the structure this frame: one shader slot each */
    get scopes(): readonly AudioScopeSlot[] {
        return this.router.scopes;
    }

    get scopeCount() {
        return this.router.scopeCount;
    }

    get scopeKind(): ArrayLike<number> {
        return this.router.scopeKind;
    }

    get scopeDrive(): ArrayLike<number> {
        return this.router.scopeDrive;
    }

    /** Installs the routes, with at most 8 narrowed (D3): a narrowed route past the 8th is widened to All */
    setRoutes(routes: AudioRoute[]) {
        this.state.routes.next(limitNarrowedRoutes(routes) as AudioRoute[]);
        this.updateStatus(void 0, true);
    }

    updateRoute(id: number, patch: Partial<Omit<AudioRoute, 'id'>>) {
        this.setRoutes(this.state.routes.value.map(r => r.id === id ? { ...r, ...patch } : r));
    }

    removeRoute(id: number) {
        this.setRoutes(this.state.routes.value.filter(r => r.id !== id));
    }

    /** Who one route moves, kept no finer than its channel allows (maxScopeLevel). False if refused: 8 other routes are narrowed already */
    setRouteAffect(id: number, affect: AudioAffect): boolean {
        const routes = this.state.routes.value;
        const route = routes.find(r => r.id === id);
        if (!route) return false;
        const max = maxScopeLevel(route.target);
        const next = max === 'all' || affect.level === 'all'
            ? defaultAudioAffect()
            : canonicalAudioAffect(clampAffectToLevel(resolveAudioAffect(this.plugin, affect), max));
        // the 9th narrowed route is refused (D3): it stays as it was
        if (next.level !== 'all' && !canNarrowRoute(routes, id)) return false;
        if (sameAudioAffect(next, route.affect)) return true;
        this.updateRoute(id, { affect: next });
        return true;
    }

    /**
     * Narrow a route to what is selected or focused in the viewer (a click), at `level`; with nothing picked, the first
     * loaded part at that level. False where the route's channel cannot be narrowed, or the 8 slots are taken (D3)
     */
    pickRouteAffect(id: number, level: AudioAffectLevel) {
        const route = this.state.routes.value.find(r => r.id === id);
        if (!route || maxScopeLevel(route.target) === 'all') return false;
        const picked = level === 'all' ? defaultAudioAffect() : this.affectFromSelection(level);
        return this.setRouteAffect(id, picked ?? specializeAudioAffect(this.plugin, route.affect, level));
    }

    private affectFromSelection(level: AudioAffectLevel): AudioAffect | undefined {
        let found: AudioAffect | undefined;
        this.plugin.managers.structure.selection.entries.forEach(entry => {
            if (found) return;
            const loci = entry.selection;
            if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return;
            found = audioAffectFromLoci(this.plugin, loci, level);
        });
        if (found) return found;
        const focus = this.plugin.managers.structure.focus.current?.loci;
        if (!focus || StructureElement.Loci.isEmpty(focus)) return;
        return audioAffectFromLoci(this.plugin, focus, level);
    }

    get stems() {
        return this.currentStems;
    }

    private syncStems() {
        const params = this.state.params.value;
        if (this.delayNode && this.audioContext) {
            const delay = getStemDelaySeconds(params);
            if (Math.abs(this.delayNode.delayTime.value - delay) > 1e-3) {
                this.delayNode.delayTime.setValueAtTime(delay, this.audioContext.currentTime);
                this.separator?.reset();
            }
        }
        if (params.stemModel === 'off' && !this.separator) return;
        if (!this.separator) {
            if (!this.audioContext || !this.sourceNode) return;
            this.separator = new StemSeparator(this.audioContext, this.sourceNode, this.stemSeparatorOptions, status => {
                this.stemStatus = status;
                this.updateStatus(void 0, true);
            });
        }
        void this.separator.setModel(params.stemModel === 'off' ? undefined : params.stemModel, params.stemExecutionProvider);
    }

    private getReactorParams() {
        const params = this.state.params.value;
        return {
            fftSize: params.fftSize,
            analysisSampleRate: params.analysisSampleRate,
            bands: DefaultAudioBandDefinitions,
            bandNormalizationGain: params.bandNormalizationGain,
            amplitudeAttackMs: params.amplitudeAttackMs,
            amplitudeReleaseMs: params.amplitudeReleaseMs,
            bandAttackMs: params.bandAttackMs,
            bandReleaseMs: params.bandReleaseMs,
            beatAttackMs: params.beatAttackMs,
            beatReleaseMs: params.beatReleaseMs,
            dominantFrequencyAttackMs: params.dominantFrequencyAttackMs,
            dominantFrequencyReleaseMs: params.dominantFrequencyReleaseMs,
            beatThreshold: params.beatThreshold,
            beatSensitivity: params.beatSensitivity,
            beatBaselineMs: params.beatBaselineMs,
            onsetHalfLifeMs: params.onsetHalfLifeMs,
            onsetWeight: params.onsetWeight,
            temperature: params.temperature,
            activityThreshold: params.activityThreshold,
        } as const;
    }

    private syncReactorParams() {
        this.reactor.setParams(this.getReactorParams());
    }

    private syncAnalyserConfig() {
        if (!this.analyser) return;

        const sampleRate = this.audioContext?.sampleRate || 48_000;
        const analyserFftSize = getAudioReactorAnalyserFftSize(this.reactor.getParams(), sampleRate);
        if (this.analyser.fftSize !== analyserFftSize) {
            this.analyser.fftSize = analyserFftSize;
        }
        this.analyser.smoothingTimeConstant = 0;
        this.timeDomainData = new Float32Array(this.analyser.fftSize);
        this.frequencyDomainData = new Uint8Array(this.analyser.frequencyBinCount);
        this.silenceData = new Float32Array(this.analyser.fftSize);
    }

    setParams(values: Partial<AudioReactiveAnimationManagerValues>) {
        const next = { ...this.state.params.value, ...values };
        this.state.params.next(next);
        this.syncReactorParams();
        this.syncAnalyserConfig();
        this.syncStems();
        this.updateStatus(void 0, true);
    }

    private updateStatus(error?: string, force = false, timeMs = 0) {
        if (!force && timeMs - this.lastUiUpdateMs < 32) return;
        this.lastUiUpdateMs = timeMs;
        const audio = this.state.audioPlayer.value;
        this.state.status.next({
            sourceLabel: this.sourceLabel,
            loaded: !!audio?.src,
            playing: !!audio && !audio.paused && !audio.ended,
            analysisBlocked: this.silenceWhilePlayingMs > 2000,
            sampleRate: this.audioContext?.sampleRate,
            frame: this.currentFrame,
            visualization: this.visualization,
            stems: this.currentStems,
            stemsSeparated: this.stemsSeparated,
            stemStatus: this.stemStatus,
            drives: { ...this.router.drives },
            routeValues: new Map(this.router.values),
            error,
        });
    }

    private releaseObjectUrl() {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = void 0;
        }
    }

    private bindAudioEvents(audio: HTMLAudioElement) {
        audio.addEventListener('play', () => this.updateStatus(void 0, true));
        audio.addEventListener('pause', () => this.updateStatus(void 0, true));
        audio.addEventListener('ended', () => this.updateStatus(void 0, true));
    }

    private resolveAudioPlayer() {
        if (this.state.audioPlayer.value) return this.state.audioPlayer.value;

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        audio.style.width = '100%';
        audio.style.height = '32px';
        this.bindAudioEvents(audio);
        this.state.audioPlayer.next(audio);
        return audio;
    }

    private ensureAnalyser(audio: HTMLAudioElement) {
        if (!this.audioContext) {
            const AudioContextCtor = getAudioContextCtor();
            if (!AudioContextCtor) throw new Error('Web Audio API is not available in this browser.');
            this.audioContext = new AudioContextCtor();
        }
        if (!this.analyser) {
            this.analyser = this.audioContext.createAnalyser();
        }
        if (!this.sourceNode) {
            this.sourceNode = this.audioContext.createMediaElementSource(audio);
            // source -> delay -> analyser -> speakers: the analysis follows what is heard; the stem separator taps the
            // source ahead of the delay
            this.delayNode = this.audioContext.createDelay(30);
            this.delayNode.delayTime.value = getStemDelaySeconds(this.state.params.value);
            this.sourceNode.connect(this.delayNode);
            this.delayNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }
        this.syncAnalyserConfig();
        this.syncStems();
    }

    private async waitForLoad(audio: HTMLAudioElement) {
        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return;

        await new Promise<void>((resolve, reject) => {
            const onLoaded = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(audio.error ?? new Error('Failed to load audio source.'));
            };
            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', onLoaded);
                audio.removeEventListener('error', onError);
            };
            audio.addEventListener('loadedmetadata', onLoaded);
            audio.addEventListener('error', onError);
        });
    }

    private async loadSource(src: string, label: string, ownsObjectUrl: boolean) {
        const audio = this.resolveAudioPlayer();
        this.releaseObjectUrl();
        if (ownsObjectUrl) this.objectUrl = src;

        this.sourceLabel = label;
        this.reactor.reset();
        this.separator?.reset();
        this.currentFrame = EmptyAudioReactiveFrame;
        clearAudioReactiveVisualization(this.visualization);
        this.lastTickMs = 0;
        audio.pause();
        audio.currentTime = 0;
        audio.src = src;
        audio.load();
        this.ensureAnalyser(audio);
        await this.waitForLoad(audio);
        this.updateStatus(void 0, true);
    }

    async loadFile(file: File) {
        const url = URL.createObjectURL(file);
        await this.loadSource(url, file.name, true);
    }

    async loadUrl(url: string, label = url) {
        await this.loadSource(url, label, false);
    }

    async play() {
        const audio = this.resolveAudioPlayer();
        if (!audio.src) return;
        this.ensureAnalyser(audio);
        await this.audioContext?.resume();
        await audio.play();
        this.updateStatus(void 0, true);
    }

    pause() {
        this.state.audioPlayer.value?.pause();
        this.updateStatus(void 0, true);
    }

    stop() {
        const audio = this.state.audioPlayer.value;
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        this.reactor.reset();
        this.separator?.reset();
        this.currentFrame = EmptyAudioReactiveFrame;
        clearAudioReactiveVisualization(this.visualization);
        this.lastTickMs = 0;
        this.silenceWhilePlayingMs = 0;
        this.updateStatus(void 0, true);
    }

    clear() {
        const audio = this.state.audioPlayer.value;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
        }
        this.releaseObjectUrl();
        this.sourceLabel = void 0;
        this.reactor.reset();
        this.separator?.reset();
        this.currentFrame = EmptyAudioReactiveFrame;
        clearAudioReactiveVisualization(this.visualization);
        this.lastTickMs = 0;
        this.silenceWhilePlayingMs = 0;
        this.updateStatus(void 0, true);
    }

    private updateStems(dtMs: number, paused: boolean) {
        const params = this.state.params.value;
        let separated: StemLevels | undefined;
        if (!paused && this.separator && this.audioContext && params.stemModel !== 'off') {
            // the audio heard now entered the graph one delay ago
            const heard = this.audioContext.currentTime - getStemDelaySeconds(params);
            separated = this.separator.sample(heard, dtMs, params.bandAttackMs, params.bandReleaseMs);
        }
        this.stemsSeparated = !!separated;
        if (separated) {
            this.currentStems = separated;
            return;
        }
        const onset = getBandDrumsOnset(this.currentFrame);
        this.bandDrumsPeak = Math.max(onset, BandDrumsPeakFloor, this.bandDrumsPeak * Math.exp(-dtMs / BandDrumsPeakDecayMs));
        const drums = Math.min(1, onset / this.bandDrumsPeak);
        this.currentStems = getBandStems(this.currentFrame, drums * drums);
    }

    tick(timeMs: number): AudioReactiveFrame<DefaultAudioBandKey> {
        const audio = this.state.audioPlayer.value;
        const dtMs = this.lastTickMs > 0 ? Math.min(100, Math.max(0, timeMs - this.lastTickMs)) : 16;
        this.lastTickMs = timeMs;

        if (!audio || !audio.src || !this.audioContext || !this.analyser || !this.timeDomainData || !this.frequencyDomainData || !this.silenceData) {
            if (!areFramesClose(this.currentFrame, EmptyAudioReactiveFrame)) {
                this.currentFrame = EmptyAudioReactiveFrame;
                clearAudioReactiveVisualization(this.visualization);
                this.updateStatus(void 0, false, timeMs);
            }
            return this.currentFrame;
        }

        const sampleRate = this.audioContext.sampleRate;

        try {
            if (audio.paused || audio.ended) {
                this.silenceWhilePlayingMs = 0;
                this.currentFrame = this.reactor.analyze(this.silenceData, sampleRate, dtMs);
                clearAudioReactiveVisualization(this.visualization);
            } else {
                this.analyser.getFloatTimeDomainData(this.timeDomainData);
                this.analyser.getByteFrequencyData(this.frequencyDomainData);
                const n = this.timeDomainData.length;
                const analysisSilent =
                    Math.abs(this.timeDomainData[0]) < 1e-7 &&
                    Math.abs(this.timeDomainData[n >> 2]) < 1e-7 &&
                    Math.abs(this.timeDomainData[n >> 1]) < 1e-7 &&
                    Math.abs(this.timeDomainData[(n >> 1) + (n >> 2)]) < 1e-7;
                this.silenceWhilePlayingMs = analysisSilent ? this.silenceWhilePlayingMs + dtMs : 0;
                writeWaveformSamples(this.timeDomainData, this.visualization.waveform);
                writeSpectrumSamples(this.frequencyDomainData, this.visualization.spectrum);
                this.currentFrame = this.reactor.analyze(this.timeDomainData, sampleRate, dtMs);
            }
            this.updateStems(dtMs, audio.paused || audio.ended);
            this.router.update(this.state.routes.value, this.currentFrame, this.currentStems, dtMs);
            this.updateStatus(void 0, false, timeMs);
        } catch (e) {
            this.updateStatus(`${e}`, true, timeMs);
        }

        return this.currentFrame;
    }

    dispose() {
        this.clear();
        this.sourceNode?.disconnect();
        this.separator?.dispose();
        this.delayNode?.disconnect();
        this.analyser?.disconnect();
        this.audioContext?.close();
        this.state.audioPlayer.complete();
        this.state.status.complete();
        this.state.routes.complete();
        this.state.params.complete();
    }
}
