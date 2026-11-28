# Audio routing: spec, rules, expectations

Written 2026-11-26 after Ludo found the routes "messy, not synchronized" on a single drums/bass → symmetry-axes route.
This file is the contract: a change to the audio path is checked against the expectations below before it is shown.

## What it is for

One route = one audio source → one visual channel, with a gain, a floor, a release, a curve and a Who. The reference
effect is **Drums & Bass Burst**: drum hits (and the bass) burst the capsid out along its symmetry axes, in time with
the kick. Every other preset or route set must keep that effect possible and unchanged.

## Signal path (the only one)

```
audio element ─► analyser (band envelopes, beat) ─► stems ─► router ─► drives ─► shader uniforms
                 audio-reactor.ts                   │        audio-routing.ts     animation-loop.ts
                 stem separation (optional, delayed)┘
```

- **Stems.** With separation on, the model's levels: each stem in dB under its own running peak. Off: stand-ins from
  the bands. Drums are the kick onset over its 3 s running peak, squared. Bass is max(sub-bass, bass), other is the mean
  of low-mids, high-mids and treble, vocals are the mids. The stand-ins are **raw**, so a level route on them is weak
  (0.01–0.1) on most tracks.
- **Stem events** (stem-events, 2026-11-27). With a model that keeps up: kicks, snare/hats and bass notes found in the
  separated drums and bass by the worker, each a value 0–1 (its dBFS within 18 dB under its kind's loud level), read
  on the frame heard nearest to it (t − D, less the presented ring's frame quantization) and 0 on the others. Sources `Kick (stem events)`, `Snare/hats (stem events)`,
  `Bass notes (stem events)`. No model: none, and they read 0 (no band fallback).
- **Router**, per route:
  1. Raw source value.
  2. Onset mode only: how much it just rose, over that route's own running peak. Not for the event sources: an event
     is a hit already, and Hits reads it as Level does (normalizing it erased its strength).
  3. Hit threshold `t` (0–0.95, default 0): at or under `t` reads 0, above it `(x − t) / (1 − t)`.
  4. Curve.
  5. `floor + gain × value` while sound is heard (playing, or the stem delay line still draining after a pause or the
     end of the file); once nothing is heard (and before the first play), 0: no floor. A **stand-in** route reads 0
     while stem events are live (as if not heard: it releases), and acts again when they stop.
  6. Rise at once, fall over `releaseMs`. Once a route acts on nothing (nothing heard, muted, a stand-in while events
     are live), a value released below 1e-3 (`AudioRestCutoff`, Ludo to confirm) is 0: it rests at exactly 0, never a
     denormal tail.
  7. Duck.
  8. Sum per channel, capped at 40.

## Rules

1. **The shared signal path is fixed.** Stems, bands and beat stay as committed (HEAD b1cdfbb72). No change to them to
   make one preset look better: every route and every preset reads them.
2. **Shaping is opt-in, per route.** Gain, floor, release, curve (Linear, Log, Exp), mode (Level, Hits), Hit
   threshold, Stand-in and the `Loudness (vs. the song)` source act on one route only. Linear, threshold 0 and no
   stand-in are the defaults and are exactly the old behaviour; saved routes without them load so.
3. **Routes have one owner: the user.** Only these replace the routes:
   - a preset chip;
   - the Saved… list (saved sets and the built-in route sets);
   - the route editor;
   - startup.

   Loading a model or a song **keeps** them (`applyAudioPreset(name, 'keep')`).
4. **A route set is routes only.** Loading one does not change the analysis or the motion shapes. A route that is
   added, enabled or retargeted (a new id, or a new target on another motion) onto a motion that is off turns that motion on, once: Atom
   Wiggle for wiggle; Instance Beats for the symmetry axes and the random, axis and normal instance motions; Whole
   Object for object. This holds for every way routes change (the route editor, a loaded set, a preset); a gain, floor
   or curve edit never turns a motion the user turned off back on. instanceWave needs no motion. A preset makes no
   route on a motion it turns off.
5. **A non-finite source reads as 0.** One NaN or infinite stem, band, amplitude or beat, or a non-finite `dtMs`, is read
   as 0 where the router reads it, before the song average, onset and curve; the route recovers on the next finite
   frame, as a fresh route would. Nothing else in the route math changes.
6. **No change is shown to Ludo before it passes the expectations below.** Each source edit rebuilds and reloads the
   open page, which stops the song and resets the routes. Do not edit while Ludo is testing.

## Expectations (measured by `scripts/votr-sync/clicksync.mjs`, its generated click track; the offline baseline is `src/mol-plugin-state/manager/_spec/audio-pipeline.spec.ts`)

The click track has one kick every 0.5 s from 0.25 s (120 BPM), `--seconds` + D + 2 s long (8 + 2 by default; D the audio delay, `--delay`), its kick windows on the heard column. Separation is off, the model is the startup
capsid, the run is headless at about 30 fps.

| Expectation | Pass | 2026-11-26 |
|---|---|---|
| kick → symmetry-axes peak against the **media clock** (`audio.currentTime`, ahead of the speakers by the output latency) | for information (the expectation is the heard row) | `data-local/tests/clicksync.mjs`, `kick120.wav`, 2026-11-26: 35–39 ms median (13–65); `scripts/votr-sync/clicksync.mjs`, heard-frame, 2026-11-27: 81 ms median (65..98) (before: 40 ms, 23..58); it grows by the output latency |
| gain × 2 → peak × 2 (`data-local/tests/clicksync.mjs`, `kick120.wav`) | 1.9–2.1 | 1.96 ✔ |
| routes survive a song load (`keep.mjs`) | same routes | same ✔ |
| symmetry axes at rest, 0.4–0.5 s after a kick (Drums & Bass Burst, vitalic.mp3, `data-local/tests/sync.mjs`: local only, not in the repo; `scripts/votr-sync/clicksync.mjs` prints the rest/peak on its click track, the window shifted back by the lead with lookahead) | p10 ≤ 0.1 | 0.08 ✔ |
| kick → symmetry-axes peak, against what is **heard** (`scripts/votr-sync/clicksync.mjs`, generated click track: media time − (ctx.currentTime − getOutputTimestamp().contextTime − the timestamp's age)) | lookahead off: ≥ 0 and ≤ 50 ms + one frame (lookahead on: the next row) | heard-frame, 2026-11-27 (after the gate's fix step), headless, outputLatency 32 ms: full preset 42 ms median (35..67), drums only 38 ms (20..49), bass only 54 ms (35..84), at ~38 ms per frame (limit 88 ms) ✔ (51 / 48 / 57 ms before the fix step). sound-stops, 2026-11-27, headless on a loaded machine: 91 / 76 / 81 ms (full / drums / bass), a rerun 76 / 77 / 89; the base (`votr/overnight`) on the same server at the same hour 92 / 78 / 87 (limit 50 ms + one frame of ~37–40 ms ≈ 87–90 ms): base and lane equal, both at or over the limit in part (full 91 vs 90, x2 93 vs 89 in the lane's first run; base full 92), cause not identified (the frame step is the same as heard-frame's run, staging has no commit since it). **Open**: heard-frame's 42 ms run is not reproduced. Before (staging): full preset 11 ms median (−8..30), drums only 4 ms (−9..24): the drive was read from the analyser, ahead of the speakers by the output latency (−156 ms on AirPlay, review issue 1). The visuals now read the presented frame, the analysis of `currentTime − outputLatency` (`audio-presented-frame.ts`); offline (no tick jitter), latency L shifts the drives by exactly ⌈L / frame⌉ frames (`audio-pipeline.spec.ts`); with tick jitter the presented entry steps one per frame, at most one entry behind that, never ahead (`audio-presented-frame.spec.ts`). The read rule as built (heard-phase, 2026-11-27): the newest entry stamped at or before `currentTime − outputLatency`, never older than the one presented; at a stamp boundary, a read time past the newer entry's stamp by less than min(5 ms, max(3 ms, ½ · the interval before it)), it stays one entry behind, so jitter does not alternate hold and skip; elsewhere it follows the rule; the newest entry is never held back. Simulated (±1.5 ms tick jitter, L = k frames exactly): 0 % holds and skips at 60, 120 and 144 Hz (the quarter-interval rule before it: 0 / 7.3 / 11.2 %), 0.9 % with a noisy outputLatency at 60 Hz (5.7 %), early 0. Ludo's Chrome, 49 ms frames, outputLatency 32 ms, `currentTime` advancing continuously: presented − live 50 / 51 / 53 ms (≈ 95 ms on staging before, a permanent extra frame), heard median 47 / 66 / 58 ms. At 60 Hz with L ≈ 32 ms the gain is small (mean lag 0.79 entry against 0.84 before) |
| kick → symmetry-axes peak against what is **heard**, **lookahead on** with an audio delay D ≥ the lead (lookahead-sync: the analyser reads the source D − lead late, the lead = ½ the reactor's input window + the band attack + the trim; clicksync `--delay 1 --lookahead`) | \|median\| ≤ one frame or 17 ms, whichever is larger (Ludo to confirm, departure h: one frame is impossible for mixed onset and level routes above ~60 Hz); onset routes never more than 2 frames early | lookahead-sync, 2026-11-27. Offline (`audio-pipeline.spec.ts` › lookahead, 16 ms frames, D 1 s, kick track): full preset 0 frames (−1..0), bass only 0 (0..0), drums only −1 (−2..−1), Ambient Pulse wiggle and object 0 (0..1); before 2 / 2 / 1 / 5 frames; latency 32 ms the same; no model (D 0.25 s) full preset within one frame. clicksync, headless, ~36–38 ms frames, outputLatency 24–32 ms, D 1 s: heard median full 9 ms (−8..30), drums only 2 ms (−14..15), bass only 12 ms (−2..30), full × 2 19 ms (−10..31), gain × 2 1.95 ✔; the same run without lookahead (D 0): 51 / 32 / 39 / 46 ms. Rest/peak in clicksync's 0.4–0.5 s window rises with lookahead (median 0.43 / 0.24 / 0.64 / 0.69, max 1.02 / 1.14 / 1.01 / 1.54; without 0.47 / 0.24 / 0.61 / 0.46): the window ends on the next heard kick and the drive now rises the lead before it; offline, 0.35–0.45 s with lookahead reads what 0.4–0.5 s read without (drums only 0.24 vs 0.23). Ludo's Chrome and HTDemucs: not run yet |
| rest after a pause, no delay: every drive and route value exactly 0 (offline, `audio-pipeline.spec.ts` › rest once the sound stops, latency 0; on screen L later) | by frame p − 1 + ⌊max_j τ_j · ln(v_j / 1e-3) / 16⌋ + 1 (p the first paused frame, v_j each route's value on the last playing frame, τ_j its release), and 0 until play; not one frame earlier. Drums & Bass Burst ≤ 2.7 s (wiggle 2.2 at 350 ms) | sound-stops, 2026-11-27: kick track, pause at 3 s: exact 0 after 2064 ms, the formula's frame exactly ✔ (before: 1.5 s after a pause symAxis 0.033 and the wiggle at its 0.2 floor plus a tail) |
| no floor once stopped | the wiggle follows v · e^(−16k/350) from its last playing value, no 0.2; 0 before the first play | sound-stops, 2026-11-27 ✔ (9 digits) |
| pause or end of file with a stem delay D | the drives are those of an unpaused run (`toBe`) for D (lookahead on: until D − lead, the analysis then reads the silence after the stop while the floor holds until D), then the rest row from the values at the last frame heard. Real use: D (6–11 s) + ≤ 2.7 s | sound-stops, 2026-11-27, D = 1 s offline (fake delay node, stub separator), pause and end of file ✔; the separator samples t − D through the tail, never after |
| clear | every drive, route value and scope slot 0 on the next frame (the router is reset) | sound-stops, 2026-11-27 ✔ |
| stop, a new source | as a pause with D = 0: the delay line is flushed, nothing heard after (browser: no audio after Stop, not checked by hand yet) | sound-stops, 2026-11-27, D = 1 s: releases from the stop frame, no separator sample after ✔; the flush's wiring (`audio-reactive-ports.spec.ts`) ✔ |
| the tail is timed from the stop | heard until the stop (pause / ended event; the first tick not playing as a fallback) + the delay now: a delay raised 1 → 3 s inside the tail moves it; ticks stalled across the stop do not stretch it | sound-stops gate fix, 2026-11-27: D 1 → 3 s at 3.5 s, heard until 6.0 s ✔; ticks stalled 2.5–12 s, pause at 3 s, D 6 s: not heard after 12 s ✔ (before: heard 12.0–17.8 s) |
| a (re)start with an empty delay line (first play, after a flush, after a pause whose tail has drained) | not heard for D: `analysisBlocked` never raised by that silence, no `heardPlaying`, no floor; D = 0 unchanged; lookahead on: analysed from D − lead (lookahead-sync ✔, offline) | sound-stops gate fix, 2026-11-27: D 6 s from 0, and resumed at 9.5 s after a pause from 2 s: no blocked analysis ✔ (before: blocked 2.5–6.0 s, 11.9–15.4 s); control, silent file D 1 s: blocked from 3 s ✔. Open: a resume inside the tail after a pause of 2 s < P < D still raises it (pause 3–7 s, D 6: 11.4–12.9 s) |
| a released drive, once nothing is heard | each route value 0 or ≥ 1e-3, never a denormal | sound-stops, 2026-11-27 ✔ (while playing a value can still go denormal on an onset route: invisible, the frame redraws anyway) |
| the clip pass on a paused song | the release passes, one pass that writes the base values back, then no call (`cpu-channels.spec.ts`) | sound-stops, 2026-11-27 ✔ (before: the drive 1.2e-8 at 8 s, a pass every frame) |
| no route on a motion that is off (offline, `audio-pipeline.spec.ts`) | a preset that turns a motion off makes no route for it | met since lane `motions-follow-routes` (it made a route for `ambient-pulse`'s `amplitude → instanceRandom`; the other presets passed) ✔ |
| stem events against the study's reference (`angine.mp3`, the study's HTDemucs stems through the worker core with an identity runner, each model's window and chunk; `stem-study/data/ref.json`, ± one hop) | kicks ≥ 95 % hit, ≤ 5 % extra | stem-events, 2026-11-27: kicks 100 / 0.5 % (HTDemucs), 99.9 / 0.3 % (Spleeter's window), 99.8 / 0.5 % (SCNet's); snare/hats 96.8–98.3 / 2.4–3.0 %; bass notes 99.4–99.6 / 0.9–1.7 % ✔. A 48 kHz context: kicks 99.8–99.9 / 0.6 %, bass notes 99.4–99.6 / 1.0–1.8 %, but snare/hats 84.8–85.9 / 9.0–9.8 % (90.7 / 3.7 % within 30 ms): the worker's linear resampler dulls the 150 Hz–16 kHz band (open). The stems are the reference ones: this measures the detector and the worker's region math, not Spleeter's or SCNet's separation |
| Drums & Bass Burst with stem events, symAxis at 60 fps (the real separator and router; the study's matcher, `stem-events-design/drive_sim.py`) | kicks ≥ 72 % hit, extra ≤ 5 %, valley/peak ≤ 0.30, ρ ≥ 0.35 (the matcher's ceiling is 76.5 % for ideal impulses: a missed kick has a stronger one within 250 ms) | stem-events, 2026-11-27: HTDemucs 77.5 % / 4.8 % / 0.25 / 0.41 ✔ (before: stemDrums Hits + stemBass Level 59 % / 3.5 % / 0.73 / 0.12); Spleeter's window 77.5 / **5.2** / 0.25 / 0.41 (extra over by 0.2 point); SCNet's 77.5 / 4.6 / 0.25 / 0.41. A 48 kHz context (the stems resampled to 48 kHz, the worker's linear resampler back): 77.4 % / 4.8 / 5.1 / 4.7 % false, 0.25, 0.41. Ludo checked the proposed routes on the study page's preview in the viewer: "working nicely". Offline (`audio-pipeline.spec.ts` › stem events): a kick fires symAxis on the frame it is heard ±1 (lookahead off and on, latency 0 and 32 ms); a 6 dB softer kick bursts 0.67 of the loud one; with events live and none, the stand-ins rest and symAxis stays 0 |
| no stem model: every golden unchanged | the goldens | stem-events ✔ (the stand-ins act while no events arrive) |
| axes between kicks at 120 BPM, as a share of the peak | for information | `data-local/tests/clicksync.mjs`, `kick120.wav`, 2026-11-26: drums only 24 %, bass only 52 %, full preset 41 %; `scripts/votr-sync/clicksync.mjs`, 2026-11-27: 27 %, 66 %, 47 % (a different click, a 60 Hz decay) |

The last row is the committed behaviour. The drums route has a release of 260 ms and the bass envelope 220 ms, so at
120 BPM the axes are still 24–52 % open when the next kick comes. A shorter release on the route closes them more.

## What went wrong on 2026-11-26 (and is reverted)

1. **Peak-normalized band stems.** This broke rule 1. With it, the symmetry axes at rest went from 0.08 to 0.93 and the
   wiggle median from 0.29 to 2.07: the bass and other routes held everything open, and the kicks drowned. It is
   reverted, and `audio-reactive-animation.ts` is identical to HEAD.
2. **Song and model loads replaced the routes.** This broke rule 3. It was already in the committed code. Since the
   route sets moved to the Saved list, a load wiped a set or a single route that Ludo had built. It is fixed.
3. **Many rebuilds while Ludo was testing.** This broke rule 6.

## Not measured yet

- Sync with separation on, checked in the code only. The analyser reads its own branch (`source → analysis delay
  (D − lead) → analyser → silent sink`, beside `source → delay (D) → speakers`; lookahead-sync), so the bands read what
  is heard, the lead ahead with lookahead on; the stems are sampled at `currentTime − D + max(0, lead − 30 ms)` (the stem
  timeline's frames are stamped at their window's centre: offline, with a stub of its windows and the real
  `StemSeparator.sample`, it runs ≈ 30 ms ahead of the bands, an onset route 8 ms more, a level route 8 ms less; Ludo to
  confirm with HTDemucs, departure a). The click test has not been run with separation on (`clicksync --stems htdemucs`,
  headed Chrome with WebGPU).
- The pixels: the tests read the drives, not the rendered motion.
- The six route sets with separation off: their level routes on bass, other and vocals are weak again. Their gains or
  curves need tuning against this spec, route by route.
