/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Structure, Unit } from '../../mol-model/structure';
import { RepresentationProps } from '../representation';
import { Visual, VisualContext } from '../visual';
import { Geometry, GeometryUtils } from '../../mol-geo/geometry/geometry';
import { LocationIterator } from '../../mol-geo/util/location-iterator';
import { Theme, createEmptyTheme } from '../../mol-theme/theme';
import { createUnitsTransform, includesUnitKind } from './visual/util/common';
import { createRenderObject, RenderObjectKindType, RenderObjectValuesType } from '../../mol-gl/render-object';
import { UnitsParams } from './units-representation';
import { PickingId } from '../../mol-geo/geometry/picking';
import { Loci, isEveryLoci, EmptyLoci } from '../../mol-model/loci';
import { Interval } from '../../mol-data/int';
import { VisualUpdateState } from '../util';
import { ColorTheme } from '../../mol-theme/color';
import { createMarkers, MarkerAction } from '../../mol-geo/geometry/marker-data';
import { ValueCell, deepEqual } from '../../mol-util';
import { createSizes } from '../../mol-geo/geometry/size-data';
import { createColors } from '../../mol-geo/geometry/color-data';
import { Mat4 } from '../../mol-math/linear-algebra';
import { Overpaint } from '../../mol-theme/overpaint';
import { Transparency } from '../../mol-theme/transparency';
import { StructureMeshParams, StructureSpheresParams, StructurePointsParams, StructureLinesParams, StructureDirectVolumeParams, StructureTextureMeshParams } from './representation';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { SizeTheme } from '../../mol-theme/size';
import { Spheres } from '../../mol-geo/geometry/spheres/spheres';
import { Points } from '../../mol-geo/geometry/points/points';
import { Lines } from '../../mol-geo/geometry/lines/lines';
import { DirectVolume } from '../../mol-geo/geometry/direct-volume/direct-volume';
import { TextureMesh } from '../../mol-geo/geometry/texture-mesh/texture-mesh';

export type StructureGroup = { structure: Structure, group: Unit.SymmetryGroup }

export interface UnitsVisual<P extends RepresentationProps = {}> extends Visual<StructureGroup, P> { }

function createUnitsRenderObject<G extends Geometry>(group: Unit.SymmetryGroup, geometry: G, locationIt: LocationIterator, theme: Theme, props: PD.Values<Geometry.Params<G>>, materialId: number) {
    const { createValues, createRenderableState } = Geometry.getUtils(geometry)
    const transform = createUnitsTransform(group)
    const values = createValues(geometry, transform, locationIt, theme, props)
    const state = createRenderableState(props)
    return createRenderObject(geometry.kind, values, state, materialId)
}

interface UnitsVisualBuilder<P extends UnitsParams, G extends Geometry> {
    defaultProps: PD.Values<P>
    createGeometry(ctx: VisualContext, unit: Unit, structure: Structure, theme: Theme, props: PD.Values<P>, geometry?: G): Promise<G> | G
    createLocationIterator(group: Unit.SymmetryGroup): LocationIterator
    getLoci(pickingId: PickingId, structureGroup: StructureGroup, id: number): Loci
    eachLocation(loci: Loci, structureGroup: StructureGroup, apply: (interval: Interval) => boolean): boolean
    setUpdateState(state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup): void
}

interface UnitsVisualGeometryBuilder<P extends UnitsParams, G extends Geometry> extends UnitsVisualBuilder<P, G> {
    geometryUtils: GeometryUtils<G>
}

