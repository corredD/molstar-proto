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

Branch `votr/lookahead-sync` (from `votr/overnight`), commits one cause each:

- `ae9e70a9e` helper: the fake analyser reads the analysis delay the manager set (the heard delay until set), options
  `lookahead`, `lookaheadTrimMs`, `stemSample`; trace `analysed`, `stemResets`. Existing traces unchanged.
- `5f2116624` reactor: the window helpers take a `Pick` of `fftSize`, `analysisSampleRate`.
- `67ae6238f` manager: the design's 1–5 as written (parallel analysis branch, `heardAt`, lead, delays, stems at
  t − D + max(0, lead − 30 ms)); tests 1–3 (red before: 2 / 2 / 5 frames) and test 10 (ports spec wiring log, both
  delay lines flushed; an existing expectation changed on purpose).
- `61acf70a4` tests 4–9, 11, 12 and 7 (14 red on the base manager, run by swapping the base file in; 4 guards green
  before too: drums only ×2, lookahead off explicit, trim to lead 0).
- `6199cbaea` card: Lookahead chips, Audio Delay and Lead Trim (Mol\* `Slider`), the help line; the Off title fixed.
  `684190cc6`: the Mol\* `Slider` rendered unstyled (its skin is scoped under `.msp-plugin`, the overlay is outside:
  a 0 px rail and a bare text box in a headless screenshot), so native range rows committed on pointer up, key up or
  blur; departure (g) dropped. Screenshot after the fix: both sliders drawn; two ArrowRight on Lead Trim commit
  trim 2 ms, the analysis delay 0.25 − 0.0353 s (`AudioParam.value` shows it one render quantum later), heard 0.25 s.
- `52a7f5ab5` `DefaultAudioSync = { lookahead: true }`, set in `initializeDefaults` before `loadDefaultAudio`.
- `8ca4e58e1` the `getStemDelaySeconds` alias dropped (kept one commit so the core commit had no app hunk).
- `2cc37dba1` `build.mjs` copies `examples/angine.mp3`; `curl` on 1351 served it from `/build/virus-on-the-rock/examples/`.
- `357ae5f7e` clicksync `--delay`, `--lookahead [--trim]`, `--stems`; windows on the heard column.
- a test with lookahead and no stem model (the startup configuration, D 0.25 s): red on the base manager.
- specs: routing spec lookahead row, architecture §2 lookahead + departures (a)–(h) "Ludo to confirm", ui.md,
  features.md, core-changes.md, TODO items 3 and 7 annotated.

Checks: `npm run lint` (0 errors, the 2 old app.tsx warnings), `tsc` clean, jest 222 passed (203 before, +19),
`build.mjs -a virus-on-the-rock --prd` done.

clicksync, headless Chromium on 1351, ~36–38 ms frames, outputLatency 24–32 ms, heard median (min..max):

| run | full | drums only | bass only | full × 2 | gain × 2 |
| --- | --- | --- | --- | --- | --- |
| `--delay 1 --lookahead` (D 1 s, lead 33 ms) | 9 (−8..30) | 2 (−14..15) | 12 (−2..30) | 19 (−10..31) | 1.95 |
| `--delay 1` (no model, no lookahead: D 0) | 51 (26..64) | 32 (15..49) | 39 (34..64) | 46 (25..59) | 2.04 |

Rest/peak (0.4–0.5 s after the heard kick) rises with lookahead: median 0.43 / 0.24 / 0.64 / 0.69, max 1.02 / 1.14 /
1.01 / 1.54 (without: 0.47 / 0.24 / 0.61 / 0.46, max 0.62 / 0.28 / 0.69 / 0.52). Cause: the window ends on the next
heard kick and the drive now rises the lead before it. Offline (kick track, D 1 s, 16 and 37 ms frames) the 0.4–0.5 s
window reads max 1.04–1.25 with lookahead, 0.23–0.58 without; 0.35–0.45 s with lookahead reads what 0.4–0.5 s read
without (drums only 0.24 vs 0.23, full 0.42 vs 0.40). The window is left as it is (clicksync prints it only).

Startup checked headless on 1351: `lookahead` true after load, the card says "heard 0.25 s late; the analysis runs
33 ms ahead".

