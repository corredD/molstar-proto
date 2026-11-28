/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Stem events: kicks, snare/hat hits and bass notes, found in a model run's separated drums and bass (mono, the run's
 * window). A port of the stem study's reference detector (stem-study/scripts/metrics.py `band_flux` and `pick`): a
 * band's log-magnitude flux, peaks over a running median plus a share of the run's p95, the hit's energy within a floor
 * of the loud level, dated where its energy first passes -6 dB of its peak. Frames sit on the absolute hop grid, so
 * every run reads the same frames; a run posts only the peaks of its own region, the context around it inside the
 * window (stem-events-design, lane stem-events 2026-11-27). Pure: no worker, no onnxruntime. Buffers are made once.
 */

import { fftOf, FFT, periodicHann, StemSampleRate } from './dsp';

export type StemEventBand = {
    /** the band, Hz, both ends included */
    lo: number, hi: number,
    nfft: number, hop: number,
    /** the flux compares a frame with the one `lag` frames before */
    lag: number,
    /** two peaks closer than this keep the stronger flux */
    minGapS: number,
    /** the threshold over the running median, as a share of the run's p95 flux */
    deltaRel: number,
    /** the hit's energy within 60 ms must be within this of the 4 s loud level, dB */
    floorDb: number,
    /** the band energy a unit sine reads, dB: a strength is given against it (dBFS) */
    fullScaleDb: number,
};

export const KickBand: StemEventBand = { lo: 40, hi: 150, nfft: 1024, hop: 128, lag: 2, minGapS: 0.09, deltaRel: 0.25, floorDb: -24, fullScaleDb: -58.6 };
export const DrumHitBand: StemEventBand = { lo: 150, hi: 16000, nfft: 1024, hop: 128, lag: 2, minGapS: 0.06, deltaRel: 0.25, floorDb: -30, fullScaleDb: -58.45 };
export const BassNoteBand: StemEventBand = { lo: 30, hi: 300, nfft: 4096, hop: 256, lag: 2, minGapS: 0.08, deltaRel: 0.30, floorDb: -30, fullScaleDb: -70.5 };

export const StemEventKinds = ['kick', 'snare', 'bassNote'] as const;
export type StemEventKind = typeof StemEventKinds[number];

/** a run posts the peaks up to this before its window's end: the median's 0.25 s reach and a 4096 half window (0.296 s) */
export const EventHoldBackS = 0.35;
/** events under this are dropped: the near-silence the p95 of a quiet window would read as hits */
export const EventMinDbfs = -40;
/** a drum hit this close to a kick is the kick's */
export const SnareKickExclusionS = 0.03;
/**
 * the context analysed before a run's region: HTDemucs' whole window (7.8 s less its 5 s chunk and the hold-back). The
 * longer windows (Spleeter 11.8 s, SCNet 11 s) read the same span: as good on the study's stems, and less work
 */
export const EventContextS = 2.45;

const GammaLog = 100;
const MedianWindowS = 0.5;
const LoudWindowS = 4;
const AheadS = 0.06;
const AheadOriginS = 0.03;
const DateBackS = 0.04;
const DateDb = 6;

/** onsets found by one band: absolute sample of each event, its strength in dBFS */
export class OnsetList {
    count = 0;
    readonly at: Float64Array;
    readonly dbfs: Float32Array;

    constructor(readonly capacity: number) {
        this.at = new Float64Array(capacity);
        this.dbfs = new Float32Array(capacity);
    }

    push(at: number, dbfs: number) {
        if (this.count >= this.capacity) return;
        this.at[this.count] = at;
        this.dbfs[this.count] = dbfs;
        this.count++;
    }
}

/** one band's flux and energy per frame, then its peaks (metrics.py band_flux + pick) */
export class BandOnsetDetector {
    private readonly k0: number;
    private readonly k1: number;
    private readonly hopS: number;
    private readonly medianHalf: number;
    private readonly loc: number;
    private readonly loudFrom: number;
    private readonly loudSize: number;
    private readonly aheadSize: number;
    /** where the 60 ms ahead starts, from the frame: scipy's origin shifts the window by round(0.03 / hop) */
    private readonly aheadFrom: number;
    private readonly dateBack: number;
    private readonly scale: number;

