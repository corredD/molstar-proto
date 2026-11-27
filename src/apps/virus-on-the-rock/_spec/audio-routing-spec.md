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
- **Router**, per route:
  1. Raw source value.
  2. Onset mode only: how much it just rose, over that route's own running peak.
  3. Curve.
  4. `floor + gain × value`.
  5. Rise at once, fall over `releaseMs`.
  6. Duck.
  7. Sum per channel, capped at 40.

## Rules

1. **The shared signal path is fixed.** Stems, bands and beat stay as committed (HEAD b1cdfbb72). No change to them to
   make one preset look better: every route and every preset reads them.
2. **Shaping is opt-in, per route.** Gain, floor, release, curve (Linear, Log, Exp), mode (Level, Hits) and the
   `Loudness (vs. the song)` source act on one route only. Linear is the default and is exactly the old behaviour.
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

The click track has one kick every 0.5 s from 0.25 s (120 BPM), `--seconds` + 2 s long (8 + 2 by default). Separation is off, the model is the startup
capsid, the run is headless at about 30 fps.

| Expectation | Pass | 2026-11-26 |
|---|---|---|
| kick → symmetry-axes peak against the **media clock** (`audio.currentTime`, ahead of the speakers by the output latency) | for information (the expectation is the heard row) | `data-local/tests/clicksync.mjs`, `kick120.wav`, 2026-11-26: 35–39 ms median (13–65); `scripts/votr-sync/clicksync.mjs`, heard-frame, 2026-11-27: 81 ms median (65..98) (before: 40 ms, 23..58); it grows by the output latency |
| gain × 2 → peak × 2 (`data-local/tests/clicksync.mjs`, `kick120.wav`) | 1.9–2.1 | 1.96 ✔ |
| routes survive a song load (`keep.mjs`) | same routes | same ✔ |
| symmetry axes at rest, 0.4–0.5 s after a kick (Drums & Bass Burst, vitalic.mp3, `sync.mjs`) | p10 ≤ 0.1 | 0.08 ✔ |
| kick → symmetry-axes peak, against what is **heard** (`scripts/votr-sync/clicksync.mjs`, generated click track: media time − (ctx.currentTime − getOutputTimestamp().contextTime − the timestamp's age)) | ≥ 0 and ≤ 50 ms + one frame | heard-frame, 2026-11-27, headless, outputLatency 32 ms: full preset 51 ms median (33..68), drums only 48 ms (27..74), bass only 57 ms (32..68), at ~38 ms per frame (limit 88 ms) ✔. Before (staging): full preset 11 ms median (−8..30), drums only 4 ms (−9..24): the drive was read from the analyser, ahead of the speakers by the output latency (−156 ms on AirPlay, review issue 1). The visuals now read the presented frame, the analysis of `currentTime − outputLatency` (`audio-presented-frame.ts`); offline, latency L shifts the drives by exactly ⌈L / frame⌉ frames (`audio-pipeline.spec.ts`) |
| rest after a pause: every drive exactly 0 within the longest release (+1 frame: 400 + 16 ms), measured at latency 0 (offline, `audio-pipeline.spec.ts`); on screen it comes the output latency L later, as the pause is heard L later | 0 (not a tail, not a floor) | not 0 today: 1.5 s after a pause symAxis is 0.033 and the wiggle holds its 0.2 floor plus a tail (`it.failing` in `audio-pipeline.spec.ts`). **To be met by lane `sound-stops`** |
| no route on a motion that is off (offline, `audio-pipeline.spec.ts`) | a preset that turns a motion off makes no route for it | met since lane `motions-follow-routes` (it made a route for `ambient-pulse`'s `amplitude → instanceRandom`; the other presets passed) ✔ |
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

- Sync with separation on, checked in the code only. There the analyser comes after the delay (`source → delay → analyser →
  speakers`, audio-reactive-animation.ts:483), so the bands read what is heard; the stems are sampled at
  `currentTime − delay`. The click test has not been run with separation on.
- The pixels: the tests read the drives, not the rendered motion.
- The six route sets with separation off: their level routes on bass, other and vocals are weak again. Their gains or
  curves need tuning against this spec, route by route.
