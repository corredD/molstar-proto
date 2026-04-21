/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { BehaviorSubject, Subscription } from 'rxjs';
import { AssemblySymmetryData, AssemblySymmetryDataProvider, AssemblySymmetryProvider, AssemblySymmetryValue } from '../../extensions/assembly-symmetry/prop';
import { getAssemblySymmetryConfig, tryCreateAssemblySymmetry } from '../../extensions/assembly-symmetry/behavior';
import { Quat } from '../../mol-math/linear-algebra/3d/quat';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import { Vec4 } from '../../mol-math/linear-algebra/3d/vec4';
import { setSubtreeVisibility } from '../../mol-plugin/behavior/static/state';
import { PostprocessingParams } from '../../mol-canvas3d/passes/postprocessing';
import { SsaoParams } from '../../mol-canvas3d/passes/ssao';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Task } from '../../mol-task';
import { useBehavior } from '../../mol-plugin-ui/hooks/use-behavior';
import { PresetStructureRepresentations } from '../../mol-plugin-state/builder/structure/representation-preset';
import { clearStructureWiggle } from '../../mol-plugin-state/helpers/structure-wiggle';
import { AudioReactivePresetDefinitions, AudioReactivePresetName, getAudioReactivePreset } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { AudioReactiveAnimationManagerValues, type AudioReactiveStatus } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { AudioReactiveAssemblyAxisOrder } from '../../mol-plugin-state/helpers/assembly-symmetry-axis';
import { StructureRef } from '../../mol-plugin-state/manager/structure/hierarchy-state';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { StructureRepresentation3D } from '../../mol-plugin-state/transforms/representation';
import { Viewer } from '../viewer/app';
import { areAnimationPropsEqual, type AnimationProps, type TumbleAxisName, type TumbleAxisSourceName } from '../../mol-geo/geometry/animation';

type AxisOption = {
    value: AudioReactiveAssemblyAxisOrder,
    label: string,
};

type AxisCycleTarget = `local:${TumbleAxisName}` | `assembly:${AudioReactiveAssemblyAxisOrder}`;

type AxisCycleOption = {
    value: AxisCycleTarget,
    label: string,
};

type VirusOnTheRockState = {
    activePreset: AudioReactivePresetName,
    currentStructureLabel?: string,
    currentAudioLabel?: string,
    loadedEntries: { ref: string, label: string }[],
    audioLoaded: boolean,
    axisModeEnabled: boolean,
    tumbleTranslationSync: boolean,
    axisSource: TumbleAxisSourceName,
    localAxis: TumbleAxisName,
    axisOptions: AxisOption[],
    selectedAxisOrder: AudioReactiveAssemblyAxisOrder,
    wiggleEffectScale: number,
    tumbleEffectScale: number,
    assemblyAxisAmplitudeScale: number,
    beatThreshold: number,
    audioPlaying: boolean,
    hasAssemblyAxes: boolean,
    axisCycleEnabled: boolean,
    axisCycleEvery: number,
    cycleTargets: AxisCycleTarget[],
    activeCycleTarget?: AxisCycleTarget,
    showSidebar: boolean,
    showHistogramBars: boolean,
    showSessionInfo: boolean,
    showWaveformLine: boolean,
    showRadialVisualizer: boolean,
};

const DefaultPdbId = '2tbv';
const DefaultAudioUrl = '/examples/angine.mp3';
const DefaultAudioLabel = 'angine.mp3';
const DefaultCameraSpinRadiansPerSecond = 0.01;
const ExamplePdbIds = ['2tbv', '2plv'] as const;
const FeaturedPresetNames: readonly AudioReactivePresetName[] = [
    'bass-spectrum',
    'bass-groove-strong',
    'full-spectrum',
    'ambient-pulse',
];
const _spinDir = Vec3();
const _spinAxis = Vec3();
const _spinRot = Quat();
const _spinPosition = Vec3();
const _sceneCenterScreen = Vec4();

function getDefaultMultiScaleOcclusionProps() {
    const postprocessing = PD.getDefaultValues(PostprocessingParams);
    const occlusionDefaults = PD.getDefaultValues(SsaoParams);

    return {
        ...postprocessing,
        occlusion: {
            name: 'on' as const,
            params: {
                ...occlusionDefaults,
                multiScale: {
                    name: 'on' as const,
                    params: {
                        levels: [
                            { radius: 2, bias: 1 },
                            { radius: 5, bias: 1 },
                            { radius: 8, bias: 1 },
                            { radius: 11, bias: 1 },
                        ],
                        nearThreshold: 10,
                        farThreshold: 1500,
                    },
                },
            },
        },
    };
}

function isAudioFile(file: File) {
    return file.type.startsWith('audio/')
        || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
}

function getStructureLabel(structureRef: StructureRef | undefined) {
    const structure = structureRef?.cell.obj?.data;
    if (!structure) return void 0;
    const entryId = structure.models[0]?.entryId;
    const label = structureRef?.cell.obj?.label;
    return entryId ? `${entryId.toUpperCase()}${label ? ` | ${label}` : ''}` : label;
}

function getAxisOptions(symmetry: AssemblySymmetryValue | undefined): AxisOption[] {
    if (!symmetry || !AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) return [];

    const orders = Array.from(new Set(symmetry.rotation_axes.map(axis => axis.order).filter((order): order is number => !!order && order > 1)))
        .sort((a, b) => a - b);

    if (orders.length === 0) return [];

    return [
        { value: 'highest', label: 'Auto' },
        ...orders.map(order => ({ value: `${order}` as AudioReactiveAssemblyAxisOrder, label: `${order}-fold` }))
    ];
}

function formatPresetLabel(name: AudioReactivePresetName) {
    return AudioReactivePresetDefinitions.find(p => p.name === name)?.label ?? name;
}

function getCyclingAxisOptions(axisOptions: AxisOption[]) {
    return axisOptions
        .filter(option => option.value !== 'highest')
        .sort((a, b) => parseInt(b.value, 10) - parseInt(a.value, 10));
}

const LocalAxisOptions = [
    { value: 'x' as const, label: 'X' },
    { value: 'y' as const, label: 'Y' },
    { value: 'z' as const, label: 'Z' },
] as const;

const DefaultLocalCycleTargets = LocalAxisOptions.map(option => `local:${option.value}` as AxisCycleTarget);

function getLocalCycleTarget(axis: TumbleAxisName): AxisCycleTarget {
    return `local:${axis}`;
}

function getAssemblyCycleTarget(order: AudioReactiveAssemblyAxisOrder): AxisCycleTarget {
    return `assembly:${order}`;
}

function getAxisCycleOptions(axisOptions: AxisOption[]): AxisCycleOption[] {
    return [
        ...LocalAxisOptions.map(option => ({ value: getLocalCycleTarget(option.value), label: option.label })),
        ...getCyclingAxisOptions(axisOptions).map(option => ({ value: getAssemblyCycleTarget(option.value), label: option.label })),
    ];
}

function getDefaultCycleTargets(axisOptions: AxisOption[]) {
    return getAxisCycleOptions(axisOptions).map(option => option.value);
}

function getEnabledCycleOptions(state: Pick<VirusOnTheRockState, 'axisOptions' | 'cycleTargets'>) {
    const cycleTargets = new Set(state.cycleTargets);
    return getAxisCycleOptions(state.axisOptions).filter(option => cycleTargets.has(option.value));
}

