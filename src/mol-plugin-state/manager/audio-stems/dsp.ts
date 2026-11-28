/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * STFT helpers for the stem-separation models: every model here reads 44.1 kHz stereo through a 4096-point
 * transform with a hop of 1024, but each pads, windows and scales it its own way. HTDemucs' frequency branch is turned
 * back into audio (`inverseRealFftInPlace`) to take its stems' energy; Spleeter's and SCNet's drums and bass are turned
 * back into audio (`OverlapAddInverse`) for the stem events.
 */

export const StemSampleRate = 44100;
export const StemFftSize = 4096;
export const StemHop = 1024;

export type FFT = (re: Float64Array, im: Float64Array) => void;

/** a forward complex FFT of size `n` (power of two), in place: X[k] = sum x[j] e^{-2 pi i j k / n} */
export function makeFFT(n: number): FFT {
    const levels = Math.round(Math.log2(n));
    if (1 << levels !== n) throw new Error(`FFT size must be a power of two, got ${n}.`);
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        cos[i] = Math.cos(2 * Math.PI * i / n);
        sin[i] = Math.sin(2 * Math.PI * i / n);
    }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        let x = i, y = 0;
        for (let j = 0; j < levels; j++) {
            y = (y << 1) | (x & 1);
            x >>= 1;
        }
        rev[i] = y;
    }
    return (re, im) => {
        for (let i = 0; i < n; i++) {
            const j = rev[i];
            if (j > i) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1, step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + half; j++, k += step) {
                    const a = j + half;
                    const tre = re[a] * cos[k] + im[a] * sin[k];
                    const tim = im[a] * cos[k] - re[a] * sin[k];
                    re[a] = re[j] - tre;
                    im[a] = im[j] - tim;
                    re[j] += tre;
                    im[j] += tim;
                }
            }
        }
    };
}

/** periodic Hann window (torch.hann_window, tf.signal.hann_window(periodic=True)), not the symmetric one */
export function periodicHann(n: number) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
}

/** `x` padded on both sides by reflection (torch's 'reflect', the edge sample not repeated) or with zeros */
export function padSignal(x: Float32Array, left: number, right: number, mode: 'reflect' | 'zero') {
    const n = x.length;
    const out = new Float32Array(left + n + right);
    if (mode === 'zero' || n < 2) {
        out.set(x, left);
        return out;
    }
    const period = 2 * (n - 1);
    for (let i = 0; i < out.length; i++) {
        let j = i - left;
        if (j < 0 || j >= n) {
            j = ((j % period) + period) % period;
            if (j >= n) j = period - j;
        }
        out[i] = x[j];
    }
    return out;
}

export type Spectrogram = { re: Float32Array, im: Float32Array, frames: number, bins: number };

const ffts = new Map<number, FFT>();

/** the FFT of size `n`, made once */
export function fftOf(n: number): FFT {
    let fft = ffts.get(n);
    if (!fft) ffts.set(n, fft = makeFFT(n));
    return fft;
}

/**
 * The inverse of a one-sided spectrum, in place: bins 0 .. n/2 of `re` and `im` in, the real frame out in `re`
 * (0 .. n - 1), times n (divide by n); `im` is overwritten. x = Re(FFT(conj X)) / n for a real x.
 */
export function inverseRealFftInPlace(fft: FFT, re: Float64Array, im: Float64Array, n: number) {
    for (let k = 1; k < n / 2; k++) {
        re[n - k] = re[k];
        im[n - k] = im[k];
        im[k] = -im[k];
    }
    im[0] = -im[0];
    im[n / 2] = -im[n / 2];
    fft(re, im);
}

/**
 * Overlap-add inverse STFT into a signal of `length` samples, its buffers made once: fill `re` and `im` with bins
 * 0 .. nfft / 2 of one frame (zeros above the ones a model gives), then `addFrame`; `finish` divides each sample by the
 * sum of the squared synthesis windows over the frames that cover it (their count with no window), so a frame's own
 * STFT comes back exactly, edges included (as torch.istft and tf.signal.inverse_stft with its window_fn do)
 */
export class OverlapAddInverse {
    readonly re: Float64Array;
    readonly im: Float64Array;
    private acc: Float64Array;
    private wsum: Float64Array;
    private fft: FFT;

    constructor(readonly nfft: number, readonly length: number) {
        this.re = new Float64Array(nfft);
        this.im = new Float64Array(nfft);
        this.acc = new Float64Array(length);
        this.wsum = new Float64Array(length);
        this.fft = fftOf(nfft);
    }

    reset() {
        this.acc.fill(0);
        this.wsum.fill(0);
    }

    /** the frame in `re` / `im`, inverted, times `scale` and the window, added at sample `start` (may be negative) */
    addFrame(start: number, window: Float32Array | undefined, scale: number) {
        const { re, nfft, acc, wsum, length } = this;
        inverseRealFftInPlace(this.fft, re, this.im, nfft);
        const n0 = Math.max(0, -start), n1 = Math.min(nfft, length - start);
        for (let n = n0; n < n1; n++) {
            const w = window ? window[n] : 1;
            acc[start + n] += re[n] * scale * w;
            wsum[start + n] += w * w;
        }
    }

    /** the signal into `out`, and the buffers cleared for the next one */
    finish(out: Float32Array) {
        const { acc, wsum } = this;
        for (let i = 0; i < this.length; i++) out[i] = wsum[i] > 1e-10 ? acc[i] / wsum[i] : 0;
        this.reset();
    }
}

/**
 * STFT of an already padded signal: frames start every `hop` samples with no further padding; the first `bins` bins
 * of each, frame-major, multiplied by `scale`. No window where `window` is undefined.
 */
export function stft(x: Float32Array, nfft: number, hop: number, window: Float32Array | undefined, scale: number, bins: number): Spectrogram {
    const fft = fftOf(nfft);
    const frames = Math.max(0, Math.floor((x.length - nfft) / hop) + 1);
    const re = new Float32Array(frames * bins);
    const im = new Float32Array(frames * bins);
    const fr = new Float64Array(nfft);
    const fi = new Float64Array(nfft);
    for (let f = 0; f < frames; f++) {
        const o = f * hop;
        for (let i = 0; i < nfft; i++) {
            fr[i] = x[o + i] * (window ? window[i] : 1);
            fi[i] = 0;
        }
        fft(fr, fi);
        for (let b = 0; b < bins; b++) {
            re[f * bins + b] = fr[b] * scale;
            im[f * bins + b] = fi[b] * scale;
        }
    }
    return { re, im, frames, bins };
}

/**
 * Streaming linear resampler, one per channel: keeps the fractional position and the last input sample across
 * calls, so consecutive chunks resample as one signal
 */
export class LinearResampler {
    private position = 0;
    private last = 0;
    private primed = false;

    constructor(private ratio: number) { }

    /** input at the source rate, output at the target rate (`ratio` = source / target) */
    process(input: Float32Array): Float32Array {
        if (this.ratio === 1) return input;
        const out: number[] = [];
        // positions are relative to `last` (index -1) followed by `input`
        let pos = this.primed ? this.position : 1;
        const n = input.length;
        while (pos < n) {
            const i = Math.floor(pos);
            const t = pos - i;
            const a = i === 0 ? this.last : input[i - 1];
            const b = input[i] ?? a;
            out.push(a + (b - a) * t);
            pos += this.ratio;
        }
        this.position = pos - n;
        if (n > 0) this.last = input[n - 1];
        this.primed = true;
        return Float32Array.from(out);
    }

    reset() {
        this.position = 0;
        this.last = 0;
        this.primed = false;
    }
}