Not run: Ludo's Chrome (the coordinator's step 5), `--stems htdemucs` (headed Chrome with WebGPU: the open question
of the real stem timeline's offset), the startup fallback with the stream unreachable.

## Decided

- The design as written, departures (a)–(h) proposed and flagged "Ludo to confirm" in architecture.md and the routing
  spec (builder, 2026-11-27).
- Departure (i), Ludo to confirm: test 7 asserts in ms at 4 ms frames, not "the same frame at 16 ms": with the real `StemSeparator.sample` the
  separated drums (onset route) peak 8 ms ahead of the band stand-in and the bass (level route) 8 ms behind, so 30 ms
  is the midpoint and at 16 ms frames the drums fall one frame early (−2 vs −1). Kept 30 ms (not tuned to 40); the
  test pins |stems − bands| ≤ 10 ms with the measured signs, and the uncorrected control further off (builder).
- The pause / end-of-file test (9) separates the media's stop (the last playing frame) from the stop event (the next
  frame): the drives equal the unpaused run until the media's stop + D − lead; analysed until the event + D − lead;
  heard until the event + D (builder; the helper's pause event comes a frame after the media stops, as in sound-stops).
- `--delay` without `--stems` or `--lookahead` sets no delay (the slider is ignored with no model and no lookahead,
  as `getAudioDelaySeconds` says); the clicksync header says so.

## Learned

- The lead overshoots onset routes: drums only peaks 1 frame (16–28 ms) before the heard kick, since an onset needs
  no band attack. Within the design's "never more than 2 frames early".
- The stem path's offset against the bands depends on the route: a centred Hann-window energy starts rising ~46 ms
  before its centre, so an onset route sees it early; a level route sees the peak late. Measured with the real
  `sample()`: onset −8 ms, level +8 ms around `StemTimelineLeadS` = 30 ms (4 ms frames).
- In the helper the pause event's clock is one frame after the media stopped entering the graph; mid-kick that
  frame shows (the sound-stops tests pause between kicks, so they did not see it).

## Size

~165 production lines against ~85: manager +102 / −28 (about a third doc comments: the lead, the delays, the branch),
card +45 (a commit-on-release range), catalog 5, app 3, build 6, reactor 3; tooling clicksync +40 / −17. What took the room: the doc
comments and the card's help and titles.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
| S1 nothing asserts the analysis sink is silent (deleting its gain 0 left the suite green; a 33 ms pre-echo) | should-fix (test gap) | confirmed | `9ccf769e0` (red with the line deleted: gain 1) |
| S2 the clicksync / `kickPeakStats` rest window [k + 0.4, k + 0.5) catches the next kick's rise with lookahead | nit | confirmed | `277afb6fb` (shifted back by the lead; offline drums only 16 / 37 ms frames: on 1.00 / 0.82 vs off 0.23 / 0.24 before, 0.23 / 0.24 both after) |
| S3 the Lookahead chip or an Audio Delay commit changes the heard D mid-play: a 0.25 s replay or skip, a click, primedUntil not reset | should-fix | jump confirmed, click plausible | `b60352bc3` (flush both lines while playing, the next tick primes; lead-only change untouched; in a pause's tail the tail moves as before). Open: no gain ramp on the heard branch, the flush cuts as stop does |
| N4 `flushDelayLine` copies the old nodes' stale `.value` | nit | confirmed | `800398ac3` (from the params; the flush test's poked 6 / 5.9 replaced by setParams, changed on purpose) |
| N5 the NaN-safe analysis guard exists only for the helper's `fakeDelayNode(NaN)` | nit | confirmed | `a12f85b5c` (plain `> 1e-5`; the fake follows the heard delay until set; red: 15 / 138 with the old fake) |
| N6 the sliders' `<output>` reads the params, not the dragged value; no native `change` commit | nit | confirmed | `d38f8ae61` (headless screenshot on 1351: 5.0 s while dragging with the param at 0, `change` commits 5) |
| N7 `setParams(DefaultAudioSync)` after `await loadPdb` | nit | confirmed | `2af067ef1` (no unit test: `initializeDefaults` needs the whole app; startup probe: lookahead true) |
| NF1 the stems-line-up stub weights x² by Hann, no model's framing | nit | confirmed | `3d4ff51c8` (HTDemucs framing; drums −8 → +4 ms, bass +8 ms vs the bands; sign assertion now both behind, ≤ 10 ms kept) |
| NF2 `tick` takes D from the node, `updateStems` from the params | nit | confirmed | `f25c558d1` (the node in both; red before) |
| NF3 routing spec row 70 names `sync.mjs`, not in the repo | info | confirmed | `5772a01be` (`data-local/tests/sync.mjs`, local only; clicksync's rest window) |
| S4 with real HTDemucs the stem routes get ~no lookahead (stem lead max(0, 33 − 30) = 3 ms) | follow-up (coordinator) | measured, see Built › S4 | `8c8cba7f7` (per-model `timelineLeadSeconds`, hidden `stemTimelineLeadMs`), `72a2b9922` (clicksync `--stem-lead`); value: see below |

## Stopped here (coordinator, 2026-11-27, Ludo: "stop, commit and push, I will continue on my workstation")

The fix step was stopped during the S4 measurement; every gate fix above is committed and pushed. Left to do:

1. **S4, choose HTDemucs' `timelineLeadSeconds`** (all three models still 0.030, the stub's value,
   `stem-models.ts:48/59/70`). The fix step's runs were not recorded. Measure headed, each candidate:
   `node scripts/votr-sync/clicksync.mjs --port <port> --stems htdemucs --delay 20 --lookahead --headed --seconds 30 --stem-lead <0|15|30>`
   (≈ 4–5 min a run). Pick the value that centres drums-only and bass-only heard medians nearest 0; record the table
   under Built; if the candidates cannot be told apart, keep 30 ms and say so. Coordinator's earlier 10 s runs (stem
   lead 3 ms, ~60 ms frames): no lookahead full/drums/bass 40/40/31 ms, lookahead 47/52/24 ms. Note: HTDemucs drags
   the render to ~16 fps in a Playwright window; check the frame rate in a normal Chrome window too.
2. **Checks after the fixes** were not run as a set: `npm run lint`, `npx tsc --noEmit -p tsconfig.json`,
   `npx jest src/apps/virus-on-the-rock src/mol-plugin-state src/mol-repr/structure`,
   `node ./scripts/build.mjs -a virus-on-the-rock --prd`.
3. **Browser check (brief):** `examples/angine.mp3` (Audio URL), HTDemucs, Audio Delay 20 s: the burst on the kick and
   the bass; with lookahead and no model, D 0.25 s; the startup fallback with the stream unreachable.
4. **PR** `gh pr create -R corredD/molstar-proto --base votr/overnight --head votr/lookahead-sync`, Review section from
   the table above; open items: S3 (no gain ramp, the flush cuts as Stop does), S4 value, departures (a)–(i) for Ludo.
