/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Offline audio pipeline: a synthesized signal, frame by frame, through the reactor, the band-stems fallback and the
 * router, as `AudioReactiveAnimationManager.tick` does it (no GL, no browser). The measuring stick of the audio lanes:
 * see audio-pipeline.spec.ts for the golden traces and how to reuse it. Not a spec itself (jest runs `*.spec.ts`).
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactiveAnimationManager, AudioReactiveAnimationManagerValues } from '../audio-reactive-animation';
import { AudioRoute, AudioRouteTarget, createZeroDrives } from '../audio-routing';
import { StemModelId, StemModels } from '../audio-stems/stem-models';
import { StemLevels } from '../audio-stems/stem-separator';

export type AudioSignal = { name: string, sampleRate: number, samples: Float32Array, kicksS?: readonly number[] };

export type AudioPipelineFrameInfo = { index: number, timeMs: number, mediaS: number, paused: boolean, manager: AudioReactiveAnimationManager };

export type AudioPipelineOptions = {
    /** a preset's `analysis`; only the reactor's keys are read, as the manager's getReactorParams does */
    analysis?: Partial<AudioReactiveAnimationManagerValues>,
    /** the app overrides a preset's beat threshold with its knob (1.1, DefaultEffectKnobs) */
    beatThreshold?: number,
    frameMs?: number,
    durationS?: number,
    /** wall-clock ranges, seconds, where the audio element is paused (the media cursor freezes) */
    paused?: readonly (readonly [startS: number, endS: number])[],
    onFrame?: (f: AudioPipelineFrameInfo) => void,
    /** what the fake AudioContext reports as outputLatency, seconds (0: none) */
    outputLatency?: number,
    /**
     * the stem delay line, seconds: a fake delay node and a stub separator (sample calls in `stemSamples`; it separates
     * nothing, so the stems come from the bands) are installed and the manager sets the delay through setParams, as the
     * app's Stem Separation card does. The analyser then hands over what came in D earlier
     */
    stemDelayS?: number,
    /** wall-clock second from which the element reports `ended` (the end of the file); the media cursor stops there */
    endedAtS?: number,
    /**
     * wall-clock ranges, seconds, where the animation loop does not tick (a hidden tab): the audio element plays on and
     * still fires its pause and ended events, the manager's tick is not called
     */
    stalled?: readonly (readonly [startS: number, endS: number])[],
    /**
     * the manager's lookahead param (the analysis runs ahead of what is heard by its lead); with it the fake delay nodes
     * are installed even with no stemDelayS (no model: the manager's default delay)
     */
    lookahead?: boolean,
    lookaheadTrimMs?: number,
    /** with stemDelayS: what the stub separator's sample returns (undefined, the default: it separates nothing) */
    stemSample?: (time: number, dtMs: number, attackMs: number, releaseMs: number) => StemLevels | undefined,
};

export type AudioPipelineTrace = {
    count: number,
    timeMs: Float64Array, mediaS: Float64Array, paused: Uint8Array,
    drums: Float64Array, bass: Float64Array, other: Float64Array, vocals: Float64Array,
    /** by route index (route ids come from a global counter and depend on test order) */
    routeValues: Float64Array[],
    drives: Record<AudioRouteTarget, Float64Array>,
    /** with stemDelayS: each call of the stub separator's sample, (frame index, context time asked for) */
    stemSamples: { index: number, time: number }[],
    /** 1 where the manager read the analyser on that frame */
    analysed: Uint8Array,
    /** with stemDelayS: the frame index of each call of the stub separator's reset */
    stemResets: number[],
};

/**
 * the two private fields the fakes fill (the manager builds both from a real element and AudioContext in loadSource),
 * and the listeners it binds on an element it makes itself (resolveAudioPlayer)
 */
type ManagerFakes = { audioContext: unknown, analyser: unknown, bindAudioEvents(audio: unknown): void };

