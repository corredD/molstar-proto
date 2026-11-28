/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as fs from 'fs';
import * as path from 'path';
import { mulberry32 } from '../../_spec/audio-pipeline-helper';
import { StemSampleRate as SR } from '../dsp';
import { BassNoteBand, DrumHitBand, KickBand, StemEventBand, StemEventDetector, StemEventKind, StemEventKinds } from '../stem-events';

type Fixture = Record<StemEventKind, [number, number][]>;
const fixture: Fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'stem-events-fixture.json'), 'utf8'));
const Bands: Record<StemEventKind, StemEventBand> = { kick: KickBand, snare: DrumHitBand, bassNote: BassNoteBand };

/** stem-events-fixture.py's signal, sample by sample: kicks 1 / 0.5 every 0.5 s, hats on the off-beats, bass notes */
function fixtureSignal() {
    const n = 8 * SR;
    const drums = new Float64Array(n), bass = new Float64Array(n);
    for (let k = 0; k < 14; k++) {
        const amp = k % 2 === 0 ? 1 : 0.5, s0 = Math.round((0.5 + 0.5 * k) * SR);
        for (let i = 0; i < Math.round(0.12 * SR); i++) {
            const t = i / SR;
            drums[s0 + i] += amp * Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * (50 * t + 50 * 0.03 * (1 - Math.exp(-t / 0.03))));
        }
    }
    for (let k = 0; k < 7; k++) {
        const f = k % 2 === 0 ? 55 : 82, s0 = Math.round((0.75 + k) * SR);
        for (let i = 0; i < Math.round(0.9 * SR); i++) {
            const t = i / SR;
            bass[s0 + i] += 0.4 * Math.min(1, t / 0.005) * Math.exp(-t / 0.6) * Math.sin(2 * Math.PI * f * t);
        }
    }
    const rnd = mulberry32(99);
    for (let k = 1; k < 15; k++) {
        const s0 = Math.round((0.25 + 0.5 * k) * SR);
        let prev = 0;
        for (let i = 0; i < Math.round(0.02 * SR); i++) {
            const w = rnd() * 2 - 1;
            drums[s0 + i] += 0.2 * Math.exp(-i / SR / 0.006) * (w - prev);
            prev = w;
        }
    }
    return { drums: Float32Array.from(drums), bass: Float32Array.from(bass) };
}

const Pad = 4096;
/** the whole signal in one run: zeros around it (scipy's boundary), every flux peak in it posted */
function detectWhole(drums: Float32Array, bass: Float32Array) {
    const W = drums.length + 2 * Pad;
    const d = new Float32Array(W), b = new Float32Array(W);
    d.set(drums, Pad);
    b.set(bass, Pad);
    const detector = new StemEventDetector(W);
    const batch = detector.run(d, b, -Pad, 0, W);
    const out: Record<StemEventKind, [number, number][]> = { kick: [], snare: [], bassNote: [] };
    for (let i = 0; i < batch.count; i++) out[StemEventKinds[batch.kinds[i]]].push([batch.at[i] / SR, batch.dbfs[i]]);
    return out;
}

describe('stem events', () => {
    it('the detector equals the Python one on the fixture signal: same events per kind, |Δt| <= 10 µs, |ΔdB| <= 0.01', () => {
        const { drums, bass } = fixtureSignal();
        const got = detectWhole(drums, bass);
        for (const kind of StemEventKinds) {
            const want = fixture[kind], band = Bands[kind];
            expect(got[kind].length).toBe(want.length);
            want.forEach(([t, db], i) => {
                // the same frames: only the fixture's 6 decimals differ (an off-by-one frame would be 2.9 ms off)
                expect(Math.abs(got[kind][i][0] - t)).toBeLessThanOrEqual(1e-5);
                expect(Math.abs(got[kind][i][1] - (db - band.fullScaleDb))).toBeLessThanOrEqual(0.01);
            });
        }
    });

    it('no kick on bass notes alone; bass notes on each note change', () => {
        const { bass } = fixtureSignal();
        const got = detectWhole(new Float32Array(bass.length), bass);
        expect(got.kick.length).toBe(0);
        expect(got.snare.length).toBe(0);
        expect(got.bassNote.map(e => Math.round(e[0] * 4) / 4)).toEqual([0.75, 1.75, 2.75, 3.75, 4.75, 5.75, 6.75]);
    });

    it('a unit sine reads 0 dBFS in each detector', () => {
        const n = 3 * SR;
        // a 10 ms ramp: an abrupt start would read as a kick too, and a hit at a kick is the kick's
        const sine = (f: number) => Float32Array.from({ length: n }, (_, i) => i < SR ? 0 : Math.min(1, (i - SR) / (0.01 * SR)) * Math.sin(2 * Math.PI * f * i / SR));
        const kick = detectWhole(sine(86.1328125), new Float32Array(n)).kick;
        const hits = detectWhole(sine(1000), new Float32Array(n)).snare;
        const notes = detectWhole(new Float32Array(n), sine(110)).bassNote;
        // the onset at 1 s; a steady sine's float noise has peaks of its own after it (the reference's too)
        for (const events of [kick, hits, notes]) {
            expect(Math.abs(events[0][0] - 1)).toBeLessThan(0.03);
            expect(Math.abs(events[0][1])).toBeLessThan(0.5);
        }
    });

    it('events under -40 dBFS are dropped (near-silence)', () => {
        const { drums, bass } = fixtureSignal();
        const got = detectWhole(drums.map(x => x * 1e-3), bass.map(x => x * 1e-3));
        for (const kind of StemEventKinds) expect(got[kind].length).toBe(0);
    });
});
