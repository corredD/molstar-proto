/**
 * Copyright (c) 2019-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import type { ShapeGetter } from '@molstar/graphics/repr/shape/representation';
import type { Geometry, GeometryUtils } from '../geometry/geometry.js';
import type { Lines } from '../geometry/lines/lines.js';

export interface ShapeProvider<D, G extends Geometry, P extends Geometry.Params<G>> {
  label: string;
  data: D;
  params: P;
  getShape: ShapeGetter<D, G, P>;
  geometryUtils: GeometryUtils<G>;
  /** Optional wireframe rendering of the same data, shown alongside or instead of `getShape`
   * depending on the `visuals` param. Props are untyped because `P` is tied to `G`, not `Lines`. */
  getWireframeShape?: ShapeGetter<D, Lines, any>;
}
