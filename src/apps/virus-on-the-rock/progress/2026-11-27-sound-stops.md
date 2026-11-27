# sound-stops (2026-11-27, lane of the overnight; review issues 3, 6, 11; D2, TODO 13)

Branch `votr/sound-stops` from `votr/overnight` (after measure and heard-frame merged), worktree
`~/molstar-votr-lanes/sound-stops`, port 1351.

## Brief (from [2026-11-27-overnight.md](2026-11-27-overnight.md))

- **Asked (D2):** Pause and Clear bring every drive to 0 over its release; Clear resets the router. With stems on,
  the visuals follow the delay line's tail after pause and at the end of a file, then rest.
- **Build:** one design for "the sound stopped": the router releases to exactly 0 (a cut-off below which a released
  value is 0; proposed 1e-3, Ludo's number to confirm, TODO 13); floors apply only while sound plays; Clear calls
  `router.reset()`; with a delay, the paused branch keeps reading the analyser until the delay has drained.
- **Tests:** pause → every drive 0 within the longest release (+1 frame); a released drive is exactly 0 (not 4e-323);
  Clear → drives 0 at once; with delay D, drives follow the tail for D after pause.

## Decisions (coordinator, overnight; Ludo to confirm)

On the design's open points:

1. The cut-off is **1e-3** (`AudioRestCutoff`).
2. The rest stays **exponential**, with the formula as the bound (`releaseMs × ln(v0 / 1e-3)`): no change to the release
   shape. The brief's "within the longest release + 1 frame" cannot hold with an exponential release (design, top).
3. **Stop, new source and Clear flush the delay tail** (no audio after them).
4. **Floors off before the first play.**

## Design (Opus, accepted by the coordinator; copied as given)


Lands AFTER heard-frame; needs the real-manager harness (measure) and heard-frame's ports merged first. Tests named by title.

Departure from the brief: "every drive 0 within the longest release + 1 frame" is impossible with an exponential release and an absolute cut-off: time to rest = releaseMs × ln(v0/cutoff) even when the target drops to 0 at the stop (6.5 @ 260 ms, 1e-3 → ≈ 2.3 s; after 1 s still 0.14). The spec row uses that formula as a bound. Alternative (a release that ends exactly at releaseMs, linear/clamped tail) changes how every route looks while releasing: Ludo's choice.

## 1. "The sound stopped": one source of truth
`private heardUntil = -Infinity` (audio-context seconds): until when the speakers still play buffered audio. Computed only in tick (the element has native controls; `ended` never passes through the manager, so not in pause()). Uses heard-frame's single clock read per tick (t = clock.now()), moved to the top of tick.
```ts
const playing = !audio.paused && !audio.ended;
if (playing) this.heardUntil = Infinity;
else if (this.heardUntil === Infinity) this.heardUntil = t + (this.delayNode?.delayTime.value ?? 0); // the graph's D, not params
const heard = playing || (this.audioContext.state === 'running' && t < this.heardUntil);
```
| State | heardUntil | Heard until |
| playing | ∞ | – |
| paused, ended (end of file) | t_stop + D on the first non-playing tick | the tail drains (D = 0: at once, as today) |
| stopped, new source (loadSource) | −∞, delay line flushed | at once |
| cleared | −∞, flush, router.reset() | at once |
| no source / never played | −∞ | never (floors off before the first play) |
Resume inside the tail → ∞ again (the analyser reads the real gap). Suspended context: clock frozen → not heard. "Heard" = transport + drain, not signal level: the burst/silence golden (wiggle 0.2 while silence plays) stays.
tick branches: heard → read the analyser, write waveform/spectrum (covers the tail); !heard → analyse silenceData (today's paused branch). silenceWhilePlayingMs counts only while playing (a quiet outro inside the tail must not trip analysisBlocked). updateStems(dtMs, !heard) replaces paused: the separator keeps sampling at t − D through the tail, then falls back to band stems. Rule 1 holds: no retune; the analyser reads what plays, silenceData only once nothing is heard.
Stop, new source and Clear silence the tail (Ludo to confirm; browser check): they reset reactor and separator at once (a tail read after reactor.reset() makes a false flux onset; "Clear → 0 at once" would contradict what is still heard). Private flushDelayLine(): sourceNode.disconnect(delayNode) (targeted: the separator also taps the source); delayNode.disconnect(); createDelay(30) with the same delayTime; reconnect source → delay → analyser. No-op without a sourceNode (harness). Alternative: Stop follows the tail like Pause and defers the reset to heardUntil.

## 2. What goes to 0, and how — the router only
`AudioRouter.update(routes, frame, stems, dtMs, heard = true)` (default keeps every caller and test bit-identical).
- Target: `const target = route.enabled && heard ? Math.max(0, route.floor + route.gain * input) : 0;` Floors only while heard; once stopped, each route releases from its own value with its own releaseMs (removes the measured compounding reactor band release → stems → route release). Source read, onset state (previous, peak), songAverage still update (a resume behaves as today); only the target is overridden.
- Snap right after the release line: `if (!heard && state.value < AudioRestCutoff) state.value = 0;` with `export const AudioRestCutoff = 1e-3; // Ludo to confirm (TODO 13)`. Why 1e-3: a quarter of one 8-bit colour step (1/255 = 3.9e-3) for illumination/hue; for motion ≈ 5 Å per symAxis drive unit (arch §5) → ≈ 0.005 Å, far below a pixel. Gated on !heard (burst/bass has illumination < 1e-3 while playing; a global snap would move goldens).
- Drives end exactly 0 (0 × duck, sums, min(40,·) stay 0; scope drives too). cpu-channels (=== 0) and audio-redraw (change-only) need no edit. Open: a denormal can still appear while playing (onset routes), invisible, the frame redraws anyway; item 11 closed for the paused case only.
- Band sources need nothing (the reactor keeps decaying on silenceData for the overlay).

## 3. Clear
clear() adds: router.reset(); currentStems = ZeroStems; stemsSeparated = false; bandDrumsPeak = BandDrumsPeakFloor; heardUntil = -Infinity; flushDelayLine(). (reactor.reset(), separator.reset() already there; after Clear tick takes the early return, so the reset alone zeroes the drives.) stop() and loadSource() add heardUntil = -Infinity and flushDelayLine(); their router values release, no reset (routes keep state, rule 3).

## 4. Spec rows (live values; on screen add L from heard-frame)
| pause, no delay: every drive and route value === 0 | by frame p−1 + ⌊max_j τ_j·ln(v_j/1e-3)/16⌋ + 1 (v_j value on the last playing frame, τ_j release). Drums & Bass Burst bound ≤ 2.7 s (wiggle 2.2 @ 350 → 2.69 s; drums 6.5 @ 260 → 2.28; bass 6.5 @ 220 → 1.93; illumination 0.6 @ 400 → 2.56). Record the kick-track number (≈ 1.9–2.1 s) |
| no floor once stopped | wiggle(p+k) = v·e^(−16k/350) (no 0.2); 0 before the first play |
| pause or end of file with delay D | drives identical (toBe) to an unpaused run with the same D for D s, then the row above. Real use D (6–11 s) + ≤ 2.7 s |
| clear | every drive, route value, scopeCount 0 on the next tick |
| stop, new source | as pause with D = 0 (tail flushed). Browser: no audio after Stop |
| released drive | 0 or ≥ 1e-3 on every not-heard frame, never denormal |
| clip pass | rests: no target call after the rest frame |
| on screen | rows above + L |
Harness (audio-pipeline-helper.ts): the fake analyser reads a wall-clock input stream (media samples while playing, zeros while paused), the n samples ending at wall position − D·sr; D = 0 and no pause → bit-identical (goldens hold). New options stemDelayS, endedAtS. D reaches the manager the real way: install a fake delayNode `{ delayTime: { value: 0, setValueAtTime(v) { this.value = v } } }` and a stub separator (setModel async no-op, reset, sample spy, dispose) before setParams({ stemModel: <first id>, stemDelaySeconds: D }) — syncStems sets D. Fake audio gets pause(), removeAttribute(), load() so onFrame can call stop() and clear().
Tests (L = 0 unless noted, each failing first):
audio-pipeline.spec.ts, kick, Drums & Bass Burst: 1 pause at 3 s → every drive and route value toBe(0) by the bound frame and stays 0 until play; tight (some value > 0 one frame earlier). 2 floors gone: wiggle follows the pure release (toBeCloseTo 9 digits); a run paused over 0–1 s shows wiggle 0. 3 D = 1 s, pause at 3 s, and endedAtS 3 → frames up to 3 + D toBe the unpaused D = 1 run; then the bound from the values at 3 + D. 4 separator gate: during the tail sample is called with t − D; after heardUntil never. 5 clear() in onFrame → next frame all 0. 6 stop() with D = 1 → releases from the stop frame, no tail, rests within the bound. 7 no denormal: on every not-heard frame v === 0 || v >= 1e-3. 8 L = 0.1: presented drives reach 0 exactly ⌈L/16⌉ frames after the live ones.
audio-routing.spec.ts: heard = false → target 0, no floor, snap; a value released over 2000 frames is exactly 0 (today 4e-323).
cpu-channels.spec.ts: a paused run's clipPosition column (stemDrums onset → clipPosition) → one restore, then 0 target calls.

## 5. Minimal diff (≈ 35 production lines)
| audio-routing.ts | AudioRestCutoff; heard param; target line; snap (≈ 5) |
| audio-reactive-animation.ts | heardUntil; tick header + branch on heard; updateStems(!heard); silenceWhilePlaying only while playing; router.update(…, heard); clear/stop/loadSource resets; flushDelayLine() (≈ 30) |
| cpu-channels, audio-redraw, audio-reactor, stem-separator | no edit |
| harness + 3 specs | §4 |
| _spec/audio-routing-spec.md | step 4 floor while heard; step 5 to 0 once not heard, snapped below 1e-3; the §4 rows |
| architecture.md | §5 "Drives after clear or pause", §7 D2 → built; "Still open: clip cut-off" → 1e-3, Ludo to confirm |
| TODO.md 13 | 1e-3 proposed |
| core-changes.md | router signature, manager (own commits) |
Existing tests in audio-pipeline.spec.ts › rest after a pause: delete "today the drives are still open 1.5 s after a pause…"; delete the it.failing "every drive is exactly 0 one second after a pause…" (test 1 replaces it as a plain it); flip "today the wiggle holds its 0.2 floor plus a tail through a pause" into test 2. All goldens stay bit-identical (no golden pauses; heard = true path unchanged).
Open for Ludo: the 1e-3 cut-off; flushing the tail on Stop/new source (recommended) vs following it; floors off before the first play; exponential rest ≈ 2–2.7 s vs a release that ends at releaseMs.

## Log

### Step 1: the router (66ce6e05f, core)

- Red: `audio-routing.spec.ts` › "audio routing once the sound stops (heard = false)": 5 failed, 16 passed (the cut-off
  undefined; the floor held; never rises to the floor; no snap; 2000 frames of release end at 2.3e-53, not 0). The sixth
  (onset state kept while not heard, a resume reads as a fresh route) passed before and after: a guard.
- `AudioRouter.update(…, heard = true)`: not heard → target 0 and a released value < `AudioRestCutoff` (1e-3) is 0.
  Every golden unchanged (the default keeps every caller).

### Step 2: the harness (6b2c267a2, test only)

- The fake analyser reads what came into the graph in wall time (the media while playing, silence while paused or
  ended), N samples ending D back. `stemDelayS` (fake delay node + stub separator; the delay set through setParams),
  `endedAtS`, `pause()` latches, `removeAttribute('src')`, `load()`.
- Parity against the old harness (a throwaway spec, deleted): 7 runs (4 burst, 2 ambient, kick at L = 100 ms) and a kick
  run paused 3–5 s: 0 differences in every drive, stem and route value. A song run paused 3–4 s differs after the
  resume: the analyser now holds the silence of the pause, as a real one does. No golden pauses.

### Step 3: the manager (3a5a8edef, core)

- Red: the 10 tests of `audio-pipeline.spec.ts` › "rest once the sound stops" on the unchanged manager: 10 failed
  (wiggle 0.2515 for 0.2415 of the pure release; frame 315 not at rest; the tail run 3.25 vs 9.93 at frame 203, the
  analyser not read; no separator sample in the tail; clear leaves frame 301 open; the latency run never rests;
  heardPlaying false in the tail).
- Green: all; every golden and every heard-frame test unchanged. The two "today" tests are gone (test 1 replaces the
  `it.failing`, test 2 the wiggle-floor one).
- `audio-reactive-ports.spec.ts`: the flush's wiring (source → delay cut alone, old delay disconnected, a new delay with
  the same time, reconnected to the analyser; on stop and on clear). Mutant (no flush in `stop()`): this test and the
  pipeline's stop test fail.
- **Measured: pause at 3 s, kick track, Drums & Bass Burst: exact 0 after 2064 ms** (frame 315, last playing 186),
  exactly the formula's frame, one frame earlier not at rest. With L = 100 ms the presented drives rest exactly 7 frames
  later.

### Step 4: the clip pass rests (8a39e19e7, app)

- `cpu-channels.spec.ts`: a stemDrums onset → clipPosition route through the real manager, paused at 3 s, into
  CpuChannels: the release passes, one write-back, then no target call. Red against the pre-lane manager (6b2c267a2's
  file put back, then restored): the drive is 1.18e-8 at 8 s, a pass every frame.

### Step 5: spec pages (26974ce42, app)

Routing spec steps 4–5 and seven rows; architecture §2 (when the sound stops), §4 clip rest, §5, §7 D2 built, "still
open" cut-off → 1e-3 proposed; TODO 1 (marked built, kept for numbering) and 13; features Play / Pause and Clear →
Tested, checklist step 9; core-changes (router, manager, harness).

### clicksync (headless Chromium, port 1351, outputLatency 32 ms, ~37–40 ms per frame)

```
lane:           full 91 ms (68..108) | drums 76 (62..98) | bass 81 (68..116) | x2 93; gain x2 -> 2.00
lane, rerun:    full 76 ms (35..128) | drums 77 (60..91) | bass 89 (73..106) | x2 90; gain x2 -> 2.03
base (overnight's manager and router, same server, same hour):
                full 92 ms (67..107) | drums 78 (58..117) | bass 87 (70..102) | x2 84; gain x2 -> 2.00
```
Lane and base agree within the run-to-run noise, and the playing path is unchanged offline (goldens and lag tests
untouched): no change from this lane. But both sit at or over the window (50 ms + one frame ≈ 87–90 ms): the lane's
first run full 91 (limit 90) and x2 93 (limit 89), the base full 92. Cause not identified: the frame step (37–40 ms) is
the same as heard-frame's run, and `git log e6a2beef2^2..e6a2beef2^1 -- src scripts` is empty (staging has nothing
heard-frame's 42 ms run lacked). Open: heard-frame's 42 / 38 / 54 ms is not reproduced here today.

### After the advisor's check

- 8dafffd26 `audio-reactive-ports.spec.ts` covers the flush on a new source (`loadUrl`) too; mutant (no flush in
  `loadSource`) fails.
- No app code loads a next source on `ended` (the only `ended` listener is the manager's status update), so the
  end-of-file tail is not cut by the new-source flush.

## Built

The design §1–5: `heard` (playing, or the delay line draining) as the one "sound stopped" state; the router releases
to exactly 0 with no floor once not heard; the tail of the stem delay is followed after a pause and the end of a file;
Stop, a new source and Clear flush the line; Clear resets the router; the clip pass rests on a paused song.

## Decided

- Coordinator, overnight; Ludo to confirm: the 1e-3 cut-off; the exponential rest with the formula as the bound (not
  `releaseMs` + 1 frame); Stop, a new source and Clear flush the delay tail; floors off before the first play.
- Builder (deviations from the design, adapted to the merged heard-frame): the ring's `playing` flag carries `heard`, so
  `heardPlaying` is heard as heard: with no delay identical to before (every heard-frame test unchanged); with a delay
  the beat cycle and the song detector keep reading the tail, which is sound (one test). The clock is read once at the
  top of tick into two fields (`readClock`), `presentFrame` and the stems sampling (t − D) use that read. The flush
  lives in `flushDelayLine()`, which also sets `heardUntil = -Infinity`. The harness changes paused runs after a resume
  (realistic, no golden pauses). Not in the design: the separator still samples by the param's delay (equal to the
  node's).

## Learned

- 2000 frames of a 260 ms release end at 2.3e-53, not the review's 4e-323 (that is further on); either way never 0.
- clicksync on a shared machine moves by a whole frame with load; a same-hour base run is needed to read a change.

## Size

Production: 86 + / 29 − lines in two core files (`audio-reactive-animation.ts` 99 lines changed, `audio-routing.ts`
16), against the design's ≈ 35: the clock moved to the top of tick (`readClock`), the doc comments, `flushDelayLine`
(13 lines). Tests: ~300 lines (routing 6, pipeline 10, ports 1, cpu-channels 1) and the harness options.

## Checks

`npm run lint` 0 errors (2 warnings in `app.tsx`, there before); `npx tsc --noEmit -p tsconfig.json` clean; `npx jest
src/apps/virus-on-the-rock src/mol-plugin-state src/mol-repr/structure src/mol-canvas3d` 21 suites, 190 tests pass;
`node ./scripts/build.mjs -a virus-on-the-rock --prd` done (build/ removed); clicksync above. Not checked by hand in a
browser: no audio after Stop (the flush), the tail with a real stem model.

Process deviations: the manager commit holds three causes (heard and the tail, the clear reset, the flush), since its
tests depend on each other; the flush wiring tests came after the code, proven by mutants, not by a red run; TODO 1 is
annotated as built, not removed (the numbers below it are referenced).