/**
 * with stemDelayS or lookahead: the private fields the fakes fill (the browser's delay nodes: what is heard, what is
 * analysed; with stemDelayS the stem separator)
 */
type ManagerStemFakes = { delayNode: unknown, analysisDelayNode: unknown, separator: unknown };
type FakeDelayNode = { delayTime: { value: number, setValueAtTime(v: number): void } };
const fakeDelayNode = (value: number): FakeDelayNode => ({ delayTime: { value, setValueAtTime(v: number) { this.value = v; } } });
/**
 * the analysis delay node: it reads the heard node's delay until the manager sets its own (a manager without the
 * analysis branch never does, so its analyser reads the heard delay)
 */
const fakeAnalysisDelayNode = (heard: FakeDelayNode): FakeDelayNode => {
    let own: number | undefined;
    return { delayTime: { get value() { return own ?? heard.delayTime.value; }, set value(v: number) { own = v; }, setValueAtTime(v: number) { own = v; } } };
};

/**
 * The real `AudioReactiveAnimationManager.tick`, frame by frame, with fakes for what a browser gives it: an audio
 * context whose clock advances one frame per tick (wall time, paused or not), an analyser that hands over the N samples
 * ending one analysis delay (what the manager set on its analysis delay node when it read; else the heard delay; 0
 * with no delay node) before the end of what came into the graph (wall time: the media while playing, silence while
 * paused or ended), an audio element that is paused or not (its pause(), removeAttribute() and
 * load() work, so onFrame can call the manager's stop() and clear(); it fires pause and ended on the frame that first
 * sees them, before the tick, as a browser queues them). Nothing of tick is re-implemented here.
 */
