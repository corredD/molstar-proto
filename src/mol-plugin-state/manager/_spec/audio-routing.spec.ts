/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { SortedArray } from '../../../mol-data/int';
import { groupSpanInElements } from '../../helpers/audio-affect';
import { createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions } from '../audio-reactor';
import { applyAudioRouteCurve, AudioRestCutoff, AudioRouter, AudioScopeKinds, createAudioRoute, draftsFromRoutes, isStemEventSource, maxScopeLevel, NoStemEvents, parseAudioRouting, routesFromDrafts, sameAudioAffect, serializeAudioRouting, StemEventValues } from '../audio-routing';

const EmptyFrame = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);
const Chain = { level: 'chain' as const, entryId: '6Q3Q', modelNum: 1, entityId: '1', operatorName: '1', asymId: 'A' };

describe('audio routing', () => {
    it('sends a stem to the instance-wave channel', () => {
        const router = new AudioRouter();
        const route = createAudioRoute({
            enabled: true, source: 'stemDrums', mode: 'level', target: 'instanceWave', gain: 2, floor: 0, releaseMs: 0,
        });
        router.update([route], EmptyFrame, { drums: 0.5, bass: 0, other: 0, vocals: 0 }, 16);
        expect(router.drives.instanceWave).toBeCloseTo(1);
        expect(router.drives.symAxis).toBe(0);
        expect(router.scopeCount).toBe(0);
    });

    it('reads the song loudness against its running average, and the raw loudness as it is', () => {
        const router = new AudioRouter();
        const song = createAudioRoute({ enabled: true, source: 'songLoudness', mode: 'level', target: 'cameraZoom', gain: 1, floor: 0, releaseMs: 0 });
        const raw = createAudioRoute({ enabled: true, source: 'amplitude', mode: 'level', target: 'cameraSpin', gain: 1, floor: 0, releaseMs: 0 });
        const stems = { drums: 0, bass: 0, other: 0, vocals: 0 };
        router.update([song, raw], { ...EmptyFrame, amplitude: 0.06 }, stems, 16);
        // at its average: half
        expect(router.drives.cameraZoom).toBeCloseTo(0.5);
        expect(router.drives.cameraSpin).toBeCloseTo(0.06);
        // twice the average: full; the average has barely moved in 16 ms
        router.update([song, raw], { ...EmptyFrame, amplitude: 0.12 }, stems, 16);
        expect(router.drives.cameraZoom).toBeCloseTo(1, 1);
    });

    it('bends a source by its curve: log lifts the quiet, exp keeps the peaks, both keep 0 and 1', () => {
        for (const curve of ['linear', 'log', 'exp'] as const) {
            expect(applyAudioRouteCurve(curve, 0)).toBe(0);
            expect(applyAudioRouteCurve(curve, 1)).toBeCloseTo(1);
        }
        expect(applyAudioRouteCurve('log', 0.1)).toBeCloseTo(0.279, 2);
        expect(applyAudioRouteCurve('exp', 0.1)).toBeCloseTo(0.0288, 3);
        expect(applyAudioRouteCurve('linear', 0.1)).toBe(0.1);
        const router = new AudioRouter();
        const route = createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', curve: 'log', target: 'symAxis', gain: 2, floor: 0, releaseMs: 0 });
        router.update([route], EmptyFrame, { drums: 0, bass: 0.1, other: 0, vocals: 0 }, 16);
        expect(router.drives.symAxis).toBeCloseTo(0.558, 2);
    });

    it('reads a saved route without a curve as linear', () => {
        const parsed = parseAudioRouting(JSON.stringify({ name: 'old', routes: [{ source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1 }] }));
        expect(parsed?.[0].routes[0].curve).toBe('linear');
    });

    it('ducks the routes of other sources, channel and narrowed slot alike, but never the routes of the duck\'s own source', () => {
        const router = new AudioRouter();
        const route = (source: 'stemDrums' | 'stemBass', target: 'symAxis' | 'duck', gain: number, affect?: typeof Chain) => createAudioRoute({
            enabled: true, source, mode: 'level', target, gain, floor: 0, releaseMs: 0, affect,
        });
        const stems = { drums: 1, bass: 1, other: 0, vocals: 0 };
        // the kick bursts the axes and ducks the bass: the kick's 2 stays whole, the bass's 2 and 4 drop to a quarter
        router.update([route('stemDrums', 'symAxis', 2), route('stemBass', 'symAxis', 2), route('stemBass', 'symAxis', 4, Chain), route('stemDrums', 'duck', 0.75)], EmptyFrame, stems, 16);
        expect(router.drives.symAxis).toBeCloseTo(2.5);
        expect(router.scopeDrive[0]).toBeCloseTo(1);
        expect(router.drives.duck).toBeCloseTo(0.75);
        // a full duck still leaves the floor
        router.update([route('stemBass', 'symAxis', 2), route('stemDrums', 'duck', 5)], EmptyFrame, stems, 16);
        expect(router.drives.symAxis).toBeCloseTo(0.2);
    });

    it('gives a narrowed route its own shader slot, not the channel everyone shares', () => {
        const router = new AudioRouter();
        const all = createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 0 });
        const chain = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'symAxis', gain: 2, floor: 0, releaseMs: 0, affect: Chain });
        // camera channels act on the whole view: an affect there is not a slot
        const camera = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'cameraSpin', gain: 1, floor: 0, releaseMs: 0, affect: Chain });
        router.update([all, chain, camera], EmptyFrame, { drums: 0.5, bass: 0.25, other: 0, vocals: 0 }, 16);
        expect(router.drives.symAxis).toBeCloseTo(0.25);
        expect(router.drives.cameraSpin).toBeCloseTo(0.5);
        expect(router.scopeCount).toBe(1);
        expect(router.scopeKind[0]).toBe(AudioScopeKinds.symAxis);
        expect(router.scopeDrive[0]).toBeCloseTo(1);
        expect(sameAudioAffect(router.scopes[0].affect, Chain)).toBe(true);
    });

    it('keeps 8 narrowed routes in slots, and a 9th adds nothing (not the global drive)', () => {
        const stems = { drums: 0.5, bass: 0, other: 0, vocals: 0 };
        const narrowed = (n: number) => Array.from({ length: n }, (_, i) => createAudioRoute({
            enabled: true, source: 'stemDrums', mode: 'level', target: 'wiggle', gain: 0, floor: 1, releaseMs: 0,
            affect: { ...Chain, asymId: String.fromCharCode(65 + i) },
        }));
        const eight = new AudioRouter();
        eight.update(narrowed(8), EmptyFrame, stems, 16);
        expect(eight.scopeCount).toBe(8);
        expect(eight.drives.wiggle).toBe(0);
        const nine = new AudioRouter();
        const routes = narrowed(9);
        nine.update(routes, EmptyFrame, stems, 16);
        expect(nine.scopeCount).toBe(8);
        expect(nine.drives.wiggle).toBe(0);
        // regression guard (passes on the old code too): the dropped route still shows its meter
        expect(nine.values.get(routes[8].id)).toBeCloseTo(1);
    });

    it('narrows the wiggle, glow and hue down to an atom, instance motion to a chain, and not the camera', () => {
        expect(maxScopeLevel('wiggle')).toBe('atom');
        expect(maxScopeLevel('symAxis')).toBe('chain');
        expect(maxScopeLevel('instanceWave')).toBe('chain');
        expect(maxScopeLevel('illumination')).toBe('atom');
        expect(maxScopeLevel('colorSpectrum')).toBe('atom');
        expect(maxScopeLevel('cameraSpin')).toBe('all');
    });

    it('round-trips a routing preset with each route\'s affect, and drops a route it does not know', () => {
        const route = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'instanceWave', gain: 6, floor: 0, releaseMs: 280, affect: Chain });
        const text = serializeAudioRouting([{ version: 1, name: 'Kick wave', routes: draftsFromRoutes([route]) }]);
        const parsed = parseAudioRouting(text);
        expect(parsed).toHaveLength(1);
        expect(parsed![0].name).toBe('Kick wave');
        expect(parsed![0].routes[0].target).toBe('instanceWave');
        expect(sameAudioAffect(parsed![0].routes[0].affect, Chain)).toBe(true);

        const dirty = JSON.stringify({
            name: 'Broken',
            routes: [
                { enabled: true, source: 'nope', mode: 'level', target: 'instanceWave', gain: 1, floor: 0, releaseMs: 1 },
                { enabled: true, source: 'stemBass', mode: 'level', target: 'wiggle', gain: 1, floor: 0, releaseMs: 10, affect: { level: 'nope' } },
            ],
        });
        const kept = parseAudioRouting(dirty);
        expect(kept).toHaveLength(1);
        expect(kept![0].routes).toHaveLength(1);
        expect(kept![0].routes[0].source).toBe('stemBass');
        expect(kept![0].routes[0].affect.level).toBe('all');
        expect(parseAudioRouting('not json')).toBeUndefined();
    });

    it('reads a file from before the per-route affect: its one affect goes to each route that can take it', () => {
        const old = parseAudioRouting(JSON.stringify({
            version: 1, name: 'Exported',
            routes: [
                { enabled: true, source: 'stemVocals', mode: 'level', target: 'wiggle', gain: 80, floor: -1, releaseMs: 100 },
                { enabled: true, source: 'stemVocals', mode: 'level', target: 'cameraSpin', gain: 1, floor: 0, releaseMs: 100 },
            ],
            affect: { level: 'atom', entityId: '1', asymId: 'A', seqId: 12, atomId: 'CA' },
        }));
        expect(old?.[0].name).toBe('Exported');
        expect(old?.[0].routes[0].gain).toBe(40);
        expect(old?.[0].routes[0].floor).toBe(0);
        expect(old?.[0].routes[0].affect.atomId).toBe('CA');
        expect(old?.[0].routes[1].affect.level).toBe('all');
    });
});

