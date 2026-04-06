/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Lines } from '../../mol-geo/geometry/lines/lines';
import { LinesBuilder } from '../../mol-geo/geometry/lines/lines-builder';
import { Shape } from '../../mol-model/shape';
import { Mat4, Vec3 } from '../../mol-math/linear-algebra';
import { ParticleList, ParticleListParticle } from '../../mol-io/reader/particle-list';
import { State, StateBuilder, StateObjectCell, StateSelection, StateTransform, StateTree } from '../../mol-state';
import { StateTransforms } from '../transforms';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ColorNames } from '../../mol-util/color/names';
import { PluginStateObject } from '../objects';

export const RelionParticleInstancesTag = 'relion-particle-instances';
export const RelionParticleShapeTag = 'relion-particle-shape';
export const RelionParticleRepresentationTag = 'relion-particle-representation';

const IdentityTransformParams = { transform: { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } } };

const AxisColorByGroup = [ColorNames.red, ColorNames.green, ColorNames.blue] as const;
const AxisLabelByGroup = ['X', 'Y', 'Z'] as const;

const PositionScaleOptions = { min: 0.01, max: 100, step: 0.5 } as const;
const AxisLengthOptions = { min: 0.1, max: 1000, step: 0.1 } as const;

export const BaseRelionParticleAxisParams = {
    ...Lines.Params,
    positionScale: PD.Numeric(1, PositionScaleOptions, { description: 'Applied to coordinates and pixel-space origin shifts.' }),
    axisLength: PD.Numeric(10, AxisLengthOptions, { description: 'Length of the particle orientation axes preview.' }),
    xColor: PD.Color(ColorNames.red),
    yColor: PD.Color(ColorNames.green),
    zColor: PD.Color(ColorNames.blue),
};
export type RelionParticleAxisParams = typeof BaseRelionParticleAxisParams
export type RelionParticleAxisProps = PD.Values<RelionParticleAxisParams>

function getParticleTranslation(out: Vec3, particle: ParticleListParticle, positionScale: number) {
    const coordinateScale = particle.coordinateUnit === 'pixel' ? positionScale : 1;
    const originScale = particle.originUnit === 'pixel' ? positionScale : 1;

    Vec3.scale(out, particle.coordinate, coordinateScale);
    const originShift = Vec3.scale(Vec3(), particle.origin, originScale);
    if (particle.originRotation) {
        Vec3.transformMat4(originShift, originShift, particle.originRotation);
    }
    Vec3.sub(out, out, originShift);
    return out;
}

export function getRelionParticleTransform(out: Mat4, particle: ParticleListParticle, positionScale: number) {
    Mat4.copy(out, particle.rotation);
    Mat4.setTranslation(out, getParticleTranslation(Vec3(), particle, positionScale));
    return out;
}

export function getRelionParticleTransforms(data: ParticleList, positionScale: number) {
    return data.particles.map(particle => getRelionParticleTransform(Mat4(), particle, positionScale));
}

export function getRelionParticleAxisParams(data: ParticleList): RelionParticleAxisParams {
    const suggestedScale = Math.max(PositionScaleOptions.min, data.suggestedScale || 1);
    const axisLength = Math.max(10, suggestedScale * 2);

    return {
        ...BaseRelionParticleAxisParams,
        positionScale: PD.Numeric(suggestedScale, PositionScaleOptions, { description: BaseRelionParticleAxisParams.positionScale.description }),
        axisLength: PD.Numeric(axisLength, AxisLengthOptions, { description: BaseRelionParticleAxisParams.axisLength.description }),
    };
}

function createRelionParticleAxisLines(axisLength: number, lines?: Lines) {
    const builder = LinesBuilder.create(3, 3, lines);
    builder.add(0, 0, 0, axisLength, 0, 0, 0);
    builder.add(0, 0, 0, 0, axisLength, 0, 1);
    builder.add(0, 0, 0, 0, 0, axisLength, 2);
    return builder.getLines();
}

