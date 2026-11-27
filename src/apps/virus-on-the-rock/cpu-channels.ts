/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { RenderableState } from '../../mol-gl/renderable';
import { Mat4 } from '../../mol-math/linear-algebra/3d/mat4';
import { Vec3 } from '../../mol-math/linear-algebra/3d/vec3';
import type { AudioRouteDrives } from '../../mol-plugin-state/manager/audio-routing';
import { Color } from '../../mol-util/color';
import { ValueCell } from '../../mol-util/value-cell';
import { BeatCycleMinIntervalMs, BeatCyclePeakDecayMs, BeatCyclePeakFloor, BeatCycleReleaseLevel, BeatCycleTriggerLevel } from './beat-cycle';

/** the camera-zoom channel narrows the field of view by this much per unit of drive, at most CameraZoomMax */
const CameraZoomPerDrive = 0.08;
const CameraZoomMax = 0.3;
/** camera spin: radians per second at a drive of 1; camera rock: the swing at a drive of 1 and its period */
const CameraSpinRadPerSecond = 0.5;
const CameraRockRadians = 0.25;
const CameraRockPeriodSeconds = 4;
/**
 * Camera step: a turn now and then, not every beat (cutting on every beat reads as predictable; phrases run 8, 16 or
 * 32 bars). Its route's rises are counted like the beat cycle's; every CameraStepEvery-th one (four bars of a kick on
 * each beat; no bar tracking yet) turns the camera
 * CameraStepRadians about its up axis, eased over CameraStepSeconds
 */
const CameraStepEvery = 16;
const CameraStepRadians = Math.PI / 4;
const CameraStepSeconds = 1.6;
/**
 * The background flash: the share of the way to BackgroundFlashColor per unit of drive, at most BackgroundFlashMax.
 * Photosensitivity: no more than three flashes a second (WCAG 2.3.1, "Three Flashes or Below Threshold"), so a new
 * flash waits BackgroundFlashMinIntervalMs after the last one, and the flash stays well short of white
 */
export const BackgroundBaseColor = Color(0x09111a);
const BackgroundFlashColor = Color(0xe8eef4);
const BackgroundFlashPerDrive = 0.3;
const BackgroundFlashMax = 0.6;
const BackgroundFlashMinIntervalMs = 400;
/** opacity: fades this much per unit of drive, never below OpacityMin */
const OpacityPerDrive = 0.4;
const OpacityMin = 0.15;

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

/** the field of view the camera-zoom channel gives at `drive`, from the one it started at */
export function cameraZoomFov(baseFov: number, drive: number) {
    return baseFov * (1 - Math.min(CameraZoomMax, CameraZoomPerDrive * drive));
}

/** the camera spin's turn over `dt` seconds at `drive` */
export function cameraSpinAngle(drive: number, dt: number) {
    return drive * CameraSpinRadPerSecond * dt;
}

/** the camera rock's swing at `drive`, `seconds` into its period */
export function cameraRockAngle(drive: number, seconds: number) {
    return drive > 1e-3 ? drive * CameraRockRadians * Math.sin(2 * Math.PI * seconds / CameraRockPeriodSeconds) : 0;
}

/** the share of the way to the flash colour at `drive` */
export function backgroundFlashShare(drive: number) {
    return Math.min(BackgroundFlashMax, BackgroundFlashPerDrive * drive);
}

/** the alpha factor the opacity channel gives at `drive` */
export function opacityFactor(drive: number) {
    return drive > 1e-3 ? Math.max(OpacityMin, 1 - OpacityPerDrive * drive) : 1;
}

type ClipBase = {
    count: number,
    basePosition: Float32Array,
    baseScale: Float32Array,
    workPosition: Float32Array,
    workScale: Float32Array,
};

/**
 * The channels the app runs on the CPU after each draw: clip, camera zoom, spin, rock and step, opacity, background
 * flash. They see the viewer only through their CpuChannelTarget; a frame at rest makes no call on it, and a steady
 * frame allocates nothing
 */
export class CpuChannels {
    // Per-render-object snapshot of clip position/scale at the moment the toggle was enabled,
    // plus reusable working buffers we mutate in place each frame to avoid GC churn.
    private clipBaseState = new WeakMap<object, ClipBase>();
    /** whether the clip objects sit at their base values (the clip drives were 0 on the last pass) */
    private clipAtRest = true;

