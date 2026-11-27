/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Offline audio pipeline: a synthesized signal, frame by frame, through the reactor, the band-stems fallback and the
 * router, as `AudioReactiveAnimationManager.tick` does it (no GL, no browser). The measuring stick of the audio lanes:
 * see audio-pipeline.spec.ts for the golden traces and how to reuse it. Not a spec itself (jest runs `*.spec.ts`).
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AudioReactiveAnimationManagerValues, BandDrumsPeakDecayMs, BandDrumsPeakFloor, getBandDrumsOnset, getBandStems } from '../audio-reactive-animation';
import { AudioReactiveFrame, AudioReactor, AudioReactorParams, DefaultAudioBandDefinitions, DefaultAudioBandKey, getAudioReactorAnalyserFftSize } from '../audio-reactor';
import { AudioRoute, AudioRouteTarget, AudioRouter, createZeroDrives } from '../audio-routing';
import { StemLevels } from '../audio-stems/stem-separator';

export type AudioSignal = { name: string, sampleRate: number, samples: Float32Array, kicksS?: readonly number[] };

export type AudioPipelineFrameInfo = {
    index: number, timeMs: number, mediaS: number, paused: boolean, samples: Float32Array,
    frame: AudioReactiveFrame<DefaultAudioBandKey>, stems: StemLevels, router: AudioRouter,
};

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
};

export type AudioPipelineTrace = {
    count: number,
    timeMs: Float64Array, mediaS: Float64Array, paused: Uint8Array,
    drums: Float64Array, bass: Float64Array, other: Float64Array, vocals: Float64Array,
    /** by route index (route ids come from a global counter and depend on test order) */
    routeValues: Float64Array[],
    drives: Record<AudioRouteTarget, Float64Array>,
};

const ReactorKeys = [
    'fftSize', 'analysisSampleRate', 'bandNormalizationGain', 'amplitudeAttackMs', 'amplitudeReleaseMs', 'bandAttackMs', 'bandReleaseMs',
    'beatAttackMs', 'beatReleaseMs', 'dominantFrequencyAttackMs', 'dominantFrequencyReleaseMs', 'beatSensitivity', 'beatBaselineMs',
    'onsetHalfLifeMs', 'onsetWeight', 'temperature', 'activityThreshold',
] as const;

/** the reactor's parameters as the manager builds them from the plugin params (DefaultAudioReactorParams fill the rest) */
export function getPipelineReactorParams(analysis: Partial<AudioReactiveAnimationManagerValues> | undefined, beatThreshold = 1.1) {
    const params: Partial<AudioReactorParams<DefaultAudioBandKey>> = { bands: DefaultAudioBandDefinitions, beatThreshold };
    const src = (analysis ?? {}) as Record<string, number>;
    for (const k of ReactorKeys) if (src[k] !== undefined) (params as Record<string, number>)[k] = src[k];
    return params;
}

export function runAudioPipeline(signal: AudioSignal, routes: readonly AudioRoute[], opts: AudioPipelineOptions = {}): AudioPipelineTrace {
    const frameMs = opts.frameMs ?? 16;
    const sr = signal.sampleRate;
    const durationS = opts.durationS ?? signal.samples.length / sr;
    const count = Math.floor(durationS * 1000 / frameMs);
    const reactor = new AudioReactor<DefaultAudioBandKey>(getPipelineReactorParams(opts.analysis, opts.beatThreshold));
    const router = new AudioRouter();
    // what the analyser hands over: its last fftSize samples, i.e. N samples ending at the media cursor
    const n = getAudioReactorAnalyserFftSize(reactor.getParams(), sr);
    const padded = new Float32Array(n + signal.samples.length + n);
    padded.set(signal.samples, n);
    const silence = new Float32Array(n);
    const trace: AudioPipelineTrace = {
        count,
        timeMs: new Float64Array(count), mediaS: new Float64Array(count), paused: new Uint8Array(count),
        drums: new Float64Array(count), bass: new Float64Array(count), other: new Float64Array(count), vocals: new Float64Array(count),
        routeValues: routes.map(() => new Float64Array(count)),
        drives: {} as Record<AudioRouteTarget, Float64Array>,
    };
    for (const t of Object.keys(createZeroDrives()) as AudioRouteTarget[]) trace.drives[t] = new Float64Array(count);
    let bandDrumsPeak = BandDrumsPeakFloor;
    let mediaFrames = 0;
    for (let i = 0; i < count; i++) {
        const timeMs = (i + 1) * frameMs;
        const paused = !!opts.paused?.some(([a, b]) => timeMs / 1000 > a && timeMs / 1000 <= b);
        let samples: Float32Array;
        if (paused) samples = silence;
        else {
            const end = Math.round(++mediaFrames * frameMs * sr / 1000); // integer arithmetic: no accumulated drift
            samples = padded.subarray(end, end + n);
        }
        const dtMs = i === 0 ? 16 : frameMs; // tick() uses 16 on its first frame
        const frame = reactor.analyze(samples, sr, dtMs);
        // the fallback of updateStems
        const onset = getBandDrumsOnset(frame);
        bandDrumsPeak = Math.max(onset, BandDrumsPeakFloor, bandDrumsPeak * Math.exp(-dtMs / BandDrumsPeakDecayMs));
        const d = Math.min(1, onset / bandDrumsPeak);
        const stems = getBandStems(frame, d * d);
        router.update(routes, frame, stems, dtMs);
        trace.timeMs[i] = timeMs; trace.mediaS[i] = mediaFrames * frameMs / 1000; trace.paused[i] = paused ? 1 : 0;
        trace.drums[i] = stems.drums; trace.bass[i] = stems.bass; trace.other[i] = stems.other; trace.vocals[i] = stems.vocals;
        routes.forEach((r, j) => { trace.routeValues[j][i] = router.values.get(r.id) ?? 0; });
        for (const t of Object.keys(trace.drives) as AudioRouteTarget[]) trace.drives[t][i] = router.drives[t];
        opts.onFrame?.({ index: i, timeMs, mediaS: trace.mediaS[i], paused, samples, frame, stems, router });
    }
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
            // a kick like data-local/kick120.wav: peak 0.7, ~40 ms decay, pitch falling 100 -> 50 Hz, gated at 120 ms
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

/** compares a trace with its inline golden rows (same row picking as formatGolden) */
export function expectGoldenRows(expectFn: (x: number) => { toBeCloseTo(v: number, d: number): void }, trace: AudioPipelineTrace, cols: readonly AudioRouteTarget[], golden: string, every = 4, seconds = 4, digits = 3) {
    const got = formatGolden(trace, cols, every, seconds).split('\n');
    const want = golden.trim().split('\n');
    if (got.length !== want.length) throw new Error(`golden has ${want.length} rows, the trace ${got.length}`);
    got.forEach((row, r) => {
        const g = row.split(' ').map(Number), w = want[r].trim().split(/\s+/).map(Number);
        w.forEach((x, c) => expectFn(g[c]).toBeCloseTo(x, digits));
    });
}
