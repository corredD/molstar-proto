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
import { setSubtreeVisibility } from '../../mol-plugin/behavior/static/state';
import { PostprocessingParams } from '../../mol-canvas3d/passes/postprocessing';
import { SsaoParams } from '../../mol-canvas3d/passes/ssao';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Task } from '../../mol-task';
import { useBehavior } from '../../mol-plugin-ui/hooks/use-behavior';
import { PresetStructureRepresentations } from '../../mol-plugin-state/builder/structure/representation-preset';
import { clearStructureWiggle } from '../../mol-plugin-state/helpers/structure-wiggle';
import { AudioReactivePresetDefinitions, AudioReactivePresetName, getAudioReactivePreset } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { AudioReactiveAnimationManagerValues } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { AudioReactiveAssemblyAxisOrder } from '../../mol-plugin-state/helpers/assembly-symmetry-axis';
import { StructureRef } from '../../mol-plugin-state/manager/structure/hierarchy-state';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { StructureRepresentation3D } from '../../mol-plugin-state/transforms/representation';
import { Viewer } from '../viewer/app';
import { areAnimationPropsEqual } from '../../mol-geo/geometry/animation';

type AxisOption = {
    value: AudioReactiveAssemblyAxisOrder,
    label: string,
};

type VirusOnTheRockState = {
    activePreset: AudioReactivePresetName,
    currentStructureLabel?: string,
    currentAudioLabel?: string,
    loadedEntries: { ref: string, label: string }[],
    audioLoaded: boolean,
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

function createInitialState(params: AudioReactiveAnimationManagerValues): VirusOnTheRockState {
    return {
        activePreset: 'bass-spectrum',
        loadedEntries: [],
        audioLoaded: false,
        axisOptions: [],
        selectedAxisOrder: params.assemblyAxisOrder,
        wiggleEffectScale: params.wiggleEffectScale,
        tumbleEffectScale: params.tumbleEffectScale,
        assemblyAxisAmplitudeScale: params.assemblyAxisAmplitudeScale,
        beatThreshold: 0.05,
        audioPlaying: false,
        hasAssemblyAxes: false,
        axisCycleEnabled: false,
        axisCycleEvery: 1,
    };
}

export class VirusOnTheRockApp {
    readonly state: BehaviorSubject<VirusOnTheRockState>;

    private readonly subscriptions = new Subscription();
    private readonly uiRoot: Root;
    private readonly configuredStructureVersions = new Map<string, string>();
    private readonly styledStructureVersions = new Map<string, string>();
    private syncToken = 0;
    private cameraSpinHandle: number | undefined;
    private lastCameraSpinTimestamp: number | undefined;
    private beatTriggerActive = false;
    private beatCycleCount = 0;
    private beatCycleIndex = 0;

    private constructor(readonly viewer: Viewer, uiTarget: HTMLElement) {
        const params = this.viewer.plugin.managers.audioReactive.state.params.value;
        this.state = new BehaviorSubject(createInitialState(params));
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
            this.updateAxisCycle(status);
            this.patchState({
                currentAudioLabel: status.sourceLabel,
                audioLoaded: status.loaded,
                audioPlaying: status.playing,
            });
        }));
        this.subscriptions.add(this.viewer.plugin.managers.audioReactive.state.params.subscribe(values => {
            this.patchState({
                selectedAxisOrder: values.assemblyAxisOrder,
                wiggleEffectScale: values.wiggleEffectScale,
                tumbleEffectScale: values.tumbleEffectScale,
                assemblyAxisAmplitudeScale: values.assemblyAxisAmplitudeScale,
                beatThreshold: values.beatThreshold,
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

    private patchState(patch: Partial<VirusOnTheRockState>) {
        this.state.next({ ...this.state.value, ...patch });
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

    private getCyclingAxes() {
        return getCyclingAxisOptions(this.state.value.axisOptions);
    }

    setCycleEnabled(enabled: boolean) {
        this.resetAxisCycleRuntime();
        this.patchState({ axisCycleEnabled: enabled });

        if (!enabled) return;

        const cycleAxes = this.getCyclingAxes();
        if (cycleAxes.length === 0) return;

        this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: cycleAxes[0].value });
    }

    setCycleEvery(value: number) {
        this.resetAxisCycleRuntime();
        this.patchState({ axisCycleEvery: value });
    }

    private updateAxisCycle(status: ReturnType<typeof this.viewer.plugin.managers.audioReactive.state.status.getValue>) {
        if (!status.playing) {
            this.beatTriggerActive = false;
            return;
        }

        const beatActive = status.frame.beatIntensity >= this.state.value.beatThreshold;
        const shouldAdvance = this.state.value.axisCycleEnabled && beatActive && !this.beatTriggerActive;
        this.beatTriggerActive = beatActive;

        if (!shouldAdvance) return;

        const cycleAxes = this.getCyclingAxes();
        if (cycleAxes.length <= 1) return;

        this.beatCycleCount += 1;
        if (this.beatCycleCount % this.state.value.axisCycleEvery !== 0) return;

        this.beatCycleIndex = (this.beatCycleIndex + 1) % cycleAxes.length;
        this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: cycleAxes[this.beatCycleIndex].value });
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
        const selectedAxisOrder = this.viewer.plugin.managers.audioReactive.state.params.value.assemblyAxisOrder;
        const cycleAxes = getCyclingAxisOptions(axisOptions);
        const cycleEnabled = this.state.value.axisCycleEnabled && cycleAxes.length > 1;
        const nextAxisOrder = cycleEnabled
            ? cycleAxes[0]?.value ?? selectedAxisOrder
            : axisOptions.some(option => option.value === selectedAxisOrder)
                ? selectedAxisOrder
                : axisOptions[0]?.value ?? selectedAxisOrder;

        if (nextAxisOrder !== selectedAxisOrder) {
            this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: nextAxisOrder });
        }

        if (cycleEnabled) this.resetAxisCycleRuntime();

        this.patchState({
            currentStructureLabel: getStructureLabel(structureRef),
            loadedEntries: allStructures.map(structure => ({
                ref: structure.cell.transform.ref,
                label: getStructureLabel(structure) ?? structure.cell.obj?.label ?? structure.cell.transform.ref
            })),
            axisOptions,
            hasAssemblyAxes: axisOptions.length > 0,
            selectedAxisOrder: nextAxisOrder,
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
            assemblyAxisAmplitudeScale: current.assemblyAxisAmplitudeScale,
            beatThreshold: current.beatThreshold,
        });

        const options = this.viewer.plugin.managers.structure.component.state.options;
        await this.viewer.plugin.managers.structure.component.setOptions({
            ...options,
            animation: {
                ...options.animation,
                ...preset.animation,
            }
        });
        await clearStructureWiggle(this.viewer.plugin, this.currentComponents);
        this.patchState({ activePreset: name });
    }

    setAxisOrder(order: AudioReactiveAssemblyAxisOrder) {
        this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: order });

        const cycleAxes = this.getCyclingAxes();
        const cycleIndex = cycleAxes.findIndex(option => option.value === order);
        if (cycleIndex >= 0) {
            this.beatCycleIndex = cycleIndex;
            this.beatCycleCount = 0;
            this.beatTriggerActive = false;
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
        <div className='vor-controls'>
            <ControlCard className='vor-title'>
                <h1>Virus on the Rock</h1>
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

            <ControlCard title='Assembly Axis'>
                {state.hasAssemblyAxes
                    ? <div className='vor-stack'>
                        <div className='vor-chip-row'>
                            <button
                                className={`vor-chip ${!state.axisCycleEnabled ? 'vor-active' : ''}`}
                                onClick={() => app.setCycleEnabled(false)}
                            >
                                Manual
                            </button>
                            <button
                                className={`vor-chip ${state.axisCycleEnabled ? 'vor-active' : ''}`}
                                onClick={() => app.setCycleEnabled(true)}
                                disabled={getCyclingAxisOptions(state.axisOptions).length <= 1}
                            >
                                Beat Cycle
                            </button>
                        </div>
                        <div className='vor-chip-row'>
                            {state.axisOptions.map(option => <button
                                key={option.value}
                                className={`vor-chip ${state.selectedAxisOrder === option.value ? 'vor-active' : ''}`}
                                onClick={() => app.setAxisOrder(option.value)}
                            >
                                {option.label}
                            </button>)}
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
                            Beat Cycle ignores the <b>Auto</b> axis and rotates through the available explicit orders, highest to lowest, on every Nth detected beat.
                        </p>
                    </div>
                    : <p className='vor-help'>No assembly symmetry axes available on the current structure. Audio tumble will fall back to the default non-axis behavior.</p>
                }
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
        </div>

        <div className='vor-status'>
            <ControlCard title='Session'>
                <p className='vor-status-text'>{state.currentStructureLabel ?? 'No structure loaded yet.'}</p>
                <dl className='vor-status-grid'>
                    <div>
                        <dt>Audio</dt>
                        <dd>{state.currentAudioLabel ?? 'No track loaded'}</dd>
                    </div>
                    <div>
                        <dt>Playback</dt>
                        <dd>{state.audioPlaying ? 'Playing' : 'Stopped'}</dd>
                    </div>
                    <div>
                        <dt>Preset</dt>
                        <dd>{formatPresetLabel(state.activePreset)}</dd>
                    </div>
                    <div>
                        <dt>Axis Mode</dt>
                        <dd>{state.hasAssemblyAxes ? `${state.axisCycleEnabled ? 'Beat Cycle' : 'Manual'} · ${state.axisOptions.find(option => option.value === state.selectedAxisOrder)?.label ?? 'Auto'}` : 'Fallback'}</dd>
                    </div>
                </dl>
            </ControlCard>
        </div>
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
