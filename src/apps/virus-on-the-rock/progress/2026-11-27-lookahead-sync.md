# Lookahead sync (2026-11-27, lane `lookahead-sync`)

## Brief

- **Asked** (Ludo's words): "we can use longer delay to ensure the synchronisation is perfect and there is no mismatch,
  its especially visible with drum and bass. 20 seconds is fine, the important thing is audio sync." **Check:**
  `angine.mp3` with HTDemucs and Audio Delay 20 s: the burst hits *on* the kick and the bass, not after it; clicksync's
  heard column reads ≈ 0 ms.
- **Why it is late today:** the analyser sits after the delay line, so it reads the audio only as it is heard, then
  needs its own lag to see a kick: FFT window, reactor attack, route attack, one frame. Measured 2026-11-27 in Ludo's
  Chrome: heard kick → drive peak +51/+58/+65 ms (32 ms output). The delay line already holds the next D seconds of
  audio: use it as lookahead.
- **Build:**
  1. The analysis runs Δ ahead of what is heard: the analyser reads the source through its own delay of D − Δ (a
     second DelayNode off the source tap, or an equivalent the design picks), the stems are sampled at the same
     moment (t − D + Δ), and the presented ring (output latency L) stays as it is. Δ is the pipeline's measured
     kick → peak lag for the routes in use (or one global number from the harness), with a param to adjust it.
     Releases, onsets and stems timing stay in real time; with D = 0 nothing changes (bit-identical goldens).
  2. The delay works without a stem model: a small default D (≥ Δ + margin, e.g. 0.25 s) whenever lookahead is on,
     the model's or the slider's D with a model.
  3. An "Audio Delay" slider in the Stem Separation card (the existing `stemDelaySeconds`, max 25), and the lookahead
     param where it belongs in the UI.
  4. `examples/angine.mp3` copied into the build (D9, TODO 3), so `examples/angine.mp3` loads from Audio URL and the
     startup fallback plays.
- **Spec:** `_spec/audio-routing-spec.md` expectations: "kick → peak ≤ 50 ms + one frame" becomes "|heard kick →
  peak| ≤ one frame" whenever a delay ≥ Δ is on; architecture.md records the lookahead and Δ.
- **Tests:** (the harness of `measure`, `manager/_spec/audio-pipeline-helper.ts`, failing first)
  - kick track, Drums & Bass Burst, D = 1 s, lookahead on: heard kick → peak within one frame (today ≈ +3–4 frames);
  - D = 0 or lookahead off: every golden bit-identical;
  - stems line up with the bands: a stub separator whose stem energies are the kick, sampled at t − D + Δ, peaks on
    the same frame as the band drums (proves the stem path adds no offset of its own);
  - pause/stop/clear rows of sound-stops still hold with lookahead (heardUntil uses the heard delay D, not D − Δ);
  - clicksync heard column, in Ludo's Chrome: median |kick → peak| ≤ one frame, recorded in the PR.
- **Open for the design:** whether the real HTDemucs stem timeline (chunked, windowed energies) carries its own offset
  against the bands; measure it (a click track through the real model, headed Chrome with WebGPU) and correct it in
  the stem sampling time if it does.
- **Touches:** `mol-plugin-state/manager/audio-reactive-animation.ts` (graph, tick, stems sampling),
  `audio-reactor.ts` only if Δ needs a reading from it, `audio-stems/stem-separator.ts` (sampling time), the Stem
  Separation card, `scripts/build.mjs` (copy angine.mp3), `scripts/votr-sync/clicksync.mjs` (a delay/lookahead option),
  specs; **stays off:** nothing else in flight.
- **Size:** ~80 production lines.
- **Lane model:** Opus: the per-frame audio path and a timing design.
- **Steps and models:** 1. design (Opus, read-only, into this file) 2. build test-first (Opus) 3. checks (Sonnet)
  4. gate (lane-reviewer, lane-skeptic, Opus) 5. browser measure in Ludo's Chrome on port 1351 (coordinator).
- **Base:** `votr/overnight` (PR #75 not merged yet); the PR goes into `votr/overnight`, so it rides #75.

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
