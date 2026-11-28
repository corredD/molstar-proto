/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Splits the playing audio into stems (drums, bass, other, vocals) with a separation model in a worker, for the
 * visuals only. The audio is tapped before the delay the listener hears it through; a stem's level at the time being
 * heard is read from the timeline the worker fills, ahead by at least the model's latency. The stem events (kicks,
 * snare/hats, bass notes) the worker finds are kept per kind and fire once, on the first frame that reaches them.
 */

import type { StemEventValues } from '../audio-routing';
import { StemEventKinds } from './stem-events';
import { StemModelId, StemModels, StemName, StemNames } from './stem-models';
import type { StemWorkerRequest, StemWorkerResponse } from './stem-worker-protocol';

export type StemLevels = Record<StemName, number>;

export type StemSeparatorStatus = {
    model?: StemModelId,
    state: 'off' | 'loading' | 'warming' | 'running' | 'error',
    message?: string,
    executionProvider?: 'webgpu' | 'wasm',
    /** the last run's compute time over the audio it covered: below 1 keeps up */
    loadFactor?: number,
    /** seconds of audio separated ahead of what is heard (negative: behind) */
    headroom?: number,
};

export type StemSeparatorOptions = {
    workerUrl: string,
    wasmPath: string,
    /** base URLs to try, in order, before the model's remote one; each gets `<model id>/` appended */
    localBaseUrls: string[],
};

const TapProcessorSource = `
class StemTap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.size = 4096;
        this.l = new Float32Array(this.size);
        this.r = new Float32Array(this.size);
        this.n = 0;
        this.t0 = 0;
        this.on = false;
        this.port.onmessage = (e) => { this.on = !!e.data.on; this.n = 0; };
    }
    process(inputs) {
        const input = inputs[0];
        if (!this.on || !input || input.length === 0) return true;
        const left = input[0], right = input[1] || input[0];
        if (this.n === 0) this.t0 = currentTime;
        this.l.set(left, this.n);
        this.r.set(right, this.n);
        this.n += left.length;
        if (this.n >= this.size) {
            this.port.postMessage({ left: this.l, right: this.r, time: this.t0, sampleRate }, [this.l.buffer, this.r.buffer]);
            this.l = new Float32Array(this.size);
            this.r = new Float32Array(this.size);
            this.n = 0;
        }
        return true;
    }
}
registerProcessor('molstar-stem-tap', StemTap);
`;

/** How long the timeline is kept, seconds */
const TimelineSeconds = 90;
/** the mix's running peak falls this fast, dB per second */
const PeakDecayDbPerSecond = 0.6;
/**
 * A stem's level: its dB within this range under its reference (its own running peak, never more than
 * ReferenceBelowMixDb under the mix's), squared. An absolute loudness: how much a stem just rose is the routes' Hits
 * mode, not the stem's
 */
const LevelRangeDb = 24;
const ReferenceBelowMixDb = 15;
/** the drums keep their hits: instant attack, a short release, whatever the band smoothing */
const DrumsReleaseMs = 160;

/** each kind's events kept: 90 s at the kicks' minimum gap is 1000 */
const EventCapacity = 2048;
/**
 * An event's value: its dBFS within EventRangeDb under its kind's loud level (the strongest lately, falling
 * PeakDecayDbPerSecond, never under EventLoudFloorDbfs), so the song's hardest kicks read 1 and 9 dB softer 0.5
 */
const EventRangeDb = 18;
const EventLoudFloorDbfs = -30;
/** frames further apart than this (a stall, a jump) fire only the last frame's span: no backlog */
const EventMaxSpanS = 0.25;

/** one kind's events, a ring in time order */
class EventRing {
    readonly times = new Float64Array(EventCapacity);
    readonly values = new Float32Array(EventCapacity);
    head = 0;
    count = 0;
    loud = EventLoudFloorDbfs;
    lastTime = NaN;

    private index(k: number) {
        return (this.head + k) % EventCapacity;
    }

    timeAt(k: number) {
        return this.times[this.index(k)];
    }

    clear() {
        this.head = this.count = 0;
        this.loud = EventLoudFloorDbfs;
        this.lastTime = NaN;
    }

