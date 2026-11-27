/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { VirusOnTheRockApp } from '../../app';
import { VirusOnTheRockState } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectClipReactivity = (s: VirusOnTheRockState) => ({
    audioClipEnabled: s.audioClipEnabled,
    audioClipScale: s.audioClipScale,
});

export function ClipReactivityCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectClipReactivity);
    return <ControlCard title='Clip Reactivity'>
        <div className='vor-stack'>
            <div className='vor-chip-row'>
                <button
                    className={`vor-chip ${!state.audioClipEnabled ? 'vor-active' : ''}`}
                    onClick={() => app.setAudioClipEnabled(false)}
                >
                    Off
                </button>
                <button
                    className={`vor-chip ${state.audioClipEnabled ? 'vor-active' : ''}`}
                    onClick={() => app.setAudioClipEnabled(true)}
                >
                    On
                </button>
            </div>
            <p className='vor-help'>
                When on, clip objects in the scene react to audio. Planes slide along their normal; spheres and cubes expand; cylinders widen.
            </p>
            <div className='vor-slider-group'>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-clip-scale'>Scale</label>
                    <output>{state.audioClipScale.toFixed(2)}</output>
                    <input
                        id='vor-clip-scale'
                        type='range'
                        min='0'
                        max='4'
                        step='0.01'
                        value={state.audioClipScale}
                        onChange={e => app.setAudioClipScale(parseFloat(e.target.value))}
                    />
                </div>
            </div>
        </div>
    </ControlCard>;
}
