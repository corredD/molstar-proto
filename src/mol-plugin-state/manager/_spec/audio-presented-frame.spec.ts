/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioPresentedFrame, MaxAudioOutputLatency, webAudioOutputClock } from '../audio-presented-frame';
import { createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions } from '../audio-reactor';
import { AudioAffect, AudioRoute, AudioScopeSlot, AudioScopeSlotCount, createZeroDrives, getDefaultAudioRoutes } from '../audio-routing';

/** one live state, mutated in place between pushes (as the manager's router does with its drives) */
function liveState(routes: AudioRoute[] = getDefaultAudioRoutes()) {
    const frame = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);
    const stems = { drums: 0, bass: 0, other: 0, vocals: 0 };
    const drives = createZeroDrives();
    const scopeKind = new Array<number>(AudioScopeSlotCount).fill(0), scopeDrive = new Array<number>(AudioScopeSlotCount).fill(0);
    const scopes: AudioScopeSlot[] = [];
    const values = new Map<number, number>();
    const viz = { waveform: new Float32Array(96), spectrum: new Float32Array(56) };
    const live = { frame, stems, drives, scopeKind, scopeDrive, scopes, values, viz, routes, separated: false, playing: false };
    /** writes `x` (and values derived from it) everywhere */
    const set = (x: number) => {
        frame.amplitude = x; frame.raw.peakAmplitude = x + 1; frame.frequencyBands.bass = x + 2; frame.raw.bandProminence.treble = x + 3;
        stems.drums = x + 4; drives.symAxis = x + 5; drives.duck = x + 6;
        live.routes.forEach((r, i) => values.set(r.id, x + 10 + i));
        viz.waveform[95] = x; viz.spectrum[0] = x;
        live.separated = x % 2 === 1;
        live.playing = x % 3 === 0;
    };
    const push = (p: AudioPresentedFrame, stamp: number) => p.push(stamp, live.playing, frame, stems, live.separated, drives, scopes.length, scopeKind, scopeDrive, scopes, live.routes, values, viz);
    return { live, set, push };
}

/** pushes x = 0..n-1 at stamps (x + 1) * 16 ms */
function filled(n: number, capacity?: number) {
    const p = new AudioPresentedFrame(96, 56, capacity);
    const l = liveState();
    for (let x = 0; x < n; x++) { l.set(x); l.push(p, (x + 1) * 0.016); }
    return { p, l };
}

