/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '../../mol-math/linear-algebra/3d/mat4';
import { Quat } from '../../mol-math/linear-algebra/3d/quat';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import { Clip } from '../clip';

// A deliberately literal, un-optimized transcription of
// `mol-gl/shader/chunks/common-clip.glsl.ts`, kept as close to the GLSL as JavaScript allows: plain
// arrays, no precomputation, no algebraic simplification, same call structure. `Clip.createTest` +
// `Clip.getSignedDistance` are asserted against it below, which is the closest thing to testing the
// port against the shader that is reachable without a GPU. Diff this against the shader chunk by eye
// when either changes.

type V3 = [number, number, number]
type V4 = [number, number, number, number]

function dot3(a: V3, b: V3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length3(a: V3) { return Math.sqrt(dot3(a, a)); }

function glsl_quaternionTransform(q: V4, v: V3): V3 {
    // vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t);
    const t: V3 = [
        2 * (q[1] * v[2] - q[2] * v[1]),
        2 * (q[2] * v[0] - q[0] * v[2]),
        2 * (q[0] * v[1] - q[1] * v[0]),
    ];
    return [
        v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]),
        v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]),
        v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0]),
    ];
}

function glsl_computePlane(normal: V3, inPoint: V3): V4 {
    // return vec4(normalize(normal), -dot(normal, inPoint));
    const l = length3(normal);
    return [normal[0] / l, normal[1] / l, normal[2] / l, -dot3(normal, inPoint)];
}

function glsl_planeSD(plane: V4, center: V3) {
    // return -dot(plane.xyz, center - plane.xyz * -plane.w);
    const n: V3 = [plane[0], plane[1], plane[2]];
    const d: V3 = [
        center[0] - n[0] * -plane[3],
        center[1] - n[1] * -plane[3],
        center[2] - n[2] * -plane[3],
    ];
    return -dot3(n, d);
}

function conj(rotation: V4): V4 { return [-rotation[0], -rotation[1], -rotation[2], rotation[3]]; }
function sub3(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

function glsl_sphereSD(position: V3, rotation: V4, size: V3, center: V3) {
    const t = glsl_quaternionTransform(conj(rotation), sub3(center, position));
    const d: V3 = [t[0] / size[0], t[1] / size[1], t[2] / size[2]];
    return (length3(d) - 1) * Math.min(Math.min(size[0], size[1]), size[2]);
}

function glsl_cubeSD(position: V3, rotation: V4, size: V3, center: V3) {
    const t = glsl_quaternionTransform(conj(rotation), sub3(center, position));
    const d: V3 = [Math.abs(t[0]) - size[0], Math.abs(t[1]) - size[1], Math.abs(t[2]) - size[2]];
    const m: V3 = [Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)];
    return Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0) + length3(m);
}

function glsl_cylinderSD(position: V3, rotation: V4, size: V3, center: V3) {
    const t = glsl_quaternionTransform(conj(rotation), sub3(center, position));
    // vec2 d = abs(vec2(length(t.xz), t.y)) - size.xy;
    const d0 = Math.abs(Math.sqrt(t[0] * t[0] + t[2] * t[2])) - size[0];
    const d1 = Math.abs(t[1]) - size[1];
    const m0 = Math.max(d0, 0), m1 = Math.max(d1, 0);
    return Math.min(Math.max(d0, d1), 0) + Math.sqrt(m0 * m0 + m1 * m1);
}

function glsl_infiniteConeSD(position: V3, rotation: V4, size: V3, center: V3) {
    const t = glsl_quaternionTransform(conj(rotation), sub3(center, position));
    const q = Math.sqrt(t[0] * t[0] + t[1] * t[1]);
    // return dot(size.xy, vec2(q, t.z));
    return size[0] * q + size[1] * t[2];
}

/** `(m * vec4(v, 1.0)).xyz` with mol-star's column-major Mat4 layout */
function glsl_mul(m: number[], v: V3): V3 {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ];
}

