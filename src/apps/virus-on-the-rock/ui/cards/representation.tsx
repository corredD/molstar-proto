/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { VirusOnTheRockApp } from '../../app';
import { RepresentationMode } from '../../catalog';
import { VirusOnTheRockState } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectRepresentation = (s: VirusOnTheRockState) => ({
    representationMode: s.representationMode,
});

export function RepresentationCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectRepresentation);
    return <ControlCard title='Representation'>
        <div className='vor-chip-row'>
            {(['spacefill', 'blob-surface'] as RepresentationMode[]).map(mode => <button
                key={mode}
                className={`vor-chip ${state.representationMode === mode ? 'vor-active' : ''}`}
                onClick={() => void app.chooseRepresentationMode(mode)}
                title={mode === 'spacefill'
                    ? 'One impostor sphere per atom with level-of-detail strides.'
                    : 'A single coarse mesh per structure: much less to redraw each frame, but built once on the CPU and without level-of-detail.'}
            >
                {mode === 'spacefill' ? 'Spacefill' : 'Blob Surface'}
            </button>)}
        </div>
    </ControlCard>;
}
