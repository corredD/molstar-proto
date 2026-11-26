/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Canvas3D } from '../../mol-canvas3d/canvas3d';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import { Color } from '../../mol-util/color';
import type { CpuChannelTarget } from './cpu-channels';

/**
 * The Canvas3D adapter of the CPU channels' port, built by `VirusOnTheRockApp.create`. The camera patches are made once
 * and reused (the camera copies them; its stateChanged readers look only at radius and radiusMax). So is the background
 * patch, renderer.backgroundColor only: Canvas3D.setProps takes the rest of the renderer props from the renderer
 */
export function createCanvas3DChannelTarget(canvas3d: Canvas3D): CpuChannelTarget {
    const fovPatch = { fov: 0 };
    const positionPatch = { position: Vec3() };
    const backgroundPatch = { renderer: { backgroundColor: Color(0) } };
    return {
        getCamera: () => canvas3d.camera.state,
        setCameraFov(fov) {
            fovPatch.fov = fov;
            canvas3d.camera.setState(fovPatch);
        },
        setCameraPosition(position) {
            Vec3.copy(positionPatch.position, position);
            canvas3d.camera.setState(positionPatch);
        },
        setBackgroundColor(backgroundColor) {
            backgroundPatch.renderer.backgroundColor = backgroundColor;
            canvas3d.setProps(backgroundPatch);
        },
        getRenderObjects: () => canvas3d.getRenderObjects(),
    };
}
