/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Splits the playing audio into stems (drums, bass, other, vocals) with a separation model in a worker, for the
 * visuals only. The audio is tapped before the delay the listener hears it through; a stem's level at the time being
 * heard is read from the timeline the worker fills, ahead by at least the model's latency.
 */

import { StemModelId, StemModels, StemName, StemNames } from './stem-models';
import type { StemWorkerRequest, StemWorkerResponse } from './stem-worker-protocol';

export type StemLevels = Record<StemName, number>;

export type StemSeparatorStatus = {
    model?: StemModelId,
    state: 'off' | 'loading' | 'warming' | 'running' | 'error',
    message?: string,
    executionProvider?: 'webgpu' | 'wasm',
    /** the last run's compute time over the audio it covered: below 1 keeps up */
    loadFactor?: number,
    /** seconds of audio separated ahead of what is heard (negative: behind) */
    headroom?: number,
};

export type StemSeparatorOptions = {
    workerUrl: string,
    wasmPath: string,
    /** base URLs to try, in order, before the model's remote one; each gets `<model id>/` appended */
    localBaseUrls: string[],
};

const TapProcessorSource = `
class StemTap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.size = 4096;
        this.l = new Float32Array(this.size);
        this.r = new Float32Array(this.size);
        this.n = 0;
        this.t0 = 0;
        this.on = false;
        this.port.onmessage = (e) => { this.on = !!e.data.on; this.n = 0; };
    }
    process(inputs) {
        const input = inputs[0];
        if (!this.on || !input || input.length === 0) return true;
        const left = input[0], right = input[1] || input[0];
        if (this.n === 0) this.t0 = currentTime;
        this.l.set(left, this.n);
        this.r.set(right, this.n);
        this.n += left.length;
        if (this.n >= this.size) {
            this.port.postMessage({ left: this.l, right: this.r, time: this.t0, sampleRate }, [this.l.buffer, this.r.buffer]);
            this.l = new Float32Array(this.size);
            this.r = new Float32Array(this.size);
            this.n = 0;
        }
        return true;
    }
}
registerProcessor('molstar-stem-tap', StemTap);
`;

/** How long the timeline is kept, seconds */
const TimelineSeconds = 90;
/** the mix's running peak falls this fast, dB per second */
const PeakDecayDbPerSecond = 0.6;
/** how long a stem's recent average remembers, seconds: short for the drums, so each hit stands out */
const DrumsAverageSeconds = 0.35;
const StemAverageSeconds = 1.5;
/** a stem at its recent average reads this far up the range: (dB - average + floor) / range, squared */
const ExcitationFloorDb = 3;
const ExcitationRangeDb = 10;
/** a stem this far under the mix's peak counts as absent */
const SilentBelowMixDb = 30;
/** the drums keep their hits: instant attack, a short release, whatever the band smoothing */
const DrumsReleaseMs = 160;

function applyAttackRelease(previous: number, target: number, dtMs: number, attackMs: number, releaseMs: number) {
    if (dtMs <= 0) return target;
    const tc = target >= previous ? attackMs : releaseMs;
    if (tc <= 0) return target;
    return previous + (target - previous) * (1 - Math.exp(-dtMs / tc));
}

export class StemSeparator {
    private worker?: Worker;
    private tap?: AudioWorkletNode;
    private tapSink?: GainNode;
    private tapLoading?: Promise<void>;
    private model?: StemModelId;
    private requestedExecutionProvider?: 'webgpu' | 'wasm';
    private status: StemSeparatorStatus = { state: 'off' };

    // the timeline: frame times (audio-context seconds) and each stem's energy, in time order
    private times: number[] = [];
    private energies: Record<StemName, number[]> = { drums: [], bass: [], other: [], vocals: [] };

    private averages: Record<StemName, number> = { drums: -120, bass: -120, other: -120, vocals: -120 };
    private mixPeak = -120;
    private levels: StemLevels = { drums: 0, bass: 0, other: 0, vocals: 0 };
    private lastSampleTime = -1;

