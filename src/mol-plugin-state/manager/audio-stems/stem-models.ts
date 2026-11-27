/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Music source-separation models run with onnxruntime-web, each reduced to what the visuals need: the energy of each
 * stem per STFT hop (no inverse STFT, no audio out). Inputs and layouts follow each model's card.
 */

import type * as Ort from 'onnxruntime-web';
import { fftOf, inverseRealFftInPlace, padSignal, periodicHann, stft, StemFftSize, StemHop } from './dsp';

export const StemNames = ['drums', 'bass', 'other', 'vocals'] as const;
export type StemName = typeof StemNames[number];
export type StemEnergies = Record<StemName, Float32Array>;

export const StemModelIds = ['spleeter', 'htdemucs', 'scnet'] as const;
export type StemModelId = typeof StemModelIds[number];

export type StemModelInfo = {
    id: StemModelId,
    label: string,
    /** samples (44.1 kHz) of context each run reads */
    windowSamples: number,
    /** new samples between runs: the frames of the window's last `chunkSamples` are kept */
    chunkSamples: number,
    /** how late the listener hears the audio by default: a chunk, the run and some margin, seconds */
    delaySeconds: number,
    /**
     * how far this model's stem timeline runs ahead of the band analysis, seconds: frames stamped at their window's
     * centre, the bands read the end of theirs. Lookahead samples the stems this much less ahead
     */
    timelineLeadSeconds: number,
    /** the weights' files, relative to the model's base URL */
    files: string[],
    /** where the weights are served from when they are not next to the app (CORS-enabled), pinned to a commit */
    remoteBaseUrl: string,
    description: string,
};

export const StemModels: Record<StemModelId, StemModelInfo> = {
    spleeter: {
        id: 'spleeter',
        label: 'Spleeter 4-stem',
        windowSamples: 508 * StemHop, // one 512-frame split: ceil((508 + 4) hops of padded signal)
        chunkSamples: 2 * 44100,
        delaySeconds: 6,
        timelineLeadSeconds: 0.030, // not measured: the framing stub's value (lane lookahead-sync)
        files: ['drums.fp16.onnx', 'bass.fp16.onnx', 'other.fp16.onnx', 'vocals.fp16.onnx'],
        remoteBaseUrl: 'https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/main/',
        description: 'Deezer Spleeter 4 stems (fp16 ONNX, 4 x 19.7 MB): fastest; magnitudes only, up to 11 kHz.',
    },
    htdemucs: {
        id: 'htdemucs',
        label: 'HTDemucs',
        windowSamples: 343980,
        chunkSamples: 5 * 44100,
        delaySeconds: 10,
        timelineLeadSeconds: 0.030,
        files: [...Array.from({ length: 21 }, (_, i) => `htdemucs_p${`${i}`.padStart(2, '0')}.onnx`), 'htdemucs_split_manifest.json'],
        remoteBaseUrl: 'https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/main/',
        description: 'Meta HTDemucs v4 (21 fp16 pieces, 126 MB): the best separation, paced between pieces.',
    },
    scnet: {
        id: 'scnet',
        label: 'SCNet',
        windowSamples: 485100,
        chunkSamples: 6 * 44100,
        delaySeconds: 11,
        timelineLeadSeconds: 0.030, // not measured: the framing stub's value (lane lookahead-sync)
        files: ['scnet.int8.onnx'],
        remoteBaseUrl: 'https://huggingface.co/audiojs/scnet/resolve/main/',
        description: 'SCNet (int8 ONNX, 12.9 MB): the smallest download, the heaviest to run.',
    },
};

export type StemRunResult = {
    energies: StemEnergies,
    /** window-local sample position of each frame's centre */
    centers: Float64Array,
};

export type StemRunner = {
    run(left: Float32Array, right: Float32Array): Promise<StemRunResult>,
    dispose(): Promise<void>,
};

export type StemRunnerContext = {
    ort: typeof Ort,
    baseUrl: string,
    executionProvider: 'webgpu' | 'wasm',
    /** awaited between the GPU submissions of one run, so the renderer sharing the GPU keeps its frames */
    yieldToRenderer: () => Promise<void>,
};

function emptyEnergies(frames: number): StemEnergies {
    return { drums: new Float32Array(frames), bass: new Float32Array(frames), other: new Float32Array(frames), vocals: new Float32Array(frames) };
}

