/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { degToRad } from '../../../mol-math/misc';
import { ParticleList, ParticleListParticle } from '../particle-list';

const RequiredColumns = ['x', 'y', 'z', 'euler_x', 'euler_y', 'euler_z'] as const;

function normalizeColumnName(name: string) {
    return name.trim().replace(/^\uFEFF/, '').toLowerCase();
}

function splitLine(line: string) {
    return line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/);
}

function getHeader(data: string) {
    for (const line of data.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('%') || trimmed.startsWith(';')) continue;
        return splitLine(trimmed).map(normalizeColumnName);
    }
}

export function isHaTsvParticleList(data: string) {
    const header = getHeader(data);
    return !!header && RequiredColumns.every(name => header.includes(name));
}

function getColumnMap(header: readonly string[]) {
    const columns = new Map<string, number>();
    for (let i = 0, il = header.length; i < il; ++i) {
        columns.set(header[i], i);
    }
    return columns;
}

function getNumber(tokens: readonly string[], columns: ReadonlyMap<string, number>, name: string) {
    const index = columns.get(name);
    if (index === void 0) return;
    const value = Number(tokens[index]);
    return Number.isFinite(value) ? value : void 0;
}

function getOptionalNumber(tokens: readonly string[], columns: ReadonlyMap<string, number>, name: string) {
    const index = columns.get(name);
    if (index === void 0 || tokens[index] === void 0 || tokens[index] === '') return;
    const value = Number(tokens[index]);
    return Number.isFinite(value) ? value : void 0;
}

function getOptionalString(tokens: readonly string[], columns: ReadonlyMap<string, number>, names: readonly string[]) {
    for (const name of names) {
        const index = columns.get(name);
        if (index === void 0) continue;
        const value = tokens[index]?.trim();
        if (value) return value;
    }
}

function haEulerToRotation(out: Mat4, x: number, y: number, z: number) {
    // HA TSV columns are named by axis, so interpret them as X/Y/Z Euler rotations.
    const rx = Mat4.fromRotation(Mat4(), degToRad(x), Vec3.unitX);
    const ry = Mat4.fromRotation(Mat4(), degToRad(y), Vec3.unitY);
    const rz = Mat4.fromRotation(Mat4(), degToRad(z), Vec3.unitZ);

    Mat4.mul(out, ry, rx);
    Mat4.mul(out, rz, out);
    return out;
}

export function parseHaTsvParticleList(data: string): ParticleList {
    const warnings: string[] = [];
    const lines = data.split(/\r?\n/);
    let header: string[] | undefined;
    let headerLine = -1;

    for (let i = 0, il = lines.length; i < il; ++i) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('%') || trimmed.startsWith(';')) continue;
        header = splitLine(trimmed).map(normalizeColumnName);
        headerLine = i;
        break;
    }

    if (!header) throw new Error('No HA TSV header row was found.');
    if (!RequiredColumns.every(name => header!.includes(name))) {
        throw new Error(`HA TSV requires columns: ${RequiredColumns.join(', ')}.`);
    }

    const columns = getColumnMap(header);
    const particles: ParticleListParticle[] = [];
    let skippedRows = 0;

    for (let lineIndex = headerLine + 1, il = lines.length; lineIndex < il; ++lineIndex) {
        const trimmed = lines[lineIndex].trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('%') || trimmed.startsWith(';')) continue;

        const tokens = splitLine(trimmed).map(token => token.trim());
        const x = getNumber(tokens, columns, 'x');
        const y = getNumber(tokens, columns, 'y');
        const z = getNumber(tokens, columns, 'z');
        const eulerX = getNumber(tokens, columns, 'euler_x');
        const eulerY = getNumber(tokens, columns, 'euler_y');
        const eulerZ = getNumber(tokens, columns, 'euler_z');

        if (
            x === void 0 || y === void 0 || z === void 0 ||
            eulerX === void 0 || eulerY === void 0 || eulerZ === void 0
        ) {
            skippedRows++;
            continue;
        }

        const tomogram = getOptionalString(tokens, columns, ['tomogram', 'tomo', 'tomo_name']);
        const micrograph = getOptionalString(tokens, columns, ['micrograph', 'micrograph_name']);
        particles.push({
            index: particles.length,
            coordinate: Vec3.create(x, y, z),
            coordinateUnit: 'pixel',
            origin: Vec3.create(0, 0, 0),
            originUnit: 'pixel',
            rotation: haEulerToRotation(Mat4(), eulerX, eulerY, eulerZ),
            metadata: {
                eulerX,
                eulerY,
                eulerZ,
                score: getOptionalNumber(tokens, columns, 'score'),
                detail: getOptionalNumber(tokens, columns, 'detail'),
                tomogram,
                tomo: tomogram,
                micrograph,
                micrographName: micrograph,
            }
        });
    }

    if (particles.length === 0) {
        throw new Error('No readable HA TSV particle rows were found.');
    }

    if (skippedRows > 0) {
        warnings.push(`Skipped ${skippedRows} HA TSV row${skippedRows === 1 ? '' : 's'} that were incomplete or not numeric.`);
    }

    return {
        format: 'ha-tsv',
        particleBlockHeader: 'ha',
        particles,
        suggestedScale: 1,
        warnings,
    };
}