    push(time: number, dbfs: number) {
        const dt = Number.isFinite(this.lastTime) ? Math.max(0, time - this.lastTime) : 0;
        this.lastTime = time;
        this.loud = Math.max(dbfs, this.loud - PeakDecayDbPerSecond * dt, EventLoudFloorDbfs);
        const value = Math.min(1, Math.max(0, (dbfs - this.loud + EventRangeDb) / EventRangeDb));
        if (this.count === EventCapacity) {
            this.head = this.index(1);
            this.count--;
        }
        const i = this.index(this.count++);
        this.times[i] = time;
        this.values[i] = value;
    }

    /** the strongest value of the events in (from, to] */
    max(from: number, to: number) {
        let lo = 0, hi = this.count;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.timeAt(mid) <= from) lo = mid + 1; else hi = mid;
        }
        let v = 0;
        for (let k = lo; k < this.count; k++) {
            const i = this.index(k);
            if (this.times[i] > to) break;
            if (this.values[i] > v) v = this.values[i];
        }
        return v;
    }
}

function applyAttackRelease(previous: number, target: number, dtMs: number, attackMs: number, releaseMs: number) {
    if (dtMs <= 0) return target;
    const tc = target >= previous ? attackMs : releaseMs;
    if (tc <= 0) return target;
    return previous + (target - previous) * (1 - Math.exp(-dtMs / tc));
}

export class StemSeparator {
    private worker?: Worker;
    private tap?: AudioWorkletNode;
    private tapSink?: GainNode;
    private tapLoading?: Promise<void>;
    private model?: StemModelId;
    private request = 0;
    private requestedExecutionProvider?: 'webgpu' | 'wasm';
    private status: StemSeparatorStatus = { state: 'off' };

    // the timeline: frame times (audio-context seconds) and each stem's energy, in time order
    private times: number[] = [];
    private energies: Record<StemName, number[]> = { drums: [], bass: [], other: [], vocals: [] };

    private peaks: Record<StemName, number> = { drums: -120, bass: -120, other: -120, vocals: -120 };
    private mixPeak = -120;
    private levels: StemLevels = { drums: 0, bass: 0, other: 0, vocals: 0 };
    private lastSampleTime = -1;

    /** the stem events, by StemEventKinds */
    private eventRings = StemEventKinds.map(() => new EventRing());
    /** the time the worker's events cover from (the first run's from since the last clear; NaN: none yet) and up to */
    private eventsFrom = NaN;
    private eventsUntil = -Infinity;
    /** the time the events were last read up to (NaN: start again from the next frame's span) */
    private eventsReadUntil = NaN;

    constructor(private context: AudioContext, private source: AudioNode, private options: StemSeparatorOptions, private onStatus: (s: StemSeparatorStatus) => void) { }

    get currentStatus() {
        return this.status;
    }

    private setStatus(status: Partial<StemSeparatorStatus>) {
        this.status = { ...this.status, ...status };
        this.onStatus(this.status);
    }

    private post(message: StemWorkerRequest, transfer?: Transferable[]) {
        this.worker?.postMessage(message, transfer ?? []);
    }

    private ensureWorker() {
        if (this.worker) return this.worker;
        const worker = new Worker(this.options.workerUrl, { type: 'module' });
        worker.onmessage = (e: MessageEvent<StemWorkerResponse>) => this.onWorkerMessage(e.data);
        worker.onerror = (e) => this.setStatus({ state: 'error', message: `Stem worker failed: ${e.message}` });
        this.worker = worker;
        return worker;
    }