describe('AudioPresentedFrame', () => {
    it('presents the newest entry stamped at or before the read time', () => {
        const { p } = filled(20);
        p.present(10 * 0.016 + 0.005); // entries x = 9 (0.160) and x = 10 (0.176): 9
        expect(p.frame.amplitude).toBe(9);
        expect(p.frame.raw.peakAmplitude).toBe(10);
        expect(p.frame.frequencyBands.bass).toBe(11);
        expect(p.frame.raw.bandProminence.treble).toBe(12);
        expect(p.stems.drums).toBe(13);
        expect(p.drives.symAxis).toBe(14);
        expect(p.drives.duck).toBe(15);
        expect(p.stemsSeparated).toBe(true);
        expect(p.playing).toBe(true);
        expect(p.visualization.waveform[95]).toBe(9);
        expect(p.visualization.spectrum[0]).toBe(9);
        p.present(11 * 0.016); // exactly a stamp: that entry
        expect(p.frame.amplitude).toBe(10);
    });

    it('presents the oldest entry before the first stamp, and clamps a latency longer than the ring', () => {
        const a = filled(20);
        a.p.present(0);
        expect(a.p.frame.amplitude).toBe(0);
        const b = filled(300, 256);
        b.p.present(-100);
        expect(b.p.frame.amplitude).toBe(300 - 256); // the oldest still in the ring
    });

    it('never goes back: a growing latency holds the picture', () => {
        const { p } = filled(20);
        p.present(15 * 0.016);
        expect(p.frame.amplitude).toBe(14);
        p.present(10 * 0.016);
        expect(p.frame.amplitude).toBe(14);
        p.present(17 * 0.016); // the rule names 16, two past 14: the next entry, 15 (one per frame)
        expect(p.frame.amplitude).toBe(15);
        p.present(19 * 0.016); // three past: the rule, 18
        expect(p.frame.amplitude).toBe(18);
    });

    it('equal stamps (a frozen clock) keep the ring; the newest of them is presented', () => {
        const p = new AudioPresentedFrame(96, 56);
        const l = liveState();
        for (let x = 0; x < 5; x++) { l.set(x); l.push(p, 1); }
        p.present(1);
        expect(p.frame.amplitude).toBe(4);
        p.present(0); // before every stamp: the oldest, but never older than presented
        expect(p.frame.amplitude).toBe(4);
    });

    it('a clock that goes backward flushes the ring', () => {
        const { p, l } = filled(20); // stamps up to 0.32
        l.set(100); l.push(p, 0.05);
        p.present(0.04); // before the only entry: it stands in, the old entries are gone
        expect(p.frame.amplitude).toBe(100);
        expect(p.newestStamp).toBe(0.05);
    });

    it('nothing pushed: present changes nothing', () => {
        const p = new AudioPresentedFrame(96, 56);
        const frame = p.frame;
        p.present(1);
        expect(p.frame).toBe(frame);
        expect(p.frame.amplitude).toBe(0);
        expect(p.newestStamp).toBe(-Infinity);
    });

    it('after a route edit, route values and scopes show their own entry\'s ids and affects', () => {
        const p = new AudioPresentedFrame(96, 56);
        const [a, b, c] = getDefaultAudioRoutes();
        const l = liveState([a, b]);
        const affectB: AudioAffect = { level: 'chain', ref: 'x', chainId: 'B' } as unknown as AudioAffect;
        const affectC: AudioAffect = { level: 'chain', ref: 'x', chainId: 'C' } as unknown as AudioAffect;
        l.live.scopes.push({ kind: 2, drive: 0.5, affect: affectB }); l.live.scopeKind[0] = 2; l.live.scopeDrive[0] = 0.5;
        l.set(1); l.push(p, 0.016);
        l.live.routes = [a, c];
        l.live.scopes[0] = { kind: 3, drive: 0.7, affect: affectC }; l.live.scopeKind[0] = 3; l.live.scopeDrive[0] = 0.7;
        l.set(2); l.push(p, 0.032);

        const map = p.routeValues, scopes = p.scopes;
        p.present(0.016);
        expect([...p.routeValues]).toEqual([[a.id, 11], [b.id, 12]]);
        expect(p.scopeCount).toBe(1);
        expect(p.scopes[0]).toEqual({ kind: 2, drive: 0.5, affect: affectB });
        expect(p.scopes[0].affect).toBe(affectB);
        p.present(0.032);
        expect([...p.routeValues]).toEqual([[a.id, 12], [c.id, 13]]);
        expect(p.scopes[0].affect).toBe(affectC);
        expect(p.scopeKind[0]).toBe(3);
        expect(p.scopeDrive[0]).toBe(0.7);
        expect(p.routeValues).toBe(map);
        expect(p.scopes).toBe(scopes);
    });

    it('more routes than the route block: it grows once and keeps the older entries', () => {
        const p = new AudioPresentedFrame(96, 56);
        const few = getDefaultAudioRoutes().slice(0, 2);
        const many: AudioRoute[] = [];
        for (let i = 0; i < 20; i++) many.push({ ...few[0], id: 1000 + i });
        const l = liveState(few);
        l.set(1); l.push(p, 0.016);
        l.live.routes = many;
        l.set(2); l.push(p, 0.032);
        p.present(0.016);
        expect([...p.routeValues.values()]).toEqual([11, 12]);
        p.present(0.032);
        expect(p.routeValues.size).toBe(20);
        expect(p.routeValues.get(1019)).toBe(2 + 10 + 19);
    });

    it('allocates nothing per frame: 1000 steady push + present keep every handed-out object and construct none', () => {
        const p = new AudioPresentedFrame(96, 56);
        const l = liveState();
        l.live.scopes.push({ kind: 2, drive: 0.5, affect: { level: 'all' } }, { kind: 6, drive: 0.1, affect: { level: 'all' } });
        for (let x = 0; x < 10; x++) { l.set(x); l.push(p, (x + 1) * 0.016); p.present((x + 1) * 0.016 - 0.1); }
        const held = [p.frame, p.frame.frequencyBands, p.frame.bandOnsets, p.frame.bandProminence, p.frame.raw, p.frame.raw.frequencyBands,
            p.drives, p.stems, p.routeValues, p.scopes, p.scopes[0], p.scopes[1], p.scopeKind, p.scopeDrive, p.visualization,
            p.visualization.waveform, p.visualization.spectrum];

        const g = globalThis as unknown as Record<string, new (...a: unknown[]) => unknown>;
        const names = ['Map', 'Set', 'Array', 'Float32Array', 'Float64Array', 'Int32Array', 'Object'];
        const saved = names.map(n => g[n]);
        let constructed = 0;
        try {
            names.forEach((n, i) => {
                const Base = saved[i];
                g[n] = new Proxy(Base, { construct(target, args, newTarget) { constructed++; return Reflect.construct(target, args, newTarget); } });
            });
            for (let x = 10; x < 1010; x++) { l.set(x); l.push(p, (x + 1) * 0.016); p.present((x + 1) * 0.016 - 0.1); }
        } finally {
            names.forEach((n, i) => { g[n] = saved[i]; });
        }
        expect(constructed).toBe(0);
        const now = [p.frame, p.frame.frequencyBands, p.frame.bandOnsets, p.frame.bandProminence, p.frame.raw, p.frame.raw.frequencyBands,
            p.drives, p.stems, p.routeValues, p.scopes, p.scopes[0], p.scopes[1], p.scopeKind, p.scopeDrive, p.visualization,
            p.visualization.waveform, p.visualization.spectrum];
        now.forEach((o, i) => expect(o).toBe(held[i]));
        expect(p.frame.amplitude).toBe(1009 - 7); // 100 ms at 16 ms frames: 7 frames behind
    });

    it('the spy counts: a Map built inside the window is seen', () => {
        const g = globalThis as unknown as Record<string, new (...a: unknown[]) => unknown>;
        const saved = g.Map;
        let constructed = 0;
        try {
            g.Map = new Proxy(saved, { construct(target, args, newTarget) { constructed++; return Reflect.construct(target, args, newTarget); } });
            new (g.Map)();
        } finally { g.Map = saved; }
        expect(constructed).toBe(1);
    });
});

