/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactivePresetDefinitions } from '../../../../mol-plugin-state/helpers/audio-reactive-presets';
import type { VirusOnTheRockApp } from '../../app';
import { FeaturedPresetNames } from '../../catalog';
import { VirusOnTheRockState, formatPresetLabel } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectAudioPresets = (s: VirusOnTheRockState) => ({
    activePreset: s.activePreset,
});

export function AudioPresetsCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectAudioPresets);
    return <ControlCard title='Audio Presets'>
        <div className='vor-chip-row'>
            {FeaturedPresetNames.map(name => <button
                key={name}
                className={`vor-chip ${state.activePreset === name ? 'vor-active' : ''}`}
                onClick={() => void app.applyAudioPreset(name)}
                title={AudioReactivePresetDefinitions.find(preset => preset.name === name)?.description}
            >
                {formatPresetLabel(name)}
            </button>)}
        </div>
    </ControlCard>;
}
