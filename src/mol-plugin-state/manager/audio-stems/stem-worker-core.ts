/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * The stem worker's logic, apart from its runtime: buffers the captured audio (resampled to 44.1 kHz) in a window of the
 * model's context, runs the model every chunk of new audio, and posts the stem energies of that chunk's frames with the
 * audio-context time of each, and the stem events found in the separated drums and bass (EventHoldBackS behind the
 * window's end: their detector looks that far ahead). `stem-worker.ts` wires it to onnxruntime-web and the worker's
 * messages.
 */

import { LinearResampler, StemSampleRate } from './dsp';
import { EventContextS, EventHoldBackS, StemEventDetector } from './stem-events';
import { StemModelId, StemModels, StemNames, StemRunner } from './stem-models';
import type { StemWorkerEvents, StemWorkerRequest, StemWorkerResponse } from './stem-worker-protocol';

export type StemExecutionProvider = 'webgpu' | 'wasm';

export type StemWorkerPorts = {
    post(message: StemWorkerResponse, transfer?: Transferable[]): void,
    /** sets the runtime up for a load; the provider it can run (wasm when WebGPU was asked for and there is no GPU) */
    prepare(wasmPath: string, executionProvider: StemExecutionProvider): StemExecutionProvider,
    createRunner(id: StemModelId, baseUrl: string, executionProvider: StemExecutionProvider): Promise<StemRunner>,
    /** milliseconds, for the compute time of a run */
    now(): number,
};

export class StemWorkerCore {
    private runner?: StemRunner;
    private model?: StemModelId;
    private generation = 0;
    private busy = false;
    /**
     * the model run in flight, settled either way: a runner is disposed only after it, since releasing the sessions of
     * a running model breaks onnxruntime's wasm runtime (a model switch mid-run, stem study 2026-11-27)
     */
    private inflight: Promise<void> = Promise.resolve();

    // the window: the last `windowSamples` samples at 44.1 kHz, zeros before the first audio
    private left = new Float32Array(0);
    private right = new Float32Array(0);
    /** samples written since the last run */
    private pending = 0;
    /** audio-context time just after the window's last sample */
    private windowEndTime = 0;
    private expectedInputTime = -1;
    private resamplers?: [LinearResampler, LinearResampler];
    private inputSampleRate = 0;
    /** samples written since the window started (its absolute clock: the stem events' frames sit on its hop grid) */
    private totalSamples = 0;
    /** bumped when the window starts again: a run that straddles it posts no events */
    private windowEpoch = 0;
    private events?: StemEventDetector;

    // loads run one after another (onnxruntime's WebGPU backend creates one session at a time); a queued load that a
    // newer request replaced is skipped
    private loading = Promise.resolve();
    private latestRequest = 0;

    constructor(private ports: StemWorkerPorts) { }

    handle(msg: StemWorkerRequest) {
        switch (msg.type) {
            case 'load': {
                const request = ++this.latestRequest;
                this.loading = this.loading.then(() => request === this.latestRequest
                    ? this.load(msg.model, msg.baseUrls, msg.executionProvider, msg.wasmPath)
                    : void 0);
                break;
            }
            case 'unload':
                this.latestRequest++;
                this.generation++;
                this.model = undefined;
                this.events = undefined;
                this.resetWindow();
                if (this.runner) {
                    const old = this.runner;
                    this.runner = undefined;
                    void this.inflight.then(() => old.dispose());
                }
                break;
            case 'reset':
                this.resetWindow();
                break;
            case 'audio': {
                if (!this.model) return;
                if (msg.sampleRate !== this.inputSampleRate || !this.resamplers) {
                    this.inputSampleRate = msg.sampleRate;
                    const ratio = msg.sampleRate / StemSampleRate;
                    this.resamplers = [new LinearResampler(ratio), new LinearResampler(ratio)];
                }
                // a gap (a suspended context, a seek) starts the window again
                if (this.expectedInputTime >= 0 && Math.abs(msg.time - this.expectedInputTime) > 0.25) this.resetWindow();
                this.expectedInputTime = msg.time + msg.left.length / msg.sampleRate;
                this.append(this.resamplers[0].process(msg.left), this.resamplers[1].process(msg.right));
                this.windowEndTime = this.expectedInputTime;
                void this.maybeRun();
                break;
            }
        }
    }

    private resetWindow() {
        const n = this.model ? StemModels[this.model].windowSamples : 0;
        this.left = new Float32Array(n);
        this.right = new Float32Array(n);
        this.pending = 0;
        this.expectedInputTime = -1;
        this.resamplers?.forEach(r => r.reset());
        this.totalSamples = 0;
        this.windowEpoch++;
        this.events?.reset();
    }

    private append(l: Float32Array, r: Float32Array) {
        const n = this.left.length;
        if (n === 0) return;
        const k = Math.min(l.length, n);
        this.left.copyWithin(0, k);
        this.right.copyWithin(0, k);
        this.left.set(l.subarray(l.length - k), n - k);
        this.right.set(r.subarray(r.length - k), n - k);
        this.pending = Math.min(n, this.pending + l.length);
        this.totalSamples += l.length;
    }

    private async load(id: StemModelId, baseUrls: string[], executionProvider: StemExecutionProvider, wasmPath: string) {
        const gen = ++this.generation;
        if (this.runner) {
            const old = this.runner;
            this.runner = undefined;
            await this.inflight;
            await old.dispose();
        }
        this.model = id;
        if (this.events?.windowSamples !== StemModels[id].windowSamples) this.events = new StemEventDetector(StemModels[id].windowSamples);
        this.resetWindow();
        const ep = this.ports.prepare(wasmPath, executionProvider);
        let lastError: unknown;
        for (const baseUrl of baseUrls) {
            this.ports.post({ type: 'status', state: 'loading', model: id, message: `Loading ${StemModels[id].label} from ${baseUrl}` });
            try {
                const r = await this.ports.createRunner(id, baseUrl, ep);
                if (gen !== this.generation) {
                    await r.dispose();
                    return;
                }
                this.runner = r;
                this.ports.post({ type: 'status', state: 'ready', model: id, message: `${StemModels[id].label} on ${ep}`, executionProvider: ep });
                return;
            } catch (e) {
                lastError = e;
            }
        }
        if (gen === this.generation) this.ports.post({ type: 'status', state: 'error', model: id, message: `${lastError}` });
    }

    private async maybeRun() {
        if (this.busy || !this.runner || !this.model) return;
        const info = StemModels[this.model];
        if (this.pending < info.chunkSamples) return;
        this.busy = true;
        const gen = this.generation;
        const model = this.model;
        const consumed = this.pending;
        this.pending = 0;
        const endTime = this.windowEndTime;
        const total = this.totalSamples, epoch = this.windowEpoch;
        const W = info.windowSamples;
        // the events of the peaks in [W - consumed, W) less the hold-back, from frames of the context before them on
        const holdBack = Math.round(EventHoldBackS * StemSampleRate);
        const eventsFrom = Math.max(0, W - consumed - holdBack), eventsTo = W - holdBack;
        const audioFrom = Math.max(0, eventsFrom - Math.round(EventContextS * StemSampleRate));
        const l = this.left.slice(), r = this.right.slice();
        const t0 = this.ports.now();
        try {
            const run = this.runner.run(l, r, audioFrom);
            this.inflight = run.then(() => { }, () => { });
            const result = await run;
            if (gen !== this.generation) return;
            let events: StemWorkerEvents | undefined;
            const audio = result.audio;
            if (audio?.drums && audio.bass && this.events && epoch === this.windowEpoch) {
                const absStart = total - W;
                const batch = this.events.run(audio.drums, audio.bass, absStart, eventsFrom, eventsTo, audioFrom);
                const times = new Float64Array(batch.count);
                for (let i = 0; i < batch.count; i++) times[i] = endTime - (W - (batch.at[i] - absStart)) / StemSampleRate;
                events = {
                    from: endTime - (W - eventsFrom) / StemSampleRate,
                    until: endTime - (W - eventsTo) / StemSampleRate,
                    times, dbfs: batch.dbfs.slice(0, batch.count), kinds: batch.kinds.slice(0, batch.count),
                };
            }
            const from = W - consumed;
            const keep: number[] = [];
            for (let i = 0; i < result.centers.length; i++) {
                const c = result.centers[i];
                if (c >= from && c < W) keep.push(i);
            }
            const times = new Float64Array(keep.length);
            const energies = {} as Record<typeof StemNames[number], Float32Array>;
            for (const s of StemNames) energies[s] = new Float32Array(keep.length);
            keep.forEach((i, j) => {
                times[j] = endTime - (W - result.centers[i]) / StemSampleRate;
                for (const s of StemNames) energies[s][j] = result.energies[s][i];
            });
            const computeMs = this.ports.now() - t0;
            const transfer: Transferable[] = [times.buffer, ...StemNames.map(s => energies[s].buffer)];
            if (events) transfer.push(events.times.buffer, events.dbfs.buffer, events.kinds.buffer);
            this.ports.post({ type: 'stems', model, times, energies, computeMs, audioMs: consumed / StemSampleRate * 1000, events }, transfer);
        } catch (e) {
            // a run cancelled by a newer load or Off says nothing; an error is its own model's, never the next one's
            if (gen === this.generation) this.ports.post({ type: 'status', state: 'error', model, message: `${e}` });
        } finally {
            this.busy = false;
        }
        // audio may have piled up while the model ran
        void this.maybeRun();
    }
}