/** a seeded generator, one per run */
function random(seed: number) {
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/**
 * Pushes `n` ticks at `fps` with stamps from `stamp(i)` and presents each at stamp - `latency(i)`. Entry i carries
 * amplitude i, so the presented amplitude is the presented entry. `rule` is the entry the read rule names alone (the
 * newest stamped at or before the read time, else the oldest): the reference the presented entry is held to.
 */
function steadyRun(n: number, stamp: (i: number) => number, latency: (i: number) => number) {
    const p = new AudioPresentedFrame(96, 56);
    const l = liveState();
    const stamps: number[] = [], read: number[] = [], rule: number[] = [], presented: number[] = [];
    for (let i = 0; i < n; i++) {
        l.live.frame.amplitude = i;
        const t = stamp(i);
        stamps.push(t);
        l.push(p, t);
        const r = t - latency(i);
        read.push(r);
        p.present(r);
        let seq = i;
        while (seq > Math.max(0, i + 1 - p.capacity) && stamps[seq] > r + 1e-9) seq--;
        rule.push(seq);
        presented.push(p.frame.amplitude);
    }
    /** over frames [from, to): holds (the same entry again), skips (2 or more entries), never early, at most one behind */
    const stats = (from: number, to = n) => {
        let holds = 0, skips = 0, early = 0, behindMax = 0, aheadMax = 0;
        for (let i = from; i < to; i++) {
            const step = presented[i] - presented[i - 1];
            if (step === 0) holds++; else if (step >= 2) skips++;
            if (stamps[presented[i]] > read[i] + 1e-9) early++;
            behindMax = Math.max(behindMax, rule[i] - presented[i]);
            aheadMax = Math.max(aheadMax, presented[i] - rule[i]);
        }
        return { holds, skips, early, behindMax, aheadMax };
    };
    /** over frames [from, to): the mean of rule - presented, in entries */
    const meanLag = (from: number, to = n) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += rule[i] - presented[i];
        return sum / (to - from);
    };
    return { stamps, rule, presented, stats, meanLag };
}

