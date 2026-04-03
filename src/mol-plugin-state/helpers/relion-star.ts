/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { RelionStarParticle, RelionStarParticleList } from '../../mol-io/reader/relion/star';
import { StateBuilder, StateTransform, StateTree } from '../../mol-state';
import { StateTransforms } from '../transforms';

const ZAxis = Vec3.create(0, 0, 1);
const YAxis = Vec3.create(0, 1, 0);

export const RelionParticleInstancesTag = 'relion-particle-instances';

const IdentityTransformParams = { transform: { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } } };

function degToRad(value: number) {
    return value * Math.PI / 180;
}

function relionEulerToRotation(out: Mat4, rot: number, tilt: number, psi: number) {
    const rotZ = Mat4.fromRotation(Mat4(), degToRad(rot), ZAxis);
    const tiltY = Mat4.fromRotation(Mat4(), degToRad(tilt), YAxis);
    const psiZ = Mat4.fromRotation(Mat4(), degToRad(psi), ZAxis);

    Mat4.mul(out, tiltY, rotZ);
    Mat4.mul(out, psiZ, out);
    return out;
}

function getParticleTranslation(out: Vec3, particle: RelionStarParticle, positionScale: number) {
    const coordinateScale = particle.coordinateUnit === 'pixel' ? positionScale : 1;
    const originScale = particle.originUnit === 'pixel' ? positionScale : 1;

    Vec3.scale(out, particle.coordinate, coordinateScale);
    Vec3.sub(out, out, Vec3.scale(Vec3(), particle.origin, originScale));
    return out;
}

export function getRelionParticleTransform(out: Mat4, particle: RelionStarParticle, positionScale: number) {
    relionEulerToRotation(out, particle.particleAngles.rot, particle.particleAngles.tilt, particle.particleAngles.psi);
    if (particle.subtomogramAngles) {
        const subtomogram = relionEulerToRotation(Mat4(), particle.subtomogramAngles.rot, particle.subtomogramAngles.tilt, particle.subtomogramAngles.psi);
        Mat4.mul(out, subtomogram, out);
    }
    Mat4.setTranslation(out, getParticleTranslation(Vec3(), particle, positionScale));
    return out;
}

export function getRelionParticleTransforms(data: RelionStarParticleList, positionScale: number) {
    return data.particles.map(particle => getRelionParticleTransform(Mat4(), particle, positionScale));
}

export function getStructureInstancesParams(transforms: ReadonlyArray<Mat4>) {
    return {
        transforms: transforms.length
            ? transforms.map(transform => ({ transform: { name: 'matrix' as const, params: { data: transform, transpose: false } } }))
            : [IdentityTransformParams]
    };
}

export function findDecoratorRef(tree: StateTree, rootRef: StateTransform.Ref, transformer: typeof StateTransforms.Model.StructureInstances | typeof StateTransforms.Model.TransformStructureConformation) {
    let currentRef: StateTransform.Ref | undefined = rootRef;
    while (currentRef) {
        const transform = tree.transforms.get(currentRef);
        if (!transform) return;
        if (transform.transformer === transformer) return currentRef;

        const children = tree.children.get(currentRef);
        if (children.size !== 1) return;

        const nextRef = children.first()!;
        const next = tree.transforms.get(nextRef);
        if (!next?.transformer.definition.isDecorator) return;
        currentRef = nextRef;
    }
}

export function applyStructureInstances(builder: StateBuilder.Root, tree: StateTree, structureRef: StateTransform.Ref, transforms: ReadonlyArray<Mat4>) {
    const params = getStructureInstancesParams(transforms);
    const existing = findDecoratorRef(tree, structureRef, StateTransforms.Model.StructureInstances);
    if (existing) {
        builder.to(existing).update(params);
        return existing;
    }

    const root = StateTree.getDecoratorRoot(tree, structureRef);
    return builder.to(root).apply(StateTransforms.Model.StructureInstances, params, { tags: [RelionParticleInstancesTag] }).ref;
}

export function clearStructureInstances(builder: StateBuilder.Root, tree: StateTree, structureRef: StateTransform.Ref) {
    const existing = findDecoratorRef(tree, structureRef, StateTransforms.Model.StructureInstances);
    if (!existing) return false;
    builder.to(existing).update(getStructureInstancesParams([]));
    return true;
}
