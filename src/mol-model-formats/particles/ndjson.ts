/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList, ParticleUnit } from '../../mol-model/particles/particle-list';
import { CryoEtDataPortalNdjsonFile } from '../../mol-io/reader/cryoet/ndjson';
import { packParticleList } from './common';

function setRotationFromRowMajor3x3(out: Mat4, values: ArrayLike<number>) {
    Mat4.setIdentity(out);
    Mat4.setValue(out, 0, 0, values[0]);
    Mat4.setValue(out, 0, 1, values[1]);
    Mat4.setValue(out, 0, 2, values[2]);
    Mat4.setValue(out, 1, 0, values[3]);
    Mat4.setValue(out, 1, 1, values[4]);
    Mat4.setValue(out, 1, 2, values[5]);
    Mat4.setValue(out, 2, 0, values[6]);
    Mat4.setValue(out, 2, 1, values[7]);
    Mat4.setValue(out, 2, 2, values[8]);
    return out;
}

function cryoEtRotationToMat4(out: Mat4, matrix: unknown) {
    if (matrix === void 0) return Mat4.setIdentity(out);

    if (Array.isArray(matrix) && matrix.length === 9 && matrix.every(value => Number.isFinite(value))) {
        return setRotationFromRowMajor3x3(out, matrix as ArrayLike<number>);
    }

    if (Array.isArray(matrix) && matrix.length === 3 && matrix.every(row => Array.isArray(row) && row.length === 3)) {
        const flat: number[] = [];
        for (const row of matrix as ReadonlyArray<ReadonlyArray<number>>) {
            for (const value of row) flat.push(value);
        }
        if (flat.every(value => Number.isFinite(value))) {
            return setRotationFromRowMajor3x3(out, flat);
        }
    }

    throw new Error('Unsupported CryoET Data Portal xyz_rotation_matrix format.');
}

export interface CryoEtDataPortalParticleListOptions {
    readonly label?: string
    readonly coordinateUnit?: ParticleUnit
    readonly type?: string
}

function buildCryoEtLabel(type?: string) {
    if (type) return `CryoET Data Portal particles (${type})`;
    return 'CryoET Data Portal particles';
}

export function createParticleListFromCryoEtDataPortalNdjson(data: CryoEtDataPortalNdjsonFile, options: CryoEtDataPortalParticleListOptions = {}): ParticleList {
    const coordinateUnit = options.coordinateUnit ?? 'pixel';

    const particleData: {
        coordinate: Vec3
        coordinateUnit: ParticleUnit
        origin: Vec3
        originUnit: ParticleUnit
        rotation: Mat4
    }[] = [];

    for (let index = 0, il = data.records.length; index < il; ++index) {
        const record = data.records[index];
        if (options.type && record.type !== options.type) continue;

        particleData.push({
            coordinate: Vec3.create(record.location.x, record.location.y, record.location.z),
            coordinateUnit,
            origin: Vec3.create(0, 0, 0),
            originUnit: coordinateUnit,
            rotation: cryoEtRotationToMat4(Mat4(), record.xyz_rotation_matrix),
        });
    }

    if (particleData.length === 0) {
        throw new Error(options.type
            ? `No CryoET Data Portal ndjson records matched type '${options.type}'.`
            : 'No readable CryoET Data Portal ndjson particle records were found.');
    }

    return packParticleList(
        options.label ?? buildCryoEtLabel(options.type),
        coordinateUnit,
        void 0,
        particleData,
        {
            data,
            format: 'cryoet-data-portal-ndjson',
            warnings: [
                options.coordinateUnit === void 0
                    ? 'CryoET Data Portal ndjson does not encode distance units; coordinates are treated as pixel-space by default.'
                    : void 0,
            ].filter((v): v is string => !!v),
        }
    );
}
