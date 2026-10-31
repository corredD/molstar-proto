/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { Canvas3DProps } from '@molstar/graphics/canvas3d/canvas3d';
import type { PluginSpec } from '@molstar/plugin/spec';

// The Mesoscale Explorer's look (v5 `apps/mesoscale-explorer/src/ui/states.tsx`, `adjustPluginProps`): the canvas a
// mesoscale model is shown in by default: multiscale ambient occlusion, soft shadows, outlines, edges for the hovered
// and picked, a far camera, a little more exposure.

export const MesoscaleCanvasLook: Partial<Canvas3DProps> = {
  multiSample: { mode: 'off' } as Canvas3DProps['multiSample'],
  // no far clipping (a whole cell); the near plane as Mol*'s default: the explorer's 50 Å minimum clipped small
  // structures and the cuts' guides near the camera
  cameraClipping: { far: false } as Canvas3DProps['cameraClipping'],
  sceneRadiusFactor: 2,
  // levels of detail 4 times coarser and half the resolution while the camera moves, full once it rests (instance-cull)
  motion: { lodScale: 4, pixelScale: 0.5, holdMs: 250 },
  marking: {
    enabled: true,
    highlightEdgeColor: Color(0x999999),
    selectEdgeColor: Color(0xffff00),
    highlightEdgeStrength: 1,
    selectEdgeStrength: 1,
    ghostEdgeStrength: 1,
    innerEdgeFactor: 2.5,
    edgeScale: 2,
  } as Canvas3DProps['marking'],
  postprocessing: {
    occlusion: {
      name: 'on',
      params: {
        samples: 32,
        multiScale: {
          name: 'on',
          params: {
            levels: [
              { radius: 2, bias: 1.0 },
              { radius: 5, bias: 1.0 },
              { radius: 8, bias: 1.0 },
              { radius: 11, bias: 1.0 },
            ],
            nearThreshold: 10,
            farThreshold: 1500,
          },
        },
        radius: 5,
        bias: 1,
        blurKernelSize: 11,
        blurDepthBias: 0.5,
        resolutionScale: 1,
        color: Color(0x000000),
        transparentThreshold: 0.4,
      },
    },
    shadow: { name: 'on', params: { maxDistance: 80, steps: 3, tolerance: 1.0 } },
    // the ghosts of what clips cut in a gray of their own: black ones vanish on the dark theme (cellview.md §4.3)
    outline: {
      name: 'on',
      params: {
        scale: 1,
        threshold: 0.15,
        color: Color(0x000000),
        includeTransparent: false,
        transparentColor: Color(0x8a8a8a),
      },
    },
  } as Canvas3DProps['postprocessing'],
};

/** The spec's canvas with the mesoscale look under what it sets itself (its postprocessing merged by effect) */
export function withMesoscaleLook(spec: PluginSpec): PluginSpec {
  const own = spec.canvas3d ?? {};
  return {
    ...spec,
    canvas3d: {
      ...MesoscaleCanvasLook,
      ...own,
      renderer: { ...(own.renderer as object), exposure: 1.1 } as Canvas3DProps['renderer'],
      postprocessing: {
        ...(MesoscaleCanvasLook.postprocessing as object),
        ...(own.postprocessing as object),
      } as Canvas3DProps['postprocessing'],
    },
  };
}
