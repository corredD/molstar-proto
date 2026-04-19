/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

export type AudioBandDefinition<K extends string = string> = {
    key: K,
    label: string,
    minHz: number,
    maxHz: number,
};

export const DefaultAudioBandDefinitions = [
    { key: 'subBass', label: 'Sub-bass', minHz: 20, maxHz: 60 },
    { key: 'bass', label: 'Bass', minHz: 60, maxHz: 250 },
    { key: 'lowMids', label: 'Low-mids', minHz: 250, maxHz: 500 },
    { key: 'mids', label: 'Mids', minHz: 500, maxHz: 2000 },
    { key: 'highMids', label: 'High-mids', minHz: 2000, maxHz: 8000 },
    { key: 'treble', label: 'Treble', minHz: 8000, maxHz: 20000 },
] as const satisfies readonly AudioBandDefinition[];
export type DefaultAudioBandKey = typeof DefaultAudioBandDefinitions[number]['key'];

export type AudioReactiveScalarSet<K extends string = string> = {
    amplitude: number,
    peakAmplitude: number,
    beatIntensity: number,
    dominantFrequency: number,
    dominantFrequencyNormalized: number,
    mix: number,
    frequencyBands: Record<K, number>,
};

export type AudioReactiveFrame<K extends string = string> = AudioReactiveScalarSet<K> & {
    raw: AudioReactiveScalarSet<K>,
};

export type AudioReactorParams<K extends string = string> = {
    fftSize: number,
    analysisSampleRate: number,
    bands: readonly AudioBandDefinition<K>[],
    bandNormalizationGain: number,
    amplitudeAttackMs: number,
    amplitudeReleaseMs: number,
    bandAttackMs: number,
    bandReleaseMs: number,
    beatAttackMs: number,
    beatReleaseMs: number,
    dominantFrequencyAttackMs: number,
    dominantFrequencyReleaseMs: number,
    beatThreshold: number,
    beatSensitivity: number,
    beatBaselineMs: number,
};

export const DefaultAudioReactorParams: AudioReactorParams<DefaultAudioBandKey> = {
    fftSize: 1024,
    analysisSampleRate: 0,
    bands: DefaultAudioBandDefinitions,
    bandNormalizationGain: 10,
    amplitudeAttackMs: 25,
    amplitudeReleaseMs: 180,
    bandAttackMs: 20,
    bandReleaseMs: 180,
    beatAttackMs: 0,
    beatReleaseMs: 160,
    dominantFrequencyAttackMs: 10,
    dominantFrequencyReleaseMs: 120,
    beatThreshold: 1.35,
    beatSensitivity: 8,
    beatBaselineMs: 320,
};

type AudioReactorState<K extends string> = {
    amplitude: number,
    peakAmplitude: number,
    beatIntensity: number,
    dominantFrequency: number,
    mix: number,
    frequencyBands: Record<K, number>,
};

function assertPowerOfTwo(value: number) {
    if (value <= 0 || (value & (value - 1)) !== 0) {
        throw new Error(`FFT size must be a power of two, got ${value}.`);
    }
}

function ceilPowerOfTwo(value: number) {
    let out = 1;
    while (out < value) out <<= 1;
    return out;
}

function createZeroBandRecord<K extends string>(bands: readonly AudioBandDefinition<K>[]): Record<K, number> {
    const out = Object.create(null) as Record<K, number>;
    for (const band of bands) out[band.key] = 0;
    return out;
}

function createEmptyScalarSet<K extends string>(bands: readonly AudioBandDefinition<K>[]): AudioReactiveScalarSet<K> {
    return {
        amplitude: 0,
        peakAmplitude: 0,
        beatIntensity: 0,
        dominantFrequency: 0,
        dominantFrequencyNormalized: 0,
        mix: 0,
        frequencyBands: createZeroBandRecord(bands),
    };
}

