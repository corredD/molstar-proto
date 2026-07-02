/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { Vec3 } from '../../../mol-math/linear-algebra';
import { MeshSurface } from '../../../mol-math/geometry/mesh-surface';
import { CustomProperties } from '../../custom-property';
import { ParticleList, Particle } from '../particle-list';
import { createParticleDynamics, ParticleDynamicsParams } from '../dynamics';

function makeParticles(n: number): ParticleList {
    const coordinates = new Float32Array(n * 3);
    const rotations = new Float32Array(n * 4);
    for (let i = 0; i < n; ++i) {
        coordinates[i * 3] = (i % 7) - 3;
        coordinates[i * 3 + 1] = (i % 5) - 2;
        coordinates[i * 3 + 2] = (i % 3) - 1;
        rotations[i * 4 + 3] = 1; // identity quaternion
    }
    // the dynamics only reads count/coordinates/rotations; the rest is irrelevant for this unit test
    return { count: n, coordinates, rotations } as unknown as ParticleList;
}

const baseProps = { ...PD.getDefaultValues(ParticleDynamicsParams), seed: 42, bounds: 50, timestep: 0.02 };

describe('particle dynamics', () => {
    it('is deterministic for a given seed', () => {
        const a = makeParticles(64), b = makeParticles(64);
        createParticleDynamics(a, baseProps).getFrameAtIndex(50);
        createParticleDynamics(b, baseProps).getFrameAtIndex(50);
        for (let i = 0; i < a.coordinates.length; ++i) expect(b.coordinates[i]).toBeCloseTo(a.coordinates[i], 5);
        for (let i = 0; i < a.rotations!.length; ++i) expect(b.rotations![i]).toBeCloseTo(a.rotations![i], 5);
    });

    it('keeps particles inside the box and quaternions unit-length', () => {
        const p = makeParticles(200);
        createParticleDynamics(p, baseProps).getFrameAtIndex(300);
        const eps = 1e-3;
        for (let i = 0; i < p.coordinates.length; ++i) expect(Math.abs(p.coordinates[i])).toBeLessThanOrEqual(baseProps.bounds + eps);
        for (let i = 0; i < p.count; ++i) {
            const r = i * 4;
            const len = Math.hypot(p.rotations![r], p.rotations![r + 1], p.rotations![r + 2], p.rotations![r + 3]);
            expect(len).toBeCloseTo(1, 5);
        }
    });

    it('reset restores the initial positions and orientations', () => {
        const p = makeParticles(32);
        const coords0 = Float32Array.from(p.coordinates);
        const rot0 = Float32Array.from(p.rotations!);
        const dyn = createParticleDynamics(p, baseProps);
        dyn.getFrameAtIndex(25);
        // moved away from the start
        let moved = 0;
        for (let i = 0; i < p.coordinates.length; ++i) moved += Math.abs(p.coordinates[i] - coords0[i]);
        expect(moved).toBeGreaterThan(0);
        dyn.reset();
        for (let i = 0; i < coords0.length; ++i) expect(p.coordinates[i]).toBeCloseTo(coords0[i], 6);
        for (let i = 0; i < rot0.length; ++i) expect(p.rotations![i]).toBeCloseTo(rot0[i], 6);
    });

    it('pushes overlapping particles apart when collisions are enabled', () => {
        // two particles closer than 2 * particleRadius (= 10) overlap and must be separated
        const makeTwo = () => ({
            count: 2,
            coordinates: new Float32Array([-3, 0, 0, 3, 0, 0]),
            rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
        } as unknown as ParticleList);
        const dist = (p: ParticleList) => Math.hypot(
            p.coordinates[3] - p.coordinates[0], p.coordinates[4] - p.coordinates[1], p.coordinates[5] - p.coordinates[2]);

        const common = { ...baseProps, gravity: Vec3.create(0, 0, 0), particleRadius: 5, bounds: 1000 };
        const on = makeTwo(), off = makeTwo();
        createParticleDynamics(on, { ...common, collisions: true }).getFrameAtIndex(1);
        createParticleDynamics(off, { ...common, collisions: false }).getFrameAtIndex(1);

        // same seed => identical random velocities; the only difference is the collision response
        expect(dist(on)).toBeGreaterThan(dist(off));
        expect(dist(on)).toBeGreaterThanOrEqual(9.5); // separated to ~2 * particleRadius
    });

    it('rigid bodies stay in the box, keep unit quaternions, and tumble under collisions', () => {
        const p = makeParticles(60);
        const rot0 = Float32Array.from(p.rotations!);
        const props = { ...baseProps, rigidBody: true, rigidShape: 'cube' as const, particleRadius: 3, bounds: 40 };
        createParticleDynamics(p, props).getFrameAtIndex(120);

        const eps = 1e-3;
        for (let i = 0; i < p.coordinates.length; ++i) expect(Math.abs(p.coordinates[i])).toBeLessThanOrEqual(props.bounds + eps);
        for (let i = 0; i < p.count; ++i) {
            const r = i * 4;
            const len = Math.hypot(p.rotations![r], p.rotations![r + 1], p.rotations![r + 2], p.rotations![r + 3]);
            expect(len).toBeCloseTo(1, 4);
        }
        // collisions impart torque, so orientations must have moved away from the identity start
        let rotChange = 0;
        for (let i = 0; i < p.rotations!.length; ++i) rotChange += Math.abs(p.rotations![i] - rot0[i]);
        expect(rotChange).toBeGreaterThan(0);
    });

    it('is deterministic with rigid bodies enabled', () => {
        const props = { ...baseProps, rigidBody: true, rigidShape: 'tube' as const, particleRadius: 3, bounds: 40 };
        const a = makeParticles(40), b = makeParticles(40);
        createParticleDynamics(a, props).getFrameAtIndex(60);
        createParticleDynamics(b, props).getFrameAtIndex(60);
        for (let i = 0; i < a.coordinates.length; ++i) expect(b.coordinates[i]).toBeCloseTo(a.coordinates[i], 5);
        for (let i = 0; i < a.rotations!.length; ++i) expect(b.rotations![i]).toBeCloseTo(a.rotations![i], 5);
    });

    it('getFrameAtIndex is stable when stepping forward incrementally vs jumping', () => {
        const a = makeParticles(48), b = makeParticles(48);
        const da = createParticleDynamics(a, baseProps);
        for (let i = 1; i <= 40; ++i) da.getFrameAtIndex(i); // incremental
        createParticleDynamics(b, baseProps).getFrameAtIndex(40); // single jump
        for (let i = 0; i < a.coordinates.length; ++i) expect(a.coordinates[i]).toBeCloseTo(b.coordinates[i], 5);
    });

    it('separates overlapping particles the same way at contactCompliance=0 regardless of substep count', () => {
        const makeTwo = () => ({
            count: 2,
            coordinates: new Float32Array([-3, 0, 0, 3, 0, 0]),
            rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
        } as unknown as ParticleList);
        const dist = (p: ParticleList) => Math.hypot(
            p.coordinates[3] - p.coordinates[0], p.coordinates[4] - p.coordinates[1], p.coordinates[5] - p.coordinates[2]);
        const common = { ...baseProps, gravity: Vec3.create(0, 0, 0), particleRadius: 5, bounds: 1000, collisions: true, contactCompliance: 0 };
        const a = makeTwo(), b = makeTwo();
        createParticleDynamics(a, { ...common, numSubsteps: 1 }).getFrameAtIndex(1);
        createParticleDynamics(b, { ...common, numSubsteps: 8 }).getFrameAtIndex(1);
        // compliance=0 is a hard constraint regardless of numSubsteps - both must fully separate
        expect(dist(a)).toBeGreaterThanOrEqual(9.5);
        expect(dist(b)).toBeGreaterThanOrEqual(9.5);
    });

    it('settles to the same rest configuration regardless of substep count (XPBD compliance invariance)', () => {
        // a single particle resting against a compliant floor wall under constant gravity: the
        // equilibrium penetration depth is the property XPBD's compliance is supposed to make
        // independent of the substep count - a plain (non-extended) PBD pass would NOT have this
        // property, since its correction strength scales with the timestep.
        const makeOne = () => ({
            count: 1,
            coordinates: new Float32Array([0, -38, 0]),
            rotations: new Float32Array([0, 0, 0, 1]),
        } as unknown as ParticleList);
        const settle = (numSubsteps: number) => {
            const p = makeOne();
            const props = {
                ...baseProps, gravity: Vec3.create(0, -300, 0), damping: 0, restitution: 0,
                collisions: false, bounds: 40, contactCompliance: 3e-3, numSubsteps, iterationsPerSubstep: 1,
            };
            createParticleDynamics(p, props).getFrameAtIndex(600);
            return p.coordinates[1];
        };
        expect(settle(1)).toBeCloseTo(settle(8), 1);
    });

    it('raising contactCompliance increases the resting penetration past a wall (sign check on alpha_tilde)', () => {
        const makeOne = () => ({
            count: 1,
            coordinates: new Float32Array([0, -38, 0]),
            rotations: new Float32Array([0, 0, 0, 1]),
        } as unknown as ParticleList);
        const penetration = (contactCompliance: number) => {
            const p = makeOne();
            const props = {
                ...baseProps, gravity: Vec3.create(0, -300, 0), damping: 0, restitution: 0,
                collisions: false, bounds: 40, contactCompliance, numSubsteps: 4, iterationsPerSubstep: 1,
            };
            createParticleDynamics(p, props).getFrameAtIndex(150);
            return -40 - p.coordinates[1]; // how far past the -40 wall it rests (>= 0)
        };
        expect(penetration(5e-3)).toBeGreaterThan(penetration(0));
    });
});