    private readonly flux: Float64Array;
    private readonly edb: Float64Array;
    /** the last lag + 1 frames' log magnitudes, a ring */
    private readonly logs: Float64Array;
    private readonly median: Float64Array;
    private readonly positive: Float64Array;
    private readonly selected: Int32Array;
    private frames = 0;
    private firstCentre = 0;
    private lastPeakAbs = -Infinity;

    constructor(readonly band: StemEventBand, maxFrames: number) {
        const { nfft, hop } = band;
        let k0 = -1, k1 = -1;
        for (let k = 0; k <= nfft / 2; k++) {
            const f = k * StemSampleRate / nfft;
            if (f >= band.lo && f <= band.hi) {
                if (k0 < 0) k0 = k;
                k1 = k;
            }
        }
        this.k0 = k0;
        this.k1 = k1;
        this.hopS = hop / StemSampleRate;
        // scipy's filter sizes, as metrics.py rounds them
        this.medianHalf = (Math.max(3, Math.round(MedianWindowS / this.hopS) | 1) - 1) / 2;
        this.loc = Math.round(band.minGapS / this.hopS);
        this.loudSize = Math.round(LoudWindowS / this.hopS);
        this.loudFrom = Math.floor(this.loudSize / 2);
        this.aheadSize = Math.round(AheadS / this.hopS);
        this.aheadFrom = Math.round(AheadOriginS / this.hopS) - Math.floor(this.aheadSize / 2);
        this.dateBack = Math.round(DateBackS / this.hopS);
        // scipy.signal.stft divides by the window's sum (nfft / 2), metrics.py multiplies by 2 / nfft
        this.scale = 4 / (nfft * nfft);
        this.flux = new Float64Array(maxFrames);
        this.edb = new Float64Array(maxFrames);
        this.logs = new Float64Array((band.lag + 1) * (k1 - k0 + 1));
        this.median = new Float64Array(2 * this.medianHalf + 1);
        this.positive = new Float64Array(maxFrames);
        this.selected = new Int32Array(maxFrames);
    }

    /** a new run: its first frame is centred on window-local sample `firstCentre` */
    begin(firstCentre: number) {
        this.frames = 0;
        this.firstCentre = firstCentre;
    }

    /** one frame: `re`, `im`, the FFT of the Hann-windowed frame */
    addFrame(re: Float64Array, im: Float64Array) {
        const { k0, k1, scale, logs, band } = this;
        const t = this.frames;
        if (t >= this.flux.length) return;
        const nb = k1 - k0 + 1, rows = band.lag + 1;
        const row = (t % rows) * nb, back = ((t - band.lag) % rows + rows) % rows * nb;
        let flux = 0, energy = 0;
        for (let k = k0; k <= k1; k++) {
            const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
            const l = Math.log1p(GammaLog * m);
            energy += m * m;
            if (t >= band.lag) {
                const d = l - logs[back + k - k0];
                if (d > 0) flux += d;
            }
            logs[row + k - k0] = l;
        }
        this.flux[t] = flux;
        this.edb[t] = 10 * Math.log10(energy + 1e-12);
        this.frames = t + 1;
    }

    /** the 95th percentile of the run's positive flux, numpy's linear interpolation; 0 when there is none */
    private p95() {
        const { positive, flux } = this;
        let n = 0;
        for (let i = 0; i < this.frames; i++) if (flux[i] > 0) positive[n++] = flux[i];
        if (n === 0) return 0;
        const s = positive.subarray(0, n).sort();
        const x = 0.95 * (n - 1), i = Math.floor(x), f = x - i;
        return i + 1 < n ? s[i] + (s[i + 1] - s[i]) * f : s[i];
    }

    /** median_filter(flux, mode='nearest') at frame i */
    private medianAt(i: number) {
        const { median, flux, medianHalf } = this;
        const last = this.frames - 1;
        for (let j = -medianHalf; j <= medianHalf; j++) median[j + medianHalf] = flux[Math.min(last, Math.max(0, i + j))];
        median.sort();
        return median[medianHalf];
    }

    /** the max of edb over frames [a, a + size), clamped to the run */
    private maxDb(a: number, size: number) {
        const { edb } = this;
        let m = -Infinity;
        for (let j = Math.max(0, a), j1 = Math.min(this.frames, a + size); j < j1; j++) if (edb[j] > m) m = edb[j];
        return m;
    }

    private isLocalMax(i: number) {
        const { flux, loc } = this;
        const v = flux[i];
        for (let j = Math.max(0, i - loc), j1 = Math.min(this.frames - 1, i + loc); j <= j1; j++) if (flux[j] > v) return false;
        return true;
    }

