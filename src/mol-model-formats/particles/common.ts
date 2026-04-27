/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Mat4, Quat, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList, ParticleUnit } from '../../mol-model/particles/particle-list';

export type ParticleTransformInput = {
    coordinate: Vec3
    coordinateUnit: ParticleUnit
    origin: Vec3
    originUnit: ParticleUnit
    originRotation?: Mat4
    rotation: Mat4
};

function getUnitConversionFactor(from: ParticleUnit, to: ParticleUnit, pixelSize?: number) {
    if (from === to) return 1;
    if (!pixelSize || pixelSize <= 0 || !Number.isFinite(pixelSize)) return 1;
    return from === 'pixel' ? pixelSize : 1 / pixelSize;
}

export function getParticleTranslation(out: Vec3, input: ParticleTransformInput, targetUnit: ParticleUnit, pixelSize?: number) {
    const coordinateScale = getUnitConversionFactor(input.coordinateUnit, targetUnit, pixelSize);
    const originScale = getUnitConversionFactor(input.originUnit, targetUnit, pixelSize);

    Vec3.scale(out, input.coordinate, coordinateScale);
    const originShift = Vec3.scale(Vec3(), input.origin, originScale);
    if (input.originRotation) {
        Vec3.transformMat4(originShift, originShift, input.originRotation);
    }
    Vec3.sub(out, out, originShift);
    return out;
}

export function packParticleList(
    label: string,
    unit: ParticleUnit,
    pixelSize: number | undefined,
    particles: ReadonlyArray<ParticleTransformInput>,
    sourceData: unknown,
): ParticleList {
    const coordinates = new Float32Array(particles.length * 3);
    const rotations = new Float32Array(particles.length * 4);

    const position = Vec3();
    const quaternion = Quat();

    for (let i = 0, il = particles.length; i < il; ++i) {
        const particle = particles[i];
        getParticleTranslation(position, particle, unit, pixelSize);
        Quat.normalize(quaternion, Quat.fromMat4(quaternion, particle.rotation));

        const cOffset = i * 3;
        coordinates[cOffset + 0] = position[0];
        coordinates[cOffset + 1] = position[1];
        coordinates[cOffset + 2] = position[2];

        const qOffset = i * 4;
        rotations[qOffset + 0] = quaternion[0];
        rotations[qOffset + 1] = quaternion[1];
        rotations[qOffset + 2] = quaternion[2];
        rotations[qOffset + 3] = quaternion[3];
    }

    return {
        label,
        unit,
        pixelSize,
        coordinates,
        rotations,
        sourceData,
    };
}
