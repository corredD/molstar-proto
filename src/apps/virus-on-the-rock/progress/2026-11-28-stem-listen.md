# Listen to each stem (2026-11-28, lane `stem-listen`)

## Brief

- **Asked** (Ludo): "can we do like on the study page, and have a small audio on/off next each stem in the stem
  separation to hear directly the output of the separation?" Ludo: go on the proposal (mono, the mix muted while any
  stem is on, all four stems, synced through the delay). **Check:** angine, HTDemucs, Audio Delay 25 s: turn drums on →
  only the separated drums are heard, in time with the capsid; add bass → drums + bass; all off → the normal mix. A
  stretch the model lost (falling behind) is heard as silence. Same with Spleeter and SCNet.
- **Design (coordinator's proposal, the architect refines):**
  - Worker: while listening is on (a `'listen'` message, on/off), each run also returns the four stems' mono audio for
    the samples it consumed ([W − consumed, W) of the window), with the context time of its first sample (the same
    clock as the run's `times`). HTDemucs from its freq + time branches (as `demucsStemEnergies` builds drums and
    bass today), Spleeter its four masks on the mix's complex STFT and the overlap-add inverse, SCNet its four complex
    outputs through `OverlapAddInverse`. Off: no extra work (today's drums + bass for the events only).
    Transferred, not copied.
  - Main thread: each stem's chunk becomes an AudioBuffer played by an AudioBufferSourceNode started at context time
    (chunk start + D), the heard delay, into a per-stem gain then the destination: the stems are heard when the mix
    would be, and line up with the visuals as the mix does. While any stem is on, the mix's heard gain is 0 (the
    analysis branch is untouched: the drives read the full mix as always). Chunks tile by sample (the runs tile);
    a chunk whose start is already past is started late with an offset; a lost stretch is silence. Stop, seek, a new
    source, a model change: every scheduled node stops. Pause: whatever lane `stem-events` round 2 does to the delay
    line (it suspends the AudioContext, which freezes the scheduled nodes too) holds.
  - Card: on the Stem Separation card, one small speaker on/off per stem (drums, bass, other, vocals) beside its
    level, as the study page's track toggles; off by default, not saved in state.
- **Spec:** `_spec/architecture.md` §2 (the listen path), `_spec/ui.md` (the card's toggles), `_spec/core-changes.md`
  (protocol and manager API, additive).
- **Tests:** the worker core returns four stems' audio over exactly the consumed samples, tiling across runs, only
  while listening (fake runner); each model's stem audio agrees with the study's reference stems where the study has
  them (HTDemucs: within the study's tolerance; the four sum back to the mix within a few dB for Spleeter, as masks
  do); the scheduler starts each chunk at its start + D on a fake AudioContext, late chunks with an offset, stops all
  on reset; the mix gain is 0 while any stem is on and back after; headed: angine with drums only, a click track
  (clicksync's kick120) heard on the drums stem within one render quantum of the mix's timing.
- **Touches:** `stem-models.ts` (each runner's audio for four stems), `stem-worker-core.ts`, `stem-worker-protocol.ts`,
  `stem-separator.ts` (the listen message, receiving the chunks), a new `audio-stems/stem-player.ts` (scheduling),
  `audio-reactive-animation.ts` (mix mute, D, reset hooks), `ui/cards/stem-separation.tsx`. **Stays off:** lane
  `stem-events` round 2 (same branch underneath) changes the separator's event coverage, the worker's `pending` cap
  and lost-audio report, HTDemucs' yields and the pause path: merge `origin/votr/stem-events` before the gate and
  resolve there; do not change those parts.
- **Size:** ~250 production lines (the card included).
- **Lane model:** Sonnet, calling the Opus `advisor` before each design or hot-path step and before done (Ludo, 2026-11-28); the gate stays Opus.
- **Steps and models:** 1. architect (Opus): the protocol, the scheduler, each model's four-stem audio 2. build (Opus;
  Sonnet for mechanical parts) 3. checks (Sonnet) 4. merge `origin/votr/stem-events`, gate (reviewer + skeptic,
  Opus) 5. PR into `votr/stem-events` (`-R corredD/molstar-proto`), dev server on port 1354 for Ludo.

## Design

Written by the lane (Sonnet) with the Opus advisor; the brief's proposal, refined.

- **Region heard per run = the events' region** `[W - consumed - H, W - H)`, H = `EventHoldBackS` (0.35 s), not the
  brief's `[W - consumed, W)`. Why: the window's newest samples have no right-hand context and every model's edge is
  its poorest (demucs' own `apply_model` crossfades segments for that); heard as is, each seam (every 2 s Spleeter, 5 s
  HTDemucs) would click. The events already use this region and it tiles by sample, and D already covers the hold-back.
  Departure from the brief, for Ludo; a seam is listened to in the headed check.
- **Protocol (additive).** Request `{ type: 'listen', on }` (any stem on). Response `stems` gets an optional `listen:
  { time, samples: Record<StemName, Float32Array> }`: 44.1 kHz mono, `time` = context time of the first sample (same
  clock and formula as the events' `from`), transferred. All four stems always come back while listening: adding a stem
  is instant (its chunks are already scheduled at gain 0). Off: no extra work.
- **Runners.** `run(left, right, audioFrom, allStems?)`: with `allStems`, `audio` also carries other and vocals
  (HTDemucs: two more `mono` buffers of `demucsStemEnergies`; Spleeter: two more `spleeterStemAudio` calls; SCNet: two
  more `scnetStemAudio`). The worker copies the region into fresh arrays (the runner's buffers are reused) and
  transfers them. HTDemucs: only the `audio` record is touched, not the piece loop (lane stem-events r2 owns the yields).
- **Player** (`audio-stems/stem-player.ts`, `StemPlayer`): a port the manager constructs with the context, a D getter
  and the mix gain; passed to the separator (no callback parameter). Per stem a GainNode to the destination. `schedule`
  makes an AudioBuffer (44.1 kHz; the context resamples) per stem and an AudioBufferSourceNode started at
  `start + D`; chunks tile: a chunk starting within 2 ms of the previous end is placed at the previous end (a 48 kHz
  context's resampled sample does not leave a gap or overlap); a late chunk starts now with an offset; one fully past
  is dropped (silence: the brief's lost stretch). Nodes removed on `onended`. `reset()` stops and disconnects every node
  and waits again for a first chunk; the epoch is checked before scheduling.
- **Mix mute** (refinement, advisor): the mix gain goes to 0 when the first stem chunk of the epoch plays (its start
  + D, a 5 ms ramp), not at the click: at Audio Delay 25 s a click-time mute would leave up to 25 s of silence. All stems
  off: scheduled values cancelled, gain back to 1 at once (the delay line always carries the mix). The analysis branch
  is untouched. The gain sits between the delay node and the destination: `ensureAnalyser` and `flushDelayLine` both
  connect through it.
- **State.** Listening is in `manager.state.stemListen` (BehaviorSubject, one write path `setStemListen(stem, on)`,
  emits on change), not in params, not saved. Off model clears it. The separator re-sends `listen` after each `load`.
  Card: a small speaker toggle per stem beside its meter, disabled while no model runs.
- **Reset hooks:** `separator.reset()` (stop, clear, a new source, a D change), `setModel`, `dispose`.
- **Tests:** worker core (fake runner): four stems over exactly the region, tiling across runs, only while listening;
  each model's four-stem audio (Spleeter masks sum to the mix below 11 kHz, bins from B up are zero; HTDemucs equals the
  existing `mono` path; SCNet the same inverse); player on a fake AudioContext (start + D, late offset, drop, tile,
  reset, mix mute/unmute timing); headed: click track on the drums stem.

## Built

- `stem-models.ts`: `StemRunner.run(…, allStems)` returns other and vocals audio too (HTDemucs from the same loop as
  drums and bass, Spleeter two more soft-mask inverses, SCNet two more complex inverses); off: drums and bass only, as before.
- `stem-worker-core.ts` / `stem-worker-protocol.ts`: `{ type: 'listen', on }`; while on, each run's `stems` response
  carries `listen: { time, samples }`, the four stems' mono audio over the events' region, copied and transferred.
- `audio-stems/stem-player.ts` (new): `StemPlayer`, chunks on the context clock at start + D, a gain per stem, the mix
  mute from the first chunk's heard time.
- `stem-separator.ts`: `setListening` (re-sent after each load), the optional `player` port, chunks of the current epoch
  handed to it, reset with the timeline.
- `audio-reactive-animation.ts`: the mix gain (delay → mix gain → speakers), the player, `state.stemListen` and
  `setStemListen` (refused with no model, cleared by Off).
- Card: a speaker toggle per stem beside its meter; `style.scss`.
- `scripts/votr-sync/listensync.mjs`: the headed check, three taps (mix, mix as heard, drums stem).
- Specs: ui.md, architecture.md (listening), core-changes.md, features.md, audio-routing-spec.md (the heard graph).
- Tests: worker core listening (3 models, tiling, only while listening, a reset), runner audio (Spleeter masks sum to the
  mix, HTDemucs other and vocals), the player on a fake context (start + D, tile, late, drop, reset, mix mute), the
  separator (epoch, reset, the flag after a load), the manager's state, the ports spec's wiring through the mix gain.

## Decided

- **The events' region, not the consumed samples (me, with the advisor; for Ludo to confirm).** The brief's
  `[W - consumed, W)` ends at the window's newest sample, where every model is poorest; the region heard is
  `[W - consumed - H, W - H)` (H = `EventHoldBackS`), the events' own. It tiles by sample. Measured on Spleeter
  only (Learned): no step at its seams.
- **The mix mutes from the first stem chunk's heard time, not from the click (advisor).** A click-time mute at Audio
  Delay 25 s would be up to 25 s of silence. The mix is heard until then.
- **All four stems always come back while listening** (the brief): adding a stem is instant; each stem's gain switches it.
- **A seek stops nothing (departure from the brief).** A seek is a jump on the context clock the delay line already
  follows, and the manager does not flush it; the stems follow it the same way. Stop, clear, a new source and a change
  of D reset the player (they reset the separator).
- **Listening is off with no model and cleared by Off; not in `params`** (not saved), in `state.stemListen` with one write path.
- **"Agrees with the study's reference stems" is not tested per model** (departure): other and vocals go through the same
  loops as drums and bass, which the events' tests (and the study's comparison) cover; the tests added are the sums and
  the identities (Spleeter masks sum to the mix below 11 kHz, HTDemucs other/vocals are their time branch, SCNet's
  inverse is the identity on the forward) plus the worker over fake runners.

## Learned

- **Numbers** (Spleeter on wasm, headless, delay 8 s, `listensync.mjs`): drums stem's kick onsets minus the mix's over
  18 kicks: median 0.08 ms, max 0.37 ms; the mix as heard after the first stem chunk: peak 0.0000; the mix gain back
  to 1 after the toggles go off; bass stem's largest step at 2 chunk seams 0.0004 against 0.044 elsewhere (seams
  do not click, 2 seams of one model). clicksync `--stems spleeter --seconds 10` (routing contract; headless wasm,
  shared CPU, so the model fell behind early: noisy): gain x2 -> kick-events peak ratio 2.00; HEARD medians
  between -39 and +31 ms across presets; without a model (`--seconds 8`): gain ratio 1.99, HEARD 41-64 ms. The
  analysis branch is untouched, so these say the heard-path gain changed nothing measurable.

- A per-sample tap on the heard path (a script processor on each node: the unmixed delay output, the mix gain, a stem's
  gain) measures the claim directly: the drums stem's kick onsets sit within 0.4 ms of the mix's, and the mix
  as heard is exactly 0 after the first stem chunk. The first version compared two separate runs at 5 ms resolution
  and could not show either.
- A tap left on while the toggles go off hears the mix come back (the 0.05 "audible" peak was that): stop the tap first.
- The headed HTDemucs run on WebGPU in this Mac's Playwright did not finish here: it stayed `warming` through 39 s
  of audio and the page then closed (the GPU process; the closing page's `dispose` threw `disconnect ... not connected`
  in `flushDelayLine`, a teardown order that predates this lane). HTDemucs and SCNet were not heard here; Ludo's check
  below is the one that does.

## Size

Production (no tests, specs, scripts, scss): +249 / -29 lines against ~250 in the brief; with the card's scss about +270.
The runners' four-stem paths, the player and the manager hooks took the room the card did not.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
| Routing contract numbers and seam claim missing from the progress file | must-fix | confirmed | numbers added (Learned); HTDemucs and SCNet not heard here: left to Ludo's check |
| D-change spec's fake named every gain `sink` | should-fix | confirmed | fixed (ports spec names each gain) |
| NaN/Infinity in the listening chunk reach the speakers | should-fix | confirmed | fixed, test first (finite chunk; copy pinned) |
| Last pending + 0.35 s before a pause or the song's end may never be separated (tap gives no input?) | should-fix | plausible | open: needs a headed run to the end of a song with a stem on |
| A change of D during a pause's drain un-mutes the mix (separator reset resets the player) | nit to should-fix | confirmed by reading | open to the queue |
| Mix and stems hard-stop on reset | nit | confirmed | mix now ramps in; stem nodes still stop at once |
| Separator took the concrete player | nit | confirmed | fixed (Pick of schedule, reset) |
| scss literals | nit | weak | left |
| Tests: `consumed > W - H` clamp for listening; manager hands the mix param to the player | test gap | confirmed | open |
