/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StemModelId, StemModels, StemNames, StemRunResult } from '../stem-models';
import { StemWorkerCore } from '../stem-worker-core';
import type { StemWorkerRequest, StemWorkerResponse } from '../stem-worker-protocol';

type Deferred = { promise: Promise<StemRunResult>, resolve(r: StemRunResult): void, reject(e: unknown): void };
function deferred(): Deferred {
    let resolve!: (r: StemRunResult) => void, reject!: (e: unknown) => void;
    const promise = new Promise<StemRunResult>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** a runner whose runs finish when the test says, and which notes a dispose while one runs */
function fakeRunner() {
    const runs: Deferred[] = [];
    const state = { running: 0, disposed: false, disposedWhileRunning: false };
    const runner = {
        run() {
            const d = deferred();
            runs.push(d);
            state.running++;
            return d.promise.finally(() => { state.running--; });
        },
        async dispose() {
            if (state.running > 0) state.disposedWhileRunning = true;
            state.disposed = true;
        },
    };
    return { runner, runs, state };
}

/** one frame at the newest sample of the window */
function result(model: StemModelId): StemRunResult {
    const W = StemModels[model].windowSamples;
    return { centers: Float64Array.from([W - 1]), energies: Object.fromEntries(StemNames.map(s => [s, Float32Array.from([1])])) as StemRunResult['energies'] };
}

function setup() {
    const posted: StemWorkerResponse[] = [];
    const runners = new Map<StemModelId, ReturnType<typeof fakeRunner>>();
    const core = new StemWorkerCore({
        post: m => posted.push(m),
        prepare: (_, ep) => ep,
        createRunner: async id => {
            const f = fakeRunner();
            runners.set(id, f);
            return f.runner;
        },
        now: () => 0,
    });
    const load = (model: StemModelId): StemWorkerRequest => ({ type: 'load', model, baseUrls: ['local/'], executionProvider: 'wasm', wasmPath: '' });
    let time = 0;
    /** one chunk of the model's audio, 44.1 kHz, in the tap's 4096-sample blocks: enough for a run */
    const feedChunk = (model: StemModelId) => {
        const block = 4096;
        for (let i = 0; i < StemModels[model].chunkSamples; i += block) {
            core.handle({ type: 'audio', left: new Float32Array(block), right: new Float32Array(block), sampleRate: 44100, time });
            time += block / 44100;
        }
    };
    return { core, posted, runners, load, feedChunk };
}

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const errors = (posted: StemWorkerResponse[]) => posted.filter(m => m.type === 'status' && m.state === 'error');

describe('stem worker core', () => {
    it('runs the model once a chunk of audio has come and posts its frames', async () => {
        const { core, posted, runners, load, feedChunk } = setup();
        core.handle(load('spleeter'));
        await flush();
        feedChunk('spleeter');
        await flush();
        const a = runners.get('spleeter')!;
        expect(a.runs.length).toBe(1);
        a.runs[0].resolve(result('spleeter'));
        await flush();
        expect(posted.filter(m => m.type === 'stems').map(m => m.model)).toEqual(['spleeter']);
    });

    it('a model switch waits for the run in flight before it disposes the old model', async () => {
        const { core, posted, runners, load, feedChunk } = setup();
        core.handle(load('spleeter'));
        await flush();
        feedChunk('spleeter');
        await flush();
        const a = runners.get('spleeter')!;
        expect(a.runs.length).toBe(1);

        core.handle(load('scnet'));
        await flush();
        expect(a.state.disposed).toBe(false);

        a.runs[0].resolve(result('spleeter'));
        await flush();
        expect(a.state.disposed).toBe(true);
        expect(a.state.disposedWhileRunning).toBe(false);
        expect(runners.has('scnet')).toBe(true);
        // the old model's frames are dropped
        expect(posted.filter(m => m.type === 'stems')).toEqual([]);
    });

    it('a run that fails after a switch reports nothing, and never under the new model', async () => {
        const { core, posted, runners, load, feedChunk } = setup();
        core.handle(load('htdemucs'));
        await flush();
        feedChunk('htdemucs');
        await flush();
        core.handle(load('scnet'));
        await flush();
        runners.get('htdemucs')!.runs[0].reject(new Error('RuntimeError: null function'));
        await flush();
        expect(errors(posted)).toEqual([]);
        expect(runners.get('htdemucs')!.state.disposedWhileRunning).toBe(false);
    });

    it('Off waits for the run in flight before it disposes the model', async () => {
        const { core, runners, load, feedChunk } = setup();
        core.handle(load('spleeter'));
        await flush();
        feedChunk('spleeter');
        await flush();
        const a = runners.get('spleeter')!;
        core.handle({ type: 'unload' });
        await flush();
        expect(a.state.disposed).toBe(false);
        a.runs[0].resolve(result('spleeter'));
        await flush();
        expect(a.state.disposed).toBe(true);
        expect(a.state.disposedWhileRunning).toBe(false);
    });

    it('an error of the model that runs is reported under its name', async () => {
        const { core, posted, runners, load, feedChunk } = setup();
        core.handle(load('spleeter'));
        await flush();
        feedChunk('spleeter');
        await flush();
        runners.get('spleeter')!.runs[0].reject(new Error('OrtRun failed'));
        await flush();
        expect(errors(posted).map(m => m.model)).toEqual(['spleeter']);
    });
});
