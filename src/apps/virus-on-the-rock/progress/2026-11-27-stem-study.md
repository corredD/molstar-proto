# Stem study (2026-11-27, on `votr/lookahead-sync`, Ludo's workstation)

## Asked

Ludo: "I don't think it's working, may we need to study more the demux, use angine.mp3 preprocess with all three
models, so we can check what is actually generated", then "Fix both here" for the two problems the study found.

## Studied

All three models on `examples/angine.mp3` (Angine de Poitrine, live on KEXP, 5 min 13 s), offline in Node through the
app's own runners (`createStemRunner` with a recording onnxruntime-web, wasm, CPU): each model's reference separation
as its authors run it (demucs apply_model overlap 0.25; SCNet as Music-Source-Separation-Training's demix, 4 overlaps
with fades; Spleeter as deezer/spleeter, one global STFT, 512-frame splits, exponent-2 ratio masks, zeros above
11 kHz), inverted to stem audio; the worker's streaming windows replayed (stem-worker `maybeRun`); the real
`StemSeparator.sample()` at 60 fps on both timelines. Then live in the app (WebGPU): each model's separator timeline
against the offline replay over the same seconds, and model switches mid-run. The tool and its report are untracked,
in the workstation's `tmp/votr-stems/` (`study.ts`; report `tmp/votr-stems/angine/index.html`).

- **The separation works and is on time.** Bass stems 96–97 % under 200 Hz, drums 77–83 %; the stems add back to the
  mix at 31 / 35 / 39 dB (Spleeter / HTDemucs / SCNet). Against 699 kicks in the HTDemucs reference drums, the app's
  drums energy peaks at −5 to 0 ms (quartiles ±9 ms), as the reference does; best-fit stamp offsets −6 to 0 ms. The
  three models agree within 5 ms: lookahead-sync's S4 needs no per-model `timelineLeadSeconds` from this (the 30 ms
  itself, against the band path, is not measured here).
- **Levels follow** the same pipeline fed the reference: drums 0.97 / 0.98 / 0.94, bass 0.98 / 0.96 / 0.98.
- **Live matches offline**: correlation 0.996–0.999 per stem for HTDemucs and SCNet, 0.98–0.99 for Spleeter (its
  *other* 0.81), best lag 0 to −5 ms, ≤ 1 dB apart, no zero frames.
- **Found 1: a model switch during a run breaks the worker** (reproduced twice live: `failed to call OrtRun()`,
  `RuntimeError: null function`, each posted under the new model's name; once, after a cold HTDemucs load with a run
  probably in flight, `memory access out of bounds` for every later model until a reload). `load()` disposed the old
  runner while `maybeRun`'s run was in flight; the catch posted the module's current `model`.
- **Found 2: HTDemucs read quiet passages 15–17 dB loud.** `stem-models.ts` took the frequency branch's spectral energy
  (×4/3) plus the time branch's over a rectangular hop. Against the energy of the run's own audio: +15 to +17 dB in
  frames 40–60 dB under the stem's peak, right when loud. The branches partly cancel (summing their energies alone:
  ≈ +10 dB), and the spectral shortcut 4/3 |x + STFT(xt)|² still read +13 to +15 dB (the model's frequency output is
  no signal's spectrum). Effect: *other* followed the reference at 0.76 (0.96 / 0.99 for the other models), vocals
  (nearly absent in the song) averaged a level of 0.25 against 0.05.
- **No change needed**: SCNet's input normalization (with or without, within 0.5 dB against HTDemucs); Spleeter's
  preprocessing matches deezer/spleeter.

## Built

- `stem-worker-core.ts`: the worker's logic as `StemWorkerCore` with ports (post, prepare, createRunner, now);
  `stem-worker.ts` wires onnxruntime-web and the messages. A model switch or Off waits for the run in flight before
  disposing the old runner; a run's error is posted under its own model, and not at all when a load or Off came since.
  Spec `stem-worker-core.spec.ts`: 3 red on the extracted logic (dispose during a run on a switch and on Off, the error
  under the new model), 2 guards.
- `stem-models.ts`: `demucsSpec` (the runner's `_spec`, extracted) and `demucsStemEnergies`: the frequency branch
  inverted as demucs' `_ispec` (a zero top bin, 2 zero frames each side, torch.istft centred and normalized), plus the
  time branch, Hann-4096 frame energies in hop units (unchanged units: a single branch reads as before). `dsp.ts`:
  `fftOf`, `inverseRealFftInPlace`. Spec `demucs-energy.spec.ts`: cancelling branches read ≥ 40 dB under the signal
  (red: +3 dB; the remainder is the Nyquist bin `_spec` drops), one branch alone reads its Hann energy within 0.1 dB
  (a guard, green before too); `dsp.spec.ts`: the inverse gives the frame back.
- The newest frames (after a review: the app keeps them, the first tests and checks skipped the segment's ends): a
  window cut by the segment's end divided by the full window weight read ≈ 1 dB low (drums / bass / other −0.9 / −1.1
  / −1.1 dB at the newest frame); the energy is now normalized by the window weight inside the segment (+0.3 / +0.1 /
  +0.1 dB). Spec: a tone in the time branch reads flat through the first and last frames (red: 2.2 dB off).
- Offline on the fixed code (60 s excerpt): the app's HTDemucs energy equals its audio's (correlation 1); timeline
  against the reference 0.999 / 0.999 / 0.996, levels 0.999 / 0.999 / 0.997 (drums / bass / other), offsets 0 ms.

## Decided

- Fix the worker by waiting for the run in flight rather than creating the new model alongside (onnxruntime-web's
  WebGPU backend creates one session at a time); a switch can wait up to one run (≤ 6 s with SCNet under load)
  (builder).
- HTDemucs' energy from its audio in Hann-4096 frames (the study's reference framing, within 0.4 dB of the overlap-add
  reference at every level) rather than a rectangular hop (builder).
- `_ispec` exactly as demucs, its fade of the frequency branch at the segment's ends kept (measured, whole song: counting
  only the frames that exist read the newest frames higher, drums +0.7 / other +0.5 / vocals +16 dB against +0.3 / +0.1
  / +14.3: the model's time branch carries the ends) (builder).
- The near-silent vocals' newest frames read +14 dB (+9 dB the frame before) with either `_ispec`: the model's own output
  at its window's end, not the energy; the vocals level is unchanged by it (0.048, the reference's). Left with the
  newest-frame item in TODO.md (builder).
