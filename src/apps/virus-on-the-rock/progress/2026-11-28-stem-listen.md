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
- **Lane model:** Opus (audio scheduling on the context clock, the models' inverse paths).
- **Steps and models:** 1. architect (Opus): the protocol, the scheduler, each model's four-stem audio 2. build (Opus;
  Sonnet for mechanical parts) 3. checks (Sonnet) 4. merge `origin/votr/stem-events`, gate (reviewer + skeptic,
  Opus) 5. PR into `votr/stem-events` (`-R corredD/molstar-proto`), dev server on port 1354 for Ludo.

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