function isLocalCycleTarget(target: AxisCycleTarget): target is `local:${TumbleAxisName}` {
    return target.startsWith('local:');
}

function getLocalAxisFromCycleTarget(target: AxisCycleTarget): TumbleAxisName {
    return target.slice('local:'.length) as TumbleAxisName;
}

function getAssemblyOrderFromCycleTarget(target: AxisCycleTarget): AudioReactiveAssemblyAxisOrder {
    return target.slice('assembly:'.length) as AudioReactiveAssemblyAxisOrder;
}

function getCycleTargetLabel(target: AxisCycleTarget, axisOptions: AxisOption[]) {
    return getAxisCycleOptions(axisOptions).find(option => option.value === target)?.label ?? target;
}

function sanitizeCycleTargets(cycleTargets: readonly AxisCycleTarget[], axisOptions: AxisOption[]) {
    const available = new Set(getAxisCycleOptions(axisOptions).map(option => option.value));
    return cycleTargets.filter(target => available.has(target));
}

function getAxisModeState(animation: AnimationProps) {
    return {
        axisModeEnabled: animation.tumbleTranslationMode === 'axis',
        axisSource: animation.tumbleAxisSource,
        localAxis: animation.tumbleAxis,
    } as const;
}

function getAxisAnimationPatch(state: Pick<VirusOnTheRockState, 'axisModeEnabled' | 'axisSource' | 'localAxis'>): Pick<AnimationProps, 'tumbleTranslationMode' | 'tumbleAxisSource' | 'tumbleAxis'> {
    return {
        tumbleTranslationMode: state.axisModeEnabled ? 'axis' : 'noise',
        tumbleAxisSource: state.axisSource,
        tumbleAxis: state.localAxis,
    };
}

function getAxisStatusLabel(state: VirusOnTheRockState) {
    if (!state.axisModeEnabled) return 'Off';
    if (state.axisCycleEnabled) {
        const activeTarget = state.activeCycleTarget ?? getEnabledCycleOptions(state)[0]?.value;
        return activeTarget ? `Beat Cycle · ${getCycleTargetLabel(activeTarget, state.axisOptions)}` : 'Beat Cycle';
    }
    if (state.axisSource === 'local') return `${state.localAxis.toUpperCase()} / -${state.localAxis.toUpperCase()}`;
    if (!state.hasAssemblyAxes) return 'Assembly unavailable';
    return `Manual · ${state.axisOptions.find(option => option.value === state.selectedAxisOrder)?.label ?? 'Auto'}`;
}

