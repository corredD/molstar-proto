/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { BeatCycle } from '../beat-cycle';

/**
 * Characterization of the beat cycle as `updateAxisCycle` ran it at e5e30d568 (app.tsx): the symmetry-axis drive's
 * excess over its 400 ms average, divided by its running peak, steps the cycle at 0.75 and re-arms it at 0.3; no two
 * steps within 400 ms; the peak decays over 3000 ms; every N-th step advances. The numbers in the comments come from
 * that code, run frame by frame (the first frame counts 16 ms). The clock starts at 10 s: the last step starts at 0
 * ms, so a step before 400 ms would be held back.
 */
const T = 10000;

function cycle(every = 1, canStep = () => true) {
    return new BeatCycle({ canStep, every: () => every });
}

/** a silent frame 16 ms before `now`, then a frame of `raw` at `now`: a hit over a settled average */
function hit(c: BeatCycle, raw: number, now: number) {
    c.feed(0, now - 16);
    return c.feed(raw, now);
}

describe('beat cycle', () => {
    it('steps on a hit after silence', () => {
        const c = cycle();
        expect(hit(c, 1, T)).toBe(true);
    });

    it('triggers at 0.75 of the running peak', () => {
        // a hit of 1 sets the peak (0.961); after 1 s of silence a hit of 0.5 reads 0.697 of it, 0.55 reads 0.767
        const below = cycle();
        hit(below, 1, T);
        expect(hit(below, 0.5, T + 1016)).toBe(false);

        const above = cycle();
        hit(above, 1, T);
        expect(hit(above, 0.55, T + 1016)).toBe(true);
    });

    it('re-arms only once the drive falls to 0.3 of its peak', () => {
        // after a hit of 1, a frame of 0.8 at +484 ms reads 0.278 (re-armed); a frame of 1 reads 0.350 (still held)
        const rearmed = cycle();
        hit(rearmed, 1, T);
        rearmed.feed(0.8, T + 484);
        expect(rearmed.feed(4, T + 500)).toBe(true);

        const held = cycle();
        hit(held, 1, T);
        held.feed(1, T + 484);
        expect(held.feed(4, T + 500)).toBe(false);
    });

    it('holds back a step within 400 ms of the last, and that hit still latches the trigger', () => {
        const c = cycle();
        expect(hit(c, 0.5, T)).toBe(true);
        c.feed(0, T + 100);
        // a full hit (it reads 1 of the peak) at +300 ms: held back by the interval
        expect(c.feed(1, T + 300)).toBe(false);
        // with no frame under 0.3 between, the next hit at +450 ms is still latched
        expect(c.feed(2, T + 450)).toBe(false);

        const rearmed = cycle();
        hit(rearmed, 0.5, T);
        rearmed.feed(0, T + 100);
        rearmed.feed(1, T + 300);
        rearmed.feed(0, T + 350);
        expect(rearmed.feed(2, T + 450)).toBe(true);
    });

    it('steps at exactly 400 ms, not at 399 ms', () => {
        const at399 = cycle();
        hit(at399, 0.5, T);
        at399.feed(0, T + 100);
        expect(at399.feed(1, T + 399)).toBe(false);

        const at400 = cycle();
        hit(at400, 0.5, T);
        at400.feed(0, T + 100);
        expect(at400.feed(1, T + 400)).toBe(true);
    });

    it('lets its peak decay over 3000 ms', () => {
        // after a hit of 1 (peak 0.961), a hit of 0.3 reads 0.355 at +0.6 s, 0.493 at +1.5 s, 0.815 at +3 s (peak 0.354)
        for (const [ms, steps] of [[600, false], [1500, false], [3000, true]] as const) {
            const c = cycle();
            hit(c, 1, T);
            expect(hit(c, 0.3, T + ms)).toBe(steps);
        }
    });

    it('advances on every N-th step', () => {
        const c = cycle(4);
        const out: boolean[] = [];
        for (let i = 0; i < 9; i++) out.push(hit(c, 1, T + i * 500));
        expect(out).toEqual([false, false, false, true, false, false, false, true, false]);
    });

    it('counts no step while it cannot step, nor holds the next one back', () => {
        let canStep = false;
        const c = cycle(1, () => canStep);
        expect(hit(c, 1, T)).toBe(false);
        canStep = true;
        // 200 ms later: the hit it could not take set no interval
        expect(hit(c, 1, T + 200)).toBe(true);
    });

    it('reset clears the count', () => {
        const c = cycle(2);
        expect(hit(c, 1, T)).toBe(false);
        c.reset();
        expect(hit(c, 1, T + 500)).toBe(false);
        expect(hit(c, 1, T + 1000)).toBe(true);
    });

    it('pause re-arms the trigger and keeps the clock', () => {
        // a hit, then 0.9 (reads 0.86, latched): without a pause the hit at +500 ms is held, after one it steps
        const held = cycle();
        hit(held, 1, T);
        held.feed(0.9, T + 16);
        expect(held.feed(3, T + 500)).toBe(false);

        const paused = cycle();
        hit(paused, 1, T);
        paused.feed(0.9, T + 16);
        paused.pause();
        expect(paused.feed(3, T + 500)).toBe(true);
    });
});