export function createEmptyAudioReactiveFrame<K extends string>(bands: readonly AudioBandDefinition<K>[]): AudioReactiveFrame<K> {
    const scalar = createEmptyScalarSet(bands);
    return {
        ...scalar,
        raw: createEmptyScalarSet(bands),
    };
}

export function getEffectiveAudioReactorSampleRate<K extends string>(params: AudioReactorParams<K>, inputSampleRate: number) {
    if (params.analysisSampleRate <= 0) return inputSampleRate;
    return Math.min(params.analysisSampleRate, inputSampleRate);
}

export function getAudioReactorInputSampleCount<K extends string>(params: AudioReactorParams<K>, inputSampleRate: number) {
    const effectiveSampleRate = getEffectiveAudioReactorSampleRate(params, inputSampleRate);
    return Math.max(params.fftSize, Math.ceil(params.fftSize * inputSampleRate / effectiveSampleRate));
}

export function getAudioReactorAnalyserFftSize<K extends string>(params: AudioReactorParams<K>, inputSampleRate: number) {
    const required = getAudioReactorInputSampleCount(params, inputSampleRate);
    return Math.min(32768, Math.max(32, ceilPowerOfTwo(required)));
}

function createHannWindow(size: number) {
    const window = new Float32Array(size);
    const denom = Math.max(1, size - 1);
    for (let i = 0; i < size; ++i) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    return window;
}

function createBitReverse(size: number) {
    const bits = Math.round(Math.log2(size));
    const out = new Uint32Array(size);
    for (let i = 0; i < size; ++i) {
        let x = i;
        let y = 0;
        for (let j = 0; j < bits; ++j) {
            y = (y << 1) | (x & 1);
            x >>= 1;
        }
        out[i] = y;
    }
    return out;
}

function normalize01(value: number) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function applyAttackRelease(previous: number, target: number, dtMs: number, attackMs: number, releaseMs: number) {
    if (dtMs <= 0) return target;
    const timeConstant = target >= previous ? attackMs : releaseMs;
    if (timeConstant <= 0) return target;
    const alpha = 1 - Math.exp(-dtMs / timeConstant);
    return previous + (target - previous) * alpha;
}

function computeRms(samples: Float32Array, count: number) {
    let sum = 0;
    for (let i = 0; i < count; ++i) {
        const v = samples[i];
        sum += v * v;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
}

function computePeak(samples: Float32Array, count: number) {
    let peak = 0;
    for (let i = 0; i < count; ++i) {
        const value = Math.abs(samples[i]);
        if (value > peak) peak = value;
    }
    return peak;
}

function getFrequencyBinRange(sampleRate: number, fftSize: number, minHz: number, maxHz: number): [number, number] {
    const nyquist = sampleRate / 2;
    const binCount = fftSize / 2;
    const start = Math.max(0, Math.min(binCount - 1, Math.floor(minHz / nyquist * binCount)));
    const end = Math.max(start + 1, Math.min(binCount, Math.ceil(maxHz / nyquist * binCount)));
    return [start, end];
}

function fftInPlace(real: Float32Array, imag: Float32Array) {
    const size = real.length;
    for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
        const halfSize = blockSize >> 1;
        const theta = -2 * Math.PI / blockSize;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        for (let offset = 0; offset < size; offset += blockSize) {
            let wr = 1;
            let wi = 0;

            for (let i = 0; i < halfSize; ++i) {
                const evenIndex = offset + i;
                const oddIndex = evenIndex + halfSize;

                const tr = wr * real[oddIndex] - wi * imag[oddIndex];
                const ti = wr * imag[oddIndex] + wi * real[oddIndex];

                real[oddIndex] = real[evenIndex] - tr;
                imag[oddIndex] = imag[evenIndex] - ti;
                real[evenIndex] += tr;
                imag[evenIndex] += ti;

                const nextWr = wr * cosTheta - wi * sinTheta;
                wi = wr * sinTheta + wi * cosTheta;
                wr = nextWr;
            }
        }
    }
}

