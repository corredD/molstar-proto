/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import type { VirusOnTheRockApp } from '../../app';
import { AudioUrlPresets, DefaultAudioFallbackLabel, DefaultAudioLabel } from '../../catalog';
import { VirusOnTheRockState } from '../../state';
import { AudioAnalysisWarning } from './audio-routing';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectAudio = (s: VirusOnTheRockState) => ({
    audioPlaying: s.audioPlaying,
    audioLoaded: s.audioLoaded,
});

export function AudioCard({ app, audioUrl, setAudioUrl }: { app: VirusOnTheRockApp, audioUrl: string, setAudioUrl: React.Dispatch<React.SetStateAction<string>> }) {
    const state = useStateSlice(app, selectAudio);
    const selectedAudioPreset = AudioUrlPresets.find(preset => preset.url === audioUrl);

    const onAudioFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) await app.loadAudioFile(file);
        event.target.value = '';
    };

    return <ControlCard title='Audio'>
        <div className='vor-stack'>
            <label className='vor-label' htmlFor='vor-audio-file'>Audio File</label>
            <input id='vor-audio-file' className='vor-file' type='file' accept='.mp3,audio/*' onChange={onAudioFileChange} />
            <label className='vor-label' htmlFor='vor-audio-url-preset'>Audio Source</label>
            <select
                id='vor-audio-url-preset'
                className='vor-select'
                value={selectedAudioPreset?.url ?? ''}
                onChange={e => {
                    if (e.target.value) setAudioUrl(e.target.value);
                }}
            >
                {!selectedAudioPreset && <option value=''>Custom URL</option>}
                {AudioUrlPresets.map(preset => <option key={preset.url} value={preset.url}>{preset.label}</option>)}
            </select>
            <label className='vor-label' htmlFor='vor-audio-url'>Audio URL</label>
            <div className='vor-row'>
                <input
                    id='vor-audio-url'
                    className='vor-input'
                    value={audioUrl}
                    onChange={e => setAudioUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void app.loadAudioUrl(audioUrl, selectedAudioPreset?.label); }}
                    placeholder='https://example.org/audio.mp3'
                />
                <button className='vor-button vor-primary' onClick={() => void app.loadAudioUrl(audioUrl, selectedAudioPreset?.label)}>Load URL</button>
            </div>
            <div className='vor-button-row'>
                <button
                    className='vor-button vor-primary'
                    onClick={() => state.audioPlaying ? app.pauseAudio() : void app.playAudio()}
                    disabled={!state.audioLoaded}
                >
                    {state.audioPlaying ? 'Pause Current' : 'Play Current'}
                </button>
            </div>
            <AudioAnalysisWarning app={app} />
            <p className='vor-help'>
                Streams <b>{DefaultAudioLabel}</b> on start and falls back to <b>{DefaultAudioFallbackLabel}</b> if it cannot be reached. Autoplay may be blocked until you interact with the page — use Play Current then. Remote URLs must allow browser media playback with CORS; HTTPS pages can also block HTTP streams.
            </p>
        </div>
    </ControlCard>;
}
