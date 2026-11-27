/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

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
            expect(statuses).toContain('loading');
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
