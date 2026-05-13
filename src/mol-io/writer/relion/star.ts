/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { ParticleList, ParticleListParticle } from '../../reader/particle-list';

export type RelionCoordinateConvention = 'pixel' | 'centered-angstrom';
export type RelionOriginConvention = 'pixel' | 'angstrom' | 'none';
export type RelionAngleSource = 'auto' | 'particle' | 'subtomogram';

export interface RelionStarOpticsRow {
    opticsGroup: number
    opticsGroupName: string
    imagePixelSize: number
    imageSize?: number
    imageDimensionality?: number
    voltage?: number
    sphericalAberration?: number
    amplitudeContrast?: number
}

export interface RelionStarExportMetadata {
    particleBlockName: string
    coordinateConvention: RelionCoordinateConvention
    originConvention: RelionOriginConvention
    angleSource: RelionAngleSource
    boxCenter?: Vec3
    optics: RelionStarOpticsRow
    defaultTomoName?: string
    defaultMicrographName?: string
    defaultImageName?: string
    includeOpticsGroupColumn: boolean
    includeTomoNameColumn: boolean
    includeMicrographNameColumn: boolean
    includeImageNameColumn: boolean
    includeClassNumberColumn: boolean
    includeGroupNumberColumn: boolean
}

export interface RelionStarWriteOptions {
    positionScale: number
    metadata: RelionStarExportMetadata
}

const RAD_TO_DEG = 180 / Math.PI;
const ZYZ_GIMBAL_EPSILON = 1e-7;

function mEl(m: Mat4, row: number, col: number) {
    return m[col * 4 + row];
}

/**
 * Inverse of `relionEulerToRotation` in mol-io/reader/relion/star.ts.
 * Decomposes M = R^T as a ZYZ standard product Rz(rot) Ry(tilt) Rz(psi).
 * Returns degrees.
 */
export function relionRotationToEuler(rotation: Mat4): { rot: number, tilt: number, psi: number } {
    const M02 = mEl(rotation, 2, 0);
    const M12 = mEl(rotation, 2, 1);
    const M20 = mEl(rotation, 0, 2);
    const M21 = mEl(rotation, 1, 2);
    const M22 = mEl(rotation, 2, 2);

    const sinTilt = Math.sqrt(M02 * M02 + M12 * M12);
    let rot: number, tilt: number, psi: number;

    if (sinTilt > ZYZ_GIMBAL_EPSILON) {
        tilt = Math.atan2(sinTilt, M22);
        rot = Math.atan2(M12, M02);
        psi = Math.atan2(M21, -M20);
    } else if (M22 > 0) {
        tilt = 0;
        psi = 0;
        rot = Math.atan2(mEl(rotation, 0, 1), mEl(rotation, 0, 0));
    } else {
        tilt = Math.PI;
        psi = 0;
        rot = Math.atan2(-mEl(rotation, 0, 1), -mEl(rotation, 0, 0));
    }

    return {
        rot: rot * RAD_TO_DEG,
        tilt: tilt * RAD_TO_DEG,
        psi: psi * RAD_TO_DEG,
    };
}

function getMetadataNumber(particle: ParticleListParticle, key: string): number | undefined {
    const value = particle.metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return void 0;
}

function getMetadataString(particle: ParticleListParticle, key: string): string | undefined {
    const value = particle.metadata?.[key];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
    return void 0;
}

function getParticleAngles(particle: ParticleListParticle, source: RelionAngleSource) {
    // Preferred path: round-trip metadata stored by the reader.
    if (source !== 'subtomogram') {
        const rot = getMetadataNumber(particle, 'particleRot');
        const tilt = getMetadataNumber(particle, 'particleTilt');
        const psi = getMetadataNumber(particle, 'particlePsi');
        if (rot !== void 0 && tilt !== void 0 && psi !== void 0) return { rot, tilt, psi };
    }

    // Fall back to decomposing the rotation matrix. If origin (subtomogram) rotation
    // was applied, remove it first so the recovered Euler angles are the per-particle ones.
    const relionPart = Mat4();
    if (particle.originRotation) {
        const subtomoInv = Mat4.transpose(Mat4(), particle.originRotation);
        Mat4.mul(relionPart, subtomoInv, particle.rotation);
    } else {
        Mat4.copy(relionPart, particle.rotation);
    }
    return relionRotationToEuler(relionPart);
}

function getSubtomogramAngles(particle: ParticleListParticle) {
    const rot = getMetadataNumber(particle, 'subtomogramRot');
    const tilt = getMetadataNumber(particle, 'subtomogramTilt');
    const psi = getMetadataNumber(particle, 'subtomogramPsi');
    if (rot !== void 0 && tilt !== void 0 && psi !== void 0) return { rot, tilt, psi };
    if (!particle.originRotation) return;
    return relionRotationToEuler(particle.originRotation);
}

function formatFloat(value: number, decimals = 6): string {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(decimals);
}

function formatInt(value: number): string {
    return `${Math.trunc(value)}`;
}

