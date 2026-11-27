/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRoot, Root } from 'react-dom/client';
import { BehaviorSubject, Subscription } from 'rxjs';
import { AssemblySymmetryData, AssemblySymmetryDataProvider, AssemblySymmetryProvider } from '../../extensions/assembly-symmetry/prop';
import { getAssemblySymmetryConfig, tryCreateAssemblySymmetry } from '../../extensions/assembly-symmetry/behavior';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import { setSubtreeVisibility } from '../../mol-plugin/behavior/static/state';
import { Task } from '../../mol-task';
import { PresetStructureRepresentations } from '../../mol-plugin-state/builder/structure/representation-preset';
import { PluginConfig } from '../../mol-plugin/config';
import { clearStructureWiggle } from '../../mol-plugin-state/helpers/structure-wiggle';
import { DefaultAudioBandDefinitions } from '../../mol-plugin-state/manager/audio-reactor';
import { AudioReactivePresetName, getAudioReactivePreset, getPresetRoutes } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { audioAffectForEntry, getMesoscalePartLabel } from '../../mol-plugin-state/helpers/audio-affect';
import { type AudioAffect } from '../../mol-plugin-state/manager/audio-routing';
import { AudioReactiveAnimationManagerValues } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { AudioReactiveAssemblyAxisOrder } from '../../mol-plugin-state/helpers/assembly-symmetry-axis';
import { StructureRef } from '../../mol-plugin-state/manager/structure/hierarchy-state';
import { PluginStateObject } from '../../mol-plugin-state/objects';
import { StateObjectSelector, StateTransform } from '../../mol-state';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { StructureFromPetworld } from '../mesoscale-explorer/data/petworld/model';
import { CellpackAssembly, CellpackStructure } from '../mesoscale-explorer/data/cellpack/model';
import { getMesoscaleGroup, MesoscaleBaseTag } from '../../mol-plugin-state/helpers/mesoscale-part';
import { StructureElement, StructureProperties } from '../../mol-model/structure';
import { Color } from '../../mol-util/color';
import { Viewer } from '../viewer/app';
import { areAnimationPropsEqual, type AnimationProps, type ObjectTransformModeName, type TumbleAxisName } from '../../mol-geo/geometry/animation';
import { RandomStructurePdbIds } from './random-structures';
import { IcyTitleReader, SongChangeDetector, type SongChangeReason } from './song-change';
import { BeatCycle } from './beat-cycle';
import { BackgroundBaseColor, CpuChannels, type CpuChannelTarget } from './cpu-channels';
import { createCanvas3DChannelTarget } from './canvas3d-channel-target';
import { patchIfChanged } from './state-patch';
import { AudioUrlPresets, DefaultAudioFallbackLabel, DefaultAudioFallbackUrl, DefaultAudioLabel, DefaultAudioUrl, DefaultEffectKnobs, DefaultPdbId, DefaultPresetName, FrameRadiusPadding, LargeStructureElementThreshold, LargeStructureLodLevels, MesoscaleExample, MesoscaleExamples, NearClipAfterCameraReset, RepresentationMode, getBlobSurfaceTypeParams, getDefaultMultiScaleOcclusionProps, getPetworldGroups, getSpacefillTypeParams } from './catalog';
import { AxisCycleTarget, LoadedEntry, VirusOnTheRockState, createInitialState, getAssemblyOrderFromCycleTarget, getAxisAnimationPatch, getAxisOptions, getDefaultCycleTargets, getEnabledCycleOptions, getLocalAxisFromCycleTarget, getMotionTargetState, isLocalCycleTarget, sanitizeCycleTargets } from './state';
import { createRouteMotionsFollower } from './route-motions';
import { VirusOnTheRockControls } from './ui/controls';

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

