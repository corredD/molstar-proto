/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { SortedArray } from '../../../mol-data/int';
import { groupSpanInElements } from '../../helpers/audio-affect';
import { createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions } from '../audio-reactor';
import { AudioRouter, createAudioRoute, parseAudioRouting, sameAudioAffect, serializeAudioRouting } from '../audio-routing';

const EmptyFrame = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);

describe('audio routing', () => {
    it('sends a stem to the instance-wave channel', () => {
        const router = new AudioRouter();
        const route = createAudioRoute({
            enabled: true, source: 'stemDrums', mode: 'level', target: 'instanceWave', gain: 2, floor: 0, releaseMs: 0,
        });
        router.update([route], EmptyFrame, { drums: 0.5, bass: 0, other: 0, vocals: 0 }, 16);
        expect(router.drives.instanceWave).toBeCloseTo(1);
        expect(router.drives.symAxis).toBe(0);
    });

    it('round-trips a routing preset and drops a route it does not know', () => {
        const text = serializeAudioRouting([{
            version: 1,
            name: 'Kick wave',
            routes: [{ enabled: true, source: 'stemDrums', mode: 'onset', target: 'instanceWave', gain: 6, floor: 0, releaseMs: 280 }],
            affect: { level: 'chain', entryId: '6Q3Q', modelNum: 1, entityId: '1', operatorName: '1', asymId: 'A' },
        }]);
        const parsed = parseAudioRouting(text);
        expect(parsed).toHaveLength(1);
        expect(parsed![0].name).toBe('Kick wave');
        expect(parsed![0].routes[0].target).toBe('instanceWave');
        expect(sameAudioAffect(parsed![0].affect, { level: 'chain', entryId: '6Q3Q', modelNum: 1, entityId: '1', operatorName: '1', asymId: 'A' })).toBe(true);

        const dirty = JSON.stringify({
            name: 'Broken',
            routes: [
                { enabled: true, source: 'nope', mode: 'level', target: 'instanceWave', gain: 1, floor: 0, releaseMs: 1 },
                { enabled: true, source: 'stemBass', mode: 'level', target: 'wiggle', gain: 1, floor: 0, releaseMs: 10 },
            ],
            affect: { level: 'nope' },
        });
        const kept = parseAudioRouting(dirty);
        expect(kept).toHaveLength(1);
        expect(kept![0].routes).toHaveLength(1);
        expect(kept![0].routes[0].source).toBe('stemBass');
        expect(kept![0].affect.level).toBe('all');
        expect(parseAudioRouting('not json')).toBeUndefined();

        // the Export button writes one preset object, not the library wrapper
        const exported = parseAudioRouting(JSON.stringify({
            version: 1, name: 'Exported',
            routes: [{ enabled: true, source: 'stemVocals', mode: 'level', target: 'instanceWave', gain: 80, floor: -1, releaseMs: 100 }],
            affect: { level: 'atom', entityId: '1', asymId: 'A', seqId: 12, atomId: 'CA' },
        }));
        expect(exported?.[0].name).toBe('Exported');
        expect(exported?.[0].routes[0].gain).toBe(40);
        expect(exported?.[0].routes[0].floor).toBe(0);
        expect(exported?.[0].affect.atomId).toBe('CA');
    });
});

describe('audio affect group span', () => {
    it('maps a model-element interval onto the unit element list', () => {
        const elements = SortedArray.ofSortedArray([0, 1, 2, 5, 6, 7, 10]);
        expect(groupSpanInElements(elements, 5, 8)).toEqual({ start: 3, end: 6 });
        expect(groupSpanInElements(elements, 3, 4)).toBeUndefined();
        expect(groupSpanInElements(elements, 10, 11)).toEqual({ start: 6, end: 7 });
    });
});