    /** the field of view when the camera-zoom channel started driving it, restored when it stops */
    private cameraZoomBaseFov?: number;

    private cameraMotionLastMs = 0;
    private cameraRockTime = 0;
    private cameraRockAngle = 0;
    private readonly cameraOffset = Vec3();
    private readonly cameraRotation = Mat4();
    private readonly cameraPosition = Vec3();

    private cameraStepPeak = BeatCyclePeakFloor;
    private cameraStepArmed = true;
    private cameraStepCount = 0;
    private cameraStepLastMs = 0;
    /** the turn still to make and how long it has left */
    private cameraStepLeft = 0;
    private cameraStepTimeLeft = 0;

    private backgroundShare = 0;
    private backgroundFlashMs = 0;
    private backgroundFalling = true;

    /** the objects the opacity channel faded, to give 1 back when it stops */
    private readonly fadedObjects = new Set<CpuChannelRenderObject>();
    /** scratch: the objects present this frame, cleared after use */
    private readonly presentObjects = new Set<CpuChannelRenderObject>();
    /** this frame's render objects, read once, dropped at the end of the frame */
    private frameObjects: ReadonlyArray<CpuChannelRenderObject> | undefined = undefined;

    constructor(private readonly ports: CpuChannelPorts) { }

    /** one frame of every channel; called after each draw */
    update() {
        try {
            this.updateClips();
            this.updateCameraZoom();
            this.updateCameraMotion();
            this.updateOpacity();
            this.updateBackground();
        } finally {
            // dropped even when a target call threw, so the next frame reads its own list
            this.frameObjects = undefined;
        }
    }

    /** off: the clip objects get their first values back; on: they are captured again on the next frame */
    setClipEnabled(enabled: boolean) {
        if (!enabled) this.restoreClipBaseStates();
        // Re-capture base state on next frame when enabling.
        if (enabled) this.clipBaseState = new WeakMap();
        this.clipAtRest = true;
    }

    private renderObjects() {
        if (!this.frameObjects) this.frameObjects = this.ports.target.getRenderObjects();
        return this.frameObjects;
    }

