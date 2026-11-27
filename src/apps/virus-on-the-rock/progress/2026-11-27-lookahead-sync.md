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

## Design (Opus architect, read-only; measured with the real `tick` through a copy of the harness)

**Measured** (heard kick → drive peak, ms, median; L = 32 ms): 16 ms frames, Δ 0: full 38, drums only 18, bass only 42,
Ambient Pulse wiggle 90; Δ 33.3 (auto): 6 / −14 / 10, Ambient 14 at Δ 76.4. 49 ms frames, Δ 0: 57 / 49 / 59 (Ludo's
Chrome 51/58/65); Δ 33.3: 20 / 20 / 28. Routes rise at once (audio-routing.ts:218–221): the lag is the reactor's, ½
input window + `bandAttackMs` (level) or `beatAttackMs` (onset), + a frame. Stem stub (centre-stamped Hann-4096, hop
1024, `sample()`'s dB mapping) runs ≈ 30 ms ahead of the band path; stamps themselves are right (stem-worker.ts:130).

1. **Graph, a parallel analysis branch:** `source → delayNode (D) → destination` (heard, unchanged);
   `source → analysisDelayNode (D − Δ) → analyser → analysisSink (gain 0) → destination`; stem tap unchanged.
   `delayNode.delayTime` stays the heard D, so heardUntil, primedUntil and the separator reset keep their meaning; a Δ
   change moves only the analysis branch (no click). Cost: a second 30 s buffer (~11.5 MB). `flushDelayLine` replaces
   both nodes; `dispose` disconnects both.
2. **tick:** `heardAt(playing, offsetS)` (no allocation); `leadS = delayS − analysisDelay` (0 without the node);
   `heard = heardAt(playing, 0)` feeds the router floor and `presentFrame`; `analysed = heardAt(playing, leadS)` decides
   whether the analyser is read and `silenceWhilePlayingMs`; `stemLeadS = max(0, leadS − StemTimelineLeadS)`,
   `updateStems(dtMs, !heardAt(playing, stemLeadS))`. Ring and L unchanged (Δ excludes L). Tail [stop + D − Δ, stop + D):
   analysis reads silence, the floor holds, routes release, visuals end with the sound. Restart [start + D − Δ,
   start + D): analysis warms, router not heard; a kick in the first Δ of a song is partly lost.
3. **Δ** = lookahead ? clamp(½ · inputSampleCount / sampleRate + bandAttackMs/1000 + lookaheadTrimMs/1000, 0, D) : 0,
   `getAnalysisLeadSeconds(params, sampleRate)`. Burst 33.3 ms, Ambient Pulse 76.4 ms at 48 kHz. Params:
   `lookahead: PD.Boolean(false)` (category Sync), `lookaheadTrimMs: PD.Numeric(0, −50..100)`; `stemDelaySeconds` to
   category Sync, `hideIf: stemModel off && !lookahead`.
4. **Delay without a model:** `getAudioDelaySeconds` (renames `getStemDelaySeconds`): model → slider or model default;
   no model + lookahead → slider or `LookaheadDelaySeconds = 0.25`; else 0.
5. **Stems** sampled at `clockNow − D + stemLeadS`, `StemTimelineLeadS = 0.030` (stub; confirm with HTDemucs in the
   browser, per-model `timelineLeadSeconds` if it differs by ≥ a frame). Lookahead off: exactly t − D.
6. **UI:** Stem Separation card: Audio Delay slider (0–25 s, Mol* `Slider`, commits on release), Lookahead chips, Lead
   Trim slider, help "analysis X ms ahead / heard Y s late"; fix the Off title's "with no delay". **Build:**
   `scripts/build.mjs` copies `examples/angine.mp3`. **Startup:** catalog `DefaultAudioSync = { lookahead: true }`,
   applied in app.tsx `initializeDefaults` before `loadDefaultAudio`.
7. **clicksync:** `--delay <s>`, `--lookahead [--trim <ms>]` (explicitly false without it), `--stems <model>`; params set
   before load; track length seconds + D + 2; heard uses the delay node's D; report stemsSeparated frames apart;
   windows on the heard column; header prints D, Δ, model.
8. **Tests** (audio-pipeline.spec.ts › lookahead; helper gains `lookahead`, `lookaheadTrimMs`, fake `analysisDelayNode`,
   offset read from what the manager set): (1) D 1 s, Burst, kick: heard kick → symAxis peak within one frame (full,
   bass only); (2) drums onset route median within a frame, never > 2 frames early; (3) Ambient Pulse within a frame;
   (4) lookahead off: goldens, DERIVED, sound-stops unchanged; (5) trim making Δ = 0 equals lookahead off, `toBe` frame
   for frame; (6) the two delay functions' table; (7) stems line up with the bands (real `StemSeparator.sample`, timeline
   filled through `onWorkerMessage`), control at t − D + Δ ≥ 2 frames early; (8) separator samples t − D + max(0,
   Δ − 30 ms), never before start or after stop; (9) pause mid-kick with D 1 s: drives equal the unpaused run until
   stop + D − Δ, heardPlaying until stop + D; end of file the same; (10) stop/new source/clear flush both nodes (ports
   spec); (11) restart: not heard for D, analysed from D − Δ, no blocked analysis; (12) trim/preset change moves only the
   analysis delay, no separator reset; D change resets. Ports-spec wiring logs change (listed apart from goldens).
9. **Size:** ~85 production lines (manager ~45, card ~35, catalog/app ~4, build 1).

**Departures from the brief, for Ludo:** (a) stems at t − D + max(0, Δ − 30 ms), not t − D + Δ (the stem timeline is
≈ 30 ms ahead already); (b) Δ computed from the analysis settings plus a trim, not one global number (35 ms leaves
Ambient Pulse ~50 ms late); (c) parallel analysis branch, not a series split; (d) lookahead on at VotR startup, off in
core (0.25 s more latency, a 0.25 s tail on pause); (e) ports-spec wiring expectations change; (f) 4.9 MB mp3 in the prd
build; (g) Mol* `Slider` vs the cards' native range inputs; (h) spec: "|kick → peak| ≤ one frame or 17 ms, whichever is
larger" (one frame is impossible for mixed onset and level routes above ~60 Hz).

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
