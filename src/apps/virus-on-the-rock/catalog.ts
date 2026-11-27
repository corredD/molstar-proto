/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PostprocessingParams } from '../../mol-canvas3d/passes/postprocessing';
import { SsaoParams } from '../../mol-canvas3d/passes/ssao';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Task } from '../../mol-task';
import { BlobSurfaceRepresentationProvider } from '../../mol-repr/structure/representation/blob-surface';
import { SpacefillRepresentationProvider } from '../../mol-repr/structure/representation/spacefill';
import { AudioReactivePresetName } from '../../mol-plugin-state/helpers/audio-reactive-presets';
import { AudioReactiveAnimationManagerValues } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { MmcifFormat } from '../../mol-model-formats/structure/mmcif';
import { Trajectory } from '../../mol-model/structure';

export const DefaultPdbId = '2tbv';
export const DefaultAudioUrl = 'https://radio-proxy.ludomolgraphlab.workers.dev/lesonparisien/';
/** Local file used when the live stream cannot be reached (offline, proxy down, CORS). */
export const DefaultAudioFallbackUrl = 'examples/angine.mp3';
export const DefaultAudioLabel = 'Le Son Parisien';
export const DefaultAudioFallbackLabel = 'angine.mp3';
export const NearClipAfterCameraReset = 0;
// Multiplier applied to the visible bounding-sphere radius when framing.
// >1 = camera pulled back so the structure isn't filling the viewport.
export const FrameRadiusPadding = 1.3;
export const AudioUrlPresets = [
    { label: 'Plus FM', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/plusfm/' },
    { label: 'Public Domain - Maple Leaf Rag', url: 'https://archive.org/download/MapleLeafRag/MapleLeafRag.mp3' },
    { label: 'FIP Hi-Fi AAC', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/fip/' },
    { label: 'Le Son Parisien FLAC', url: 'https://radio-proxy.ludomolgraphlab.workers.dev/lesonparisien/' },
] as const;
export const DefaultAudioUrlPreset = AudioUrlPresets.find(p => p.url === DefaultAudioUrl) ?? AudioUrlPresets[0];
export const ExamplePdbIds = ['2tbv', '2plv'] as const;
/**
 * Whole virions from the Mesoscale Explorer's examples (Petworld, one model per protein, each with its assembly). Read
 * from mesoscope.scripps.edu, which allows any origin; CloudFront's copies only allow molstar.org
 */
/**
 * The mesoscale models, Petworld's (one model per protein) and cellPACK's (one entity per protein), as the mesoscale
 * explorer lists them (mesoscope.scripps.edu/explorer/examples/list.json). A `localOnly` file is served by the dev
 * server from the repo (not committed), so it is left out of Random until it is published.
 */
export type MesoscaleExample = {
    id: string, label: string, url: string, isBinary: boolean, description: string,
    /** served from this repo by the dev server, so shown only there */
    localOnly?: boolean,
    /** kept out of Random: the heavy ones (a JS heap of 0.7 to 1.1 GB, measured 2026-11-25) */
    notRandom?: boolean,
};
export const MesoscaleExamples: MesoscaleExample[] = [
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
export const IsLocalHost = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const DefaultPresetName: AudioReactivePresetName = 'drums-bass-burst';
/** Starting values of the effect knobs: the beat threshold where the presets keep it (0.05 fired a beat every frame), a moderate axis travel */
export const DefaultEffectKnobs: Partial<AudioReactiveAnimationManagerValues> = {
    wiggleEffectScale: 1,
    tumbleEffectScale: 1,
    objectTransformEffectScale: 1,
    assemblyAxisAmplitudeScale: 15,
    beatThreshold: 1.1,
};
/**
 * The audio sync at startup: lookahead on, so a hit moves the visuals on the frame it is heard (the audio 0.25 s late
 * with no stem model). Off in the core manager's defaults (lane lookahead-sync; Ludo to confirm)
 */
export const DefaultAudioSync: Partial<AudioReactiveAnimationManagerValues> = { lookahead: true };
export const FeaturedPresetNames: readonly AudioReactivePresetName[] = [
    'drums-bass-burst',
    'subtle-drift',
    'stem-drift',
    'bass-spectrum',
    'bass-groove-strong',
    'full-spectrum',
    'ambient-pulse',
];

// LOD for large instanced structures (e.g. CellPack assemblies).
/** How the structure is drawn. Blob surface trades per-atom spheres for one coarse mesh. */
export type RepresentationMode = 'spacefill' | 'blob-surface'
export const DefaultRepresentationMode: RepresentationMode = 'blob-surface';

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
export function getBlobSurfaceTypeParams() {
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
export async function getPetworldGroups(trajectory: Trajectory) {
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
export const LargeStructureElementThreshold = 500_000;
export const LargeStructureLodLevels = [
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
export function getSpacefillTypeParams() {
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

export function getDefaultMultiScaleOcclusionProps() {
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