    /**
     * The peaks whose frame centre lies in window-local [from, to), in `out` (absolute samples, dBFS). The minimum gap
     * starts from the last peak committed; `commit` keeps this call's last peak for the next one
     */
    pick(absStart: number, from: number, to: number, out: OnsetList, commit: boolean) {
        const { band, flux, edb, selected } = this;
        const T = this.frames;
        if (T === 0) return;
        const p95 = this.p95();
        if (!(p95 > 0)) return;
        const hop = band.hop;
        const gapS = band.minGapS;
        const iFrom = Math.max(0, Math.ceil((from - this.firstCentre) / hop));
        const iTo = Math.min(T, Math.ceil((to - this.firstCentre) / hop));
        let last = this.lastPeakAbs;
        let count = 0;
        for (let i = iFrom; i < iTo; i++) {
            const v = flux[i];
            if (v <= 0 || !this.isLocalMax(i)) continue;
            if (!(v > this.medianAt(i) + band.deltaRel * p95)) continue;
            const ahead = this.maxDb(i + this.aheadFrom, this.aheadSize);
            const loud = this.maxDb(i - this.loudFrom, this.loudSize);
            if (!(ahead > loud + band.floorDb)) continue;
            const at = absStart + this.firstCentre + i * hop;
            if ((at - last) / StemSampleRate < gapS) {
                if (count > 0 && v > flux[selected[count - 1]]) {
                    selected[count - 1] = i;
                    last = at;
                }
                continue;
            }
            selected[count++] = i;
            last = at;
        }
        if (commit) this.lastPeakAbs = last;
        for (let c = 0; c < count; c++) {
            const i = selected[c];
            const a = Math.max(0, i - this.dateBack), b = Math.min(T, i + this.aheadSize);
            const pk = this.maxDb(i, b - i);
            let j = a;
            while (j < b && !(edb[j] >= pk - DateDb)) j++;
            const dbfs = pk - band.fullScaleDb;
            if (dbfs < EventMinDbfs) continue;
            out.push(absStart + this.firstCentre + j * hop, dbfs);
        }
    }

    reset() {
        this.lastPeakAbs = -Infinity;
        this.frames = 0;
    }
}

/** the frames of `x` centred on the absolute hop grid, from `analyseFrom` on, each whole window inside `x` */
class GridStft {
    private readonly window: Float32Array;
    private readonly re: Float64Array;
    private readonly im: Float64Array;
    private readonly fft: FFT;

    constructor(readonly nfft: number, readonly hop: number, private readonly bands: BandOnsetDetector[]) {
        this.window = periodicHann(nfft);
        this.re = new Float64Array(nfft);
        this.im = new Float64Array(nfft);
        this.fft = fftOf(nfft);
    }

    run(x: Float32Array, absStart: number, analyseFrom: number) {
        const { nfft, hop, window, re, im, bands } = this;
        const half = nfft / 2;
        let c = Math.max(0, analyseFrom) + half;
        const r = ((absStart + c) % hop + hop) % hop;
        if (r) c += hop - r;
        for (const b of bands) b.begin(c);
        for (; c + half <= x.length; c += hop) {
            const o = c - half;
            for (let i = 0; i < nfft; i++) {
                re[i] = x[o + i] * window[i];
                im[i] = 0;
            }
            this.fft(re, im);
            for (const b of bands) b.addFrame(re, im);
        }
    }
}

/** one run's events, every kind, each kind in time order: absolute sample, dBFS, index in StemEventKinds */
export type StemEventBatch = { count: number, at: Float64Array, dbfs: Float32Array, kinds: Uint8Array };

const RecentKicks = 4;

/** kicks and drum hits from one 1024/128 pass over the drums, bass notes from a 4096/256 pass over the bass */
export class StemEventDetector {
    readonly batch: StemEventBatch;
    private readonly kick: BandOnsetDetector;
    private readonly hits: BandOnsetDetector;
    private readonly bassNote: BandOnsetDetector;
    private readonly drumsStft: GridStft;
    private readonly bassStft: GridStft;
    private readonly kicks: OnsetList;
    /** kicks just past the region: only to tell the region's last hits from kicks */
    private readonly nextKicks: OnsetList;
    private readonly hitList: OnsetList;
    private readonly notes: OnsetList;
    /** the last kicks posted, absolute samples: the next run's first hits are told from them */
    private readonly recentKicks = new Float64Array(RecentKicks).fill(-Infinity);

