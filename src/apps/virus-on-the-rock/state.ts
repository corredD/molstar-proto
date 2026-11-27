/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AssemblySymmetryData, AssemblySymmetryValue } from '../../extensions/assembly-symmetry/prop';
import { AudioReactivePresetDefinitions, AudioReactivePresetName } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { AudioReactiveAnimationManagerValues } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { AudioReactiveAssemblyAxisOrder } from '../../mol-plugin-state/helpers/assembly-symmetry-axis';
import { type AnimationProps, type ObjectTransformModeName, type TumbleAxisName, type TumbleAxisSourceName } from '../../mol-geo/geometry/animation';
import { DefaultPresetName, DefaultRepresentationMode, RepresentationMode } from './catalog';

export type AxisOption = {
    value: AudioReactiveAssemblyAxisOrder,
    label: string,
};

export type AxisCycleTarget = `local:${TumbleAxisName}` | `assembly:${AudioReactiveAssemblyAxisOrder}`;

export type AxisCycleOption = {
    value: AxisCycleTarget,
    label: string,
};

export type VirusOnTheRockState = {
    activePreset: AudioReactivePresetName,
    currentStructureLabel?: string,
    currentAudioLabel?: string,
    /** the loaded structures; a mesoscale example's parts share its group (the trajectory they hang from) */
    loadedEntries: LoadedEntry[],
    audioLoaded: boolean,
    axisModeEnabled: boolean,
    axisSource: TumbleAxisSourceName,
    localAxis: TumbleAxisName,
    axisOptions: AxisOption[],
    selectedAxisOrder: AudioReactiveAssemblyAxisOrder,
    wiggleEffectScale: number,
    tumbleEffectScale: number,
    objectTransformEffectScale: number,
    assemblyAxisAmplitudeScale: number,
    beatThreshold: number,
    audioPlaying: boolean,
    hasAssemblyAxes: boolean,
    axisCycleEnabled: boolean,
    axisCycleEvery: number,
    cycleTargets: AxisCycleTarget[],
    activeCycleTarget?: AxisCycleTarget,
    atomWiggleEnabled: boolean,
    instanceTumbleEnabled: boolean,
    objectTransformEnabled: boolean,
    objectTransformMode: ObjectTransformModeName,
    lodScaleEnabled: boolean,
    representationMode: RepresentationMode,
    audioClipEnabled: boolean,
    audioClipScale: number,
    showSidebar: boolean,
    showHistogramBars: boolean,
    showSessionInfo: boolean,
    showWaveformLine: boolean,
    showRadialVisualizer: boolean,
    /** a random model at each new song */
    randomPerSong: boolean,
    /** how the last song change was found, shown under the Random button */
    songChangeNote?: string,
    /** the model loading for a song change or an example, shown as busy */
    loadingModel?: string,
};

export type LoadedEntry = { ref: string, label: string, group?: { ref: string, label: string } }

export function getAxisOptions(symmetry: AssemblySymmetryValue | undefined): AxisOption[] {
    if (!symmetry || !AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) return [];

    const orders = Array.from(new Set(symmetry.rotation_axes.map(axis => axis.order).filter((order): order is number => !!order && order > 1)))
        .sort((a, b) => a - b);

    if (orders.length === 0) return [];

    return [
        { value: 'highest', label: 'Auto' },
        ...orders.map(order => ({ value: `${order}` as AudioReactiveAssemblyAxisOrder, label: `${order}-fold` }))
    ];
}

export function formatPresetLabel(name: AudioReactivePresetName) {
    return AudioReactivePresetDefinitions.find(p => p.name === name)?.label ?? name;
}

export function getCyclingAxisOptions(axisOptions: AxisOption[]) {
    return axisOptions
        .filter(option => option.value !== 'highest')
        .sort((a, b) => parseInt(b.value, 10) - parseInt(a.value, 10));
}

export const LocalAxisOptions = [
    { value: 'x' as const, label: 'X' },
    { value: 'y' as const, label: 'Y' },
    { value: 'z' as const, label: 'Z' },
] as const;

export const DefaultLocalCycleTargets = LocalAxisOptions.map(option => `local:${option.value}` as AxisCycleTarget);

export function getLocalCycleTarget(axis: TumbleAxisName): AxisCycleTarget {
    return `local:${axis}`;
}

export function getAssemblyCycleTarget(order: AudioReactiveAssemblyAxisOrder): AxisCycleTarget {
    return `assembly:${order}`;
}

export function getAxisCycleOptions(axisOptions: AxisOption[]): AxisCycleOption[] {
    return [
        ...LocalAxisOptions.map(option => ({ value: getLocalCycleTarget(option.value), label: option.label })),
        ...getCyclingAxisOptions(axisOptions).map(option => ({ value: getAssemblyCycleTarget(option.value), label: option.label })),
    ];
}

export function getDefaultCycleTargets(axisOptions: AxisOption[]) {
    // Local X/Y/Z are off by default; cycle uses assembly axes when available.
    return getCyclingAxisOptions(axisOptions).map(option => getAssemblyCycleTarget(option.value));
}

export function getEnabledCycleOptions(state: Pick<VirusOnTheRockState, 'axisOptions' | 'cycleTargets'>) {
    const cycleTargets = new Set(state.cycleTargets);
    return getAxisCycleOptions(state.axisOptions).filter(option => cycleTargets.has(option.value));
}

export function isLocalCycleTarget(target: AxisCycleTarget): target is `local:${TumbleAxisName}` {
    return target.startsWith('local:');
}

