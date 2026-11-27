/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * When a new song starts, for the random model switch. Two ways:
 * - the stream's titles (ICY metadata), exact, where the server lets the page read them (it must allow the
 *   `Icy-MetaData` request header and expose `icy-metaint`);
 * - otherwise an estimate from the sound: a gap of near silence, or the spectrum's balance shifting for good.
 */

import { type AudioReactiveStatus } from '../../mol-plugin-state/manager/audio-reactive-animation';
import { DefaultAudioBandDefinitions } from '../../mol-plugin-state/manager/audio-reactor';

/** the sound-based estimate's settings, tuned on a recording of the default stream against its real title changes */
export const SongChangeParams = {
    /** one feature vector per bin of this many ms */
    binMs: 1000,
    /** the recent window and the one before it, in bins, with a gap between them so a transition does not straddle both */
    recentBins: 6,
    gapBins: 2,
    previousBins: 16,
    /** a shift of the spectrum's balance this large (normalized L1) is a new song */
    shiftThreshold: 0.2,
    /** and at least this many times the shifts seen within the current song */
    shiftOverTypical: 2.2,
    /** below this loudness for this long, then sound again: a gap between songs */
    silenceLevel: 0.012,
    silenceMs: 600,
    /** no two changes closer than this */
    minSongMs: 75000,
};

export type SongChangeReason = 'title' | 'gap' | 'shift' | 'source';

/** Estimates song changes from the band levels (0-1) and loudness the analysis gives each frame */
export class SongChangeDetector {
    private readonly params = SongChangeParams;
    private bins: Float32Array[] = [];
    private acc: Float64Array | undefined;
    private accMs = 0;
    private accCount = 0;
    private quietMs = 0;
    private sinceChangeMs = 0;
    private shifts: number[] = [];

    constructor(private readonly onChange: (reason: SongChangeReason) => void) { }

    /** forget the history: a new source, or a change found another way */
    reset() {
        this.bins = [];
        this.acc = undefined;
        this.accMs = 0;
        this.accCount = 0;
        this.quietMs = 0;
        this.sinceChangeMs = 0;
        this.shifts = [];
    }

    feed(bands: ArrayLike<number>, loudness: number, dtMs: number) {
        const p = this.params;
        this.sinceChangeMs += dtMs;
        // a gap of near silence, ended by sound
        if (loudness < p.silenceLevel) {
            this.quietMs += dtMs;
        } else {
            const wasGap = this.quietMs >= p.silenceMs;
            this.quietMs = 0;
            if (wasGap && this.sinceChangeMs >= p.minSongMs) return this.fire('gap');
        }
        if (!this.acc || this.acc.length !== bands.length) this.acc = new Float64Array(bands.length);
        for (let i = 0; i < bands.length; i++) this.acc[i] += bands[i];
        this.accCount++;
        this.accMs += dtMs;
        if (this.accMs < p.binMs) return;
        const bin = new Float32Array(bands.length);
        let sum = 0;
        for (let i = 0; i < bands.length; i++) sum += (bin[i] = this.acc[i] / this.accCount);
        // the balance between bands, not the loudness
        if (sum > 1e-6) for (let i = 0; i < bin.length; i++) bin[i] /= sum;
        this.acc.fill(0);
        this.accCount = 0;
        this.accMs = 0;
        this.bins.push(bin);
        const need = p.recentBins + p.gapBins + p.previousBins;
        if (this.bins.length > need) this.bins.shift();
        if (this.bins.length < need) return;
        const shift = balanceShift(this.bins, p.previousBins, p.gapBins, p.recentBins);
        const typical = median(this.shifts);
        this.shifts.push(shift);
        if (this.shifts.length > 120) this.shifts.shift();
        if (this.sinceChangeMs < p.minSongMs) return;
        if (shift >= p.shiftThreshold && (this.shifts.length < 10 || shift >= typical * p.shiftOverTypical)) this.fire('shift');
    }

    private fire(reason: SongChangeReason) {
        this.reset();
        this.onChange(reason);
    }
}

/** what the song detection reads from the audio status */
export type SongFeedStatus = Pick<AudioReactiveStatus, 'heardPlaying' | 'frame'>;

