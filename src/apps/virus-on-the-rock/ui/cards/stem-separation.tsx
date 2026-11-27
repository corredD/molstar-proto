/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { useBehavior } from '../../../../mol-plugin-ui/hooks/use-behavior';
import { type AudioReactiveStatus, getStemDelaySeconds } from '../../../../mol-plugin-state/manager/audio-reactive-animation';
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

export function StemSeparationCard({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const status = useBehavior(manager.state.status) as AudioReactiveStatus | undefined;
    const params = useBehavior(manager.state.params);
    if (!status || !params) return null;
    const current = params.stemModel;
    return <div className='vor-stack'>
        <div className='vor-chip-row'>
            {(['off', ...StemModelIds] as const).map(id => <button
                key={id}
                className={`vor-chip ${current === id ? 'vor-active' : ''}`}
                onClick={() => {
                    manager.setParams({ stemModel: id });
                }}
                title={id === 'off' ? 'No separation: the stems come from the frequency bands, with no delay.' : StemModels[id].description}
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
        {current !== 'off' && <p className='vor-help'>
            The audio is heard <b>{getStemDelaySeconds(params).toFixed(1)} s</b> late so the stems line up with it.
            Use the <b>Stem</b> sources (or the Stem Drift preset) to drive the motion by stem.
        </p>}
    </div>;
}