describe('AudioPresentedFrame steady steps (the read rule holds one entry per frame)', () => {
    it('60 Hz, latency 200 ms (12 frames exactly), ticks jittered +-1.5 ms: one entry per frame, never early, at most one behind', () => {
        const rnd = random(1);
        const run = steadyRun(2000, i => (i * 1000 / 60 + (rnd() * 2 - 1) * 1.5) / 1000, () => 0.2);
        expect(run.stats(300)).toEqual({ holds: 0, skips: 0, early: 0, behindMax: 1, aheadMax: 0 });
    });

    it('120 Hz and 144 Hz, latency k frames exactly, ticks jittered +-1.5 ms: one entry per frame, never early, at most one behind', () => {
        for (const fps of [120, 144]) {
            for (const k of [2, 3, 4]) {
                const rnd = random(3 + k);
                const run = steadyRun(3000, i => (i * 1000 / fps + (rnd() * 2 - 1) * 1.5) / 1000, () => k / fps);
                const s = run.stats(300);
                expect([fps, k, s.holds, s.skips, s.early, s.aheadMax]).toEqual([fps, k, 0, 0, 0, 0]);
                expect(s.behindMax).toBeLessThanOrEqual(1);
            }
        }
    });

    // The constants of the step tolerance, pinned from both sides. The read time sits `past` ms past the stamp of the
    // newer entry once L steps from 3 frames to 2 at frame 300 (the rule moves two entries at once). Past the tolerance
    // the picture is back on the rule (mean lag 0); inside it, it stays one behind (mean lag 1). One exit ends the band
    // for good, so the ticks carry no random jitter here: `alternate` (+-1.5 ms, by parity) shortens every other
    // interval to 3 ms less and keeps `past` exact for the same parity.
    const bandLag = (fps: number, past: number, alternate = 0) => {
        const r = steadyRun(1300, i => (i * 1000 / fps + (i % 2 ? alternate : -alternate)) / 1000, i => (i < 300 ? 3 : 2) / fps - past / 1000);
        return r.meanLag(400, 1300);
    };

    it('the cap: 5.5 ms past a stamp is outside the band at 60 Hz and at 49 ms frames (a 6 ms cap keeps it one behind)', () => {
        expect(bandLag(60, 5.5)).toBeLessThanOrEqual(0.1);
        expect(bandLag(1000 / 49, 5.5)).toBeLessThanOrEqual(0.1);
    });

    it('the cap: 4.5 ms past a stamp is inside the band at 60 Hz and at 49 ms frames (a 4 ms cap lets it follow the rule)', () => {
        expect(bandLag(60, 4.5)).toBeGreaterThanOrEqual(0.9);
        expect(bandLag(1000 / 49, 4.5)).toBeGreaterThanOrEqual(0.9);
    });

    it('the floor: at 144 Hz, with ticks alternating +-1.5 ms (intervals of 3.9 and 9.9 ms), 2.6 ms past a stamp is inside the band (no floor: half of 3.9 ms is 2 ms)', () => {
        expect(bandLag(144, 2.6, 1.5)).toBeGreaterThanOrEqual(0.9);
    });

    it('the half: at 144 Hz the band is half an interval (3.5 ms): 3.3 ms inside, 3.7 ms outside (a quarter would be the 3 ms floor, a whole one the 5 ms cap)', () => {
        expect(bandLag(144, 3.3)).toBeGreaterThanOrEqual(0.9);
        expect(bandLag(144, 3.7)).toBeLessThanOrEqual(0.1);
    });

    it('a clock in 5.3 ms quanta (256 samples at 48 kHz), 60 Hz, latency 200 ms: one entry per frame', () => {
        const quantum = 256 / 48000;
        const run = steadyRun(600, i => Math.floor(i / 60 / quantum) * quantum, () => 0.2);
        const s = run.stats(100);
        expect([s.holds, s.skips, s.early, s.aheadMax]).toEqual([0, 0, 0, 0]);
        expect(s.behindMax).toBeLessThanOrEqual(1);
    });

    it('a step of +-40 ms in the latency re-syncs within 2 entries of the rule', () => {
        const rnd = random(2);
        // 0.2 -> 0.24 (+40 ms) -> 0.2 (-40) -> 0.16 (-40) -> 0.2 (+40), 1000 frames each
        const steps = [0.2, 0.24, 0.2, 0.16, 0.2];
        const L = (i: number) => steps[Math.floor(i / 1000)];
        const run = steadyRun(5000, i => (i * 1000 / 60 + (rnd() * 2 - 1) * 1.5) / 1000, L);
        for (let i = 300; i < 5000; i++) expect(Math.abs(run.presented[i] - run.rule[i])).toBeLessThanOrEqual(2);
        // a few frames after each step: steady again (one entry per frame, never early, at most one behind)
        for (const [from, to] of [[1010, 2000], [2010, 3000], [3010, 4000], [4010, 5000]]) {
            const s = run.stats(from, to);
            expect([s.holds, s.skips, s.early, s.aheadMax]).toEqual([0, 0, 0, 0]);
            expect(s.behindMax).toBeLessThanOrEqual(1);
        }
    });

    // Ludo's Chrome: 49 ms frames, outputLatency 32 ms. The read time sits 17 ms past an entry's stamp (a third of a
    // frame): the rule names that entry every frame. One tick 20 ms late (a missed vsync) makes the rule hold then
    // move two; the picture must not stay one entry behind after it.
    const frame49 = (late: (i: number) => boolean, seed: number) => {
        const rnd = random(seed);
        return (i: number) => (i * 49 + (rnd() * 2 - 1) * 1.5 + (late(i) ? 20 : 0)) / 1000;
    };

    it('49 ms frames, latency 32 ms, one late tick: back on the rule after it (mean lag <= 0.1 entry over 1000 frames)', () => {
        const run = frame49(i => i === 100, 4);
        const r = steadyRun(1200, run, () => 0.032);
        expect(r.meanLag(200, 1200)).toBeLessThanOrEqual(0.1);
        const s = r.stats(200, 1200);
        expect([s.holds, s.skips, s.early, s.aheadMax]).toEqual([0, 0, 0, 0]);
    });

    it('49 ms frames, latency 32 ms, a late tick every 50 frames: on the rule between them, never early', () => {
        const r = steadyRun(1200, frame49(i => i % 50 === 25, 5), () => 0.032);
        expect(r.meanLag(200, 1200)).toBeLessThanOrEqual(0.1);
        const s = r.stats(200, 1200);
        expect([s.early, s.aheadMax]).toEqual([0, 0]);
    });

    it('49 ms frames, every latency from 33 to 42 ms (7 ms or more inside the interval), one late tick: back on the rule', () => {
        for (let L = 33; L <= 42; L++) {
            const r = steadyRun(1200, frame49(i => i === 100, 10 + L), () => L / 1000);
            expect([L, r.meanLag(200, 1200) <= 0.1]).toEqual([L, true]);
            expect(r.stats(200, 1200).early).toBe(0);
        }
    });

    it('49 ms frames, a latency step from 60 to 42 ms (two entries at once, 7 ms inside the interval): on the rule after it', () => {
        const r = steadyRun(1200, frame49(() => false, 7), i => i < 200 ? 0.06 : 0.042);
        expect(r.meanLag(300, 1200)).toBeLessThanOrEqual(0.1);
    });

    it('a latency that drops from 32 ms to 0 (the context stops) presents the newest entry from that frame on', () => {
        const r = steadyRun(600, frame49(() => false, 6), i => i < 300 ? 0.032 : 0);
        for (let i = 300; i < 600; i++) expect(r.presented[i]).toBe(i);
    });

    it('latency 0: every frame presents the newest entry (the rule unchanged)', () => {
        const rnd = random(3);
        const run = steadyRun(1000, i => (i * 1000 / 60 + (rnd() * 2 - 1) * 1.5) / 1000, () => 0);
        run.presented.forEach((e, i) => expect(e).toBe(i));
    });
});

