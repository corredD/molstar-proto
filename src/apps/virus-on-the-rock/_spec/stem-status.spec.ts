/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describeStemStatus } from '../ui/cards/stem-status';

describe('stem status line', () => {
    const running = { state: 'running' as const, executionProvider: 'webgpu' as const, loadFactor: 1.27, headroom: 7.4 };

    it('says how much audio the last run lost while the model falls behind, and nothing when it keeps up', () => {
        expect(describeStemStatus({ ...running, lostMs: 1400 }, true)).toContain('behind: 1.4 s lost per run');
        expect(describeStemStatus({ ...running, lostMs: 0 }, true)).not.toContain('lost');
        expect(describeStemStatus(running, true)).not.toContain('lost');
    });
});