export class AudioReactor<K extends string = DefaultAudioBandKey> {
    private params: AudioReactorParams<K>;
    private window: Float32Array;
    private bitReverse: Uint32Array;
    private real: Float32Array;
    private imag: Float32Array;
    private magnitudes: Float32Array;
    private previousMagnitudes: Float32Array;
    private analysisSamples: Float32Array;
    private beatFluxBaseline = 0;
    private state: AudioReactorState<K>;

    constructor(params?: Partial<AudioReactorParams<K>>) {
        this.params = { ...(DefaultAudioReactorParams as AudioReactorParams<K>), ...params };
        this.window = new Float32Array(0);
        this.bitReverse = new Uint32Array(0);
        this.real = new Float32Array(0);
        this.imag = new Float32Array(0);
        this.magnitudes = new Float32Array(0);
        this.previousMagnitudes = new Float32Array(0);
        this.analysisSamples = new Float32Array(0);
        this.state = {
            amplitude: 0,
            peakAmplitude: 0,
            beatIntensity: 0,
            dominantFrequency: 0,
            mix: 0,
            frequencyBands: createZeroBandRecord(this.params.bands),
        };
        this.rebuildCaches();
    }

    getParams() {
        return this.params;
    }

    setParams(params: Partial<AudioReactorParams<K>>) {
        this.params = { ...this.params, ...params };
        this.rebuildCaches();
        this.reset();
    }

    reset() {
        this.previousMagnitudes.fill(0);
        this.beatFluxBaseline = 0;
        this.state = {
            amplitude: 0,
            peakAmplitude: 0,
            beatIntensity: 0,
            dominantFrequency: 0,
            mix: 0,
            frequencyBands: createZeroBandRecord(this.params.bands),
        };
    }

