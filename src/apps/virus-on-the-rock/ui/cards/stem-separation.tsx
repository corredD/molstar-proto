/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { useEffect, useState } from 'react';
import { useBehavior } from '../../../../mol-plugin-ui/hooks/use-behavior';
import { type AudioReactiveStatus, getAnalysisLeadSeconds, getAudioDelaySeconds } from '../../../../mol-plugin-state/manager/audio-reactive-animation';
import { StemModelIds, StemModels, type StemName, StemNames } from '../../../../mol-plugin-state/manager/audio-stems/stem-models';
import type { VirusOnTheRockApp } from '../../app';

export const StemMeterColors: Record<StemName, string> = { drums: '#ff7b72', bass: '#79c0ff', other: '#7ee787', vocals: '#d2a8ff' };

export function describeStemStatus(s: AudioReactiveStatus['stemStatus'], separated: boolean) {
    switch (s.state) {
        case 'off': return 'Off: the stems come from the frequency bands.';
        case 'loading': return s.message ?? 'Loading the model...';
        case 'warming': return `${s.message ?? 'Ready'}: separating the first chunk...`;
        case 'error': return `Failed: ${s.message ?? 'unknown error'}. The stems come from the bands.`;
        case 'running': {
            const load = s.loadFactor !== undefined ? `, ${(s.loadFactor * 100).toFixed(0)}% of real time` : '';
            const ahead = s.headroom !== undefined ? `, ${s.headroom.toFixed(1)} s ahead` : '';
            return `${separated ? 'Separating' : 'Behind (bands meanwhile)'} on ${s.executionProvider ?? '?'}${load}${ahead}.`;
        }
    }
}

/**
 * A range input in a slider row that commits on release (pointer up, a key up, blur), not on every step: a new audio
 * delay resets the separator and moves what is heard
 */
function CommitRange({ id, min, max, step, value, commit }: { id: string, min: number, max: number, step: number, value: number, commit: (v: number) => void }) {
    const [current, setCurrent] = useState(value);
    useEffect(() => setCurrent(value), [value]);
    const done = () => { if (current !== value) commit(current); };
    return <input id={id} type='range' min={min} max={max} step={step} value={current}
        onChange={e => setCurrent(parseFloat(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} />;
}

export function StemSeparationCard({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const status = useBehavior(manager.state.status) as AudioReactiveStatus | undefined;
    const params = useBehavior(manager.state.params);
    if (!status || !params) return null;
    const current = params.stemModel;
    const delay = getAudioDelaySeconds(params);
    const leadMs = getAnalysisLeadSeconds(params, status.sampleRate ?? 48_000) * 1000;
    return <div className='vor-stack'>
        <div className='vor-chip-row'>
            {(['off', ...StemModelIds] as const).map(id => <button
                key={id}
                className={`vor-chip ${current === id ? 'vor-active' : ''}`}
                onClick={() => {
                    manager.setParams({ stemModel: id });
                }}
                title={id === 'off' ? 'No separation: the stems come from the frequency bands.' : StemModels[id].description}
            >
                {id === 'off' ? 'Off' : StemModels[id].label}
            </button>)}
        </div>
        <div className='vor-stem-meters'>
            {StemNames.map(stem => <div key={stem} className='vor-stem-meter' title={stem}>
                <span>{stem}</span>
                <div><i style={{ width: `${Math.round(status.stems[stem] * 100)}%`, background: StemMeterColors[stem], opacity: status.stemsSeparated ? 1 : 0.45 }} /></div>
            </div>)}
        </div>
        <p className='vor-help'>{describeStemStatus(status.stemStatus, status.stemsSeparated)}</p>
        <label className='vor-label'>Lookahead</label>
        <div className='vor-chip-row'>
            {([false, true] as const).map(on => <button
                key={`${on}`}
                className={`vor-chip ${params.lookahead === on ? 'vor-active' : ''}`}
                onClick={() => manager.setParams({ lookahead: on })}
                title={on
                    ? 'The analysis reads the audio ahead of what is heard by its own lag, so a hit moves the visuals on the frame it is heard. The audio is delayed to make room.'
                    : 'The analysis reads the audio as it is heard: the visuals follow a hit by the analysis\'s lag.'}
            >
                {on ? 'On' : 'Off'}
            </button>)}
        </div>
        {(current !== 'off' || params.lookahead) && <div className='vor-slider-group'>
            <div className='vor-slider-row' title='How late the audio is heard. 0 uses the default: the model&apos;s with separation on, else 0.25 s.'>
                <label htmlFor='vor-audio-delay'>Audio Delay</label>
                <output>{params.stemDelaySeconds > 0 ? `${params.stemDelaySeconds.toFixed(1)} s` : `Default (${delay.toFixed(2)} s)`}</output>
                <CommitRange id='vor-audio-delay' min={0} max={25} step={0.5} value={params.stemDelaySeconds} commit={v => manager.setParams({ stemDelaySeconds: v })} />
            </div>
            {params.lookahead && <div className='vor-slider-row' title='Milliseconds added to the lookahead: more moves the visuals earlier, less later.'>
                <label htmlFor='vor-lead-trim'>Lead Trim</label>
                <output>{params.lookaheadTrimMs > 0 ? '+' : ''}{params.lookaheadTrimMs} ms</output>
                <CommitRange id='vor-lead-trim' min={-50} max={100} step={1} value={params.lookaheadTrimMs} commit={v => manager.setParams({ lookaheadTrimMs: v })} />
            </div>}
        </div>}
        {delay > 0 && <p className='vor-help'>
            The audio is heard <b>{delay.toFixed(delay < 1 ? 2 : 1)} s</b> late{current !== 'off' ? ' so the stems line up with it' : ''}{params.lookahead ? <>; the analysis runs <b>{leadMs.toFixed(0)} ms</b> ahead of it</> : ''}.
            {current !== 'off' && <> Use the <b>Stem</b> sources (or the Stem Drift preset) to drive the motion by stem.</>}
        </p>}
    </div>;
}