    private async ensureTap() {
        if (this.tap) return;
        if (!this.tapLoading) {
            this.tapLoading = (async () => {
                const url = URL.createObjectURL(new Blob([TapProcessorSource], { type: 'text/javascript' }));
                try {
                    await this.context.audioWorklet.addModule(url);
                } finally {
                    URL.revokeObjectURL(url);
                }
                const tap = new AudioWorkletNode(this.context, 'molstar-stem-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
                tap.port.onmessage = (e: MessageEvent<{ left: Float32Array, right: Float32Array, time: number, sampleRate: number }>) => {
                    const { left, right, time, sampleRate } = e.data;
                    this.post({ type: 'audio', left, right, time, sampleRate }, [left.buffer, right.buffer]);
                };
                // pulled by the graph through a silent sink
                const sink = this.context.createGain();
                sink.gain.value = 0;
                this.source.connect(tap);
                tap.connect(sink);
                sink.connect(this.context.destination);
                this.tap = tap;
                this.tapSink = sink;
            })();
            // a failed setup must not stay: picking the model again after Off retries it
            this.tapLoading.catch(() => { this.tapLoading = undefined; });
        }
        await this.tapLoading;
    }

    async setModel(id: StemModelId | undefined, executionProvider: 'webgpu' | 'wasm') {
        // the same request again (any params change calls this): no reload, and no retry of a failed one either; picking
        // the model again after Off retries it
        if (id === this.model && executionProvider === this.requestedExecutionProvider) return;
        const request = ++this.request;
        this.model = id;
        this.requestedExecutionProvider = executionProvider;
        this.clearTimeline();
        if (!id) {
            this.tap?.port.postMessage({ on: false });
            this.post({ type: 'unload' });
            this.setStatus({ model: undefined, state: 'off', message: undefined, loadFactor: undefined, headroom: undefined });
            return;
        }
        this.setStatus({ model: id, state: 'loading', message: `Loading ${StemModels[id].label}`, loadFactor: undefined, headroom: undefined });
        try {
            this.ensureWorker();
            await this.ensureTap();
        } catch (e) {
            // a newer request owns the status
            if (request === this.request) this.setStatus({ state: 'error', message: `${e}` });
            return;
        }
        // a newer request (Off, another model or provider, or this one again) came while the tap loaded: it owns the worker and the tap
        if (request !== this.request) return;
        const baseUrls = [...this.options.localBaseUrls.map(u => `${u}${id}/`), StemModels[id].remoteBaseUrl];
        this.post({ type: 'load', model: id, baseUrls, executionProvider, wasmPath: this.options.wasmPath });
        this.tap?.port.postMessage({ on: true });
    }

    /** forget the separated audio (a new source, a seek) */
    reset() {
        this.clearTimeline();
        this.post({ type: 'reset' });
    }

    private clearTimeline() {
        this.times = [];
        for (const s of StemNames) this.energies[s] = [];
        this.lastSampleTime = -1;
        for (const s of StemNames) {
            this.peaks[s] = -120;
            this.levels[s] = 0;
        }
        this.mixPeak = -120;
        for (const ring of this.eventRings) ring.clear();
        this.eventsFrom = NaN;
        this.eventsUntil = -Infinity;
        this.eventsReadUntil = NaN;
    }

    private onWorkerMessage(msg: StemWorkerResponse) {
        if (msg.model !== this.model) return;
        if (msg.type === 'status') {
            if (msg.state === 'ready') this.setStatus({ state: 'warming', message: msg.message, executionProvider: msg.executionProvider });
            else this.setStatus({ state: msg.state, message: msg.message });
            return;
        }
        // frames may overlap the timeline's end when a run covered more than one chunk: keep the newer
        const first = msg.times.length ? msg.times[0] : Infinity;
        while (this.times.length && this.times[this.times.length - 1] >= first) {
            this.times.pop();
            for (const s of StemNames) this.energies[s].pop();
        }
        for (let i = 0; i < msg.times.length; i++) {
            this.times.push(msg.times[i]);
            for (const s of StemNames) {
                // a model can emit NaN or Infinity (fp16 on WebGPU): it would stay in the running peaks for good
                const e = msg.energies[s][i];
                this.energies[s].push(Number.isFinite(e) && e > 0 ? e : 0);
            }
        }
        const oldest = (msg.times[msg.times.length - 1] ?? 0) - TimelineSeconds;
        let drop = 0;
        while (drop < this.times.length && this.times[drop] < oldest) drop++;
        if (drop > 0) {
            this.times.splice(0, drop);
            for (const s of StemNames) this.energies[s].splice(0, drop);
        }
        const events = msg.events;
        if (events) {
            // nothing is dropped: the runs' regions tile (in samples; their context times may cross by a resampled
            // sample at 48 kHz), and an event of the last run may be dated past its until (up to 60 ms after its peak)
            for (let i = 0; i < events.times.length; i++) {
                const ring = this.eventRings[events.kinds[i]];
                const t = events.times[i], db = events.dbfs[i];
                if (ring && Number.isFinite(t) && Number.isFinite(db)) ring.push(t, db);
            }
            if (Number.isNaN(this.eventsFrom)) this.eventsFrom = events.from;
            this.eventsUntil = events.until;
        }
        this.setStatus({
            state: 'running',
            loadFactor: msg.audioMs > 0 ? msg.computeMs / msg.audioMs : undefined,
        });
    }

    /** the latest time the timeline reaches */
    get coveredUntil() {
        return this.times.length ? this.times[this.times.length - 1] : -Infinity;
    }

    /**
     * Each stem's level (0-1) at audio-context time `time`, smoothed; undefined where the timeline does not reach it
     * (still loading, or the model falling behind)
     */
    sample(time: number, dtMs: number, attackMs: number, releaseMs: number): StemLevels | undefined {
        const n = this.times.length;
        if (!this.model || n < 2 || time < this.times[0] || time > this.times[n - 1]) {
            if (this.model && n > 0) this.status.headroom = this.times[n - 1] - time;
            return undefined;
        }
        this.status.headroom = this.times[n - 1] - time;
        // binary search for the frame at or before `time`
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.times[mid] <= time) lo = mid; else hi = mid;
        }
        const t = (time - this.times[lo]) / Math.max(1e-6, this.times[hi] - this.times[lo]);
        const dtSec = this.lastSampleTime >= 0 ? Math.max(0, time - this.lastSampleTime) : 0;
        this.lastSampleTime = time;