/** Low-res UV sphere of radius `r` as packed positions + triangle indices. */
function uvSphere(r: number, lat = 12, lon = 16) {
    const verts: number[] = [], idx: number[] = [];
    for (let i = 0; i <= lat; ++i) {
        const theta = i / lat * Math.PI, st = Math.sin(theta), ct = Math.cos(theta);
        for (let j = 0; j <= lon; ++j) {
            const phi = j / lon * 2 * Math.PI;
            verts.push(r * st * Math.cos(phi), r * ct, r * st * Math.sin(phi));
        }
    }
    const row = lon + 1;
    for (let i = 0; i < lat; ++i) for (let j = 0; j < lon; ++j) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
    }
    return { positions: Float32Array.from(verts), indices: Uint32Array.from(idx) };
}

function makeBoundParticles(n: number, spread: number): ParticleList {
    const coordinates = new Float32Array(n * 3);
    const rotations = new Float32Array(n * 4);
    const compartments = new Int32Array(n); // all compartment 0
    const rand = (s: number) => ((Math.sin(s * 12.9898) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < n; ++i) {
        coordinates[i * 3] = (rand(i) - 0.5) * spread;
        coordinates[i * 3 + 1] = (rand(i + 100) - 0.5) * spread;
        coordinates[i * 3 + 2] = (rand(i + 200) - 0.5) * spread;
        rotations[i * 4 + 3] = 1;
    }
    return {
        count: n, coordinates, rotations, compartments,
        customProperties: new CustomProperties(), _propertyData: {},
    } as unknown as ParticleList;
}

describe('particle dynamics - surface constraints', () => {
    it('projects bound particles onto the surface and keeps them there', () => {
        const R = 50;
        const sphere = uvSphere(R);
        const surface = MeshSurface.create(sphere.positions, sphere.indices);
        const p = makeBoundParticles(80, 120); // scattered well off the sphere
        Particle.setSurfaceBindings(p, new Map([[0, { surface, mode: 'on' as const }]]));

        const props = { ...PD.getDefaultValues(ParticleDynamicsParams), gravity: Vec3.create(0, 0, 0), particleRadius: 3, bounds: 200 };
        createParticleDynamics(p, props).getFrameAtIndex(80);

        for (let i = 0; i < p.count; ++i) {
            // every bound particle sits on the (faceted) sphere surface
            const d = Math.hypot(p.coordinates[i * 3], p.coordinates[i * 3 + 1], p.coordinates[i * 3 + 2]);
            expect(d).toBeGreaterThan(R * 0.9);
            expect(d).toBeLessThan(R * 1.02);
            // orientations stay unit quaternions
            const r = i * 4;
            expect(Math.hypot(p.rotations![r], p.rotations![r + 1], p.rotations![r + 2], p.rotations![r + 3])).toBeCloseTo(1, 4);
        }
    });

    it('a mesh confines particles to one side and inside/outside pick opposite sides', () => {
        const R = 50;
        const sphere = uvSphere(R);
        const surface = MeshSurface.create(sphere.positions, sphere.indices);
        const props = { ...PD.getDefaultValues(ParticleDynamicsParams), gravity: Vec3.create(0, 0, 0), particleRadius: 3, bounds: 200 };
        // run a mode and count how many particles end up inside vs outside the sphere
        const sideOf = (mode: 'inside' | 'outside') => {
            const p = makeBoundParticles(60, 120); // start scattered on both sides
            Particle.setSurfaceBindings(p, new Map([[0, { surface, mode }]]));
            createParticleDynamics(p, props).getFrameAtIndex(120);
            let inside = 0;
            for (let i = 0; i < p.count; ++i) {
                if (Math.hypot(p.coordinates[i * 3], p.coordinates[i * 3 + 1], p.coordinates[i * 3 + 2]) < R) inside++;
            }
            return inside;
        };
        const insideMode = sideOf('inside'), outsideMode = sideOf('outside');
        // each mode confines ALL particles to a single side (none cross the mesh)
        expect(insideMode === 60 || insideMode === 0).toBe(true);
        expect(outsideMode === 60 || outsideMode === 0).toBe(true);
        // the two modes confine to OPPOSITE sides
        expect(insideMode).not.toBe(outsideMode);
    });

    it('the clearance cache keeps confinement identical to projecting every step (no wrong skips)', () => {
        // Regression guard for the surface-projection clearance cache (the perf fix that skips the
        // O(triangleCount) projection for a particle far from every triangle - e.g. settled deep inside a
        // hollow mesh). The cache must be transparent: skipping only ever drops a zero-magnitude
        // correction. A particle held motionless just inside the surface (its clearance is captured once,
        // then every subsequent step is skipped) must end in the exact same place as one whose constraint
        // is genuinely satisfied every step - i.e. it must not drift.
        const R = 50;
        const sphere = uvSphere(R);
        const surface = MeshSurface.create(sphere.positions, sphere.indices);
        // one rigid body at the centre (deepest interior -> largest clearance -> every step after the
        // first is skipped). A rigid body starts at rest, so with no gravity and no collisions there is
        // no force on it: it must sit perfectly still. A wrong skip that applied a phantom correction, or
        // a genuine `inside` violation the cache failed to catch, would move it off the origin.
        const p = { count: 1, coordinates: new Float32Array([0, 0, 0]), rotations: new Float32Array([0, 0, 0, 1]), compartments: new Int32Array([0]), customProperties: new CustomProperties(), _propertyData: {} } as unknown as ParticleList;
        Particle.setSurfaceBindings(p, new Map([[0, { surface, mode: 'inside' as const }]]));
        const props = { ...PD.getDefaultValues(ParticleDynamicsParams), gravity: Vec3.create(0, 0, 0), collisions: false, particleRadius: 3, bounds: 200, rigidBody: true, rigidShape: 'cube' as const, numSubsteps: 4 };
        const dyn = createParticleDynamics(p, props);
        dyn.getFrameAtIndex(300);
        expect(Vec3.magnitude(Vec3.create(p.coordinates[0], p.coordinates[1], p.coordinates[2]))).toBeCloseTo(0, 3);
    });
});