describe('webAudioOutputClock', () => {
    const fake = (outputLatency: unknown, state = 'running') => ({ currentTime: 1.5, state, outputLatency }) as unknown as AudioContext & { currentTime: number, state: string, outputLatency: unknown };

    it('reads currentTime and outputLatency live', () => {
        const ctx = fake(0.192);
        const clock = webAudioOutputClock(ctx);
        expect(clock.now()).toBe(1.5);
        expect(clock.latency()).toBe(0.192);
        ctx.currentTime = 2; ctx.outputLatency = 0.03;
        expect(clock.now()).toBe(2);
        expect(clock.latency()).toBe(0.03);
    });

    it('latency 0 where outputLatency is missing or not finite (Safari) and while the context is not running', () => {
        expect(webAudioOutputClock(fake(undefined)).latency()).toBe(0);
        expect(webAudioOutputClock(fake(NaN)).latency()).toBe(0);
        expect(webAudioOutputClock(fake(Infinity)).latency()).toBe(0);
        expect(webAudioOutputClock(fake(0.192, 'suspended')).latency()).toBe(0);
        expect(webAudioOutputClock(fake(0.192, 'closed')).latency()).toBe(0);
    });

    it('clamps to [0, MaxAudioOutputLatency]', () => {
        expect(webAudioOutputClock(fake(-0.1)).latency()).toBe(0);
        expect(webAudioOutputClock(fake(5)).latency()).toBe(MaxAudioOutputLatency);
    });
});
