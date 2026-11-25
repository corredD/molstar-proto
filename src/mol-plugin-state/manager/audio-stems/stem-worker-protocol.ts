/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Messages between the stem separator and its worker.
 */

import type { StemEnergies, StemModelId } from './stem-models';

export type StemWorkerRequest =
    | { type: 'load', model: StemModelId, baseUrls: string[], executionProvider: 'webgpu' | 'wasm', wasmPath: string }
    | { type: 'unload' }
    | { type: 'reset' }
    /** captured audio at the context's rate; `time`: the audio-context time of its first sample */
    | { type: 'audio', left: Float32Array, right: Float32Array, sampleRate: number, time: number };

export type StemWorkerResponse =
    | { type: 'status', state: 'loading' | 'ready' | 'error', model: StemModelId, message?: string, executionProvider?: 'webgpu' | 'wasm' }
    /** one run's frames: the audio-context time of each frame's centre and each stem's energy there */
    | { type: 'stems', model: StemModelId, times: Float64Array, energies: StemEnergies, computeMs: number, audioMs: number };
