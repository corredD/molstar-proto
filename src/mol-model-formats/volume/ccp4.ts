/**
 * Copyright (c) 2018-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { VolumeData } from '../../mol-model/volume/data'
import { Task } from '../../mol-task';
import { SpacegroupCell, Box3D } from '../../mol-math/geometry';
import { Tensor, Vec3 } from '../../mol-math/linear-algebra';
import { Ccp4File, Ccp4Header } from '../../mol-io/reader/ccp4/schema';
import { degToRad } from '../../mol-math/misc';
import { getCcp4ValueType } from '../../mol-io/reader/ccp4/parser';
import { TypedArrayValueType } from '../../mol-io/common/typed-array';
import { arrayMin, arrayRms, arrayMean, arrayMax } from '../../mol-util/array';

/** When available (e.g. in MRC files) use ORIGIN records instead of N[CRS]START */
export function getCcp4Origin(header: Ccp4Header): Vec3 {
    if (header.originX === 0.0 && header.originY === 0.0 && header.originZ === 0.0) {
        return Vec3.create(header.NCSTART, header.NRSTART, header.NSSTART)
    } else {
        return Vec3.create(
            header.originX / (header.xLength / header.NX),
            header.originY / (header.yLength / header.NY),
            header.originZ / (header.zLength / header.NZ)
        )
    }
}

function getTypedArrayCtor(header: Ccp4Header) {
    const valueType = getCcp4ValueType(header)
    switch (valueType) {
        case TypedArrayValueType.Float32: return Float32Array;
        case TypedArrayValueType.Int8: return Int8Array;
        case TypedArrayValueType.Int16: return Int16Array;
        case TypedArrayValueType.Uint16: return Uint16Array;
    }
    throw Error(`${valueType} is not a supported value format.`);
}

export function volumeFromCcp4(source: Ccp4File, params?: { voxelSize?: Vec3, offset?: Vec3 }): Task<VolumeData> {
    return Task.create<VolumeData>('Create Volume Data', async ctx => {
        const { header, values } = source;
        const size = Vec3.create(header.xLength, header.yLength, header.zLength)
        if (params && params.voxelSize) Vec3.mul(size, size, params.voxelSize)
        const angles = Vec3.create(degToRad(header.alpha), degToRad(header.beta), degToRad(header.gamma))
        const spacegroup = header.ISPG > 65536 ? 0 : header.ISPG
        const cell = SpacegroupCell.create(spacegroup || 'P 1', size, angles);

        const axis_order_fast_to_slow = Vec3.create(header.MAPC - 1, header.MAPR - 1, header.MAPS - 1);
        const normalizeOrder = Tensor.convertToCanonicalAxisIndicesFastToSlow(axis_order_fast_to_slow);

        const grid = [header.NX, header.NY, header.NZ];
        const extent = normalizeOrder([header.NC, header.NR, header.NS]);
        const origin = getCcp4Origin(header)
        if (params?.offset) Vec3.add(origin, origin, params.offset)
        const gridOrigin = normalizeOrder(origin);

        const origin_frac = Vec3.create(gridOrigin[0] / grid[0], gridOrigin[1] / grid[1], gridOrigin[2] / grid[2]);
        const dimensions_frac = Vec3.create(extent[0] / grid[0], extent[1] / grid[1], extent[2] / grid[2]);

        const space = Tensor.Space(extent, Tensor.invertAxisOrder(axis_order_fast_to_slow), getTypedArrayCtor(header));
        const data = Tensor.create(space, Tensor.Data1(values));

        // TODO Calculate stats? When to trust header data?
        // Min/max/mean are reliable (based on LiteMol/DensityServer usage)
        // These, however, calculate sigma, so no data on that.

        return {
            cell,
            fractionalBox: Box3D.create(origin_frac, Vec3.add(Vec3.zero(), origin_frac, dimensions_frac)),
            data,
            dataStats: {
                min: isNaN(header.AMIN) ? arrayMin(values) : header.AMIN,
                max: isNaN(header.AMAX) ? arrayMax(values) : header.AMAX,
                mean: isNaN(header.AMEAN) ? arrayMean(values) : header.AMEAN,
                sigma: (isNaN(header.ARMS) || header.ARMS === 0) ? arrayRms(values) : header.ARMS
            }
        };
    });
}