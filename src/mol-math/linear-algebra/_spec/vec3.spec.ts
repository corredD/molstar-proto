/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Sebastian Bittrich <sebastian.bittrich@rcsb.org>
 */

import { Vec3 } from '../3d/vec3';

describe('vec3', () => {
    const vec1 = Vec3.create(1, 2, 3);
    const vec2 = Vec3.create(2, 3, 1);
    const orthVec1 = Vec3.create(0, 1, 0);
    const orthVec2 = Vec3.create(1, 0, 0);

    it('angle calculation', () => {
        expect(Vec3.angle(vec1, vec1) * 360 / (2 * Math.PI)).toBe(0.0);
        expect(Vec3.angle(orthVec1, orthVec2) * 360 / (2 * Math.PI)).toBe(90.0);
        expect(Vec3.angle(vec1, vec2)).toBeCloseTo(0.666946);
    });

    describe('closestPointOnTriangle', () => {
        const a = Vec3.create(0, 0, 0), b = Vec3.create(1, 0, 0), c = Vec3.create(0, 1, 0);
        const closest = (p: Vec3) => Vec3.closestPointOnTriangle(Vec3(), p, a, b, c);
        const expectVec = (out: Vec3, x: number, y: number, z: number) => {
            expect(out[0]).toBeCloseTo(x); expect(out[1]).toBeCloseTo(y); expect(out[2]).toBeCloseTo(z);
        };

        it('projects an interior point onto the face', () => expectVec(closest(Vec3.create(0.25, 0.25, 1)), 0.25, 0.25, 0));
        it('clamps to vertex region A', () => expectVec(closest(Vec3.create(-1, -1, 0)), 0, 0, 0));
        it('clamps to vertex region B', () => expectVec(closest(Vec3.create(2, -1, 0)), 1, 0, 0));
        it('clamps to vertex region C', () => expectVec(closest(Vec3.create(-1, 2, 0)), 0, 1, 0));
        it('clamps to edge AB', () => expectVec(closest(Vec3.create(0.5, -1, 0)), 0.5, 0, 0));
        it('clamps to edge BC', () => expectVec(closest(Vec3.create(1, 1, 0)), 0.5, 0.5, 0));
    });
});