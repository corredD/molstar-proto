/**
 * Copyright (c) 2020-2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { PluginContext } from './context';
import { now } from '../mol-util/now';
import { PluginAnimationManager } from '../mol-plugin-state/manager/animation';
import { isTimingMode } from '../mol-util/debug';
import { printTimerResults } from '../mol-gl/webgl/timer';
import { Vec3 } from '../mol-math/linear-algebra';
import { getSelectedStructureAssemblyAxis } from '../mol-plugin-state/helpers/assembly-symmetry-axis';

const MaxProperFrameDelta = 1000 / 30;

export class PluginAnimationLoop {
    private lastTickT: number = 0;
    // Proper time is used to prevent animations from skipping
    // if there is a blocking operation, e.g., shader compilation
    // The drawback of this is that sometimes the animation will take
    // longer than intended, but hopefully that's a reasonable tradeoff
    private properTimeT: number = 0;

    private currentFrame: number | undefined = undefined;
    private _isAnimating = false;

    get isAnimating() {
        return this._isAnimating;
    }

    async tick(t: number, options?: { isSynchronous?: boolean, manualDraw?: boolean, animation?: PluginAnimationManager.AnimationInfo, updateControls?: boolean, xrFrame?: XRFrame }) {
        await this.plugin.managers.animation.tick(t, options?.isSynchronous, options?.animation);
        const audioFrame = this.plugin.managers.audioReactive.tick(t);
        const assemblyAxis = getSelectedStructureAssemblyAxis(this.plugin, this.plugin.managers.audioReactive.state.params.value.assemblyAxisOrder) ?? Vec3.create(0, 0, 0);
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
            wiggleScale: this.plugin.managers.audioReactive.state.params.value.wiggleEffectScale,
            tumbleScale: this.plugin.managers.audioReactive.state.params.value.tumbleEffectScale,
            assemblyAxis,
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
