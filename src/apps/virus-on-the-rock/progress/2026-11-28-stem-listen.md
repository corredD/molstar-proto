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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
