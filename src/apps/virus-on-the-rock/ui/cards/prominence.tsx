/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { useBehavior } from '../../../../mol-plugin-ui/hooks/use-behavior';
import { DefaultAudioBandDefinitions } from '../../../../mol-plugin-state/manager/audio-reactor';
import { AudioProminenceRadar } from '../../../../mol-plugin-ui/controls/audio-prominence-radar';
import { type AudioReactiveStatus } from '../../../../mol-plugin-state/manager/audio-reactive-animation';
import type { VirusOnTheRockApp } from '../../app';
import { ControlCard } from '../control-card';

export function AudioProminenceReadout({ app }: { app: VirusOnTheRockApp }) {
    const status = useBehavior(app.viewer.plugin.managers.audioReactive.state.status) as AudioReactiveStatus | undefined;
    if (!status) return null;

    return <>
        <AudioProminenceRadar
            sources={DefaultAudioBandDefinitions}
            prominence={status.frame.bandProminence}
            level={status.frame.frequencyBands}
            onset={status.frame.bandOnsets}
            size={190}
        />
        <p className='vor-help'>
            {DefaultAudioBandDefinitions.map(b => `${b.label} ${(status.frame.bandProminence[b.key] * 100).toFixed(0)}%`).join(' · ')}
        </p>
    </>;
}

export function ProminenceCard({ app }: { app: VirusOnTheRockApp }) {
    return <ControlCard title='Prominence'>
        <div className='vor-stack'>
            <AudioProminenceReadout app={app} />
            <p className='vor-help'>
                Relative weight of each band, from its level plus a decaying onset peak.
                Tune <b>Onset Weight</b> and <b>Temperature</b> until the shape follows what you hear.
            </p>
        </div>
    </ControlCard>;
}
