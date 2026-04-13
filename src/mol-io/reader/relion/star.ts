/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CifBlock, CifFile } from '../cif';
import { ReaderResult as Result } from '../result';

const CoordinateFieldAliases = [
    'rlnCenteredCoordinateXAngst',
    'rlnCenteredCoordinateXAngstrom',
    'rlnCoordinateX',
];

export interface RelionStarFile {
    readonly source: CifFile
    readonly particleBlock: CifBlock
    readonly opticsBlock?: CifBlock
}

function getFlatField(block: CifBlock, name: string) {
    return block.categories[name]?.getField('');
}

function hasCoordinateFields(block: CifBlock) {
    return CoordinateFieldAliases.some(name => !!getFlatField(block, name));
}

function findParticlesBlock(file: CifFile) {
    let fallback: CifBlock | undefined;
    for (const block of file.blocks) {
        if (!hasCoordinateFields(block)) continue;
        if (!fallback) fallback = block;
        if (block.header.toLowerCase().includes('particle')) return block;
    }
    return fallback;
}

function findOpticsBlock(file: CifFile) {
    for (const block of file.blocks) {
        if (block.header.toLowerCase().includes('optics')) return block;
    }
}

export function parseRelionStar(file: CifFile) {
    const particleBlock = findParticlesBlock(file);
    if (!particleBlock) {
        return Result.error<RelionStarFile>('No RELION particle data block with coordinates was found.');
    }

    return Result.success({
        source: file,
        particleBlock,
        opticsBlock: findOpticsBlock(file),
    });
}
