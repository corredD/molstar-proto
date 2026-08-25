/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Lines } from '../../mol-geo/geometry/lines/lines';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { Shape } from '../../mol-model/shape';
import { ShapeGetter } from '../../mol-repr/shape/representation';
import { ParamDefinition as PD } from '../../mol-util/param-definition';

/** Params the mesh-based shape providers add on top of `Mesh.Params` so the same shape can also be
 * drawn as a wireframe: the `Lines` params that visual needs, plus the selection itself. Merged
 * flat, the same way `MolecularSurfaceParams` merges its mesh and wireframe visual params, so that
 * a caller (including MVS via `molstar_mesh_params`) can set them without nesting. */
export const ShapeWireframeParams = {
    ...Lines.Params,
    visuals: PD.MultiSelect(['mesh'], PD.arrayToOptions(['mesh', 'wireframe'] as const), { isEssential: true }),
};
export type ShapeWireframeParams = typeof ShapeWireframeParams

/** Turn a mesh shape getter into one yielding the same shape as a wireframe.
 *
 * The mesh getter is memoized by every provider -- it returns the identical `Shape` object while
 * nothing relevant changed -- so calling it a second time here is cheap, and shape identity is
 * exactly the signal for when the lines need rebuilding. Colors, labels, transforms and group count
 * are taken from the mesh shape, so the wireframe stays in step with the mesh it mirrors. */
export function wireframeShapeGetter<D>(getMeshShape: ShapeGetter<D, Mesh, any>): ShapeGetter<D, Lines, any> {
    let _meshShape: Shape<Mesh> | undefined;
    let _linesShape: Shape<Lines> | undefined;

    return async (ctx, data, props, shape) => {
        const meshShape = await getMeshShape(ctx, data, props);
        if (!_linesShape || meshShape !== _meshShape) {
            const lines = Lines.fromMesh(meshShape.geometry, shape?.geometry);
            _meshShape = meshShape;
            _linesShape = Shape.create(
                `${meshShape.name}-wireframe`, meshShape.sourceData, lines,
                meshShape.getColor, meshShape.getSize, meshShape.getLabel,
                meshShape.transforms, meshShape.groupCount
            );
        }
        return _linesShape;
    };
}