function createInitialState(params: AudioReactiveAnimationManagerValues, animation: AnimationProps): VirusOnTheRockState {
    const axisState = getAxisModeState(animation);
    return {
        activePreset: 'bass-spectrum',
        loadedEntries: [],
        audioLoaded: false,
        ...axisState,
        axisOptions: [],
        selectedAxisOrder: params.assemblyAxisOrder,
        wiggleEffectScale: params.wiggleEffectScale,
        tumbleEffectScale: params.tumbleEffectScale,
        tumbleTranslationSync: params.tumbleTranslationSync,
        assemblyAxisAmplitudeScale: params.assemblyAxisAmplitudeScale,
        beatThreshold: 0.05,
        audioPlaying: false,
        hasAssemblyAxes: false,
        axisCycleEnabled: false,
        axisCycleEvery: 1,
        cycleTargets: DefaultLocalCycleTargets,
        activeCycleTarget: void 0,
        showSidebar: true,
        showHistogramBars: true,
        showSessionInfo: true,
        showWaveformLine: true,
        showRadialVisualizer: true,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function sampleFloatSeries(values: ArrayLike<number>, t: number) {
    const count = values.length;
    if (count === 0) return 0;
    if (count === 1) return values[0];

    const clamped = clamp(t, 0, 1) * (count - 1);
    const left = Math.floor(clamped);
    const right = Math.min(count - 1, left + 1);
    const alpha = clamped - left;
    return values[left] * (1 - alpha) + values[right] * alpha;
}

function useWindowSize() {
    const [size, setSize] = React.useState(() => ({
        width: typeof window !== 'undefined' ? window.innerWidth : 1280,
        height: typeof window !== 'undefined' ? window.innerHeight : 720,
    }));

    React.useEffect(() => {
        const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return size;
}

function getSceneVisualizerFrame(app: VirusOnTheRockApp, width: number, height: number) {
    const canvas3d = app.viewer.plugin.canvas3d;
    const camera = canvas3d?.camera;
    const sphere = canvas3d?.boundingSphereVisible;
    if (!camera || !sphere || sphere.radius <= 0 || !isFinite(sphere.radius)) {
        return {
            centerX: width * 0.5,
            centerY: height * 0.5,
            sceneRadius: Math.min(width, height) * 0.18,
        };
    }

    const pixelRatio = canvas3d?.webgl.pixelRatio ?? 1;
    camera.project(_sceneCenterScreen, sphere.center);
    const pixelSize = Math.max(camera.getPixelSize(sphere.center), 1e-4);
    return {
        centerX: _sceneCenterScreen[0] / pixelRatio,
        centerY: height - _sceneCenterScreen[1] / pixelRatio,
        sceneRadius: sphere.radius / (pixelSize * pixelRatio),
    };
}

function buildWavePath(samples: ArrayLike<number>, x0: number, x1: number, centerY: number, amplitude: number) {
    if (samples.length === 0) return '';

    let path = '';
    const dx = samples.length > 1 ? (x1 - x0) / (samples.length - 1) : 0;
    for (let i = 0, il = samples.length; i < il; ++i) {
        const x = x0 + dx * i;
        const y = centerY - samples[i] * amplitude;
        path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return path.trimEnd();
}

function getRadialColor(value: number, normalizedIndex: number, hueShift: number) {
    const hue = 196 + hueShift + normalizedIndex * 44;
    const saturation = 90;
    const lightness = 60 + value * 18;
    return `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness.toFixed(1)}%, ${0.36 + value * 0.58})`;
}

export class VirusOnTheRockApp {
    readonly state: BehaviorSubject<VirusOnTheRockState>;

    private readonly subscriptions = new Subscription();
    private readonly uiRoot: Root;
    private readonly configuredStructureVersions = new Map<string, string>();
    private readonly styledStructureVersions = new Map<string, string>();
    private cycleTargetsCustomized = false;
    private syncToken = 0;
    private cameraSpinHandle: number | undefined;
    private lastCameraSpinTimestamp: number | undefined;
    private beatTriggerActive = false;
    private beatCycleCount = 0;
    private beatCycleIndex = 0;

    private constructor(readonly viewer: Viewer, uiTarget: HTMLElement) {
        const params = this.viewer.plugin.managers.audioReactive.state.params.value;
        const animation = this.viewer.plugin.managers.structure.component.state.options.animation;
        this.state = new BehaviorSubject(createInitialState(params, animation));
        this.uiRoot = createRoot(uiTarget);

        this.viewer.plugin.managers.dragAndDrop.addHandler('virus-on-the-rock', async (files) => {
            const audioFiles = files.filter(isAudioFile);
            const structureFiles = files.filter(file => !isAudioFile(file));

            if (audioFiles[0]) {
                await this.loadAudioFile(audioFiles[0]);
            }
            if (structureFiles.length > 0) {
                await this.loadStructureFiles(structureFiles);
            }

            return audioFiles.length > 0;
        });

        this.subscriptions.add(this.viewer.plugin.managers.structure.hierarchy.behaviors.selection.subscribe(() => {
            void this.syncSelectedStructure();
        }));
        this.subscriptions.add(this.viewer.plugin.managers.audioReactive.state.status.subscribe(status => {
            void this.updateAxisCycle(status);
            const current = this.state.value;
            if (current.currentAudioLabel !== status.sourceLabel
                || current.audioLoaded !== status.loaded
                || current.audioPlaying !== status.playing) {
                this.patchState({
                    currentAudioLabel: status.sourceLabel,
                    audioLoaded: status.loaded,
                    audioPlaying: status.playing,
                });
            }
        }));
        this.subscriptions.add(this.viewer.plugin.managers.audioReactive.state.params.subscribe(values => {
            this.patchState({
                wiggleEffectScale: values.wiggleEffectScale,
                tumbleEffectScale: values.tumbleEffectScale,
                assemblyAxisAmplitudeScale: values.assemblyAxisAmplitudeScale,
                beatThreshold: values.beatThreshold,
                tumbleTranslationSync: values.tumbleTranslationSync,
            });
        }));

        this.uiRoot.render(<VirusOnTheRockControls app={this} />);
    }

    static async create(pluginTarget: HTMLElement, uiTarget: HTMLElement) {
        const viewer = await Viewer.create(pluginTarget, {
            layoutShowControls: false,
            layoutShowRemoteState: false,
            layoutShowSequence: false,
            layoutShowLog: false,
            layoutShowLeftPanel: false,
            collapseLeftPanel: true,
            collapseRightPanel: false,
            viewportShowControls: true,
            viewportShowSettings: true,
            viewportShowSelectionMode: false,
            viewportShowAnimation: false,
            viewportShowTrajectoryControls: false,
            viewportShowExpand: false,
            illumination: false,
            viewportBackgroundColor: '#09111a',
        });

        viewer.plugin.canvas3d?.setProps({
            illumination: { enabled: false },
            postprocessing: getDefaultMultiScaleOcclusionProps(),
        });

        const app = new VirusOnTheRockApp(viewer, uiTarget);
        await app.initializeDefaults();
        return app;
    }

    private get currentStructureRef() {
        return this.viewer.plugin.managers.structure.hierarchy.selection.structures[0];
    }

    private isAxisCycleActive(state = this.state.value) {
        return state.axisModeEnabled
            && state.axisCycleEnabled
            && getEnabledCycleOptions(state).length > 1;
    }

    private patchState(patch: Partial<VirusOnTheRockState>) {
        this.state.next({ ...this.state.value, ...patch });
    }

    private async applyManualAxisSelection(state = this.state.value) {
        if (state.axisModeEnabled && state.axisSource === 'assembly') {
            this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: state.selectedAxisOrder });
        }
        await this.updateAnimationOptions(getAxisAnimationPatch(state));
    }

    private async applyCycleTarget(target: AxisCycleTarget) {
        if (isLocalCycleTarget(target)) {
            await this.updateAnimationOptions({
                tumbleTranslationMode: 'axis',
                tumbleAxisSource: 'local',
                tumbleAxis: getLocalAxisFromCycleTarget(target),
            });
        } else {
            this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: getAssemblyOrderFromCycleTarget(target) });
            await this.updateAnimationOptions({
                tumbleTranslationMode: 'axis',
                tumbleAxisSource: 'assembly',
                tumbleAxis: this.state.value.localAxis,
            });
        }
        this.patchState({ activeCycleTarget: target });
    }

    private async updateAnimationOptions(patch: Partial<AnimationProps>) {
        const options = this.viewer.plugin.managers.structure.component.state.options;
        await this.viewer.plugin.managers.structure.component.setOptions({
            ...options,
            animation: {
                ...options.animation,
                ...patch,
            }
        });
    }

    private async initializeDefaults() {
        try {
            await this.loadPdb(DefaultPdbId);
        } catch (error) {
            this.viewer.plugin.log.error(`Failed to load default structure ${DefaultPdbId.toUpperCase()}: ${error}`);
        }

        try {
            await this.loadDefaultAudio();
        } catch (error) {
            this.viewer.plugin.log.error(`Failed to load default audio ${DefaultAudioLabel}: ${error}`);
        }

        await this.applyAudioPreset('bass-spectrum');
        this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisAmplitudeScale: 15, beatThreshold: 0.05 });
        await this.syncSelectedStructure();
    }

    private async loadDefaultAudio() {
        await this.viewer.plugin.managers.audioReactive.loadUrl(DefaultAudioUrl, DefaultAudioLabel);
        try {
            await this.viewer.plugin.managers.audioReactive.play();
        } catch {
            this.viewer.plugin.log.message(`Default audio loaded, but autoplay was blocked. Use Play to start ${DefaultAudioLabel}.`);
        }
    }

    private async startCameraSpin() {
        await this.viewer.plugin.managers.animation.stop();
        if (this.cameraSpinHandle !== void 0) return;

        const step = (timestamp: number) => {
            if (this.lastCameraSpinTimestamp === void 0) {
                this.lastCameraSpinTimestamp = timestamp;
                this.cameraSpinHandle = requestAnimationFrame(step);
                return;
            }

            const canvas3d = this.viewer.plugin.canvas3d;
            const snapshot = canvas3d?.camera.getSnapshot();
            const dtMs = Math.min(100, Math.max(0, timestamp - this.lastCameraSpinTimestamp));
            this.lastCameraSpinTimestamp = timestamp;

            if (snapshot && snapshot.radiusMax > 0.0001) {
                Vec3.sub(_spinDir, snapshot.position, snapshot.target);
                Vec3.normalize(_spinAxis, snapshot.up);
                Quat.setAxisAngle(_spinRot, _spinAxis, DefaultCameraSpinRadiansPerSecond * (dtMs / 1000));
                Vec3.transformQuat(_spinDir, _spinDir, _spinRot);
                Vec3.add(_spinPosition, snapshot.target, _spinDir);
                canvas3d?.requestCameraReset({ snapshot: { position: Vec3.clone(_spinPosition) }, durationMs: 0 });
            }

            this.cameraSpinHandle = requestAnimationFrame(step);
        };

        this.cameraSpinHandle = requestAnimationFrame(step);
    }

    private stopCameraSpin() {
        if (this.cameraSpinHandle !== void 0) {
            cancelAnimationFrame(this.cameraSpinHandle);
            this.cameraSpinHandle = void 0;
        }
        this.lastCameraSpinTimestamp = void 0;
    }

    private async resetAndSpinCamera() {
        await this.viewer.plugin.managers.animation.stop();
        this.viewer.plugin.managers.camera.reset(void 0, 0);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await this.startCameraSpin();
    }

    private resetAxisCycleRuntime() {
        this.beatTriggerActive = false;
        this.beatCycleCount = 0;
        this.beatCycleIndex = 0;
    }

    private getCyclingAxes(state = this.state.value) {
        return getEnabledCycleOptions(state);
    }

    async setAxisModeEnabled(enabled: boolean) {
        this.resetAxisCycleRuntime();

        const axisSource = this.state.value.axisSource === 'assembly' && !this.state.value.hasAssemblyAxes
            ? 'local'
            : this.state.value.axisSource;
        const nextState = { ...this.state.value, axisModeEnabled: enabled, axisSource };

        this.patchState({ axisModeEnabled: enabled, axisSource, activeCycleTarget: void 0 });

        if (!enabled) {
            await this.updateAnimationOptions(getAxisAnimationPatch(nextState));
            return;
        }

        if (nextState.axisCycleEnabled) {
            const cycleAxes = this.getCyclingAxes(nextState);
            if (cycleAxes.length > 0) {
                await this.applyCycleTarget(cycleAxes[0].value);
                return;
            }
        }

        await this.applyManualAxisSelection(nextState);
    }

    async setLocalAxis(axis: TumbleAxisName) {
        this.resetAxisCycleRuntime();

        const nextState = { ...this.state.value, axisSource: 'local' as const, localAxis: axis };
        this.patchState({ axisSource: 'local', localAxis: axis });
        if (!nextState.axisCycleEnabled && nextState.axisModeEnabled) {
            await this.applyManualAxisSelection(nextState);
        }
    }

    async setAssemblyAxisSource() {
        if (!this.state.value.hasAssemblyAxes) return;

        this.resetAxisCycleRuntime();

        const nextState = { ...this.state.value, axisSource: 'assembly' as const };
        const nextAxisOrder = nextState.axisOptions.some(option => option.value === nextState.selectedAxisOrder)
            ? nextState.selectedAxisOrder
            : nextState.axisOptions[0]?.value ?? nextState.selectedAxisOrder;

        this.patchState({ axisSource: 'assembly', selectedAxisOrder: nextAxisOrder });
        if (!nextState.axisCycleEnabled && nextState.axisModeEnabled) {
            await this.applyManualAxisSelection({ ...nextState, selectedAxisOrder: nextAxisOrder });
        }
    }

    async setCycleEnabled(enabled: boolean) {
        this.resetAxisCycleRuntime();
        const nextState = { ...this.state.value, axisCycleEnabled: enabled, activeCycleTarget: void 0 };
        this.patchState({ axisCycleEnabled: enabled, activeCycleTarget: void 0 });

        if (!enabled) {
            await this.applyManualAxisSelection(nextState);
            return;
        }

        const cycleAxes = this.getCyclingAxes(nextState);
        if (cycleAxes.length === 0) return;
        await this.applyCycleTarget(cycleAxes[0].value);
    }

    async setTumbleTranslationSync(sync: boolean) {
        this.viewer.plugin.managers.audioReactive.setParams({ tumbleTranslationSync: sync });
        this.patchState({ tumbleTranslationSync: sync });
    }

    async toggleCycleTarget(target: AxisCycleTarget) {
        this.resetAxisCycleRuntime();
        this.cycleTargetsCustomized = true;

        const cycleTargets = this.state.value.cycleTargets.includes(target)
            ? this.state.value.cycleTargets.filter(value => value !== target)
            : [...this.state.value.cycleTargets, target];
        const nextState = { ...this.state.value, cycleTargets };
        const nextCycleTargets = this.getCyclingAxes(nextState);
        const nextActiveTarget = nextState.activeCycleTarget && cycleTargets.includes(nextState.activeCycleTarget)
            ? nextState.activeCycleTarget
            : nextCycleTargets[0]?.value;

        this.patchState({ cycleTargets, activeCycleTarget: nextActiveTarget });

        if (!nextState.axisCycleEnabled || !nextState.axisModeEnabled) return;

        if (nextActiveTarget) {
            await this.applyCycleTarget(nextActiveTarget);
        } else {
            await this.applyManualAxisSelection(nextState);
        }
    }

    setCycleEvery(value: number) {
        this.resetAxisCycleRuntime();
        this.patchState({ axisCycleEvery: value });
    }

    setWaveformLineVisible(visible: boolean) {
        this.patchState({ showWaveformLine: visible });
    }

    setRadialVisualizerVisible(visible: boolean) {
        this.patchState({ showRadialVisualizer: visible });
    }

    setSidebarVisible(visible: boolean) {
        this.patchState({ showSidebar: visible });
    }

    setHistogramBarsVisible(visible: boolean) {
        this.patchState({ showHistogramBars: visible });
    }

    setSessionInfoVisible(visible: boolean) {
        this.patchState({ showSessionInfo: visible });
    }

    private async updateAxisCycle(status: ReturnType<typeof this.viewer.plugin.managers.audioReactive.state.status.getValue>) {
        if (!status.playing) {
            this.beatTriggerActive = false;
            return;
        }

        const beatActive = status.frame.beatIntensity >= this.state.value.beatThreshold;
        const shouldAdvance = this.isAxisCycleActive() && beatActive && !this.beatTriggerActive;
        this.beatTriggerActive = beatActive;

        if (!shouldAdvance) return;

        const cycleAxes = this.getCyclingAxes();
        if (cycleAxes.length <= 1) return;

        this.beatCycleCount += 1;
        if (this.beatCycleCount % this.state.value.axisCycleEvery !== 0) return;

        this.beatCycleIndex = (this.beatCycleIndex + 1) % cycleAxes.length;
        await this.applyCycleTarget(cycleAxes[this.beatCycleIndex].value);
    }

    private async ensureSpacefillRepresentation(structureRef: StructureRef) {
        const ref = structureRef.cell.transform.ref;
        const version = structureRef.cell.transform.version;
        if (this.styledStructureVersions.get(ref) === version) return;

        await this.viewer.plugin.managers.structure.component.applyPreset([structureRef], PresetStructureRepresentations.illustrative);
        const animation = this.viewer.plugin.managers.structure.component.state.options.animation;
        const update = this.viewer.plugin.state.data.build();
        for (const component of structureRef.components) {
            for (const repr of component.representations) {
                update.to(repr.cell).update(old => {
                    old.type.params.ignoreLight = false;
                    old.colorTheme = { name: 'chain-id', params: {} };
                    if (old.type.params.animation) old.type.params.animation = animation;
                });
            }
        }
        await update.commit();
        this.styledStructureVersions.set(ref, version);
    }

    private async applyCurrentAnimationToStructures(structures: StructureRef[]) {
        if (structures.length === 0) return;

        const animation = this.viewer.plugin.managers.structure.component.state.options.animation;
        const update = this.viewer.plugin.state.data.build();
        let changed = false;

        for (const structure of structures) {
            for (const component of structure.components) {
                for (const repr of component.representations) {
                    if (repr.cell.transform.transformer !== StructureRepresentation3D) continue;

                    const params = repr.cell.transform.params as typeof repr.cell.transform.params & { type: { params: { animation?: typeof animation } } };
                    const current = params.type.params.animation;
                    if (!current || areAnimationPropsEqual(current, animation)) continue;

                    changed = true;
                    update.to(repr.cell).update(old => {
                        old.type.params.animation = animation;
                    });
                }
            }
        }

        if (changed) await update.commit();
    }

    private getDisplayedStructureData(structureRef: StructureRef) {
        return structureRef.transform?.cell.obj?.data ?? structureRef.cell.obj?.data;
    }

    private getAllStructures() {
        return this.viewer.plugin.managers.structure.hierarchy.current.structures;
    }

    private async placeNewStructuresOnGrid(newStructures: StructureRef[]) {
        if (newStructures.length === 0) return;

        const newRefSet = new Set(newStructures.map(structure => structure.cell.transform.ref));
        const allStructures = this.getAllStructures();
        const existingStructures = allStructures.filter(structure => !newRefSet.has(structure.cell.transform.ref));

        let maxRadius = 1;
        for (const structure of allStructures) {
            const displayed = this.getDisplayedStructureData(structure);
            const radius = displayed?.boundary.sphere.radius ?? 0;
            if (radius > maxRadius) maxRadius = radius;
        }
        const spacing = maxRadius * 2.75;
        const columns = 3;

        const update = this.viewer.plugin.state.data.build();
        for (let i = 0; i < newStructures.length; ++i) {
            const structure = newStructures[i];
            const displayed = this.getDisplayedStructureData(structure);
            const center = displayed?.boundary.sphere.center ?? Vec3.create(0, 0, 0);
            const slot = existingStructures.length + i;
            const col = slot % columns;
            const row = Math.floor(slot / columns);
            const targetCenter = Vec3.create(col * spacing, -row * spacing, 0);
            const translation = Vec3.sub(Vec3(), targetCenter, center);

            const transform = {
                name: 'components' as const,
                params: {
                    translation,
                    axis: Vec3.create(1, 0, 0),
                    angle: 0,
                    rotationCenter: {
                        name: 'point' as const,
                        params: { point: Vec3.create(0, 0, 0) }
                    }
                }
            };

            if (structure.transform) {
                update.to(structure.transform.cell).update({ transform });
            } else {
                update.to(structure.cell).insert(StateTransforms.Model.TransformStructureConformation, { transform });
            }
        }

        await update.commit();
    }

    private async syncSelectedStructure() {
        const token = ++this.syncToken;
        const allStructures = this.getAllStructures();
        if (allStructures.length === 0) {
            this.patchState({
                currentStructureLabel: void 0,
                loadedEntries: [],
                audioLoaded: this.state.value.audioLoaded,
                axisOptions: [],
                hasAssemblyAxes: false,
                cycleTargets: this.cycleTargetsCustomized ? sanitizeCycleTargets(this.state.value.cycleTargets, []) : DefaultLocalCycleTargets,
                activeCycleTarget: void 0,
            });
            return;
        }

        for (const structure of allStructures) {
            await this.ensureSpacefillRepresentation(structure);
            if (token !== this.syncToken) return;
        }

        const structureRef = this.currentStructureRef ?? allStructures[0];
        if (token !== this.syncToken) return;

        await this.ensureAssemblySymmetry(structureRef);
        if (token !== this.syncToken) return;

        const structure = structureRef.cell.obj?.data;
        const symmetry = structure ? AssemblySymmetryProvider.get(structure).value : void 0;
        const axisOptions = getAxisOptions(symmetry);
        const nextAxisOrder = axisOptions.some(option => option.value === this.state.value.selectedAxisOrder)
            ? this.state.value.selectedAxisOrder
            : axisOptions[0]?.value ?? this.state.value.selectedAxisOrder;
        const hasAssemblyAxes = axisOptions.length > 0;
        let nextAxisSource = this.state.value.axisSource;
        if (!hasAssemblyAxes && nextAxisSource === 'assembly') nextAxisSource = 'local';
        const nextCycleTargets = this.cycleTargetsCustomized
            ? sanitizeCycleTargets(this.state.value.cycleTargets, axisOptions)
            : getDefaultCycleTargets(axisOptions);
        const cycleState = {
            ...this.state.value,
            axisOptions,
            hasAssemblyAxes,
            axisSource: nextAxisSource,
            selectedAxisOrder: nextAxisOrder,
            cycleTargets: nextCycleTargets,
        };
        const cycleAxes = this.getCyclingAxes(cycleState);
        const nextActiveCycleTarget = this.state.value.activeCycleTarget && nextCycleTargets.includes(this.state.value.activeCycleTarget)
            ? this.state.value.activeCycleTarget
            : cycleAxes[0]?.value;

        if (this.state.value.axisModeEnabled && this.state.value.axisCycleEnabled && nextActiveCycleTarget) {
            await this.applyCycleTarget(nextActiveCycleTarget);
            if (token !== this.syncToken) return;
        } else if (this.state.value.axisModeEnabled && (nextAxisSource !== this.state.value.axisSource || nextAxisOrder !== this.state.value.selectedAxisOrder)) {
            await this.applyManualAxisSelection({
                ...this.state.value,
                axisSource: nextAxisSource,
                selectedAxisOrder: nextAxisOrder,
            });
            if (token !== this.syncToken) return;
        }

        this.patchState({
            currentStructureLabel: getStructureLabel(structureRef),
            loadedEntries: allStructures.map(structure => ({
                ref: structure.cell.transform.ref,
                label: getStructureLabel(structure) ?? structure.cell.obj?.label ?? structure.cell.transform.ref
            })),
            axisOptions,
            hasAssemblyAxes,
            axisSource: nextAxisSource,
            selectedAxisOrder: nextAxisOrder,
            cycleTargets: nextCycleTargets,
            activeCycleTarget: this.state.value.axisCycleEnabled ? nextActiveCycleTarget : void 0,
        });
    }

    private async ensureAssemblySymmetry(structureRef: StructureRef) {
        const structure = structureRef.cell.obj?.data;
        if (!structure || !AssemblySymmetryData.isApplicable(structure)) return;

        const ref = structureRef.cell.transform.ref;
        const target = structureRef.transform?.cell ?? structureRef.cell;
        const version = `${structureRef.cell.transform.version}:${target.transform.ref}:${target.transform.version}`;
        if (this.configuredStructureVersions.get(ref) === version) return;

        const config = getAssemblySymmetryConfig(this.viewer.plugin);
        await this.viewer.plugin.runTask(Task.create('Prepare Assembly Symmetry', async runtime => {
            const propCtx = { runtime, assetManager: this.viewer.plugin.managers.asset, errorContext: this.viewer.plugin.errorContext };
            await AssemblySymmetryDataProvider.attach(propCtx, structure, {
                serverType: config.DefaultServerType,
                serverUrl: config.DefaultServerUrl,
            });
            const data = AssemblySymmetryDataProvider.get(structure).value;
            const symmetryIndex = data ? AssemblySymmetryData.firstNonC1(data) : -1;
            if (symmetryIndex >= 0) {
                await AssemblySymmetryProvider.attach(propCtx, structure, {
                    serverType: config.DefaultServerType,
                    serverUrl: config.DefaultServerUrl,
                    symmetryIndex,
                });
            }
        }));

        const symmetry = AssemblySymmetryProvider.get(structure).value;
        if (symmetry && AssemblySymmetryData.isRotationAxes(symmetry.rotation_axes)) {
            const repr = await tryCreateAssemblySymmetry(this.viewer.plugin, target, void 0, { isHidden: true });
            if (repr.isOk) setSubtreeVisibility(this.viewer.plugin.state.data, repr.ref, true);
        }

        this.configuredStructureVersions.set(ref, version);
    }

    private get currentComponents() {
        return this.viewer.plugin.managers.structure.hierarchy.selection.structures.flatMap(structure => structure.components);
    }

    async loadPdb(id: string) {
        const pdbId = id.trim();
        if (!pdbId) return;
        const previousRefs = new Set(this.getAllStructures().map(structure => structure.cell.transform.ref));
        await this.viewer.loadPdb(pdbId);
        const newStructures = this.getAllStructures().filter(structure => !previousRefs.has(structure.cell.transform.ref));
        await this.placeNewStructuresOnGrid(newStructures);
        await this.syncSelectedStructure();
        await this.applyAudioPreset(this.state.value.activePreset);
        await this.applyCurrentAnimationToStructures(newStructures);
        await this.resetAndSpinCamera();
    }

    async loadStructureFiles(files: File[]) {
        if (files.length === 0) return;
        const previousRefs = new Set(this.getAllStructures().map(structure => structure.cell.transform.ref));
        await this.viewer.loadFiles(files);
        const newStructures = this.getAllStructures().filter(structure => !previousRefs.has(structure.cell.transform.ref));
        await this.placeNewStructuresOnGrid(newStructures);
        await this.syncSelectedStructure();
        await this.applyAudioPreset(this.state.value.activePreset);
        await this.applyCurrentAnimationToStructures(newStructures);
        await this.resetAndSpinCamera();
    }

    async loadAudioFile(file: File) {
        await this.applyAudioPreset(this.state.value.activePreset);
        await this.viewer.plugin.managers.audioReactive.loadFile(file);
        await this.playAudio();
    }

    async playAudio() {
        await this.viewer.plugin.managers.audioReactive.play();
    }

    pauseAudio() {
        this.viewer.plugin.managers.audioReactive.pause();
    }

    async applyAudioPreset(name: AudioReactivePresetName) {
        const preset = getAudioReactivePreset(name);
        const current = this.state.value;
        this.viewer.plugin.managers.audioReactive.setParams({
            ...preset.analysis,
            assemblyAxisOrder: current.selectedAxisOrder,
            wiggleEffectScale: current.wiggleEffectScale,
            tumbleEffectScale: current.tumbleEffectScale,
            tumbleTranslationSync: current.tumbleTranslationSync,
            assemblyAxisAmplitudeScale: current.assemblyAxisAmplitudeScale,
            beatThreshold: current.beatThreshold,
        });

        const options = this.viewer.plugin.managers.structure.component.state.options;
        await this.viewer.plugin.managers.structure.component.setOptions({
            ...options,
            animation: {
                ...options.animation,
                ...preset.animation,
                ...getAxisAnimationPatch(current),
            }
        });
        await clearStructureWiggle(this.viewer.plugin, this.currentComponents);
        this.patchState({ activePreset: name });
    }

    async setAxisOrder(order: AudioReactiveAssemblyAxisOrder) {
        this.patchState({ selectedAxisOrder: order });

        if (!this.state.value.axisCycleEnabled && this.state.value.axisModeEnabled && this.state.value.axisSource === 'assembly') {
            await this.applyManualAxisSelection({ ...this.state.value, selectedAxisOrder: order });
        }
    }

    setEffectScale(key: 'wiggleEffectScale' | 'tumbleEffectScale' | 'assemblyAxisAmplitudeScale', value: number) {
        this.viewer.plugin.managers.audioReactive.setParams({ [key]: value } as Partial<AudioReactiveAnimationManagerValues>);
    }

    setBeatThreshold(value: number) {
        this.viewer.plugin.managers.audioReactive.setParams({ beatThreshold: value });
    }

    async removeStructure(ref: string) {
        await this.viewer.plugin.managers.structure.hierarchy.remove([ref], false);
        await this.syncSelectedStructure();
        await this.resetAndSpinCamera();
    }

    dispose() {
        this.stopCameraSpin();
        this.viewer.plugin.managers.dragAndDrop.removeHandler('virus-on-the-rock');
        this.subscriptions.unsubscribe();
        this.uiRoot.unmount();
        this.viewer.dispose();
    }
}

