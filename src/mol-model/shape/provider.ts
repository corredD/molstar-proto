/**
 * Copyright (c) 2019-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ShapeGetter } from '../../mol-repr/shape/representation';
import { Geometry, GeometryUtils } from '../../mol-geo/geometry/geometry';
import { Lines } from '../../mol-geo/geometry/lines/lines';

export interface ShapeProvider<D, G extends Geometry, P extends Geometry.Params<G>> {
    label: string
    data: D
    params: P
    getShape: ShapeGetter<D, G, P>
    geometryUtils: GeometryUtils<G>
    /** Optional wireframe rendering of the same data, shown alongside or instead of `getShape`
     * depending on the `visuals` param. Props are untyped because `P` is tied to `G`, not `Lines`. */
    getWireframeShape?: ShapeGetter<D, Lines, any>
}