function formatStarString(value: string): string {
    // Escape with double quotes if the value contains whitespace or special chars.
    if (value === '' || /[\s'"#]/.test(value)) {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
}

interface ParticleColumn {
    name: string
    type: 'float' | 'int' | 'string'
    decimals?: number
    get: (particle: ParticleListParticle, ctx: ParticleContext) => number | string | undefined
}

interface ParticleContext {
    positionScale: number
    metadata: RelionStarExportMetadata
    pixelCoordinate: Vec3
    pixelOrigin: Vec3
    angstromCoordinate: Vec3
    angstromOrigin: Vec3
    centeredAngstromCoordinate: Vec3
    angles: { rot: number, tilt: number, psi: number }
    subtomogramAngles?: { rot: number, tilt: number, psi: number }
}

function buildParticleContext(particle: ParticleListParticle, positionScale: number, metadata: RelionStarExportMetadata): ParticleContext {
    const apix = positionScale;
    const pixelCoordinate = Vec3.clone(particle.coordinate);
    if (particle.coordinateUnit === 'angstrom' && apix > 0) Vec3.scale(pixelCoordinate, pixelCoordinate, 1 / apix);

    const angstromCoordinate = Vec3.clone(particle.coordinate);
    if (particle.coordinateUnit === 'pixel') Vec3.scale(angstromCoordinate, angstromCoordinate, apix);

    const pixelOrigin = Vec3.clone(particle.origin);
    if (particle.originUnit === 'angstrom' && apix > 0) Vec3.scale(pixelOrigin, pixelOrigin, 1 / apix);

    const angstromOrigin = Vec3.clone(particle.origin);
    if (particle.originUnit === 'pixel') Vec3.scale(angstromOrigin, angstromOrigin, apix);

    const centeredAngstromCoordinate = Vec3.clone(angstromCoordinate);
    if (metadata.boxCenter) {
        const centerAngstrom = Vec3.scale(Vec3(), metadata.boxCenter, apix);
        Vec3.sub(centeredAngstromCoordinate, centeredAngstromCoordinate, centerAngstrom);
    }

    const angles = getParticleAngles(particle, metadata.angleSource);
    const subtomogramAngles = getSubtomogramAngles(particle);

    return { positionScale: apix, metadata, pixelCoordinate, pixelOrigin, angstromCoordinate, angstromOrigin, centeredAngstromCoordinate, angles, subtomogramAngles };
}

function buildColumns(data: ParticleList, metadata: RelionStarExportMetadata): ParticleColumn[] {
    const columns: ParticleColumn[] = [];

    if (metadata.includeTomoNameColumn) {
        columns.push({
            name: 'rlnTomoName', type: 'string',
            get: (p, c) => getMetadataString(p, 'tomoName') ?? getMetadataString(p, 'tomogram') ?? c.metadata.defaultTomoName ?? ''
        });
    }

    if (metadata.coordinateConvention === 'centered-angstrom') {
        columns.push({ name: 'rlnCenteredCoordinateXAngst', type: 'float', decimals: 6, get: (_, c) => c.centeredAngstromCoordinate[0] });
        columns.push({ name: 'rlnCenteredCoordinateYAngst', type: 'float', decimals: 6, get: (_, c) => c.centeredAngstromCoordinate[1] });
        columns.push({ name: 'rlnCenteredCoordinateZAngst', type: 'float', decimals: 6, get: (_, c) => c.centeredAngstromCoordinate[2] });
    } else {
        columns.push({ name: 'rlnCoordinateX', type: 'float', decimals: 6, get: (_, c) => c.pixelCoordinate[0] });
        columns.push({ name: 'rlnCoordinateY', type: 'float', decimals: 6, get: (_, c) => c.pixelCoordinate[1] });
        columns.push({ name: 'rlnCoordinateZ', type: 'float', decimals: 6, get: (_, c) => c.pixelCoordinate[2] });
    }

    columns.push({ name: 'rlnAngleRot', type: 'float', decimals: 6, get: (_, c) => c.angles.rot });
    columns.push({ name: 'rlnAngleTilt', type: 'float', decimals: 6, get: (_, c) => c.angles.tilt });
    columns.push({ name: 'rlnAnglePsi', type: 'float', decimals: 6, get: (_, c) => c.angles.psi });

    const hasSubtomo = data.particles.some(p => !!p.originRotation || p.metadata?.subtomogramRot !== void 0);
    if (hasSubtomo) {
        columns.push({ name: 'rlnTomoSubtomogramRot', type: 'float', decimals: 6, get: (_, c) => c.subtomogramAngles?.rot ?? 0 });
        columns.push({ name: 'rlnTomoSubtomogramTilt', type: 'float', decimals: 6, get: (_, c) => c.subtomogramAngles?.tilt ?? 0 });
        columns.push({ name: 'rlnTomoSubtomogramPsi', type: 'float', decimals: 6, get: (_, c) => c.subtomogramAngles?.psi ?? 0 });
    }

    if (metadata.originConvention === 'angstrom') {
        columns.push({ name: 'rlnOriginXAngst', type: 'float', decimals: 6, get: (_, c) => c.angstromOrigin[0] });
        columns.push({ name: 'rlnOriginYAngst', type: 'float', decimals: 6, get: (_, c) => c.angstromOrigin[1] });
        columns.push({ name: 'rlnOriginZAngst', type: 'float', decimals: 6, get: (_, c) => c.angstromOrigin[2] });
    } else if (metadata.originConvention === 'pixel') {
        columns.push({ name: 'rlnOriginX', type: 'float', decimals: 6, get: (_, c) => c.pixelOrigin[0] });
        columns.push({ name: 'rlnOriginY', type: 'float', decimals: 6, get: (_, c) => c.pixelOrigin[1] });
        columns.push({ name: 'rlnOriginZ', type: 'float', decimals: 6, get: (_, c) => c.pixelOrigin[2] });
    }

    if (metadata.includeOpticsGroupColumn) {
        columns.push({
            name: 'rlnOpticsGroup', type: 'int',
            get: (p, c) => getMetadataNumber(p, 'opticsGroup') ?? c.metadata.optics.opticsGroup
        });
    }

    if (metadata.includeMicrographNameColumn) {
        columns.push({
            name: 'rlnMicrographName', type: 'string',
            get: (p, c) => getMetadataString(p, 'micrographName') ?? getMetadataString(p, 'micrograph') ?? c.metadata.defaultMicrographName ?? ''
        });
    }

    if (metadata.includeImageNameColumn) {
        columns.push({
            name: 'rlnImageName', type: 'string',
            get: (p, c) => getMetadataString(p, 'imageName') ?? c.metadata.defaultImageName ?? ''
        });
    }

    if (metadata.includeGroupNumberColumn) {
        columns.push({
            name: 'rlnGroupNumber', type: 'int',
            get: (p) => getMetadataNumber(p, 'groupNumber') ?? 1
        });
    }

    if (metadata.includeClassNumberColumn) {
        columns.push({
            name: 'rlnClassNumber', type: 'int',
            get: (p) => getMetadataNumber(p, 'classNumber') ?? 1
        });
    }

    return columns;
}

function formatColumnValue(value: number | string | undefined, col: ParticleColumn): string {
    if (value === void 0 || value === null) {
        if (col.type === 'string') return formatStarString('');
        return col.type === 'int' ? '0' : '0.000000';
    }
    if (col.type === 'string') return formatStarString(`${value}`);
    if (col.type === 'int') return formatInt(value as number);
    return formatFloat(value as number, col.decimals ?? 6);
}

function emitLoopHeader(out: string[], blockName: string, columnNames: ReadonlyArray<string>) {
    out.push(`data_${blockName}`);
    out.push('');
    out.push('loop_');
    for (let i = 0; i < columnNames.length; i++) {
        out.push(`_${columnNames[i]} #${i + 1}`);
    }
}

function emitOpticsBlock(out: string[], optics: RelionStarOpticsRow) {
    const cols: Array<{ name: string, value: string }> = [];
    cols.push({ name: 'rlnOpticsGroup', value: formatInt(optics.opticsGroup) });
    cols.push({ name: 'rlnOpticsGroupName', value: formatStarString(optics.opticsGroupName) });
    cols.push({ name: 'rlnImagePixelSize', value: formatFloat(optics.imagePixelSize, 6) });
    if (optics.imageSize !== void 0) cols.push({ name: 'rlnImageSize', value: formatInt(optics.imageSize) });
    if (optics.imageDimensionality !== void 0) cols.push({ name: 'rlnImageDimensionality', value: formatInt(optics.imageDimensionality) });
    if (optics.voltage !== void 0) cols.push({ name: 'rlnVoltage', value: formatFloat(optics.voltage, 3) });
    if (optics.sphericalAberration !== void 0) cols.push({ name: 'rlnSphericalAberration', value: formatFloat(optics.sphericalAberration, 6) });
    if (optics.amplitudeContrast !== void 0) cols.push({ name: 'rlnAmplitudeContrast', value: formatFloat(optics.amplitudeContrast, 6) });

    emitLoopHeader(out, 'optics', cols.map(c => c.name));
    out.push(cols.map(c => c.value).join(' '));
    out.push('');
}

export function writeRelionStarParticleList(data: ParticleList, options: RelionStarWriteOptions): string {
    const { positionScale, metadata } = options;
    const out: string[] = [];

    out.push('# Generated by Mol* particle export');
    out.push(`# Format: RELION STAR (positionScale = ${formatFloat(positionScale, 6)})`);
    out.push('');

    emitOpticsBlock(out, metadata.optics);

    const columns = buildColumns(data, metadata);
    emitLoopHeader(out, metadata.particleBlockName || 'particles', columns.map(c => c.name));

    for (let i = 0, il = data.particles.length; i < il; ++i) {
        const particle = data.particles[i];
        const ctx = buildParticleContext(particle, positionScale, metadata);
        const row: string[] = [];
        for (const col of columns) {
            row.push(formatColumnValue(col.get(particle, ctx), col));
        }
        out.push(row.join(' '));
    }
    out.push('');

    return out.join('\n');
}