function ControlCard(props: React.PropsWithChildren<{ title?: string, className?: string }>) {
    return <section className={`vor-card ${props.className ?? ''}`}>
        {props.title && <h2 className='vor-section-title'>{props.title}</h2>}
        {props.children}
    </section>;
}

function OverlayToggleDock({ app, state }: { app: VirusOnTheRockApp, state: VirusOnTheRockState }) {
    return null;
    return <div className='vor-hud'>
        {/* Sidebar — small collapse/expand button at the top */}
        <button
            className={`vor-chip vor-toggle-small ${state.showSidebar ? 'vor-active' : ''}`}
            onClick={() => app.setSidebarVisible(!state.showSidebar)}
            title={state.showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
        >
            {state.showSidebar ? '←' : '→'}
        </button>

        {/* Session — small button next to it */}
        <button
            className={`vor-chip vor-toggle-small ${state.showSessionInfo ? 'vor-active' : ''}`}
            onClick={() => app.setSessionInfoVisible(!state.showSessionInfo)}
            title={state.showSessionInfo ? 'Hide Session Info' : 'Show Session Info'}
        >
            i
        </button>
    </div>;
}

function AudioVisualizerOverlay(props: {
    app: VirusOnTheRockApp,
    showWaveformLine: boolean,
    showHistogramBars: boolean,
    showRadialVisualizer: boolean,
}) {
    const status = useBehavior(props.app.viewer.plugin.managers.audioReactive.state.status) as AudioReactiveStatus | undefined;
    const { width, height } = useWindowSize();
    const [radialOffset, setRadialOffset] = React.useState(() => ({ x: 0, y: 0 }));
    const [radialScale, setRadialScale] = React.useState(1);

    if (!status || width <= 0 || height <= 0) return null;

    const { waveform, spectrum } = status.visualization;
    const sceneFrame = getSceneVisualizerFrame(props.app, width, height);
    const overlayOpacity = status.playing ? 1 : status.loaded ? 0.58 : 0.22;
    const mix = status.frame.mix;
    const beat = status.frame.beatIntensity;
    const bass = Math.max(status.frame.frequencyBands.subBass, status.frame.frequencyBands.bass);

    const barCount = Math.max(20, Math.min(56, Math.floor(width / 14)));
    const barSpan = Math.min(width * 0.78, 960);
    const barGap = clamp(barSpan / (barCount * 5.5), 2, 6);
    const barWidth = Math.max(2.5, (barSpan - barGap * (barCount - 1)) / barCount);
    const barStartX = (width - (barWidth * barCount + barGap * (barCount - 1))) * 0.5;
    const barBaseY = height - Math.min(42, height * 0.05);
    const barMaxHeight = Math.min(height * 0.24, 170);
    const reflectionMaxHeight = Math.min(height * 0.12, 72);

    const waveCenterY = barBaseY - Math.min(120, height * 0.14);
    const waveAmplitude = Math.min(height * 0.11, 82) * (0.45 + mix * 0.95);
    const wavePath = props.showWaveformLine
        ? buildWavePath(waveform, width * 0.08, width * 0.92, waveCenterY, waveAmplitude)
        : '';

    const now = Date.now();
    const hueShift = Math.sin(now * 0.00032) * 12;
    const radialRotation = now * 0.0035;
    const radialAutoRadius = Math.max(sceneFrame.sceneRadius * 1.18, Math.min(width, height) * 0.2)
        + bass * 18
        + beat * 12;
    const radialBaseRadius = radialAutoRadius * radialScale;
    const radialMaxLength = Math.min(Math.min(width, height) * 0.14, sceneFrame.sceneRadius * 0.4 + 48) * radialScale;
    const radialInnerRadius = radialBaseRadius + mix * 8;
    const radialCount = Math.max(12, Math.min(28, Math.floor(spectrum.length / 2)));
    const radialCenterX = sceneFrame.centerX + radialOffset.x;
    const radialCenterY = sceneFrame.centerY + radialOffset.y;
    const radialHandleRadius = radialInnerRadius + radialMaxLength + 24;

    const beginRadialInteraction = (event: React.PointerEvent<SVGElement>, mode: 'move' | 'scale') => {
        event.preventDefault();
        event.stopPropagation();

        const startPointerX = event.clientX;
        const startPointerY = event.clientY;
        const startOffset = radialOffset;
        const startScale = radialScale;
        const startCenterX = radialCenterX;
        const startCenterY = radialCenterY;
        const startDistance = Math.max(24, Math.hypot(startPointerX - startCenterX, startPointerY - startCenterY));

        const onPointerMove = (moveEvent: PointerEvent) => {
            if (mode === 'move') {
                setRadialOffset({
                    x: startOffset.x + (moveEvent.clientX - startPointerX),
                    y: startOffset.y + (moveEvent.clientY - startPointerY),
                });
            } else {
                const currentDistance = Math.max(24, Math.hypot(moveEvent.clientX - startCenterX, moveEvent.clientY - startCenterY));
                setRadialScale(clamp(startScale * currentDistance / Math.max(24, startDistance), 0.45, 2.6));
            }
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const barRects: {
        x: number,
        y: number,
        height: number,
        reflectionY: number,
        reflectionHeight: number,
        opacity: number,
    }[] = [];
    for (let i = 0; i < barCount; ++i) {
        const t = barCount > 1 ? i / (barCount - 1) : 0;
        const value = Math.pow(sampleFloatSeries(spectrum, t), 0.9);
        const heightPx = 8 + value * barMaxHeight;
        const reflectionHeight = Math.min(reflectionMaxHeight, heightPx * 0.48);
        barRects.push({
            x: barStartX + i * (barWidth + barGap),
            y: barBaseY - heightPx,
            height: heightPx,
            reflectionY: barBaseY + 6,
            reflectionHeight,
            opacity: 0.22 + value * 0.78,
        });
    }

    const radialSegments: {
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        strokeWidth: number,
        glowWidth: number,
        color: string,
        glowOpacity: number,
    }[] = [];
    for (let i = 0; i < radialCount; ++i) {
        const t = radialCount > 1 ? i / (radialCount - 1) : 0;
        const value = Math.pow(sampleFloatSeries(spectrum, t), 0.88);
        const innerRadius = radialInnerRadius + value * 8;
        const outerRadius = innerRadius + 14 + value * radialMaxLength;
        const strokeWidth = 3.4 + value * 4.6;
        const glowWidth = strokeWidth + 7 + value * 5;
        const color = getRadialColor(value, t, hueShift);

        for (const mirror of [0, 1] as const) {
            const angle = (i / radialCount) * Math.PI + mirror * Math.PI;
            const rotation = angle + radialRotation * Math.PI / 180;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            radialSegments.push({
                x1: radialCenterX + cos * innerRadius,
                y1: radialCenterY + sin * innerRadius,
                x2: radialCenterX + cos * outerRadius,
                y2: radialCenterY + sin * outerRadius,
                strokeWidth,
                glowWidth,
                color,
                glowOpacity: 0.08 + value * 0.2,
            });
        }
    }

    return <div className='vor-visualizers' aria-hidden='true' style={{ opacity: overlayOpacity }}>
        <svg className='vor-visualizer-svg' viewBox={`0 0 ${width} ${height}`} preserveAspectRatio='none'>
            <defs>
                <linearGradient id='vor-wave-gradient' x1='0%' y1='0%' x2='100%' y2='0%'>
                    <stop offset='0%' stopColor='#8457ff' />
                    <stop offset='52%' stopColor='#b27cff' />
                    <stop offset='100%' stopColor='#49f2ff' />
                </linearGradient>
                <linearGradient id='vor-bar-gradient' x1='0%' y1='100%' x2='0%' y2='0%'>
                    <stop offset='0%' stopColor='#5b40db' />
                    <stop offset='52%' stopColor='#9a61ff' />
                    <stop offset='100%' stopColor='#37e8ff' />
                </linearGradient>
            </defs>

            {props.showRadialVisualizer && <>
                <circle
                    className='vor-radial-ring-shadow'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius}
                    pointerEvents='none'
                />
                <circle
                    className='vor-radial-ring'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius}
                    pointerEvents='none'
                />
                <circle
                    className='vor-radial-hit'
                    cx={radialCenterX}
                    cy={radialCenterY}
                    r={radialBaseRadius + 10}
                    fill='transparent'
                    stroke='transparent'
                    strokeWidth={10}
                    pointerEvents='stroke'
                    onPointerDown={event => beginRadialInteraction(event, 'move')}
                />
                <circle
                    className='vor-radial-handle'
                    cx={radialCenterX + radialHandleRadius}
                    cy={radialCenterY}
                    r={11}
                    onPointerDown={event => beginRadialInteraction(event, 'scale')}
                />
                <g className='vor-radial-group'>
                    {radialSegments.map((segment, index) => <React.Fragment key={index}>
                        <line
                            className='vor-radial-segment-glow'
                            x1={segment.x1}
                            y1={segment.y1}
                            x2={segment.x2}
                            y2={segment.y2}
                            stroke={segment.color}
                            strokeWidth={segment.glowWidth}
                            style={{ opacity: segment.glowOpacity }}
                        />
                        <line
                            className='vor-radial-segment'
                            x1={segment.x1}
                            y1={segment.y1}
                            x2={segment.x2}
                            y2={segment.y2}
                            stroke={segment.color}
                            strokeWidth={segment.strokeWidth}
                        />
                    </React.Fragment>)}
                </g>
            </>}

            {wavePath && <>
                <path className='vor-wave-shadow' d={wavePath} />
                <path className='vor-wave-line' d={wavePath} />
            </>}

            {props.showHistogramBars && <g className='vor-bar-group'>
                {barRects.map((bar, index) => <React.Fragment key={index}>
                    <rect
                        className='vor-bar'
                        x={bar.x}
                        y={bar.y}
                        width={barWidth}
                        height={bar.height}
                        rx={barWidth * 0.5}
                        ry={barWidth * 0.5}
                        style={{ opacity: bar.opacity }}
                    />
                    <rect
                        className='vor-bar-reflection'
                        x={bar.x}
                        y={bar.reflectionY}
                        width={barWidth}
                        height={bar.reflectionHeight}
                        rx={barWidth * 0.5}
                        ry={barWidth * 0.5}
                        style={{ opacity: bar.opacity * 0.34 }}
                    />
                </React.Fragment>)}
            </g>}
        </svg>
    </div>;
}

function VirusOnTheRockControls({ app }: { app: VirusOnTheRockApp }) {
    const state = useBehavior(app.state)!;
    const [pdbId, setPdbId] = React.useState(DefaultPdbId);

    const onStructureFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length > 0) await app.loadStructureFiles(files);
        event.target.value = '';
    };

    const onAudioFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) await app.loadAudioFile(file);
        event.target.value = '';
    };

    return <div className='vor-overlay'>
        <AudioVisualizerOverlay
            app={app}
            showWaveformLine={state.showWaveformLine}
            showHistogramBars={state.showHistogramBars}
            showRadialVisualizer={state.showRadialVisualizer}
        />

        <OverlayToggleDock app={app} state={state} />

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

            <ControlCard title='Load Structure'>
                <div className='vor-stack'>
                    <label className='vor-label' htmlFor='vor-pdb-id'>PDB ID</label>
                    <div className='vor-row'>
                        <input
                            id='vor-pdb-id'
                            className='vor-input'
                            value={pdbId}
                            onChange={e => setPdbId(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void app.loadPdb(pdbId); }}
                            placeholder='2plv'
                        />
                        <button className='vor-button vor-primary' onClick={() => void app.loadPdb(pdbId)}>Load</button>
                    </div>
                    <div className='vor-chip-row'>
                        {ExamplePdbIds.map(example => <button
                            key={example}
                            className={`vor-chip ${pdbId.toLowerCase() === example ? 'vor-active' : ''}`}
                            onClick={() => {
                                setPdbId(example);
                                void app.loadPdb(example);
                            }}
                        >
                            {example.toUpperCase()}
                        </button>)}
                    </div>
                    <label className='vor-label' htmlFor='vor-structure-file'>Browser File</label>
                    <input id='vor-structure-file' className='vor-file' type='file' multiple onChange={onStructureFileChange} />
                </div>
            </ControlCard>

            <ControlCard title='Audio'>
                <div className='vor-stack'>
                    <label className='vor-label' htmlFor='vor-audio-file'>Audio File</label>
                    <input id='vor-audio-file' className='vor-file' type='file' accept='.mp3,audio/*' onChange={onAudioFileChange} />
                    <div className='vor-button-row'>
                        <button
                            className='vor-button vor-primary'
                            onClick={() => state.audioPlaying ? app.pauseAudio() : void app.playAudio()}
                            disabled={!state.audioLoaded}
                        >
                            {state.audioPlaying ? 'Pause' : 'Play'}
                        </button>
                    </div>
                    <p className='vor-help'>
                        Loads <b>{DefaultAudioLabel}</b> by default from the examples folder, applies <b>{formatPresetLabel('bass-spectrum')}</b>, and tries to autoplay.
                    </p>
                </div>
            </ControlCard>

            <ControlCard title='Audio Presets'>
                <div className='vor-chip-row'>
                    {FeaturedPresetNames.map(name => <button
                        key={name}
                        className={`vor-chip ${state.activePreset === name ? 'vor-active' : ''}`}
                        onClick={() => void app.applyAudioPreset(name)}
                        title={AudioReactivePresetDefinitions.find(preset => preset.name === name)?.description}
                    >
                        {formatPresetLabel(name)}
                    </button>)}
                </div>
            </ControlCard>

            <ControlCard title='Visualizers'>
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
            </ControlCard>

            <ControlCard title='Axis Mode'>
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
                                className={`vor-chip ${state.axisSource === 'local' && state.localAxis === option.value ? 'vor-active' : ''}`}
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
                        <div className='vor-chip-row'>
                            <label className='vor-label'>tumbleTranslationSync</label>
                            <button
                                className={`vor-chip ${!state.tumbleTranslationSync ? 'vor-active' : ''}`}
                                onClick={() => void app.setTumbleTranslationSync(false)}
                            >
                                Off
                            </button>
                            <button
                                className={`vor-chip ${state.tumbleTranslationSync ? 'vor-active' : ''}`}
                                onClick={() => void app.setTumbleTranslationSync(true)}
                            >
                                On
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
            </ControlCard>

            <ControlCard title='Entries'>
                <details className='vor-disclosure'>
                    <summary>Loaded Structures</summary>
                    <div className='vor-stack'>
                        {state.loadedEntries.length > 0
                            ? state.loadedEntries.map(entry => <div key={entry.ref} className='vor-entry-row'>
                                <span className='vor-entry-label'>{entry.label}</span>
                                <button className='vor-chip' onClick={() => void app.removeStructure(entry.ref)}>Remove</button>
                            </div>)
                            : <p className='vor-help'>No structures loaded.</p>
                        }
                    </div>
                </details>
            </ControlCard>

            <ControlCard title='Effect Scales'>
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
                        <label htmlFor='vor-wiggle-scale'>Wiggle Effect Scale</label>
                        <output>{state.wiggleEffectScale.toFixed(2)}</output>
                        <input
                            id='vor-wiggle-scale'
                            type='range'
                            min='0'
                            max='4'
                            step='0.05'
                            value={state.wiggleEffectScale}
                            onChange={e => app.setEffectScale('wiggleEffectScale', parseFloat(e.target.value))}
                        />
                    </div>
                    <div className='vor-slider-row'>
                        <label htmlFor='vor-tumble-scale'>Tumble Effect Scale</label>
                        <output>{state.tumbleEffectScale.toFixed(2)}</output>
                        <input
                            id='vor-tumble-scale'
                            type='range'
                            min='0'
                            max='50'
                            step='0.05'
                            value={state.tumbleEffectScale}
                            onChange={e => app.setEffectScale('tumbleEffectScale', parseFloat(e.target.value))}
                        />
                    </div>
                    <div className='vor-slider-row'>
                        <label htmlFor='vor-axis-scale'>Axis Amplitude Scale</label>
                        <output>{state.assemblyAxisAmplitudeScale.toFixed(2)}</output>
                        <input
                            id='vor-axis-scale'
                            type='range'
                            min='0'
                            max='50'
                            step='0.05'
                            value={state.assemblyAxisAmplitudeScale}
                            onChange={e => app.setEffectScale('assemblyAxisAmplitudeScale', parseFloat(e.target.value))}
                        />
                    </div>
                </div>
            </ControlCard>
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
                    title={state.showSidebar ? "Hide Sidebar" : "Expand Sidebar"}
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
            <ControlCard title='Session' style={{ position: 'relative' }}>
                {/* Close button inside the widget */}
                <button
                    className="vor-chip vor-toggle-small"
                    onClick={() => app.setSessionInfoVisible(false)}
                    title="Hide Session Info"
                    style={{
                        position: 'absolute',
                        top: '14px',
                        right: '14px',
                        minWidth: '28px',
                        height: '28px',
                        padding: 0,
                        fontSize: '1.1rem'
                    }}
                >
                    ✕
                </button>

                <p className='vor-status-text'>{state.currentStructureLabel ?? 'No structure loaded yet.'}</p>
                <dl className='vor-status-grid'>
                    <div><dt>Audio</dt><dd>{state.currentAudioLabel ?? 'No track loaded'}</dd></div>
                    <div><dt>Playback</dt><dd>{state.audioPlaying ? 'Playing' : 'Stopped'}</dd></div>
                    <div><dt>Preset</dt><dd>{formatPresetLabel(state.activePreset)}</dd></div>
                    <div><dt>Axis Mode</dt><dd>{getAxisStatusLabel(state)}</dd></div>
                </dl>
            </ControlCard>
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

export async function mountVirusOnTheRockApp() {
    const pluginTarget = document.getElementById('plugin');
    const uiTarget = document.getElementById('ui');
    if (!pluginTarget || !uiTarget) throw new Error('Virus on the Rock app target elements were not found.');

    const app = await VirusOnTheRockApp.create(pluginTarget, uiTarget);
    (globalThis as typeof globalThis & { virusOnTheRock?: VirusOnTheRockApp }).virusOnTheRock = app;

    window.addEventListener('unload', () => app.dispose(), { once: true });
    return app;
}
