/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { balanceShift, SongChangeDetector, SongChangeParams, SongChangeReason } from '../song-change';

const FrameMs = 33;

/** feeds `seconds` of frames with these band levels and loudness; returns the changes found */
function play(detector: SongChangeDetector, seconds: number, bands: number[], loudness = 0.3) {
    for (let t = 0; t < seconds * 1000; t += FrameMs) detector.feed(bands, loudness, FrameMs);
}

describe('song change', () => {
    const bassy = [0.6, 0.8, 0.3, 0.2, 0.1, 0.05];
    const bright = [0.05, 0.1, 0.2, 0.4, 0.7, 0.6];

    it('finds a gap of silence between two songs, not before the minimum song length', () => {
        const found: SongChangeReason[] = [];
        const d = new SongChangeDetector(r => found.push(r));
        play(d, 10, bassy);
        play(d, 1, bassy, 0);
        play(d, 2, bassy);
        expect(found).toEqual([]);
        play(d, SongChangeParams.minSongMs / 1000, bassy);
        play(d, 1, bassy, 0);
        play(d, 1, bassy);
        expect(found).toEqual(['gap']);
    });

    it('finds a lasting shift of the spectrum balance, and not the same song going on', () => {
        const found: SongChangeReason[] = [];
        const d = new SongChangeDetector(r => found.push(r));
        play(d, SongChangeParams.minSongMs / 1000 + 30, bassy);
        expect(found).toEqual([]);
        play(d, 15, bright);
        expect(found).toEqual(['shift']);
    });

    it('measures the shift as a normalized L1 between the two windows', () => {
        const a = Float32Array.from([0.5, 0.5]), b = Float32Array.from([1, 0]);
        expect(balanceShift([a, a, b], 1, 1, 1)).toBeCloseTo(1);
        expect(balanceShift([a, a, a], 1, 1, 1)).toBe(0);
    });
});