    constructor(private context: AudioContext, private source: AudioNode, private options: StemSeparatorOptions, private onStatus: (s: StemSeparatorStatus) => void) { }

    get currentStatus() {
        return this.status;
    }

    private setStatus(status: Partial<StemSeparatorStatus>) {
        this.status = { ...this.status, ...status };
        this.onStatus(this.status);
    }

    private post(message: StemWorkerRequest, transfer?: Transferable[]) {
        this.worker?.postMessage(message, transfer ?? []);
    }

    private ensureWorker() {
        if (this.worker) return this.worker;
        const worker = new Worker(this.options.workerUrl, { type: 'module' });
        worker.onmessage = (e: MessageEvent<StemWorkerResponse>) => this.onWorkerMessage(e.data);
        worker.onerror = (e) => this.setStatus({ state: 'error', message: `Stem worker failed: ${e.message}` });
        this.worker = worker;
        return worker;
    }

    private async ensureTap() {
        if (this.tap) return;
        if (!this.tapLoading) {
            this.tapLoading = (async () => {
                const url = URL.createObjectURL(new Blob([TapProcessorSource], { type: 'text/javascript' }));
                try {
                    await this.context.audioWorklet.addModule(url);
                } finally {
                    URL.revokeObjectURL(url);
                }
                const tap = new AudioWorkletNode(this.context, 'molstar-stem-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
                tap.port.onmessage = (e: MessageEvent<{ left: Float32Array, right: Float32Array, time: number, sampleRate: number }>) => {
                    const { left, right, time, sampleRate } = e.data;
                    this.post({ type: 'audio', left, right, time, sampleRate }, [left.buffer, right.buffer]);
                };
                // pulled by the graph through a silent sink
                const sink = this.context.createGain();
                sink.gain.value = 0;
                this.source.connect(tap);
                tap.connect(sink);
                sink.connect(this.context.destination);
                this.tap = tap;
                this.tapSink = sink;
            })();
        }
        await this.tapLoading;
    }

    async setModel(id: StemModelId | undefined, executionProvider: 'webgpu' | 'wasm') {
        // the same request again (any params change calls this): no reload, and no retry of a failed one either; picking
        // the model again after Off retries it
        if (id === this.model && executionProvider === this.requestedExecutionProvider) return;
        this.model = id;
        this.requestedExecutionProvider = executionProvider;
        this.clearTimeline();
        if (!id) {
            this.tap?.port.postMessage({ on: false });
            this.post({ type: 'unload' });
            this.setStatus({ model: undefined, state: 'off', message: undefined, loadFactor: undefined, headroom: undefined });
            return;
        }
        this.setStatus({ model: id, state: 'loading', message: `Loading ${StemModels[id].label}`, loadFactor: undefined, headroom: undefined });
        try {
            this.ensureWorker();
            await this.ensureTap();
        } catch (e) {
            this.setStatus({ state: 'error', message: `${e}` });
            return;
        }
        const baseUrls = [...this.options.localBaseUrls.map(u => `${u}${id}/`), StemModels[id].remoteBaseUrl];
        this.post({ type: 'load', model: id, baseUrls, executionProvider, wasmPath: this.options.wasmPath });
        this.tap?.port.postMessage({ on: true });
    }

    /** forget the separated audio (a new source, a seek) */
    reset() {
        this.clearTimeline();
        this.post({ type: 'reset' });
    }

    private clearTimeline() {
        this.times = [];
        for (const s of StemNames) this.energies[s] = [];
        this.lastSampleTime = -1;
        for (const s of StemNames) {
            this.averages[s] = -120;
            this.levels[s] = 0;
        }
        this.mixPeak = -120;
    }

    private onWorkerMessage(msg: StemWorkerResponse) {
        if (msg.model !== this.model) return;
        if (msg.type === 'status') {
            if (msg.state === 'ready') this.setStatus({ state: 'warming', message: msg.message, executionProvider: msg.executionProvider });
            else this.setStatus({ state: msg.state, message: msg.message });
            return;
        }
        // frames may overlap the timeline's end when a run covered more than one chunk: keep the newer
        const first = msg.times.length ? msg.times[0] : Infinity;
        while (this.times.length && this.times[this.times.length - 1] >= first) {
            this.times.pop();
            for (const s of StemNames) this.energies[s].pop();
        }
        for (let i = 0; i < msg.times.length; i++) {
            this.times.push(msg.times[i]);
            for (const s of StemNames) this.energies[s].push(msg.energies[s][i]);
        }
        const oldest = (msg.times[msg.times.length - 1] ?? 0) - TimelineSeconds;
        let drop = 0;
        while (drop < this.times.length && this.times[drop] < oldest) drop++;
        if (drop > 0) {
            this.times.splice(0, drop);
            for (const s of StemNames) this.energies[s].splice(0, drop);
        }
        this.setStatus({
            state: 'running',
            loadFactor: msg.audioMs > 0 ? msg.computeMs / msg.audioMs : undefined,
        });
    }

    /** the latest time the timeline reaches */
    get coveredUntil() {
        return this.times.length ? this.times[this.times.length - 1] : -Infinity;
    }

    /**
     * Each stem's level (0-1) at audio-context time `time`, smoothed; undefined where the timeline does not reach it
     * (still loading, or the model falling behind)
     */
    sample(time: number, dtMs: number, attackMs: number, releaseMs: number): StemLevels | undefined {
        const n = this.times.length;
        if (!this.model || n < 2 || time < this.times[0] || time > this.times[n - 1]) {
            if (this.model && n > 0) this.status.headroom = this.times[n - 1] - time;
            return undefined;
        }
        this.status.headroom = this.times[n - 1] - time;
        // binary search for the frame at or before `time`
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.times[mid] <= time) lo = mid; else hi = mid;
        }
        const t = (time - this.times[lo]) / Math.max(1e-6, this.times[hi] - this.times[lo]);
        const dtSec = this.lastSampleTime >= 0 ? Math.max(0, time - this.lastSampleTime) : 0;
        this.lastSampleTime = time;

