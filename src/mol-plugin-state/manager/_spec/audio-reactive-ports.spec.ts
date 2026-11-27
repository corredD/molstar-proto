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
            createGain: () => ({ gain: { value: 1 }, connect() { }, disconnect() { } }),
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
    it('stop, a new source and clear flush both delay lines (heard, analysed): the source -> delay links alone are cut, new delays (same times) go in their place', async () => {
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
        let delays = 0, sink: (Node & { gain: { value: number } }) | undefined;
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
            createGain: () => (sink = node('sink', { gain: { value: 1 } }) as Node & { gain: { value: number } }),
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
        // what is heard: source -> delay -> speakers; what is analysed: source -> analysis delay -> analyser -> silent sink
        expect(log).toEqual(['source->delay1', 'delay1->destination', 'source->delay2', 'delay2->analyser', 'analyser->sink', 'sink->destination']);
        // the analysis branch reaches the speakers only through a silent sink: else it is heard the lead ahead (a pre-echo)
        expect(sink!.gain.value).toBe(0);
        const flushed = (heard: number, analysed: number) => [
            `source-x-delay${heard}`, `delay${heard}-x-all`, `source->delay${analysed + 1}`, `delay${analysed + 1}->destination`,
            `source-x-delay${analysed}`, `delay${analysed}-x-all`, `source->delay${analysed + 2}`, `delay${analysed + 2}->analyser`,
        ];
        delayNodes[0].delayTime.value = 6;
        delayNodes[1].delayTime.value = 5.9;

        log.length = 0;
        manager.stop();
        expect(log).toEqual(flushed(1, 2));
        expect([delayNodes[2].delayTime.value, delayNodes[3].delayTime.value]).toEqual([6, 5.9]);

        log.length = 0;
        // a new source (loadUrl): the element already has its metadata
        const g = globalThis as unknown as { HTMLMediaElement?: unknown };
        const hadMediaElement = 'HTMLMediaElement' in g, mediaElement = g.HTMLMediaElement;
        g.HTMLMediaElement = { HAVE_METADATA: 1 };
        (audio as unknown as { readyState: number }).readyState = 4;
        (audio as unknown as { addEventListener(): void }).addEventListener = () => { };
        try {
            await manager.loadUrl('fake://next');
        } finally {
            if (hadMediaElement) g.HTMLMediaElement = mediaElement; else delete g.HTMLMediaElement;
        }
        // flushed first (the same times), then the stem params set the delays again (no model, no lookahead: 0)
        expect(log.slice(0, 8)).toEqual(flushed(3, 4));
        delayNodes[4].delayTime.value = 6;
        delayNodes[5].delayTime.value = 5.9;

        log.length = 0;
        manager.clear();
        expect(log).toEqual(flushed(5, 6));
        expect([delayNodes[6].delayTime.value, delayNodes[7].delayTime.value]).toEqual([6, 5.9]);
        manager.dispose();
    });
});
