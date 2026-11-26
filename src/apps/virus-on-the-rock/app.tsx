/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { BehaviorSubject, Subscription } from 'rxjs';
import { AssemblySymmetryData, AssemblySymmetryDataProvider, AssemblySymmetryProvider, AssemblySymmetryValue } from '../../extensions/assembly-symmetry/prop';
import { getAssemblySymmetryConfig, tryCreateAssemblySymmetry } from '../../extensions/assembly-symmetry/behavior';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import type { Canvas3D } from '../../mol-canvas3d/canvas3d';
import { Vec4 } from '../../mol-math/linear-algebra/3d/vec4';
import { setSubtreeVisibility } from '../../mol-plugin/behavior/static/state';
import { PostprocessingParams } from '../../mol-canvas3d/passes/postprocessing';
import { SsaoParams } from '../../mol-canvas3d/passes/ssao';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Task } from '../../mol-task';
import { useBehavior } from '../../mol-plugin-ui/hooks/use-behavior';
import { PresetStructureRepresentations } from '../../mol-plugin-state/builder/structure/representation-preset';
import { PluginConfig } from '../../mol-plugin/config';
import { clearStructureWiggle } from '../../mol-plugin-state/helpers/structure-wiggle';
import { BlobSurfaceRepresentationProvider } from '../../mol-repr/structure/representation/blob-surface';
import { SpacefillRepresentationProvider } from '../../mol-repr/structure/representation/spacefill';
import { DefaultAudioBandDefinitions } from '../../mol-plugin-state/manager/audio-reactor';
import { AudioProminenceRadar } from '../../mol-plugin-ui/controls/audio-prominence-radar';
import { AudioReactivePresetDefinitions, AudioReactivePresetName, getAudioReactivePreset, getPresetRoutes } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { InspiredRoutings } from '../../mol-plugin-state/helpers/audio-routing-inspired';
import { audioAffectForEntry, describeAudioAffect, getMesoscalePartLabel, listAudioAffectChoices } from '../../mol-plugin-state/helpers/audio-affect';
import { AudioAffectLevels, AudioRouteCurves, AudioRouteSources, AudioRouteTargets, canonicalAudioAffect, createAudioRoute, draftsFromRoutes, getAudioRouteSourceLabel, maxScopeLevel, getAudioRouteTargetLabel, getDefaultAudioRoutes, loadStoredAudioRouting, parseAudioRouting, routesFromDrafts, storeAudioRouting, type AudioAffect, type AudioRoute, type AudioRouteDraft, type AudioRoutingPreset } from '../../mol-plugin-state/manager/audio-routing';
import { AudioReactiveAnimationManagerValues, type AudioReactiveStatus, getStemDelaySeconds } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { StemModelIds, StemModels, type StemName, StemNames } from '../../mol-plugin-state/manager/audio-stems/stem-models';
import { AudioReactiveAssemblyAxisOrder } from '../../mol-plugin-state/helpers/assembly-symmetry-axis';
import { StructureRef } from '../../mol-plugin-state/manager/structure/hierarchy-state';
import { PluginStateObject } from '../../mol-plugin-state/objects';
import { StateObjectSelector, StateTransform } from '../../mol-state';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { StructureFromPetworld } from '../mesoscale-explorer/data/petworld/model';
import { CellpackAssembly, CellpackStructure } from '../mesoscale-explorer/data/cellpack/model';
import { getMesoscaleGroup, MesoscaleBaseTag } from '../../mol-plugin-state/helpers/mesoscale-part';
import { MmcifFormat } from '../../mol-model-formats/structure/mmcif';
import { StructureElement, StructureProperties, Trajectory } from '../../mol-model/structure';
import { Color } from '../../mol-util/color';
import { Viewer } from '../viewer/app';
import { areAnimationPropsEqual, type AnimationProps, type ObjectTransformModeName, type TumbleAxisName, type TumbleAxisSourceName } from '../../mol-geo/geometry/animation';
import { RandomStructurePdbIds } from './random-structures';
import { IcyTitleReader, SongChangeDetector, type SongChangeReason } from './song-change';
import { BeatCycle } from './beat-cycle';
import { BackgroundBaseColor, CpuChannels, type CpuChannelTarget } from './cpu-channels';

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

