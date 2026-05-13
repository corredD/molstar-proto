/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParticleList, ParticleListParticle } from '../../reader/particle-list';
import { dynamoRotationToEuler } from '../dynamo/tbl';

export interface ParticlesCsvWriteOptions {
    apix: number
    defaultClass?: number
    defaultRegion?: number
    defaultAnnotation?: number
}

const HEADER = [
    'tag', 'aligned', 'averaged',
    'dx', 'dy', 'dz',
    'tdrot', 'tilt', 'narot',
    'cc', 'cc2', 'cpu', 'ftype', 'ymintilt', 'ymaxtilt', 'xmintilt', 'xmaxtilt', 'fs1', 'fs2',
    'tomo', 'region', 'class', 'annotation',
    'x', 'y', 'z',
    'reserved1', 'reserved2', 'reserved3', 'reserved4', 'reserved5', 'reserved6', 'reserved7', 'reserved8', 'reserved9',
    'apix',
];

function getNumberMeta(p: ParticleListParticle, key: string): number | undefined {
    const v = p.metadata?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : void 0;
}

function formatFloat(value: number, decimals = 6): string {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(decimals);
}

function formatInt(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return `${Math.trunc(value)}`;
}

export function writeParticlesCsv(data: ParticleList, options: ParticlesCsvWriteOptions): string {
    const apix = options.apix;
    const lines: string[] = [HEADER.join(',')];

    for (const p of data.particles) {
        const tag = getNumberMeta(p, 'tag') ?? p.index + 1;
        const tomoId = getNumberMeta(p, 'tomo') ?? getNumberMeta(p, 'tomogram') ?? 1;
        const region = getNumberMeta(p, 'region') ?? options.defaultRegion ?? 1;
        const klass = getNumberMeta(p, 'class') ?? options.defaultClass ?? 1;
        const annotation = getNumberMeta(p, 'annotation') ?? options.defaultAnnotation ?? 0;

        const tdrot = getNumberMeta(p, 'tdrot');
        const tilt = getNumberMeta(p, 'tilt');
        const narot = getNumberMeta(p, 'narot');
        const angles = (tdrot !== void 0 && tilt !== void 0 && narot !== void 0)
            ? { tdrot, tilt, narot }
            : dynamoRotationToEuler(p.rotation);

        const coord = p.coordinateUnit === 'angstrom' && apix > 0
            ? [p.coordinate[0] / apix, p.coordinate[1] / apix, p.coordinate[2] / apix]
            : [p.coordinate[0], p.coordinate[1], p.coordinate[2]];

        const row = new Array<string>(HEADER.length).fill('0');
        row[0] = formatInt(tag);
        row[1] = '1';
        row[2] = '1';
        row[3] = '0'; row[4] = '0'; row[5] = '0';
        row[6] = formatFloat(angles.tdrot);
        row[7] = formatFloat(angles.tilt);
        row[8] = formatFloat(angles.narot);
        row[19] = formatInt(tomoId);
        row[20] = formatInt(region);
        row[21] = formatInt(klass);
        row[22] = formatInt(annotation);
        row[23] = formatFloat(coord[0]);
        row[24] = formatFloat(coord[1]);
        row[25] = formatFloat(coord[2]);
        row[35] = formatFloat(apix > 0 ? apix : (getNumberMeta(p, 'apix') ?? 1));

        lines.push(row.join(','));
    }

    return lines.join('\n') + '\n';
}
