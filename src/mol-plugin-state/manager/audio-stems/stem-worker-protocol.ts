/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Messages between the stem separator and its worker.
 */

import type { StemEnergies, StemModelId, StemName } from './stem-models';

export type StemWorkerRequest =
    /** `epoch`: the separator's, echoed on the runs after it (a run posted before a reset or a load is dropped) */
    | { type: 'load', model: StemModelId, baseUrls: string[], executionProvider: 'webgpu' | 'wasm', wasmPath: string, epoch?: number }
    | { type: 'unload' }
    | { type: 'reset', epoch?: number }
    /** whether any stem is being listened to: each run then also returns the four stems' audio (StemWorkerListen) */
    | { type: 'listen', on: boolean }
    /** captured audio at the context's rate; `time`: the audio-context time of its first sample */
    | { type: 'audio', left: Float32Array, right: Float32Array, sampleRate: number, time: number };

export type StemWorkerResponse =
    | { type: 'status', state: 'loading' | 'ready' | 'error', model: StemModelId, message?: string, executionProvider?: 'webgpu' | 'wasm' }
    /**
     * one run's frames: the audio-context time of each frame's centre and each stem's energy there; with `events`, the
     * stem events of [from, until) (audio-context seconds; `kinds` indexes StemEventKinds, each kind in time order);
     * `epoch`: the last load's or reset's when the run started
     */
    | { type: 'stems', model: StemModelId, times: Float64Array, energies: StemEnergies, computeMs: number, audioMs: number, epoch: number, events?: StemWorkerEvents, listen?: StemWorkerListen };

/**
 * The four stems' audio of the samples one run consumed (less the events' hold-back): 44.1 kHz mono, `time` the
 * audio-context time of the first sample (the clock of `times`). The runs' regions tile by sample
 */
export type StemWorkerListen = { time: number, samples: Record<StemName, Float32Array> };

export type StemWorkerEvents = { from: number, until: number, times: Float64Array, dbfs: Float32Array, kinds: Uint8Array };