/**
 * One audio status emission into the detector: the raw bands and loudness while what is heard plays (`heardPlaying`,
 * not the live `playing`: on a resume the silence still heard is not a gap between songs), with the time since the
 * last feed (capped at 200 ms). Returns the time of this feed, or 0 when not fed (the next feed then counts no time).
 */
export function feedSongDetector(detector: SongChangeDetector, status: SongFeedStatus, nowMs: number, lastFeedMs: number) {
    if (!status.heardPlaying) return 0;
    const dt = lastFeedMs > 0 ? Math.min(200, nowMs - lastFeedMs) : 0;
    const raw = status.frame.raw;
    detector.feed(DefaultAudioBandDefinitions.map(b => raw.frequencyBands[b.key]), raw.amplitude, dt);
    return nowMs;
}

/** normalized L1 between the mean of the recent bins and the mean of the bins before the gap */
export function balanceShift(bins: ArrayLike<Float32Array>, previous: number, gap: number, recent: number) {
    const n = bins[0].length;
    const a = new Float64Array(n), b = new Float64Array(n);
    for (let k = 0; k < previous; k++) for (let i = 0; i < n; i++) a[i] += bins[k][i] / previous;
    for (let k = previous + gap; k < previous + gap + recent; k++) for (let i = 0; i < n; i++) b[i] += bins[k][i] / recent;
    let d = 0, s = 0;
    for (let i = 0; i < n; i++) {
        d += Math.abs(a[i] - b[i]);
        s += a[i] + b[i];
    }
    return s > 1e-9 ? 2 * d / s : 0;
}

function median(values: number[]) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((x, y) => x - y);
    return sorted[sorted.length >> 1];
}

/**
 * Reads a stream's titles (ICY metadata) on a connection of its own, for as long as it runs. Resolves false at once
 * where the server does not let the page read them (CORS), so the caller can fall back on the estimate
 */
export class IcyTitleReader {
    private controller?: AbortController;

    async start(url: string, onTitle: (title: string) => void): Promise<boolean> {
        this.stop();
        const controller = this.controller = new AbortController();
        let res: Response;
        try {
            res = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal: controller.signal });
        } catch {
            return false;
        }
        const metaint = Number(res.headers.get('icy-metaint'));
        if (!res.ok || !res.body || !(metaint > 0)) {
            controller.abort();
            return false;
        }
        void this.read(res.body.getReader(), metaint, onTitle, controller);
        return true;
    }

    private async read(reader: ReadableStreamDefaultReader<Uint8Array>, metaint: number, onTitle: (title: string) => void, controller: AbortController) {
        let pos = 0, metaLeft = -1;
        let meta: number[] = [];
        let last: string | undefined;
        try {
            while (!controller.signal.aborted) {
                const { value, done } = await reader.read();
                if (done || !value) break;
                let i = 0;
                while (i < value.length) {
                    if (metaLeft === -1) {
                        // audio: skipped, the page plays its own connection
                        const n = Math.min(metaint - pos, value.length - i);
                        pos += n;
                        i += n;
                        if (pos === metaint) {
                            pos = 0;
                            metaLeft = -2;
                        }
                    } else if (metaLeft === -2) {
                        metaLeft = value[i++] * 16;
                        meta = [];
                        if (metaLeft === 0) metaLeft = -1;
                    } else {
                        const n = Math.min(metaLeft, value.length - i);
                        for (let k = 0; k < n; k++) meta.push(value[i + k]);
                        metaLeft -= n;
                        i += n;
                        if (metaLeft === 0) {
                            metaLeft = -1;
                            const text = new TextDecoder().decode(new Uint8Array(meta)).replace(/\0+$/, '');
                            const title = /StreamTitle='([^']*)'/.exec(text)?.[1];
                            if (title && title !== last) {
                                // the first title is the song already playing
                                if (last !== undefined) onTitle(title);
                                last = title;
                            }
                        }
                    }
                }
            }
        } catch {
            // aborted or dropped: the estimate takes over at the next source
        }
    }

    stop() {
        this.controller?.abort();
        this.controller = undefined;
    }
}
