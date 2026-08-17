/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioProminenceTracker, DefaultAudioProminenceParams, getOnsetDecay, softmaxOverActive } from '../audio-prominence';

const Keys = ['kick', 'bass', 'pad'] as const;
type Key = typeof Keys[number];

function levels(kick: number, bass: number, pad: number): Record<Key, number> {
    return { kick, bass, pad };
}

describe('audio prominence', () => {
    it('decays the onset by half over one half-life, independent of the frame rate', () => {
        expect(getOnsetDecay(130, 130)).toBeCloseTo(0.5, 6);
        expect(getOnsetDecay(130, 260)).toBeCloseTo(0.25, 6);
        // two 8 ms steps must decay as much as one 16 ms step
        expect(getOnsetDecay(130, 8) * getOnsetDecay(130, 8)).toBeCloseTo(getOnsetDecay(130, 16), 6);
        // the default half-life reproduces the per-frame alpha of ~0.92 at 60 fps that the
        // reference visualization uses (alpha = 0.92 is exactly a 138 ms half-life; 130 ms is the
        // value that write-up quotes in milliseconds, and the two differ by well under a frame)
        expect(getOnsetDecay(DefaultAudioProminenceParams.onsetHalfLifeMs, 1000 / 60)).toBeCloseTo(0.92, 1);
        expect(getOnsetDecay(138, 1000 / 60)).toBeCloseTo(0.92, 3);
    });

    it('holds an onset peak and then lets it fade', () => {
        const tracker = new AudioProminenceTracker(Keys);

        tracker.update(levels(0, 0, 0), 16);
        const hit = tracker.update(levels(0.8, 0, 0), 16);
        expect(hit.onset.kick).toBeCloseTo(0.8, 6);

        // level stays high, so there is no new flux and the peak decays
        const after = tracker.update(levels(0.8, 0, 0), 130);
        expect(after.onset.kick).toBeCloseTo(0.4, 6);
        expect(after.onset.bass).toBe(0);
    });

    it('gives a transient more weight than a sustain at the same level', () => {
        const tracker = new AudioProminenceTracker(Keys);

        // pad sustains at 0.5 for a while, kick is silent
        for (let i = 0; i < 20; ++i) tracker.update(levels(0, 0, 0.5), 16);
        // kick jumps to the same level the pad is holding
        const frame = tracker.update(levels(0.5, 0, 0.5), 16);

        expect(frame.onset.kick).toBeGreaterThan(frame.onset.pad);
        expect(frame.prominence.kick).toBeGreaterThan(frame.prominence.pad);
    });

    it('sums to one and sharpens with the temperature', () => {
        const soft = new AudioProminenceTracker(Keys, { temperature: 1 });
        const sharp = new AudioProminenceTracker(Keys, { temperature: 20 });

        const softFrame = soft.update(levels(0.9, 0.4, 0.3), 16);
        const sharpFrame = sharp.update(levels(0.9, 0.4, 0.3), 16);

        const total = (f: typeof softFrame) => Keys.reduce((s, k) => s + f.prominence[k], 0);
        expect(total(softFrame)).toBeCloseTo(1, 6);
        expect(total(sharpFrame)).toBeCloseTo(1, 6);

        // the loudest source claims more of the weight at a higher temperature
        expect(sharpFrame.prominence.kick).toBeGreaterThan(softFrame.prominence.kick);
        expect(sharpFrame.prominence.pad).toBeLessThan(softFrame.prominence.pad);
    });

    it('reports zero for every source in silence rather than a uniform split', () => {
        const tracker = new AudioProminenceTracker(Keys);
        const frame = tracker.update(levels(0, 0, 0), 16);
        for (const key of Keys) expect(frame.prominence[key]).toBe(0);
    });

    it('redistributes the weight among the enabled sources', () => {
        const tracker = new AudioProminenceTracker(Keys);

        // note: `update` reuses its frame, so the values have to be copied out before the next call
        const all = { ...tracker.update(levels(0.9, 0.5, 0.5), 16).prominence };
        expect(all.kick).toBeGreaterThan(0.5);

        tracker.reset();
        const without = { ...tracker.update(levels(0.9, 0.5, 0.5), 16, k => k !== 'kick').prominence };
        expect(without.kick).toBe(0);
        expect(without.bass + without.pad).toBeCloseTo(1, 6);
        expect(without.bass).toBeGreaterThan(all.bass);
    });

    it('onsetWeight trades a loud sustain against a quiet transient', () => {
        const run = (onsetWeight: number) => {
            const tracker = new AudioProminenceTracker(Keys, { onsetWeight });
            for (let i = 0; i < 20; ++i) tracker.update(levels(0, 0.95, 0), 16);
            return { ...tracker.update(levels(0.3, 0.95, 0), 16).prominence };
        };

        // equal weighting: the loud sustained bass keeps the lead, as in the reference formula
        const equal = run(1);
        expect(equal.bass).toBeGreaterThan(equal.kick);

        // weighting the onset up hands the frame to the transient
        const weighted = run(6);
        expect(weighted.kick).toBeGreaterThan(weighted.bass);
    });

    it('stays finite at large temperatures', () => {
        const out = { a: 0, b: 0 };
        softmaxOverActive(['a', 'b'] as const, { a: 40, b: 0 }, { a: true, b: true }, 1000, out);
        expect(Number.isFinite(out.a)).toBe(true);
        expect(out.a).toBeCloseTo(1, 6);
        expect(out.b).toBeCloseTo(0, 6);
    });
});
