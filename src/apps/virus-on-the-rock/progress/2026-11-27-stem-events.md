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

Branch `votr/stem-events` (pushed, no PR), on `votr/lookahead-sync`. Thirteen commits (the last two: the progress
file, and a fix: an event dated past its run's end was dropped at the seam), test first each:

1. `dsp.ts` `OverlapAddInverse`: overlap-add inverse STFT, each sample divided by the squared windows over it (round
   trips: Hann 1/N and unwindowed 1/√N give the signal back, edges included).
2. `audio-stems/stem-events.ts` (new): the detector, a port of `metrics.py` `band_flux` + `pick`; frames on the
   absolute hop grid; kick + drum hits share one 1024/128 pass, bass 4096/256; snare = hits farther than 30 ms from a
   kick (the last 4 posted kicks carried, plus a non-committing pick 130 ms past the region); −40 dBFS gate. Held to the
   Python reference on a committed fixture (`_spec/stem-events-fixture.py` writes `.json`): same events per kind,
   |Δt| ≤ one hop, |ΔdB| ≤ 0.1.
3. HTDemucs: `demucsStemEnergies(…, mono)` writes the drums and bass as mono audio; `StemRunResult.audio`.
4. Spleeter and SCNet return audio too (Ludo): `spleeterStemAudio` (each stem's soft mask on the mix's complex STFT,
   Hann OLA, bins ≥ 1024 zero), `scnetStemAudio` (its complex output, rectangular OLA, ×√N), only the frames from
   `audioFrom` on (`run(left, right, audioFrom?)`). Round trips: mask 1 / identity output give the mix back.
5. Worker core: sample counter, a detector per model window, region [W − consumed − 0.35 s, W − 0.35 s), context
   ≤ 2.45 s before it; `events` in the `'stems'` message. Seams: 24 s run by run equals the whole signal exactly, for
   each model's W and chunk; a pile-up run repeats and loses nothing; reset; a result without audio posts none.
6. Separator: per-kind rings (2048), value = (dBFS − loud + 18) / 18, `sampleEvents` (fire once, no backlog after a
   resume, a jump or a stall; live while t ≤ eventsUntil), `skipEvents`, cleared with the timeline.
7. Router: sources `stemKick`, `stemSnare`, `stemBassNote`; Hits reads events as Level; `threshold`, `standIn`.
8. Manager: events read at t − D while heard, passed to `router.update`; the pipeline helper's stub separator reads
   events through a real `StemSeparator`.
9. Drums & Bass Burst: stemDrums and stemBass become stand-ins; stemKick Level 6.5/120 and stemBassNote Level 3/120
   on symAxis.
10. Routing card: Hit threshold slider, Stand-in checkbox.
11. Spec pages: routing spec (signal path, router steps, rule 2, three expectation rows), architecture §2 (the worker's
    look-ahead), core-changes, features, ui.

**Checks**: `npm run lint` 0 errors (2 warnings, app.tsx:537/543, not this lane's); `tsc` clean; jest
`src/apps/virus-on-the-rock src/mol-plugin-state src/mol-repr/structure` 23 suites, 269 tests pass; `build.mjs -a
virus-on-the-rock --prd` done.

**Offline acceptance** (`angine.mp3`, the study's HTDemucs stems through `StemWorkerCore` with an identity runner at
each model's window and chunk, then the real separator and router at 60 fps, the stems' levels 0, scored over the
live span; scripts `accept.ts`, `score.py`, `bench.ts`, `region.py` in the builder session's scratchpad `se2/` (not
durable: copying them beside `stem-study/stem-events-design/drive_sim.py` was refused by the session's permissions; the
coordinator may copy them). Events against `ref.json`, ± one hop (hit / extra):

| config | kicks | snare/hats | bass notes | drive: kicks hit / false / valley/peak / ρ |
|---|---|---|---|---|
| HTDemucs (7.8 s / 5 s) | 100 / 0.5 % | 96.8 / 2.4 % | 99.4 / 0.9 % | 77.5 % / 4.8 % / 0.25 / 0.41 ✔ |
| Spleeter's window (11.8 s / 2 s) | 99.9 / 0.3 % | 98.3 / 3.0 % | 99.6 / 1.7 % | 77.5 % / **5.2 %** / 0.25 / 0.41 |
| SCNet's window (11 s / 6 s) | 99.8 / 0.5 % | 97.2 / 2.6 % | 99.5 / 1.0 % | 77.5 % / 4.6 % / 0.25 / 0.41 ✔ |

At a 48 kHz context (the stems resampled to 48 kHz with scipy, the worker's linear resampler back; after the gate
fixes): kicks 99.8–99.9 / 0.6 %, bass notes 99.4–99.6 / 1.0–1.8 %, snare/hats 84.8–85.9 / 9.0–9.8 % (open, see Review);
drive 77.4 % hit, false 4.8 (HTDemucs) / 5.1 (Spleeter's) / 4.7 % (SCNet's), valley/peak 0.25, ρ 0.41. The 44.1 kHz
numbers above are unchanged after the gate fixes.

Before: 59 % / 3.5 % / 0.73 / 0.12. These measure the detector, the region math and the route math on the reference
stems, not Spleeter's or SCNet's own separation (the browser check, step 5).

**Worker CPU per run** (node, M-series): detector ~200 ms per HTDemucs run (5 s audio, +0.04 load factor); Spleeter
~125 ms detector + ~50 ms inverse per 2 s run (+0.09); SCNet ~225 ms + ~85 ms per 6 s run (+0.05).

## Decided

- Ludo, 2026-11-27 ("ok go"): the design's seven points as proposed (0.35 s worker look-ahead; events at t − D; the
  `standIn` route field and the new Drums & Bass Burst defaults; snare a source only; the new acceptance numbers;
  ~385 lines), plus **Spleeter and SCNet give events too**: each runner inverts its drums and bass to audio (Spleeter:
  the stem's mask on the mix's complex STFT, the mix's phase; SCNet: its complex output), overlap-add at 4096/1024,
  then the same detector. ~435 production lines.
- Ludo, 2026-11-27: checked the proposed routes (stemKick Level 6.5/120 + stemBassNote Level 3/120 on symAxis) on the
  study page's preview in the viewer: "working nicely". Kept exactly as the Drums & Bass Burst defaults.

## Learned

- The context before a run's region matters little: on the study's stems, Spleeter's and SCNet's runs read as well with
  2.45 s of context (HTDemucs' whole window) as with their whole 11–11.8 s window, slightly better on snare/hats
  (97.8 vs 96.5 %, Python, `stream_sim` with each model's W and chunk). So `EventContextS` bounds the inverse STFT and
  the detector for the long windows.
- The streaming p95 is the only loss: a run's own window reads marginal events (a cut note's click) otherwise than the
  song's. The seam tests use faded notes for that reason.
- A pure sine's float noise after its onset makes peaks of its own in the reference detector too (p95 of a steady
  tone is noise); an abrupt start reads as a kick in the drums' 40–150 Hz band, so a hit at the same time is the kick's.
- Spleeter's audio at the window's last frame is not the mix even with mask 1: the cut to the padding is broadband and
  the bins over 11 kHz are dropped. Harmless: events stop 0.35 s before the end.
- SCNet's synthesis window is rectangular (its forward has none; torch.istft with window=None): it can leave steps at
  each 1024-sample frame edge, possibly visible in the 150 Hz–16 kHz hit band. Not measurable without the model.
- The separator's normalization (loud floor −30 dBFS) makes the drive's extra rate 4.8 % against the design's
  simulated 4.4 % (its floor was −80 dB raw): little margin under 5 %; with Spleeter's 2 s chunks 5.2 %.
- An event is dated up to 60 ms after its flux peak, so a run can post one past its `until`; the separator dropped
  it when the next run started there (1 on angine with Spleeter's and SCNet's chunks). Fixed: only a real overlap drops.
- Departures from the design: (a) the snare exclusion carries the last 4 posted kicks and a non-committing kick pick
  130 ms past the region, not a pick over [from − 30 ms, to + 30 ms); (b) a run's frames start at most 2.45 s before
  its region (not the whole window: identical for HTDemucs); (c) the loud level, median and ahead are computed per
  candidate (only local maxima above the flux threshold), not as running filters: the same values, less work;
  (d) `sampleEvents` after a jump back reads nothing until it passes the last read; (e) a run that straddles a window
  reset posts no events (a window epoch); (f) the test "a model without audio" became "a runner result without audio"
  (all three models give events).

## Size

~617 production lines of code (823 added with comments, 62 removed) against the brief's 200 and the decided ~435;
762 test lines. The room: the detector port (~390 with comments), Spleeter's and SCNet's inversion and their layouts
(~110), the separator's rings (~120).

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
| stems 1 / router 11, N1: at a 48 kHz context a seam's `from` lands µs before the last `until`; the seam drop lost events dated past it. The worker never posts a real overlap | must-fix | confirmed | 4d36072ca (drop and its test removed; 5 µs-early test; 48 kHz worker seam test; architecture wording) |
| router 1: events live before their coverage starts (a model switched with the Audio Delay kept): stand-ins muted, symAxis dead ~9 s | must-fix | confirmed | 6cdb5923a |
| router 2: a frame past `eventsUntil` used up covered events | should-fix | confirmed | 213ecd8b3, superseded by 658d267b2 (a frame in the grace reads the ring) |
| stems 2: events of two runs whose dates cross were out of order in the ring, both lost | should-fix | plausible (not seen on signals) | 1b2d182ec (sorted insert; the loud decay never runs backwards) |
| router 3: stand-ins flap once per run near load factor 1 | should-fix (low) | confirmed mechanism | 658d267b2 (live holds EventHoldBackS + 0.15 s past the coverage; headroom reads the events' end) |
| router 4: the pipeline test did not assert "once" nor tell t − D from t − D + lead | nit | confirmed (test gap) | 316dec568 (count = KickAt.length; lookaheadTrimMs 100) |
| router 5: no clicksync numbers | gate item | refuted as a lane defect (coordinator's step 5) | open (coordinator) |
| router 6: Stand-in title | nit | confirmed | 7a902d4ba (card, ui.md) |
| router 7: Mode title wrong for event sources | nit | confirmed | 7a902d4ba |
| router 8: a muted stand-in decays into denormals | nit | confirmed | 288539e33 (AudioRestCutoff when the route is not active) |
| router 9: features Hits row | nit | refuted as stated, wording kept as nit | 7a902d4ba |
| router 10, N2: threshold clamped only in drafts; threshold 1 on Mids/Treble latches NaN | nit | confirmed | f401f0bba |
| router 12: hand-made range/checkbox controls | nit | confirmed (consistent with the card) | open |
| stems 3: CPU figure not reproduced | nit | refuted (201–211 ms on re-run); double p95 sort confirmed | b01804309 (p95 once per run) |
| stems 4: fixture tolerance one hop / 0.1 dB | nit | confirmed | 2543f4adf (10 µs, 0.01 dB) |
| stems 5: the overlap test guards a dead path | nit | confirmed | 4d36072ca (removed) |
| stems 6: a message in transit at a reset refills the rings | nit | confirmed | 430598f63 (epoch sent with load/reset, echoed by the worker) |
| new (re-run): at a 48 kHz context snare/hats fall to ~85 % within one hop (90.7 % within 30 ms): the worker's linear resampler dulls 150 Hz–16 kHz | — | measured | open (the resampler predates the lane; kicks, bass notes and the drive are unchanged) |
