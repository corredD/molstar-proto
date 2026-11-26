/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '../../../mol-math/linear-algebra/3d/vec3';
import { Color } from '../../../mol-util/color';
import { ValueCell } from '../../../mol-util/value-cell';
import { CpuChannelDrives, CpuChannelRenderObject, CpuChannels, CpuChannelTarget } from '../cpu-channels';

/**
 * Characterization of the CPU channels as app.tsx ran them from `didDraw` at e5e30d568 (`updateAudioReactiveClips`,
 * `updateAudioCameraZoom`, `updateAudioCameraMotion`, `updateAudioOpacity`, `updateAudioBackground`). Expected values
 * are worked by hand from that code's constants; the clock starts at 10 s, since its timestamps start at 0 ms.
 */
const T = 10000;

/** an in-memory CpuChannelTarget: a camera looking down -z from 10 Å, a list of render objects, the call log */
class FakeTarget implements CpuChannelTarget {
    readonly calls: string[] = [];
    readonly camera = { fov: 0.8, position: Vec3.create(0, 0, 10), target: Vec3.create(0, 0, 0), up: Vec3.create(0, 1, 0) };
    background: Color | undefined = undefined;
    objects: CpuChannelRenderObject[] = [];

    getCamera() { this.calls.push('getCamera'); return this.camera; }
    setCameraFov(fov: number) { this.calls.push('setCameraFov'); this.camera.fov = fov; }
    setCameraPosition(position: Vec3) { this.calls.push('setCameraPosition'); Vec3.copy(this.camera.position, position); }
    setBackgroundColor(color: Color) { this.calls.push('setBackgroundColor'); this.background = color; }
    getRenderObjects() { this.calls.push('getRenderObjects'); return this.objects; }

    /** the camera's turn about its up axis (y), from its start on +z */
    get angle() { return Math.atan2(this.camera.position[0], this.camera.position[2]); }
}

function zeroDrives(): CpuChannelDrives {
    return { clipPosition: 0, clipSize: 0, cameraZoom: 0, cameraSpin: 0, cameraRock: 0, cameraStep: 0, background: 0, opacity: 0 };
}

function setup() {
    const target = new FakeTarget();
    const drives = zeroDrives();
    const clock = { now: T };
    const clip = { enabled: false, scale: 1 };
    const channels = new CpuChannels({
        drives: () => drives,
        clipEnabled: () => clip.enabled,
        clipScale: () => clip.scale,
        now: () => clock.now,
        target,
    });
    /** `n` frames, `ms` apart */
    const frames = (n: number, ms = 100) => {
        for (let i = 0; i < n; i++) {
            clock.now += ms;
            channels.update();
        }
    };
    return { target, drives, clock, clip, channels, frames };
}

function renderObject(alpha = 1): CpuChannelRenderObject & { values: { alpha: ValueCell<number> } } {
    return {
        state: { visible: true, alphaFactor: 1, opaque: true, writeDepth: true },
        values: { alpha: ValueCell.create(alpha) },
    };
}

/** a render object with two clip objects: a plane at (1, 2, 3), normal +y, and a sphere of scale 2 at the origin */
function clipObject() {
    const values = {
        alpha: ValueCell.create(1),
        dClipObjectCount: ValueCell.create(2),
        uClipObjectType: ValueCell.create(new Int32Array([1, 2])),
        uClipObjectRotation: ValueCell.create(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])),
        uClipObjectPosition: ValueCell.create(new Float32Array([1, 2, 3, 0, 0, 0])),
        uClipObjectScale: ValueCell.create(new Float32Array([1, 1, 1, 2, 2, 2])),
    };
    return { state: { visible: true, alphaFactor: 1, opaque: true, writeDepth: true }, values };
}

