/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Web Worker entry of the stem separator: wires the worker's logic (stem-worker-core.ts) to onnxruntime-web and the
 * worker's messages. Bundled on its own (`stem-worker.js` next to the app).
 */

import * as ort from 'onnxruntime-web/webgpu';
import { createStemRunner } from './stem-models';
import { StemWorkerCore } from './stem-worker-core';
import type { StemWorkerRequest, StemWorkerResponse } from './stem-worker-protocol';

type WorkerScope = {
    postMessage(message: StemWorkerResponse, transfer?: Transferable[]): void,
    onmessage: ((e: MessageEvent<StemWorkerRequest>) => void) | null,
};
const scope = self as unknown as WorkerScope;

type GpuDeviceLike = { queue: { onSubmittedWorkDone(): Promise<void> } };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function yieldToRenderer() {
    const device = await (ort.env.webgpu as unknown as { device?: Promise<GpuDeviceLike> | GpuDeviceLike }).device;
    if (device) await device.queue.onSubmittedWorkDone();
    // about a frame between submissions, so the renderer gets the GPU in between
    await sleep(12);
}

const core = new StemWorkerCore({
    post: (message, transfer) => scope.postMessage(message, transfer),
    prepare(wasmPath, executionProvider) {
        ort.env.wasm.wasmPaths = wasmPath;
        ort.env.wasm.numThreads = 1; // no cross-origin isolation on the app's page
        ort.env.logLevel = 'error';
        return executionProvider === 'webgpu' && !(navigator as { gpu?: unknown }).gpu ? 'wasm' : executionProvider;
    },
    createRunner: (id, baseUrl, executionProvider) => createStemRunner(id, { ort, baseUrl, executionProvider, yieldToRenderer }),
    now: () => performance.now(),
});

scope.onmessage = (e) => core.handle(e.data);
