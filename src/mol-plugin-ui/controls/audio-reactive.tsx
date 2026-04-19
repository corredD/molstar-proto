/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { ChangeEvent, useContext, useEffect, useRef } from 'react';
import { DefaultAudioBandDefinitions } from '../../mol-plugin-state/manager/audio-reactor';
import { AudioReactiveAnimationManagerParams } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { PluginReactContext } from '../base';
import { useBehavior } from '../hooks/use-behavior';
import { Button } from './common';
import { ParameterControls } from './parameters';

function formatFrequency(value?: number) {
    if (value === void 0 || !isFinite(value)) return '0 Hz';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
    return `${value.toFixed(0)} Hz`;
}

export function AudioReactiveAnimationControls() {
    const plugin = useContext(PluginReactContext);
    const parent = useRef<HTMLDivElement>(null);
    const audio = useBehavior(plugin?.managers.audioReactive.state.audioPlayer);
    const status = useBehavior(plugin?.managers.audioReactive.state.status);
    const params = useBehavior(plugin?.managers.audioReactive.state.params);

    useEffect(() => {
        if (!parent.current || !audio) return;
        parent.current.appendChild(audio);
        return () => { audio?.remove(); };
    }, [audio]);

    if (!plugin || !status || !params) return null;

    const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            await plugin.managers.audioReactive.loadFile(file);
            await plugin.managers.audioReactive.play();
        } catch (e) {
            plugin.log.error(`Failed to load audio: ${e}`);
        } finally {
            event.target.value = '';
        }
    };

    const disabled = !status.loaded;
    const frame = status.frame;

    return <div className='msp-control-group-wrapper'>
        <div className='msp-control-group-header'><div><b>Audio Reactive</b></div></div>
        <div className='msp-flex-row'>
            <input type='file' accept='.mp3,audio/*' onChange={onFileChange} />
        </div>
        <div className='msp-flex-row'>
            <Button onClick={() => plugin.managers.audioReactive.play()} disabled={disabled}>Play</Button>
            <Button onClick={() => plugin.managers.audioReactive.pause()} disabled={disabled}>Pause</Button>
            <Button onClick={() => plugin.managers.audioReactive.stop()} disabled={disabled}>Stop</Button>
            <Button onClick={() => plugin.managers.audioReactive.clear()} disabled={disabled}>Clear</Button>
        </div>
        <div ref={parent} />
        <ParameterControls
            params={AudioReactiveAnimationManagerParams}
            values={params}
            onChangeValues={values => plugin.managers.audioReactive.setParams(values)}
        />
        {status.sourceLabel && <div className='msp-help-text'>{status.sourceLabel}</div>}
        <div className='msp-help-text'>
            {`Amp ${frame.amplitude.toFixed(2)} (${frame.raw.amplitude.toFixed(2)} raw) | Peak ${frame.peakAmplitude.toFixed(2)} | Beat ${frame.beatIntensity.toFixed(2)} (${frame.raw.beatIntensity.toFixed(2)} raw) | Dominant ${formatFrequency(frame.dominantFrequency)} | Mix ${frame.mix.toFixed(2)}`}
        </div>
        <div className='msp-help-text'>
            {`Wiggle ${params.wiggleEffectScale.toFixed(2)} | Tumble ${params.tumbleEffectScale.toFixed(2)} | FFT ${params.fftSize} | Sample Rate ${status.sampleRate ? `${Math.round(status.sampleRate)} Hz` : 'n/a'} | Playing ${status.playing ? 'yes' : 'no'}`}
        </div>
        <div className='msp-help-text'>
            {DefaultAudioBandDefinitions.map(band => `${band.label} ${frame.frequencyBands[band.key].toFixed(2)} (${frame.raw.frequencyBands[band.key].toFixed(2)} raw)`).join(' | ')}
        </div>
        {status.error && <div className='msp-help-text'>{status.error}</div>}
    </div>;
}
