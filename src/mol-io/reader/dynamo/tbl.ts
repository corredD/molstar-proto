/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { ParticleList } from '../particle-list';

const RequiredColumnCount = 26;
const ShiftColumn = 3;
const AngleColumn = 6;
const PositionColumn = 23;
const PixelSizeColumn = 35;

function degToRad(value: number) {
    return value * Math.PI / 180;
}

function dynamoEulerToRotation(out: Mat4, tdrot: number, tilt: number, narot: number) {
    // Dynamo table angles define a clockwise-positive ZXZ rotation that acts on the
    // template volume. For instancing we need the coordinate transform, which Dynamo
    // documents as inv(dynamo_euler2matrix([tdrot, tilt, narot])).
    const tdrotZ = Mat4.fromRotation(Mat4(), degToRad(-tdrot), Vec3.unitZ);
    const tiltX = Mat4.fromRotation(Mat4(), degToRad(tilt), Vec3.unitX);
    const narotZ = Mat4.fromRotation(Mat4(), degToRad(-narot), Vec3.unitZ);

    Mat4.mul(out, tiltX, tdrotZ);
    Mat4.mul(out, narotZ, out);
    return out;
}

function getUniquePositiveColumnValue(rows: number[][], column: number) {
    let value: number | undefined = void 0;
    for (const row of rows) {
        const current = row[column];
        if (!Number.isFinite(current) || current <= 0) continue;
        if (value === void 0) {
            value = current;
        } else if (Math.abs(value - current) > 1e-6) {
            return;
        }
    }
    return value;
}

export function parseDynamoTblParticleList(data: string): ParticleList {
    const warnings: string[] = [];
    const parsedRows: number[][] = [];
    let skippedRows = 0;

    for (const line of data.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('%') || trimmed.startsWith(';')) continue;

        const tokens = trimmed.split(/\s+/);
        if (tokens.length < RequiredColumnCount) {
            skippedRows++;
            continue;
        }

        const row = tokens.map(token => Number(token));
        if (row.slice(0, RequiredColumnCount).some(value => !Number.isFinite(value))) {
            skippedRows++;
            continue;
        }

        parsedRows.push(row);
    }

    if (parsedRows.length === 0) {
        throw new Error('No readable Dynamo table rows were found.');
    }

    if (skippedRows > 0) {
        warnings.push(`Skipped ${skippedRows} Dynamo row${skippedRows === 1 ? '' : 's'} that were incomplete or not numeric.`);
    }

    const particles = parsedRows.map((row, index) => {
        const coordinate = Vec3.create(
            row[PositionColumn + 0] + row[ShiftColumn + 0],
            row[PositionColumn + 1] + row[ShiftColumn + 1],
            row[PositionColumn + 2] + row[ShiftColumn + 2],
        );
        const origin = Vec3.create(0, 0, 0);
        const rotation = dynamoEulerToRotation(Mat4(), row[AngleColumn + 0], row[AngleColumn + 1], row[AngleColumn + 2]);

        return {
            index,
            coordinate,
            coordinateUnit: 'pixel' as const,
            origin,
            originUnit: 'pixel' as const,
            rotation,
            metadata: {
                tag: row[0],
                tomo: row[19],
                region: row[20],
                class: row[21],
                annotation: row[22],
                apix: row[PixelSizeColumn],
                tdrot: row[AngleColumn + 0],
                tilt: row[AngleColumn + 1],
                narot: row[AngleColumn + 2],
            }
        };
    });

    return {
        format: 'dynamo-tbl',
        particleBlockHeader: 'dynamo',
        particles,
        suggestedScale: getUniquePositiveColumnValue(parsedRows, PixelSizeColumn) ?? 1,
        warnings,
    };
}
