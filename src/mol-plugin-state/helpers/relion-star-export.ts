/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '../../mol-math/linear-algebra';
import { Grid, Volume } from '../../mol-model/volume';
import { PluginContext } from '../../mol-plugin/context';
import { StateObjectCell, StateSelection, StateTransform } from '../../mol-state';
import { PluginStateObject } from '../objects';
import { RelionStarParticleListObject } from '../objects/relion';
import { RelionStarExportMetadata, RelionStarOpticsRow } from '../../mol-io/writer/relion/star';
import { StateTransforms } from '../transforms';
import { RelionParticleShapeTag } from './relion-star';
import { ParticleList } from '../../mol-io/reader/particle-list';

export interface ParticleListExportEntry {
    ref: StateTransform.Ref
    label: string
    particleList: ParticleList
    positionScale: number
}

export interface VolumeMetadataDefaults {
    pixelSize?: number
    imageSize?: number
    origin?: Vec3
}

const DEFAULT_OPTICS: RelionStarOpticsRow = {
    opticsGroup: 1,
    opticsGroupName: 'opticsGroup1',
    imagePixelSize: 1,
    imageSize: undefined,
    imageDimensionality: 3,
};

export function getParticleListExportEntries(plugin: PluginContext): ParticleListExportEntry[] {
    const state = plugin.state.data;
    const cells = state.select(
        StateSelection.Generators.root.subtree().ofType(RelionStarParticleListObject)
    ) as StateObjectCell<RelionStarParticleListObject>[];

    const entries: ParticleListExportEntry[] = [];
    for (const cell of cells) {
        if (!cell.obj?.data) continue;
        const shape = state.select(
            StateSelection.Generators.ofTransformer(StateTransforms.Shape.RelionStarParticleListShape, cell.transform.ref)
                .withTag(RelionParticleShapeTag)
                .first()
        )[0] as StateObjectCell<PluginStateObject.Shape.Provider> | undefined;

        const positionScale = readPositionScale(shape) ?? cell.obj.data.suggestedScale ?? 1;
        entries.push({
            ref: cell.transform.ref,
            label: cell.obj.label || cell.obj.data.particleBlockHeader || 'Particle List',
            particleList: cell.obj.data,
            positionScale,
        });
    }
    return entries;
}

function readPositionScale(cell: StateObjectCell<PluginStateObject.Shape.Provider> | undefined): number | undefined {
    if (!cell) return;
    const params = cell.transform.params as { positionScale?: number } | undefined;
    const value = params?.positionScale;
    return typeof value === 'number' && Number.isFinite(value) ? value : void 0;
}

export function getVolumeMetadataDefaults(plugin: PluginContext): VolumeMetadataDefaults {
    const state = plugin.state.data;
    const cells = state.select(
        StateSelection.Generators.root.subtree().ofType(PluginStateObject.Volume.Data)
    ) as StateObjectCell<PluginStateObject.Volume.Data>[];

    for (const cell of cells) {
        const volume = cell.obj?.data as Volume | undefined;
        if (!volume?.grid) continue;
        const defaults = extractGridMetadata(volume.grid);
        if (defaults.pixelSize || defaults.imageSize) return defaults;
    }
    return {};
}

function extractGridMetadata(grid: Grid): VolumeMetadataDefaults {
    const dims = grid.cells.space.dimensions as ReadonlyArray<number>;
    const imageSize = Number.isFinite(dims[0]) && Number.isFinite(dims[1]) && Number.isFinite(dims[2])
        ? Math.max(dims[0], dims[1], dims[2])
        : void 0;

    const transform = Grid.getGridToCartesianTransform(grid);
    // Column 0 of column-major Mat4 = elements [0, 1, 2]: world delta for one voxel along X.
    const pixelSize = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1] + transform[2] * transform[2]);
    const origin = Vec3.create(transform[12], transform[13], transform[14]);

    return {
        pixelSize: pixelSize > 0 && Number.isFinite(pixelSize) ? pixelSize : void 0,
        imageSize,
        origin: Number.isFinite(origin[0]) && Number.isFinite(origin[1]) && Number.isFinite(origin[2]) ? origin : void 0,
    };
}

export function getDefaultExportMetadata(positionScale: number, volumeDefaults: VolumeMetadataDefaults, particleList: ParticleList): RelionStarExportMetadata {
    const inputCoordinateUnit = particleList.particles[0]?.coordinateUnit ?? 'pixel';
    const inputOriginUnit = particleList.particles[0]?.originUnit ?? 'pixel';

    const apix = volumeDefaults.pixelSize ?? positionScale ?? particleList.suggestedScale ?? DEFAULT_OPTICS.imagePixelSize;
    const imageSize = volumeDefaults.imageSize;

    const optics: RelionStarOpticsRow = {
        ...DEFAULT_OPTICS,
        imagePixelSize: apix,
        imageSize,
        opticsGroupName: particleList.opticsBlockHeader || DEFAULT_OPTICS.opticsGroupName,
    };

    return {
        particleBlockName: particleList.particleBlockHeader || 'particles',
        coordinateConvention: inputCoordinateUnit === 'angstrom' ? 'centered-angstrom' : 'pixel',
        originConvention: inputOriginUnit === 'angstrom' ? 'angstrom' : 'pixel',
        angleSource: 'auto',
        boxCenter: imageSize ? Vec3.create(imageSize / 2, imageSize / 2, imageSize / 2) : void 0,
        optics,
        includeOpticsGroupColumn: true,
        includeTomoNameColumn: particleList.particles.some(p => !!p.metadata?.tomoName || !!p.metadata?.tomogram),
        includeMicrographNameColumn: particleList.particles.some(p => !!p.metadata?.micrographName || !!p.metadata?.micrograph),
        includeImageNameColumn: particleList.particles.some(p => !!p.metadata?.imageName),
        includeClassNumberColumn: particleList.particles.some(p => p.metadata?.classNumber !== void 0),
        includeGroupNumberColumn: particleList.particles.some(p => p.metadata?.groupNumber !== void 0),
    };
}

export function suggestExportFileName(label: string, format: 'star'): string {
    const base = (label || 'particles').replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/\.(star|tbl|tsv|csv)$/i, '');
    return `${base}_export.${format}`;
}
