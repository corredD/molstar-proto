/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import type { VirusOnTheRockApp } from '../app';
import { DefaultAudioUrlPreset, DefaultPdbId } from '../catalog';
import { VirusOnTheRockState } from '../state';
import { AudioCard } from './cards/audio';
import { AudioPresetsCard } from './cards/audio-presets';
import { AudioRoutingCard } from './cards/audio-routing';
import { AxisModeCard } from './cards/axis-mode';
import { ClipReactivityCard } from './cards/clip-reactivity';
import { EntriesCard } from './cards/entries';
import { LoadStructureCard } from './cards/load-structure';
import { MotionTargetsCard } from './cards/motion-targets';
import { ProminenceCard } from './cards/prominence';
import { RepresentationCard } from './cards/representation';
import { SessionCard } from './cards/session';
import { StemSeparationCard } from './cards/stem-separation';
import { VisualizersCard } from './cards/visualizers';
import { ControlCard } from './control-card';
import { useStateSlice } from './state-slice';
import { AudioVisualizerOverlay } from './visualizer-overlay';

export const selectControls = (s: VirusOnTheRockState) => ({
    showSidebar: s.showSidebar,
    showSessionInfo: s.showSessionInfo,
    showWaveformLine: s.showWaveformLine,
    showHistogramBars: s.showHistogramBars,
    showRadialVisualizer: s.showRadialVisualizer,
});

export function VirusOnTheRockControls({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectControls);
    const [pdbId, setPdbId] = React.useState(DefaultPdbId);
    const [audioUrl, setAudioUrl] = React.useState<string>(DefaultAudioUrlPreset.url);

    return <div className='vor-overlay'>
        <AudioVisualizerOverlay
            app={app}
            showWaveformLine={state.showWaveformLine}
            showHistogramBars={state.showHistogramBars}
            showRadialVisualizer={state.showRadialVisualizer}
        />

        {state.showSidebar && <div className='vor-controls'>
            {/* Sidebar header with close button at top-right */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Virus on the Rock</h1>
                <button
                    className="vor-chip vor-toggle-small"
                    onClick={() => app.setSidebarVisible(false)}
                    title="Hide Sidebar"
                    style={{ minWidth: '36px', height: '36px', padding: 0, fontSize: '1.3rem' }}
                >
                    ←
                </button>
            </div>
            <ControlCard className='vor-title'>
                <p>Minimal audio-reactive virus viewer. Drag a structure or audio file anywhere onto the viewport, or use the inputs below.</p>
            </ControlCard>

            <LoadStructureCard app={app} pdbId={pdbId} setPdbId={setPdbId} />

            <AudioCard app={app} audioUrl={audioUrl} setAudioUrl={setAudioUrl} />

            <ControlCard title='Stem Separation'>
                <StemSeparationCard app={app} />
            </ControlCard>

            <ControlCard title='Audio Routing'>
                <AudioRoutingCard app={app} />
            </ControlCard>

            <ProminenceCard app={app} />

            <RepresentationCard app={app} />

            <AudioPresetsCard app={app} />

            <MotionTargetsCard app={app} />

            <ClipReactivityCard app={app} />

            <AxisModeCard app={app} />

            <VisualizersCard app={app} />

            <EntriesCard app={app} />

        </div>}

        {/* EXPAND BUTTON — appears at top-left when sidebar is CLOSED */}
        {!state.showSidebar && (
            <div
                style={{
                    position: 'absolute',
                    top: '18px',
                    left: '18px',
                    zIndex: 40,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    pointerEvents: 'auto'
                }}
            >
                <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Virus on the Rock</h1>

                <button
                    className="vor-chip vor-toggle-small"
                    onClick={() => app.setSidebarVisible(!state.showSidebar)}
                    title={state.showSidebar ? 'Hide Sidebar' : 'Expand Sidebar'}
                    style={{
                        minWidth: '36px',
                        height: '36px',
                        padding: 0,
                        fontSize: '1.3rem',
                        lineHeight: 1
                    }}
                >
                    {state.showSidebar ? '←' : '→'}
                </button>
            </div>
        )}

        {/* Session widget (when open) */}
        {state.showSessionInfo && <div className='vor-status'>
            <SessionCard app={app} />
        </div>}

        {/* Floating "Show Session" button — appears only when closed, bottom-right */}
        {!state.showSessionInfo && (
            <button
                className="vor-chip vor-toggle-small"
                onClick={() => app.setSessionInfoVisible(true)}
                title="Show Session Info"
                style={{
                    position: 'absolute',
                    bottom: '18px',
                    right: '18px',
                    zIndex: 10,
                    minWidth: '36px',
                    height: '36px',
                    padding: 0,
                    fontSize: '1.1rem'
                }}
            >
                i
            </button>
        )}
    </div>;
}
