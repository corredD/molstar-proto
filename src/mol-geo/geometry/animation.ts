/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ValueCell } from '../../mol-util';
import { ParamDefinition as PD } from '../../mol-util/param-definition';

export type AnimationData = {
    uAtomWiggleEnabled: ValueCell<boolean>,
    uWiggleSpeed: ValueCell<number>,
    uWiggleAmplitude: ValueCell<number>,
    uWiggleFrequency: ValueCell<number>,
    uWiggleMode: ValueCell<number>,
    uInstanceTumbleEnabled: ValueCell<boolean>,
    uTumbleSpeed: ValueCell<number>,
    uTumbleAmplitude: ValueCell<number>,
    uTumbleFrequency: ValueCell<number>,
    uTumbleTranslationMode: ValueCell<number>,
    uTumbleAxisSource: ValueCell<number>,
    uTumbleAxis: ValueCell<number>,
    uAudioWiggleSource: ValueCell<number>,
    uAudioWiggleStrength: ValueCell<number>,
    uAudioWiggleFloor: ValueCell<number>,
    uAudioTumbleSource: ValueCell<number>,
    uAudioTumbleStrength: ValueCell<number>,
    uAudioTumbleFloor: ValueCell<number>,
    uObjectTransformEnabled: ValueCell<boolean>,
    uObjectTransformSpeed: ValueCell<number>,
    uObjectTransformAmplitude: ValueCell<number>,
    uObjectTransformSource: ValueCell<number>,
    uObjectTransformStrength: ValueCell<number>,
    uObjectTransformFloor: ValueCell<number>,
    uObjectTransformMode: ValueCell<number>,
}

export const ObjectTransformModeOptions = [
    ['uniform', 'Uniform'],
    ['spectral', 'Spectral'],
] as const;
export type ObjectTransformModeName = typeof ObjectTransformModeOptions[number][0];

function getObjectTransformModeIndex(mode: ObjectTransformModeName): number {
    switch (mode) {
        case 'uniform': return 0;
        case 'spectral': return 1;
    }
}

export const AudioReactiveSourceOptions = [
    ['off', 'Off'],
    ['amplitude', 'Amplitude'],
    ['peakAmplitude', 'Peak'],
    ['beat', 'Beat'],
    ['mix', 'Mix'],
    ['subBass', 'Sub-bass'],
    ['bass', 'Bass'],
    ['lowMids', 'Low-mids'],
    ['mids', 'Mids'],
    ['highMids', 'High-mids'],
    ['treble', 'Treble'],
    ['dominantFrequency', 'Dominant Freq'],
    ['midsTreble', 'Mids/Treble'],
] as const;
export type AudioReactiveSourceName = typeof AudioReactiveSourceOptions[number][0];

export const TumbleTranslationModeOptions = [
    ['noise', 'Noise'],
    ['axis', 'Axis'],
] as const;
export type TumbleTranslationModeName = typeof TumbleTranslationModeOptions[number][0];

export const TumbleAxisOptions = [
    ['x', 'Local X'],
    ['y', 'Local Y'],
    ['z', 'Local Z'],
] as const;
export type TumbleAxisName = typeof TumbleAxisOptions[number][0];

export const TumbleAxisSourceOptions = [
    ['local', 'Local Axis'],
    ['global', 'Global Axis'],
    ['assembly', 'Assembly Axis'],
] as const;
export type TumbleAxisSourceName = typeof TumbleAxisSourceOptions[number][0];

function getAudioReactiveSourceIndex(source: AudioReactiveSourceName): number {
    switch (source) {
        case 'off': return 0;
        case 'amplitude': return 1;
        case 'peakAmplitude': return 2;
        case 'beat': return 3;
        case 'mix': return 4;
        case 'subBass': return 5;
        case 'bass': return 6;
        case 'lowMids': return 7;
        case 'mids': return 8;
        case 'highMids': return 9;
        case 'treble': return 10;
        case 'dominantFrequency': return 11;
        case 'midsTreble': return 12;
    }
}

function getTumbleTranslationModeIndex(mode: TumbleTranslationModeName): number {
    switch (mode) {
        case 'noise': return 0;
        case 'axis': return 1;
    }
}

