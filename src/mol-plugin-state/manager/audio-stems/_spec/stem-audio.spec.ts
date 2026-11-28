/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OverlapAddInverse, StemFftSize as N, StemHop as H } from '../dsp';
import { scnetSpec, scnetStemAudio, ScnetLayout, spleeterSpec, spleeterStemAudio, SpleeterLayout, StemModels } from '../stem-models';

/** a stereo pair far under 11 kHz (Spleeter's masks stop at bin 1024): tones and a slow sweep */
function pair(n: number) {
    const left = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 110 * i / 44100) + 0.2 * Math.sin(2 * Math.PI * (300 + 1e-3 * i) * i / 44100));
    const right = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin(2 * Math.PI * 55 * i / 44100) + 0.1 * Math.sin(2 * Math.PI * 1700 * i / 44100));
    return { left, right };
}

describe('stem audio (Spleeter, SCNet)', () => {
    it('Spleeter: a stem whose estimate is the only one (mask 1) gives the mix back, mono, from the frames asked for', () => {
        const W = StemModels.spleeter.windowSamples;
        const { left, right } = pair(W);
        const { T, B } = SpleeterLayout;
        const specs = [spleeterSpec(left), spleeterSpec(right)] as const;
        const one = new Float32Array(2 * T * B).fill(1), none = new Float32Array(2 * T * B);
        const out = new Float32Array(W);
        const from = W - 5 * 44100;
        spleeterStemAudio(specs, [none, one, none, none], 1, from, new OverlapAddInverse(N, W), out);
        // away from the window's end: its cut to the padding's zeros is broadband, and the bins past 11 kHz are dropped
        for (let i = from; i < W - N; i++) expect(Math.abs(out[i] - (left[i] + right[i]) / 2)).toBeLessThan(1e-4);
        // the other stems' share: none
        spleeterStemAudio(specs, [none, one, none, none], 0, from, new OverlapAddInverse(N, W), out);
        for (let i = from; i < W; i++) expect(Math.abs(out[i])).toBeLessThan(1e-6);
    });

    it('SCNet: an output equal to its input spectrum (identity) gives the mix back, mono, edges included', () => {
        const { L, F, B } = ScnetLayout;
        const { left, right } = pair(L);
        const spec = scnetSpec(left, right);
        // stem 0 (drums) is the input itself; the output's per-stem layout is the input's
        const y = new Float32Array(16 * B * F);
        y.set(spec, 0);
        const out = new Float32Array(L);
        scnetStemAudio(y, 0, 0, new OverlapAddInverse(N, L), out);
        for (let i = 0; i < L; i++) expect(Math.abs(out[i] - (left[i] + right[i]) / 2)).toBeLessThan(1e-4);
        // from a later sample: the frames before it are skipped, the samples from it on unchanged
        const from = L - 6 * 44100 - 3 * H;
        out.fill(0);
        scnetStemAudio(y, 0, from, new OverlapAddInverse(N, L), out);
        for (let i = from; i < L; i++) expect(Math.abs(out[i] - (left[i] + right[i]) / 2)).toBeLessThan(1e-4);
    });

    it('Spleeter: the four stems\' masks sum back to the mix (mono, under 11 kHz), whatever the estimates', () => {
        const W = StemModels.spleeter.windowSamples;
        const { left, right } = pair(W);
        const { T, B } = SpleeterLayout;
        const specs = [spleeterSpec(left), spleeterSpec(right)] as const;
        let seed = 7;
        const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const estimates = [0, 1, 2, 3].map(() => Float32Array.from({ length: 2 * T * B }, () => 0.1 + rand()));
        const from = W - 5 * 44100;
        const sum = new Float32Array(W);
        for (let s = 0; s < 4; s++) {
            const out = new Float32Array(W);
            spleeterStemAudio(specs, estimates, s, from, new OverlapAddInverse(N, W), out);
            for (let i = from; i < W; i++) sum[i] += out[i];
        }
        for (let i = from; i < W - N; i++) expect(Math.abs(sum[i] - (left[i] + right[i]) / 2)).toBeLessThan(1e-4);
    });
});
