/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { VirusOnTheRockApp } from '../../app';
import { VirusOnTheRockState, formatPresetLabel, getAxisStatusLabel } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectSession = (s: VirusOnTheRockState) => ({
    currentStructureLabel: s.currentStructureLabel,
    currentAudioLabel: s.currentAudioLabel,
    audioPlaying: s.audioPlaying,
    activePreset: s.activePreset,
    axisModeEnabled: s.axisModeEnabled,
    axisCycleEnabled: s.axisCycleEnabled,
    activeCycleTarget: s.activeCycleTarget,
    axisOptions: s.axisOptions,
    cycleTargets: s.cycleTargets,
    axisSource: s.axisSource,
    localAxis: s.localAxis,
    hasAssemblyAxes: s.hasAssemblyAxes,
    selectedAxisOrder: s.selectedAxisOrder,
});

export function SessionCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectSession);
    return <ControlCard title='Session' style={{ position: 'relative' }}>
        {/* Close button inside the widget */}
        <button
            className="vor-chip vor-toggle-small"
            onClick={() => app.setSessionInfoVisible(false)}
            title="Hide Session Info"
            style={{
                position: 'absolute',
                top: '14px',
                right: '14px',
                minWidth: '28px',
                height: '28px',
                padding: 0,
                fontSize: '1.1rem'
            }}
        >
            ✕
        </button>

        <p className='vor-status-text'>{state.currentStructureLabel ?? 'No structure loaded yet.'}</p>
        <dl className='vor-status-grid'>
            <div><dt>Audio</dt><dd>{state.currentAudioLabel ?? 'No track loaded'}</dd></div>
            <div><dt>Playback</dt><dd>{state.audioPlaying ? 'Playing' : 'Stopped'}</dd></div>
            <div><dt>Preset</dt><dd>{formatPresetLabel(state.activePreset)}</dd></div>
            <div><dt>Axis Mode</dt><dd>{getAxisStatusLabel(state)}</dd></div>
        </dl>
    </ControlCard>;
}