        const db: Record<StemName, number> = { drums: 0, bass: 0, other: 0, vocals: 0 };
        let mix = 0;
        for (const s of StemNames) {
            const e = this.energies[s][lo] * (1 - t) + this.energies[s][hi] * t;
            mix += e;
            db[s] = 10 * Math.log10(e + 1e-12);
        }
        const mixDb = 10 * Math.log10(mix + 1e-12);
        this.mixPeak = Math.max(mixDb, this.mixPeak - PeakDecayDbPerSecond * dtSec);
        for (const s of StemNames) {
            // how far a stem stands above its own recent average: music sits near its peak, so a level against the
            // peak stays high and steady; against the recent average a drum hit, a bass note, a sung phrase stand out
            const memory = s === 'drums' ? DrumsAverageSeconds : StemAverageSeconds;
            if (this.averages[s] <= -119) this.averages[s] = db[s];
            else this.averages[s] += (db[s] - this.averages[s]) * (1 - Math.exp(-dtSec / memory));
            const excitation = Math.min(1, Math.max(0, (db[s] - this.averages[s] + ExcitationFloorDb) / ExcitationRangeDb));
            // a stem far under the mix (no singer, no bass line) stays still
            const presence = Math.min(1, Math.max(0, (db[s] - (this.mixPeak - SilentBelowMixDb)) / 6));
            const target = excitation * excitation * presence;
            this.levels[s] = s === 'drums'
                ? applyAttackRelease(this.levels[s], target, dtMs, 0, DrumsReleaseMs)
                : applyAttackRelease(this.levels[s], target, dtMs, attackMs, releaseMs);
        }
        return { ...this.levels };
    }

    dispose() {
        this.tap?.port.postMessage({ on: false });
        this.tap?.disconnect();
        this.tapSink?.disconnect();
        this.worker?.terminate();
        this.worker = undefined;
    }
}
