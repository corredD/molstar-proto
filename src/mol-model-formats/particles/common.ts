/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Mat4, Quat, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList } from '../../mol-model/particles/particle-list';

export type ParticleTransformInput = {
    /** Particle position in angstrom. */
    coordinate: Vec3
    /** Origin offset in angstrom; applied as `coordinate - originRotation * origin`. */
    origin: Vec3
    originRotation?: Mat4
    rotation?: Mat4
};

export function getParticleTranslation(out: Vec3, input: ParticleTransformInput) {
    Vec3.copy(out, input.coordinate);
    const originShift = Vec3.clone(input.origin);
    if (input.originRotation) {
        Vec3.transformMat4(originShift, originShift, input.originRotation);
    }
    Vec3.sub(out, out, originShift);
    return out;
}

export function packParticleList(
    label: string,
    particles: ReadonlyArray<ParticleTransformInput>,
    sourceData: unknown,
): ParticleList {
    const coordinates = new Float32Array(particles.length * 3);

    let hasAnyRotation = false;
    for (let i = 0, il = particles.length; i < il; ++i) {
        if (particles[i].rotation) { hasAnyRotation = true; break; }
    }
    const rotations = hasAnyRotation ? new Float32Array(particles.length * 4) : undefined;

    const position = Vec3();
    const quaternion = Quat();

    for (let i = 0, il = particles.length; i < il; ++i) {
        const particle = particles[i];
        getParticleTranslation(position, particle);

        const cOffset = i * 3;
        coordinates[cOffset + 0] = position[0];
        coordinates[cOffset + 1] = position[1];
        coordinates[cOffset + 2] = position[2];

        if (rotations) {
            if (particle.rotation) {
                Quat.normalize(quaternion, Quat.fromMat4(quaternion, particle.rotation));
            } else {
                Quat.setIdentity(quaternion);
            }
            const qOffset = i * 4;
            rotations[qOffset + 0] = quaternion[0];
            rotations[qOffset + 1] = quaternion[1];
            rotations[qOffset + 2] = quaternion[2];
            rotations[qOffset + 3] = quaternion[3];
        }
    }

    return {
        label,
        coordinates,
        rotations,
        sourceData,
    };
}