export function runAudioPipeline(signal: AudioSignal, routes: readonly AudioRoute[], opts: AudioPipelineOptions = {}): AudioPipelineTrace {
    const frameMs = opts.frameMs ?? 16;
    const sr = signal.sampleRate;
    const durationS = opts.durationS ?? signal.samples.length / sr;
    const count = Math.floor(durationS * 1000 / frameMs);
    let cursor = 0; // the media cursor, samples
    // what came into the graph, in wall time: n + delay zeros, then per frame the media played or silence
    let wall = new Float32Array(0);
    let wallEnd = 0;
    const delaySamples = Math.round((opts.stemDelayS ?? 0) * sr);
    // the delay nodes, when installed (the analysis one reads the heard delay until the manager sets its own)
    let delayNode: FakeDelayNode | undefined, analysisDelayNode: FakeDelayNode | undefined;
    const analysisDelaySamples = () => Math.round((analysisDelayNode?.delayTime.value ?? 0) * sr);
    let frameIndex = -1;
    const analysedFrames: number[] = [];
    const ctx = { currentTime: 0, sampleRate: sr, state: 'running', outputLatency: opts.outputLatency ?? 0 };
    const analyser = {
        fftSize: 2048, smoothingTimeConstant: 0,
        get frequencyBinCount() { return this.fftSize / 2; },
        // what the analyser hands over: its last fftSize samples, i.e. N samples ending one analysis delay before what came in
        getFloatTimeDomainData(out: Float32Array) {
            analysedFrames.push(frameIndex);
            const end = wallEnd - analysisDelaySamples();
            const start = end - out.length;
            if (start >= 0) { out.set(wall.subarray(start, end)); return; }
            // before the run's first sample: silence (a delay raised past what came in)
            out.fill(0);
            if (end > 0) out.set(wall.subarray(0, end), -start);
        },
        // deterministic; the reactor does not read it (only the visualization does)
        getByteFrequencyData(out: Uint8Array) { out.fill(0); },
    };
    // pause() latches: the manager's stop() and clear() pause the element for the rest of the run
    let pausedByManager = false;
    const listeners: { type: string, listener: () => void }[] = [];
    const audio = {
        src: 'offline://' + signal.name, paused: false, ended: false, currentTime: 0,
        pause() { pausedByManager = true; audio.paused = true; },
        removeAttribute(name: string) { if (name === 'src') audio.src = ''; },
        load() { },
        addEventListener(type: string, listener: () => void) { listeners.push({ type, listener }); },
    };
    const fire = (type: string) => { for (const l of listeners) if (l.type === type) l.listener(); };

    const manager = new AudioReactiveAnimationManager({} as ConstructorParameters<typeof AudioReactiveAnimationManager>[0]);
    // the one place that sets the manager's private fields (a browser would: loadSource -> ensureAnalyser)
    const fakes = manager as unknown as ManagerFakes;
    fakes.audioContext = ctx; fakes.analyser = analyser;
    fakes.bindAudioEvents(audio);
    manager.state.audioPlayer.next(audio as unknown as HTMLAudioElement);
    manager.setRoutes([...routes]);
    const stemSamples: { index: number, time: number }[] = [];
    const stemResets: number[] = [];
    let stemParams = {};
    if (opts.stemDelayS !== void 0 || opts.lookahead !== void 0) {
        const stemFakes = manager as unknown as ManagerStemFakes;
        stemFakes.delayNode = delayNode = fakeDelayNode(0);
        stemFakes.analysisDelayNode = analysisDelayNode = fakeAnalysisDelayNode(delayNode);
    }
    if (opts.lookahead !== void 0) stemParams = { lookahead: opts.lookahead, lookaheadTrimMs: opts.lookaheadTrimMs ?? 0 };
    if (opts.stemDelayS !== void 0) {
        (manager as unknown as ManagerStemFakes).separator = {
            async setModel() { }, dispose() { },
            reset() { stemResets.push(frameIndex); },
            sample(time: number, dtMs: number, attackMs: number, releaseMs: number) {
                stemSamples.push({ index: frameIndex, time });
                return opts.stemSample?.(time, dtMs, attackMs, releaseMs);
            },
        };
        stemParams = { ...stemParams, stemModel: Object.keys(StemModels)[0] as StemModelId, stemDelaySeconds: opts.stemDelayS };
    }
    // setParams sizes the analyser (fftSize) and the manager's buffers from the reactor's parameters (and sets the delay)
    manager.setParams({ ...opts.analysis, beatThreshold: opts.beatThreshold ?? 1.1, ...stemParams });
    const n = analyser.fftSize;
    const frameSamples = Math.ceil(frameMs * sr / 1000) + 1;
    wall = new Float32Array(n + delaySamples + count * frameSamples);
    wallEnd = n + delaySamples;

    const trace: AudioPipelineTrace = {
        count,
        timeMs: new Float64Array(count), mediaS: new Float64Array(count), paused: new Uint8Array(count),
        drums: new Float64Array(count), bass: new Float64Array(count), other: new Float64Array(count), vocals: new Float64Array(count),
        routeValues: routes.map(() => new Float64Array(count)),
        drives: {} as Record<AudioRouteTarget, Float64Array>,
        stemSamples,
        analysed: new Uint8Array(count),
        stemResets,
    };
    for (const t of Object.keys(createZeroDrives()) as AudioRouteTarget[]) trace.drives[t] = new Float64Array(count);
    let mediaFrames = 0;
    let firedPaused = false;
    for (let i = 0; i < count; i++) {
        frameIndex = i;
        const timeMs = (i + 1) * frameMs;
        const ended = opts.endedAtS !== void 0 && timeMs / 1000 > opts.endedAtS;
        const paused = pausedByManager || ended || !!opts.paused?.some(([a, b]) => timeMs / 1000 > a && timeMs / 1000 <= b);
        // the element's state at the last frame: pause() inside onFrame (stop, clear) sets paused at once, its event comes next frame
        const wasPaused = firedPaused, wasEnded = audio.ended;
        firedPaused = paused;
        audio.paused = paused;
        audio.ended = ended;
        const from = cursor;
        if (!paused) cursor = Math.round(++mediaFrames * frameMs * sr / 1000); // integer arithmetic: no accumulated drift
        // into the graph this frame: the media just played, or silence for as long
        const len = paused ? Math.round((i + 1) * frameMs * sr / 1000) - Math.round(i * frameMs * sr / 1000) : cursor - from;
        if (!paused) wall.set(signal.samples.subarray(from, cursor), wallEnd);
        wallEnd += len;
        ctx.currentTime = timeMs / 1000;
        if (paused && !wasPaused) fire('pause');
        if (ended && !wasEnded) fire('ended');
        if (!opts.stalled?.some(([a, b]) => timeMs / 1000 > a && timeMs / 1000 <= b)) manager.tick(timeMs);
        const stems = manager.stems;
        trace.timeMs[i] = timeMs; trace.mediaS[i] = mediaFrames * frameMs / 1000; trace.paused[i] = paused ? 1 : 0;
        trace.drums[i] = stems.drums; trace.bass[i] = stems.bass; trace.other[i] = stems.other; trace.vocals[i] = stems.vocals;
        routes.forEach((r, j) => { trace.routeValues[j][i] = manager.routeValues.get(r.id) ?? 0; });
        for (const t of Object.keys(trace.drives) as AudioRouteTarget[]) trace.drives[t][i] = manager.drives[t];
        opts.onFrame?.({ index: i, timeMs, mediaS: trace.mediaS[i], paused, manager });
    }
    for (const i of analysedFrames) if (i >= 0) trace.analysed[i] = 1;
    return trace;
}

