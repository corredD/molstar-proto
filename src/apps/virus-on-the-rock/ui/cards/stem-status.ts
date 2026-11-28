/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { StemSeparatorStatus } from '../../../../mol-plugin-state/manager/audio-stems/stem-separator';

export function describeStemStatus(s: StemSeparatorStatus, separated: boolean) {
    switch (s.state) {
        case 'off': return 'Off: the stems come from the frequency bands.';
        case 'loading': return s.message ?? 'Loading the model...';
        case 'warming': return `${s.message ?? 'Ready'}: separating the first chunk...`;
        case 'error': return `Failed: ${s.message ?? 'unknown error'}. The stems come from the bands.`;
        case 'running': {
            const load = s.loadFactor !== undefined ? `, ${(s.loadFactor * 100).toFixed(0)}% of real time` : '';
            const ahead = s.headroom !== undefined ? `, ${s.headroom.toFixed(1)} s ahead` : '';
            const lost = s.lostMs ? ` (behind: ${(s.lostMs / 1000).toFixed(1)} s lost per run)` : '';
            return `${separated ? 'Separating' : 'Behind (bands meanwhile)'} on ${s.executionProvider ?? '?'}${load}${ahead}${lost}.`;
        }
    }
}
