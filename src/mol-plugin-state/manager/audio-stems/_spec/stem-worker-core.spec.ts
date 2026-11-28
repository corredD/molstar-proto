/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { mulberry32 } from '../../_spec/audio-pipeline-helper';
import { StemEventDetector, StemEventKinds } from '../stem-events';
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

/**
 * drums on the left, bass on the right (an identity separation reads them back): kicks every 0.5 s and hats between,
 * bass notes every second, their loudness drawn at random
 */
function drumsAndBass(seconds: number) {
    const SR = 44100, n = Math.round(seconds * SR);
    const drums = new Float64Array(n), bass = new Float64Array(n);
    const rnd = mulberry32(5);
    for (let t0 = 0.5; t0 < seconds - 0.2; t0 += 0.5) {
        const amp = 0.3 + 0.7 * rnd(), s0 = Math.round(t0 * SR);
        for (let i = 0; i < Math.round(0.12 * SR); i++) {
            const t = i / SR;
            drums[s0 + i] += amp * Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * (50 * t + 1.5 * (1 - Math.exp(-t / 0.03))));
        }
        const h0 = Math.round((t0 + 0.25) * SR), hat = 0.05 + 0.2 * rnd();
        let prev = 0;
        for (let i = 0; i < Math.round(0.02 * SR) && h0 + i < n; i++) {
            const w = rnd() * 2 - 1;
            drums[h0 + i] += hat * Math.exp(-i / SR / 0.006) * (w - prev);
            prev = w;
        }
    }
    for (let t0 = 0.75, k = 0; t0 < seconds - 1; t0 += 1, k++) {
        const f = [55, 82, 65, 73][k % 4], amp = 0.2 + 0.3 * rnd(), s0 = Math.round(t0 * SR);
        for (let i = 0; i < Math.round(0.9 * SR); i++) {
            const t = i / SR;
            // faded out: a cut note's click is a marginal event, one a run's own p95 may read otherwise than the song's
            bass[s0 + i] += amp * Math.min(1, t / 0.005, (0.9 - t) / 0.1) * Math.exp(-t / 0.6) * Math.sin(2 * Math.PI * f * t);
        }
    }
    return { drums: Float32Array.from(drums), bass: Float32Array.from(bass) };
}

/** every event of the whole signal in one run, [time s, dBFS, kind] */
function wholeEvents(drums: Float32Array, bass: Float32Array) {
    const pad = 4096, W = drums.length + 2 * pad;
    const d = new Float32Array(W), b = new Float32Array(W);
    d.set(drums, pad);
    b.set(bass, pad);
    const batch = new StemEventDetector(W).run(d, b, -pad, 0, W);
    const out: [number, number, number][] = [];
    for (let i = 0; i < batch.count; i++) out.push([batch.at[i] / 44100, batch.dbfs[i], batch.kinds[i]]);
    return out;
}

type Events = NonNullable<Extract<StemWorkerResponse, { type: 'stems' }>['events']>;

/** a model that separates nothing: drums are the left channel, bass the right */
function identitySetup(model: StemModelId) {
    const posted: StemWorkerResponse[] = [];
    const audioFroms: number[] = [];
    const core = new StemWorkerCore({
        post: m => posted.push(m),
        prepare: (_, ep) => ep,
        createRunner: async () => ({
            async run(left: Float32Array, right: Float32Array, audioFrom?: number) {
                audioFroms.push(audioFrom ?? 0);
                return { ...result(model), audio: { drums: left.slice(), bass: right.slice() } };
            },
            async dispose() { },
        }),
        now: () => 0,
    });
    let time = 0, at = 0;
    const block = 4096;
    /** `samples` more of the signal, in the tap's blocks; flushed after each block unless `pileUp` */
    const feed = async (sig: { drums: Float32Array, bass: Float32Array }, samples: number, pileUp = false) => {
        for (const end = at + samples; at + block <= end; at += block) {
            core.handle({ type: 'audio', left: sig.drums.slice(at, at + block), right: sig.bass.slice(at, at + block), sampleRate: 44100, time });
            time += block / 44100;
            if (!pileUp) await flush();
        }
        await flush();
    };
    const restart = () => { time = 0; at = 0; };
    const events = () => {
        const out: [number, number, number][] = [];
        const batches: Events[] = [];
        for (const m of posted) {
            if (m.type !== 'stems' || !m.events) continue;
            batches.push(m.events);
            for (let i = 0; i < m.events.times.length; i++) out.push([m.events.times[i], m.events.dbfs[i], m.events.kinds[i]]);
        }
        return { out, batches };
    };
    return { core, posted, feed, events, restart, audioFroms };
}