describe('cpu channels', () => {
    describe('camera zoom', () => {
        it('narrows the field of view by 0.08 per unit of drive, at most 0.3', () => {
            const { target, drives, frames } = setup();
            drives.cameraZoom = 2;
            frames(1);
            expect(target.camera.fov).toBeCloseTo(0.8 * 0.84, 6);
            drives.cameraZoom = 5;
            frames(1);
            expect(target.camera.fov).toBeCloseTo(0.8 * 0.7, 6);
        });

        it('gives the field of view back when its drive stops', () => {
            const { target, drives, frames } = setup();
            drives.cameraZoom = 2;
            frames(1);
            drives.cameraZoom = 0;
            frames(1);
            expect(target.camera.fov).toBe(0.8);
            target.calls.length = 0;
            frames(5);
            expect(target.calls).toEqual([]);
        });
    });

    describe('camera spin and rock', () => {
        it('spins 0.5 rad per second at a drive of 1', () => {
            const { target, drives, frames } = setup();
            drives.cameraSpin = 1;
            frames(1); // the first frame has no time step
            frames(10);
            expect(target.angle).toBeCloseTo(0.5, 5);
        });

        it('rocks 0.25 rad per unit of drive over a 4 s period', () => {
            const { target, drives, frames } = setup();
            drives.cameraRock = 2;
            frames(1);
            frames(10);
            expect(target.angle).toBeCloseTo(0.5, 5);
            frames(10);
            expect(target.angle).toBeCloseTo(0, 5);
            frames(10);
            expect(target.angle).toBeCloseTo(-0.5, 5);
            frames(10);
            expect(target.angle).toBeCloseTo(0, 5);
        });

        it('steps the camera a quarter turn on every 16th rise of its drive, eased over 1.6 s', () => {
            const { target, drives, frames } = setup();
            const rise = () => {
                drives.cameraStep = 1;
                frames(1);
                drives.cameraStep = 0;
                frames(4);
            };
            for (let i = 0; i < 15; i++) rise();
            expect(target.calls).not.toContain('setCameraPosition');
            rise();
            frames(16);
            expect(target.angle).toBeCloseTo(Math.PI / 4, 5);
            for (let i = 0; i < 15; i++) rise();
            frames(20);
            expect(target.angle).toBeCloseTo(Math.PI / 4, 5);
            rise();
            frames(20);
            expect(target.angle).toBeCloseTo(Math.PI / 2, 5);
        });

        it('counts rises within 400 ms of the last counted one only once', () => {
            const { target, drives, frames } = setup();
            for (let i = 0; i < 16; i++) {
                drives.cameraStep = 1;
                frames(1);
                drives.cameraStep = 0;
                frames(2);
            }
            frames(20);
            expect(target.calls).not.toContain('setCameraPosition');
        });
    });

    describe('background flash', () => {
        it('moves 0.3 of the way to the flash colour per unit of drive, at most 0.6', () => {
            const one = setup();
            one.drives.background = 1;
            one.frames(1);
            // 0x09111a toward 0xe8eef4 by 0.3, each channel truncated
            expect(one.target.background).toBe(0x4b535b);

            const five = setup();
            five.drives.background = 5;
            five.frames(1);
            expect(five.target.background).toBe(0x8e959c);
        });

        it('holds a new flash back until 400 ms after the last', () => {
            const { target, drives, frames } = setup();
            drives.background = 1;
            frames(1); // +100: flash
            drives.background = 0;
            frames(1); // +200: back to the base colour
            expect(target.background).toBe(0x09111a);
            drives.background = 1;
            target.calls.length = 0;
            frames(2); // +300, +400: held back
            expect(target.calls).toEqual([]);
            frames(1); // +500: 400 ms after the flash
            expect(target.background).toBe(0x4b535b);
        });
    });

    describe('opacity', () => {
        it('fades 0.4 per unit of drive, never below 0.15, and gives 1 back', () => {
            const { target, drives, frames } = setup();
            const a = renderObject(), b = renderObject();
            target.objects = [a, b];
            drives.opacity = 1;
            frames(1);
            expect(a.state.alphaFactor).toBeCloseTo(0.6, 6);
            expect(a.state.opaque).toBe(false);
            expect(a.state.writeDepth).toBe(false);
            drives.opacity = 3;
            frames(1);
            expect(b.state.alphaFactor).toBe(0.15);
            drives.opacity = 0;
            frames(1);
            expect(a.state).toEqual({ visible: true, alphaFactor: 1, opaque: true, writeDepth: true });
            expect(b.state.alphaFactor).toBe(1);
        });

        it('forgets an object removed while faded', () => {
            const { target, drives, frames } = setup();
            const a = renderObject(), b = renderObject();
            target.objects = [a, b];
            drives.opacity = 1;
            frames(1);
            target.objects = [a];
            drives.opacity = 0;
            frames(1);
            expect(a.state.alphaFactor).toBe(1);
            expect(b.state.alphaFactor).toBeCloseTo(0.6, 6);
            target.calls.length = 0;
            frames(1);
            expect(target.calls).toEqual([]);
        });
    });

    describe('clip', () => {
        it('moves a plane 50 Å along its normal per unit of drive and grows a sphere by the size drive', () => {
            const { target, drives, clip, frames } = setup();
            const ro = clipObject();
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 52, 3, 0, 0, 0]);
            expect(Array.from(ro.values.uClipObjectScale.ref.value)).toEqual([1, 1, 1, 2, 2, 2]);
            drives.clipPosition = 0;
            drives.clipSize = 0.5;
            clip.scale = 2;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
            expect(Array.from(ro.values.uClipObjectScale.ref.value)).toEqual([1, 1, 1, 4, 4, 4]);
        });

        it('puts the clip objects back once when its drives stop, then rests', () => {
            const { target, drives, clip, frames } = setup();
            const ro = clipObject();
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            drives.clipPosition = 0;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
            target.calls.length = 0;
            frames(5);
            expect(target.calls).toEqual([]);
        });

        it('puts back an object hidden while moved, so it shows at its base values at rest', () => {
            const { target, drives, clip, frames } = setup();
            const ro = clipObject();
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            ro.state.visible = false;
            drives.clipPosition = 0;
            frames(1);
            ro.state.visible = true;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
        });

        it('gives the clip objects their first values back when turned off', () => {
            const { target, drives, clip, channels, frames } = setup();
            const ro = clipObject();
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            clip.enabled = false;
            channels.setClipEnabled(false);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
        });

        it('after a frame that threw while writing back, writes the base values back on the next one', () => {
            const { target, drives, clip, channels, frames } = setup();
            const ro = clipObject();
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            drives.clipPosition = 0;
            const getRenderObjects = target.getRenderObjects;
            target.getRenderObjects = () => { throw new Error('lost context'); };
            expect(() => channels.update()).toThrow('lost context');
            target.getRenderObjects = getRenderObjects;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
        });

        it('skips hidden objects', () => {
            const { target, drives, clip, frames } = setup();
            const ro = clipObject();
            ro.state.visible = false;
            target.objects = [ro];
            clip.enabled = true;
            drives.clipPosition = 1;
            frames(1);
            expect(Array.from(ro.values.uClipObjectPosition.ref.value)).toEqual([1, 2, 3, 0, 0, 0]);
        });
    });

    describe('guards', () => {
        it('at rest (drives 0, clip on) makes no target call', () => {
            const { target, clip, frames } = setup();
            target.objects = [clipObject(), renderObject()];
            clip.enabled = true;
            frames(50, 16);
            expect(target.calls).toEqual([]);
        });

        it('after a frame that threw, reads the render objects again', () => {
            const { target, drives, clip, channels, frames } = setup();
            target.objects = [clipObject()];
            clip.enabled = true;
            drives.clipPosition = 1;
            drives.background = 1;
            target.setBackgroundColor = () => { throw new Error('lost context'); };
            expect(() => channels.update()).toThrow('lost context');
            // the next frame's list: a new object, which the clip pass must move
            const added = clipObject();
            target.objects = [added];
            frames(1);
            expect(Array.from(added.values.uClipObjectPosition.ref.value)).toEqual([1, 52, 3, 0, 0, 0]);
        });

        it('reads the render objects once a frame', () => {
            const { target, drives, clip, frames } = setup();
            target.objects = [clipObject(), renderObject()];
            clip.enabled = true;
            drives.clipPosition = 1;
            drives.opacity = 1;
            frames(3);
            expect(target.calls.filter(c => c === 'getRenderObjects').length).toBe(3);
        });

        /**
         * The clip and opacity passes at n and 4n render objects, counted in reads of a render object's `state` and
         * `values` and of the list's items (not wall time): linear grows 4x; the quadratic control, over the same
         * counter, grows 16x
         */
        it('scans render objects once a frame: n to 4n grows linearly, with a quadratic control', () => {
            const counter = { reads: 0 };
            const counted = (n: number) => {
                const out: CpuChannelRenderObject[] = [];
                for (let i = 0; i < n; i++) {
                    const ro = clipObject();
                    out.push({
                        get state() { counter.reads += 1; return ro.state; },
                        get values() { counter.reads += 1; return ro.values; },
                    });
                }
                // index reads of the list count too, so a lookup in it (includes, indexOf, find) inside the scan shows
                return new Proxy(out, {
                    get(list, key, receiver) {
                        if (typeof key === 'string' && /^\d+$/.test(key)) counter.reads += 1;
                        return Reflect.get(list, key, receiver);
                    },
                });
            };
            const readsPerFrame = (n: number) => {
                const { target, drives, clip, frames } = setup();
                target.objects = counted(n);
                clip.enabled = true;
                drives.clipPosition = 1;
                drives.opacity = 1;
                frames(2); // warm-up: the clip base states are captured, the objects faded
                counter.reads = 0;
                frames(1);
                return counter.reads;
            };
            const quadratic = (n: number) => {
                const objects = counted(n);
                counter.reads = 0;
                for (const a of objects) for (const b of objects) if (a.state.visible && b.state.visible) continue;
                return counter.reads;
            };
            const n = 50;
            const linear = readsPerFrame(4 * n) / readsPerFrame(n);
            const control = quadratic(4 * n) / quadratic(n);
            expect(linear).toBeGreaterThan(3);
            expect(linear).toBeLessThan(8);
            expect(control).toBeGreaterThan(12);
        });
    });
});
