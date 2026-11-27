/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * What the visuals show: the audio state of the samples heard now, not of the samples the analyser hands over now.
 * The speakers play a sample `AudioContext.outputLatency` after the analyser reads it (~10-30 ms built in, ~150-250 ms
 * Bluetooth or AirPlay), so each tick's analysis goes into a ring stamped with the context time, and what is presented
 * is the entry of `now - latency`. Everything is allocated once; push and present copy numbers and references.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactiveFrame, AudioReactiveScalarSet, createEmptyAudioReactiveFrame, DefaultAudioBandDefinitions, DefaultAudioBandKey } from './audio-reactor';
import { AudioAffect, AudioRoute, AudioRouteDrives, AudioRouteTargets, AudioScopeSlot, AudioScopeSlotCount, createZeroDrives, defaultAudioAffect } from './audio-routing';
import { StemNames } from './audio-stems/stem-models';
import { StemLevels } from './audio-stems/stem-separator';

/** the audio clock as the presented frame reads it; read once per tick */
export interface AudioOutputClock {
    /** context time of the samples the analyser hands over now, s (AudioContext.currentTime) */
    now(): number
    /** how far what is heard trails now(), s; finite, >= 0 */
    latency(): number
}

/**
 * An output latency above this is taken as a wrong report, s. It guards the clock, not the ring: the ring spans
 * `AudioPresentedFrame.Capacity` ticks (4.3 s at 60 Hz, 2.1 s at 120 Hz, 1.07 s at 240 Hz), and a latency past its
 * span presents the oldest entry, i.e. the picture is at most the ring's span late. Real outputs report up to
 * ~0.3 s (Bluetooth, AirPlay), within the span at every refresh rate up to 240 Hz.
 */
export const MaxAudioOutputLatency = 2;

/**
 * The Web Audio clock: `currentTime`, and `outputLatency` read live (it changes when the output device changes).
 * 0 while the context is not running (nothing is heard, the clock stands) and where the browser has no outputLatency
 * (Safari): then the visuals follow the analyser, as before.
 */
export function webAudioOutputClock(ctx: AudioContext): AudioOutputClock {
    return {
        now: () => ctx.currentTime,
        latency: () => {
            if (ctx.state !== 'running') return 0;
            const latency = ctx.outputLatency as number | undefined;
            if (typeof latency !== 'number' || !Number.isFinite(latency)) return 0;
            return Math.min(MaxAudioOutputLatency, Math.max(0, latency));
        },
    };
}

export type AudioPresentedVisualization = { waveform: Float32Array<ArrayBuffer>, spectrum: Float32Array<ArrayBuffer> };

const Bands = DefaultAudioBandDefinitions;
const BandCount = Bands.length;
const ScalarSetSize = 6 + 3 * BandCount;
// one ring entry's scalars, in this order
const StampOffset = 0;
const PlayingOffset = 1;
const FrameOffset = 2;
const RawOffset = FrameOffset + ScalarSetSize;
const StemsOffset = RawOffset + ScalarSetSize;
const SeparatedOffset = StemsOffset + StemNames.length;
const DrivesOffset = SeparatedOffset + 1;
const ScopeCountOffset = DrivesOffset + AudioRouteTargets.length;
const ScopeKindOffset = ScopeCountOffset + 1;
const ScopeDriveOffset = ScopeKindOffset + AudioScopeSlotCount;
const RouteCountOffset = ScopeDriveOffset + AudioScopeSlotCount;
const ScalarStride = RouteCountOffset + 1;

const MinRouteStride = 16;

/**
 * How far past the newer entry's stamp, as a fraction of the interval before it, the read time may be while the picture
 * stays one entry behind the rule. 0.25 covers +-1.5 ms of tick jitter at 60 Hz (4 ms) and keeps a read time a third
 * of a frame inside the interval on the rule (32 ms latency at 49 ms frames: 17 ms past, tolerance 12 ms).
 */
const StepTolerance = 0.25;