/** the events of kind k inside [t0, t1) */
const within = (ev: [number, number, number][], k: number, t0: number, t1: number) => ev.filter(e => e[2] === k && e[0] >= t0 && e[0] < t1);

function expectSameEvents(got: [number, number, number][], want: [number, number, number][], t0: number, t1: number) {
    for (let k = 0; k < StemEventKinds.length; k++) {
        const g = within(got, k, t0, t1), w = within(want, k, t0, t1);
        expect(g.length).toBe(w.length);
        w.forEach((e, i) => {
            expect(Math.abs(g[i][0] - e[0])).toBeLessThan(1e-6);
            expect(Math.abs(g[i][1] - e[1])).toBeLessThan(0.01);
        });
    }
}

describe('stem worker core: stem events', () => {
    for (const model of ['htdemucs', 'spleeter', 'scnet'] as const) {
        it(`chunk seams: 24 s run by run (${model}: its window and chunk) gives the whole signal's events exactly`, async () => {
            const sig = drumsAndBass(24);
            const { core, feed, events, audioFroms } = identitySetup(model);
            core.handle({ type: 'load', model, baseUrls: ['local/'], executionProvider: 'wasm', wasmPath: '' });
            await flush();
            await feed(sig, sig.drums.length);
            const { out, batches } = events();
            expect(batches.length).toBeGreaterThan(2);
            // each run's region starts where the last one's ended: no gap, no overlap
            for (let i = 1; i < batches.length; i++) expect(Math.abs(batches[i].from - batches[i - 1].until)).toBeLessThan(1e-9);
            // the context before the region: at most EventContextS of the window
            const W = StemModels[model].windowSamples;
            for (const a of audioFroms) expect(a).toBeGreaterThanOrEqual(0);
            expect(Math.max(...audioFroms)).toBeLessThan(W);
            expectSameEvents(out, wholeEvents(sig.drums, sig.bass), batches[0].from + 0.3, batches[batches.length - 1].until);
        });
    }

    it('a pile-up run (consumed > chunk) repeats no event and loses none inside its context', async () => {
        const sig = drumsAndBass(24);
        const { core, feed, events } = identitySetup('htdemucs');
        core.handle({ type: 'load', model: 'htdemucs', baseUrls: ['local/'], executionProvider: 'wasm', wasmPath: '' });
        await flush();
        const C = StemModels.htdemucs.chunkSamples;
        await feed(sig, 2 * C);
        // 1.4 chunks arrive while nothing runs the model (fed without a flush): the next run covers them all
        await feed(sig, 1.4 * C, true);
        await feed(sig, sig.drums.length - 3.4 * C - 4096);
        const { out, batches } = events();
        expect(batches.some(b => b.until - b.from > 1.3 * C / 44100)).toBe(true);
        expectSameEvents(out, wholeEvents(sig.drums, sig.bass), batches[0].from + 0.3, batches[batches.length - 1].until);
    });

    it('reset clears the carried gap and the counter', async () => {
        const sig = drumsAndBass(14);
        const a = identitySetup('htdemucs');
        a.core.handle({ type: 'load', model: 'htdemucs', baseUrls: ['local/'], executionProvider: 'wasm', wasmPath: '' });
        await flush();
        await a.feed(sig, 9 * 44100);
        a.core.handle({ type: 'reset' });
        a.posted.length = 0;
        a.restart();
        await a.feed(sig, sig.drums.length);

        const b = identitySetup('htdemucs');
        b.core.handle({ type: 'load', model: 'htdemucs', baseUrls: ['local/'], executionProvider: 'wasm', wasmPath: '' });
        await flush();
        await b.feed(sig, sig.drums.length);
        expect(a.events().out.length).toBeGreaterThan(10);
        expect(a.events().out).toEqual(b.events().out);
    });

    it('a runner result without audio posts no events', async () => {
        const { core, posted, runners, load, feedChunk } = setup();
        core.handle(load('htdemucs'));
        await flush();
        feedChunk('htdemucs');
        await flush();
        runners.get('htdemucs')!.runs[0].resolve(result('htdemucs'));
        await flush();
        const stems = posted.filter(m => m.type === 'stems');
        expect(stems.length).toBe(1);
        expect(stems[0].type === 'stems' && stems[0].events).toBeUndefined();
    });
});