function getAxisColor(props: RelionParticleAxisProps, groupId: number) {
    switch (groupId) {
        case 0: return props.xColor;
        case 1: return props.yColor;
        case 2: return props.zColor;
        default: return AxisColorByGroup[groupId % AxisColorByGroup.length];
    }
}

export function getRelionParticleAxisShape(data: ParticleList, props: RelionParticleAxisProps, shape?: Shape<Lines>) {
    const lines = createRelionParticleAxisLines(props.axisLength, shape?.geometry);
    const transforms = getRelionParticleTransforms(data, props.positionScale);
    const name = `${data.particleBlockHeader || 'RELION'} Particle Axes`;

    return Shape.create(name, data, lines,
        groupId => getAxisColor(props, groupId),
        () => 1,
        (groupId, instanceId) => {
            const particle = data.particles[instanceId];
            const axis = AxisLabelByGroup[groupId] ?? `Axis ${groupId + 1}`;
            return `${axis} axis for particle ${(particle?.index ?? instanceId) + 1}`;
        },
        transforms,
        3
    );
}

function getMatrixTransformList(transforms: ReadonlyArray<Mat4>) {
    return transforms.map(transform => ({ transform: { name: 'matrix' as const, params: { data: transform, transpose: false } } }));
}

export function getStructureInstancesParams(transforms: ReadonlyArray<Mat4>) {
    return {
        transforms: transforms.length ? getMatrixTransformList(transforms) : [IdentityTransformParams]
    };
}

export function getVolumeInstancesParams(transforms: ReadonlyArray<Mat4>) {
    return {
        mode: 'transforms' as const,
        transforms: getMatrixTransformList(transforms)
    };
}

export function findDecoratorRef(
    tree: StateTree,
    rootRef: StateTransform.Ref,
    transformer:
        | typeof StateTransforms.Model.StructureInstances
        | typeof StateTransforms.Model.TransformStructureConformation
        | typeof StateTransforms.Volume.VolumeInstances
        | typeof StateTransforms.Volume.VolumeTransform
) {
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

export function applyVolumeInstances(builder: StateBuilder.Root, tree: StateTree, volumeRef: StateTransform.Ref, transforms: ReadonlyArray<Mat4>) {
    const params = getVolumeInstancesParams(transforms);
    const existing = findDecoratorRef(tree, volumeRef, StateTransforms.Volume.VolumeInstances);
    if (existing) {
        builder.to(existing).update(params);
        return existing;
    }

    const root = StateTree.getDecoratorRoot(tree, volumeRef);
    return builder.to(root).apply(StateTransforms.Volume.VolumeInstances, params, { tags: [RelionParticleInstancesTag] }).ref;
}

export function clearVolumeInstances(builder: StateBuilder.Root, tree: StateTree, volumeRef: StateTransform.Ref) {
    const existing = findDecoratorRef(tree, volumeRef, StateTransforms.Volume.VolumeInstances);
    if (!existing) return false;
    builder.to(existing).update(getVolumeInstancesParams([]));
    return true;
}

export function getRelionParticleShapeCell(state: State, particleListRef: StateTransform.Ref) {
    return state.select(
        StateSelection.Generators.ofTransformer(StateTransforms.Shape.RelionStarParticleListShape, particleListRef)
            .withTag(RelionParticleShapeTag)
            .first()
    )[0] as StateObjectCell<PluginStateObject.Shape.Provider> | undefined;
}

export function getRelionParticleRepresentationCell(state: State, particleListRef: StateTransform.Ref) {
    return state.select(
        StateSelection.Generators.ofTransformer(StateTransforms.Representation.ShapeRepresentation3D, particleListRef)
            .withTag(RelionParticleRepresentationTag)
            .first()
    )[0] as StateObjectCell<PluginStateObject.Shape.Representation3D> | undefined;
}