function sessionOptions(ctx: StemRunnerContext, extra: object = {}): Ort.InferenceSession.SessionOptions {
    if (ctx.executionProvider === 'webgpu') {
        return { executionProviders: [{ name: 'webgpu', ...extra } as Ort.InferenceSession.ExecutionProviderConfig], graphOptimizationLevel: 'all' };
    }
    return { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
}

const hann = periodicHann(StemFftSize);

/** Spleeter: magnitudes [2, splits, 512, 1024] in, each stem's magnitude estimate out; a soft ratio mask over the four */
async function createSpleeter(ctx: StemRunnerContext): Promise<StemRunner> {
    const { ort } = ctx;
    const sessions: Ort.InferenceSession[] = [];
    for (const stem of StemNames) {
        sessions.push(await ort.InferenceSession.create(`${ctx.baseUrl}${stem}.fp16.onnx`, sessionOptions(ctx)));
    }
    const T = 512, B = 1024;
    return {
        async run(left, right) {
            // tf.signal.stft after one frame of leading zeros, pad_end: 512 frames for the window
            const n = left.length + StemFftSize;
            const frames = Math.min(T, Math.ceil(n / StemHop));
            const padRight = (frames - 1) * StemHop + StemFftSize - n;
            const x = new Float32Array(2 * T * B);
            const power = new Float32Array(2 * frames * B);
            [left, right].forEach((ch, c) => {
                const { re, im } = stft(padSignal(ch, StemFftSize, Math.max(0, padRight), 'zero'), StemFftSize, StemHop, hann, 1, B);
                for (let f = 0; f < frames; f++) {
                    for (let b = 0; b < B; b++) {
                        const p = re[f * B + b] ** 2 + im[f * B + b] ** 2;
                        power[(c * frames + f) * B + b] = p;
                        x[(c * T + f) * B + b] = Math.sqrt(p);
                    }
                }
            });
            const estimates: Float32Array[] = [];
            for (const session of sessions) {
                const input = new ort.Tensor('float32', x, [2, 1, T, B]);
                const out = await session.run({ [session.inputNames[0]]: input });
                estimates.push(out[session.outputNames[0]].data as Float32Array);
                await ctx.yieldToRenderer();
            }
            const energies = emptyEnergies(frames);
            const perStem = StemNames.map(s => energies[s]);
            for (let c = 0; c < 2; c++) {
                for (let f = 0; f < frames; f++) {
                    for (let b = 0; b < B; b++) {
                        const i = (c * T + f) * B + b;
                        let total = 1e-10;
                        for (let s = 0; s < 4; s++) total += estimates[s][i] ** 2;
                        const p = power[(c * frames + f) * B + b] / total;
                        for (let s = 0; s < 4; s++) perStem[s][f] += p * estimates[s][i] ** 2;
                    }
                }
            }
            // frame f covers padded samples [f * hop, f * hop + nfft), the padding one nfft of zeros
            const centers = Float64Array.from({ length: frames }, (_, f) => f * StemHop + StemFftSize / 2 - StemFftSize);
            return { energies, centers };
        },
        async dispose() {
            for (const s of sessions) await s.release();
        },
    };
}

const DemucsCpuNodes = ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div',
    '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'];

type DemucsManifest = { pieces: { file: string, inputs: string[], outputs: string[] }[], outputs?: { freq?: string, time?: string } };

const DemucsBins = 2048;

/**
 * demucs' _spec of one channel: reflect pad, torch.stft centred and normalized, the last bin dropped, frames 2 .. 2 + le;
 * its real and imaginary parts written into planes `rePlane` and `imPlane` of `out` ([plane][bin][frame], le frames)
 */
export function demucsSpec(ch: Float32Array, length: number, out: Float32Array, rePlane: number, imPlane: number) {
    const le = Math.ceil(length / StemHop);
    const p1 = (StemHop / 2) * 3;
    const a = padSignal(ch.subarray(0, length), p1, p1 + le * StemHop - length, 'reflect');
    const { re, im } = stft(padSignal(a, StemFftSize / 2, StemFftSize / 2, 'reflect'), StemFftSize, StemHop, hann, 1 / Math.sqrt(StemFftSize), DemucsBins);
    for (let t = 0; t < le; t++) {
        for (let b = 0; b < DemucsBins; b++) {
            out[(rePlane * DemucsBins + b) * le + t] = re[(t + 2) * DemucsBins + b];
            out[(imPlane * DemucsBins + b) * le + t] = im[(t + 2) * DemucsBins + b];
        }
    }
}

const hannSquared = Float64Array.from(hann, w => w * w);
/**
 * torch.istft's window sum over _ispec's le frames and its 2 zero frames each side, by le. As demucs: the frequency
 * branch fades over the segment's first and last 1536 samples and the model's time branch carries them (counting only
 * the frames that exist read the newest frames higher against the reference, drums +0.7 dB against +0.3; stem study
 * 2026-11-27)
 */
