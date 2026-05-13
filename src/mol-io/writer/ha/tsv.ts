/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '../../../mol-math/linear-algebra';
import { ParticleList, ParticleListParticle } from '../../reader/particle-list';

export interface HaTsvWriteOptions {
    apix: number
    includeTomogramColumn?: boolean
    includeMicrographColumn?: boolean
    includeScoreColumn?: boolean
}

const RAD_TO_DEG = 180 / Math.PI;
const GIMBAL_EPSILON = 1e-7;

function mEl(m: Mat4, row: number, col: number) {
    return m[col * 4 + row];
}

/**
 * Inverse of `haEulerToRotation` in mol-io/reader/ha/tsv.ts.
 * Stored particle.rotation = Rz(z) Ry(y) Rx(x); decompose with XYZ extrinsic convention.
 */
export function haRotationToEuler(rotation: Mat4): { x: number, y: number, z: number } {
    const R00 = mEl(rotation, 0, 0);
    const R10 = mEl(rotation, 1, 0);
    const R20 = mEl(rotation, 2, 0);
    const R21 = mEl(rotation, 2, 1);
    const R22 = mEl(rotation, 2, 2);

    let x: number, y: number, z: number;
    const cosY = Math.sqrt(R00 * R00 + R10 * R10);

    if (cosY > GIMBAL_EPSILON) {
        y = Math.atan2(-R20, cosY);
        x = Math.atan2(R21, R22);
        z = Math.atan2(R10, R00);
    } else {
        // Gimbal lock: y = ±π/2. Set z = 0 by convention.
        y = Math.atan2(-R20, cosY);
        z = 0;
        x = Math.atan2(-mEl(rotation, 1, 2), mEl(rotation, 1, 1));
    }

    return { x: x * RAD_TO_DEG, y: y * RAD_TO_DEG, z: z * RAD_TO_DEG };
}

function getNumberMeta(p: ParticleListParticle, key: string): number | undefined {
    const v = p.metadata?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : void 0;
}

function getStringMeta(p: ParticleListParticle, key: string): string | undefined {
    const v = p.metadata?.[key];
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return `${v}`;
    return void 0;
}

function formatFloat(value: number, decimals = 6): string {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(decimals);
}

export function writeHaTsvParticleList(data: ParticleList, options: HaTsvWriteOptions): string {
    const apix = options.apix;

    const includeTomo = options.includeTomogramColumn ?? data.particles.some(p => !!p.metadata?.tomogram || !!p.metadata?.tomo || !!p.metadata?.tomoName);
    const includeMicro = options.includeMicrographColumn ?? data.particles.some(p => !!p.metadata?.micrographName || !!p.metadata?.micrograph);
    const includeScore = options.includeScoreColumn ?? data.particles.some(p => p.metadata?.score !== void 0);

    const header: string[] = ['x', 'y', 'z', 'euler_x', 'euler_y', 'euler_z'];
    if (includeTomo) header.push('tomogram');
    if (includeMicro) header.push('micrograph');
    if (includeScore) header.push('score');

    const lines: string[] = [header.join('\t')];

    for (const p of data.particles) {
        const coord = p.coordinateUnit === 'angstrom' && apix > 0
            ? [p.coordinate[0] / apix, p.coordinate[1] / apix, p.coordinate[2] / apix]
            : [p.coordinate[0], p.coordinate[1], p.coordinate[2]];

        const ex = getNumberMeta(p, 'eulerX');
        const ey = getNumberMeta(p, 'eulerY');
        const ez = getNumberMeta(p, 'eulerZ');
        const angles = (ex !== void 0 && ey !== void 0 && ez !== void 0) ? { x: ex, y: ey, z: ez } : haRotationToEuler(p.rotation);

        const row: string[] = [
            formatFloat(coord[0], 6),
            formatFloat(coord[1], 6),
            formatFloat(coord[2], 6),
            formatFloat(angles.x, 6),
            formatFloat(angles.y, 6),
            formatFloat(angles.z, 6),
        ];
        if (includeTomo) row.push(getStringMeta(p, 'tomoName') ?? getStringMeta(p, 'tomogram') ?? getStringMeta(p, 'tomo') ?? '');
        if (includeMicro) row.push(getStringMeta(p, 'micrographName') ?? getStringMeta(p, 'micrograph') ?? '');
        if (includeScore) {
            const score = getNumberMeta(p, 'score');
            row.push(score !== void 0 ? formatFloat(score, 6) : '');
        }

        lines.push(row.join('\t'));
    }

    return lines.join('\n') + '\n';
}