function writeScalarSet(out: Float64Array, o: number, s: AudioReactiveScalarSet<DefaultAudioBandKey>) {
    out[o] = s.amplitude;
    out[o + 1] = s.peakAmplitude;
    out[o + 2] = s.beatIntensity;
    out[o + 3] = s.dominantFrequency;
    out[o + 4] = s.dominantFrequencyNormalized;
    out[o + 5] = s.mix;
    for (let b = 0; b < BandCount; b++) {
        const key = Bands[b].key;
        out[o + 6 + b] = s.frequencyBands[key];
        out[o + 6 + BandCount + b] = s.bandOnsets[key];
        out[o + 6 + 2 * BandCount + b] = s.bandProminence[key];
    }
}

function readScalarSet(src: Float64Array, o: number, s: AudioReactiveScalarSet<DefaultAudioBandKey>) {
    s.amplitude = src[o];
    s.peakAmplitude = src[o + 1];
    s.beatIntensity = src[o + 2];
    s.dominantFrequency = src[o + 3];
    s.dominantFrequencyNormalized = src[o + 4];
    s.mix = src[o + 5];
    for (let b = 0; b < BandCount; b++) {
        const key = Bands[b].key;
        s.frequencyBands[key] = src[o + 6 + b];
        s.bandOnsets[key] = src[o + 6 + BandCount + b];
        s.bandProminence[key] = src[o + 6 + 2 * BandCount + b];
    }
}

/**
 * A ring of the last `capacity` ticks of audio state and the presented snapshot read from it. The presented objects
 * (frame, stems, drives, scopes, route values, visualization) keep their identity for the presenter's life: readers
 * may hold them, and nothing is allocated per frame. A route edit that brings more routes than the ring holds grows
 * the route block once (a user action, never a steady frame).
 */
export class AudioPresentedFrame {
    /** ticks kept: covers the real output latencies (<= ~0.3 s) up to 240 Hz; see MaxAudioOutputLatency for the rest */
    static readonly Capacity = 256;

    private readonly scalars: Float64Array;
    private readonly viz: Float32Array;
    private readonly vizStride: number;
    /** each entry's scope affects (references): slot i's affect, kind and drive come from the same entry */
    private readonly scopeAffects: (AudioAffect | undefined)[];
    private routeStride = MinRouteStride;
    private routeIds: Int32Array;
    private routeVals: Float64Array;
    /** entries pushed so far; entry `seq` lives at `seq % capacity` */
    private pushed = 0;
    /** the oldest entry still in the ring */
    private first = 0;
    /** the entry presented now; never goes back (a growing latency holds the picture) */
    private presentedSeq = -1;
    private presentedRouteCount = -1;
    private presentedRouteIds: Int32Array;
    private readonly slotPool: AudioScopeSlot[] = [];

    /** whether the audio was playing (not paused, ended or without a source) when the presented entry was pushed */
    playing = false;
    readonly frame: AudioReactiveFrame<DefaultAudioBandKey> = createEmptyAudioReactiveFrame(DefaultAudioBandDefinitions);
    readonly stems: StemLevels = { drums: 0, bass: 0, other: 0, vocals: 0 };
    stemsSeparated = false;
    readonly drives: AudioRouteDrives = createZeroDrives();
    scopeCount = 0;
    readonly scopeKind = new Float64Array(AudioScopeSlotCount);
    readonly scopeDrive = new Float64Array(AudioScopeSlotCount);
    readonly scopes: AudioScopeSlot[] = [];
    readonly routeValues = new Map<number, number>();
    readonly visualization: AudioPresentedVisualization;

    constructor(waveformCount: number, spectrumCount: number, readonly capacity = AudioPresentedFrame.Capacity) {
        this.scalars = new Float64Array(capacity * ScalarStride);
        this.vizStride = waveformCount + spectrumCount;
        this.viz = new Float32Array(capacity * this.vizStride);
        this.scopeAffects = new Array<AudioAffect | undefined>(capacity * AudioScopeSlotCount).fill(undefined);
        this.routeIds = new Int32Array(capacity * this.routeStride);
        this.routeVals = new Float64Array(capacity * this.routeStride);
        this.presentedRouteIds = new Int32Array(this.routeStride);
        for (let i = 0; i < AudioScopeSlotCount; i++) this.slotPool.push({ kind: 0, drive: 0, affect: defaultAudioAffect() });
        this.visualization = { waveform: new Float32Array(waveformCount), spectrum: new Float32Array(spectrumCount) };
    }