export function UnitsVisual<G extends Geometry, P extends UnitsParams & Geometry.Params<G>>(builder: UnitsVisualGeometryBuilder<P, G>, materialId: number): UnitsVisual<P> {
    const { defaultProps, createGeometry, createLocationIterator, getLoci, eachLocation, setUpdateState } = builder
    const { createEmpty: createEmptyGeometry, updateValues, updateBoundingSphere, updateRenderableState } = builder.geometryUtils
    const updateState = VisualUpdateState.create()

    let renderObject: RenderObjectKindType[G['kind']] | undefined

    let newProps: PD.Values<P> = Object.assign({}, defaultProps)
    let newTheme: Theme = createEmptyTheme()
    let newStructureGroup: StructureGroup

    let currentProps: PD.Values<P>
    let currentTheme: Theme
    let currentStructureGroup: StructureGroup

    let geometry: G
    let locationIt: LocationIterator

    function prepareUpdate(theme: Theme, props: Partial<PD.Values<P>> = {}, structureGroup: StructureGroup) {
        if (!structureGroup && !currentStructureGroup) {
            throw new Error('missing structureGroup')
        }

        newProps = Object.assign({}, currentProps, props)
        newTheme = theme
        newStructureGroup = structureGroup

        VisualUpdateState.reset(updateState)

        if (!renderObject) {
            updateState.createNew = true
        } else if (!currentStructureGroup || !Unit.SymmetryGroup.areInvariantElementsEqual(newStructureGroup.group, currentStructureGroup.group)) {
            updateState.createNew = true
        }

        if (updateState.createNew) {
            updateState.createGeometry = true
            return
        }

        setUpdateState(updateState, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)

        if (!ColorTheme.areEqual(newTheme.color, currentTheme.color)) {
            // console.log('new colorTheme')
            updateState.updateColor = true
        }

        if (!deepEqual(newProps.unitKinds, currentProps.unitKinds)) {
            // console.log('new unitKinds')
            updateState.createGeometry = true
        }

        if (newStructureGroup.group.transformHash !== currentStructureGroup.group.transformHash) {
            // console.log('new transformHash')
            if (newStructureGroup.group.units.length !== currentStructureGroup.group.units.length || updateState.updateColor) {
                updateState.updateTransform = true
            } else {
                updateState.updateMatrix = true
            }
        }

        // check if the conformation of unit.model has changed
        const newUnit = newStructureGroup.group.units[0]
        const currentUnit = currentStructureGroup.group.units[0]
        // if (Unit.conformationId(newUnit) !== Unit.conformationId(currentUnit)) {
        if (Unit.conformationId(newUnit) !== Unit.conformationId(currentUnit)
            // TODO: this needs more attention
            || newUnit.conformation !== currentUnit.conformation) {
            // console.log('new conformation')
            updateState.updateTransform = true;
            updateState.createGeometry = true
        }

        if (updateState.updateTransform) {
            updateState.updateColor = true
            updateState.updateSize = true
            updateState.updateMatrix = true
        }

        if (updateState.createGeometry) {
            updateState.updateColor = true
            updateState.updateSize = true
        }
    }

    function update(newGeometry?: G) {
        if (updateState.createNew) {
            locationIt = createLocationIterator(newStructureGroup.group)
            if (newGeometry) {
                renderObject = createUnitsRenderObject(newStructureGroup.group, newGeometry, locationIt, newTheme, newProps, materialId)
            } else {
                throw new Error('expected geometry to be given')
            }
        } else {
            if (!renderObject) {
                throw new Error('expected renderObject to be available')
            }

            if (updateState.updateTransform) {
                // console.log('update transform')
                locationIt = createLocationIterator(newStructureGroup.group)
                const { instanceCount, groupCount } = locationIt
                createMarkers(instanceCount * groupCount, renderObject.values)
            }

            if (updateState.updateMatrix) {
                // console.log('update matrix')
                createUnitsTransform(newStructureGroup.group, renderObject.values)
            }

            if (updateState.createGeometry) {
                // console.log('update geometry')
                if (newGeometry) {
                    ValueCell.update(renderObject.values.drawCount, Geometry.getDrawCount(newGeometry))
                } else {
                    throw new Error('expected geometry to be given')
                }
            }

            if (updateState.updateTransform || updateState.createGeometry) {
                // console.log('UnitsVisual.updateBoundingSphere')
                updateBoundingSphere(renderObject.values as RenderObjectValuesType[G['kind']], newGeometry || geometry)
            }

            if (updateState.updateSize) {
                // not all geometries have size data, so check here
                if ('uSize' in renderObject.values) {
                    // console.log('update size')
                    createSizes(locationIt, newTheme.size, renderObject.values)
                }
            }

            if (updateState.updateColor) {
                // console.log('update color')
                createColors(locationIt, newTheme.color, renderObject.values)
            }

            updateValues(renderObject.values as RenderObjectValuesType[G['kind']], newProps)
            updateRenderableState(renderObject.state, newProps)
        }

        currentProps = newProps
        currentTheme = newTheme
        currentStructureGroup = newStructureGroup
        if (newGeometry) geometry = newGeometry
    }

    function _createGeometry(ctx: VisualContext, unit: Unit, structure: Structure, theme: Theme, props: PD.Values<P>, geometry?: G) {
        return includesUnitKind(props.unitKinds, unit)
                ? createGeometry(ctx, unit, structure, theme, props, geometry)
                : createEmptyGeometry(geometry)
    }

    function lociApply(loci: Loci, apply: (interval: Interval) => boolean) {
        if (isEveryLoci(loci) || (Structure.isLoci(loci) && Structure.areParentsEquivalent(loci.structure, currentStructureGroup.structure))) {
            return apply(Interval.ofBounds(0, locationIt.groupCount * locationIt.instanceCount))
        } else {
            return eachLocation(loci, currentStructureGroup, apply)
        }
    }

    return {
        get groupCount() { return locationIt ? locationIt.count : 0 },
        get renderObject () { return locationIt && locationIt.count ? renderObject : undefined },
        createOrUpdate(ctx: VisualContext, theme: Theme, props: Partial<PD.Values<P>> = {}, structureGroup?: StructureGroup) {
            prepareUpdate(theme, props, structureGroup || currentStructureGroup)
            if (updateState.createGeometry) {
                const newGeometry = _createGeometry(ctx, newStructureGroup.group.units[0], newStructureGroup.structure, newTheme, newProps, geometry)
                return newGeometry instanceof Promise ? newGeometry.then(update) : update(newGeometry as G)
            } else {
                update()
            }
        },
        getLoci(pickingId: PickingId) {
            return renderObject ? getLoci(pickingId, currentStructureGroup, renderObject.id) : EmptyLoci
        },
        mark(loci: Loci, action: MarkerAction) {
            return Visual.mark(renderObject, loci, action, lociApply)
        },
        setVisibility(visible: boolean) {
            Visual.setVisibility(renderObject, visible)
        },
        setAlphaFactor(alphaFactor: number) {
            Visual.setAlphaFactor(renderObject, alphaFactor)
        },
        setPickable(pickable: boolean) {
            Visual.setPickable(renderObject, pickable)
        },
        setTransform(matrix?: Mat4, instanceMatrices?: Float32Array | null) {
            Visual.setTransform(renderObject, matrix, instanceMatrices)
        },
        setOverpaint(overpaint: Overpaint) {
            return Visual.setOverpaint(renderObject, overpaint, lociApply, true)
        },
        setTransparency(transparency: Transparency) {
            return Visual.setTransparency(renderObject, transparency, lociApply, true)
        },
        destroy() {
            // TODO
            renderObject = undefined
        }
    }
}

