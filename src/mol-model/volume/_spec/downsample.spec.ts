/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Tensor, Vec3, Mat4 } from '../../../mol-math/linear-algebra';
import { Grid } from '../grid';
import { Volume } from '../volume';

function makeMatrixVolume(nx: number, ny: number, nz: number, fill: (x: number, y: number, z: number) => number): Volume {
    const space = Tensor.Space([nx, ny, nz], [0, 1, 2], Float32Array);
    const data = space.create();
    let min = Infinity, max = -Infinity;
    for (let z = 0; z < nz; ++z) for (let y = 0; y < ny; ++y) for (let x = 0; x < nx; ++x) {
        const v = fill(x, y, z);
        space.set(data, x, y, z, v);
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const grid: Grid = {
        transform: { kind: 'matrix', matrix: Mat4.identity() },
        cells: Tensor.create(space, data),
        stats: { min, max, mean: 0, sigma: 0 },
    };
    return { grid } as unknown as Volume;
}

describe('Volume.downsample', () => {
    it('returns the input unchanged for factor <= 1', () => {
        const v = makeMatrixVolume(4, 4, 4, x => x);
        expect(Volume.downsample(v, 1)).toBe(v);
        expect(Volume.downsample(v, 0)).toBe(v);
    });

    it('halves the dimensions (ceil) and box-averages cells', () => {
        // value depends only on x, so a 2x downsample averages adjacent x pairs.
        const v = makeMatrixVolume(4, 4, 4, x => x);
        const d = Volume.downsample(v, 2);
        expect(Array.from(d.grid.cells.space.dimensions)).toEqual([2, 2, 2]);
        const { space, data } = d.grid.cells;
        expect(space.get(data, 0, 0, 0)).toBeCloseTo(0.5, 6); // mean(0,1)
        expect(space.get(data, 1, 0, 0)).toBeCloseTo(2.5, 6); // mean(2,3)
    });

    it('preserves the world box (coarse grid maps onto the same cartesian extent)', () => {
        const v = makeMatrixVolume(6, 4, 8, (x, y, z) => x + y + z);
        const d = Volume.downsample(v, 2);
        const tOrig = Grid.getGridToCartesianTransform(v.grid);
        const tCoarse = Grid.getGridToCartesianTransform(d.grid);
        const [nx, ny, nz] = v.grid.cells.space.dimensions as Vec3;
        const [cx, cy, cz] = d.grid.cells.space.dimensions as Vec3;
        const origCorner = Vec3.transformMat4(Vec3(), Vec3.create(nx, ny, nz), tOrig);
        const coarseCorner = Vec3.transformMat4(Vec3(), Vec3.create(cx, cy, cz), tCoarse);
        expect(coarseCorner[0]).toBeCloseTo(origCorner[0], 6);
        expect(coarseCorner[1]).toBeCloseTo(origCorner[1], 6);
        expect(coarseCorner[2]).toBeCloseTo(origCorner[2], 6);
    });

    it('recomputes stats over the downsampled cells', () => {
        const v = makeMatrixVolume(4, 4, 4, x => x); // values 0..3
        const d = Volume.downsample(v, 2);
        // coarse values are {0.5, 2.5}
        expect(d.grid.stats.min).toBeCloseTo(0.5, 6);
        expect(d.grid.stats.max).toBeCloseTo(2.5, 6);
        expect(d.grid.stats.mean).toBeCloseTo(1.5, 6);
        expect(d.grid.stats.sigma).toBeCloseTo(1.0, 6);
    });

    it('handles non-multiple dimensions by ceil and partial averaging', () => {
        const v = makeMatrixVolume(5, 5, 5, () => 1); // constant
        const d = Volume.downsample(v, 2);
        expect(Array.from(d.grid.cells.space.dimensions)).toEqual([3, 3, 3]);
        // constant field stays constant regardless of partial edge blocks
        expect(d.grid.stats.min).toBeCloseTo(1, 6);
        expect(d.grid.stats.max).toBeCloseTo(1, 6);
    });
});