function glsl_getSignedDistance(center: V3, type: number, position: V3, rotation: V4, scale: V3, transform: number[]) {
    const c = glsl_mul(transform, center);
    const half: V3 = [scale[0] * 0.5, scale[1] * 0.5, scale[2] * 0.5];
    if (type === 1) {
        const normal = glsl_quaternionTransform(rotation, [0, 1, 0]);
        const plane = glsl_computePlane(normal, position);
        return glsl_planeSD(plane, c);
    } else if (type === 2) {
        return glsl_sphereSD(position, rotation, half, c);
    } else if (type === 3) {
        return glsl_cubeSD(position, rotation, half, c);
    } else if (type === 4) {
        return glsl_cylinderSD(position, rotation, half, c);
    } else if (type === 5) {
        return glsl_infiniteConeSD(position, rotation, half, c);
    } else {
        return 0.1;
    }
}

// ---- test fixtures ----

type ObjectSpec = { type: number, invert: boolean, position: V3, rotation: V4, scale: V3, transform: number[] }

function makeObjects(specs: ObjectSpec[]): Clip.Objects {
    const o: Clip.Objects = {
        count: specs.length,
        type: [], invert: [], position: [], rotation: [], scale: [], transform: [],
    };
    for (const s of specs) {
        o.type.push(s.type);
        o.invert.push(s.invert);
        o.position.push(...s.position);
        o.rotation.push(...s.rotation);
        o.scale.push(...s.scale);
        o.transform.push(...s.transform);
    }
    // pad the arrays past `count` the way `Clip.getClip` can when it reuses an allocation, so any
    // `array.length / stride` bug shows up here
    o.type.push(99);
    o.invert.push(true);
    o.position.push(0, 0, 0);
    o.rotation.push(0, 0, 0, 1);
    o.scale.push(1, 1, 1);
    o.transform.push(...Mat4.identity());
    return o;
}