// ---- signals (float64 math, stored as Float32 like an analyser buffer) ----

export function mulberry32(seed: number) {
    let a = seed;
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

export const KickTimes = (seconds: number) => { const out: number[] = []; for (let k = 0.25; k < seconds - 0.12; k += 0.5) out.push(k); return out; };

function addKicks(out: Float32Array, sr: number, seconds: number) {
    for (const k of KickTimes(seconds)) {
        const s0 = Math.round(k * sr);
        for (let i = 0; i < 0.12 * sr && s0 + i < out.length; i++) {
            const t = i / sr;
            // a kick like the local data-local/kick120.wav (not scripts/votr-sync/clicksync.mjs's click, a 60 Hz decay): peak 0.7, ~40 ms decay, pitch falling 100 -> 50 Hz, gated at 120 ms
            out[s0 + i] += 0.7 * Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * (50 * t + 50 * 0.03 * (1 - Math.exp(-t / 0.03))));
        }
    }
}

export function kickTrack(sr = 48000, seconds = 10): AudioSignal {
    const samples = new Float32Array(Math.round(seconds * sr));
    addKicks(samples, sr, seconds);
    return { name: 'kick', sampleRate: sr, samples, kicksS: KickTimes(seconds) };
}

export function bassTone(sr = 48000, seconds = 8): AudioSignal {
    const samples = new Float32Array(Math.round(seconds * sr));
    for (let i = Math.round(1 * sr); i < Math.round(6 * sr); i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 80 * i / sr);
    return { name: 'bass', sampleRate: sr, samples };
}

export function silence(sr = 48000, seconds = 4): AudioSignal {
    return { name: 'silence', sampleRate: sr, samples: new Float32Array(Math.round(seconds * sr)) };
}

export function songMix(sr = 48000, seconds = 10): AudioSignal {
    const samples = new Float32Array(Math.round(seconds * sr));
    addKicks(samples, sr, seconds);
    const rnd = mulberry32(1234);
    let prev = 0;
    for (let i = 0; i < samples.length; i++) {
        const t = i / sr;
        const f = Math.floor(t / 2) % 2 === 0 ? 55 : 82;
        let v = 0.25 * Math.sin(2 * Math.PI * f * t) + 0.05 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t));
        // hats on the off-beats: 20 ms of first-difference noise
        const beatPos = (t - 0.5) % 0.5;
        if (t >= 0.5 && beatPos >= 0 && beatPos < 0.02) { const w = rnd() * 2 - 1; v += 0.1 * (w - prev); prev = w; }
        samples[i] += v;
    }
    return { name: 'song', sampleRate: sr, samples, kicksS: KickTimes(seconds) };
}