function getTumbleAxisIndex(axis: TumbleAxisName): number {
    switch (axis) {
        case 'x': return 0;
        case 'y': return 1;
        case 'z': return 2;
    }
}

function getTumbleAxisSourceIndex(source: TumbleAxisSourceName): number {
    switch (source) {
        case 'local': return 0;
        case 'global': return 1;
        case 'assembly': return 2;
    }
}

export function getAnimationParam() {
    return PD.Group({
        atomWiggleEnabled: PD.Boolean(true, { description: 'Enable per-vertex wiggle motion.' }),
        wiggleMode: PD.Select('position', [['position', 'Position'], ['group', 'Group']] as const, { description: 'Noise seeding mode. Position: spatially correlated (nearby atoms move together). Group: per-group independent noise.' }),
        wiggleSpeed: PD.Numeric(7, { min: 0, max: 10, step: 0.1 }, { description: 'Speed of vertex wiggle animation.' }),
        wiggleAmplitude: PD.Numeric(0, { min: 0, max: 5, step: 0.01 }, { description: 'Amplitude of vertex wiggle animation.' }),
        wiggleFrequency: PD.Numeric(0.2, { min: 0.01, max: 2, step: 0.01 }, { description: 'Spatial frequency of vertex wiggle noise (position mode). Lower values correlate nearby atoms more.' }),
        instanceTumbleEnabled: PD.Boolean(true, { description: 'Enable per-instance tumble and beat-driven translation motion.' }),
        tumbleSpeed: PD.Numeric(1, { min: 0, max: 10, step: 0.1 }, { description: 'Speed of instance tumble animation.' }),
        tumbleAmplitude: PD.Numeric(0, { min: 0, max: 10, step: 0.1 }, { description: 'Amplitude of instance tumble animation. In Ångströms of implied surface displacement.' }),
        tumbleFrequency: PD.Numeric(0.2, { min: 0, max: 2, step: 0.01 }, { description: 'Spatial frequency multiplier for tumble noise.' }),
        tumbleTranslationMode: PD.Select('noise', TumbleTranslationModeOptions, { description: 'Translation mode for instance tumble. Noise keeps Brownian-like motion; Axis oscillates along a selected local instance axis.' }),
        tumbleAxisSource: PD.Select('local', TumbleAxisSourceOptions, { hideIf: p => p.tumbleTranslationMode !== 'axis', description: 'Use either a local instance axis or the selected assembly symmetry axis for axis-based tumble translation.' }),
        tumbleAxis: PD.Select('z', TumbleAxisOptions, { hideIf: p => p.tumbleTranslationMode !== 'axis' || p.tumbleAxisSource !== 'local', description: 'Local instance axis used by axis-based tumble translation.' }),
        audioWiggleSource: PD.Select('off', AudioReactiveSourceOptions, { description: 'Use an analyzed audio value to modulate wiggle amplitude.' }),
        audioWiggleStrength: PD.Numeric(1, { min: 0, max: 5, step: 0.1 }, { hideIf: p => p.audioWiggleSource === 'off', description: 'Scale applied to the selected audio value before multiplying wiggle amplitude.' }),
        audioWiggleFloor: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { hideIf: p => p.audioWiggleSource === 'off', description: 'Minimum normalized wiggle factor when the audio source is quiet.' }),
        audioTumbleSource: PD.Select('off', AudioReactiveSourceOptions, { description: 'Use an analyzed audio value to modulate tumble amplitude.' }),
        audioTumbleStrength: PD.Numeric(1, { min: 0, max: 5, step: 0.1 }, { hideIf: p => p.audioTumbleSource === 'off', description: 'Scale applied to the selected audio value before multiplying tumble amplitude.' }),
        audioTumbleFloor: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }, { hideIf: p => p.audioTumbleSource === 'off', description: 'Minimum normalized tumble factor when the audio source is quiet.' }),
        objectTransformEnabled: PD.Boolean(false, { description: 'Enable coherent whole-object position and rotation motion.' }),
        objectTransformSpeed: PD.Numeric(0.65, { min: 0, max: 5, step: 0.05 }, { hideIf: p => !p.objectTransformEnabled, description: 'Speed of whole-object transform motion.' }),
        objectTransformAmplitude: PD.Numeric(2, { min: 0, max: 8, step: 0.05 }, { hideIf: p => !p.objectTransformEnabled, description: 'Amplitude of whole-object transform motion.' }),
        objectTransformSource: PD.Select('midsTreble', AudioReactiveSourceOptions, { hideIf: p => !p.objectTransformEnabled, description: 'Use an analyzed audio value to modulate whole-object transform motion.' }),
        objectTransformStrength: PD.Numeric(1.2, { min: 0, max: 5, step: 0.1 }, { hideIf: p => !p.objectTransformEnabled || p.objectTransformSource === 'off', description: 'Scale applied to the selected audio value before driving whole-object transform motion.' }),
        objectTransformFloor: PD.Numeric(0.2, { min: 0, max: 1, step: 0.01 }, { hideIf: p => !p.objectTransformEnabled || p.objectTransformSource === 'off', description: 'Minimum normalized transform factor when the audio source is quiet.' }),
        objectTransformMode: PD.Select('uniform', ObjectTransformModeOptions, { hideIf: p => !p.objectTransformEnabled, description: 'Uniform: single audio source drives all translation axes equally. Spectral: X/Y/Z axes respond independently to bass/mids/treble.' }),
    });
}
export type AnimationParam = ReturnType<typeof getAnimationParam>
export type AnimationProps = AnimationParam['defaultValue'];

