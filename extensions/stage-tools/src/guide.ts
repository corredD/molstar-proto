/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { registerShapeGeometry } from '@molstar/plugin/state/precompile';
import { type Cut, cutGuideMesh } from './cuts.js';

/** The tag of a cut's guide, with the state ref of the target it cuts */
export const CutGuideTag = 'stage-tools-cut-guide';

/** The guides' quiet color */
export const CutGuideColor = Color(0x8fb8de);

export { CutGuideShape };
type CutGuideShape = typeof CutGuideShape;
/** A cut's guide (`cuts.ts`): its shape as a mesh, drawn translucent by its representation; never clipped */
const CutGuideShape = PluginStateTransform.BuiltIn({
  name: 'stage-tools-cut-guide',
  display: { name: 'Cut Guide', description: 'The shape of a cut, so it can be seen where it is.' },
  from: SO.Root,
  to: SO.Shape.Provider,
  params: {
    cut: PD.Value<Cut>(
      { shape: 'plane', center: [0, 0, 0], normal: [0, 1, 0], radius: 10, size: [10, 10, 10], invert: false },
      { isHidden: true },
    ),
    target: PD.Text('', { description: 'The state ref of what it cuts' }),
  },
})({
  canAutoUpdate() {
    return true;
  },
  apply({ params }) {
    return Task.create('Cut Guide', async () => {
      const label = `Cut (${params.cut.shape})`;
      return new SO.Shape.Provider(
        {
          label,
          data: params.cut,
          params: Mesh.Params,
          getShape: (_, cut: Cut, __, shape) =>
            ShapeUtils.create(
              label,
              cut,
              cutGuideMesh(cut, shape?.geometry),
              () => CutGuideColor,
              () => 1,
              () => label,
            ),
          geometryUtils: Mesh.Utils,
        },
        { label, description: params.cut.shape },
      );
    });
  },
});

registerShapeGeometry(CutGuideShape, () => [Mesh.Utils]);

/** How a guide is drawn: translucent, both sides, flat */
export const CutGuideLook = {
  ...PD.getDefaultValues(Mesh.Params),
  alpha: 0.12,
  doubleSided: true,
  ignoreLight: true,
};
