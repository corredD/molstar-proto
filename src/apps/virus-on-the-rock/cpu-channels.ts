/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { RenderableState } from '../../mol-gl/renderable';
import type { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import type { AudioRouteDrives } from '../../mol-plugin-state/manager/audio-routing';
import type { Color } from '../../mol-util/color';

/** the drives of the channels the app runs on the CPU */
export type CpuChannelDrives = Pick<AudioRouteDrives, 'clipPosition' | 'clipSize' | 'cameraZoom' | 'cameraSpin' | 'cameraRock' | 'cameraStep' | 'background' | 'opacity'>;

/** what the channels read and write of a render object: its state, and its values (the clip objects, alpha) */
export type CpuChannelRenderObject = {
    readonly state: Pick<RenderableState, 'visible' | 'alphaFactor' | 'opaque' | 'writeDepth'>,
    readonly values: object,
};

/** the camera as the channels read it */
export interface CpuChannelCamera {
    readonly fov: number,
    readonly position: Vec3,
    readonly target: Vec3,
    readonly up: Vec3,
}

/** the calls the channels make on the viewer: the camera, the background, the render objects */
export interface CpuChannelTarget {
    /** the camera's current state; read in the frame, never kept */
    getCamera(): CpuChannelCamera,
    setCameraFov(fov: number): void,
    /** copies `position` */
    setCameraPosition(position: Vec3): void,
    setBackgroundColor(color: Color): void,
    getRenderObjects(): ReadonlyArray<CpuChannelRenderObject>,
}

export interface CpuChannelPorts {
    readonly drives: () => Readonly<CpuChannelDrives>,
    readonly clipEnabled: () => boolean,
    readonly clipScale: () => number,
    /** the clock, ms */
    readonly now: () => number,
    readonly target: CpuChannelTarget,
}

/** API skeleton: implemented in the next commit */
export class CpuChannels {
    constructor(private readonly ports: CpuChannelPorts) { }

    /** one frame of every channel; called after each draw */
    update() {
        void this.ports;
        throw new Error('not implemented');
    }

    /** off: the clip objects get their first values back; on: they are captured again on the next frame */
    setClipEnabled(enabled: boolean) {
        throw new Error('not implemented');
    }
}
