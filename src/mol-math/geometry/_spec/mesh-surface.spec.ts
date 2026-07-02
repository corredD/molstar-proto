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

    // Correctness oracle for the grid-accelerated `project`: on a real multi-cell mesh its result must
    // equal an exhaustive nearest-point-over-all-triangles search, for query points everywhere - deep
    // interior (the hot path a confined body settles into), just outside, near the surface, far away,
    // and at the grid's own boundary/corners (where the shell-face enumeration is most likely to slip).
    it('matches a brute-force closest-point search everywhere (interior, exterior, boundary)', () => {
        // off-centre UV sphere (rings x segments), so the grid does not start at the origin
        const cx = 100, cy = 50, cz = -30, R = 20, rings = 16, segs = 24;
        const verts: number[] = [], tris: number[] = [];
        for (let i = 0; i <= rings; ++i) {
            const theta = Math.PI * i / rings, st = Math.sin(theta), ct = Math.cos(theta);
            for (let j = 0; j <= segs; ++j) {
                const phi = 2 * Math.PI * j / segs;
                verts.push(cx + R * st * Math.cos(phi), cy + R * ct, cz + R * st * Math.sin(phi));
            }
        }
        const idx = (i: number, j: number) => i * (segs + 1) + j;
        for (let i = 0; i < rings; ++i) for (let j = 0; j < segs; ++j) {
            tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1));
            tris.push(idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1));
        }
        const positions = new Float32Array(verts), indices = new Uint32Array(tris);
        const s = MeshSurface.create(positions, indices);

        // brute force: nearest point over every triangle (the ground truth `project` must reproduce)
        const va = Vec3(), vb = Vec3(), vc = Vec3(), cp = Vec3(), bestCp = Vec3();
        const brute = (p: Vec3) => {
            let best = Infinity; Vec3.set(bestCp, 0, 0, 0);
            for (let t = 0; t < indices.length / 3; ++t) {
                Vec3.fromArray(va, positions, indices[t * 3] * 3);
                Vec3.fromArray(vb, positions, indices[t * 3 + 1] * 3);
                Vec3.fromArray(vc, positions, indices[t * 3 + 2] * 3);
                Vec3.closestPointOnTriangle(cp, p, va, vb, vc);
                const d2 = Vec3.squaredDistance(p, cp);
                if (d2 < best) { best = d2; Vec3.copy(bestCp, cp); }
            }
            return Math.sqrt(best);
        };

        let seed = 12345;
        const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const q = Vec3();
        // regimes: deep interior, near surface, just outside, far outside, and exact AABB corners
        const corners = [
            Vec3.create(cx - R, cy - R, cz - R), Vec3.create(cx + R, cy + R, cz + R),
            Vec3.create(cx - R, cy + R, cz - R), Vec3.create(cx + R, cy - R, cz + R),
            Vec3.create(cx, cy, cz), // dead centre - deepest interior, largest ring
        ];
        const samples: Vec3[] = [...corners];
        for (let n = 0; n < 300; ++n) {
            const scale = n < 100 ? 0.6 * R : n < 200 ? 1.05 * R : 4 * R; // interior / just-outside / far
            samples.push(Vec3.create(cx + (rand() * 2 - 1) * scale, cy + (rand() * 2 - 1) * scale, cz + (rand() * 2 - 1) * scale));
        }
        for (const p of samples) {
            Vec3.copy(q, p);
            const d = s.project(q, point, normal);
            const db = brute(q);
            expect(d).toBeCloseTo(db, 4); // same distance
            expect(Vec3.distance(point, bestCp)).toBeLessThan(1e-3); // same closest point
        }
    });

    it('exposes a bounding sphere that contains the mesh', () => {
        const s = MeshSurface.create(
            new Float32Array([10, 10, 10, 14, 10, 10, 10, 14, 10, 10, 10, 14]),
            new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
        );
        // every vertex is within `radius` of `center`
        const verts = [Vec3.create(10, 10, 10), Vec3.create(14, 10, 10), Vec3.create(10, 14, 10), Vec3.create(10, 10, 14)];
        for (const v of verts) expect(Vec3.distance(v, s.center)).toBeLessThanOrEqual(s.radius + 1e-6);
    });
});