export function getLocalAxisFromCycleTarget(target: AxisCycleTarget): TumbleAxisName {
    return target.slice('local:'.length) as TumbleAxisName;
}

export function getAssemblyOrderFromCycleTarget(target: AxisCycleTarget): AudioReactiveAssemblyAxisOrder {
    return target.slice('assembly:'.length) as AudioReactiveAssemblyAxisOrder;
}

export function getCycleTargetLabel(target: AxisCycleTarget, axisOptions: AxisOption[]) {
    return getAxisCycleOptions(axisOptions).find(option => option.value === target)?.label ?? target;
}

export function sanitizeCycleTargets(cycleTargets: readonly AxisCycleTarget[], axisOptions: AxisOption[]) {
    const available = new Set(getAxisCycleOptions(axisOptions).map(option => option.value));
    const filtered = cycleTargets.filter(target => available.has(target));
    // Always guarantee >= 2 options so beat cycle works even without assembly symmetry.
    return filtered.length >= 2 ? filtered : DefaultLocalCycleTargets;
}

export function getAxisModeState(animation: AnimationProps) {
    return {
        axisModeEnabled: animation.tumbleTranslationMode === 'axis',
        axisSource: animation.tumbleAxisSource,
        localAxis: animation.tumbleAxis,
    } as const;
}

export function getAxisAnimationPatch(state: Pick<VirusOnTheRockState, 'axisModeEnabled' | 'axisSource' | 'localAxis'>): Pick<AnimationProps, 'tumbleTranslationMode' | 'tumbleAxisSource' | 'tumbleAxis'> {
    return {
        tumbleTranslationMode: state.axisModeEnabled ? 'axis' : 'noise',
        tumbleAxisSource: state.axisSource,
        tumbleAxis: state.localAxis,
    };
}

/**
 * The animation fields a preset sets over the current ones. 'replace' (a preset chip, startup) applies the preset
 * whole, its motion flags too. 'keep' (a load of a model or a song) leaves the three motion flags as they are now: the
 * user's, or a route's turning on, must not be undone by the load.
 */
export function getPresetAnimationPatch(current: AnimationProps, preset: Partial<AnimationProps>, mode: 'replace' | 'keep'): Partial<AnimationProps> {
    if (mode === 'replace') return { ...preset };
    return {
        ...preset,
        atomWiggleEnabled: current.atomWiggleEnabled,
        instanceTumbleEnabled: current.instanceTumbleEnabled,
        objectTransformEnabled: current.objectTransformEnabled,
    };
}

export function getMotionTargetState(animation: AnimationProps) {
    return {
        atomWiggleEnabled: animation.atomWiggleEnabled,
        instanceTumbleEnabled: animation.instanceTumbleEnabled,
        objectTransformEnabled: animation.objectTransformEnabled,
        objectTransformMode: animation.objectTransformMode,
    } as const;
}

export function getAxisStatusLabel(state: Pick<VirusOnTheRockState, 'axisModeEnabled' | 'axisCycleEnabled' | 'activeCycleTarget' | 'axisOptions' | 'cycleTargets' | 'axisSource' | 'localAxis' | 'hasAssemblyAxes' | 'selectedAxisOrder'>) {
    if (!state.axisModeEnabled) return 'Off';
    if (state.axisCycleEnabled) {
        const activeTarget = state.activeCycleTarget ?? getEnabledCycleOptions(state)[0]?.value;
        return activeTarget ? `Beat Cycle · ${getCycleTargetLabel(activeTarget, state.axisOptions)}` : 'Beat Cycle';
    }
    if (state.axisSource === 'local') return `Local ${state.localAxis.toUpperCase()} / -${state.localAxis.toUpperCase()}`;
    if (state.axisSource === 'global') return `Global ${state.localAxis.toUpperCase()} / -${state.localAxis.toUpperCase()}`;
    if (!state.hasAssemblyAxes) return 'Assembly unavailable';
    return `Manual · ${state.axisOptions.find(option => option.value === state.selectedAxisOrder)?.label ?? 'Auto'}`;
}

export function createInitialState(params: AudioReactiveAnimationManagerValues, animation: AnimationProps): VirusOnTheRockState {
    const axisState = getAxisModeState(animation);
    return {
        activePreset: DefaultPresetName,
        loadedEntries: [],
        audioLoaded: false,
        randomPerSong: false,
        ...axisState,
        // Override axis-mode defaults: axis mode on, assembly source, beat cycle on,
        // local X/Y/Z deselected (cycle picks up assembly axes once available).
        axisModeEnabled: true,
        axisSource: 'assembly',
        axisOptions: [],
        selectedAxisOrder: params.assemblyAxisOrder,
        wiggleEffectScale: params.wiggleEffectScale,
        tumbleEffectScale: params.tumbleEffectScale,
        objectTransformEffectScale: params.objectTransformEffectScale,
        assemblyAxisAmplitudeScale: params.assemblyAxisAmplitudeScale,
        beatThreshold: 0.05,
        audioPlaying: false,
        hasAssemblyAxes: false,
        axisCycleEnabled: true,
        axisCycleEvery: 1,
        cycleTargets: [],
        activeCycleTarget: void 0,
        ...getMotionTargetState(animation),
        lodScaleEnabled: params.lodScaleEnabled,
        representationMode: DefaultRepresentationMode,
        audioClipEnabled: false,
        audioClipScale: 1,
        showSidebar: true,
        showHistogramBars: true,
        showSessionInfo: true,
        showWaveformLine: true,
        showRadialVisualizer: true,
    };
}