    /** the stamp of the newest entry, or -Infinity with none */
    get newestStamp() {
        return this.pushed > this.first ? this.scalars[((this.pushed - 1) % this.capacity) * ScalarStride + StampOffset] : -Infinity;
    }

    /** room for `count` routes per entry; grows (copying the entries) only past the current size */
    ensureRouteCapacity(count: number) {
        if (count <= this.routeStride) return;
        const stride = Math.max(count, 2 * this.routeStride);
        const ids = new Int32Array(this.capacity * stride), vals = new Float64Array(this.capacity * stride);
        for (let e = 0; e < this.capacity; e++) {
            for (let i = 0; i < this.routeStride; i++) {
                ids[e * stride + i] = this.routeIds[e * this.routeStride + i];
                vals[e * stride + i] = this.routeVals[e * this.routeStride + i];
            }
        }
        const presented = new Int32Array(stride);
        presented.set(this.presentedRouteIds);
        this.routeIds = ids; this.routeVals = vals; this.presentedRouteIds = presented;
        this.routeStride = stride;
    }

    /** forgets every entry; the presented snapshot stays until the next present */
    flush() {
        this.first = this.pushed;
    }

    /** one tick's live state, stamped with the clock's now(); a stamp older than the newest entry flushes the ring first */
    push(stamp: number, playing: boolean, frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels, separated: boolean, drives: Readonly<AudioRouteDrives>,
        scopeCount: number, scopeKind: ArrayLike<number>, scopeDrive: ArrayLike<number>, scopes: readonly AudioScopeSlot[],
        routes: readonly AudioRoute[], values: ReadonlyMap<number, number>, visualization: AudioPresentedVisualization) {
        if (stamp < this.newestStamp) this.flush();
        this.ensureRouteCapacity(routes.length);
        const e = this.pushed % this.capacity;
        const s = this.scalars, o = e * ScalarStride;
        s[o + StampOffset] = stamp;
        s[o + PlayingOffset] = playing ? 1 : 0;
        writeScalarSet(s, o + FrameOffset, frame);
        writeScalarSet(s, o + RawOffset, frame.raw);
        for (let i = 0; i < StemNames.length; i++) s[o + StemsOffset + i] = stems[StemNames[i]];
        s[o + SeparatedOffset] = separated ? 1 : 0;
        for (let i = 0; i < AudioRouteTargets.length; i++) s[o + DrivesOffset + i] = drives[AudioRouteTargets[i][0]];
        s[o + ScopeCountOffset] = scopeCount;
        for (let i = 0; i < AudioScopeSlotCount; i++) {
            s[o + ScopeKindOffset + i] = scopeKind[i];
            s[o + ScopeDriveOffset + i] = scopeDrive[i];
            this.scopeAffects[e * AudioScopeSlotCount + i] = i < scopeCount ? scopes[i].affect : undefined;
        }
        s[o + RouteCountOffset] = routes.length;
        const r = e * this.routeStride;
        for (let i = 0; i < routes.length; i++) {
            const id = routes[i].id;
            this.routeIds[r + i] = id;
            this.routeVals[r + i] = values.get(id) ?? 0;
        }
        const v = e * this.vizStride, w = visualization.waveform, sp = visualization.spectrum;
        for (let i = 0; i < w.length; i++) this.viz[v + i] = w[i];
        for (let i = 0; i < sp.length; i++) this.viz[v + w.length + i] = sp[i];
        this.pushed++;
        if (this.pushed - this.first > this.capacity) this.first = this.pushed - this.capacity;
    }