// mesh

export const UnitsMeshParams = { ...StructureMeshParams, ...UnitsParams }
export type UnitsMeshParams = typeof UnitsMeshParams
export interface UnitsMeshVisualBuilder<P extends UnitsMeshParams> extends UnitsVisualBuilder<P, Mesh> { }

export function UnitsMeshVisual<P extends UnitsMeshParams>(builder: UnitsMeshVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<Mesh, StructureMeshParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.createGeometry = true
        },
        geometryUtils: Mesh.Utils
    }, materialId)
}

// spheres

export const UnitsSpheresParams = { ...StructureSpheresParams, ...UnitsParams }
export type UnitsSpheresParams = typeof UnitsSpheresParams
export interface UnitsSpheresVisualBuilder<P extends UnitsSpheresParams> extends UnitsVisualBuilder<P, Spheres> { }

export function UnitsSpheresVisual<P extends UnitsSpheresParams>(builder: UnitsSpheresVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<Spheres, StructureSpheresParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.updateSize = true
        },
        geometryUtils: Spheres.Utils
    }, materialId)
}

// points

export const UnitsPointsParams = { ...StructurePointsParams, ...UnitsParams }
export type UnitsPointsParams = typeof UnitsPointsParams
export interface UnitsPointVisualBuilder<P extends UnitsPointsParams> extends UnitsVisualBuilder<P, Points> { }

export function UnitsPointsVisual<P extends UnitsPointsParams>(builder: UnitsPointVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<Points, StructurePointsParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.updateSize = true
        },
        geometryUtils: Points.Utils
    }, materialId)
}

// lines

export const UnitsLinesParams = { ...StructureLinesParams, ...UnitsParams }
export type UnitsLinesParams = typeof UnitsLinesParams
export interface UnitsLinesVisualBuilder<P extends UnitsLinesParams> extends UnitsVisualBuilder<P, Lines> { }

export function UnitsLinesVisual<P extends UnitsLinesParams>(builder: UnitsLinesVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<Lines, StructureLinesParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.updateSize = true
        },
        geometryUtils: Lines.Utils
    }, materialId)
}

// direct-volume

export const UnitsDirectVolumeParams = { ...StructureDirectVolumeParams, ...UnitsParams }
export type UnitsDirectVolumeParams = typeof UnitsDirectVolumeParams
export interface UnitsDirectVolumeVisualBuilder<P extends UnitsDirectVolumeParams> extends UnitsVisualBuilder<P, DirectVolume> { }

export function UnitsDirectVolumeVisual<P extends UnitsDirectVolumeParams>(builder: UnitsDirectVolumeVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<DirectVolume, StructureDirectVolumeParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.createGeometry = true
        },
        geometryUtils: DirectVolume.Utils
    }, materialId)
}

// texture-mesh

export const UnitsTextureMeshParams = { ...StructureTextureMeshParams, ...UnitsParams }
export type UnitsTextureMeshParams = typeof UnitsTextureMeshParams
export interface UnitsTextureMeshVisualBuilder<P extends UnitsTextureMeshParams> extends UnitsVisualBuilder<P, TextureMesh> { }

export function UnitsTextureMeshVisual<P extends UnitsTextureMeshParams>(builder: UnitsTextureMeshVisualBuilder<P>, materialId: number): UnitsVisual<P> {
    return UnitsVisual<TextureMesh, StructureTextureMeshParams & UnitsParams>({
        ...builder,
        setUpdateState: (state: VisualUpdateState, newProps: PD.Values<P>, currentProps: PD.Values<P>, newTheme: Theme, currentTheme: Theme, newStructureGroup: StructureGroup, currentStructureGroup: StructureGroup) => {
            builder.setUpdateState(state, newProps, currentProps, newTheme, currentTheme, newStructureGroup, currentStructureGroup)
            if (!SizeTheme.areEqual(newTheme.size, currentTheme.size)) state.createGeometry = true
        },
        geometryUtils: TextureMesh.Utils
    }, materialId)
}