/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { AudioReactor, DefaultAudioBandDefinitions, DefaultAudioReactorParams, getAudioReactorAnalyserFftSize } from '../audio-reactor';

function createSineWave(length: number, sampleRate: number, frequency: number, amplitude = 1) {
    const samples = new Float32Array(length);
    for (let i = 0; i < length; ++i) {
        samples[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
    }
    return samples;
}

describe('audio reactor', () => {
    it('captures bass energy and dominant frequency for a bass sine wave', () => {
        const reactor = new AudioReactor({
            fftSize: 1024,
            bandNormalizationGain: 18,
            amplitudeAttackMs: 0,
            amplitudeReleaseMs: 0,
            bandAttackMs: 0,
            bandReleaseMs: 0,
            beatAttackMs: 0,
            beatReleaseMs: 0,
            dominantFrequencyAttackMs: 0,
            dominantFrequencyReleaseMs: 0,
        });

        const frame = reactor.analyze(createSineWave(1024, 48_000, 120, 0.75), 48_000, 16);
        expect(frame.frequencyBands.bass).toBeGreaterThan(0.5);
        expect(frame.frequencyBands.lowMids).toBeLessThan(0.2);
        expect(frame.frequencyBands.highMids).toBeLessThan(0.2);
        expect(frame.amplitude).toBeGreaterThan(0.45);
        expect(frame.dominantFrequency).toBeGreaterThan(90);
        expect(frame.dominantFrequency).toBeLessThan(160);
    });

    it('applies release smoothing instead of dropping amplitude immediately', () => {
        const reactor = new AudioReactor({
            fftSize: 1024,
            amplitudeAttackMs: 0,
            amplitudeReleaseMs: 250,
            bandAttackMs: 0,
            bandReleaseMs: 250,
            beatAttackMs: 0,
            beatReleaseMs: 250,
            dominantFrequencyAttackMs: 0,
            dominantFrequencyReleaseMs: 250,
        });

        const loud = new Float32Array(1024);
        loud.fill(1);
        const silence = new Float32Array(1024);

        const first = reactor.analyze(loud, 48_000, 16);
        const second = reactor.analyze(silence, 48_000, 16);

        expect(first.amplitude).toBeGreaterThan(0.9);
        expect(second.raw.amplitude).toBe(0);
        expect(second.amplitude).toBeGreaterThan(0.5);
        expect(second.amplitude).toBeLessThan(first.amplitude);
    });

    it('detects beat intensity on a transient after silence', () => {
        const reactor = new AudioReactor({
            fftSize: 1024,
            bandAttackMs: 0,
            bandReleaseMs: 0,
            amplitudeAttackMs: 0,
            amplitudeReleaseMs: 0,
            beatAttackMs: 0,
            beatReleaseMs: 100,
            dominantFrequencyAttackMs: 0,
            dominantFrequencyReleaseMs: 0,
            beatThreshold: 1.1,
            beatSensitivity: 12,
            beatBaselineMs: 120,
        });

        const silence = new Float32Array(1024);
        const transient = new Float32Array(1024);
        transient[0] = 1;
        transient[1] = -1;

        reactor.analyze(silence, 48_000, 16);
        reactor.analyze(silence, 48_000, 16);
        const beatFrame = reactor.analyze(transient, 48_000, 16);

        expect(beatFrame.raw.beatIntensity).toBeGreaterThan(0);
        expect(beatFrame.beatIntensity).toBeGreaterThan(0);
    });

    it('expands analyser fft size when analysis sample rate is lowered', () => {
        const analyserSize = getAudioReactorAnalyserFftSize({
            ...DefaultAudioReactorParams,
            fftSize: 1024,
            analysisSampleRate: 24_000,
            bands: DefaultAudioBandDefinitions,
        }, 48_000);

        expect(analyserSize).toBe(2048);
    });
});
