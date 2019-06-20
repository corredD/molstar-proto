/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Vec3 } from '../../mol-math/linear-algebra';

export interface Primitive {
    vertices: ArrayLike<number>
    normals: ArrayLike<number>
    indices: ArrayLike<number>
}

const a = Vec3.zero(), b = Vec3.zero(), c = Vec3.zero()

/** Create primitive with face normals from vertices and indices */
export function createPrimitive(vertices: ArrayLike<number>, indices: ArrayLike<number>): Primitive {
    const count = indices.length
    const builder = PrimitiveBuilder(count / 3)

    for (let i = 0; i < count; i += 3) {
        Vec3.fromArray(a, vertices, indices[i] * 3)
        Vec3.fromArray(b, vertices, indices[i + 1] * 3)
        Vec3.fromArray(c, vertices, indices[i + 2] * 3)
        builder.add(a, b, c)
    }
    return builder.getPrimitive()
}

export interface PrimitiveBuilder {
    add(a: Vec3, b: Vec3, c: Vec3): void
    getPrimitive(): Primitive
}

const vn = Vec3.zero()

/** Builder to create primitive with face normals */
export function PrimitiveBuilder(triangleCount: number): PrimitiveBuilder {
    const vertices = new Float32Array(triangleCount * 3 * 3)
    const normals = new Float32Array(triangleCount * 3 * 3)
    const indices = new Uint32Array(triangleCount * 3)
    let offset = 0

    return {
        add: (a: Vec3, b: Vec3, c: Vec3) => {
            Vec3.toArray(a, vertices, offset)
            Vec3.toArray(b, vertices, offset + 3)
            Vec3.toArray(c, vertices, offset + 6)
            Vec3.triangleNormal(vn, a, b, c)
            for (let j = 0; j < 3; ++j) {
                Vec3.toArray(vn, normals, offset + 3 * j)
                indices[offset / 3 + j] = offset / 3 + j
            }
            offset += 9
        },
        getPrimitive: () => ({ vertices, normals, indices })
    }
}