- The fixes ride `votr/lookahead-sync` (Ludo, "Fix both here").

## Learned

- A model's frequency output can hold energy that its inverse transform cancels: measure stems from their audio.
- The app keeps each run's newest frames, the edge every model handles worst: a check that skips a window's ends misses
  what the visuals read.
- The studies' kick detector must read a drums stem, not the mix's low band (the bass guitar's notes count otherwise).

## Size

Production: `stem-worker-core.ts` 180 lines (≈ 160 moved from `stem-worker.ts`, ≈ 10 new), `stem-worker.ts` −150;
`stem-models.ts` +80; `dsp.ts` +25. Tests +200.

## Checks

- `npm run lint` without the untracked `tmp/` (`npx eslint . --ignore-pattern "tmp/**"`): 0 errors, the 2 old `app.tsx`
  warnings; `npx tsc --noEmit -p tsconfig.json` clean; `npx jest src/apps/virus-on-the-rock src/mol-plugin-state
  src/mol-repr/structure`: 21 suites, 236 tests; `node ./scripts/build.mjs -a virus-on-the-rock --prd` done.
- `demucsStemEnergies`: ≈ 505 ms per 5 s chunk in Node; live HTDemucs load factor 0.25 → 0.33.
- Whole song offline, HTDemucs before → after (reference): *other* level mean 0.79 → 0.69 (0.70), against the reference
  0.76 → 0.98; vocals mean 0.25 → 0.048 (0.048), 0.83 → 0.997; drums 0.976 → 0.991; bass 0.959 → 0.957; stamp lag 0 ms;
  kicks: drums energy peak −1 ms, half-rise −28 ms (the reference's). Newest frame: drums / bass / other / vocals
  +0.3 / +0.1 / +0.1 / +14.3 dB (before: −0.1 / −0.4 / 0 / +1.0 with the old formula); energy jump at run boundaries
  3.9 / 1.9 / 1.6 / 6.5 dB against 2.9 / 0.7 / 0.8 / 0 elsewhere (before 2.5 / 1.4 / 1.1 / 0.5).
- Live (WebGPU, this workstation's in-app browser), fixed code: HTDemucs → SCNet 0.4 s into a run, and SCNet →
  Spleeter 1.5 s into a run: no error; the new model loads once the run in flight ends (1.4–1.6 s), then runs. Before:
  `RuntimeError: null function`, `failed to call OrtRun()`. HTDemucs live against the final offline replay: 0.998 /
  0.997 / 0.976 / 0.997 (drums / bass / other / vocals), lag 0 to −5 ms, load 0.34 (*other* 0.997 before the fix: the
  energy is now what is left where two fp16 branches cancel).
- Not run: `clicksync --stems htdemucs`; Off then another model at once (the new sessions are created while the old run
  ends, the old model disposed after it); the `memory access out of bounds` state on purpose (its fix inferred from the
  same cause).
- Not run: Ludo's Chrome, by ear.