function lcg(seed: number) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function randomSpec(rnd: () => number, type: number): ObjectSpec {
    const axis = Vec3.create(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    if (Vec3.magnitude(axis) < 1e-6) Vec3.set(axis, 1, 0, 0);
    Vec3.normalize(axis, axis);
    const q = Quat.setAxisAngle(Quat(), axis, (rnd() - 0.5) * 2 * Math.PI);

    const transform = Mat4.identity();
    const kind = Math.floor(rnd() * 3);
    if (kind === 1) {
        Mat4.fromTranslation(transform, Vec3.create(rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2));
    } else if (kind === 2) {
        Mat4.fromScaling(transform, Vec3.create(0.5 + rnd(), 0.5 + rnd(), 0.5 + rnd()));
        Mat4.setTranslation(transform, Vec3.create(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5));
    }

    return {
        type,
        invert: rnd() > 0.5,
        position: [rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3],
        rotation: [q[0], q[1], q[2], q[3]],
        // keep scales comfortably away from 0 - a zero component is a documented NaN case, covered separately
        scale: [0.3 + rnd() * 3, 0.3 + rnd() * 3, 0.3 + rnd() * 3],
        transform: [...transform],
    };
}

describe('Clip CPU test', () => {
    it('matches a literal transcription of common-clip.glsl.ts', () => {
        const rnd = lcg(20260731);
        let compared = 0;

        for (let iter = 0; iter < 60; ++iter) {
            const specs = [0, 1, 2, 3, 4, 5].map(t => randomSpec(rnd, t));
            const objects = makeObjects(specs);
            const test = Clip.createTest(objects);

            // also exercise the instance-transform folding
            const instance = Mat4.identity();
            if (iter % 2 === 1) {
                Mat4.fromScaling(instance, Vec3.create(0.7 + rnd(), 0.7 + rnd(), 0.7 + rnd()));
                Mat4.setTranslation(instance, Vec3.create(rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3));
            }
            Clip.setTestInstanceTransform(test, instance);

            for (let p = 0; p < 40; ++p) {
                const local = Vec3.create(rnd() * 12 - 6, rnd() * 12 - 6, rnd() * 12 - 6);
                // the shader tests the world-space point; the port folds the instance transform in
                const world = Vec3.transformMat4(Vec3(), local, instance);
                const worldArr: V3 = [world[0], world[1], world[2]];

                for (let i = 0; i < specs.length; ++i) {
                    const s = specs[i];
                    const expected = glsl_getSignedDistance(worldArr, s.type, s.position, s.rotation, s.scale, s.transform);
                    const actual = Clip.getSignedDistance(test, i, local);
                    expect(Math.abs(actual - expected)).toBeLessThan(1e-8 * Math.max(1, Math.abs(expected)));
                    ++compared;
                }

                // and the combined discard decision
                let expectedDiscard = false;
                for (let i = 0; i < specs.length; ++i) {
                    const s = specs[i];
                    const inside = glsl_getSignedDistance(worldArr, s.type, s.position, s.rotation, s.scale, s.transform) <= 0;
                    if ((!s.invert && inside) || (s.invert && !inside)) { expectedDiscard = true; break; }
                }
                expect(Clip.testPoint(test, local)).toBe(expectedDiscard);
            }
        }
        expect(compared).toBeGreaterThan(10000);
    });

    it('classifyBall never reports keep/discard for a ball that is partly clipped', () => {
        const rnd = lcg(4242);
        let keeps = 0, discards = 0, partials = 0;

        for (let iter = 0; iter < 400; ++iter) {
            const count = 1 + Math.floor(rnd() * 3);
            const specs: ObjectSpec[] = [];
            for (let i = 0; i < count; ++i) specs.push(randomSpec(rnd, 1 + Math.floor(rnd() * 5)));

            // every few iterations, give one object a shear so `maxScale`'s Frobenius fallback is used
            if (iter % 7 === 0) {
                const m = Mat4.identity();
                m[4] = 0.4; m[8] = -0.3; m[9] = 0.25;
                specs[0].transform = [...m];
            }

            const test = Clip.createTest(makeObjects(specs));
            const instance = Mat4.identity();
            if (iter % 3 === 0) Mat4.fromTranslation(instance, Vec3.create(rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2));
            Clip.setTestInstanceTransform(test, instance);

            const center = Vec3.create(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4);
            const radius = 0.2 + rnd() * 2.5;
            const c = Clip.classifyBall(test, center, radius);

            let anyDiscarded = false, anyKept = false;
            const p = Vec3();
            for (let k = 0; k < 200; ++k) {
                // rejection-sample a point inside the ball
                let dx = 0, dy = 0, dz = 0;
                do {
                    dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1;
                } while (dx * dx + dy * dy + dz * dz > 1);
                Vec3.set(p, center[0] + dx * radius, center[1] + dy * radius, center[2] + dz * radius);
                if (Clip.testPoint(test, p)) anyDiscarded = true; else anyKept = true;
            }

            if (c === 'keep') {
                expect(anyDiscarded).toBe(false);
                ++keeps;
            } else if (c === 'discard') {
                expect(anyKept).toBe(false);
                ++discards;
            } else {
                ++partials;
            }
        }

        // the test is only meaningful if it actually exercised the decisive branches
        expect(keeps).toBeGreaterThan(10);
        expect(discards).toBeGreaterThan(10);
        expect(partials).toBeGreaterThan(10);
    });

    it('signed distances respect their Lipschitz bound', () => {
        const rnd = lcg(99);
        for (let type = 1; type <= 5; ++type) {
            for (let iter = 0; iter < 40; ++iter) {
                const spec = randomSpec(rnd, type);
                spec.transform = [...Mat4.identity()]; // isolate the SD from the transform scale
                const test = Clip.createTest(makeObjects([spec]));
                const a = Vec3.create(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4);
                const b = Vec3.create(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4);
                const sa = Clip.getSignedDistance(test, 0, a);
                const sb = Clip.getSignedDistance(test, 0, b);
                const L = type === 5 ? Math.sqrt((spec.scale[0] * 0.5) ** 2 + (spec.scale[1] * 0.5) ** 2) : 1;
                expect(Math.abs(sa - sb)).toBeLessThanOrEqual(L * Vec3.distance(a, b) + 1e-9);
            }
        }
    });

    it('clips the +normal half-space for a default plane', () => {
        // pinned deliberately: a sign flip here is invisible until someone looks at a render
        const test = Clip.createTest(makeObjects([{
            type: Clip.Type.plane, invert: false,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], transform: [...Mat4.identity()],
        }]));
        expect(Clip.getSignedDistance(test, 0, Vec3.create(0, 1, 0))).toBeCloseTo(-1, 10);
        expect(Clip.getSignedDistance(test, 0, Vec3.create(0, -1, 0))).toBeCloseTo(1, 10);
        expect(Clip.testPoint(test, Vec3.create(0, 1, 0))).toBe(true);
        expect(Clip.testPoint(test, Vec3.create(0, -1, 0))).toBe(false);
    });

    it('uses a Y axis for cylinders and a Z axis for cones', () => {
        const cyl = Clip.createTest(makeObjects([{
            type: Clip.Type.cylinder, invert: false,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2], transform: [...Mat4.identity()],
        }]));
        // size = (1,1,1): radius 1 about the Y axis, half-height 1
        expect(Clip.testPoint(cyl, Vec3.create(0, 0.9, 0))).toBe(true);
        expect(Clip.testPoint(cyl, Vec3.create(0.9, 0, 0))).toBe(true);
        expect(Clip.testPoint(cyl, Vec3.create(0, 1.1, 0))).toBe(false); // past the cap
        expect(Clip.testPoint(cyl, Vec3.create(1.1, 0, 0))).toBe(false); // past the radius

        const cone = Clip.createTest(makeObjects([{
            type: Clip.Type.infiniteCone, invert: false,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2], transform: [...Mat4.identity()],
        }]));
        // sd = size.x * length(t.xy) + size.y * t.z, so it opens along -Z
        expect(Clip.testPoint(cone, Vec3.create(0, 0, -1))).toBe(true);
        expect(Clip.testPoint(cone, Vec3.create(0, 0, 1))).toBe(false);
    });

    it('treats type none as non-clipping, and inverted none as clipping everything', () => {
        const keep = Clip.createTest(makeObjects([{
            type: Clip.Type.none, invert: false,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], transform: [...Mat4.identity()],
        }]));
        expect(Clip.getSignedDistance(keep, 0, Vec3.create(0, 0, 0))).toBe(0.1);
        expect(Clip.testPoint(keep, Vec3.create(0, 0, 0))).toBe(false);
        expect(Clip.classifyBall(keep, Vec3.create(0, 0, 0), 100)).toBe('keep');

        const drop = Clip.createTest(makeObjects([{
            type: Clip.Type.none, invert: true,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], transform: [...Mat4.identity()],
        }]));
        expect(Clip.testPoint(drop, Vec3.create(0, 0, 0))).toBe(true);
        expect(Clip.classifyBall(drop, Vec3.create(0, 0, 0), 100)).toBe('discard');
    });

    it('degrades to partial for a degenerate scale rather than guessing', () => {
        const test = Clip.createTest(makeObjects([{
            type: Clip.Type.sphere, invert: false,
            position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [0, 1, 1], transform: [...Mat4.identity()],
        }]));
        // NaN <= 0 is false in both GLSL and JS, so nothing is clipped ...
        expect(Clip.testPoint(test, Vec3.create(0, 0, 0))).toBe(false);
        // ... and the classifier must not claim to know
        expect(Clip.classifyBall(test, Vec3.create(0, 0, 0), 1)).toBe('partial');
    });
});
