/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioOutputClock } from '../audio-presented-frame';
import { AudioReactiveAnimationManager, AudioReactivePorts } from '../audio-reactive-animation';

/** the ports seam: the manager makes its context and reads its clock only through the ports it is given */
describe('AudioReactiveAnimationManager ports', () => {
    it('play() makes the context through createContext; tick reads the clock the outputClock port gives for it', async () => {
        let level = 0;
        const analyser = {
            fftSize: 2048, smoothingTimeConstant: 0,
            get frequencyBinCount() { return this.fftSize / 2; },
            connect() { }, disconnect() { },
            getFloatTimeDomainData(out: Float32Array) { for (let i = 0; i < out.length; i++) out[i] = i % 2 ? level : -level; },
            getByteFrequencyData(out: Uint8Array) { out.fill(0); },
        };
        const ctx = {
            sampleRate: 48_000, currentTime: 0, state: 'running', destination: {},
            createAnalyser: () => analyser,
            createMediaElementSource: () => ({ connect() { }, disconnect() { } }),
            createDelay: () => ({ delayTime: { value: 0, setValueAtTime() { } }, connect() { }, disconnect() { } }),
            resume: async () => { }, close: async () => { },
        };
        const frameS = 0.016, k = 3;
        let now = 0;
        const clock: AudioOutputClock = { now: () => now, latency: () => (k + 0.5) * frameS };
        const made: unknown[] = [], clocked: unknown[] = [];
        const ports: AudioReactivePorts = {
            createContext: () => { made.push(ctx); return ctx as unknown as AudioContext; },
            outputClock: c => { clocked.push(c); return clock; },
        };
        const audio = {
            src: 'fake://song', paused: true, ended: false, currentTime: 0,
            play: async () => { audio.paused = false; }, pause: () => { audio.paused = true; }, removeAttribute() { }, load() { },
        };

        const manager = new AudioReactiveAnimationManager({} as ConstructorParameters<typeof AudioReactiveAnimationManager>[0], ports);
        manager.state.audioPlayer.next(audio as unknown as HTMLAudioElement);
        await manager.play();
        expect(made).toEqual([ctx]);

        const live: number[] = [], heard: number[] = [];
        for (let i = 0; i < 40; i++) {
            now = (i + 1) * frameS;
            level = 0.1 * (i % 5);
            manager.tick(now * 1000);
            live.push((manager as unknown as { currentFrame: { amplitude: number } }).currentFrame.amplitude);
            heard.push(manager.frame.amplitude);
        }
        expect(clocked).toEqual([ctx]); // one clock per context, resolved once
        expect(heard.slice(k + 1)).toEqual(live.slice(0, live.length - k - 1)); // (k + 0.5) frames late: k + 1 entries
        expect(live.some((a, i) => a !== heard[i])).toBe(true);
        expect(manager.state.status.value.heardPlaying).toBe(true);
        manager.dispose();
    });
    it('stop and clear flush the delay line: the source -> delay link alone is cut, a new delay (same time) goes in its place', async () => {
        const log: string[] = [];
        type Node = { name: string, connect(n: Node): void, disconnect(n?: Node): void };
        const node = (name: string, extra: object = {}): Node => ({
            name, ...extra,
            connect(n: Node) { log.push(`${name}->${n.name}`); },
            disconnect(n?: Node) { log.push(n ? `${name}-x-${n.name}` : `${name}-x-all`); },
        });
        const analyser = node('analyser', {
            fftSize: 2048, smoothingTimeConstant: 0, get frequencyBinCount() { return 1024; },
            getFloatTimeDomainData() { }, getByteFrequencyData() { },
        });
        let delays = 0;
        const delayNodes: (Node & { delayTime: { value: number } })[] = [];
        const ctx = {
            sampleRate: 48_000, currentTime: 0, state: 'running', destination: node('destination'),
            createAnalyser: () => analyser,
            createMediaElementSource: () => node('source'),
            createDelay: () => {
                const d = node(`delay${++delays}`, { delayTime: { value: 0, setValueAtTime(v: number) { this.value = v; } } }) as Node & { delayTime: { value: number } };
                delayNodes.push(d);
                return d;
            },
            resume: async () => { }, close: async () => { },
        };
        const ports: AudioReactivePorts = { createContext: () => ctx as unknown as AudioContext, outputClock: () => ({ now: () => 0, latency: () => 0 }) };
        const audio = {
            src: 'fake://song', paused: true, ended: false, currentTime: 0,
            play: async () => { audio.paused = false; }, pause: () => { audio.paused = true; }, removeAttribute() { }, load() { },
        };
        const manager = new AudioReactiveAnimationManager({} as ConstructorParameters<typeof AudioReactiveAnimationManager>[0], ports);
        manager.state.audioPlayer.next(audio as unknown as HTMLAudioElement);
        await manager.play();
        expect(log).toEqual(['source->delay1', 'delay1->analyser', 'analyser->destination']);
        delayNodes[0].delayTime.value = 6;

        log.length = 0;
        manager.stop();
        expect(log).toEqual(['source-x-delay1', 'delay1-x-all', 'source->delay2', 'delay2->analyser']);
        expect(delayNodes[1].delayTime.value).toBe(6);

        log.length = 0;
        manager.clear();
        expect(log).toEqual(['source-x-delay2', 'delay2-x-all', 'source->delay3', 'delay3->analyser']);
        expect(delayNodes[2].delayTime.value).toBe(6);
        manager.dispose();
    });
});
