/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { BehaviorSubject } from 'rxjs';
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
    wiggleEffectScale: PD.Numeric(1, { min: 0, max: 4, step: 0.05 }, { category: 'Effect', description: 'Global multiplier applied to reactive values when driving wiggle.' }),
    tumbleEffectScale: PD.Numeric(1, { min: 0, max: 4, step: 0.05 }, { category: 'Effect', description: 'Global multiplier applied to reactive values when driving tumble.' }),
    assemblyAxisOrder: PD.Select<AudioReactiveAssemblyAxisOrder>('highest', AudioReactiveAssemblyAxisOrderOptions, { category: 'Effect', description: 'Preferred assembly symmetry axis order when using assembly-based tumble translation.' }),
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
} as const;
export type AudioReactiveAnimationManagerParams = typeof AudioReactiveAnimationManagerParams
export type AudioReactiveAnimationManagerValues = PD.Values<AudioReactiveAnimationManagerParams>;

export type AudioReactiveStatus = {
    sourceLabel?: string,
    loaded: boolean,
    playing: boolean,
    sampleRate?: number,
    frame: AudioReactiveFrame<DefaultAudioBandKey>,
    error?: string,
};

const EmptyAudioReactiveFrame = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);
const InitialAudioReactiveStatus: AudioReactiveStatus = {
    loaded: false,
    playing: false,
    frame: EmptyAudioReactiveFrame,
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
    }
    return true;
}

export class AudioReactiveAnimationManager {
    readonly state = {
        audioPlayer: new BehaviorSubject<HTMLAudioElement | null>(null),
        status: new BehaviorSubject<AudioReactiveStatus>(InitialAudioReactiveStatus),
        params: new BehaviorSubject<AudioReactiveAnimationManagerValues>(PD.getDefaultValues(AudioReactiveAnimationManagerParams)),
    };

    private objectUrl?: string;
    private sourceLabel?: string;
    private audioContext?: AudioContext;
    private analyser?: AnalyserNode;
    private sourceNode?: MediaElementAudioSourceNode;
    private timeDomainData?: Float32Array<ArrayBuffer>;
    private silenceData?: Float32Array<ArrayBuffer>;
    private currentFrame = EmptyAudioReactiveFrame;
    private lastUiUpdateMs = 0;
    private lastTickMs = 0;
    private reactor = new AudioReactor();

    constructor(readonly plugin: PluginContext) {
        this.syncReactorParams();
    }

    get frame() {
        return this.currentFrame;
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
        this.silenceData = new Float32Array(this.analyser.fftSize);
    }

    setParams(values: Partial<AudioReactiveAnimationManagerValues>) {
        const next = { ...this.state.params.value, ...values };
        this.state.params.next(next);
        this.syncReactorParams();
        this.syncAnalyserConfig();
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
            sampleRate: this.audioContext?.sampleRate,
            frame: this.currentFrame,
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
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }
        this.syncAnalyserConfig();
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
        this.currentFrame = EmptyAudioReactiveFrame;
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
        this.currentFrame = EmptyAudioReactiveFrame;
        this.lastTickMs = 0;
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
        this.currentFrame = EmptyAudioReactiveFrame;
        this.lastTickMs = 0;
        this.updateStatus(void 0, true);
    }

    tick(timeMs: number): AudioReactiveFrame<DefaultAudioBandKey> {
        const audio = this.state.audioPlayer.value;
        const dtMs = this.lastTickMs > 0 ? Math.min(100, Math.max(0, timeMs - this.lastTickMs)) : 16;
        this.lastTickMs = timeMs;

        if (!audio || !audio.src || !this.audioContext || !this.analyser || !this.timeDomainData || !this.silenceData) {
            if (!areFramesClose(this.currentFrame, EmptyAudioReactiveFrame)) {
                this.currentFrame = EmptyAudioReactiveFrame;
                this.updateStatus(void 0, false, timeMs);
            }
            return this.currentFrame;
        }

        const sampleRate = this.audioContext.sampleRate;

        try {
            if (audio.paused || audio.ended) {
                this.currentFrame = this.reactor.analyze(this.silenceData, sampleRate, dtMs);
            } else {
                this.analyser.getFloatTimeDomainData(this.timeDomainData);
                this.currentFrame = this.reactor.analyze(this.timeDomainData, sampleRate, dtMs);
            }
            this.updateStatus(void 0, false, timeMs);
        } catch (e) {
            this.updateStatus(`${e}`, true, timeMs);
        }

        return this.currentFrame;
    }

    dispose() {
        this.clear();
        this.sourceNode?.disconnect();
        this.analyser?.disconnect();
        this.audioContext?.close();
        this.state.audioPlayer.complete();
        this.state.status.complete();
        this.state.params.complete();
    }
}
