/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { periodicHann, StemFftSize as N, StemHop as H } from '../dsp';
import { demucsSpec, demucsStemEnergies } from '../stem-models';

const L = 64 * H, le = Math.ceil(L / H);
const hann2 = Float64Array.from(periodicHann(N), w => w * w);
const sumHann2 = hann2.reduce((a, b) => a + b, 0);

/** Hann-4096 energy of a stereo pair centred at `c`, in hop units (a steady power P reads H · P per channel) */
function hannEnergy(l: Float32Array, r: Float32Array, c: number) {
    let e = 0;
    for (let j = 0; j < N; j++) {
        const i = c - N / 2 + j;
        if (i >= 0 && i < l.length) e += hann2[j] * (l[i] * l[i] + r[i] * r[i]);
    }
    return e * H / sumHann2;
}

/** deterministic noise, a tone and two bursts */
function signal() {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
    return Float32Array.from({ length: L }, (_, i) => 0.2 * rnd() + 0.3 * Math.sin(2 * Math.PI * 8 * i / H) + (Math.abs(i - 20000) < 400 || Math.abs(i - 41000) < 300 ? 0.8 * rnd() : 0));
}

/** the drums' branches: x from `freq` (both channels), xt = `time` (both channels); the other stems silent */
function branches(freq: Float32Array | undefined, time: Float32Array | undefined) {
    const x = new Float32Array(4 * 4 * 2048 * le);
    const xt = new Float32Array(4 * 2 * L);
    if (freq) {
        demucsSpec(freq, L, x, 0, 1);
        demucsSpec(freq, L, x, 2, 3);
    }
    if (time) {
        xt.set(time, 0);
        xt.set(time, L);
    }
    return { x, xt };
}

const db = (e: number) => 10 * Math.log10(e);
/** frames whose window lies inside the segment, clear of _ispec's dropped edge frames */
const inner = Array.from({ length: le - 8 }, (_, i) => i + 4);

describe('HTDemucs stem energy', () => {
    it('two branches that cancel read silent: the energy of their sum, not the sum of their energies', () => {
        const s = signal();
        const minus = Float32Array.from(s, v => -v);
        const { x, xt } = branches(minus, s);
        const e = demucsStemEnergies(x, xt, L);
        // 40 dB under the signal (the sum of the energies reads +3 dB): _spec drops the Nyquist bin, so the noise's share
        // of it (-54 dB here) cannot cancel
        for (const t of inner) {
            expect(e.drums[t]).toBeLessThan(1e-4 * hannEnergy(s, s, t * H + H / 2));
        }
    });

    it('a window cut by the segment\'s ends reads the power inside it: the app keeps the newest frames', () => {
        // the time branch: _ispec's fade of the frequency branch at the ends is the model's own (its time branch carries
        // them), measured on HTDemucs' output, not asserted here
        const tone = Float32Array.from({ length: L }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 8 * i / H));
        const steady = hannEnergy(tone, tone, (le >> 1) * H + H / 2);
        const { x, xt } = branches(undefined, tone);
        const e = demucsStemEnergies(x, xt, L);
        for (let t = 0; t < le; t++) expect(Math.abs(db(e.drums[t]) - db(steady))).toBeLessThan(0.2);
    });

    it('one branch alone reads the Hann-window energy of its audio (the units stay)', () => {
        const tone = Float32Array.from({ length: L }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 8 * i / H));
        for (const [freq, time] of [[tone, undefined], [undefined, tone]] as const) {
            const { x, xt } = branches(freq, time);
            const e = demucsStemEnergies(x, xt, L);
            for (const t of inner) {
                expect(Math.abs(db(e.drums[t]) - db(hannEnergy(tone, tone, t * H + H / 2)))).toBeLessThan(0.1);
                expect(e.bass[t]).toBe(0);
            }
        }
    });

    it('writes the drums and bass audio, mono, both branches summed (the stem events read it)', () => {
        const s = signal();
        const tone = Float32Array.from({ length: L }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 3 * i / H));
        const { x, xt } = branches(s, s);
        // the bass: its time branch only, left and right
        xt.set(tone, 2 * L);
        xt.set(tone, 3 * L);
        const mono = { drums: new Float32Array(L), bass: new Float32Array(L) };
        demucsStemEnergies(x, xt, L, mono);
        for (let i = 4 * H; i < L - 4 * H; i++) {
            // _spec drops the Nyquist bin: the noise's share of it does not come back
            expect(Math.abs(mono.drums[i] - 2 * s[i])).toBeLessThan(2e-3);
            expect(Math.abs(mono.bass[i] - tone[i])).toBeLessThan(1e-6);
        }
    });
});