const demucsWindowSums = new Map<number, Float64Array>();

function demucsWindowSum(le: number) {
    let wsum = demucsWindowSums.get(le);
    if (wsum) return wsum;
    wsum = new Float64Array((le + 3) * StemHop + StemFftSize);
    for (let k = 0; k < le + 4; k++) {
        for (let n = 0; n < StemFftSize; n++) wsum[k * StemHop + n] += hannSquared[n];
    }
    demucsWindowSums.set(le, wsum);
    return wsum;
}

/**
 * demucs' _ispec of one channel of one stem: planes `rePlane` / `imPlane` of `x`, a zero bin on top and 2 zero frames
 * each side, torch.istft centred and normalized (Hann), cropped by pad = 1536; added into `out` (length samples).
 * `buf`, `re`, `im`: scratch of the window sum's length and the FFT size.
 */
function demucsISpecInto(x: Float32Array, rePlane: number, imPlane: number, le: number, length: number, out: Float32Array, buf: Float64Array, re: Float64Array, im: Float64Array) {
    const N = StemFftSize, fft = fftOf(N), wsum = demucsWindowSum(le);
    // torch.istft's normalized frames times sqrt(N), the inverse FFT's 1 / N
    const scale = Math.sqrt(N) / N;
    buf.fill(0);
    for (let t = 0; t < le; t++) {
        for (let b = 0; b < DemucsBins; b++) {
            re[b] = x[(rePlane * DemucsBins + b) * le + t];
            im[b] = x[(imPlane * DemucsBins + b) * le + t];
        }
        re[DemucsBins] = 0;
        im[DemucsBins] = 0;
        inverseRealFftInPlace(fft, re, im, N);
        const start = (t + 2) * StemHop;
        for (let n = 0; n < N; n++) buf[start + n] += re[n] * scale * hann[n];
    }
    const offset = N / 2 + (StemHop / 2) * 3;
    for (let n = 0; n < length; n++) {
        const w = wsum[n + offset];
        if (w > 1e-11) out[n] += buf[n + offset] / w;
    }
}

/**
 * Each stem's energy per frame (centres t · hop + hop / 2) from HTDemucs' frequency branch `x` [4, 4, 2048, le] (per
 * stem: L re, L im, R re, R im) and time branch `xt` [4, 2, length]: the energy of the stem's audio (the frequency
 * branch inverted as demucs does, plus the time branch) in a Hann-4096 window, in hop units (a steady power P reads
 * hop · P per channel). Not the sum of the two branches' energies: they partly cancel, and the frequency branch is no
 * signal's spectrum, so its spectral energy overstates its audio (quiet passages read 15-17 dB loud; core-changes.md,
 * audio-stems, stem study 2026-11-27).
 */
export function demucsStemEnergies(x: Float32Array, xt: Float32Array, length: number): StemEnergies {
    const le = Math.ceil(length / StemHop);
    const energies = emptyEnergies(le);
    const audio = [new Float32Array(length), new Float32Array(length)];
    const buf = new Float64Array(demucsWindowSum(le).length);
    const re = new Float64Array(StemFftSize), im = new Float64Array(StemFftSize);
    for (let s = 0; s < 4; s++) {
        for (let c = 0; c < 2; c++) {
            audio[c].set(xt.subarray((s * 2 + c) * length, (s * 2 + c + 1) * length));
            demucsISpecInto(x, s * 4 + c * 2, s * 4 + c * 2 + 1, le, length, audio[c], buf, re, im);
        }
        const e = energies[StemNames[s]];
        const [l, r] = audio;
        for (let t = 0; t < le; t++) {
            const from = t * StemHop + StemHop / 2 - StemFftSize / 2;
            // a window that runs past the segment reads the power of its part inside: the newest frames are kept
            let sum = 0, weight = 0;
            for (let j = Math.max(0, -from), j1 = Math.min(StemFftSize, length - from); j < j1; j++) {
                const i = from + j;
                sum += hannSquared[j] * (l[i] * l[i] + r[i] * r[i]);
                weight += hannSquared[j];
            }
            e[t] = weight > 0 ? sum * StemHop / weight : 0;
        }
    }
    return energies;
}

/**
 * HTDemucs in 21 chained pieces: waveform and complex spectrogram in, a frequency branch [1, 4, 4, 2048, 336] and a
 * time branch [1, 4, 2, 343980] out (both denormalized in the graph). A stem's energy is that of its audio, both branches
 * summed (demucsStemEnergies).
 */
