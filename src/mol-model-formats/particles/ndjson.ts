/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList } from '../../mol-model/particles/particle-list';
import { CryoEtDataPortalNdjsonFile } from '../../mol-io/reader/cryoet/ndjson';
import { packParticleList, ParticleTransformInput } from './common';

function setRotationFromRowMajor3x3(out: Mat4, values: ReadonlyArray<ReadonlyArray<number>>) {
    Mat4.setIdentity(out);
    Mat4.setValue(out, 0, 0, values[0][0]);
    Mat4.setValue(out, 0, 1, values[0][1]);
    Mat4.setValue(out, 0, 2, values[0][2]);
    Mat4.setValue(out, 1, 0, values[1][0]);
    Mat4.setValue(out, 1, 1, values[1][1]);
    Mat4.setValue(out, 1, 2, values[1][2]);
    Mat4.setValue(out, 2, 0, values[2][0]);
    Mat4.setValue(out, 2, 1, values[2][1]);
    Mat4.setValue(out, 2, 2, values[2][2]);
    return out;
}

export interface CryoEtDataPortalParticleListOptions {
    /**
     * Pixel size (Å/pixel) used to convert pixel-space NDJSON coordinates to angstrom.
     * CryoET Data Portal NDJSON does not encode distance units, so this must be supplied.
     */
    readonly pixelSize: number
    readonly type?: string
}

function buildCryoEtLabel(type?: string) {
    if (type) return `CryoET Data Portal particles (${type})`;
    return 'CryoET Data Portal particles';
}

export function createParticleListFromCryoEtDataPortalNdjson(data: CryoEtDataPortalNdjsonFile, options: CryoEtDataPortalParticleListOptions): ParticleList {
    const { pixelSize } = options;
    if (pixelSize === void 0 || !Number.isFinite(pixelSize) || pixelSize <= 0) {
        throw new Error('CryoET Data Portal ndjson requires a positive pixelSize (Å/pixel) to convert pixel-space coordinates to angstrom.');
    }

    const particleData: ParticleTransformInput[] = [];

    for (let index = 0, il = data.records.length; index < il; ++index) {
        const record = data.records[index];
        if (options.type && record.type !== options.type) continue;

        particleData.push({
            coordinate: Vec3.create(
                record.location.x * pixelSize,
                record.location.y * pixelSize,
                record.location.z * pixelSize,
            ),
            origin: Vec3.create(0, 0, 0),
            rotation: record.type === 'orientedPoint'
                ? setRotationFromRowMajor3x3(Mat4(), record.xyz_rotation_matrix)
                : undefined,
        });
    }

    if (particleData.length === 0) {
        throw new Error(options.type
            ? `No CryoET Data Portal ndjson records matched type '${options.type}'.`
            : 'No readable CryoET Data Portal ndjson particle records were found.');
    }

    return packParticleList(
        buildCryoEtLabel(options.type),
        particleData,
        {
            data,
            format: 'cryoet-data-portal-ndjson',
            pixelSize,
        }
    );
}