        const db: Record<StemName, number> = { drums: 0, bass: 0, other: 0, vocals: 0 };
        let mix = 0;
        for (const s of StemNames) {
            const e = this.energies[s][lo] * (1 - t) + this.energies[s][hi] * t;
            mix += e;
            db[s] = 10 * Math.log10(e + 1e-12);
        }
        const mixDb = 10 * Math.log10(mix + 1e-12);
        this.mixPeak = Math.max(mixDb, this.mixPeak - PeakDecayDbPerSecond * dtSec);
        for (const s of StemNames) {
            this.peaks[s] = Math.max(db[s], this.peaks[s] - PeakDecayDbPerSecond * dtSec);
            const reference = Math.max(this.peaks[s], this.mixPeak - ReferenceBelowMixDb);
            const linear = Math.min(1, Math.max(0, (db[s] - (reference - LevelRangeDb)) / LevelRangeDb));
            const target = linear * linear;
            this.levels[s] = s === 'drums'
                ? applyAttackRelease(this.levels[s], target, dtMs, 0, DrumsReleaseMs)
                : applyAttackRelease(this.levels[s], target, dtMs, attackMs, releaseMs);
        }
        return { ...this.levels };
    }

    /**
     * The events heard over the span from the last call to `at` (audio-context time), into `out`: each kind's strongest
     * (0-1), 0 for a kind with none. The span starts again (the last `dtMs`) after `skipEvents`, a jump back or a gap
     * over EventMaxSpanS, so a late frame fires nothing it skipped. Returns whether events are live: a model, and `at`
     * within what its runs covered. Allocates nothing
     */
    sampleEvents(at: number, dtMs: number, out: StemEventValues) {
        const last = this.eventsReadUntil;
        const from = !Number.isFinite(last) || at - last > EventMaxSpanS ? at - dtMs / 1000 : Math.min(last, at);
        this.eventsReadUntil = Number.isFinite(last) ? Math.max(last, at) : at;
        // within what the runs covered: before the first run's from (a model switched with the delay kept) the audio
        // being heard has no events, and the stand-ins carry it
        const live = !!this.model && at >= this.eventsFrom && at <= this.eventsUntil;
        out.live = live;
        if (!live) {
            // a frame past the coverage reads nothing and uses nothing up: the events not yet read fire once the next
            // run is in
            if (at > this.eventsUntil) this.eventsReadUntil = Number.isFinite(last) ? last : Math.min(at, this.eventsUntil);
            out.kick = out.snare = out.bassNote = 0;
            return false;
        }
        const r = this.eventRings;
        out.kick = r[0].max(from, at);
        out.snare = r[1].max(from, at);
        out.bassNote = r[2].max(from, at);
        return true;
    }

    /** a frame that does not read the events: the next one starts its span again */
    skipEvents() {
        this.eventsReadUntil = NaN;
    }

    dispose() {
        this.request++;
        this.tap?.port.postMessage({ on: false });
        this.tap?.disconnect();
        this.tapSink?.disconnect();
        this.worker?.terminate();
        this.worker = undefined;
    }
}
