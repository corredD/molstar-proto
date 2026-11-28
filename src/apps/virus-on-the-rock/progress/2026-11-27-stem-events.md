# Stem events (2026-11-27, lane `stem-events`)

## Brief

- **Asked** (Ludo, on the stem study of `angine.mp3`): the reference kick, snare and bass-note events "are great
  events"; get them live in the app so the capsid hits on the kick, sized by how hard it is ("still not satisfied by
  the look / feeling of the beats"). **Check:** `angine.mp3`, HTDemucs, Audio Delay 20 s: on the study page
  (http://localhost:1352/, `~/molstar-votr-lanes/stem-study/`) the app's live events land on the reference markers,
  and the viewer hits on each kick and rests between them.
- **Evidence:** `~/molstar-votr-lanes/stem-study/findings.md`. Today, Drums & Bass Burst with stems: kicks hit 59 %,
  the drive between kicks falls only to 0.73 of its peak (the bass level holds symAxis open), burst height vs kick
  strength ρ 0.12. The reference detector (`stem-study/scripts/metrics.py:22–76`) on the separated stems: 1,072 kicks,
  462 snare/hat hits, 1,233 bass notes, clean by eye.
- **Build:**
  1. **Detect in the stem worker**, which holds each chunk's separated audio: the study's detector per stem (band
     log-flux, `log1p(100·|X|)`, lag 2; peak-pick: local max over ± min gap, above a ±0.25 s median baseline +
     delta_rel × p95, energy within floor_db of the 4 s loud level; dated at −6 dB of the hit's energy):
     drums 40–150 Hz, 1024/128 → kick (gap 90 ms, 0.25, −24 dB); drums 150 Hz–16 kHz, no kick within 30 ms →
     snare/hat (60 ms, 0.25, −30 dB); bass 30–300 Hz, 4096/256 → note (80 ms, 0.30, −30 dB). Each run posts events
     (time, strength) next to the energies.
  2. **Look-ahead inside the delay:** the detector's future context comes from the next chunk; events in a chunk's last
     ~0.3 s wait for the next run (the timeline ~0.3 s later, covered by the 6–20 s delay). The p95 and the 4 s loud
     level become running values (causal over the past, as the timeline allows). **Ludo to confirm** (a rule-1 bend:
     the live analysis is causal today).
  3. **Route sources** `stemKick`, `stemSnare`, `stemBassNote`: an event fires a hit when its time is heard (the
     timeline the stems use: t − D + the stem lead, so lookahead and output latency hold); value = strength over the
     song's loud level, then the route's release. Hit threshold and weight (the study page's tuning) as route params.
  4. **Drums & Bass Burst with stems** uses them: kick → symAxis hits; bass note → symAxis hits with a short release,
     in place of the bass level (study: valley/peak 0.30 vs 0.73).
  5. **No stem model:** no events; the band fallback unchanged (study proposal 3 is not this lane).
- **Spec:** `_spec/audio-routing-spec.md` (event sources, their pass rows), `_spec/architecture.md` (the worker look-ahead).
- **Tests** (failing first):
  - the detector, ported from the Python: synthetic kick + bass + hats → events within one hop (2.9 ms) of the Python
    detector's on the same signal; no kick on bass notes alone;
  - chunk seams: the same events chunked or whole;
  - router: a kick event fires a symAxis hit on the frame it is heard (±1 frame); burst height follows strength (2:1
    order kept); no hit in near-silence;
  - `angine.mp3` offline on the reference stems against the study reference: kicks hit ≥ 90 %, false ≤ 5 %,
    valley/peak ≤ 0.35;
  - no stem model: every golden unchanged;
  - browser: clicksync `--stems htdemucs`; the live events on the study page.
- **Touches:** `audio-stems/stem-worker-core.ts`, `stem-models.ts` (energies → events), `stem-separator.ts` (event
  timeline), `stem-worker-protocol.ts`, `audio-routing.ts` (sources, threshold), `helpers/audio-reactive-presets.ts`
  (Drums & Bass Burst), the routing card; **stays off:** `audio-reactor.ts` (the band analysis).
- **Size:** ~200 production lines.
- **Lane model:** Opus: the detector design and the per-frame path.
- **Steps and models:** 1. design (Opus, read-only) 2. build test-first (Opus) 3. checks (Sonnet) 4. gate (Opus)
  5. measure on the study page (coordinator).
- **Base:** `votr/lookahead-sync` (its PR into `votr/overnight` is open); this PR goes into `votr/lookahead-sync` and is
  retargeted to `votr/overnight` once that merges.

## Design (Opus architect, 2026-11-27; waits on Ludo's points below)

- **Measured first** (Python, reference HTDemucs stems): the streaming detector, run by run (7.8 s window, 5 s chunk,
  0.35 s hold-back, p95 over the run's window, a −40 dBFS gate) against the whole-song reference: kicks 100 % hit /
  0.5 % extra, snare/hat 97.6 / 2.4 %, bass notes 99.5 / 0.65 %, offset 0. Without the gate: 2–6 % extra, all in the
  first 6 s at about −118 dB.
- **symAxis drive at 60 fps** (the study's matcher): today 59 % kicks / 3.5 % false / valley/peak 0.73 / ρ 0.12;
  kick 6.5/120 + bassNote 3/120: 77.6 % / 4.4 % / 0.25 / 0.41. Ideal impulses score 76.5 %: the matcher's ceiling
  (a missed kick has a stronger kick within 250 ms after it), so the brief's 90 % cannot be met.
- **Detector:** new pure `audio-stems/stem-events.ts`, an exact port of `metrics.py` `band_flux` + `pick` (frames on
  the absolute hop grid, running median, monotonic-deque loud level, −6 dB dating, strength in dBFS re a unit sine).
  HTDemucs only (it alone has separated samples): `demucsStemEnergies` also writes mono drums and bass; the worker
  core runs the detector after each run, posts events in [end − consumed − 0.35 s, end − 0.35 s).
- **Protocol / separator:** `'stems'` gains optional `events {from, until, times, dbfs, kinds}`; per-kind rings in
  `stem-separator.ts`, value = clamp((dBFS − loud + 18)/18, 0, 1) with a slow loud level; `sampleEvents(at)` fires each
  event once, on the first frame that reaches it; cleared on reset, seek, model change, Off.
- **Router:** sources `stemKick`, `stemSnare`, `stemBassNote`; route fields `threshold` (Hit threshold, 0–0.95) and
  `standIn` (acts only while no events arrive); event sources skip onset normalization (that erased strength).
- **Drums & Bass Burst:** today's stemDrums and stemBass routes become `standIn`; new stemKick Level 6.5/120 and
  stemBassNote Level 3/120 → symAxis. No model, Spleeter, SCNet: today's drives exactly, goldens unchanged.
- **Tests:** a committed Python-generated fixture (synthetic kicks 1/0.5, bass, hats) the TS detector must equal
  within one hop and 0.1 dB; chunk seams exact; separator fire-once/seek/clear; router threshold and stand-in; pipeline
  frame-accurate hit and 2:1 order. Angine acceptance: events ≥ 95 % / ≤ 5 % false; drive ≥ 72 % kicks, ≤ 5 % false,
  valley/peak ≤ 0.30, ρ ≥ 0.35.
- **Worker CPU:** +0.35–0.45 s per 5 s chunk (load factor +0.07–0.09).
- **Size:** ~385 production lines (brief: 200); the detector port takes the room.
- **For Ludo:** (1) the worker looks 0.35 s ahead inside the delay (rule-1 bend); (2) events sampled at t − D, not
  t − D + the stem lead (an onset-dated event has no window lag to compensate); (3) the `standIn` route field and the
  new Drums & Bass Burst defaults (alternative: a separate "Drums & Bass Burst (stems)" preset); (4) events with
  HTDemucs only; (5) the acceptance numbers above replace the brief's 90 %; (6) snare a source only, not in the
  preset; (7) ~385 lines.

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
