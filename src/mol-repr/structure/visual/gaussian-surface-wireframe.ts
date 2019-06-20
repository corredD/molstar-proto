/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { VisualContext } from '../../visual';
import { Unit, Structure } from '../../../mol-model/structure';
import { Theme } from '../../../mol-theme/theme';
import { GaussianDensityProps } from '../../../mol-math/geometry/gaussian-density';
import { Lines } from '../../../mol-geo/geometry/lines/lines';
import { computeUnitGaussianDensity, GaussianDensityParams } from './util/gaussian';
import { computeMarchingCubesLines } from '../../../mol-geo/util/marching-cubes/algorithm';
import { UnitsLinesParams, UnitsVisual, UnitsLinesVisual } from '../units-visual';
import { StructureElementIterator, getElementLoci, eachElement } from './util/element';
import { VisualUpdateState } from '../../util';

async function createGaussianWireframe(ctx: VisualContext, unit: Unit, structure: Structure, theme: Theme, props: GaussianDensityProps, lines?: Lines): Promise<Lines> {
    const { smoothness } = props
    const { transform, field, idField } = await computeUnitGaussianDensity(unit, props, ctx.webgl).runInContext(ctx.runtime)

    const params = {
        isoLevel: Math.exp(-smoothness),
        scalarField: field,
        idField
    }
    const wireframe = await computeMarchingCubesLines(params, lines).runAsChild(ctx.runtime)

    Lines.transformImmediate(wireframe, transform)

    return wireframe
}

export const GaussianWireframeParams = {
    ...UnitsLinesParams,
    ...GaussianDensityParams,
    lineSizeAttenuation: PD.Boolean(false),
}
export type GaussianWireframeParams = typeof GaussianWireframeParams

export function GaussianWireframeVisual(materialId: number): UnitsVisual<GaussianWireframeParams> {
    return UnitsLinesVisual<GaussianWireframeParams>({
        defaultProps: PD.getDefaultValues(GaussianWireframeParams),
        createGeometry: createGaussianWireframe,
        createLocationIterator: StructureElementIterator.fromGroup,
        getLoci: getElementLoci,
        eachLocation: eachElement,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<GaussianWireframeParams>, currentProps: PD.Values<GaussianWireframeParams>) => {
            if (newProps.resolution !== currentProps.resolution) state.createGeometry = true
            if (newProps.radiusOffset !== currentProps.radiusOffset) state.createGeometry = true
            if (newProps.smoothness !== currentProps.smoothness) state.createGeometry = true
            if (newProps.useGpu !== currentProps.useGpu) state.createGeometry = true
        }
    }, materialId)
}