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

export const selectMotionTargets = (s: VirusOnTheRockState) => ({
    atomWiggleEnabled: s.atomWiggleEnabled,
    instanceTumbleEnabled: s.instanceTumbleEnabled,
    objectTransformEnabled: s.objectTransformEnabled,
    objectTransformMode: s.objectTransformMode,
    lodScaleEnabled: s.lodScaleEnabled,
    beatThreshold: s.beatThreshold,
    wiggleEffectScale: s.wiggleEffectScale,
    tumbleEffectScale: s.tumbleEffectScale,
    objectTransformEffectScale: s.objectTransformEffectScale,
    assemblyAxisAmplitudeScale: s.assemblyAxisAmplitudeScale,
});

export function MotionTargetsCard({ app }: { app: VirusOnTheRockApp }) {
    const state = useStateSlice(app, selectMotionTargets);
    return <ControlCard title='Motion Targets'>
        <div className='vor-chip-row'>
            <button
                className={`vor-chip ${state.atomWiggleEnabled ? 'vor-active' : ''}`}
                onClick={() => void app.setMotionTargetEnabled('atomWiggleEnabled', !state.atomWiggleEnabled)}
            >
                Atom Wiggle
            </button>
            <button
                className={`vor-chip ${state.instanceTumbleEnabled ? 'vor-active' : ''}`}
                onClick={() => void app.setMotionTargetEnabled('instanceTumbleEnabled', !state.instanceTumbleEnabled)}
            >
                Instance Beats
            </button>
            <button
                className={`vor-chip ${state.objectTransformEnabled ? 'vor-active' : ''}`}
                onClick={() => void app.setMotionTargetEnabled('objectTransformEnabled', !state.objectTransformEnabled)}
            >
                Whole Object
            </button>
        </div>

        {state.objectTransformEnabled && <div className='vor-chip-row'>
            <button
                className={`vor-chip ${state.objectTransformMode !== 'spectral' ? 'vor-active' : ''}`}
                onClick={() => void app.setObjectTransformMode('uniform')}
                title='All axes move with equal amplitude driven by a single audio source.'
            >
                Uniform
            </button>
            <button
                className={`vor-chip ${state.objectTransformMode === 'spectral' ? 'vor-active' : ''}`}
                onClick={() => void app.setObjectTransformMode('spectral')}
                title='X/Y/Z axes respond independently to bass / mids / treble.'
            >
                Spectral
            </button>
        </div>}

        <details className='vor-disclosure'>
            <summary>
                <span>Effect Sensitivity</span>
                <span className='vor-disclosure-state vor-collapsed-label'>Expand</span>
                <span className='vor-disclosure-state vor-expanded-label'>Collapse</span>
            </summary>
            <div className='vor-chip-row'>
                <button
                    className={`vor-chip ${!state.lodScaleEnabled ? 'vor-active' : ''}`}
                    onClick={() => app.setLodScaleEnabled(false)}
                >
                    LOD Scale Off
                </button>
                <button
                    className={`vor-chip ${state.lodScaleEnabled ? 'vor-active' : ''}`}
                    onClick={() => app.setLodScaleEnabled(true)}
                >
                    LOD Scale On
                </button>
            </div>
            <p className='vor-help'>
                When on, all motion amplitudes scale with camera distance so animation stays visible when zoomed out. The farther you zoom, the larger the motion in world space.
            </p>
            <div className='vor-slider-group'>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-beat-threshold'>Beat Threshold</label>
                    <output>{state.beatThreshold.toFixed(2)}</output>
                    <input
                        id='vor-beat-threshold'
                        type='range'
                        min='0'
                        max='2'
                        step='0.01'
                        value={state.beatThreshold}
                        onChange={e => app.setBeatThreshold(parseFloat(e.target.value))}
                    />
                </div>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-wiggle-scale'>Atom Wiggle Sensitivity</label>
                    <output>{state.wiggleEffectScale.toFixed(2)}</output>
                    <input
                        id='vor-wiggle-scale'
                        type='range'
                        min='0'
                        max='16'
                        step='0.05'
                        value={state.wiggleEffectScale}
                        onChange={e => app.setEffectScale('wiggleEffectScale', parseFloat(e.target.value))}
                    />
                </div>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-tumble-scale'>Instance Beat Sensitivity</label>
                    <output>{state.tumbleEffectScale.toFixed(2)}</output>
                    <input
                        id='vor-tumble-scale'
                        type='range'
                        min='0'
                        max='200'
                        step='0.05'
                        value={state.tumbleEffectScale}
                        onChange={e => app.setEffectScale('tumbleEffectScale', parseFloat(e.target.value))}
                    />
                </div>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-object-scale'>Whole Object Sensitivity</label>
                    <output>{state.objectTransformEffectScale.toFixed(2)}</output>
                    <input
                        id='vor-object-scale'
                        type='range'
                        min='0'
                        max='32'
                        step='0.05'
                        value={state.objectTransformEffectScale}
                        onChange={e => app.setEffectScale('objectTransformEffectScale', parseFloat(e.target.value))}
                    />
                </div>
                <div className='vor-slider-row'>
                    <label htmlFor='vor-axis-scale'>Axis Amplitude Sensitivity</label>
                    <output>{state.assemblyAxisAmplitudeScale.toFixed(2)}</output>
                    <input
                        id='vor-axis-scale'
                        type='range'
                        min='0'
                        max='200'
                        step='0.05'
                        value={state.assemblyAxisAmplitudeScale}
                        onChange={e => app.setEffectScale('assemblyAxisAmplitudeScale', parseFloat(e.target.value))}
                    />
                </div>
            </div>

        </details>
    </ControlCard>;
}
