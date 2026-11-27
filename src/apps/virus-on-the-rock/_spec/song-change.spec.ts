/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { getDefaultAudioRoutes } from '../../../mol-plugin-state/manager/audio-routing';
import { runAudioPipeline, songMix } from '../../../mol-plugin-state/manager/_spec/audio-pipeline-helper';
import { balanceShift, feedSongDetector, SongChangeDetector, SongChangeParams, SongChangeReason } from '../song-change';

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

describe('song change fed from the audio status (the app\'s feed)', () => {
    /** a song playing for 80 s, paused 3-5 s and resumed, heard `latency` late; the changes the status feed finds */
    function resumeRun(latency: number) {
        const found: SongChangeReason[] = [];
        const detector = new SongChangeDetector(r => found.push(r));
        (detector as unknown as { sinceChangeMs: number }).sinceChangeMs = 80000;
        let sub: { unsubscribe(): void } | undefined, lastFeedMs = 0;
        runAudioPipeline(songMix(), getDefaultAudioRoutes(), {
            paused: [[3, 5]], outputLatency: latency, durationS: 8,
            onFrame: ({ index, manager: m }) => {
                if (index !== 0) return;
                sub = m.state.status.subscribe(s => {
                    lastFeedMs = feedSongDetector(detector, s, (m as unknown as { lastTickMs: number }).lastTickMs, lastFeedMs);
                });
            },
        });
        sub?.unsubscribe();
        return found;
    }

    it('a resume heard 0.7 s late is not a gap between songs (the silence still heard is not fed as playing)', () => {
        expect(resumeRun(0.7)).toEqual([]);
    });

    it('latency 0: a 2 s pause is not a gap either (unchanged)', () => {
        expect(resumeRun(0)).toEqual([]);
    });
});
