/**
 * Copyright (c) 2021-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { EPSILON } from '../mol-math/linear-algebra/3d/common';
import { Mat4 } from '../mol-math/linear-algebra/3d/mat4';
import { Quat } from '../mol-math/linear-algebra/3d/quat';
import { Vec3 } from '../mol-math/linear-algebra/3d/vec3';
import { degToRad } from '../mol-math/misc';
import { ParamDefinition as PD } from './param-definition';
import { stringToWords } from './string';

export interface Clip {
    variant: Clip.Variant,
    objects: Clip.Objects
}

export function Clip() {

}

export namespace Clip {
    /** Clip object types */
    export const Type = {
        none: 0, // to switch clipping off
        plane: 1,
        sphere: 2,
        cube: 3,
        cylinder: 4,
        infiniteCone: 5,
    };

    export type Variant = 'instance' | 'pixel'

    export type Objects = {
        count: number
        type: number[]
        invert: boolean[]
        position: number[]
        rotation: number[]
        scale: number[]
        /** Transform point by this before testing */
        transform: number[]
    }

    export const Params = {
        variant: PD.Select('pixel', PD.arrayToOptions<Variant>(['instance', 'pixel'])),
        objects: PD.ObjectList({
            type: PD.Select('plane', PD.objectToOptions(Type, t => stringToWords(t))),
            invert: PD.Boolean(false),
            position: PD.Vec3(Vec3()),
            rotation: PD.Group({
                axis: PD.Vec3(Vec3.create(1, 0, 0)),
                angle: PD.Numeric(0, { min: -180, max: 180, step: 1 }, { description: 'Angle in Degrees' }),
            }, { isExpanded: true }),
            scale: PD.Vec3(Vec3.create(1, 1, 1)),
            transform: PD.Mat4(Mat4.identity()),
        }, o => stringToWords(o.type))
    };
    export type Params = typeof Params
    export type Props = PD.Values<Params>

    function createClipObjects(count: number) {
        return {
            count: 0,
            type: (new Array(count)).fill(1),
            invert: (new Array(count)).fill(false),
            position: (new Array(count * 3)).fill(0),
            rotation: (new Array(count * 4)).fill(0),
            scale: (new Array(count * 3)).fill(1),
            transform: (new Array(count * 16)).fill(0),
        };
    }

    const qA = Quat();
    const qB = Quat();
    const vA = Vec3();
    const vB = Vec3();
    const mA = Mat4();
    const mB = Mat4();

    export function getClip(props: Props, clip?: Clip): Clip {
        const count = props.objects.length;
        const { type, invert, position, rotation, scale, transform } = clip?.objects || createClipObjects(count);
        for (let i = 0; i < count; ++i) {
            const p = props.objects[i];
            type[i] = Type[p.type];
            invert[i] = p.invert;
            Vec3.toArray(p.position, position, i * 3);
            Vec3.normalize(vA, p.rotation.axis);
            Quat.toArray(Quat.setAxisAngle(qA, vA, degToRad(p.rotation.angle)), rotation, i * 4);
            Vec3.toArray(p.scale, scale, i * 3);
            Mat4.toArray(p.transform, transform, i * 16);
        }
        return {
            variant: props.variant,
            objects: { count, type, invert, position, rotation, scale, transform }
        };
    }

    //

    /** How a region relates to the union of all clip objects. */
    export type Classification = 'keep' | 'discard' | 'partial'

    /**
     * Precomputed per-object state for the CPU clip test, a port of `clipTest`/`getSignedDistance`
     * from `mol-gl/shader/chunks/common-clip.glsl.ts`. Kept honest by `mol-util/_spec/clip.spec.ts`,
     * which asserts agreement with a literal transcription of that shader chunk.
     *
     * Points are given in the space the geometry is defined in; the instance transform is folded
     * into `transform` once per instance by `setTestInstanceTransform`, so no per-point matrix
     * bookkeeping is needed. Everything after `createTest` is allocation-free.
     */
    export type Test = {
        readonly count: number
        readonly type: number[]
        readonly invert: boolean[]
        /** the object's own transform, as given by `Objects.transform` */
        readonly objectTransform: Mat4[]
        /** `objectTransform` pre-multiplied with the current instance transform */
        readonly transform: Mat4[]
        /** whether `transform[i]` is anything other than the identity, so points can skip it */
        readonly hasTransform: boolean[]
        readonly position: Vec3[]
        /** conjugate of the object rotation, which is what the sphere/cube/cylinder/cone SDs apply */
        readonly rotationConj: Quat[]
        /** `scale * 0.5`, as the shader passes it */
        readonly size: Vec3[]
        /** plane only: normalized `rotation * unitY` */
        readonly planeNormal: Vec3[]
        /** plane only: `-dot(normal, position)` */
        readonly planeW: number[]
        /** upper bound on the gradient magnitude of the signed distance */
        readonly lipschitz: number[]
    }

    /**
     * Upper bound on the operator norm of the linear part of `m` - the largest factor by which it can
     * stretch a vector. Exact when the columns are orthogonal (rotations, axis-aligned scalings),
     * where the operator norm is the largest column norm; otherwise the Frobenius norm, which is
     * always an upper bound. Stronger than `Mat4.getMaxScaleOnAxis`, which is the same as the first
     * branch and so under-estimates under shear: doing that here would shrink the radius used by
     * `classifyBall` and could report `keep` for a region that is in fact partly clipped.
     */
    function maxScale(m: Mat4) {
        const xx = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
        const yy = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
        const zz = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
        const xy = m[0] * m[4] + m[1] * m[5] + m[2] * m[6];
        const xz = m[0] * m[8] + m[1] * m[9] + m[2] * m[10];
        const yz = m[4] * m[8] + m[5] * m[9] + m[6] * m[10];
        const eps = EPSILON * (xx + yy + zz);
        if (Math.abs(xy) <= eps && Math.abs(xz) <= eps && Math.abs(yz) <= eps) {
            return Math.sqrt(Math.max(xx, yy, zz));
        }
        return Math.sqrt(xx + yy + zz);
    }

    export function createTest(objects: Objects): Test {
        const count = objects.count;
        const test: Test = {
            count,
            type: [], invert: [],
            objectTransform: [], transform: [], hasTransform: [],
            position: [], rotationConj: [], size: [],
            planeNormal: [], planeW: [], lipschitz: [],
        };

        // note: `objects` arrays can be longer than `count` - `getClip` reuses a previous allocation
        for (let i = 0; i < count; ++i) {
            const type = objects.type[i];
            test.type.push(type);
            test.invert.push(objects.invert[i]);

            const position = Vec3.fromArray(Vec3(), objects.position, i * 3);
            test.position.push(position);

            const rotation = Quat.fromArray(Quat(), objects.rotation, i * 4);
            test.rotationConj.push(Quat.conjugate(Quat(), rotation));

            const size = Vec3.fromArray(Vec3(), objects.scale, i * 3);
            Vec3.scale(size, size, 0.5);
            test.size.push(size);

            // `computePlane` takes `w` from the un-normalized normal and normalizes only `xyz`; for a
            // unit quaternion the normal is already unit, so this is the same - but stay literal
            const normal = Vec3.transformQuat(Vec3(), Vec3.unitY, rotation);
            test.planeW.push(-Vec3.dot(normal, position));
            test.planeNormal.push(Vec3.normalize(normal, normal));

            // plane/sphere/cube/cylinder distances are all 1-Lipschitz. `infiniteConeSD` is
            // `dot(size.xy, (length(t.xy), t.z))`, a plane distance in that 2d space scaled by
            // `|size.xy|`, so its gradient is that much larger.
            test.lipschitz.push(type === Type.infiniteCone
                ? Math.sqrt(size[0] * size[0] + size[1] * size[1])
                : type === Type.plane || type === Type.sphere || type === Type.cube || type === Type.cylinder ? 1 : 0);

            test.objectTransform.push(Mat4.fromArray(Mat4(), objects.transform, i * 16));
            // filled in by `setTestInstanceTransform` below, so the derivation lives in one place
            test.transform.push(Mat4());
            test.hasTransform.push(false);
        }
        setTestInstanceTransform(test);
        return test;
    }

    /**
     * Fold `instanceTransform` into every object's transform, so subsequent `testPoint`/
     * `classifyBall`/`getSignedDistance` calls take points in the instance's local space. Call once
     * per instance.
     */
    export function setTestInstanceTransform(test: Test, instanceTransform?: Mat4) {
        for (let i = 0, il = test.count; i < il; ++i) {
            const t = test.transform[i];
            if (instanceTransform) Mat4.mul(t, test.objectTransform[i], instanceTransform);
            else Mat4.copy(t, test.objectTransform[i]);
            test.hasTransform[i] = !Mat4.isIdentity(t);
        }
    }

    const sdA = Vec3();
    const sdB = Vec3();

    /** Signed distance of `point` to clip object `i`; negative inside. */
    export function getSignedDistance(test: Test, i: number, point: Vec3): number {
        // the common case is an identity transform, where the point can be used as-is; `c` is only
        // ever read from here on, so handing back `point` itself is safe
        const c = test.hasTransform[i] ? Vec3.transformMat4(sdA, point, test.transform[i]) : point;
        const type = test.type[i];

        if (type === Type.plane) {
            // `planeSD(plane, c) = -dot(n, c - n * -w)` collapses to `-(dot(n, c) + w)` for unit `n`
            return -(Vec3.dot(test.planeNormal[i], c) + test.planeW[i]);
        }
        if (type !== Type.sphere && type !== Type.cube && type !== Type.cylinder && type !== Type.infiniteCone) {
            // `none` and unknown types never clip - unless inverted, in which case they clip
            // everything. Matches the shader's `else { return 0.1; }`.
            return 0.1;
        }

        const s = test.size[i];
        const t = Vec3.transformQuat(sdB, Vec3.sub(sdB, c, test.position[i]), test.rotationConj[i]);

        switch (type) {
            case Type.sphere: {
                // a zero `size` component yields Infinity/NaN here, exactly as the shader does; `NaN
                // <= 0` is false in both, and `classifyBall` degrades to `partial` on its own
                const x = t[0] / s[0], y = t[1] / s[1], z = t[2] / s[2];
                return (Math.sqrt(x * x + y * y + z * z) - 1) * Math.min(s[0], Math.min(s[1], s[2]));
            }
            case Type.cube: {
                const dx = Math.abs(t[0]) - s[0], dy = Math.abs(t[1]) - s[1], dz = Math.abs(t[2]) - s[2];
                const mx = Math.max(dx, 0), my = Math.max(dy, 0), mz = Math.max(dz, 0);
                return Math.min(Math.max(dx, Math.max(dy, dz)), 0) + Math.sqrt(mx * mx + my * my + mz * mz);
            }
            case Type.cylinder: {
                // axis is Y; `abs(length(t.xz))` is just `length(t.xz)`
                const dx = Math.sqrt(t[0] * t[0] + t[2] * t[2]) - s[0];
                const dy = Math.abs(t[1]) - s[1];
                const mx = Math.max(dx, 0), my = Math.max(dy, 0);
                return Math.min(Math.max(dx, dy), 0) + Math.sqrt(mx * mx + my * my);
            }
            default: {
                // infiniteCone; axis is Z
                return s[0] * Math.sqrt(t[0] * t[0] + t[1] * t[1]) + s[1] * t[2];
            }
        }
    }

    /** `true` means the point is clipped away, mirroring the shader's `clipTest`. */
    export function testPoint(test: Test, point: Vec3): boolean {
        for (let i = 0, il = test.count; i < il; ++i) {
            const inside = getSignedDistance(test, i, point) <= 0;
            if (test.invert[i] ? !inside : inside) return true;
        }
        return false;
    }

    /**
     * Classify a ball against all clip objects, using each signed distance's Lipschitz bound.
     * `keep`/`discard` are only returned when they provably hold for every point of the ball, so a
     * `partial` result is always safe to fall back on - being conservative costs work, never
     * correctness.
     */
    export function classifyBall(test: Test, center: Vec3, radius: number): Classification {
        let partial = false;
        for (let i = 0, il = test.count; i < il; ++i) {
            const sd = getSignedDistance(test, i, center);
            // the signed distance over the ball lies within `sd +/- r`
            const r = radius * maxScale(test.transform[i]) * test.lipschitz[i];
            const allInside = sd + r <= 0;
            const noneInside = sd - r > 0;
            const invert = test.invert[i];
            if (invert ? noneInside : allInside) return 'discard';
            if (!(invert ? allInside : noneInside)) partial = true;
        }
        return partial ? 'partial' : 'keep';
    }

    //

    export function areEqual(cA: Clip, cB: Clip) {
        if (cA.variant !== cB.variant) return false;
        if (cA.objects.count !== cB.objects.count) return false;

        const oA = cA.objects, oB = cB.objects;
        for (let i = 0, il = oA.count; i < il; ++i) {
            if (oA.invert[i] !== oB.invert[i]) return false;
            if (oA.type[i] !== oB.type[i]) return false;

            Vec3.fromArray(vA, oA.position, i * 3);
            Vec3.fromArray(vB, oB.position, i * 3);
            if (!Vec3.equals(vA, vB)) return false;

            Vec3.fromArray(vA, oA.scale, i * 3);
            Vec3.fromArray(vB, oB.scale, i * 3);
            if (!Vec3.equals(vA, vB)) return false;

            Quat.fromArray(qA, oA.rotation, i * 4);
            Quat.fromArray(qB, oB.rotation, i * 4);
            if (!Quat.equals(qA, qB)) return false;

            Mat4.fromArray(mA, oA.transform, i * 16);
            Mat4.fromArray(mB, oB.transform, i * 16);
            if (!Mat4.areEqual(mA, mB, EPSILON)) return false;
        }
        return true;
    }
}