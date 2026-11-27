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

export const selectVisualizers = (s: VirusOnTheRockState) => ({
    showHistogramBars: s.showHistogramBars,
    showWaveformLine: s.showWaveformLine,
    showRadialVisualizer: s.showRadialVisualizer,
});

export function VisualizersCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectVisualizers);
    return <ControlCard title='Visualizers'>
        <div className='vor-stack'>
            <div className='vor-chip-row'>
                <button
                    className={`vor-chip ${state.showHistogramBars ? 'vor-active' : ''}`}
                    onClick={() => app.setHistogramBarsVisible(!state.showHistogramBars)}
                >
                    {state.showHistogramBars ? 'Histogram On' : 'Histogram Off'}
                </button>
                <button
                    className={`vor-chip ${state.showWaveformLine ? 'vor-active' : ''}`}
                    onClick={() => app.setWaveformLineVisible(!state.showWaveformLine)}
                >
                    {state.showWaveformLine ? 'Wave Line On' : 'Wave Line Off'}
                </button>
                <button
                    className={`vor-chip ${state.showRadialVisualizer ? 'vor-active' : ''}`}
                    onClick={() => app.setRadialVisualizerVisible(!state.showRadialVisualizer)}
                >
                    {state.showRadialVisualizer ? 'Circle On' : 'Circle Off'}
                </button>
            </div>
            <p className='vor-help'>
                Use these toggles to show or hide the waveform line and the radial ring. The radial ring can be dragged directly in the viewport, and the outer handle scales it.
            </p>
        </div>
    </ControlCard>;
}