async function createHTDemucs(ctx: StemRunnerContext): Promise<StemRunner> {
    const { ort } = ctx;
    const manifest = await (await fetch(`${ctx.baseUrl}htdemucs_split_manifest.json`)).json() as DemucsManifest;
    const gpu = ctx.executionProvider === 'webgpu';
    const sessions: Ort.InferenceSession[] = [];
    for (let i = 0; i < manifest.pieces.length; i++) {
        // the input normalization is fp16-fragile on WebGPU (NaN): pinned to the CPU
        const options = sessionOptions(ctx, gpu && i === 0 ? { forceCpuNodeNames: DemucsCpuNodes } : {});
        if (gpu) options.preferredOutputLocation = 'gpu-buffer';
        sessions.push(await ort.InferenceSession.create(`${ctx.baseUrl}${manifest.pieces[i].file}`, options));
    }
    const freqName = manifest.outputs?.freq ?? 'x';
    const timeName = manifest.outputs?.time ?? 'xt';
    const L = 343980;
    const le = Math.ceil(L / StemHop); // 336 frames
    return {
        async run(left, right) {
            const mix = new Float32Array(2 * L);
            mix.set(left.subarray(0, L), 0);
            mix.set(right.subarray(0, L), L);
            const mag = new Float32Array(4 * DemucsBins * le);
            demucsSpec(mix.subarray(0, L), L, mag, 0, 1);
            demucsSpec(mix.subarray(L), L, mag, 2, 3);
            const values = new Map<string, Ort.Tensor>([
                ['mix', new ort.Tensor('float32', mix, [1, 2, L])],
                ['mag', new ort.Tensor('float32', mag, [1, 4, 2048, le])],
            ]);
            const produced: Ort.Tensor[] = [];
            try {
                for (let i = 0; i < sessions.length; i++) {
                    const feeds: Record<string, Ort.Tensor> = {};
                    for (const name of manifest.pieces[i].inputs) feeds[name] = values.get(name)!;
                    const out = await sessions[i].run(feeds);
                    for (const [k, v] of Object.entries(out)) {
                        values.set(k, v);
                        produced.push(v);
                    }
                    await ctx.yieldToRenderer();
                }
                const x = await values.get(freqName)!.getData() as Float32Array;
                const xt = await values.get(timeName)!.getData() as Float32Array;
                const energies = demucsStemEnergies(x, xt, L);
                const centers = Float64Array.from({ length: le }, (_, t) => t * StemHop + StemHop / 2);
                return { energies, centers };
            } finally {
                for (const t of produced) t.dispose();
            }
        },
        async dispose() {
            for (const s of sessions) await s.release();
        },
    };
}

/** SCNet: complex spectrogram [1, 4, 2049, 476] of an 11 s segment in (no window), each stem's [L, R] x [re, im] out */
async function createSCNet(ctx: StemRunnerContext): Promise<StemRunner> {
    const { ort } = ctx;
    const session = await ort.InferenceSession.create(`${ctx.baseUrl}scnet.int8.onnx`, sessionOptions(ctx));
    const L = 485100, F = 476, B = 2049;
    const frames = Math.floor(L / StemHop) + 1; // 474, zero frames after
    return {
        async run(left, right) {
            const spec = new Float32Array(4 * B * F);
            [left, right].forEach((ch, c) => {
                const { re, im } = stft(padSignal(ch.subarray(0, L), StemFftSize / 2, StemFftSize / 2, 'reflect'), StemFftSize, StemHop, undefined, 1 / Math.sqrt(StemFftSize), B);
                for (let t = 0; t < frames; t++) {
                    for (let b = 0; b < B; b++) {
                        spec[((c * 2) * B + b) * F + t] = re[t * B + b];
                        spec[((c * 2 + 1) * B + b) * F + t] = im[t * B + b];
                    }
                }
            });
            const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', spec, [1, 4, B, F]) });
            const y = out[session.outputNames[0]].data as Float32Array;
            const energies = emptyEnergies(frames);
            for (let s = 0; s < 4; s++) {
                const e = energies[StemNames[s]];
                for (let cc = 0; cc < 4; cc++) {
                    for (let b = 0; b < B; b++) {
                        const base = ((s * 4 + cc) * B + b) * F;
                        for (let t = 0; t < frames; t++) e[t] += y[base + t] ** 2;
                    }
                }
            }
            const centers = Float64Array.from({ length: frames }, (_, t) => t * StemHop);
            return { energies, centers };
        },
        async dispose() {
            await session.release();
        },
    };
}

export function createStemRunner(id: StemModelId, ctx: StemRunnerContext): Promise<StemRunner> {
    switch (id) {
        case 'spleeter': return createSpleeter(ctx);
        case 'htdemucs': return createHTDemucs(ctx);
        case 'scnet': return createSCNet(ctx);
    }
}