    private updateClips() {
        if (!this.ports.clipEnabled()) return;

        // the routed clip channels: a plane moves along its normal (position), the other shapes grow (size)
        const drives = this.ports.drives();
        const clipScale = this.ports.clipScale();
        const positionDrive = drives.clipPosition * clipScale;
        const scaledDrive = drives.clipSize * clipScale;
        // at rest: the last pass already wrote the base values back
        const atRest = positionDrive === 0 && scaledDrive === 0;
        if (atRest && this.clipAtRest) return;

        // one pass over the render objects; the base lookup is a WeakMap get, O(1)
        for (const ro of this.renderObjects()) {
            // the pass that writes the base values back takes the hidden objects too: it is the last one until a drive rises
            if (!ro.state.visible && !atRest) continue;
            const v = ro.values as any;
            const count = v.dClipObjectCount?.ref?.value as number | undefined;
            if (!count || count === 0) continue;

            // Capture base state the first frame the toggle is on.
            let base = this.clipBaseState.get(ro);
            if (!base) {
                const pos = v.uClipObjectPosition?.ref?.value as Float32Array | undefined;
                const scale = v.uClipObjectScale?.ref?.value as Float32Array | undefined;
                if (!pos || !scale) continue;
                base = {
                    count,
                    basePosition: new Float32Array(pos),
                    baseScale: new Float32Array(scale),
                    workPosition: new Float32Array(pos.length),
                    workScale: new Float32Array(scale.length),
                };
                this.clipBaseState.set(ro, base);
            }

            const types = v.uClipObjectType?.ref?.value as Int32Array | undefined;
            const rotations = v.uClipObjectRotation?.ref?.value as Float32Array | undefined;
            if (!types) continue;

            const { basePosition, baseScale, workPosition, workScale } = base;
            workPosition.set(basePosition);
            workScale.set(baseScale);

            for (let i = 0; i < count; i++) {
                const type = types[i];
                if (type === 1 && rotations) {
                    // Plane: translate along its normal.
                    // Normal = rotate Y-axis (0,1,0) by the clip object's quaternion [x,y,z,w].
                    const qx = rotations[i * 4], qy = rotations[i * 4 + 1];
                    const qz = rotations[i * 4 + 2], qw = rotations[i * 4 + 3];
                    const nx = 2 * (qx * qy + qz * qw);
                    const ny = 1 - 2 * (qx * qx + qz * qz);
                    const nz = 2 * (qy * qz - qx * qw);
                    const offset = positionDrive * 50; // 50 Å at drive=1, scale=1
                    workPosition[i * 3 + 0] = basePosition[i * 3 + 0] + nx * offset;
                    workPosition[i * 3 + 1] = basePosition[i * 3 + 1] + ny * offset;
                    workPosition[i * 3 + 2] = basePosition[i * 3 + 2] + nz * offset;
                } else if (type === 2 || type === 3) {
                    // Sphere / Cube: uniform scale.
                    const s = 1 + scaledDrive;
                    workScale[i * 3 + 0] = baseScale[i * 3 + 0] * s;
                    workScale[i * 3 + 1] = baseScale[i * 3 + 1] * s;
                    workScale[i * 3 + 2] = baseScale[i * 3 + 2] * s;
                } else if (type === 4) {
                    // Cylinder: widen radius (x, z), keep height (y) fixed.
                    const s = 1 + scaledDrive;
                    workScale[i * 3 + 0] = baseScale[i * 3 + 0] * s;
                    workScale[i * 3 + 2] = baseScale[i * 3 + 2] * s;
                } else if (type === 5) {
                    // Cone: widen the cone angle (scale.xy stores sin/cos of half-angle).
                    const s = 1 + scaledDrive * 0.5;
                    workScale[i * 3 + 0] = baseScale[i * 3 + 0] * s;
                    workScale[i * 3 + 1] = baseScale[i * 3 + 1] * s;
                }
            }

            // Force a version bump even when the working buffer ref hasn't changed,
            // so the renderer re-uploads the mutated contents.
            ValueCell.update(v.uClipObjectPosition, workPosition);
            ValueCell.update(v.uClipObjectScale, workScale);
        }
        // only once the pass is through: a pass that threw is run again on the next frame
        this.clipAtRest = atRest;
    }

    private restoreClipBaseStates() {
        for (const ro of this.ports.target.getRenderObjects()) {
            const base = this.clipBaseState.get(ro);
            if (!base) continue;
            const v = ro.values as any;
            ValueCell.updateIfChanged(v.uClipObjectPosition, base.basePosition);
            ValueCell.updateIfChanged(v.uClipObjectScale, base.baseScale);
            this.clipBaseState.delete(ro);
        }
    }

    /** the camera-zoom channel: a punch-in of the field of view, so the user's own orbit and zoom stay theirs */
    private updateCameraZoom() {
        const drive = this.ports.drives().cameraZoom;
        const target = this.ports.target;
        if (drive <= 1e-3) {
            if (this.cameraZoomBaseFov !== undefined) {
                target.setCameraFov(this.cameraZoomBaseFov);
                this.cameraZoomBaseFov = undefined;
            }
            return;
        }
        const camera = target.getCamera();
        if (this.cameraZoomBaseFov === undefined) this.cameraZoomBaseFov = camera.fov;
        const fov = cameraZoomFov(this.cameraZoomBaseFov, drive);
        if (Math.abs(camera.fov - fov) > 1e-4) target.setCameraFov(fov);
    }

    /**
     * The camera-spin and camera-rock channels: the camera turns around its target, about its up axis, by increments,
     * so the user's own orbit stays theirs. Spin keeps turning at a speed set by its drive; rock swings back and forth,
     * as wide as its drive
     */
    private updateCameraMotion() {
        const now = this.ports.now();
        const dt = this.cameraMotionLastMs > 0 ? Math.min(100, now - this.cameraMotionLastMs) / 1000 : 0;
        this.cameraMotionLastMs = now;
        const drives = this.ports.drives();
        let angle = cameraSpinAngle(drives.cameraSpin, dt);
        this.cameraRockTime += dt;
        const rock = cameraRockAngle(drives.cameraRock, this.cameraRockTime);
        angle += rock - this.cameraRockAngle;
        this.cameraRockAngle = rock;
        angle += this.updateCameraStep(drives.cameraStep, now, dt);
        if (Math.abs(angle) < 1e-6) return;
        const { position, target, up } = this.ports.target.getCamera();
        const offset = Vec3.sub(this.cameraOffset, position, target);
        const rotation = Mat4.fromRotation(this.cameraRotation, angle, up);
        Vec3.transformMat4(offset, offset, rotation);
        this.ports.target.setCameraPosition(Vec3.add(this.cameraPosition, target, offset));
    }