    analyze(samples: Float32Array, inputSampleRate: number, dtMs: number): AudioReactiveFrame<K> {
        const { fftSize, bands } = this.params;
        const effectiveSampleRate = getEffectiveAudioReactorSampleRate(this.params, inputSampleRate);
        const inputSampleCount = getAudioReactorInputSampleCount(this.params, inputSampleRate);

        if (samples.length < inputSampleCount) {
            throw new Error(`Expected at least ${inputSampleCount} audio samples, got ${samples.length}.`);
        }

        const rawAmplitude = normalize01(computeRms(samples, inputSampleCount));
        const rawPeakAmplitude = normalize01(computePeak(samples, inputSampleCount));

        if (inputSampleCount === fftSize && effectiveSampleRate === inputSampleRate) {
            for (let i = 0; i < fftSize; ++i) {
                this.analysisSamples[i] = samples[i];
            }
        } else {
            const ratio = inputSampleRate / effectiveSampleRate;
            const maxIndex = inputSampleCount - 1;
            for (let i = 0; i < fftSize; ++i) {
                const sourceIndex = Math.min(i * ratio, maxIndex);
                const sourceFloor = Math.floor(sourceIndex);
                const sourceCeil = Math.min(maxIndex, sourceFloor + 1);
                const t = sourceIndex - sourceFloor;
                this.analysisSamples[i] = samples[sourceFloor] * (1 - t) + samples[sourceCeil] * t;
            }
        }

        for (let i = 0; i < fftSize; ++i) {
            const sample = this.analysisSamples[i] * this.window[i];
            const index = this.bitReverse[i];
            this.real[index] = sample;
            this.imag[index] = 0;
        }

        fftInPlace(this.real, this.imag);

        const magnitudeCount = fftSize >> 1;
        const magnitudeScale = 4 / fftSize;
        let dominantIndex = 0;
        let dominantMagnitude = 0;
        let flux = 0;
        for (let i = 0; i < magnitudeCount; ++i) {
            const re = this.real[i];
            const im = this.imag[i];
            const magnitude = normalize01(Math.sqrt(re * re + im * im) * magnitudeScale);
            this.magnitudes[i] = magnitude;
            if (magnitude > dominantMagnitude) {
                dominantMagnitude = magnitude;
                dominantIndex = i;
            }
            const delta = magnitude - this.previousMagnitudes[i];
            if (delta > 0) flux += delta;
            this.previousMagnitudes[i] = magnitude;
        }
        flux /= magnitudeCount;

        const rawBands = createZeroBandRecord(bands);
        let bandSum = 0;
        for (const band of bands) {
            const [start, end] = getFrequencyBinRange(effectiveSampleRate, fftSize, band.minHz, band.maxHz);
            let sumSq = 0;
            let count = 0;
            for (let i = start; i < end; ++i) {
                const value = this.magnitudes[i];
                sumSq += value * value;
                count += 1;
            }
            const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
            const normalizedBand = normalize01(1 - Math.exp(-rms * this.params.bandNormalizationGain));
            rawBands[band.key] = normalizedBand;
            bandSum += normalizedBand;
        }
        const rawMix = bands.length > 0 ? bandSum / bands.length : 0;

        this.beatFluxBaseline = applyAttackRelease(
            this.beatFluxBaseline,
            flux,
            dtMs,
            this.params.beatBaselineMs,
            this.params.beatBaselineMs
        );
        const rawBeat = normalize01((flux - this.beatFluxBaseline * this.params.beatThreshold) * this.params.beatSensitivity);
        const rawDominantFrequency = dominantIndex * effectiveSampleRate / fftSize;

        this.state.amplitude = applyAttackRelease(this.state.amplitude, rawAmplitude, dtMs, this.params.amplitudeAttackMs, this.params.amplitudeReleaseMs);
        this.state.peakAmplitude = applyAttackRelease(this.state.peakAmplitude, rawPeakAmplitude, dtMs, this.params.amplitudeAttackMs, this.params.amplitudeReleaseMs);
        this.state.beatIntensity = applyAttackRelease(this.state.beatIntensity, rawBeat, dtMs, this.params.beatAttackMs, this.params.beatReleaseMs);
        this.state.dominantFrequency = applyAttackRelease(this.state.dominantFrequency, rawDominantFrequency, dtMs, this.params.dominantFrequencyAttackMs, this.params.dominantFrequencyReleaseMs);
        this.state.mix = applyAttackRelease(this.state.mix, rawMix, dtMs, this.params.bandAttackMs, this.params.bandReleaseMs);
        for (const band of bands) {
            this.state.frequencyBands[band.key] = applyAttackRelease(
                this.state.frequencyBands[band.key],
                rawBands[band.key],
                dtMs,
                this.params.bandAttackMs,
                this.params.bandReleaseMs
            );
        }

        return {
            amplitude: this.state.amplitude,
            peakAmplitude: this.state.peakAmplitude,
            beatIntensity: this.state.beatIntensity,
            dominantFrequency: this.state.dominantFrequency,
            dominantFrequencyNormalized: effectiveSampleRate > 0 ? normalize01(this.state.dominantFrequency / (effectiveSampleRate / 2)) : 0,
            mix: this.state.mix,
            frequencyBands: { ...this.state.frequencyBands },
            raw: {
                amplitude: rawAmplitude,
                peakAmplitude: rawPeakAmplitude,
                beatIntensity: rawBeat,
                dominantFrequency: rawDominantFrequency,
                dominantFrequencyNormalized: effectiveSampleRate > 0 ? normalize01(rawDominantFrequency / (effectiveSampleRate / 2)) : 0,
                mix: rawMix,
                frequencyBands: rawBands,
            }
        };
    }

    private rebuildCaches() {
        assertPowerOfTwo(this.params.fftSize);
        this.window = createHannWindow(this.params.fftSize);
        this.bitReverse = createBitReverse(this.params.fftSize);
        this.real = new Float32Array(this.params.fftSize);
        this.imag = new Float32Array(this.params.fftSize);
        this.magnitudes = new Float32Array(this.params.fftSize >> 1);
        this.previousMagnitudes = new Float32Array(this.params.fftSize >> 1);
        this.analysisSamples = new Float32Array(this.params.fftSize);
    }
}
