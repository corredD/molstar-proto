/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StemSeparator } from '../stem-separator';

const Names = ['drums', 'bass', 'other', 'vocals'];

describe('stem separator', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
        it(`keeps its levels finite after one worker energy of ${bad}`, () => {
            // the constructor only stores its arguments: no audio context needed
            const sep: any = new StemSeparator({} as any, {} as any, {} as any, () => { });
            sep.model = 'htdemucs';
            const post = (times: number[], e: (s: string, i: number) => number) => sep.onWorkerMessage({
                type: 'stems', model: 'htdemucs', times: Float64Array.from(times), computeMs: 1, audioMs: 1,
                energies: Object.fromEntries(Names.map(s => [s, Float32Array.from(times.map((_, i) => e(s, i)))])),
            });
            post([0, 0.1, 0.2], (s, i) => s === 'bass' && i === 1 ? bad : 0.01);
            post([0.3, 0.4, 0.5, 0.6, 0.7], () => 0.01);
            for (const t of [0.05, 0.35, 0.65]) {
                for (const v of Object.values(sep.sample(t, 16, 20, 180) as Record<string, number>)) expect(Number.isFinite(v)).toBe(true);
            }
            // after the bad frame left the interpolation, the quiet stems are not stuck at 0
            const levels = sep.sample(0.65, 16, 20, 180) as Record<string, number>;
            expect(levels.drums).toBeGreaterThan(0);
        });
    }
});