describe('audio routing once the sound stops (heard = false)', () => {
    const Other = (other: number) => ({ drums: 0, bass: 0, other, vocals: 0 });
    // the default wiggle route: floor 0.2, gain 2, release 350 ms
    const wiggle = () => createAudioRoute({ enabled: true, source: 'stemOther', mode: 'level', target: 'wiggle', gain: 2, floor: 0.2, releaseMs: 350 });

    it('the cut-off is 1e-3', () => {
        expect(AudioRestCutoff).toBe(1e-3);
    });

    it('targets 0, not the floor: the value releases from where it was with its own release', () => {
        const route = wiggle();
        const router = new AudioRouter();
        router.update([route], EmptyFrame, Other(0.5), 16);
        expect(router.values.get(route.id)).toBeCloseTo(1.2, 12);
        let v = router.values.get(route.id)!;
        for (let i = 0; i < 60; i++) {
            router.update([route], EmptyFrame, Other(0.5), 16, false);
            v = v + (0 - v) * (1 - Math.exp(-16 / 350));
            if (v < AudioRestCutoff) v = 0;
            expect(router.values.get(route.id)).toBe(v);
            expect(router.drives.wiggle).toBe(v);
        }
        // below the floor: no 0.2 held
        expect(v).toBeLessThan(0.2);
    });

    it('never rises to the floor when nothing was heard', () => {
        const route = wiggle();
        const router = new AudioRouter();
        for (let i = 0; i < 10; i++) router.update([route], EmptyFrame, Other(0), 16, false);
        expect(router.values.get(route.id)).toBe(0);
        expect(router.drives.wiggle).toBe(0);
    });

    it('snaps a released value below 1e-3 to 0 only when not heard', () => {
        const route = createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 100 });
        const heard = new AudioRouter(), stopped = new AudioRouter();
        for (const r of [heard, stopped]) r.update([route], EmptyFrame, { drums: 0, bass: 0.0011, other: 0, vocals: 0 }, 16);
        heard.update([route], EmptyFrame, Silent, 16);
        stopped.update([route], EmptyFrame, Silent, 16, false);
        const released = 0.0011 * Math.exp(-16 / 100);
        expect(released).toBeLessThan(AudioRestCutoff);
        expect(heard.values.get(route.id)).toBeCloseTo(released, 15);
        expect(heard.values.get(route.id)).toBeGreaterThan(0);
        expect(stopped.values.get(route.id)).toBe(0);
        expect(stopped.drives.symAxis).toBe(0);
    });

    it('a value released over 2000 frames is exactly 0 (today 2e-53, a denormal 4e-323 further on)', () => {
        const route = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'clipPosition', gain: 6.5, floor: 0, releaseMs: 260 });
        const router = new AudioRouter();
        router.update([route], EmptyFrame, { ...Silent, drums: 1 }, 16);
        expect(router.values.get(route.id)).toBe(6.5);
        for (let i = 0; i < 2000; i++) router.update([route], EmptyFrame, Silent, 16, false);
        expect(router.values.get(route.id)).toBe(0);
        expect(router.drives.clipPosition).toBe(0);
    });

    it('keeps the onset state while not heard: a resume reads the rise as a fresh route would', () => {
        const route = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'symAxis', gain: 6.5, floor: 0, releaseMs: 260 });
        const paused = new AudioRouter(), fresh = new AudioRouter();
        for (let i = 0; i < 20; i++) paused.update([route], EmptyFrame, Silent, 16, false);
        paused.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16);
        fresh.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16);
        expect(paused.values.get(route.id)).toBe(fresh.values.get(route.id));
    });

    it('keeps a non-zero onset state through frames not heard: a resume reads the rise from the level held at the pause (review N4)', () => {
        const route = createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'symAxis', gain: 6.5, floor: 0, releaseMs: 260 });
        const paused = new AudioRouter(), heard = new AudioRouter(), fresh = new AudioRouter();
        for (let i = 0; i < 5; i++) { paused.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16); heard.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16); }
        for (let i = 0; i < 20; i++) { paused.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16, false); heard.update([route], EmptyFrame, { ...Silent, drums: 0.5 }, 16); }
        for (const r of [paused, heard, fresh]) r.update([route], EmptyFrame, { ...Silent, drums: 0.8 }, 16);
        // the rise 0.3 against the peak held, as a run heard throughout; a fresh route reads 0.8
        expect(paused.values.get(route.id)).toBeGreaterThan(0);
        expect(paused.values.get(route.id)).toBe(heard.values.get(route.id));
        expect(paused.values.get(route.id)).not.toBe(fresh.values.get(route.id));
    });
});

