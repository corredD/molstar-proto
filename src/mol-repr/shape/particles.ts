/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { RuntimeContext } from '../../mol-task';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ColorNames } from '../../mol-util/color/names';
import { Representation, RepresentationContext, RepresentationParamsGetter } from '../representation';
import { ShapeRepresentation } from './representation';
import { Shape } from '../../mol-model/shape';
import { Lines } from '../../mol-geo/geometry/lines/lines';
import { LinesBuilder } from '../../mol-geo/geometry/lines/lines-builder';
import { Spheres } from '../../mol-geo/geometry/spheres/spheres';
import { SpheresBuilder } from '../../mol-geo/geometry/spheres/spheres-builder';
import { MarkerActions } from '../../mol-util/marker-action';
import { getParticleTransforms, ParticlesData } from '../../mol-model-formats/shape/particles';
import { ThemeRegistryContext } from '../../mol-theme/theme';

const AxisColorByGroup = [ColorNames.red, ColorNames.green, ColorNames.blue] as const;
const AxisLabelByGroup = ['X', 'Y', 'Z'] as const;

const PositionScaleOptions = { min: 0.01, max: 100, step: 0.5 } as const;
const AxisLengthOptions = { min: 0.1, max: 1000, step: 0.1 } as const;
const PointSizeOptions = { min: 0.1, max: 100, step: 0.1 } as const;

export const BaseParticlesParams = {
    ...Spheres.Params,
    ...Lines.Params,
    positionScale: PD.Numeric(1, PositionScaleOptions, { description: 'Applied to pixel-space coordinates and origin shifts.' }),
    pointSize: PD.Numeric(1, PointSizeOptions, { description: 'Radius used for the particle position marker.' }),
    axisLength: PD.Numeric(10, AxisLengthOptions, { description: 'Length of the particle orientation axes.' }),
    positionColor: PD.Color(ColorNames.white),
    xColor: PD.Color(ColorNames.red),
    yColor: PD.Color(ColorNames.green),
    zColor: PD.Color(ColorNames.blue),
};
type ParticlesBaseParams = typeof BaseParticlesParams
type ParticlesBaseProps = PD.Values<ParticlesBaseParams>

function getAxisColor(props: ParticlesBaseProps, groupId: number) {
    switch (groupId) {
        case 0: return props.xColor;
        case 1: return props.yColor;
        case 2: return props.zColor;
        default: return AxisColorByGroup[groupId % AxisColorByGroup.length];
    }
}

function getParticleLabel(data: ParticlesData, instanceId: number) {
    const particle = data.particles[instanceId];
    return `particle ${(particle?.index ?? instanceId) + 1}`;
}

function createParticlesOrientationLines(axisLength: number, lines?: Lines) {
    const builder = LinesBuilder.create(3, 3, lines);
    builder.add(0, 0, 0, axisLength, 0, 0, 0);
    builder.add(0, 0, 0, 0, axisLength, 0, 1);
    builder.add(0, 0, 0, 0, 0, axisLength, 2);
    return builder.getLines();
}

function createParticlesPositionGeometry(spheres?: Spheres) {
    const builder = SpheresBuilder.create(1, 1, spheres);
    builder.add(0, 0, 0, 0);
    return builder.getSpheres();
}

export function getParticlesOrientationShape(ctx: RuntimeContext, data: ParticlesData, props: ParticlesBaseProps, shape?: Shape<Lines>) {
    const lines = createParticlesOrientationLines(props.axisLength, shape?.geometry);
    const transforms = getParticleTransforms(data, props.positionScale);
    const name = `${data.label} Orientation`;

    return Shape.create(
        name,
        data,
        lines,
        groupId => getAxisColor(props, groupId),
        () => 1,
        (groupId, instanceId) => {
            const axis = AxisLabelByGroup[groupId] ?? `Axis ${groupId + 1}`;
            return `${axis} axis for ${getParticleLabel(data, instanceId)}`;
        },
        transforms,
        3
    );
}

export function getParticlesPositionShape(ctx: RuntimeContext, data: ParticlesData, props: ParticlesBaseProps, shape?: Shape<Spheres>) {
    const spheres = createParticlesPositionGeometry(shape?.geometry);
    const transforms = getParticleTransforms(data, props.positionScale);
    const name = `${data.label} Positions`;

    return Shape.create(
        name,
        data,
        spheres,
        () => props.positionColor,
        () => props.pointSize,
        (_groupId, instanceId) => `Position of ${getParticleLabel(data, instanceId)}`,
        transforms,
        1
    );
}

const ParticlesVisuals = {
    'position': (ctx: RepresentationContext, getParams: RepresentationParamsGetter<ParticlesData, ParticlesBaseParams>) => ShapeRepresentation(getParticlesPositionShape, Spheres.Utils),
    'orientation': (ctx: RepresentationContext, getParams: RepresentationParamsGetter<ParticlesData, ParticlesBaseParams>) => ShapeRepresentation(getParticlesOrientationShape, Lines.Utils),
};

export function getParticlesParams(ctx: ThemeRegistryContext, data: ParticlesData) {
    const defaultPositionScale = data.pixelSize ?? 1;
    const positionScale = Math.max(PositionScaleOptions.min, defaultPositionScale);
    const axisLength = Math.max(10, positionScale * 2);

    return {
        ...BaseParticlesParams,
        positionScale: PD.Numeric(positionScale, PositionScaleOptions, { description: BaseParticlesParams.positionScale.description }),
        axisLength: PD.Numeric(axisLength, AxisLengthOptions, { description: BaseParticlesParams.axisLength.description }),
        visuals: PD.MultiSelect(['position', 'orientation'], PD.objectToOptions(ParticlesVisuals)),
    };
}

export type ParticlesParams = ReturnType<typeof getParticlesParams>
export type ParticlesProps = PD.Values<ParticlesParams>
export type ParticlesRepresentation = Representation<ParticlesData, ParticlesParams>

export function ParticlesRepresentation(ctx: RepresentationContext, getParams: RepresentationParamsGetter<ParticlesData, ParticlesParams>): ParticlesRepresentation {
    const repr = Representation.createMulti('Particles', ctx, getParams, Representation.StateBuilder, ParticlesVisuals as unknown as Representation.Def<ParticlesData, ParticlesParams>);
    repr.setState({ markerActions: MarkerActions.Highlighting });
    return repr;
}