function isPlaylistAudioUrl(url: string) {
    const lower = url.toLowerCase().split(/[?#]/, 1)[0];
    return lower.endsWith('.pls') || lower.endsWith('.m3u') || lower.endsWith('.m3u8');
}

function resolvePlaylistEntry(line: string, baseUrl: string) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) return;

    const plsMatch = /^File\d+=(.+)$/i.exec(trimmed);
    const value = plsMatch?.[1]?.trim() ?? trimmed;
    if (!/^https?:\/\//i.test(value)) return new URL(value, baseUrl).href;
    return value;
}

async function resolveAudioUrl(url: string) {
    if (!isPlaylistAudioUrl(url)) return url;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load playlist (${response.status}).`);

    const playlist = await response.text();
    for (const line of playlist.split(/\r?\n/)) {
        const entry = resolvePlaylistEntry(line, url);
        if (entry) return entry;
    }
    throw new Error('Playlist did not contain a playable audio URL.');
}

export class VirusOnTheRockApp {
    readonly state: BehaviorSubject<VirusOnTheRockState>;

    private readonly subscriptions = new Subscription();
    private readonly uiRoot: Root;
    private readonly configuredStructureVersions = new Map<string, string>();
    private readonly styledStructureVersions = new Map<string, string>();
    private cycleTargetsCustomized = false;
    private syncToken = 0;
    /** set while a batch of structures is built, which then syncs once at its end */
    private syncSuspended = false;
    /** the beat detector of the axis cycle; the app applies the target it steps to */
    private readonly beatCycle: BeatCycle;
    private beatCycleIndex = 0;
    /** the channels run on the CPU after each draw */
    private readonly channels: CpuChannels;
    private lastRandomPdbId: string | undefined;
    private songFeedMs = 0;

    private constructor(readonly viewer: Viewer, uiTarget: HTMLElement, channelTarget: CpuChannelTarget) {
        const params = this.viewer.plugin.managers.audioReactive.state.params.value;
        const animation = this.viewer.plugin.managers.structure.component.state.options.animation;
        this.state = new BehaviorSubject(createInitialState(params, animation));
        this.uiRoot = createRoot(uiTarget);
        this.beatCycle = new BeatCycle({
            canStep: () => this.isAxisCycleActive(),
            every: () => this.state.value.axisCycleEvery,
        });
        const audioReactive = this.viewer.plugin.managers.audioReactive;
        this.channels = new CpuChannels({
            drives: () => audioReactive.drives,
            clipEnabled: () => this.state.value.audioClipEnabled,
            clipScale: () => this.state.value.audioClipScale,
            now: () => performance.now(),
            target: channelTarget,
        });

        this.viewer.plugin.managers.dragAndDrop.addHandler('virus-on-the-rock', async (files) => {
            const audioFiles = files.filter(isAudioFile);
            const structureFiles = files.filter(file => !isAudioFile(file));

            if (audioFiles[0]) {
                await this.loadAudioFile(audioFiles[0]);
            }
            if (structureFiles.length > 0) {
                await this.loadStructureFiles(structureFiles);
            }

            return audioFiles.length > 0 || structureFiles.length > 0;
        });

        this.subscriptions.add(this.viewer.plugin.managers.structure.hierarchy.behaviors.selection.subscribe(() => {
            if (!this.syncSuspended) void this.syncSelectedStructure();
        }));
        this.subscriptions.add(this.viewer.plugin.managers.audioReactive.state.status.subscribe(status => {
            void this.updateAxisCycle(status);
            // without the stream's titles, new songs are estimated from the sound
            if (this.state.value.randomPerSong && !this.titleReaderActive && status.playing) {
                const now = performance.now();
                const dt = this.songFeedMs > 0 ? Math.min(200, now - this.songFeedMs) : 0;
                this.songFeedMs = now;
                const raw = status.frame.raw;
                this.songDetector.feed(DefaultAudioBandDefinitions.map(b => raw.frequencyBands[b.key]), raw.amplitude, dt);
            } else {
                this.songFeedMs = 0;
            }
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
        // a route that needs a motion that is off turns it on, when the route is added, enabled or retargeted
        const routeAudio = this.viewer.plugin.managers.audioReactive;
        const followRoutes = createRouteMotionsFollower(routeAudio.state.routes.value, {
            isOn: flag => this.state.value[flag],
            turnOn: flag => { void this.setMotionTargetEnabled(flag, true); },
        });
        this.subscriptions.add(routeAudio.state.routes.subscribe(routes => followRoutes(routes)));
        this.subscriptions.add(this.viewer.plugin.managers.audioReactive.state.params.subscribe(values => {
            this.patchState({
                wiggleEffectScale: values.wiggleEffectScale,
                tumbleEffectScale: values.tumbleEffectScale,
                objectTransformEffectScale: values.objectTransformEffectScale,
                assemblyAxisAmplitudeScale: values.assemblyAxisAmplitudeScale,
                beatThreshold: values.beatThreshold,
                lodScaleEnabled: values.lodScaleEnabled,
            });
        }));

        this.subscriptions.add(
            this.viewer.plugin.canvas3d!.didDraw.subscribe(() => this.channels.update())
        );

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
            viewportBackgroundColor: Color.toHexStyle(BackgroundBaseColor),
        });

        viewer.plugin.canvas3d?.setProps({
            illumination: { enabled: false },
            postprocessing: getDefaultMultiScaleOcclusionProps(),
        });

        viewer.plugin.config.set(
            PluginConfig.Structure.DefaultRepresentationPreset,
            PresetStructureRepresentations['mesoscale'].id);

        const app = new VirusOnTheRockApp(viewer, uiTarget, createCanvas3DChannelTarget(viewer.plugin.canvas3d!)); (window as any).__vorProbe = app; // read by data-local/tests/clicksync.mjs, sync.mjs and keep.mjs
        await app.initializeDefaults();
        return app;
    }

    private get currentStructureRef() {
        return this.viewer.plugin.managers.structure.hierarchy.selection.structures.find(s => !s.cell.transform.tags?.includes(MesoscaleBaseTag));
    }

    private isAxisCycleActive(state = this.state.value) {
        return state.axisModeEnabled
            && state.axisCycleEnabled
            && getEnabledCycleOptions(state).length > 1;
    }

    private patchState(patch: Partial<VirusOnTheRockState>) {
        const current = this.state.value;
        const next = patchIfChanged(current, patch);
        if (next !== current) this.state.next(next);
    }

    private async applyManualAxisSelection(state = this.state.value) {
        if (state.axisModeEnabled && state.axisSource === 'assembly') {
            this.viewer.plugin.managers.audioReactive.setParams({ assemblyAxisOrder: state.selectedAxisOrder });
        }
        await this.updateAnimationOptions(getAxisAnimationPatch(state));
    }

    private async applyCycleTarget(target: AxisCycleTarget) {
        if (isLocalCycleTarget(target)) {
            // Respect the current local/global frame; fall back to 'local' only when 'assembly' is active.
            const axisSource = this.state.value.axisSource === 'global' ? 'global' : 'local';
            await this.updateAnimationOptions({
                tumbleTranslationMode: 'axis',
                tumbleAxisSource: axisSource,
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
        await this.applyCurrentAnimationToScene();
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

        // the effect scales and beat threshold are the user's knobs, kept across presets: set once here
        this.viewer.plugin.managers.audioReactive.setParams(DefaultEffectKnobs);
        await this.applyAudioPreset(DefaultPresetName);
        await this.syncSelectedStructure();
    }

    private async loadDefaultAudio() {
        try {
            await this.viewer.plugin.managers.audioReactive.loadUrl(DefaultAudioUrl, DefaultAudioLabel);
        } catch {
            await this.viewer.plugin.managers.audioReactive.loadUrl(DefaultAudioFallbackUrl, DefaultAudioFallbackLabel);
        }
        try {
            await this.viewer.plugin.managers.audioReactive.play();
        } catch {
            this.viewer.plugin.log.message(`Default audio loaded, but autoplay was blocked. Use Play to start ${DefaultAudioLabel}.`);
        }
    }

    private async resetCamera(keepDirection = false) {
        await this.viewer.plugin.managers.animation.stop();
        const canvas3d = this.viewer.plugin.canvas3d;
        if (!canvas3d) return;
        // radius:0 -> show the full scene (no slab clipping); minNear:0 -> near plane unrestricted.
        canvas3d.setProps({ cameraClipping: { minNear: NearClipAfterCameraReset, radius: 0 } });

        // Lazy snapshot: bounding sphere is evaluated at apply time so we frame the
        // post-load scene, not a stale pre-load one. getFocus preserves the current
        // viewing direction while pulling the camera to the padded radius.
        canvas3d.requestCameraReset({
            snapshot: (scene, camera) => {
                const sphere = scene.boundingSphereVisible;
                if (!sphere || sphere.radius <= 0 || !isFinite(sphere.radius)) {
                    return { minNear: NearClipAfterCameraReset };
                }
                const paddedRadius = sphere.radius * FrameRadiusPadding;
                return { ...camera.getFocus(sphere.center, paddedRadius), minNear: NearClipAfterCameraReset };
            },
            durationMs: keepDirection ? 400 : 0,
        });
    }

    private resetAxisCycleRuntime() {
        this.beatCycle.reset();
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

        // Preserve 'global' frame if already active; otherwise default to 'local'.
        const axisSource = this.state.value.axisSource === 'global' ? 'global' as const : 'local' as const;
        const nextState = { ...this.state.value, axisSource, localAxis: axis };
        this.patchState({ axisSource, localAxis: axis });
        if (!nextState.axisCycleEnabled && nextState.axisModeEnabled) {
            await this.applyManualAxisSelection(nextState);
        }
    }

    async setAxisFrame(frame: 'local' | 'global') {
        if (this.state.value.axisSource === 'assembly') return;
        this.resetAxisCycleRuntime();

        const nextState = { ...this.state.value, axisSource: frame };
        this.patchState({ axisSource: frame });
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
            this.beatCycle.pause();
            return;
        }

        if (!this.beatCycle.feed(status.drives.symAxis, performance.now())) return;

        const cycleAxes = this.getCyclingAxes();
        if (cycleAxes.length <= 1) return;

        this.beatCycleIndex = (this.beatCycleIndex + 1) % cycleAxes.length;
        await this.applyCycleTarget(cycleAxes[this.beatCycleIndex].value);
    }

    private async ensureSpacefillRepresentation(structureRef: StructureRef) {
        const ref = structureRef.cell.transform.ref;
        const version = structureRef.cell.transform.version;
        if (this.styledStructureVersions.get(ref) === version) return;

        const plugin = this.viewer.plugin;
        const dataState = plugin.state.data;

        // Apply the mesoscale preset: single 'all' spacefill component with instance
        // granularity and tuned LOD. Large structures get vor's balanced LOD via the
        // post-walk override below.
        const preApply = this.getAllStructures().find(s => s.cell.transform.ref === ref) ?? structureRef;
        const existingComponents = preApply.components.map(c => c.cell.transform.ref);
        if (existingComponents.length > 0) {
            await plugin.managers.structure.hierarchy.remove(existingComponents, false);
        }
        await plugin.managers.structure.component.applyPreset(
            [preApply], PresetStructureRepresentations['mesoscale']);

        const styled = this.getAllStructures().find(s => s.cell.transform.ref === ref);
        if (!styled) return;

        const animation = plugin.managers.structure.component.state.options.animation;
        const structure = this.getDisplayedStructureData(styled);
        const applyLod = (structure?.elementCount ?? 0) > LargeStructureElementThreshold;

        const update = dataState.build();
        for (const component of styled.components) {
            for (const repr of component.representations) {
                update.to(repr.cell).update(old => {
                    old.type.params.ignoreLight = false;
                    if (old.type.params.animation) old.type.params.animation = animation;
                    if (applyLod && 'lodLevels' in old.type.params) {
                        old.type.params.lodLevels = LargeStructureLodLevels;
                    }
                });
            }
        }
        await update.commit();
        this.styledStructureVersions.set(ref, version);
    }

    // Applies the current animation options to every representation cell in the scene
    // that has an animation param (structures, volumes, texture-meshes, etc.).
    private async applyCurrentAnimationToScene() {
        const animation = this.viewer.plugin.managers.structure.component.state.options.animation;
        const update = this.viewer.plugin.state.data.build();
        let changed = false;

        for (const [, cell] of this.viewer.plugin.state.data.cells) {
            if (cell.status !== 'ok') continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const params = cell.transform.params as any;
            const current = params?.type?.params?.animation as AnimationProps | undefined;
            if (!current || areAnimationPropsEqual(current, animation)) continue;

            changed = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update.to(cell).update((old: any) => {
                old.type.params.animation = animation;
            });
        }

        if (changed) await update.commit();
    }

    private getDisplayedStructureData(structureRef: StructureRef) {
        return structureRef.transform?.cell.obj?.data ?? structureRef.cell.obj?.data;
    }

    /** every drawn structure: a cellPACK file's whole assembly, which its parts are cut from, is never drawn */
    private getAllStructures() {
        return this.viewer.plugin.managers.structure.hierarchy.current.structures
            .filter(s => !s.cell.transform.tags?.includes(MesoscaleBaseTag));
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

    private syncRunning: Promise<void> | undefined = void 0;
    private syncAgain = false;

    /**
     * One sync at a time: a sync asked for while one runs (its own edits fire the hierarchy selection) runs once after
     * it, rather than beside it, where two would restyle the same structure and update components the other removed
     */
    private syncSelectedStructure(): Promise<void> {
        if (this.syncRunning) {
            this.syncAgain = true;
            return this.syncRunning;
        }
        const run = async () => {
            try {
                // its own edits ask again once; a bound so a sync that keeps editing cannot loop
                for (let pass = 0; pass < 3; pass++) {
                    this.syncAgain = false;
                    await this.runSelectedStructureSync();
                    if (!this.syncAgain) break;
                }
            } finally {
                this.syncRunning = void 0;
            }
        };
        this.syncRunning = run();
        return this.syncRunning;
    }

    private async runSelectedStructureSync() {
        const token = ++this.syncToken;
        // structure presets always build spacefill, so re-assert the chosen representation
        await this.setRepresentationMode(this.state.value.representationMode);
        if (token !== this.syncToken) return;
        const allStructures = this.getAllStructures();
        if (allStructures.length === 0) {
            this.patchState({
                currentStructureLabel: void 0,
                loadedEntries: [],
                audioLoaded: this.state.value.audioLoaded,
                axisOptions: [],
                hasAssemblyAxes: false,
                cycleTargets: this.cycleTargetsCustomized ? sanitizeCycleTargets(this.state.value.cycleTargets, []) : [],
                activeCycleTarget: void 0,
            });
            return;
        }

        for (const structure of allStructures) {
            await this.ensureSpacefillRepresentation(structure);
            if (token !== this.syncToken) return;
        }
        // a structure just styled has the preset's spacefill: give it the chosen mode too
        await this.setRepresentationMode(this.state.value.representationMode);
        if (token !== this.syncToken) return;

        const structureRef = this.currentStructureRef ?? allStructures[0];
        if (token !== this.syncToken) return;

        // every structure explodes along its own axes: each needs its symmetry, not only the current one
        for (const s of allStructures) {
            await this.ensureAssemblySymmetry(s);
            if (token !== this.syncToken) return;
        }

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
            loadedEntries: allStructures.map(structure => this.getLoadedEntry(structure)),
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

    /** the PDB capsids and the mesoscale examples, never the one shown last twice in a row */
    private pickRandomModel() {
        const ids: string[] = [...RandomStructurePdbIds.map(id => id.trim().toLowerCase()).filter(Boolean), ...MesoscaleExamples.filter(e => !e.localOnly && !e.notRandom).map(e => e.id)];
        if (ids.length === 0) return;
        const candidates = ids.length > 1 && this.lastRandomPdbId
            ? ids.filter(id => id !== this.lastRandomPdbId)
            : ids;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /** A random model in place of the current ones; its PDB ID, or the example's label */
    async loadRandomModel() {
        const id = this.pickRandomModel();
        if (!id) return;
        this.lastRandomPdbId = id;
        const example = MesoscaleExamples.find(e => e.id === id);
        this.patchState({ loadingModel: example?.label ?? id.toUpperCase() });
        try {
            if (example) await this.loadMesoscaleExample(example);
            else await this.loadPdb(id, true);
        } finally {
            this.patchState({ loadingModel: void 0 });
        }
        return example ? example.label : id;
    }

    /**
     * A mesoscale example in place of the current models: every model of the file (one per protein in Petworld's) as
     * its assembly, in place, all together making the virion
     */
    async loadMesoscaleExample(example: MesoscaleExample) {
        const plugin = this.viewer.plugin;
        const previousRefs = this.getAllStructures().map(structure => structure.cell.transform.ref);
        this.patchState({ loadingModel: example.label });
        try {
            // a whole virion is millions of atoms: spacefill with its LOD rather than the blob surface (one CPU mesh
            // per unit, no LOD), the previous models and their files gone before the new one is even downloaded, one
            // sync at the end
            this.syncSuspended = true;
            this.syncToken += 1; // cancels a sync in flight
            if (previousRefs.length) {
                await plugin.managers.structure.hierarchy.remove(previousRefs, false);
                await this.pruneDataWithoutStructures();
            }
            const data = await plugin.builders.data.download({ url: example.url, isBinary: example.isBinary, label: example.label });
            const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
            const tr = trajectory.obj?.data;
            if (this.modeBeforeMesoscale === void 0) this.modeBeforeMesoscale = this.state.value.representationMode;
            this.patchState({ representationMode: 'spacefill' });
            const petworld = tr ? await getPetworldGroups(tr) : [];
            if (petworld.length) {
                // Petworld's assembly places each model by its own operator group (`PDB_model_num`): the standard
                // assembly ignores that and gave every model the whole virion's operators, each model a full virion
                const update = plugin.state.data.build();
                for (const group of petworld) {
                    update.to(trajectory).apply(StructureFromPetworld, group);
                }
                await update.commit();
            } else if (tr) {
                await this.buildCellpackParts(trajectory);
            }
            this.syncSuspended = false;
            await this.syncSelectedStructure();
            await this.applyAudioPreset(this.state.value.activePreset, 'keep');
            await this.resetCamera(true);
        } finally {
            this.syncSuspended = false;
            this.patchState({ loadingModel: void 0 });
        }
    }

    /**
     * A cellPACK file as the mesoscale explorer builds it: its whole assembly (tagged, never drawn) and one structure per
     * entity cut from it, sharing its units, so the parts cost no copy of the atoms
     */
    private async buildCellpackParts(trajectory: StateObjectSelector<PluginStateObject.Molecule.Trajectory>) {
        const plugin = this.viewer.plugin;
        const model = await plugin.builders.structure.createModel(trajectory, { modelIndex: 0 });
        const entities = model.data?.entities.data;
        if (!entities) return;
        const base = await plugin.state.data.build()
            .to(model)
            .apply(CellpackAssembly, { id: '' }, { tags: [MesoscaleBaseTag] })
            .commit();
        // only the entities the assembly places: one it does not would be an empty part, a dead row
        const placed = new Set<string>();
        const assembly = base.data;
        if (assembly) {
            const location = StructureElement.Location.create(assembly);
            for (const group of assembly.unitSymmetryGroups) {
                location.unit = group.units[0];
                location.element = group.units[0].elements[0];
                placed.add(StructureProperties.entity.id(location));
            }
        }
        const update = plugin.state.data.build();
        for (let i = 0; i < entities._rowCount; i++) {
            const entityId = entities.id.value(i);
            if (!placed.has(entityId)) continue;
            update.toRoot().apply(CellpackStructure, { structureRef: base.ref, entityId }, { dependsOn: [base.ref] });
        }
        await update.commit();
    }

    /** the mode chosen before a mesoscale example switched to spacefill, given back at the next other load */
    private modeBeforeMesoscale: RepresentationMode | undefined = void 0;
    private restoreModeAfterMesoscale() {
        if (this.modeBeforeMesoscale === void 0) return;
        this.patchState({ representationMode: this.modeBeforeMesoscale });
        this.modeBeforeMesoscale = void 0;
    }

    private readonly songDetector = new SongChangeDetector(reason => void this.onSongChange(reason));
    private readonly titleReader = new IcyTitleReader();
    private songChangeBusy = false;

    /** Random at each new song: on loads one now, then a new one whenever a song starts */
    async setRandomPerSong(on: boolean) {
        this.patchState({ randomPerSong: on, songChangeNote: on ? 'Next model at the next song.' : void 0 });
        this.songDetector.reset();
        if (!on) {
            this.titleReader.stop();
            return;
        }
        await this.startTitleReader();
        await this.loadRandomModel();
    }

    /** the stream's titles where the server allows reading them; the estimate from the sound otherwise */
    private async startTitleReader() {
        this.titleReader.stop();
        const audio = this.viewer.plugin.managers.audioReactive.state.audioPlayer.value;
        const src = audio?.src;
        if (!src || !/^https?:/.test(src) || !this.state.value.randomPerSong) return;
        const reading = await this.titleReader.start(src, title => void this.onSongChange('title', title));
        this.titleReaderActive = reading;
    }
    private titleReaderActive = false;

    private async onSongChange(reason: SongChangeReason, title?: string) {
        if (!this.state.value.randomPerSong || this.songChangeBusy) return;
        this.songChangeBusy = true;
        this.songDetector.reset();
        try {
            const loaded = await this.loadRandomModel();
            const how = reason === 'title' ? `new title${title ? `: ${title}` : ''}`
                : reason === 'source' ? 'new audio source'
                    : reason === 'gap' ? 'a gap in the sound (estimated)'
                        : 'the sound changed (estimated)';
            this.patchState({ songChangeNote: `${loaded ?? 'New model'}, on ${how}.` });
        } finally {
            this.songChangeBusy = false;
        }
    }

    async loadPdb(id: string, replaceCurrent = false) {
        const pdbId = id.trim();
        if (!pdbId) return;
        this.restoreModeAfterMesoscale();
        const previousRefs = new Set(this.getAllStructures().map(structure => structure.cell.transform.ref));
        await this.viewer.loadPdb(pdbId);
        const newStructures = this.getAllStructures().filter(structure => !previousRefs.has(structure.cell.transform.ref));
        if (replaceCurrent && newStructures.length > 0 && previousRefs.size > 0) {
            await this.viewer.plugin.managers.structure.hierarchy.remove([...previousRefs], false);
            await this.pruneDataWithoutStructures();
        }
        await this.placeNewStructuresOnGrid(newStructures);
        await this.syncSelectedStructure();
        await this.applyAudioPreset(this.state.value.activePreset, 'keep');
        await this.resetCamera(replaceCurrent);
    }

    async loadStructureFiles(files: File[]) {
        if (files.length === 0) return;
        this.restoreModeAfterMesoscale();
        const previousRefs = new Set(this.getAllStructures().map(structure => structure.cell.transform.ref));
        await this.viewer.loadFiles(files);
        const newStructures = this.getAllStructures().filter(structure => !previousRefs.has(structure.cell.transform.ref));
        await this.placeNewStructuresOnGrid(newStructures);
        await this.syncSelectedStructure();
        await this.applyAudioPreset(this.state.value.activePreset, 'keep');
        await this.resetCamera();
    }

    async loadAudioFile(file: File) {
        await this.applyAudioPreset(this.state.value.activePreset, 'keep');
        await this.viewer.plugin.managers.audioReactive.loadFile(file);
        await this.playAudio();
        await this.onNewAudioSource();
    }

    /** a new song by definition: a new model where Random is on, and the titles of the new stream */
    private async onNewAudioSource() {
        if (!this.state.value.randomPerSong) return;
        await this.startTitleReader();
        await this.onSongChange('source');
    }

    async loadAudioUrl(url: string, label?: string) {
        const audioUrl = url.trim();
        if (!audioUrl) return;
        const preset = AudioUrlPresets.find(item => item.url === audioUrl);
        const audioLabel = label ?? preset?.label ?? audioUrl;
        const playableUrl = await resolveAudioUrl(audioUrl);
        await this.applyAudioPreset(this.state.value.activePreset, 'keep');
        await this.viewer.plugin.managers.audioReactive.loadUrl(playableUrl, audioLabel);
        await this.playAudio();
        await this.onNewAudioSource();
    }

    async playAudio() {
        await this.viewer.plugin.managers.audioReactive.play();
    }

    pauseAudio() {
        this.viewer.plugin.managers.audioReactive.pause();
    }

    /**
     * Applies a preset's analysis and motion shapes, and its routes when `routes` is 'replace' (the user picked the
     * preset). Loading a model or a song passes 'keep': the routes are the user's (the route editor, the Saved list),
     * and a load must never replace them.
     */
    async applyAudioPreset(name: AudioReactivePresetName, routes: 'replace' | 'keep' = 'replace') {
        const preset = getAudioReactivePreset(name);
        if (routes === 'replace') this.viewer.plugin.managers.audioReactive.setRoutes(getPresetRoutes(preset));
        const current = this.state.value;
        this.viewer.plugin.managers.audioReactive.setParams({
            ...preset.analysis,
            assemblyAxisOrder: current.selectedAxisOrder,
            wiggleEffectScale: current.wiggleEffectScale,
            tumbleEffectScale: current.tumbleEffectScale,
            objectTransformEffectScale: current.objectTransformEffectScale,
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
        await this.applyCurrentAnimationToScene();
        this.patchState({
            activePreset: name,
            ...getMotionTargetState({
                ...options.animation,
                ...preset.animation,
                ...getAxisAnimationPatch(current),
            })
        });
    }

    async setMotionTargetEnabled(target: 'atomWiggleEnabled' | 'instanceTumbleEnabled' | 'objectTransformEnabled', enabled: boolean) {
        await this.updateAnimationOptions({ [target]: enabled } as Partial<AnimationProps>);
        this.patchState({ [target]: enabled } as Partial<VirusOnTheRockState>);
    }

    /**
     * Swap every structure representation between the mesoscale spacefill preset and a coarse blob
     * surface. The previous `type` block is remembered per node so switching back is lossless.
     */
    /** the user's pick: it stays over the next loads, no mode to give back after a mesoscale example */
    async chooseRepresentationMode(mode: RepresentationMode) {
        this.modeBeforeMesoscale = void 0;
        await this.setRepresentationMode(mode);
    }

    async setRepresentationMode(mode: RepresentationMode) {
        const plugin = this.viewer.plugin;

        // Record the mode before committing: the commit below mutates the state tree, which fires
        // `hierarchy.behaviors.selection` and re-enters `syncSelectedStructure` -> this method. If
        // the state still held the previous mode at that point, the re-entrant call would undo the
        // switch. With the state already updated the re-entrant call hits the idempotent guard.
        this.patchState({ representationMode: mode });

        const cells = plugin.state.data.selectQ(q => q.ofType(PluginStateObject.Molecule.Structure.Representation3D));
        if (cells.length === 0) return;

        const update = plugin.state.data.build();
        for (const cell of cells) {
            const ref = cell.transform.ref;
            // the committed params, not the update's draft: the draft is a proxy revoked once the update ends, and
            // reading it on the way back to spacefill threw ("proxy that has been revoked"), leaving the blob
            const committedType = (cell.transform.params as any)?.type;
            update.to(ref).update((old: any) => {
                if (!old?.type) return;
                // idempotent: re-applying the current mode must not rebuild the geometry
                if (mode === 'blob-surface') {
                    if (old.type.name === 'blob-surface') return;
                    if (committedType?.name !== 'blob-surface') this.spacefillTypeCache.set(ref, committedType);
                    old.type = getBlobSurfaceTypeParams();
                } else {
                    if (old.type.name !== 'blob-surface') return;
                    old.type = this.spacefillTypeCache.get(ref) ?? getSpacefillTypeParams();
                }
            });
        }
        await update.commit();
    }

    private spacefillTypeCache = new Map<string, any>();

    async setObjectTransformMode(mode: ObjectTransformModeName) {
        await this.updateAnimationOptions({ objectTransformMode: mode });
        this.patchState({ objectTransformMode: mode });
    }

    async setAxisOrder(order: AudioReactiveAssemblyAxisOrder) {
        this.patchState({ selectedAxisOrder: order });

        if (!this.state.value.axisCycleEnabled && this.state.value.axisModeEnabled && this.state.value.axisSource === 'assembly') {
            await this.applyManualAxisSelection({ ...this.state.value, selectedAxisOrder: order });
        }
    }

    setEffectScale(key: 'wiggleEffectScale' | 'tumbleEffectScale' | 'objectTransformEffectScale' | 'assemblyAxisAmplitudeScale', value: number) {
        this.viewer.plugin.managers.audioReactive.setParams({ [key]: value } as Partial<AudioReactiveAnimationManagerValues>);
    }

    setBeatThreshold(value: number) {
        this.viewer.plugin.managers.audioReactive.setParams({ beatThreshold: value });
    }

    setLodScaleEnabled(enabled: boolean) {
        this.viewer.plugin.managers.audioReactive.setParams({ lodScaleEnabled: enabled });
    }

    setAudioClipEnabled(enabled: boolean) {
        this.channels.setClipEnabled(enabled);
        this.patchState({ audioClipEnabled: enabled });
    }

    setAudioClipScale(value: number) {
        this.patchState({ audioClipScale: value });
    }

    async removeStructure(ref: string) {
        await this.removeStructures([ref]);
    }

    async removeStructures(refs: string[]) {
        await this.viewer.plugin.managers.structure.hierarchy.remove(refs, false);
        await this.pruneDataWithoutStructures();
        await this.syncSelectedStructure();
        await this.resetCamera();
    }

    /** the downloads left with no structure under them: their parsed file is the bulk of a mesoscale example */
    private async pruneDataWithoutStructures() {
        const state = this.viewer.plugin.state.data;
        const update = state.build();
        let any = false;
        // the cellPACK parts left, by the whole assembly each is cut from
        const usedBases = new Set<string>();
        for (const cell of state.selectQ(q => q.ofTransformer(CellpackStructure))) {
            usedBases.add((cell.transform.params as { structureRef: string }).structureRef);
        }
        for (const ref of state.tree.children.get(StateTransform.RootRef).toArray()) {
            const hasTrajectory = state.selectQ(q => q.byRef(ref).subtree().ofType(PluginStateObject.Molecule.Trajectory)).length > 0;
            if (!hasTrajectory) continue;
            const structures = state.selectQ(q => q.byRef(ref).subtree().ofType(PluginStateObject.Molecule.Structure));
            const kept = structures.some(cell => !cell.transform.tags?.includes(MesoscaleBaseTag) || usedBases.has(cell.transform.ref));
            if (kept) continue;
            update.delete(ref);
            any = true;
        }
        if (any) await update.commit();
    }

    /** a structure's row: a mesoscale part is named for its protein (and membrane) under its example */
    private getLoadedEntry(structure: StructureRef): LoadedEntry {
        const ref = structure.cell.transform.ref;
        const data = structure.cell.obj?.data;
        const cellLabel = structure.cell.obj?.label ?? ref;
        if (structure.model || !data) return { ref, label: getStructureLabel(structure) ?? cellLabel };
        return { ref, label: getMesoscalePartLabel(data, cellLabel), group: getMesoscaleGroup(this.viewer.plugin.state.data, structure.cell) };
    }

    /** hides or shows these structures in the viewer */
    setEntriesHidden(refs: string[], hidden: boolean) {
        for (const ref of refs) setSubtreeVisibility(this.viewer.plugin.state.data, ref, hidden);
    }

    isEntryHidden(ref: string) {
        return !!this.viewer.plugin.state.data.cells.get(ref)?.state.isHidden;
    }

    /** a model-level Who for one row: a structure's mesoscale part (else its model), or a group of parts */
    getEntryAffect(ref: string): AudioAffect | undefined {
        return audioAffectForEntry(this.viewer.plugin, ref);
    }

    dispose() {
        this.viewer.plugin.managers.dragAndDrop.removeHandler('virus-on-the-rock');
        this.subscriptions.unsubscribe();
        this.uiRoot.unmount();
        this.viewer.dispose();
    }
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