    /**
     * The rule: the newest entry stamped at or before `readTime`; with none, the oldest entry (start-up, a latency
     * longer than the ring). Never an entry older than the one presented now. Nothing pushed yet: nothing changes.
     *
     * Hysteresis at the boundary: when the rule names the entry after the next one, and the read time is past that
     * entry's stamp by less than `StepTolerance` of the interval before it, the next entry is presented instead. A read
     * time that sits on a stamp boundary (L = 200 ms at 60 Hz, a clock in audio quanta) then steps one entry per frame,
     * one behind the rule, instead of alternating hold and skip with the tick jitter; a read time well inside an
     * interval (32 ms at 49 ms frames) follows the rule, so one late tick costs one hold and one skip, as the rule, and
     * no lasting lag. Never ahead of the rule (never early), at most one entry behind it; the newest entry is never held
     * back (latency 0 follows the analyser). Any other jump follows the rule (a shorter latency, a stall), and the
     * monotonic hold covers a longer one.
     */
    present(readTime: number) {
        if (this.pushed === this.first) return;
        const cap = this.capacity, s = this.scalars;
        let seq = this.pushed - 1;
        while (seq > this.first && s[(seq % cap) * ScalarStride + StampOffset] > readTime + 1e-9) seq--;
        const next = this.presentedSeq + 1;
        if (this.presentedSeq >= 0 && next >= this.first && seq === next + 1 && seq < this.pushed - 1) {
            const newer = s[(seq % cap) * ScalarStride + StampOffset], older = s[(next % cap) * ScalarStride + StampOffset];
            if (readTime - newer < StepTolerance * (newer - older) - 1e-9) seq = next;
        }
        if (seq <= this.presentedSeq) return;
        this.presentedSeq = seq;

        const e = seq % cap, o = e * ScalarStride;
        this.playing = s[o + PlayingOffset] !== 0;
        readScalarSet(s, o + FrameOffset, this.frame);
        readScalarSet(s, o + RawOffset, this.frame.raw);
        for (let i = 0; i < StemNames.length; i++) this.stems[StemNames[i]] = s[o + StemsOffset + i];
        this.stemsSeparated = s[o + SeparatedOffset] !== 0;
        for (let i = 0; i < AudioRouteTargets.length; i++) this.drives[AudioRouteTargets[i][0]] = s[o + DrivesOffset + i];
        const scopeCount = s[o + ScopeCountOffset];
        this.scopeCount = scopeCount;
        for (let i = 0; i < AudioScopeSlotCount; i++) {
            this.scopeKind[i] = s[o + ScopeKindOffset + i];
            this.scopeDrive[i] = s[o + ScopeDriveOffset + i];
        }
        this.scopes.length = scopeCount;
        for (let i = 0; i < scopeCount; i++) {
            const slot = this.slotPool[i];
            slot.kind = this.scopeKind[i];
            slot.drive = this.scopeDrive[i];
            slot.affect = this.scopeAffects[e * AudioScopeSlotCount + i]!;
            this.scopes[i] = slot;
        }

        // route values: the same ids as presented now only set their values; another id list (a route edit) rebuilds
        const routeCount = s[o + RouteCountOffset], r = e * this.routeStride;
        let same = routeCount === this.presentedRouteCount;
        for (let i = 0; same && i < routeCount; i++) same = this.presentedRouteIds[i] === this.routeIds[r + i];
        if (!same) {
            this.routeValues.clear();
            for (let i = 0; i < routeCount; i++) this.presentedRouteIds[i] = this.routeIds[r + i];
            this.presentedRouteCount = routeCount;
        }
        for (let i = 0; i < routeCount; i++) this.routeValues.set(this.routeIds[r + i], this.routeVals[r + i]);

        const v = e * this.vizStride, w = this.visualization.waveform, sp = this.visualization.spectrum;
        for (let i = 0; i < w.length; i++) w[i] = this.viz[v + i];
        for (let i = 0; i < sp.length; i++) sp[i] = this.viz[v + w.length + i];
    }
}
