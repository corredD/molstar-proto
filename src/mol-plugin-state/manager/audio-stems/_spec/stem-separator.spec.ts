/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StemEventValues } from '../../audio-routing';
import { StemSeparator } from '../stem-separator';

const Names = ['drums', 'bass', 'other', 'vocals'];

describe('stem separator', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
        it(`keeps its levels finite after one worker energy of ${bad}`, () => {
            // the constructor only stores its arguments: no audio context needed
            const sep: any = new StemSeparator({} as any, {} as any, {} as any, () => { });
            sep.model = 'htdemucs';
            const post = (times: number[], e: (s: string, i: number) => number) => sep.onWorkerMessage({
                type: 'stems', model: 'htdemucs', times: Float64Array.from(times), computeMs: 1, audioMs: 1,
                energies: Object.fromEntries(Names.map(s => [s, Float32Array.from(times.map((_, i) => e(s, i)))])),
            });
            post([0, 0.1, 0.2], (s, i) => s === 'bass' && i === 1 ? bad : 0.01);
            post([0.3, 0.4, 0.5, 0.6, 0.7], () => 0.01);
            for (const t of [0.05, 0.35, 0.65]) {
                for (const v of Object.values(sep.sample(t, 16, 20, 180) as Record<string, number>)) expect(Number.isFinite(v)).toBe(true);
            }
            // after the bad frame left the interpolation, the quiet stems are not stuck at 0
            const levels = sep.sample(0.65, 16, 20, 180) as Record<string, number>;
            expect(levels.drums).toBeGreaterThan(0);
        });
    }

    describe('setModel edges', () => {
        const saved: any = {};
        let workers: { messages: any[] }[];
        let taps: { messages: any[] }[];

        beforeEach(() => {
            workers = [];
            taps = [];
            for (const k of ['Worker', 'AudioWorkletNode', 'Blob']) saved[k] = (globalThis as any)[k];
            saved.createObjectURL = URL.createObjectURL;
            saved.revokeObjectURL = URL.revokeObjectURL;
            (globalThis as any).Worker = class {
                messages: any[] = [];
                constructor() { workers.push(this); }
                postMessage(m: any) { this.messages.push(m); }
            };
            (globalThis as any).AudioWorkletNode = class {
                messages: any[] = [];
                port = { onmessage: null as any, postMessage: (m: any) => this.messages.push(m) };
                constructor() { taps.push(this); }
                connect() { }
            };
            (globalThis as any).Blob = class { };
            URL.createObjectURL = () => 'blob:fake';
            URL.revokeObjectURL = () => { };
        });
        afterEach(() => {
            for (const k of ['Worker', 'AudioWorkletNode', 'Blob']) (globalThis as any)[k] = saved[k];
            URL.createObjectURL = saved.createObjectURL;
            URL.revokeObjectURL = saved.revokeObjectURL;
        });

        function make() {
            const modules: { resolve: () => void, reject: (e: any) => void }[] = [];
            const context: any = {
                audioWorklet: { addModule: () => new Promise<void>((resolve, reject) => modules.push({ resolve, reject })) },
                createGain: () => ({ gain: { value: 1 }, connect() { } }),
                destination: {},
            };
            const source: any = { connect() { } };
            const statuses: string[] = [];
            const sep = new StemSeparator(context, source, { workerUrl: 'w.js', wasmPath: '', localBaseUrls: [] }, s => statuses.push(s.state));
            return { sep, modules, statuses };
        }
        const types = () => workers[0].messages.map(m => m.type);
        const flush = () => new Promise(r => setTimeout(r, 0));

        it('Off while the tap loads: no load after the unload, the tap stays off', async () => {
            const { sep, modules } = make();
            const p1 = sep.setModel('htdemucs', 'wasm');
            await flush();
            await sep.setModel(undefined, 'wasm');
            modules[0].resolve();
            await p1;
            expect(types()).toEqual(['unload']);
            expect(taps.every(t => !t.messages.some(m => m.on === true))).toBe(true);
        });

        it('another provider while the tap loads: only the last request loads', async () => {
            const { sep, modules } = make();
            const p1 = sep.setModel('htdemucs', 'webgpu');
            await flush();
            const p2 = sep.setModel('htdemucs', 'wasm');
            modules[0].resolve();
            await Promise.all([p1, p2]);
            const loads = workers[0].messages.filter(m => m.type === 'load');
            expect(loads.map(m => m.executionProvider)).toEqual(['wasm']);
        });

        it('null control: Off after the load completed still unloads and turns the tap off', async () => {
            const { sep, modules } = make();
            const p = sep.setModel('htdemucs', 'wasm');
            await flush();
            modules[0].resolve();
            await p;
            expect(types()).toEqual(['load']);
            expect(taps[0].messages).toEqual([{ on: true }]);
            await sep.setModel(undefined, 'wasm');
            expect(types()).toEqual(['load', 'unload']);
            expect(taps[0].messages).toEqual([{ on: true }, { on: false }]);
        });

        it('a failed tap setup retries when the model is picked again after Off', async () => {
            const { sep, modules, statuses } = make();
            const p1 = sep.setModel('htdemucs', 'wasm');
            await flush();
            modules[0].reject(new Error('no worklet'));
            await p1;
            expect(sep.currentStatus.state).toBe('error');
            await sep.setModel(undefined, 'wasm');
            statuses.length = 0;
            const p2 = sep.setModel('htdemucs', 'wasm');
            await flush();
            expect(modules.length).toBe(2);
            // the old code left the status at error: the retry shows as loading
            expect(sep.currentStatus.state).toBe('loading');
            modules[1].resolve();
            await p2;
            expect(types()).toEqual(['unload', 'load']);
        });

        it('request, Off, then the tap fails: the final status is off and no error is emitted', async () => {
            const { sep, modules, statuses } = make();
            const p1 = sep.setModel('htdemucs', 'wasm');
            await flush();
            await sep.setModel(undefined, 'wasm');
            modules[0].reject(new Error('no worklet'));
            await p1;
            expect(sep.currentStatus.state).toBe('off');
            expect(statuses).not.toContain('error');
        });

        it('the same request, Off, the same request again during the tap load: one load after the last unload, the tap on once', async () => {
            const { sep, modules } = make();
            const p1 = sep.setModel('htdemucs', 'wasm');
            await flush();
            await sep.setModel(undefined, 'wasm');
            const p2 = sep.setModel('htdemucs', 'wasm');
            await flush();
            modules[0].resolve();
            await Promise.all([p1, p2]);
            const t = types();
            expect(t.filter(x => x === 'load').length).toBe(1);
            expect(t.lastIndexOf('load')).toBeGreaterThan(t.lastIndexOf('unload'));
            expect(taps[0].messages.filter(m => m.on === true).length).toBe(1);
        });

        it('null control: the success path calls addModule once', async () => {
            const { sep, modules } = make();
            const p = sep.setModel('htdemucs', 'wasm');
            await flush();
            modules[0].resolve();
            await p;
            await sep.setModel(undefined, 'wasm');
            const p2 = sep.setModel('htdemucs', 'wasm');
            await p2;
            expect(modules.length).toBe(1);
            expect(taps.length).toBe(1);
        });
    });
});