export function areAnimationPropsEqual(a: AnimationProps, b: AnimationProps): boolean {
    return a.atomWiggleEnabled === b.atomWiggleEnabled
        && a.wiggleMode === b.wiggleMode
        && a.wiggleSpeed === b.wiggleSpeed
        && a.wiggleAmplitude === b.wiggleAmplitude
        && a.wiggleFrequency === b.wiggleFrequency
        && a.instanceTumbleEnabled === b.instanceTumbleEnabled
        && a.tumbleSpeed === b.tumbleSpeed
        && a.tumbleAmplitude === b.tumbleAmplitude
        && a.tumbleFrequency === b.tumbleFrequency
        && a.tumbleTranslationMode === b.tumbleTranslationMode
        && a.tumbleAxisSource === b.tumbleAxisSource
        && a.tumbleAxis === b.tumbleAxis
        && a.audioWiggleSource === b.audioWiggleSource
        && a.audioWiggleStrength === b.audioWiggleStrength
        && a.audioWiggleFloor === b.audioWiggleFloor
        && a.audioTumbleSource === b.audioTumbleSource
        && a.audioTumbleStrength === b.audioTumbleStrength
        && a.audioTumbleFloor === b.audioTumbleFloor
        && a.objectTransformEnabled === b.objectTransformEnabled
        && a.objectTransformSpeed === b.objectTransformSpeed
        && a.objectTransformAmplitude === b.objectTransformAmplitude
        && a.objectTransformSource === b.objectTransformSource
        && a.objectTransformStrength === b.objectTransformStrength
        && a.objectTransformFloor === b.objectTransformFloor
        && a.objectTransformMode === b.objectTransformMode;
}

