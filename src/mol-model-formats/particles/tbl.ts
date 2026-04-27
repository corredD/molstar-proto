/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList } from '../../mol-model/particles/particle-list';
import { DynamoTblFile } from '../../mol-io/reader/dynamo/tbl';
import { packParticleList } from './common';
import { degToRad } from '../../mol-math/misc';

function dynamoEulerToRotation(out: Mat4, tdrot: number, tilt: number, narot: number) {
    const tdrotZ = Mat4.fromRotation(Mat4(), degToRad(-tdrot), Vec3.unitZ);
    const tiltX = Mat4.fromRotation(Mat4(), degToRad(tilt), Vec3.unitX);
    const narotZ = Mat4.fromRotation(Mat4(), degToRad(-narot), Vec3.unitZ);

    Mat4.mul(out, tiltX, tdrotZ);
    Mat4.mul(out, narotZ, out);
    return out;
}

function getUniquePositiveColumnValue(rows: ReadonlyArray<Float64Array>, column: number) {
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

export interface DynamoParticleListOptions {
    readonly label?: string
    readonly tomo?: number
}

const DynamoShiftColumn = 3;
const DynamoAngleColumn = 6;
const DynamoTomoColumn = 19;
const DynamoRegionColumn = 20;
const DynamoClassColumn = 21;
const DynamoAnnotationColumn = 22;
const DynamoPositionColumn = 23;
const DynamoPixelSizeColumn = 35;

function buildDynamoLabel(tomo?: number) {
    if (tomo !== void 0) return `Dynamo particles (tomo ${tomo})`;
    return 'Dynamo particles';
}

export function getDynamoTblTomogramIds(data: DynamoTblFile) {
    const tomograms = new Set<number>();
    for (const row of data.rows) {
        const tomo = row[DynamoTomoColumn];
        if (Number.isFinite(tomo)) tomograms.add(tomo);
    }
    return Array.from(tomograms).sort((a, b) => a - b);
}

export function createParticleListFromDynamoTbl(data: DynamoTblFile, options: DynamoParticleListOptions = {}): ParticleList {
    const particleData: {
        coordinate: Vec3
        coordinateUnit: 'pixel'
        origin: Vec3
        originUnit: 'pixel'
        rotation: Mat4
    }[] = [];
    const selectedRows: Float64Array[] = [];

    for (let index = 0, il = data.rows.length; index < il; ++index) {
        const row = data.rows[index];
        if (options.tomo !== void 0 && row[DynamoTomoColumn] !== options.tomo) continue;

        particleData.push({
            coordinate: Vec3.create(
                row[DynamoPositionColumn + 0] + row[DynamoShiftColumn + 0],
                row[DynamoPositionColumn + 1] + row[DynamoShiftColumn + 1],
                row[DynamoPositionColumn + 2] + row[DynamoShiftColumn + 2],
            ),
            coordinateUnit: 'pixel',
            origin: Vec3.create(0, 0, 0),
            originUnit: 'pixel',
            rotation: dynamoEulerToRotation(Mat4(), row[DynamoAngleColumn + 0], row[DynamoAngleColumn + 1], row[DynamoAngleColumn + 2]),
        });

        selectedRows.push(row);
    }

    if (particleData.length === 0) {
        throw new Error(options.tomo !== void 0
            ? `No Dynamo particle rows matched tomo '${options.tomo}'.`
            : 'No readable Dynamo table rows were found.');
    }

    const pixelSize = getUniquePositiveColumnValue(selectedRows, DynamoPixelSizeColumn);

    return packParticleList(
        options.label ?? buildDynamoLabel(options.tomo),
        'pixel',
        pixelSize,
        particleData,
        {
            data,
            format: 'dynamo-tbl',
            warnings: [
                pixelSize === void 0
                    ? 'Dynamo particle coordinates are pixel-space, but no unique positive pixel size was found; pixel-space coordinates default to scale 1.'
                    : void 0,
            ].filter((v): v is string => !!v),
            metadataColumns: {
                tomo: DynamoTomoColumn,
                region: DynamoRegionColumn,
                class: DynamoClassColumn,
                annotation: DynamoAnnotationColumn,
            }
        }
    );
}
