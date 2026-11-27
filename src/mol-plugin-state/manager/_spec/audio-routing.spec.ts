/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { SortedArray } from '../../../mol-data/int';
import { groupSpanInElements } from '../../helpers/audio-affect';
import { createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions } from '../audio-reactor';
import { applyAudioRouteCurve, AudioRouter, AudioScopeKinds, createAudioRoute, draftsFromRoutes, maxScopeLevel, parseAudioRouting, sameAudioAffect, serializeAudioRouting } from '../audio-routing';

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
});