// ---- measuring ----

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** kick -> peak lag in frames and rest/peak of one drive, with clicksync's windows (-50..400 ms for the peak, 400..500 ms for the rest) */
export function kickPeakStats(trace: AudioPipelineTrace, kicksS: readonly number[], target: AudioRouteTarget, settleS = 1) {
    const d = trace.drives[target];
    const lags: number[] = [], rests: number[] = [], peaks: number[] = [];
    const frameMs = trace.timeMs[1] - trace.timeMs[0];
    for (const k of kicksS) {
        if (k < settleS + 0.25 || k + 0.5 > trace.timeMs[trace.count - 1] / 1000) continue;
        let peakI = -1, peak = -1, kickI = -1;
        for (let i = 0; i < trace.count; i++) {
            const t = trace.timeMs[i] / 1000;
            if (kickI < 0 && t >= k) kickI = i;
            if (t >= k - 0.05 && t < k + 0.4 && d[i] > peak) { peak = d[i]; peakI = i; }
        }
        let rest = 0;
        for (let i = 0; i < trace.count; i++) { const t = trace.timeMs[i] / 1000; if (t >= k + 0.4 && t < k + 0.5) rest = Math.max(rest, d[i]); }
        lags.push(peakI - kickI); peaks.push(peak); rests.push(rest / peak);
    }
    return {
        lagMedian: median(lags), lagMin: Math.min(...lags), lagMax: Math.max(...lags), frameMs,
        peakMedian: median(peaks), restMedian: median(rests), restMax: Math.max(...rests),
    };
}

/** the rows `every` frames apart over the first `seconds`, as text: t, drums, bass, then the columns */
export function formatGolden(trace: AudioPipelineTrace, cols: readonly AudioRouteTarget[], every = 4, seconds = 4, digits = 4) {
    const rows: string[] = [];
    for (let i = every - 1; i < trace.count && trace.timeMs[i] <= seconds * 1000; i += every) {
        const v = [trace.timeMs[i] / 1000, trace.drums[i], trace.bass[i], ...cols.map(c => trace.drives[c][i])];
        rows.push(v.map(x => x.toFixed(digits)).join(' '));
    }
    return rows.join('\n');
}

/** the targets that are non-zero somewhere in the trace */
export function activeTargets(trace: AudioPipelineTrace) {
    return (Object.keys(trace.drives) as AudioRouteTarget[]).filter(t => trace.drives[t].some(x => x !== 0));
}

/**
 * compares a trace with its inline golden rows (same row picking as formatGolden): the cells off by more than
 * max(1e-4, 1e-3 x |expected|), as text. Relative, so a small column (illumination, 0.001-0.008) is held as tightly as a
 * large one (symAxis, up to 11); the 1e-4 floor covers the golden's 4-decimal rounding.
 */
export function goldenDiffs(trace: AudioPipelineTrace, cols: readonly AudioRouteTarget[], golden: string, every = 4, seconds = 4): string[] {
    const got = formatGolden(trace, cols, every, seconds).split('\n');
    const want = golden.trim().split('\n');
    if (got.length !== want.length) return [`golden has ${want.length} rows, the trace ${got.length}`];
    const diffs: string[] = [];
    got.forEach((row, r) => {
        const g = row.split(' ').map(Number), w = want[r].trim().split(/\s+/).map(Number);
        w.forEach((x, c) => { if (!(Math.abs(g[c] - x) <= Math.max(1e-4, 1e-3 * Math.abs(x)))) diffs.push(`row ${r} col ${c}: ${g[c]} vs golden ${x}`); });
    });
    return diffs;
}
