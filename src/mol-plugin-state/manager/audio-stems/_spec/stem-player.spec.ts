/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { StemNames } from '../stem-models';
import { StemPlayer } from '../stem-player';
import type { StemWorkerListen } from '../stem-worker-protocol';

class FakeParam {
    value = 0;
    events: [string, number, number][] = [];
    cancelScheduledValues(t: number) { this.events = this.events.filter(e => e[1] < t); }
    setValueAtTime(v: number, t: number) { this.events.push(['set', t, v]); }
    linearRampToValueAtTime(v: number, t: number) { this.events.push(['ramp', t, v]); }
    /** the value at time t, from the events */
    at(t: number, initial = 1) {
        let v = initial;
        for (const [k, et, ev] of this.events) if (et <= t) v = ev; else if (k === 'ramp') break;
        return v;
    }
}
class FakeNode { connected: unknown[] = []; connect(n: unknown) { this.connected.push(n); } disconnect() { this.connected = []; } }
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeSource extends FakeNode {
    buffer?: { data: Float32Array };
    onended: (() => void) | null = null;
    started?: { when: number, offset: number };
    stopped = false;
    start(when: number, offset: number) { this.started = { when, offset }; }
    stop() { this.stopped = true; }
}
function fakeContext() {
    const sources: FakeSource[] = [];
    const gains: FakeGain[] = [];
    const ctx = {
        currentTime: 0,
        createGain() { const g = new FakeGain(); gains.push(g); return g; },
        createBuffer(_c: number, n: number, rate: number) { const data = new Float32Array(n); return { length: n, sampleRate: rate, getChannelData: () => data, data }; },
        createBufferSource() { const s = new FakeSource(); sources.push(s); return s; },
    };
    return { ctx, sources, gains };
}

const SR = 44100;
function chunk(time: number, seconds: number, fill = 0.5): StemWorkerListen {
    const n = Math.round(seconds * SR);
    return { time, samples: Object.fromEntries(StemNames.map(s => [s, new Float32Array(n).fill(fill)])) as StemWorkerListen['samples'] };
}

function setup(delay = 10) {
    const f = fakeContext();
    const mix = new FakeParam();
    mix.value = 1;
    let d = delay;
    const player = new StemPlayer(f.ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode, mix as unknown as AudioParam, () => d);
    return { ...f, mix, player, setDelay: (v: number) => { d = v; } };
}

describe('stem player', () => {
    it('starts each chunk at its start + D on the context clock, one node per stem', () => {
        const { player, sources, ctx } = setup(10);
        ctx.currentTime = 3;
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        expect(sources.length).toBe(4);
        for (const s of sources) expect(s.started).toEqual({ when: 15, offset: 0 });
        expect(sources[0].buffer!.data.length).toBe(2 * SR);
    });

    it('chunks that tile are joined to the last one\'s end, to the sample', () => {
        const { player, sources } = setup(10);
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        // a 48 kHz context: the next chunk's start is a resampled sample off
        player.schedule(chunk(7 + 0.0005, 2));
        expect(sources[4].started!.when).toBeCloseTo(17, 12);
        // a gap bigger than the tolerance is kept
        player.schedule(chunk(9.5, 1));
        expect(sources[8].started!.when).toBeCloseTo(19.5, 12);
    });

    it('a late chunk starts now with an offset; one entirely past is dropped (a lost stretch is silence)', () => {
        const { player, sources, ctx } = setup(10);
        player.setStem('drums', true);
        ctx.currentTime = 16;
        player.schedule(chunk(5, 2));
        expect(sources[0].started!.when).toBe(16);
        expect(sources[0].started!.offset).toBeCloseTo(1, 12);
        const n = sources.length;
        player.schedule(chunk(2, 2));
        expect(sources.length).toBe(n);
    });

    it('a chunk with no stem on is not scheduled', () => {
        const { player, sources } = setup();
        player.schedule(chunk(5, 2));
        expect(sources.length).toBe(0);
    });

    it('reset stops and disconnects every node; the next chunk schedules afresh', () => {
        const { player, sources } = setup();
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        player.reset();
        expect(sources.every(s => s.stopped && s.connected.length === 0)).toBe(true);
        expect(player.scheduled).toBe(0);
        player.schedule(chunk(100, 1));
        expect(sources.length).toBe(8);
    });

    it('a node that ended is removed', () => {
        const { player, sources } = setup();
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        expect(player.scheduled).toBe(4);
        sources.forEach(s => s.onended!());
        expect(player.scheduled).toBe(0);
    });

    it('the mix stays up at the click and goes to 0 when the first chunk plays; back at 1 at once when all are off', () => {
        const { player, mix, ctx } = setup(10);
        ctx.currentTime = 3;
        player.setStem('drums', true);
        // the first chunk comes later: the mix still plays meanwhile
        expect(mix.at(3.1)).toBe(1);
        ctx.currentTime = 4;
        player.schedule(chunk(5, 2));
        expect(mix.at(14.9)).toBe(1);
        expect(mix.at(15.01)).toBe(0);
        expect(mix.at(40)).toBe(0);
        ctx.currentTime = 20;
        player.setStem('drums', false);
        expect(mix.at(20)).toBe(1);
        expect(mix.at(21)).toBe(1);
    });

    it('a first chunk that is already late mutes the mix now', () => {
        const { player, mix, ctx } = setup(10);
        player.setStem('bass', true);
        ctx.currentTime = 16;
        player.schedule(chunk(5, 2));
        expect(mix.at(16)).toBe(0);
    });

    it('stems are switched by their gain; adding one while another is on does not mute again or reset', () => {
        const { player, gains, sources, mix, ctx } = setup(10);
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        const n = sources.length, events = mix.events.length;
        ctx.currentTime = 16;
        player.setStem('bass', true);
        expect(sources.length).toBe(n);
        expect(mix.events.length).toBe(events);
        // StemNames order: drums, bass, other, vocals
        expect(gains[1].gain.events.some(e => e[0] === 'ramp' && e[2] === 1)).toBe(true);
        expect(gains[0].gain.events.some(e => e[0] === 'ramp' && e[2] === 0)).toBe(false);
        player.setStem('drums', false);
        expect(player.listening).toBe(true);
        expect(player.scheduled).toBe(n);
    });

    it('turning all off stops the nodes; a chunk that arrives after is not scheduled', () => {
        const { player, sources } = setup();
        player.setStem('drums', true);
        player.schedule(chunk(5, 2));
        player.setStem('drums', false);
        expect(sources.every(s => s.stopped)).toBe(true);
        const n = sources.length;
        player.schedule(chunk(7, 2));
        expect(sources.length).toBe(n);
    });
});