const Silent = { drums: 0, bass: 0, other: 0, vocals: 0 };

describe('audio routing with a non-finite source', () => {
    const Stems = { drums: 0.2, bass: 0.4, other: 0, vocals: 0 };
    const Frames = [0.3, 0.6, 0.1].map(v => ({ ...EmptyFrame, amplitude: v }));
    const routeSet = () => [
        createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 2, floor: 0, releaseMs: 200 }),
        createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'instanceWave', gain: 3, floor: 0, releaseMs: 200 }),
        createAudioRoute({ enabled: true, source: 'amplitude', mode: 'level', target: 'cameraZoom', gain: 1, floor: 0, releaseMs: 200 }),
        createAudioRoute({ enabled: true, source: 'bass', mode: 'level', target: 'wiggle', gain: 1, floor: 0, releaseMs: 200 }),
        // the guard sits before the song average: a NaN must not reach it either
        createAudioRoute({ enabled: true, source: 'songLoudness', mode: 'level', target: 'cameraSpin', gain: 1, floor: 0, releaseMs: 200 }),
    ];
    // the bad frame is silent apart from its non-finite value, so a route that reads it as 0 equals a fresh one
    const Silent = { drums: 0, bass: 0, other: 0, vocals: 0 };
    const bad = {
        'a NaN stem': { frame: EmptyFrame, stems: { ...Silent, drums: NaN, bass: NaN }, dt: 16 },
        'an infinite stem': { frame: EmptyFrame, stems: { ...Silent, drums: Infinity, bass: -Infinity }, dt: 16 },
        'a NaN band and amplitude': { frame: { ...EmptyFrame, amplitude: NaN, frequencyBands: { ...EmptyFrame.frequencyBands, bass: NaN } }, stems: Silent, dt: 16 },
        'a NaN dtMs': { frame: EmptyFrame, stems: Silent, dt: NaN },
    };

    for (const [name, { frame, stems, dt }] of Object.entries(bad)) {
        it(`recovers on the next frame after ${name}, as a fresh route would`, () => {
            const routes = routeSet();
            const router = new AudioRouter();
            const fresh = new AudioRouter();
            router.update(routes, frame, stems, dt);
            for (const t of Object.keys(router.drives) as (keyof typeof router.drives)[]) expect(Number.isFinite(router.drives[t])).toBe(true);
            for (const r of routes) expect(Number.isFinite(router.values.get(r.id)!)).toBe(true);
            for (const f of Frames) {
                router.update(routes, f, Stems, 16);
                fresh.update(routes, f, Stems, 16);
                for (const r of routes) {
                    expect(Number.isFinite(router.values.get(r.id)!)).toBe(true);
                    expect(router.values.get(r.id)).toBeCloseTo(fresh.values.get(r.id)!, 6);
                }
                expect(router.drives).toEqual(fresh.drives);
            }
        });
    }
});

