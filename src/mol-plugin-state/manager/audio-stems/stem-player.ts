/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Plays the separated stems (the worker's listening chunks) in time with the mix: each chunk is started on the audio
 * context's clock at its start plus the heard delay D, the moment the mix would play it, into a gain per stem. While a
 * stem is on the mix is muted, from the first chunk's start on (not from the click: with a long delay that would be
 * seconds of silence). The mix runs through a gain the caller owns; only its param is ours.
 */

import { StemSampleRate } from './dsp';
import { StemName, StemNames } from './stem-models';
import type { StemWorkerListen } from './stem-worker-protocol';

/** chunks that start within this of the last one's end are joined to it (a resampled sample at 48 kHz) */
const TileToleranceS = 0.002;
/** the mix's fade out, the stems' fades in and out, seconds */
const RampS = 0.005;

export class StemPlayer {
    private gains: Record<StemName, GainNode>;
    private on: Record<StemName, boolean> = { drums: false, bass: false, other: false, vocals: false };
    private nodes = new Set<AudioBufferSourceNode>();
    /** context time (not delayed) just after the last chunk (NaN: none since the last reset) */
    private nextTime = NaN;
    /** context time the first chunk since the last reset is heard (NaN: none yet) */
    private firstHeardAt = NaN;
    private mixed = false;

    /**
     * `mix`: the param of the gain the mix is heard through; `delaySeconds`: the heard delay now (a change resets the
     * separator, which resets this)
     */
    constructor(private context: AudioContext, destination: AudioNode, private mix: AudioParam, private delaySeconds: () => number) {
        this.gains = {} as Record<StemName, GainNode>;
        for (const s of StemNames) {
            const g = this.gains[s] = context.createGain();
            g.gain.value = 0;
            g.connect(destination);
        }
    }

    /** whether any stem is on */
    get listening() {
        return StemNames.some(s => this.on[s]);
    }

    /** the number of chunks' nodes scheduled or playing */
    get scheduled() {
        return this.nodes.size;
    }

    setStem(stem: StemName, on: boolean) {
        if (this.on[stem] === on) return;
        const wasListening = this.listening;
        this.on[stem] = on;
        const now = this.context.currentTime, p = this.gains[stem].gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(on ? 1 : 0, now + RampS);
        // every stem off: chunks still on their way are dropped and the mix is back at once
        if (wasListening && !this.listening) this.reset();
        else this.syncMix();
    }

    /** the mix muted from the first chunk's heard time while a stem is on, else at 1 */
    private syncMix() {
        const now = this.context.currentTime, p = this.mix;
        if (this.listening && Number.isFinite(this.firstHeardAt)) {
            if (this.mixed) return;
            this.mixed = true;
            p.cancelScheduledValues(now);
            if (this.firstHeardAt <= now) {
                p.setValueAtTime(0, now);
            } else {
                p.setValueAtTime(1, this.firstHeardAt);
                p.linearRampToValueAtTime(0, this.firstHeardAt + RampS);
            }
        } else if (this.mixed) {
            this.mixed = false;
            p.cancelScheduledValues(now);
            p.setValueAtTime(1, now);
        }
    }

    /** a chunk of the four stems from the worker (of the current epoch: the separator drops the others) */
    schedule(chunk: StemWorkerListen) {
        if (!this.listening) return;
        const n = chunk.samples.drums.length;
        if (n === 0) return;
        const ctx = this.context, now = ctx.currentTime;
        let time = chunk.time;
        if (Number.isFinite(this.nextTime) && Math.abs(time - this.nextTime) < TileToleranceS) time = this.nextTime;
        this.nextTime = time + n / StemSampleRate;
        const heardAt = time + this.delaySeconds(), duration = n / StemSampleRate;
        // a chunk entirely past (the model fell behind): silence, as the stretch it lost
        if (heardAt + duration <= now) return;
        const when = Math.max(now, heardAt), offset = when - heardAt;
        for (const s of StemNames) {
            const buffer = ctx.createBuffer(1, n, StemSampleRate);
            buffer.getChannelData(0).set(chunk.samples[s]);
            const node = ctx.createBufferSource();
            node.buffer = buffer;
            node.connect(this.gains[s]);
            node.onended = () => {
                node.disconnect();
                this.nodes.delete(node);
            };
            this.nodes.add(node);
            node.start(when, offset);
        }
        if (!Number.isFinite(this.firstHeardAt)) {
            this.firstHeardAt = when;
            this.syncMix();
        }
    }

    /** every scheduled chunk stopped, the mix back; the next chunk starts the mute again if a stem is on */
    reset() {
        for (const node of this.nodes) {
            node.onended = null;
            try { node.stop(); } catch { /* not started */ }
            node.disconnect();
        }
        this.nodes.clear();
        this.nextTime = NaN;
        this.firstHeardAt = NaN;
        this.syncMix();
    }

    dispose() {
        this.reset();
        for (const s of StemNames) this.gains[s].disconnect();
    }
}
