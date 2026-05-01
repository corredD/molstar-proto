/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Grid } from '../../mol-model/volume';
import { Mat4, Tensor } from '../../mol-math/linear-algebra';
import { PluginStateObject as SO } from '../objects';
import { StateTransforms } from '../transforms';

function createVolume(dimensions: [number, number, number]) {
    return new SO.Volume.Data({
        grid: {
            transform: { kind: 'matrix', matrix: Mat4.identity() },
            cells: Tensor.create(Tensor.Space(dimensions, [0, 1, 2]), Tensor.Data1(new Float32Array(dimensions[0] * dimensions[1] * dimensions[2]))),
            stats: { min: 0, max: 0, mean: 0, sigma: 0 },
        } satisfies Grid,
    } as any, { label: 'Volume', description: 'Test Volume' });
}

describe('VolumeTransform', () => {
    it('can center a volume at the origin', () => {
        const volume = createVolume([2, 4, 6]);
        const transformed = StateTransforms.Volume.VolumeTransform.definition.apply({
            a: volume,
            params: { transform: { name: 'centerAtOrigin', params: {} } },
            cache: {},
            spine: undefined as any,
        }, undefined) as SO.Volume.Data;

        const center = Grid.getBoundingSphere(transformed.data.grid).center;
        expect(Array.from(center)).toEqual([0, 0, 0]);
    });
});
