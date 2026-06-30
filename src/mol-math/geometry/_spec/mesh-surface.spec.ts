/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '../../linear-algebra/3d/vec3';
import { MeshSurface } from '../mesh-surface';

describe('MeshSurface', () => {
    // unit quad in the z = 0 plane (two triangles)
    const quad = MeshSurface.create(
        new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
        new Uint32Array([0, 1, 2, 0, 2, 3])
    );
    const point = Vec3(), normal = Vec3();

    it('projects a point above the face onto it', () => {
        const d = quad.project(Vec3.create(0.5, 0.5, 2), point, normal);
        expect(d).toBeCloseTo(2);
        expect(point[0]).toBeCloseTo(0.5); expect(point[1]).toBeCloseTo(0.5); expect(point[2]).toBeCloseTo(0);
        expect(Math.abs(normal[2])).toBeCloseTo(1); // face normal is along z
    });

    it('projects a point below the face onto it', () => {
        const d = quad.project(Vec3.create(0.25, 0.75, -3), point, normal);
        expect(d).toBeCloseTo(3);
        expect(point[2]).toBeCloseTo(0);
    });

    it('clamps a point beyond the edge to the nearest edge point', () => {
        const d = quad.project(Vec3.create(2, 0.5, 0), point, normal);
        expect(d).toBeCloseTo(1);
        expect(point[0]).toBeCloseTo(1); expect(point[1]).toBeCloseTo(0.5);
    });

    it('returns ~0 distance for a point on the surface', () => {
        expect(quad.project(Vec3.create(0.3, 0.4, 0), point, normal)).toBeCloseTo(0);
    });

    it('samples points that lie on the surface', () => {
        let seed = 1;
        const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let i = 0; i < 200; ++i) {
            quad.sample(point, rand);
            expect(point[2]).toBeCloseTo(0); // on the z = 0 quad
            expect(point[0]).toBeGreaterThanOrEqual(-1e-6); expect(point[0]).toBeLessThanOrEqual(1 + 1e-6);
            expect(point[1]).toBeGreaterThanOrEqual(-1e-6); expect(point[1]).toBeLessThanOrEqual(1 + 1e-6);
        }
    });

    it('finds the nearest face of a closed tetrahedron from outside', () => {
        const s = MeshSurface.create(
            new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4]),
            new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
        );
        // far below the z = 0 base -> nearest point on the base, distance ~5
        const d = s.project(Vec3.create(1, 1, -5), point, normal);
        expect(d).toBeCloseTo(5);
        expect(point[2]).toBeCloseTo(0);
    });
});
