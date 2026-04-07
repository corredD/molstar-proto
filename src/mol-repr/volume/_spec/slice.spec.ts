/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { OrderedSet, Interval } from '../../../mol-data/int';
import { Grid, Volume } from '../../../mol-model/volume';
import { Mat4 } from '../../../mol-math/linear-algebra';
import { CustomProperties } from '../../../mol-model/custom-property';
import { applySliceObjectLoci, applySlicePixelIntervals, getSliceParams } from '../slice';

function createTestVolume(instanceCount: number, periodic = false, stats: Grid['stats'] = Grid.One.stats): Volume {
    return {
        grid: periodic ? { ...Grid.One, periodicity: 'xyz', stats } : { ...Grid.One, stats },
        instances: Array.from({ length: instanceCount }, () => ({ transform: Mat4.identity() })),
        sourceData: { kind: 'test', name: 'test', data: {} } as any,
        customProperties: new CustomProperties(),
        _propertyData: Object.create(null),
        _localPropertyData: Object.create(null),
    };
}

describe('slice helpers', () => {
    it('applies object loci as displayed plane intervals for contiguous instances', () => {
        const volume = createTestVolume(4);
        const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3));
        const intervals: Array<[number, number]> = [];

        const changed = applySliceObjectLoci(loci, volume, 5, interval => {
            intervals.push([Interval.start(interval), Interval.end(interval)]);
            return true;
        });

        expect(changed).toBe(true);
        expect(intervals).toEqual([[5, 15]]);
    });

    it('applies object loci per displayed instance for discontiguous selections', () => {
        const volume = createTestVolume(4);
        const loci = Volume.Loci(volume, OrderedSet.ofSortedArray([0, 2] as const));
        const intervals: Array<[number, number]> = [];

        const changed = applySliceObjectLoci(loci, volume, 5, interval => {
            intervals.push([Interval.start(interval), Interval.end(interval)]);
            return true;
        });

        expect(changed).toBe(true);
        expect(intervals).toEqual([[0, 5], [10, 15]]);
    });

    it('collapses periodic object loci to the single displayed slice plane', () => {
        const volume = createTestVolume(4, true);
        const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3));
        const intervals: Array<[number, number]> = [];

        const changed = applySliceObjectLoci(loci, volume, 6, interval => {
            intervals.push([Interval.start(interval), Interval.end(interval)]);
            return true;
        });

        expect(changed).toBe(true);
        expect(intervals).toEqual([[0, 6]]);
    });

    it('batches contiguous slice pixels into minimal intervals', () => {
        const intervals: Array<[number, number]> = [];

        const changed = applySlicePixelIntervals([1, 2, 3, 7, 8, 10], 5, interval => {
            intervals.push([Interval.start(interval), Interval.end(interval)]);
            return true;
        });

        expect(changed).toBe(true);
        expect(intervals).toEqual([[6, 9], [12, 14], [15, 16]]);
    });

    it('exposes slice-specific IMOD-style display params', () => {
        const volume = createTestVolume(1, false, { min: -2, max: 6, mean: 1, sigma: 2 });
        const params = getSliceParams({} as any, volume);

        expect(params.levels.isHidden).not.toBe(true);
        expect(params.gamma.isHidden).not.toBe(true);
        expect(params.invert.isHidden).not.toBe(true);
        expect(params.levels.defaultValue).toEqual([0, 255]);
        expect(params.gamma.defaultValue).toBe(1);
        expect(params.invert.defaultValue).toBe(false);
        expect(params.levels.min).toBe(0);
        expect(params.levels.max).toBe(255);
        expect(params.levels.step).toBe(1);
    });
});
