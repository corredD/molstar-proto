/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Web Worker entry of the stem separator: buffers the captured audio (resampled to 44.1 kHz) in a window of the
 * model's context, runs the model every chunk of new audio, and posts the stem energies of that chunk's frames with
 * the audio-context time of each. Bundled on its own (`stem-worker.js` next to the app).
 */

import * as ort from 'onnxruntime-web/webgpu';
import { LinearResampler, StemSampleRate } from './dsp';
import { createStemRunner, StemModelId, StemModels, StemNames, StemRunner } from './stem-models';
import type { StemWorkerRequest, StemWorkerResponse } from './stem-worker-protocol';

type WorkerScope = {
    postMessage(message: StemWorkerResponse, transfer?: Transferable[]): void,
    onmessage: ((e: MessageEvent<StemWorkerRequest>) => void) | null,
};
const scope = self as unknown as WorkerScope;

type GpuDeviceLike = { queue: { onSubmittedWorkDone(): Promise<void> } };

let runner: StemRunner | undefined;
let model: StemModelId | undefined;
let generation = 0;
let busy = false;

// the window: the last `windowSamples` samples at 44.1 kHz, zeros before the first audio
let left = new Float32Array(0);
let right = new Float32Array(0);
/** samples written since the last run */
let pending = 0;
/** audio-context time just after the window's last sample */
let windowEndTime = 0;
let expectedInputTime = -1;
let resamplers: [LinearResampler, LinearResampler] | undefined;
let inputSampleRate = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function yieldToRenderer() {
    const device = await (ort.env.webgpu as unknown as { device?: Promise<GpuDeviceLike> | GpuDeviceLike }).device;
    if (device) await device.queue.onSubmittedWorkDone();
    // about a frame between submissions, so the renderer gets the GPU in between
    await sleep(12);
}

function post(message: StemWorkerResponse, transfer?: Transferable[]) {
    scope.postMessage(message, transfer);
}

function resetWindow() {
    const n = model ? StemModels[model].windowSamples : 0;
    left = new Float32Array(n);
    right = new Float32Array(n);
    pending = 0;
    expectedInputTime = -1;
    resamplers?.forEach(r => r.reset());
}

function append(l: Float32Array, r: Float32Array) {
    const n = left.length;
    if (n === 0) return;
    const k = Math.min(l.length, n);
    left.copyWithin(0, k);
    right.copyWithin(0, k);
    left.set(l.subarray(l.length - k), n - k);
    right.set(r.subarray(r.length - k), n - k);
    pending = Math.min(n, pending + l.length);
}

async function load(id: StemModelId, baseUrls: string[], executionProvider: 'webgpu' | 'wasm', wasmPath: string) {
    const gen = ++generation;
    if (runner) {
        const old = runner;
        runner = undefined;
        await old.dispose();
    }
    model = id;
    resetWindow();
    ort.env.wasm.wasmPaths = wasmPath;
    ort.env.wasm.numThreads = 1; // no cross-origin isolation on the app's page
    ort.env.logLevel = 'error';
    const ep = executionProvider === 'webgpu' && !(navigator as { gpu?: unknown }).gpu ? 'wasm' : executionProvider;
    let lastError: unknown;
    for (const baseUrl of baseUrls) {
        post({ type: 'status', state: 'loading', model: id, message: `Loading ${StemModels[id].label} from ${baseUrl}` });
        try {
            const r = await createStemRunner(id, { ort, baseUrl, executionProvider: ep, yieldToRenderer });
            if (gen !== generation) {
                await r.dispose();
                return;
            }
            runner = r;
            post({ type: 'status', state: 'ready', model: id, message: `${StemModels[id].label} on ${ep}`, executionProvider: ep });
            return;
        } catch (e) {
            lastError = e;
        }
    }
    if (gen === generation) post({ type: 'status', state: 'error', model: id, message: `${lastError}` });
}

async function maybeRun() {
    if (busy || !runner || !model) return;
    const info = StemModels[model];
    if (pending < info.chunkSamples) return;
    busy = true;
    const gen = generation;
    const consumed = pending;
    pending = 0;
    const endTime = windowEndTime;
    const l = left.slice(), r = right.slice();
    const t0 = performance.now();
    try {
        const result = await runner.run(l, r);
        if (gen !== generation) return;
        const W = info.windowSamples;
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
        const computeMs = performance.now() - t0;
        post({ type: 'stems', model, times, energies, computeMs, audioMs: consumed / StemSampleRate * 1000 },
            [times.buffer, ...StemNames.map(s => energies[s].buffer)]);
    } catch (e) {
        post({ type: 'status', state: 'error', model, message: `${e}` });
    } finally {
        busy = false;
    }
    // audio may have piled up while the model ran
    void maybeRun();
}

// loads run one after another (onnxruntime's WebGPU backend creates one session at a time); a queued load that a
// newer request replaced is skipped
let loading = Promise.resolve();
let latestRequest = 0;

scope.onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
        case 'load': {
            const request = ++latestRequest;
            loading = loading.then(() => request === latestRequest
                ? load(msg.model, msg.baseUrls, msg.executionProvider, msg.wasmPath)
                : void 0);
            break;
        }
        case 'unload':
            latestRequest++;
            generation++;
            model = undefined;
            resetWindow();
            if (runner) {
                const old = runner;
                runner = undefined;
                void old.dispose();
            }
            break;
        case 'reset':
            resetWindow();
            break;
        case 'audio': {
            if (!model) return;
            if (msg.sampleRate !== inputSampleRate || !resamplers) {
                inputSampleRate = msg.sampleRate;
                const ratio = msg.sampleRate / StemSampleRate;
                resamplers = [new LinearResampler(ratio), new LinearResampler(ratio)];
            }
            // a gap (a suspended context, a seek) starts the window again
            if (expectedInputTime >= 0 && Math.abs(msg.time - expectedInputTime) > 0.25) resetWindow();
            expectedInputTime = msg.time + msg.left.length / msg.sampleRate;
            append(resamplers[0].process(msg.left), resamplers[1].process(msg.right));
            windowEndTime = expectedInputTime;
            void maybeRun();
            break;
        }
    }
};