    /** this frame's share of the phrase turn: counts the route's rises, turns on every CameraStepEvery-th (eased) */
    private updateCameraStep(drive: number, now: number, dt: number) {
        if (dt > 0) this.cameraStepPeak = Math.max(BeatCyclePeakFloor, drive, this.cameraStepPeak * Math.exp(-dt * 1000 / BeatCyclePeakDecayMs));
        if (this.cameraStepArmed && drive > BeatCyclePeakFloor && drive >= this.cameraStepPeak * BeatCycleTriggerLevel && now - this.cameraStepLastMs >= BeatCycleMinIntervalMs) {
            this.cameraStepArmed = false;
            this.cameraStepLastMs = now;
            this.cameraStepCount += 1;
            if (this.cameraStepCount % CameraStepEvery === 0) {
                this.cameraStepLeft += CameraStepRadians;
                this.cameraStepTimeLeft = CameraStepSeconds;
            }
        } else if (!this.cameraStepArmed && drive <= this.cameraStepPeak * BeatCycleReleaseLevel) {
            this.cameraStepArmed = true;
        }
        if (this.cameraStepLeft <= 1e-6 || dt <= 0) return 0;
        // ease out: the turn left shrinks as fast as the time left
        const share = this.cameraStepTimeLeft <= dt ? 1 : 1 - Math.pow(1 - dt / this.cameraStepTimeLeft, 2);
        const angle = this.cameraStepLeft * share;
        this.cameraStepLeft -= angle;
        this.cameraStepTimeLeft = Math.max(0, this.cameraStepTimeLeft - dt);
        return angle;
    }

    /**
     * The background-flash channel: the background toward white with its drive, back to the base color as it falls; a
     * new rise within BackgroundFlashMinIntervalMs of the last flash is held back
     */
    private updateBackground() {
        let share = backgroundFlashShare(this.ports.drives().background);
        const now = this.ports.now();
        if (share > this.backgroundShare + 0.02) {
            // a rise: a new flash only once the last one is old enough
            if (this.backgroundFalling && now - this.backgroundFlashMs < BackgroundFlashMinIntervalMs) share = this.backgroundShare;
            else if (this.backgroundFalling) {
                this.backgroundFlashMs = now;
                this.backgroundFalling = false;
            }
        } else if (share < this.backgroundShare) {
            this.backgroundFalling = true;
        }
        if (Math.abs(share - this.backgroundShare) < 0.004) return;
        this.backgroundShare = share;
        this.ports.target.setBackgroundColor(Color.interpolate(BackgroundBaseColor, BackgroundFlashColor, share));
    }

    /** the opacity channel: objects fade (down to OpacityMin) through their alpha factor, drawn transparent meanwhile */
    private updateOpacity() {
        const factor = opacityFactor(this.ports.drives().opacity);
        if (factor === 1 && this.fadedObjects.size === 0) return;
        const objects = this.renderObjects();
        // a removed model's objects: forgotten, not held (they would keep its whole geometry alive)
        if (this.fadedObjects.size > 0) {
            const present = this.presentObjects;
            for (const ro of objects) present.add(ro);
            for (const ro of this.fadedObjects) if (!present.has(ro)) this.fadedObjects.delete(ro);
            present.clear();
        }
        for (const ro of objects) {
            if (factor === 1 && !this.fadedObjects.has(ro)) continue;
            ro.state.alphaFactor = factor;
            const alpha = (ro.values as { alpha?: { ref: { value: number } } }).alpha?.ref.value ?? 1;
            ro.state.opaque = alpha * factor >= 1;
            ro.state.writeDepth = ro.state.opaque;
            if (factor === 1) this.fadedObjects.delete(ro);
            else this.fadedObjects.add(ro);
        }
    }
}