export function createAnimationValues(props: AnimationProps) {
    return {
        uAtomWiggleEnabled: ValueCell.create(props.atomWiggleEnabled),
        uWiggleSpeed: ValueCell.create(props.wiggleSpeed),
        uWiggleAmplitude: ValueCell.create(props.wiggleAmplitude),
        uWiggleFrequency: ValueCell.create(props.wiggleFrequency),
        uWiggleMode: ValueCell.create(props.wiggleMode === 'position' ? 0 : 1),
        uInstanceTumbleEnabled: ValueCell.create(props.instanceTumbleEnabled),
        uTumbleSpeed: ValueCell.create(props.tumbleSpeed),
        uTumbleAmplitude: ValueCell.create(props.tumbleAmplitude),
        uTumbleFrequency: ValueCell.create(props.tumbleFrequency),
        uTumbleTranslationMode: ValueCell.create(getTumbleTranslationModeIndex(props.tumbleTranslationMode)),
        uTumbleAxisSource: ValueCell.create(getTumbleAxisSourceIndex(props.tumbleAxisSource)),
        uTumbleAxis: ValueCell.create(getTumbleAxisIndex(props.tumbleAxis)),
        uAudioWiggleSource: ValueCell.create(getAudioReactiveSourceIndex(props.audioWiggleSource)),
        uAudioWiggleStrength: ValueCell.create(props.audioWiggleStrength),
        uAudioWiggleFloor: ValueCell.create(props.audioWiggleFloor),
        uAudioTumbleSource: ValueCell.create(getAudioReactiveSourceIndex(props.audioTumbleSource)),
        uAudioTumbleStrength: ValueCell.create(props.audioTumbleStrength),
        uAudioTumbleFloor: ValueCell.create(props.audioTumbleFloor),
        uObjectTransformEnabled: ValueCell.create(props.objectTransformEnabled),
        uObjectTransformSpeed: ValueCell.create(props.objectTransformSpeed),
        uObjectTransformAmplitude: ValueCell.create(props.objectTransformAmplitude),
        uObjectTransformSource: ValueCell.create(getAudioReactiveSourceIndex(props.objectTransformSource)),
        uObjectTransformStrength: ValueCell.create(props.objectTransformStrength),
        uObjectTransformFloor: ValueCell.create(props.objectTransformFloor),
        uObjectTransformMode: ValueCell.create(getObjectTransformModeIndex(props.objectTransformMode)),
    };
}

export function updateAnimationValues(values: AnimationData, props: AnimationProps) {
    ValueCell.updateIfChanged(values.uAtomWiggleEnabled, props.atomWiggleEnabled);
    ValueCell.updateIfChanged(values.uWiggleSpeed, props.wiggleSpeed);
    ValueCell.updateIfChanged(values.uWiggleAmplitude, props.wiggleAmplitude);
    ValueCell.updateIfChanged(values.uWiggleFrequency, props.wiggleFrequency);
    ValueCell.updateIfChanged(values.uWiggleMode, props.wiggleMode === 'position' ? 0 : 1);
    ValueCell.updateIfChanged(values.uInstanceTumbleEnabled, props.instanceTumbleEnabled);
    ValueCell.updateIfChanged(values.uTumbleSpeed, props.tumbleSpeed);
    ValueCell.updateIfChanged(values.uTumbleAmplitude, props.tumbleAmplitude);
    ValueCell.updateIfChanged(values.uTumbleFrequency, props.tumbleFrequency);
    ValueCell.updateIfChanged(values.uTumbleTranslationMode, getTumbleTranslationModeIndex(props.tumbleTranslationMode));
    ValueCell.updateIfChanged(values.uTumbleAxisSource, getTumbleAxisSourceIndex(props.tumbleAxisSource));
    ValueCell.updateIfChanged(values.uTumbleAxis, getTumbleAxisIndex(props.tumbleAxis));
    ValueCell.updateIfChanged(values.uAudioWiggleSource, getAudioReactiveSourceIndex(props.audioWiggleSource));
    ValueCell.updateIfChanged(values.uAudioWiggleStrength, props.audioWiggleStrength);
    ValueCell.updateIfChanged(values.uAudioWiggleFloor, props.audioWiggleFloor);
    ValueCell.updateIfChanged(values.uAudioTumbleSource, getAudioReactiveSourceIndex(props.audioTumbleSource));
    ValueCell.updateIfChanged(values.uAudioTumbleStrength, props.audioTumbleStrength);
    ValueCell.updateIfChanged(values.uAudioTumbleFloor, props.audioTumbleFloor);
    ValueCell.updateIfChanged(values.uObjectTransformEnabled, props.objectTransformEnabled);
    ValueCell.updateIfChanged(values.uObjectTransformSpeed, props.objectTransformSpeed);
    ValueCell.updateIfChanged(values.uObjectTransformAmplitude, props.objectTransformAmplitude);
    ValueCell.updateIfChanged(values.uObjectTransformSource, getAudioReactiveSourceIndex(props.objectTransformSource));
    ValueCell.updateIfChanged(values.uObjectTransformStrength, props.objectTransformStrength);
    ValueCell.updateIfChanged(values.uObjectTransformFloor, props.objectTransformFloor);
    ValueCell.updateIfChanged(values.uObjectTransformMode, getObjectTransformModeIndex(props.objectTransformMode));
}