    constructor(readonly windowSamples: number) {
        const frames = (hop: number) => Math.floor(windowSamples / hop) + 1;
        const events = (band: StemEventBand) => Math.ceil(windowSamples / StemSampleRate / band.minGapS) + 2;
        this.kick = new BandOnsetDetector(KickBand, frames(KickBand.hop));
        this.hits = new BandOnsetDetector(DrumHitBand, frames(DrumHitBand.hop));
        this.bassNote = new BandOnsetDetector(BassNoteBand, frames(BassNoteBand.hop));
        this.drumsStft = new GridStft(KickBand.nfft, KickBand.hop, [this.kick, this.hits]);
        this.bassStft = new GridStft(BassNoteBand.nfft, BassNoteBand.hop, [this.bassNote]);
        this.kicks = new OnsetList(events(KickBand));
        this.nextKicks = new OnsetList(events(KickBand));
        this.hitList = new OnsetList(events(DrumHitBand));
        this.notes = new OnsetList(events(BassNoteBand));
        const capacity = this.kicks.capacity + this.hitList.capacity + this.notes.capacity;
        this.batch = { count: 0, at: new Float64Array(capacity), dbfs: new Float32Array(capacity), kinds: new Uint8Array(capacity) };
    }

    /**
     * One run: `drums`, `bass` the window's mono stems, `absStart` the absolute sample of their first; the events whose
     * flux peaks lie in window-local [from, to), from frames from `analyseFrom` on. Returns `batch`, overwritten by the
     * next run
     */
    run(drums: Float32Array, bass: Float32Array, absStart: number, from: number, to: number, analyseFrom = 0): StemEventBatch {
        this.drumsStft.run(drums, absStart, analyseFrom);
        this.bassStft.run(bass, absStart, analyseFrom);
        const { kicks, nextKicks, hitList, notes, recentKicks } = this;
        kicks.count = nextKicks.count = hitList.count = notes.count = 0;
        this.kick.pick(absStart, from, to, kicks, true);
        // a hit is dated up to 60 ms after its peak, a kick up to 40 ms before: kicks peaking 130 ms past the region
        this.kick.pick(absStart, to, to + Math.round(0.13 * StemSampleRate), nextKicks, false);
        this.hits.pick(absStart, from, to, hitList, true);
        this.bassNote.pick(absStart, from, to, notes, true);

        const batch = this.batch;
        batch.count = 0;
        this.append(kicks, 0);
        const near = SnareKickExclusionS * StemSampleRate;
        const start = batch.count;
        for (let i = 0; i < hitList.count; i++) {
            const t = hitList.at[i];
            if (isNear(t, recentKicks, RecentKicks, near) || isNear(t, kicks.at, kicks.count, near) || isNear(t, nextKicks.at, nextKicks.count, near)) continue;
            this.pushSorted(start, t, hitList.dbfs[i], 1);
        }
        this.append(notes, 2);
        for (let i = 0; i < kicks.count; i++) {
            recentKicks.copyWithin(0, 1);
            recentKicks[RecentKicks - 1] = kicks.at[i];
        }
        return batch;
    }

    private append(list: OnsetList, kind: number) {
        const start = this.batch.count;
        for (let i = 0; i < list.count; i++) this.pushSorted(start, list.at[i], list.dbfs[i], kind);
    }

    /** into the batch after `start` (its kind's first), in time order: a hit's dating can pass the next one's */
    private pushSorted(start: number, at: number, dbfs: number, kind: number) {
        const b = this.batch;
        let j = b.count++;
        while (j > start && b.at[j - 1] > at) {
            b.at[j] = b.at[j - 1];
            b.dbfs[j] = b.dbfs[j - 1];
            b.kinds[j] = b.kinds[j - 1];
            j--;
        }
        b.at[j] = at;
        b.dbfs[j] = dbfs;
        b.kinds[j] = kind;
    }

    reset() {
        this.kick.reset();
        this.hits.reset();
        this.bassNote.reset();
        this.recentKicks.fill(-Infinity);
        this.batch.count = 0;
    }
}

function isNear(t: number, times: Float64Array, n: number, within: number) {
    for (let i = 0; i < n; i++) if (Math.abs(times[i] - t) <= within) return true;
    return false;
}
