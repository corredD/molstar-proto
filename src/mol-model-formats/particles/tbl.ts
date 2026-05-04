/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList } from '../../mol-model/particles/particle-list';
import { DynamoTblFile } from '../../mol-io/reader/dynamo/tbl';
import { Column } from '../../mol-data/db';
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

function getUniquePositiveFieldValue(field: Column<number>, rowIndices?: ReadonlyArray<number>) {
    let value: number | undefined = void 0;
    const il = rowIndices ? rowIndices.length : field.rowCount;
    for (let i = 0; i < il; ++i) {
        const row = rowIndices ? rowIndices[i] : i;
        if (field.valueKind(row) !== Column.ValueKinds.Present) continue;
        const current = field.value(row);
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
    readonly tomos?: ReadonlyArray<number>
    /** Override pixel size (Å/pixel) used to convert pixel-space coordinates to angstrom. */
    readonly pixelSize?: number
}

function buildDynamoLabel(tomos?: ReadonlyArray<number>) {
    if (tomos !== void 0 && tomos.length > 0) {
        return tomos.length === 1
            ? `Dynamo particles (tomo ${tomos[0]})`
            : `Dynamo particles (tomos ${tomos.join(', ')})`;
    }
    return 'Dynamo particles';
}

export function getDynamoTblTomogramIds(data: DynamoTblFile) {
    const tomograms = new Set<number>();
    const tomo = data.fields.tomo;
    for (let i = 0, il = tomo.rowCount; i < il; ++i) {
        if (tomo.valueKind(i) !== Column.ValueKinds.Present) continue;
        const v = tomo.value(i);
        if (Number.isFinite(v)) tomograms.add(v);
    }
    return Array.from(tomograms).sort((a, b) => a - b);
}

export function createParticleListFromDynamoTbl(data: DynamoTblFile, options: DynamoParticleListOptions = {}): ParticleList {
    const particleData: {
        coordinate: Vec3
        origin: Vec3
        rotation: Mat4
    }[] = [];
    const selectedRows: number[] = [];

    const { x, y, z, dx, dy, dz, tdrot, tilt, narot, tomo, apix } = data.fields;

    const tomoFilter = options.tomos !== void 0 && options.tomos.length > 0
        ? new Set<number>(options.tomos)
        : void 0;

    for (let i = 0, il = data.rowCount; i < il; ++i) {
        if (tomoFilter !== void 0 && !tomoFilter.has(tomo.value(i))) {
            continue;
        }

        particleData.push({
            coordinate: Vec3.create(
                x.value(i) + dx.value(i),
                y.value(i) + dy.value(i),
                z.value(i) + dz.value(i),
            ),
            origin: Vec3.create(0, 0, 0),
            rotation: dynamoEulerToRotation(Mat4(), tdrot.value(i), tilt.value(i), narot.value(i)),
        });

        selectedRows.push(i);
    }

    if (particleData.length === 0) {
        throw new Error(tomoFilter !== void 0
            ? `No Dynamo particle rows matched tomos '${options.tomos!.join(', ')}'.`
            : 'No readable Dynamo table rows were found.');
    }

    const overrideValid = options.pixelSize !== void 0 && Number.isFinite(options.pixelSize) && options.pixelSize > 0;
    const detectedPixelSize = overrideValid ? void 0 : getUniquePositiveFieldValue(apix, selectedRows);
    const pixelSize = overrideValid ? options.pixelSize : detectedPixelSize;
    const pixelScale = (pixelSize !== void 0 && Number.isFinite(pixelSize) && pixelSize > 0) ? pixelSize : 1;

    if (pixelScale !== 1) {
        for (const p of particleData) Vec3.scale(p.coordinate, p.coordinate, pixelScale);
    }

    return packParticleList(
        options.label ?? buildDynamoLabel(options.tomos),
        particleData,
        {
            data,
            format: 'dynamo-tbl',
            warnings: [
                pixelSize === void 0
                    ? 'Dynamo particle coordinates are pixel-space, but no pixel size was provided or detected; coordinates are kept unscaled.'
                    : void 0,
            ].filter((v): v is string => !!v),
            metadataFields: {
                tomo: data.fields.tomo,
                region: data.fields.reg,
                class: data.fields.class,
                annotation: data.fields.annotation,
            }
        }
    );
}
