/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioRedrawTracker } from '../audio-redraw';

const scopeKind = new Float32Array(8);
const scopeDrive = new Float32Array(8);
const frame = (o: { illumination?: number, hue?: number, wave?: number, scopeCount?: number, kind?: number, drive?: number } = {}) => {
    scopeKind[0] = o.kind ?? 0;
    scopeDrive[0] = o.drive ?? 0;
    return {
        illumination: o.illumination ?? 0, hue: o.hue ?? 0, driveInstanceWave: o.wave ?? 0,
        scopeCount: o.scopeCount ?? 0, scopeKind, scopeDrive,
    };
};
const run = (t: AudioRedrawTracker, frames: ReturnType<typeof frame>[]) => frames.map(f => t.next(f));

describe('AudioRedrawTracker', () => {
    it('renders a held illumination or hue once, not every frame', () => {
        const t = new AudioRedrawTracker();
        const r = run(t, Array.from({ length: 100 }, () => frame({ illumination: 0.12 })));
        expect(r.filter(Boolean).length).toBe(1);
        expect(r[0]).toBe(true);
        expect(t.next(frame())).toBe(true);
        expect(t.next(frame())).toBe(false);
        const h = new AudioRedrawTracker();
        expect(run(h, Array.from({ length: 10 }, () => frame({ hue: 0.3 }))).filter(Boolean).length).toBe(1);
    });

    it('illumination 0.5, 0, 0, then 0.5 renders, renders, none, renders', () => {
        const t = new AudioRedrawTracker();
        expect(run(t, [0.5, 0, 0, 0.5].map(illumination => frame({ illumination })))).toEqual([true, true, false, true]);
    });

    it('does nothing at rest', () => {
        const t = new AudioRedrawTracker();
        expect(run(t, [frame(), frame({ scopeCount: 1 }), frame()]).slice(2)).toEqual([false]);
        expect(run(t, [frame(), frame()])).toEqual([false, false]);
    });

    it('a narrowed illumination route renders on change, and once when it is disabled', () => {
        const t = new AudioRedrawTracker();
        expect(run(t, [
            frame({ scopeCount: 1, kind: 8, drive: 0.12 }),
            frame({ scopeCount: 1, kind: 8, drive: 0.12 }),
            frame({ scopeCount: 1, kind: 8, drive: 0.12 }),
            frame({ scopeCount: 0, kind: 8, drive: 0.12 }),
            frame({ scopeCount: 0, kind: 8, drive: 0.12 }),
        ])).toEqual([true, false, false, true, false]);
    });

    it('a narrowed motion route renders while above 0 and once when it drops to 0', () => {
        const t = new AudioRedrawTracker();
        expect(run(t, [
            frame({ scopeCount: 1, kind: 7, drive: 0.5 }),
            frame({ scopeCount: 1, kind: 7, drive: 0.5 }),
            frame({ scopeCount: 1, kind: 7, drive: 0 }),
            frame({ scopeCount: 1, kind: 7, drive: 0 }),
        ])).toEqual([true, true, true, false]);
    });

    it('the instance wave renders every frame while above 0, then once on the drop', () => {
        const t = new AudioRedrawTracker();
        expect(run(t, [0.5, 0.5, 0.5, 0, 0].map(wave => frame({ wave })))).toEqual([true, true, true, true, false]);
    });
});
