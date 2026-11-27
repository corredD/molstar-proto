/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { VirusOnTheRockApp } from '../../app';
import { LocalAxisOptions, VirusOnTheRockState, getAxisCycleOptions, getEnabledCycleOptions } from '../../state';
import { ControlCard } from '../control-card';
import { useStateSlice } from '../state-slice';

export const selectAxisMode = (s: VirusOnTheRockState) => ({
    axisModeEnabled: s.axisModeEnabled,
    axisSource: s.axisSource,
    localAxis: s.localAxis,
    hasAssemblyAxes: s.hasAssemblyAxes,
    axisCycleEnabled: s.axisCycleEnabled,
    axisOptions: s.axisOptions,
    selectedAxisOrder: s.selectedAxisOrder,
    cycleTargets: s.cycleTargets,
    axisCycleEvery: s.axisCycleEvery,
});

export function AxisModeCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectAxisMode);
    return <ControlCard title='Axis Mode'>
        <div className='vor-stack'>
            <div className='vor-chip-row'>
                <button
                    className={`vor-chip ${!state.axisModeEnabled ? 'vor-active' : ''}`}
                    onClick={() => void app.setAxisModeEnabled(false)}
                >
                    Off
                </button>
                <button
                    className={`vor-chip ${state.axisModeEnabled ? 'vor-active' : ''}`}
                    onClick={() => void app.setAxisModeEnabled(true)}
                >
                    On
                </button>
            </div>

            {state.axisModeEnabled && <>
                <div className='vor-chip-row'>
                    {LocalAxisOptions.map(option => <button
                        key={option.value}
                        className={`vor-chip ${state.axisSource !== 'assembly' && state.localAxis === option.value ? 'vor-active' : ''}`}
                        onClick={() => void app.setLocalAxis(option.value)}
                    >
                        {option.label}
                    </button>)}
                    <button
                        className={`vor-chip ${state.axisSource === 'assembly' ? 'vor-active' : ''}`}
                        onClick={() => void app.setAssemblyAxisSource()}
                        disabled={!state.hasAssemblyAxes}
                    >
                        Assembly
                    </button>
                </div>

                {state.axisSource !== 'assembly' && <div className='vor-chip-row'>
                    <button
                        className={`vor-chip ${state.axisSource === 'local' ? 'vor-active' : ''}`}
                        onClick={() => void app.setAxisFrame('local')}
                    >
                        Local
                    </button>
                    <button
                        className={`vor-chip ${state.axisSource === 'global' ? 'vor-active' : ''}`}
                        onClick={() => void app.setAxisFrame('global')}
                    >
                        Global
                    </button>
                </div>}

                <div className='vor-chip-row'>
                    <button
                        className={`vor-chip ${!state.axisCycleEnabled ? 'vor-active' : ''}`}
                        onClick={() => void app.setCycleEnabled(false)}
                    >
                        Manual
                    </button>
                    <button
                        className={`vor-chip ${state.axisCycleEnabled ? 'vor-active' : ''}`}
                        onClick={() => void app.setCycleEnabled(true)}
                        disabled={getEnabledCycleOptions(state).length <= 1}
                    >
                        Beat Cycle
                    </button>
                </div>

                {state.axisSource === 'assembly' && state.hasAssemblyAxes && !state.axisCycleEnabled && <div className='vor-chip-row'>
                    {state.axisOptions.map(option => <button
                        key={option.value}
                        className={`vor-chip ${state.selectedAxisOrder === option.value ? 'vor-active' : ''}`}
                        onClick={() => void app.setAxisOrder(option.value)}
                    >
                        {option.label}
                    </button>)}
                </div>}

                <div className='vor-stack'>
                    <label className='vor-label'>Cycle Uses</label>
                    <div className='vor-chip-row'>
                        {getAxisCycleOptions(state.axisOptions).map(option => <button
                            key={option.value}
                            className={`vor-chip ${state.cycleTargets.includes(option.value) ? 'vor-active' : ''}`}
                            onClick={() => void app.toggleCycleTarget(option.value)}
                        >
                            {option.label}
                        </button>)}
                    </div>
                </div>

                <div className='vor-slider-group'>
                    <div className='vor-slider-row'>
                        <label htmlFor='vor-axis-cycle-every'>Cycle Every N Beats</label>
                        <output>{state.axisCycleEvery}</output>
                        <input
                            id='vor-axis-cycle-every'
                            type='range'
                            min='1'
                            max='8'
                            step='1'
                            value={state.axisCycleEvery}
                            onChange={e => app.setCycleEvery(parseInt(e.target.value, 10))}
                            disabled={!state.axisCycleEnabled}
                        />
                    </div>
                </div>
                <p className='vor-help'>
                    {state.axisCycleEnabled
                        ? 'Beat Cycle steps through the selected Cycle Uses chips on every Nth detected beat.'
                        : 'Source chips control the manual axis. Cycle Uses defines which X/Y/Z and assembly axes Beat Cycle will step through.'}
                </p>

                {!state.hasAssemblyAxes && <p className='vor-help'>
                    No assembly symmetry axes are available on the current structure, but signed X/Y/Z world-axis motion is still available.
                </p>}
            </>}
        </div>
    </ControlCard>;
}