const DefaultPdbId = '2tbv';
const DefaultAudioUrl = 'https://radio-proxy.ludomolgraphlab.workers.dev/lesonparisien/';
/** Local file used when the live stream cannot be reached (offline, proxy down, CORS). */
const DefaultAudioFallbackUrl = 'examples/angine.mp3';
const DefaultAudioLabel = 'Le Son Parisien';
const DefaultAudioFallbackLabel = 'angine.mp3';
const NearClipAfterCameraReset = 0;
// Multiplier applied to the visible bounding-sphere radius when framing.
// >1 = camera pulled back so the structure isn't filling the viewport.
const FrameRadiusPadding = 1.3;
const AudioUrlPresets = [
    { label: 'Plus FM', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/plusfm/' },
    { label: 'Public Domain - Maple Leaf Rag', url: 'https://archive.org/download/MapleLeafRag/MapleLeafRag.mp3' },
    { label: 'FIP Hi-Fi AAC', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/fip/' },
    { label: 'Le Son Parisien FLAC', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/lesonparisien/' },
] as const;
const DefaultAudioUrlPreset = AudioUrlPresets.find(p => p.url === DefaultAudioUrl) ?? AudioUrlPresets[0];
const ExamplePdbIds = ['2tbv', '2plv'] as const;
/**
 * Whole virions from the Mesoscale Explorer's examples (Petworld, one model per protein, each with its assembly). Read
 * from mesoscope.scripps.edu, which allows any origin; CloudFront's copies only allow molstar.org
 */
/**
 * The mesoscale models, Petworld's (one model per protein) and cellPACK's (one entity per protein), as the mesoscale
 * explorer lists them (mesoscope.scripps.edu/explorer/examples/list.json). A `localOnly` file is served by the dev
 * server from the repo (not committed), so it is left out of Random until it is published.
 */
type MesoscaleExample = {
    id: string, label: string, url: string, isBinary: boolean, description: string,
    /** served from this repo by the dev server, so shown only there */
    localOnly?: boolean,
    /** kept out of Random: the heavy ones (a JS heap of 0.7 to 1.1 GB, measured 2026-11-25) */
    notRandom?: boolean,
};
const MesoscaleExamples: MesoscaleExample[] = [
    {
        id: 'petworld-sarscov2', label: 'SARS-CoV-2', isBinary: true,
        url: 'https://mesoscope.scripps.edu/explorer/examples/sarscov2_2-no_bonds.bcif',
        description: 'Petworld SARS-CoV-2 virion (Ozvoldik and Krieger), 2.5 MB, 13.5 M atoms',
    },
    {
        id: 'petworld-hiv', label: 'HIV', isBinary: true,
        url: 'https://mesoscope.scripps.edu/explorer/examples/hiv_2-no_bonds.bcif',
        description: 'Petworld HIV virion with its capsid core (Ozvoldik, Krieger and the cellPACK team), 7.2 MB, 37.7 M atoms',
    },
    {
        id: 'cellpack-hiv1', label: 'HIV (cellPACK)', isBinary: true,
        url: 'https://mesoscope.scripps.edu/explorer/examples/hiv1_cellpack_atom_instances.bcif',
        description: 'cellPACK HIV-1 mature virion, 4.2 MB, 21.8 M atoms', notRandom: true,
    },
    {
        id: 'cellpack-exosome', label: 'Exosome', isBinary: true,
        url: 'https://mesoscope.scripps.edu/explorer/examples/cellpack_apr2024_instances.bcif',
        description: 'cellPACK exosome, 5 MB, 13.5 M atoms', notRandom: true,
    },
    {
        id: 'machineryoflife', label: 'Machinery of Life', isBinary: true,
        url: 'https://mesoscope.scripps.edu/explorer/examples/machineryoflife.bcif',
        description: 'cellPACK Machinery of Life (after Goodsell), 19 MB, 4.5 M atoms, 106 proteins', notRandom: true,
    },
    {
        id: 'cellpack-nipah', label: 'Nipah', isBinary: true, localOnly: true, notRandom: true,
        url: '/data-local/nipah.bcif',
        description: 'cellPACK Nipah virion, 6 MB, 80.7 M atoms (local file, not on mesoscope yet)',
    },
];
/** the dev server: where the repo's own local files are served */
const IsLocalHost = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const DefaultPresetName: AudioReactivePresetName = 'drums-bass-burst';
/** Starting values of the effect knobs: the beat threshold where the presets keep it (0.05 fired a beat every frame), a moderate axis travel */
const DefaultEffectKnobs: Partial<AudioReactiveAnimationManagerValues> = {
    wiggleEffectScale: 1,
    tumbleEffectScale: 1,
    objectTransformEffectScale: 1,
    assemblyAxisAmplitudeScale: 15,
    beatThreshold: 1.1,
};
const FeaturedPresetNames: readonly AudioReactivePresetName[] = [
    'drums-bass-burst',
    'subtle-drift',
    'stem-drift',
    'bass-spectrum',
    'bass-groove-strong',
    'full-spectrum',
    'ambient-pulse',
];
const _sceneCenterScreen = Vec4();

// LOD for large instanced structures (e.g. CellPack assemblies).
/** How the structure is drawn. Blob surface trades per-atom spheres for one coarse mesh. */
type RepresentationMode = 'spacefill' | 'blob-surface'
const DefaultRepresentationMode: RepresentationMode = 'blob-surface';

/**
 * The `type` block for drawing the structure as a coarse blob surface.
 *
 * Mirrors `getBlobSurfaceTypeParams` in the mesoscale explorer - kept local for the same reason the
 * graphics constants below are: the two apps deliberately do not import each other's presets.
 *
 * Spacefill draws one impostor sphere per atom and relies on LOD strides to stay affordable;
 * a blob surface is a single marching-cubes mesh, so there is far less to redraw each frame - which
 * is what matters while audio-reactive animation forces a continuous redraw - but it costs a one-off
 * CPU build and has no LOD to fall back on.
 */
function getBlobSurfaceTypeParams() {
    return {
        name: 'blob-surface' as const,
        params: {
            ...BlobSurfaceRepresentationProvider.defaultValues,
            ignoreLight: true,
            quality: 'lowest' as const, // avoid 'auto', triggers boundary calc
        },
    };
}

/**
 * The Petworld structures of a file, as the mesoscale explorer builds them: per model, its membrane entities (asym ids
 * starting with `MEM`) apart from its proteins, so a route can move the membrane alone. Empty for a file not Petworld's.
 */
async function getPetworldGroups(trajectory: Trajectory) {
    const groups: { modelIndex: number, entityIds: string[] }[] = [];
    if (!MmcifFormat.is(trajectory.representative.sourceData) || !trajectory.representative.sourceData.data.frame.categories.pdbx_model) return groups;
    for (let i = 0; i < trajectory.frameCount; ++i) {
        const model = await Task.resolveInContext(trajectory.getFrameAtIndex(i));
        // not `structAsymMap`: Petworld models may give the same asym id to several entities
        const { label_asym_id, label_entity_id, _rowCount } = model.atomicHierarchy.chains;
        const membrane: string[] = [];
        const other: string[] = [];
        const seen = new Set<string>();
        for (let j = 0; j < _rowCount; ++j) {
            const entityId = label_entity_id.value(j);
            if (seen.has(entityId)) continue;
            seen.add(entityId);
            (label_asym_id.value(j).startsWith('MEM') ? membrane : other).push(entityId);
        }
        if (membrane.length) groups.push({ modelIndex: i, entityIds: membrane });
        if (other.length) groups.push({ modelIndex: i, entityIds: other });
    }
    return groups;
}

// Mirrors the mesoscale explorer "balanced" graphics mode.
const LargeStructureElementThreshold = 500_000;
const LargeStructureLodLevels = [
    { minDistance: 1, maxDistance: 500, overlap: 0, stride: 1, scaleBias: 1 },
    { minDistance: 500, maxDistance: 2000, overlap: 0, stride: 15, scaleBias: 3 },
    { minDistance: 2000, maxDistance: 6000, overlap: 0, stride: 70, scaleBias: 2.7 },
    { minDistance: 6000, maxDistance: 10000000, overlap: 0, stride: 200, scaleBias: 2.5 },
];

/**
 * Fallback spacefill `type` block, matching what the mesoscale structure preset builds. Used when
 * switching back to spacefill for a node whose original block was never seen - e.g. a session that
 * was restored with the blob surface already applied.
 */
function getSpacefillTypeParams() {
    return {
        name: 'spacefill' as const,
        params: {
            ...SpacefillRepresentationProvider.defaultValues,
            instanceGranularity: true,
            lodLevels: LargeStructureLodLevels,
            approximate: true,
            alphaThickness: 12,
            clipPrimitive: true,
        },
    };
}

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

type LoadedEntry = { ref: string, label: string, group?: { ref: string, label: string } }

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
    // Local X/Y/Z are off by default; cycle uses assembly axes when available.
    return getCyclingAxisOptions(axisOptions).map(option => getAssemblyCycleTarget(option.value));
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
    const filtered = cycleTargets.filter(target => available.has(target));
    // Always guarantee >= 2 options so beat cycle works even without assembly symmetry.
    return filtered.length >= 2 ? filtered : DefaultLocalCycleTargets;
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

function getMotionTargetState(animation: AnimationProps) {
    return {
        atomWiggleEnabled: animation.atomWiggleEnabled,
        instanceTumbleEnabled: animation.instanceTumbleEnabled,
        objectTransformEnabled: animation.objectTransformEnabled,
        objectTransformMode: animation.objectTransformMode,
    } as const;
}

function getAxisStatusLabel(state: VirusOnTheRockState) {
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

function createInitialState(params: AudioReactiveAnimationManagerValues, animation: AnimationProps): VirusOnTheRockState {
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

/** the route lines: this many samples (~5 s at the status rate), each line scaled by its own recent maximum */
const RouteLineSamples = 150;
const RouteLineMinScale = 0.25;
const RouteSourceColors: Partial<Record<AudioRoute['source'], string>> = {
    stemDrums: '#ff7b72', stemBass: '#79c0ff', stemOther: '#7ee787', stemVocals: '#d2a8ff',
    beat: '#ffd166', amplitude: '#f0f6fc', subBass: '#4dabf7', bass: '#56d4ff', lowMids: '#63e6be',
    mids: '#a9e34b', highMids: '#ffa94d', treble: '#ff8787', midsTreble: '#e599f7',
};

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

/**
 * The Canvas3D adapter of the CPU channels' port, built by `VirusOnTheRockApp.create`. The camera patches are made once
 * and reused (the camera copies them; its stateChanged readers look only at radius and radiusMax)
 */
function createCanvas3DChannelTarget(canvas3d: Canvas3D): CpuChannelTarget {
    const fovPatch = { fov: 0 };
    const positionPatch = { position: Vec3() };
    return {
        getCamera: () => canvas3d.camera.state,
        setCameraFov(fov) {
            fovPatch.fov = fov;
            canvas3d.camera.setState(fovPatch);
        },
        setCameraPosition(position) {
            Vec3.copy(positionPatch.position, position);
            canvas3d.camera.setState(positionPatch);
        },
        setBackgroundColor(backgroundColor) {
            canvas3d.setProps({ renderer: { ...canvas3d.props.renderer, backgroundColor } });
        },
        getRenderObjects: () => canvas3d.getRenderObjects(),
    };
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

        const app = new VirusOnTheRockApp(viewer, uiTarget, createCanvas3DChannelTarget(viewer.plugin.canvas3d!)); (window as any).__vorProbe = app; // TEMP probe
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

function ControlCard(props: React.PropsWithChildren<{ title?: string, className?: string, style?: React.CSSProperties }>) {
    return <section className={`vor-card ${props.className ?? ''}`} style={props.style}>
        {props.title && <h2 className='vor-section-title'>{props.title}</h2>}
        {props.children}
    </section>;
}

function AudioProminenceReadout({ app }: { app: VirusOnTheRockApp }) {
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

const StemMeterColors: Record<StemName, string> = { drums: '#ff7b72', bass: '#79c0ff', other: '#7ee787', vocals: '#d2a8ff' };

function describeStemStatus(s: AudioReactiveStatus['stemStatus'], separated: boolean) {
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

function StemSeparationCard({ app }: { app: VirusOnTheRockApp }) {
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

const AffectLevelRank: Record<AudioAffect['level'], number> = {
    all: 0, model: 1, entity: 2, instance: 3, chain: 4, residue: 5, atom: 6,
};
const AffectLevelShort: Record<AudioAffect['level'], string> = {
    all: 'All', model: 'Model', entity: 'Entity', instance: 'Instance', chain: 'Chain', residue: 'Residue', atom: 'Atom',
};

/** One route's Who row: how fine (level), which one, and a pick from what is clicked in the viewer */
function RouteAffectRow({ app, route }: { app: VirusOnTheRockApp, route: AudioRoute }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const hierarchy = useBehavior(manager.plugin.managers.structure.hierarchy.behaviors.selection);
    const affect = route.affect;
    const max = maxScopeLevel(route.target);
    const choices = React.useMemo(
        () => affect.level === 'all' ? [] : listAudioAffectChoices(manager.plugin, affect),
        [manager, affect, hierarchy],
    );
    if (max === 'all') {
        return <div className='vor-route-row vor-route-who'>
            <span className='vor-route-who-label'>Who</span>
            <span className='vor-route-who-fixed'>the whole view</span>
        </div>;
    }
    const levels = AudioAffectLevels.filter(([level]) => AffectLevelRank[level] <= AffectLevelRank[max]);
    const selected = JSON.stringify(canonicalAudioAffect(affect));
    const known = choices.some(choice => choice.id === selected);
    return <div className='vor-route-row vor-route-who'>
        <span className='vor-route-who-label'>Who</span>
        <select
            className='vor-select vor-route-level'
            value={affect.level}
            title={max === 'atom'
                ? 'How much of the structure this route acts on'
                : 'How much of the structure this route moves. A chain moves with its whole copy, so instance motion stops at the chain'}
            onChange={e => manager.pickRouteAffect(route.id, e.target.value as AudioAffect['level'])}
        >
            {levels.map(([level]) => <option key={level} value={level}>{AffectLevelShort[level]}</option>)}
        </select>
        {affect.level !== 'all' && <select
            className='vor-select'
            value={known ? selected : ''}
            title={describeAudioAffect(manager.plugin, affect)}
            onChange={e => {
                const choice = choices.find(item => item.id === e.target.value);
                if (choice) manager.setRouteAffect(route.id, choice.affect);
            }}
        >
            {!known && <option value=''>{describeAudioAffect(manager.plugin, affect)}</option>}
            {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>}
        {affect.level !== 'all' && <button
            className='vor-chip vor-route-remove'
            title='Pick what is clicked or selected in the viewer'
            onClick={() => manager.pickRouteAffect(route.id, affect.level)}
        >◎</button>}
    </div>;
}

/** A route to give this row as its Who: the routes that can be narrowed */
function EntryWhoPicker({ app, refOrGroup }: { app: VirusOnTheRockApp, refOrGroup: string }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const routes = useBehavior(manager.state.routes);
    const narrowable = routes.filter(route => maxScopeLevel(route.target) !== 'all');
    if (narrowable.length === 0) return null;
    return <select
        className='vor-select vor-entry-who'
        value=''
        title='Make this the Who of a route'
        onChange={e => {
            const affect = app.getEntryAffect(refOrGroup);
            if (affect && e.target.value) manager.setRouteAffect(Number(e.target.value), affect);
        }}
    >
        <option value=''>Who ▸</option>
        {narrowable.map((route, i) => <option key={route.id} value={route.id}>{`${i + 1}. ${getAudioRouteTargetLabel(route.target)} · ${getAudioRouteSourceLabel(route.source)}`}</option>)}
    </select>;
}

function EntryRow({ app, entry, hidden, child }: { app: VirusOnTheRockApp, entry: { ref: string, label: string }, hidden: boolean, child?: boolean }) {
    return <div className={`vor-entry-row ${child ? 'vor-entry-child' : ''} ${hidden ? 'vor-entry-hidden' : ''}`}>
        <button className='vor-chip vor-entry-eye' title={hidden ? 'Show' : 'Hide'} onClick={() => app.setEntriesHidden([entry.ref], !hidden)}>{hidden ? '○' : '●'}</button>
        <span className='vor-entry-label'>{entry.label}</span>
        <EntryWhoPicker app={app} refOrGroup={entry.ref} />
        <button className='vor-chip' onClick={() => void app.removeStructure(entry.ref)}>Remove</button>
    </div>;
}

/** The loaded structures as a tree: a mesoscale example over its parts, each part shown or hidden, removed, or made a Who */
function EntriesTree({ app, entries }: { app: VirusOnTheRockApp, entries: LoadedEntry[] }) {
    const [, redraw] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const sub = app.viewer.plugin.state.data.events.cell.stateUpdated.subscribe(() => redraw());
        return () => sub.unsubscribe();
    }, [app]);
    const [open, setOpen] = React.useState<Record<string, boolean>>({});
    if (entries.length === 0) return <p className='vor-help'>No structures loaded.</p>;

    const rows: React.ReactNode[] = [];
    const groups = new Map<string, { label: string, entries: LoadedEntry[] }>();
    const order: (LoadedEntry | string)[] = [];
    for (const entry of entries) {
        if (!entry.group) {
            order.push(entry);
            continue;
        }
        let group = groups.get(entry.group.ref);
        if (!group) {
            group = { label: entry.group.label, entries: [] };
            groups.set(entry.group.ref, group);
            order.push(entry.group.ref);
        }
        group.entries.push(entry);
    }
    for (const item of order) {
        if (typeof item !== 'string') {
            rows.push(<EntryRow key={item.ref} app={app} entry={item} hidden={app.isEntryHidden(item.ref)} />);
            continue;
        }
        const group = groups.get(item)!;
        const refs = group.entries.map(e => e.ref);
        const hidden = refs.every(ref => app.isEntryHidden(ref));
        const expanded = open[item] ?? true;
        rows.push(<div key={item} className={`vor-entry-row vor-entry-group ${hidden ? 'vor-entry-hidden' : ''}`}>
            <button className='vor-chip vor-entry-eye' title={hidden ? 'Show all' : 'Hide all'} onClick={() => app.setEntriesHidden(refs, !hidden)}>{hidden ? '○' : '●'}</button>
            <button className='vor-entry-toggle' onClick={() => setOpen({ ...open, [item]: !expanded })}>{expanded ? '▾' : '▸'} {group.label} <span className='vor-entry-count'>{group.entries.length}</span></button>
            <EntryWhoPicker app={app} refOrGroup={item} />
            <button className='vor-chip' onClick={() => void app.removeStructures(refs)}>Remove</button>
        </div>);
        if (!expanded) continue;
        for (const entry of group.entries) {
            rows.push(<EntryRow key={entry.ref} app={app} entry={entry} hidden={app.isEntryHidden(entry.ref)} child />);
        }
    }
    return <div className='vor-stack vor-entries'>{rows}</div>;
}

/** the built-in route sets in the Saved list: their option values carry this prefix, so a saved routing of the same name stays apart */
const InspiredPrefix = 'inspired:';

/** a loaded routing moves nothing on a channel whose motion is off: turn on those its routes need */
async function enableMotionsFor(app: VirusOnTheRockApp, routes: readonly AudioRouteDraft[]) {
    const state = app.state.value;
    const needs = (targets: readonly AudioRoute['target'][]) => routes.some(r => r.enabled && targets.includes(r.target));
    if (!state.atomWiggleEnabled && needs(['wiggle'])) await app.setMotionTargetEnabled('atomWiggleEnabled', true);
    if (!state.instanceTumbleEnabled && needs(['symAxis', 'instanceRandom', 'instanceAxis', 'instanceNormal'])) await app.setMotionTargetEnabled('instanceTumbleEnabled', true);
    if (!state.objectTransformEnabled && needs(['object'])) await app.setMotionTargetEnabled('objectTransformEnabled', true);
}

function AudioRoutingLibrary({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const [presets, setPresets] = React.useState<AudioRoutingPreset[]>(() => loadStoredAudioRouting());
    const [name, setName] = React.useState('My routing');
    const [picked, setPicked] = React.useState('');
    const fileRef = React.useRef<HTMLInputElement>(null);

    const remember = (next: AudioRoutingPreset[]) => {
        const stored = storeAudioRouting(next);
        setPresets(stored);
        return stored;
    };

    const save = () => {
        const trimmed = name.trim() || 'Routing';
        const preset: AudioRoutingPreset = {
            version: 1,
            name: trimmed,
            routes: draftsFromRoutes(manager.state.routes.value),
        };
        const without = presets.filter(item => item.name !== trimmed);
        remember([preset, ...without]);
        setPicked(trimmed);
        setName(trimmed);
    };

    const load = (presetName: string) => {
        setPicked(presetName);
        if (presetName.startsWith(InspiredPrefix)) setName(presetName.slice(InspiredPrefix.length));
        loadFrom(presets, presetName);
    };

    const download = () => {
        const text = JSON.stringify({
            version: 1,
            name: name.trim() || 'Routing',
            routes: draftsFromRoutes(manager.state.routes.value),
        }, null, 2);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(name.trim() || 'audio-routing').replace(/[^\w.-]+/g, '_')}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const importFile = (file: File | undefined) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const parsed = typeof reader.result === 'string' ? parseAudioRouting(reader.result) : undefined;
            if (!parsed) return;
            const byName = new Map(presets.map(item => [item.name, item]));
            for (const preset of parsed) byName.set(preset.name, preset);
            const stored = remember([...byName.values()]);
            const first = parsed[0];
            if (!first) return;
            setName(first.name);
            setPicked(first.name);
            if (stored.some(item => item.name === first.name)) loadFrom(stored, first.name);
        };
        reader.readAsText(file);
    };

    const loadFrom = (list: readonly AudioRoutingPreset[], presetName: string) => {
        const preset = presetName.startsWith(InspiredPrefix)
            ? InspiredRoutings.find(item => item.name === presetName.slice(InspiredPrefix.length))
            : list.find(item => item.name === presetName);
        if (!preset) return;
        void enableMotionsFor(app, preset.routes);
        // a saved affect names its model by entry id too: reattached to the models loaded now
        manager.setRoutes(routesFromDrafts(preset.routes));
        for (const route of manager.state.routes.value) manager.setRouteAffect(route.id, route.affect);
    };

    return <div className='vor-routing-save'>
        <input className='vor-input' value={name} aria-label='Routing preset name' onChange={e => setName(e.target.value)} />
        <button className='vor-chip' title='Keep these routes and who they affect in this browser' onClick={save}>Save</button>
        <select className='vor-select' value={picked} aria-label='Saved routing presets' onChange={e => load(e.target.value)}>
            <option value=''>Saved…</option>
            {presets.length > 0 && <optgroup label='Saved in this browser'>
                {presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
            </optgroup>}
            <optgroup label='Inspired by acclaimed audio-visual works'>
                {InspiredRoutings.map(preset => <option key={preset.name} value={InspiredPrefix + preset.name} title={preset.description}>{preset.name}</option>)}
            </optgroup>
        </select>
        <button className='vor-chip' title='Remove the selected saved routing' disabled={!picked || picked.startsWith(InspiredPrefix)} onClick={() => {
            remember(presets.filter(item => item.name !== picked));
            setPicked('');
        }}>Delete</button>
        <button className='vor-chip' title='Download this routing as JSON' onClick={download}>Export</button>
        <button className='vor-chip' title='Load a routing JSON file' onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} className='vor-file' type='file' accept='application/json,.json' hidden onChange={e => {
            importFile(e.target.files?.[0]);
            e.target.value = '';
        }} />
    </div>;
}

function AudioRoutingCard({ app }: { app: VirusOnTheRockApp }) {
    const manager = app.viewer.plugin.managers.audioReactive;
    const routes = useBehavior(manager.state.routes);
    const status = useBehavior(manager.state.status) as AudioReactiveStatus | undefined;
    if (!routes) return null;
    return <div className='vor-stack'>
        {routes.map(route => {
            const value = status?.routeValues.get(route.id) ?? 0;
            return <div key={route.id} className={`vor-route ${route.enabled ? '' : 'vor-route-off'}`}>
                <div className='vor-route-row'>
                    <input
                        type='checkbox'
                        checked={route.enabled}
                        title={route.enabled ? 'On: click to mute this route' : 'Off: click to turn this route on'}
                        onChange={e => manager.updateRoute(route.id, { enabled: e.target.checked })}
                    />
                    <select className='vor-select' value={route.source} onChange={e => manager.updateRoute(route.id, { source: e.target.value as AudioRoute['source'] })}>
                        {AudioRouteSources.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select className='vor-select vor-route-mode' value={route.mode} title='Level follows how loud the source is; Hits follows how much it just rose' onChange={e => manager.updateRoute(route.id, { mode: e.target.value as AudioRoute['mode'] })}>
                        <option value='level'>Level</option>
                        <option value='onset'>Hits</option>
                    </select>
                    <button className='vor-chip vor-route-remove' title='Remove this route' onClick={() => manager.removeRoute(route.id)}>×</button>
                </div>
                <div className='vor-route-row'>
                    <span className='vor-route-arrow'>→</span>
                    <select className='vor-select' value={route.target} onChange={e => {
                        manager.updateRoute(route.id, { target: e.target.value as AudioRoute['target'] });
                        // a channel that cannot be narrowed as far keeps what it can of the Who
                        manager.setRouteAffect(route.id, route.affect);
                    }}>
                        {AudioRouteTargets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select className='vor-select vor-route-mode' value={route.curve} title='How the source is bent before the gain: Log lifts the quiet parts (soft, always moving), Exp keeps only the peaks (hard contrast)' onChange={e => manager.updateRoute(route.id, { curve: e.target.value as AudioRoute['curve'] })}>
                        {AudioRouteCurves.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                <RouteAffectRow app={app} route={route} />
                <div className='vor-route-row'>
                    <label className='vor-route-gain' title='Sensitivity: how much the source moves the channel'>
                        Gain {route.gain.toFixed(2)}
                        <input type='range' min='0' max='20' step='0.1' value={route.gain} onChange={e => manager.updateRoute(route.id, { gain: parseFloat(e.target.value) })} />
                    </label>
                    <div className='vor-route-meter' title='What this route sends now'><i style={{ width: `${Math.min(100, value * 12.5)}%` }} /></div>
                </div>
            </div>;
        })}
        <div className='vor-chip-row'>
            <button className='vor-chip' onClick={() => manager.setRoutes([...routes, createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'onset', target: 'symAxis', gain: 1, floor: 0, releaseMs: 250 })])}>+ Add route</button>
            <button className='vor-chip' title='A traveling wave on instance positions. Its height is this route’s source — pick the stem on the new row. It moves even when Instance Beats is off.' onClick={() => manager.setRoutes([...routes, createAudioRoute({ enabled: true, source: 'stemDrums', mode: 'level', target: 'instanceWave', gain: 6, floor: 0, releaseMs: 280 })])}>+ Instance wave</button>
            <button className='vor-chip' title='Drums and bass to the symmetry axes, other to the atoms, vocals to the illumination' onClick={() => manager.setRoutes(getDefaultAudioRoutes())}>Defaults</button>
        </div>
        <AudioRoutingLibrary app={app} />
        <p className='vor-help'>
            Each route sends an audio source to a visual channel; a channel sums its routes. Who narrows a route to one model, entity, instance or chain (atom wiggle, illumination and colours down to one residue or atom); ◎ takes what you clicked in the viewer. Camera, clipping and opacity always act on the whole view. Up to 8 routes can be narrowed at once. The wave's height is its route's source. Save keeps the routes and who each moves.
        </p>
    </div>;
}

function AudioAnalysisWarning({ app }: { app: VirusOnTheRockApp }) {
    const status = useBehavior(app.viewer.plugin.managers.audioReactive.state.status);
    if (!status?.analysisBlocked) return null;
    return (
        <p className='vor-analysis-warning'>
            Audio is playing but analysis is silent. Remote streams may be CORS-blocked locally — try a local audio file instead, or run the app over HTTPS.
        </p>
    );
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
    const routes = useBehavior(props.app.viewer.plugin.managers.audioReactive.state.routes);
    // each route's recent values, a ring per route, pushed once per status update (~30 Hz)
    const historyRef = React.useRef({ values: new Map<number, Float32Array>(), head: 0, lastStatus: undefined as AudioReactiveStatus | undefined });

    if (!status || width <= 0 || height <= 0) return null;

    const { spectrum } = status.visualization;
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

    // the wave line: one line per enabled audio route, what it sent over the last seconds
    const waveCenterY = barBaseY - Math.min(120, height * 0.14);
    const waveAmplitude = Math.min(height * 0.11, 82);
    if (status !== historyRef.current.lastStatus) {
        historyRef.current.lastStatus = status;
        const head = historyRef.current.head = (historyRef.current.head + 1) % RouteLineSamples;
        for (const route of routes ?? []) {
            let h = historyRef.current.values.get(route.id);
            if (!h) historyRef.current.values.set(route.id, h = new Float32Array(RouteLineSamples));
            h[head] = status.routeValues.get(route.id) ?? 0;
        }
    }
    const routeLines: { id: number, path: string, color: string, label: string, labelX: number, labelY: number }[] = [];
    if (props.showWaveformLine) {
        const enabled = (routes ?? []).filter(r => r.enabled);
        const x0 = width * 0.08, x1 = width * 0.9;
        enabled.forEach((route, k) => {
            const h = historyRef.current.values.get(route.id);
            if (!h) return;
            let max = RouteLineMinScale;
            for (const v of h) if (v > max) max = v;
            const ordered = new Float32Array(RouteLineSamples);
            for (let i = 0; i < RouteLineSamples; i++) ordered[i] = h[(historyRef.current.head + 1 + i) % RouteLineSamples] / max;
            // stacked a little so overlapping lines stay apart
            const centerY = waveCenterY + (k - (enabled.length - 1) / 2) * 10;
            const lastY = centerY - ordered[RouteLineSamples - 1] * waveAmplitude;
            routeLines.push({
                id: route.id,
                path: buildWavePath(ordered, x0, x1, centerY, waveAmplitude),
                color: RouteSourceColors[route.source] ?? '#9fb3c8',
                label: `${getAudioRouteSourceLabel(route.source)} → ${getAudioRouteTargetLabel(route.target)}`,
                labelX: x1 + 8,
                labelY: lastY + 4,
            });
        });
    }

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

            {routeLines.map(line => <React.Fragment key={line.id}>
                <path className='vor-wave-shadow' d={line.path} />
                <path className='vor-route-line' d={line.path} style={{ stroke: line.color, filter: `drop-shadow(0 0 10px ${line.color})` }} />
                <text className='vor-route-line-label' x={line.labelX} y={line.labelY} fill={line.color}>{line.label}</text>
            </React.Fragment>)}

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
    const [audioUrl, setAudioUrl] = React.useState<string>(DefaultAudioUrlPreset.url);
    const selectedAudioPreset = AudioUrlPresets.find(preset => preset.url === audioUrl);

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
                        <button
                            className={`vor-chip ${state.randomPerSong ? 'vor-active' : ''}`}
                            onClick={() => void app.setRandomPerSong(!state.randomPerSong)}
                            title={state.randomPerSong
                                ? 'On: a random virus at each new song. Click to keep the current one.'
                                : 'A random virus now, and a new one at each new song (a PDB capsid or a mesoscale virion).'}
                        >
                            Random
                        </button>
                    </div>
                    <span className='vor-label'>Mesoscale</span>
                    <div className='vor-chip-row'>
                        {MesoscaleExamples.filter(example => !example.localOnly || IsLocalHost).map(example => <button
                            key={example.id}
                            className='vor-chip'
                            disabled={!!state.loadingModel}
                            title={example.description}
                            onClick={() => void app.loadMesoscaleExample(example)}
                        >
                            {example.label}
                        </button>)}
                    </div>
                    {(state.loadingModel || (state.randomPerSong && state.songChangeNote)) && <p className='vor-help'>
                        {state.loadingModel ? `Loading ${state.loadingModel}…` : state.songChangeNote}
                    </p>}
                    <label className='vor-label' htmlFor='vor-structure-file'>Browser File</label>
                    <input id='vor-structure-file' className='vor-file' type='file' multiple onChange={onStructureFileChange} />
                </div>
            </ControlCard>

            <ControlCard title='Audio'>
                <div className='vor-stack'>
                    <label className='vor-label' htmlFor='vor-audio-file'>Audio File</label>
                    <input id='vor-audio-file' className='vor-file' type='file' accept='.mp3,audio/*' onChange={onAudioFileChange} />
                    <label className='vor-label' htmlFor='vor-audio-url-preset'>Audio Source</label>
                    <select
                        id='vor-audio-url-preset'
                        className='vor-select'
                        value={selectedAudioPreset?.url ?? ''}
                        onChange={e => {
                            if (e.target.value) setAudioUrl(e.target.value);
                        }}
                    >
                        {!selectedAudioPreset && <option value=''>Custom URL</option>}
                        {AudioUrlPresets.map(preset => <option key={preset.url} value={preset.url}>{preset.label}</option>)}
                    </select>
                    <label className='vor-label' htmlFor='vor-audio-url'>Audio URL</label>
                    <div className='vor-row'>
                        <input
                            id='vor-audio-url'
                            className='vor-input'
                            value={audioUrl}
                            onChange={e => setAudioUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void app.loadAudioUrl(audioUrl, selectedAudioPreset?.label); }}
                            placeholder='https://example.org/audio.mp3'
                        />
                        <button className='vor-button vor-primary' onClick={() => void app.loadAudioUrl(audioUrl, selectedAudioPreset?.label)}>Load URL</button>
                    </div>
                    <div className='vor-button-row'>
                        <button
                            className='vor-button vor-primary'
                            onClick={() => state.audioPlaying ? app.pauseAudio() : void app.playAudio()}
                            disabled={!state.audioLoaded}
                        >
                            {state.audioPlaying ? 'Pause Current' : 'Play Current'}
                        </button>
                    </div>
                    <AudioAnalysisWarning app={app} />
                    <p className='vor-help'>
                        Streams <b>{DefaultAudioLabel}</b> on start and falls back to <b>{DefaultAudioFallbackLabel}</b> if it cannot be reached. Autoplay may be blocked until you interact with the page — use Play Current then. Remote URLs must allow browser media playback with CORS; HTTPS pages can also block HTTP streams.
                    </p>
                </div>
            </ControlCard>

            <ControlCard title='Stem Separation'>
                <StemSeparationCard app={app} />
            </ControlCard>

            <ControlCard title='Audio Routing'>
                <AudioRoutingCard app={app} />
            </ControlCard>

            <ControlCard title='Prominence'>
                <div className='vor-stack'>
                    <AudioProminenceReadout app={app} />
                    <p className='vor-help'>
                        Relative weight of each band, from its level plus a decaying onset peak.
                        Tune <b>Onset Weight</b> and <b>Temperature</b> until the shape follows what you hear.
                    </p>
                </div>
            </ControlCard>

            <ControlCard title='Representation'>
                <div className='vor-chip-row'>
                    {(['spacefill', 'blob-surface'] as RepresentationMode[]).map(mode => <button
                        key={mode}
                        className={`vor-chip ${state.representationMode === mode ? 'vor-active' : ''}`}
                        onClick={() => void app.chooseRepresentationMode(mode)}
                        title={mode === 'spacefill'
                            ? 'One impostor sphere per atom with level-of-detail strides.'
                            : 'A single coarse mesh per structure: much less to redraw each frame, but built once on the CPU and without level-of-detail.'}
                    >
                        {mode === 'spacefill' ? 'Spacefill' : 'Blob Surface'}
                    </button>)}
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

            <ControlCard title='Motion Targets'>
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
            </ControlCard>

            <ControlCard title='Clip Reactivity'>
                <div className='vor-stack'>
                    <div className='vor-chip-row'>
                        <button
                            className={`vor-chip ${!state.audioClipEnabled ? 'vor-active' : ''}`}
                            onClick={() => app.setAudioClipEnabled(false)}
                        >
                            Off
                        </button>
                        <button
                            className={`vor-chip ${state.audioClipEnabled ? 'vor-active' : ''}`}
                            onClick={() => app.setAudioClipEnabled(true)}
                        >
                            On
                        </button>
                    </div>
                    <p className='vor-help'>
                        When on, clip objects in the scene react to audio. Planes slide along their normal; spheres and cubes expand; cylinders widen.
                    </p>
                    <div className='vor-slider-group'>
                        <div className='vor-slider-row'>
                            <label htmlFor='vor-clip-scale'>Scale</label>
                            <output>{state.audioClipScale.toFixed(2)}</output>
                            <input
                                id='vor-clip-scale'
                                type='range'
                                min='0'
                                max='4'
                                step='0.01'
                                value={state.audioClipScale}
                                onChange={e => app.setAudioClipScale(parseFloat(e.target.value))}
                            />
                        </div>
                    </div>
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
                                className={`vor-chip ${state.axisSource !== 'assembly' && state.localAxis === option.value ? 'vor-active' : ''}`}
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

                        {state.axisSource !== 'assembly' && <div className='vor-chip-row'>
                            <button
                                className={`vor-chip ${state.axisSource === 'local' ? 'vor-active' : ''}`}
                                onClick={() => void app.setAxisFrame('local')}
                            >
                                Local
                            </button>
                            <button
                                className={`vor-chip ${state.axisSource === 'global' ? 'vor-active' : ''}`}
                                onClick={() => void app.setAxisFrame('global')}
                            >
                                Global
                            </button>
                        </div>}

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

            <ControlCard title='Entries'>
                <details className='vor-disclosure'>
                    <summary>Loaded Structures</summary>
                    <EntriesTree app={app} entries={state.loadedEntries} />
                </details>
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
                    title={state.showSidebar ? 'Hide Sidebar' : 'Expand Sidebar'}
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