describe('stem separator: stem events', () => {
    /** a separator with HTDemucs loaded (no worker, no tap: the constructor only stores its arguments) */
    function make() {
        const sep: any = new StemSeparator({} as any, {} as any, {} as any, () => { });
        sep.model = 'htdemucs';
        const post = (from: number, until: number, events: [time: number, dbfs: number, kind: number][]) => sep.onWorkerMessage({
            type: 'stems', model: 'htdemucs', times: new Float64Array(0), computeMs: 1, audioMs: 1,
            energies: Object.fromEntries(Names.map(s => [s, new Float32Array(0)])),
            events: {
                from, until,
                times: Float64Array.from(events.map(e => e[0])), dbfs: Float32Array.from(events.map(e => e[1])), kinds: Uint8Array.from(events.map(e => e[2])),
            },
        });
        const out: StemEventValues = { kick: 0, snare: 0, bassNote: 0, live: false };
        /** the frames from t0 by dt, each sampled: the kick value of each */
        const run = (t0: number, n: number, dt = 1 / 60) => {
            const kicks: number[] = [];
            for (let i = 0; i < n; i++) {
                sep.sampleEvents(t0 + i * dt, dt * 1000, out);
                kicks.push(out.kick);
            }
            return kicks;
        };
        return { sep: sep as StemSeparator & { model: unknown }, post, out, run };
    }

    it('an event fires on the first sample whose time reaches it, once; one on a boundary fires once', () => {
        const { post, run } = make();
        // 1.005 between two frames; 1.1 exactly on a frame (1 + 6 / 60)
        post(0, 5, [[1.005, -10, 0], [1 + 6 / 60, -10, 0]]);
        const kicks = run(1, 12);
        expect(kicks.map(v => v > 0 ? 1 : 0)).toEqual([0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    });

    it('a jump back or past 0.25 s fires nothing it skipped; a resume fires no backlog', () => {
        const { sep, post, out, run } = make();
        post(0, 9, [[1.2, -10, 0], [2.5, -10, 0], [4.0, -10, 0]]);
        run(1, 3);
        // a jump past 0.25 s: the kick at 1.2 is skipped, not fired late
        expect(run(1.5, 3).some(v => v > 0)).toBe(false);
        // a jump back: nothing it already passed fires again
        run(1.6, 1);
        expect(run(1.21, 1)[0]).toBe(0);
        // paused across the kick at 2.5 (frames that do not sample), then resumed: no backlog
        run(2.3, 2);
        sep.skipEvents();
        sep.sampleEvents(2.7, 16, out);
        expect(out.kick).toBe(0);
        // the next kick still fires
        expect(run(3.9, 12).some(v => v > 0)).toBe(true);
    });

    it('reset, seek, model change and Off empty the events', async () => {
        for (const clear of [
            (sep: any) => sep.reset(), // a seek resets the separator too
            async (sep: any) => { sep.options = { localBaseUrls: [] }; sep.ensureWorker = () => { }; sep.ensureTap = async () => { }; await sep.setModel('scnet', 'wasm'); },
            async (sep: any) => { await sep.setModel(undefined, 'wasm'); },
        ]) {
            const { sep, post, out } = make();
            (sep as any).setStatus = () => { };
            post(0, 9, [[1.2, -10, 0]]);
            await clear(sep);
            (sep as any).model = 'htdemucs';
            sep.sampleEvents(1.19, 16, out);
            expect(sep.sampleEvents(1.21, 16, out)).toBe(false);
            expect(out.kick).toBe(0);
        }
    });

    it('an event dated past its run\'s end (its peak inside it) stays when the next run starts there', () => {
        const { post, run } = make();
        post(0, 5, [[5.02, -10, 0]]);
        post(5, 7, [[6, -10, 0]]);
        const kicks = run(4.99, 4);
        expect(kicks.some(v => v > 0)).toBe(true);
    });

    it('a frame past the coverage (the model just behind) uses up no event: it fires once the next run is in', () => {
        const { post, out, sep } = make();
        post(5, 10, [[9.995, -10, 0]]);
        const fired: number[] = [];
        sep.sampleEvents(9.99, 16, out); fired.push(out.kick);
        sep.sampleEvents(10.006, 16, out); fired.push(out.kick);
        post(10, 15, []);
        sep.sampleEvents(10.022, 16, out); fired.push(out.kick);
        expect(fired.filter(v => v > 0).length).toBe(1);
    });

    it('events of two runs whose dates cross (the last run\'s dated late, the next one\'s early) both fire, in time order', () => {
        const { post, out, sep } = make();
        post(0, 5, [[5.058, -10, 0]]);
        post(5, 7, [[5.050, -10, 0]]);
        const fired: number[] = [];
        for (const t of [5.045, 5.055, 5.065, 5.075]) { sep.sampleEvents(t, 10, out); fired.push(out.kick > 0 ? 1 : 0); }
        expect(fired).toEqual([0, 1, 1, 0]);
    });

    it('so does one when the next run starts a few µs early (a 48 kHz context: the resampler\'s rounding)', () => {
        const { post, run } = make();
        post(0, 5, [[5.02, -10, 0]]);
        post(5 - 5e-6, 7, [[6, -10, 0]]);
        expect(run(4.99, 4).some(v => v > 0)).toBe(true);
    });

    it('strength: at the loud level reads 1, 9 dB under reads 0.5, under the floor reads 0', () => {
        const { post, out, sep } = make();
        post(0, 9, [[1, -6, 0], [1.5, -15, 0], [2, -30, 0], [2.5, -50, 2]]);
        const at = (t: number) => { sep.sampleEvents(t - 0.01, 10, out); sep.sampleEvents(t, 10, out); return out; };
        expect(at(1).kick).toBeCloseTo(1, 5);
        // 0.6 dB/s of decay over 0.5 s: the loud level is -6.3
        expect(at(1.5).kick).toBeCloseTo((-15 + 6.3 + 18) / 18, 5);
        expect(at(2).kick).toBe(0);
        // the bass's own loud level: it starts at the floor (-30)
        expect(at(2.5).bassNote).toBe(0);
    });

    it('sampleEvents returns live only up to eventsUntil, and not without a model', () => {
        const { sep, post, out } = make();
        expect(sep.sampleEvents(0.5, 16, out)).toBe(false);
        post(0, 2, []);
        expect(sep.sampleEvents(1.9, 16, out)).toBe(true);
        expect(out.live).toBe(true);
        expect(sep.sampleEvents(2.1, 16, out)).toBe(false);
        expect(out.live).toBe(false);
        // before the coverage starts: not live (the first run after a clear covers from its from)
        expect(sep.sampleEvents(-0.1, 16, out)).toBe(false);
        (sep as any).model = undefined;
        expect(sep.sampleEvents(1.5, 16, out)).toBe(false);
    });
});
