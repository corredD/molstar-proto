/**
 * Copyright (c) 2020-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PluginContext } from './context';
import { now } from '../mol-util/now';
import { PluginAnimationManager } from '../mol-plugin-state/manager/animation';
import { isTimingMode } from '../mol-util/debug';
import { printTimerResults } from '../mol-gl/webgl/timer';
import { Vec3 } from '../mol-math/linear-algebra';
import { syncAudioAffect } from '../mol-plugin-state/helpers/audio-affect';
import { AudioScopeKinds } from '../mol-plugin-state/manager/audio-routing';
import { syncStructureAssemblyAxes } from '../mol-plugin-state/helpers/assembly-symmetry-axis';

const MaxProperFrameDelta = 1000 / 30;

/** how bright the illumination channel's glow gets at a drive of 1 (added to the emissive) */
const IlluminationGlow = 0.35;
/** how far the colour-spectrum channel turns the hues at a drive of 1, in turns */
const HueTurnPerDrive = 0.25;

export class PluginAnimationLoop {
    private lastTickT: number = 0;
    // Proper time is used to prevent animations from skipping
    // if there is a blocking operation, e.g., shader compilation
    // The drawback of this is that sometimes the animation will take
    // longer than intended, but hopefully that's a reasonable tradeoff
    private properTimeT: number = 0;

    private currentFrame: number | undefined = undefined;
    private _isAnimating = false;

    private readonly scopeDrives = new Array<number>(8).fill(0);

    /** the narrowed routes' drives, the illumination and hue ones scaled as their uniforms are */
    private scaleScopeDrives() {
        const audio = this.plugin.managers.audioReactive;
        for (let i = 0; i < this.scopeDrives.length; i++) {
            const drive = audio.scopeDrive[i] ?? 0;
            const kind = audio.scopeKind[i] ?? 0;
            this.scopeDrives[i] = kind === AudioScopeKinds.illumination ? drive * IlluminationGlow
                : kind === AudioScopeKinds.colorSpectrum ? Math.min(1, drive * HueTurnPerDrive)
                    : drive;
        }
        return this.scopeDrives;
    }

    get isAnimating() {
        return this._isAnimating;
    }

    async tick(t: number, options?: { isSynchronous?: boolean, manualDraw?: boolean, animation?: PluginAnimationManager.AnimationInfo, updateControls?: boolean, xrFrame?: XRFrame }) {
        await this.plugin.managers.animation.tick(t, options?.isSynchronous, options?.animation);
        const audioFrame = this.plugin.managers.audioReactive.tick(t);
        const audioParams = this.plugin.managers.audioReactive.state.params.value;
        const stems = this.plugin.managers.audioReactive.stems;
        // each structure's objects get their own structure's symmetry axes
        syncStructureAssemblyAxes(this.plugin, audioParams.assemblyAxisOrder);
        syncAudioAffect(this.plugin);
        // the audio routing: each visual channel's drive (symmetry axes, instances, atoms, object, illumination)
        const drives = this.plugin.managers.audioReactive.drives;
        const assemblyAxisAmplitudeScale = audioParams.assemblyAxisAmplitudeScale;
        // LOD motion scale: when enabled, amplify all motion proportionally to camera distance
        // so animations remain visible when zoomed out of a large scene.
        let lodMotionScale = 1.0;
        if (audioParams.lodScaleEnabled) {
            const canvas3d = this.plugin.canvas3d;
            const sphere = canvas3d?.boundingSphereVisible;
            const camera = canvas3d?.camera;
            if (sphere && camera && sphere.radius > 0) {
                const camDist = Vec3.distance(camera.position, sphere.center);
                lodMotionScale = Math.max(camDist / sphere.radius, 1.0);
            }
        }
        this.plugin.canvas3d?.setAudioFrame({
            amplitude: audioFrame.amplitude,
            peakAmplitude: audioFrame.peakAmplitude,
            beatIntensity: audioFrame.beatIntensity,
            dominantFrequency: audioFrame.dominantFrequencyNormalized,
            mix: audioFrame.mix,
            subBass: audioFrame.frequencyBands.subBass,
            bass: audioFrame.frequencyBands.bass,
            lowMids: audioFrame.frequencyBands.lowMids,
            mids: audioFrame.frequencyBands.mids,
            highMids: audioFrame.frequencyBands.highMids,
            treble: audioFrame.frequencyBands.treble,
            wiggleScale: audioParams.wiggleEffectScale,
            tumbleScale: audioParams.tumbleEffectScale,
            objectTransformScale: audioParams.objectTransformEffectScale,
            assemblyAxisAmplitudeScale,
            lodMotionScale,
            stemDrums: stems.drums,
            stemBass: stems.bass,
            stemOther: stems.other,
            stemVocals: stems.vocals,
            driveSymAxis: drives.symAxis,
            driveInstanceRandom: drives.instanceRandom,
            driveInstanceAxis: drives.instanceAxis,
            driveInstanceNormal: drives.instanceNormal,
            driveInstanceWave: drives.instanceWave,
            driveWiggle: drives.wiggle,
            driveObject: drives.object,
            illumination: drives.illumination * IlluminationGlow,
            hue: Math.min(1, drives.colorSpectrum * HueTurnPerDrive),
            scopeCount: this.plugin.managers.audioReactive.scopeCount,
            scopeKind: this.plugin.managers.audioReactive.scopeKind,
            scopeDrive: this.scaleScopeDrives(),
        });
        this.plugin.canvas3d?.tick(t as now.Timestamp, options);

        if (isTimingMode) {
            const timerResults = this.plugin.canvas3d?.webgl.timer.resolve();
            if (timerResults) {
                for (const result of timerResults) {
                    printTimerResults([result]);
                }
            }
        }
    }

    private frame = (_timestamp?: number, xrFrame?: XRFrame) => {
        const t = now();
        const dt = t - this.lastTickT;
        this.lastTickT = t;
        this.properTimeT += Math.min(dt, MaxProperFrameDelta);
        this.tick(this.properTimeT, { xrFrame });
        if (this._isAnimating) {
            this.currentFrame = this.plugin.canvas3d?.requestAnimationFrame(this.frame);
        }
    };

    resetTime(t: number) {
        this.plugin.canvas3d?.resetTime(t);
    }

    start(options?: { immediate?: boolean }) {
        this.plugin.canvas3d?.resume();
        this._isAnimating = true;
        this.resetTime(0);
        this.properTimeT = 0;
        this.lastTickT = now();
        if (options?.immediate) this.frame();
        else this.currentFrame = this.plugin.canvas3d?.requestAnimationFrame(this.frame);
    }

    stop(options?: { noDraw?: boolean }) {
        this._isAnimating = false;
        if (this.currentFrame !== undefined) {
            this.plugin.canvas3d?.cancelAnimationFrame(this.currentFrame);
            this.currentFrame = undefined;
        }
        if (options?.noDraw) {
            this.plugin.canvas3d?.pause(options?.noDraw);
        }
    }

    constructor(private plugin: PluginContext) {

    }
}
