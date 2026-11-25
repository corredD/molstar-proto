/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { LinearResampler, makeFFT, padSignal, periodicHann, stft } from '../dsp';

describe('audio-stems dsp', () => {
    it('FFT matches a direct DFT', () => {
        const n = 64;
        const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) * 0.1);
        const re = Float64Array.from(x), im = new Float64Array(n);
        makeFFT(n)(re, im);
        for (let k = 0; k < n; k++) {
            let dr = 0, di = 0;
            for (let j = 0; j < n; j++) {
                dr += x[j] * Math.cos(-2 * Math.PI * j * k / n);
                di += x[j] * Math.sin(-2 * Math.PI * j * k / n);
            }
            expect(re[k]).toBeCloseTo(dr, 8);
            expect(im[k]).toBeCloseTo(di, 8);
        }
    });

    it('reflect padding does not repeat the edge sample (torch reflect)', () => {
        const x = Float32Array.from([1, 2, 3, 4]);
        expect(Array.from(padSignal(x, 2, 3, 'reflect'))).toEqual([3, 2, 1, 2, 3, 4, 3, 2, 1]);
        expect(Array.from(padSignal(x, 1, 1, 'zero'))).toEqual([0, 1, 2, 3, 4, 0]);
    });

    it('periodic Hann is zero at 0 and one at n/2', () => {
        const w = periodicHann(8);
        expect(w[0]).toBeCloseTo(0, 8);
        expect(w[4]).toBeCloseTo(1, 8);
        expect(w[1]).toBeCloseTo(w[7], 6);
    });

    it('STFT of a pure tone peaks at its bin', () => {
        const nfft = 256, hop = 64, bin = 10;
        const x = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * bin * i / nfft));
        const { re, im, frames, bins } = stft(x, nfft, hop, periodicHann(nfft), 1, nfft / 2 + 1);
        expect(frames).toBe(Math.floor((2048 - nfft) / hop) + 1);
        const f = 3;
        let best = 0, bestP = 0;
        for (let b = 0; b < bins; b++) {
            const p = re[f * bins + b] ** 2 + im[f * bins + b] ** 2;
            if (p > bestP) { bestP = p; best = b; }
        }
        expect(best).toBe(bin);
    });

    it('streaming resampler is continuous across chunks', () => {
        const ratio = 48000 / 44100;
        const signal = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.01));
        const whole = new LinearResampler(ratio).process(signal);
        const r = new LinearResampler(ratio);
        const parts: number[] = [];
        for (let i = 0; i < signal.length; i += 128) parts.push(...r.process(signal.subarray(i, i + 128)));
        expect(parts.length).toBe(whole.length);
        for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i], 5);
        // 48 kHz to 44.1 kHz keeps the duration
        expect(Math.abs(whole.length - 4800 / ratio)).toBeLessThan(2);
    });
});