describe('audio affect group span', () => {
    it('maps a model-element interval onto the unit element list', () => {
        const elements = SortedArray.ofSortedArray([0, 1, 2, 5, 6, 7, 10]);
        expect(groupSpanInElements(elements, 5, 8)).toEqual({ start: 3, end: 6 });
        expect(groupSpanInElements(elements, 3, 4)).toBeUndefined();
        expect(groupSpanInElements(elements, 10, 11)).toEqual({ start: 6, end: 7 });
    });

    describe('stem events', () => {
        const NoStems = { drums: 0, bass: 0, other: 0, vocals: 0 };
        const events = (kick: number, live = true): StemEventValues => ({ kick, snare: 0, bassNote: 0, live });

        it('an event source reads its strength on its frame in Level and in Hits, 0 elsewhere', () => {
            expect(isStemEventSource('stemKick') && isStemEventSource('stemSnare') && isStemEventSource('stemBassNote')).toBe(true);
            expect(isStemEventSource('stemDrums')).toBe(false);
            for (const mode of ['level', 'onset'] as const) {
                const router = new AudioRouter();
                const route = createAudioRoute({ enabled: true, source: 'stemKick', mode, target: 'symAxis', gain: 2, floor: 0, releaseMs: 0 });
                const drive: number[] = [];
                // a hit of 0.5, then one of 1 two frames later, nothing between: Hits must keep 2:1, not normalize it away
                for (const k of [0, 0.5, 0, 1, 0]) {
                    router.update([route], EmptyFrame, NoStems, 16, true, events(k));
                    drive.push(router.drives.symAxis);
                }
                expect(drive).toEqual([0, 1, 0, 2, 0]);
            }
        });

        it('Hit threshold rescales (x - t) / (1 - t); 0 is the old math', () => {
            const at = (threshold: number, x: number) => {
                const router = new AudioRouter();
                const route = createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 0, threshold });
                router.update([route], EmptyFrame, { ...NoStems, bass: x }, 16);
                return router.drives.symAxis;
            };
            expect(at(0, 0.3)).toBeCloseTo(0.3);
            expect(at(0.5, 0.3)).toBe(0);
            expect(at(0.5, 0.5)).toBe(0);
            expect(at(0.5, 0.75)).toBeCloseTo(0.5);
            expect(at(0.5, 1)).toBeCloseTo(1);
        });

        it('a stand-in route is muted while events are live and returns when they stop', () => {
            const router = new AudioRouter();
            const standIn = createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 0, standIn: true });
            const stems = { ...NoStems, bass: 0.6 };
            router.update([standIn], EmptyFrame, stems, 16);
            expect(router.drives.symAxis).toBeCloseTo(0.6);
            router.update([standIn], EmptyFrame, stems, 16, true, events(0, true));
            expect(router.drives.symAxis).toBe(0);
            router.update([standIn], EmptyFrame, stems, 16, true, events(0, false));
            expect(router.drives.symAxis).toBeCloseTo(0.6);
            router.update([standIn], EmptyFrame, stems, 16, true, NoStemEvents);
            expect(router.drives.symAxis).toBeCloseTo(0.6);
        });

        it('saved routes without threshold and standIn load as 0 and false; drafts round-trip them', () => {
            const old = parseAudioRouting(JSON.stringify({ name: 'old', routes: [{ source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1 }] }));
            expect(old![0].routes[0].threshold).toBe(0);
            expect(old![0].routes[0].standIn).toBe(false);
            expect(createAudioRoute({ enabled: true, source: 'stemBass', mode: 'level', target: 'symAxis', gain: 1, floor: 0, releaseMs: 0 })).toMatchObject({ threshold: 0, standIn: false });
            const route = createAudioRoute({ enabled: true, source: 'stemKick', mode: 'level', target: 'symAxis', gain: 6.5, floor: 0, releaseMs: 120, threshold: 0.3, standIn: true });
            const parsed = parseAudioRouting(serializeAudioRouting([{ version: 1, name: 'x', routes: draftsFromRoutes([route]) }]));
            expect(parsed![0].routes[0]).toMatchObject({ source: 'stemKick', threshold: 0.3, standIn: true });
            expect(routesFromDrafts(parsed![0].routes)[0]).toMatchObject({ threshold: 0.3, standIn: true });
            // clamped
            const wild = parseAudioRouting(JSON.stringify({ routes: [{ source: 'stemKick', mode: 'level', target: 'symAxis', threshold: 3, standIn: 'yes' }] }));
            expect(wild![0].routes[0]).toMatchObject({ threshold: 0.95, standIn: false });
        });
    });
});
