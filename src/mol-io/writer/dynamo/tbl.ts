/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '../../../mol-math/linear-algebra';
import { ParticleList, ParticleListParticle } from '../../reader/particle-list';

export interface DynamoTblWriteOptions {
    apix: number
    defaultClass?: number
    defaultRegion?: number
    defaultAnnotation?: number
    defaultTomoId?: number
    /** When true, the writer assigns a sequential tomo ID to each unique tomogram-name string. */
    autoAssignTomoIds?: boolean
}

export interface DynamoDocEntry {
    id: number
    name: string
}

const RAD_TO_DEG = 180 / Math.PI;
const ZXZ_GIMBAL_EPSILON = 1e-7;

function mEl(m: Mat4, row: number, col: number) {
    return m[col * 4 + row];
}

/**
 * Inverse of `dynamoEulerToRotation` in mol-io/reader/dynamo/tbl.ts.
 * Stored particle.rotation = Rz(-narot) Rx(tilt) Rz(-tdrot); decompose as ZXZ.
 */
export function dynamoRotationToEuler(rotation: Mat4): { tdrot: number, tilt: number, narot: number } {
    const M20 = mEl(rotation, 2, 0);
    const M21 = mEl(rotation, 2, 1);
    const M22 = mEl(rotation, 2, 2);
    const M02 = mEl(rotation, 0, 2);
    const M12 = mEl(rotation, 1, 2);

    const sinBeta = Math.sqrt(M20 * M20 + M21 * M21);
    let alpha: number, beta: number, gamma: number;

    if (sinBeta > ZXZ_GIMBAL_EPSILON) {
        beta = Math.atan2(sinBeta, M22);
        alpha = Math.atan2(M20, M21);
        gamma = Math.atan2(M02, -M12);
    } else if (M22 > 0) {
        beta = 0;
        alpha = 0;
        gamma = Math.atan2(mEl(rotation, 1, 0), mEl(rotation, 0, 0));
    } else {
        beta = Math.PI;
        alpha = 0;
        gamma = Math.atan2(mEl(rotation, 1, 0), mEl(rotation, 0, 0));
    }

    return {
        tdrot: -alpha * RAD_TO_DEG,
        tilt: beta * RAD_TO_DEG,
        narot: -gamma * RAD_TO_DEG,
    };
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

function formatInt(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return `${Math.trunc(value)}`;
}

interface DynamoTomoAssignment {
    idsByParticle: number[]
    doc: DynamoDocEntry[] | undefined
}

function assignTomoIds(particles: ReadonlyArray<ParticleListParticle>, options: DynamoTblWriteOptions): DynamoTomoAssignment {
    const idsByParticle = new Array<number>(particles.length);
    const docEntries: DynamoDocEntry[] = [];
    const nameToId = new Map<string, number>();
    let nextId = 1;
    let anyNameAssigned = false;

    for (let i = 0; i < particles.length; ++i) {
        const p = particles[i];
        const numericTomo = getNumberMeta(p, 'tomo') ?? getNumberMeta(p, 'tomogram');
        const stringTomo = getStringMeta(p, 'tomoName') ?? getStringMeta(p, 'tomogram') ?? getStringMeta(p, 'tomo')
            ?? getStringMeta(p, 'micrographName') ?? getStringMeta(p, 'micrograph');

        if (numericTomo !== void 0) {
            idsByParticle[i] = Math.trunc(numericTomo);
            if (stringTomo && !nameToId.has(stringTomo)) {
                nameToId.set(stringTomo, idsByParticle[i]);
                docEntries.push({ id: idsByParticle[i], name: stringTomo });
                anyNameAssigned = true;
            }
            continue;
        }

        if (stringTomo) {
            let id = nameToId.get(stringTomo);
            if (id === void 0) {
                id = nextId++;
                nameToId.set(stringTomo, id);
                docEntries.push({ id, name: stringTomo });
                anyNameAssigned = true;
            }
            idsByParticle[i] = id;
            continue;
        }

        idsByParticle[i] = options.defaultTomoId ?? 1;
    }

    return {
        idsByParticle,
        doc: anyNameAssigned ? docEntries.sort((a, b) => a.id - b.id) : undefined,
    };
}

export interface DynamoTblExportResult {
    tbl: string
    doc?: string
    docEntries?: DynamoDocEntry[]
}

export function writeDynamoTblParticleList(data: ParticleList, options: DynamoTblWriteOptions): DynamoTblExportResult {
    const apix = options.apix;
    const assignment = assignTomoIds(data.particles, options);

    const lines: string[] = [];
    for (let i = 0; i < data.particles.length; ++i) {
        const p = data.particles[i];

        const tag = getNumberMeta(p, 'tag') ?? p.index + 1;
        const tomoId = assignment.idsByParticle[i];
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

        // 36 fixed columns (0..35) — Dynamo conventional layout.
        const row = new Array<string>(36).fill('0');
        row[0] = formatInt(tag);                  // tag
        row[1] = '1';                              // aligned
        row[2] = '1';                              // averaged
        row[3] = '0'; row[4] = '0'; row[5] = '0';  // shift_x/y/z (absorbed into position on import)
        row[6] = formatFloat(angles.tdrot, 6);
        row[7] = formatFloat(angles.tilt, 6);
        row[8] = formatFloat(angles.narot, 6);
        for (let c = 9; c <= 18; ++c) row[c] = '0'; // cc, cc2, cpu, ftype, ymintilt, ymaxtilt, xmintilt, xmaxtilt, fs1, fs2
        row[19] = formatInt(tomoId);
        row[20] = formatInt(region);
        row[21] = formatInt(klass);
        row[22] = formatInt(annotation);
        row[23] = formatFloat(coord[0], 6);
        row[24] = formatFloat(coord[1], 6);
        row[25] = formatFloat(coord[2], 6);
        for (let c = 26; c <= 34; ++c) row[c] = '0';
        row[35] = formatFloat(apix > 0 ? apix : (getNumberMeta(p, 'apix') ?? 1), 6);

        lines.push(row.join(' '));
    }

    const tbl = lines.join('\n') + '\n';
    const doc = assignment.doc ? buildDynamoDoc(assignment.doc) : void 0;
    return { tbl, doc, docEntries: assignment.doc };
}

function buildDynamoDoc(entries: ReadonlyArray<DynamoDocEntry>): string {
    return entries.map(e => `${e.id} ${e.name}`).join('\n') + '\n';
}
