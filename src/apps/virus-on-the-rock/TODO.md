# Virus on the Rock — TODO

## Next

Ludo's items, in the order to build them: one item a lane. Each says what he wants to see and how he checks it, in
his words; the lane turns it into a brief, spec and tests. Seeded 2026-11-26 from the decisions of
[_spec/architecture.md §7](_spec/architecture.md#7-decisions-ludo-2026-11-26), in the order §7 proposes (the order
itself is still open there: Ludo reorders this list).

<!-- - **Title** (Dn): what I want to see. Check: what I do in the app and what I expect. -->

### Overnight 2026-11-27

Built on `votr/overnight` ([progress/2026-11-27-overnight.md](progress/2026-11-27-overnight.md#built)): items 1 (D2),
2 (D3) and 13 below, and review items 1, 2, 4, 5, 7, 9, 11 of
[progress/2026-11-26-audio-review.md](progress/2026-11-26-audio-review.md). Left from the night, in order:

- **A pause shorter than the stem delay** then resume still raises "analysis blocked" for a moment (sound-stops,
  measured 11.4–12.9 s in a probe with a 6 s delay).
- **Releases slow below 30 fps** (the loop caps a frame at 33 ms): at 20 fps every drive rests ≈ 3.26 s after Pause
  instead of ≤ 2.7 s; the shader motion and the rest bound assume real time.
- **Per-frame allocations left**: `AudioReactor.analyze` and `AudioRouter.update` allocate every frame; the status
  object per emission (≤ 30 Hz); the hierarchy syncs in every app (review item 10, D12).
- Review items 8 (`hasNoise` gate) and 12 (`packSlot` ranges); Safari has no `outputLatency` (latency 0 there).

### Stem study 2026-11-27

Built on `votr/lookahead-sync` ([progress/2026-11-27-stem-study.md](progress/2026-11-27-stem-study.md)): a model switch
mid-run no longer breaks the worker; HTDemucs' energy is its stems' audio. Left open, measured but untested:

- **The newest frame of a run** is the edge every model handles worst, and the app keeps it: analysed against padding
  (Spleeter zeros, SCNet reflection), on a 30 s excerpt the drums' newest frame read +6 dB (Spleeter) and +10 dB
  (SCNet); over the whole song < 1 dB, and the energy jumps 3.4–4.2 dB at run boundaries against 2.4–2.6 dB elsewhere.
  HTDemucs: the near-silent vocals' newest frames read +14 / +9 dB (the model's output at its window's end), bass and
  other jump 1.9 / 1.6 dB at boundaries against 0.7 / 0.8. A margin of a few frames held back at each run's end (the next
  run covers them; the timeline is that much later) would answer all three.
- **SCNet reads quiet passages 9–13 dB above the reference** (likely its rectangular window); under the levels' 24 dB
  range, so not seen.
- **Spleeter's *other* live** follows the offline replay at 0.81 (the other stems 0.98–0.99): fp16 or the linear
  resampler's treble loss.
- **HTDemucs' energy costs ≈ 0.5 s of worker CPU per 5 s chunk**: both channels in one complex inverse FFT would halve it.

### Broken items

1. **Pause and Clear rest** (D2): both bring every drive to 0 over its release; Clear resets the router. Check:
   Pause, the atoms stop wiggling (within ~3 s, no 0.2 floor); Clear, nothing stays frozen mid-burst; Stop, no sound
   after it. Built in `sound-stops` (2026-11-27), for Ludo to check (kept here so the numbers below hold).
2. **The 9th narrowed route is refused** (D3): once 8 routes are narrowed, the Who select of the others is disabled
   with a note. Check: narrow 8 routes, the 9th's Who is greyed with the note.
3. **Startup fallback plays** (D9): startup keeps the stream; `angine.mp3` is copied into the build so the fallback
   works. Check: with the stream unreachable, startup plays angine.mp3. Built in `lookahead-sync` (2026-11-27), for
   Ludo to check.
4. **The Who leak within one representation** (features §8, still open in §7): fix once checklist step 11 shows it.
   Check: step 11, only the narrowed chain's instances burst.

### New UI

5. **Load adds, in view** (D1): Load, the PDB chips and files keep adding beside what is there; the new structure comes
   into view (today it lands 2.75 radii away, off screen). Check: checklist step 3, 2PLV is on screen beside 2TBV.
6. **Labels follow the code** (D14): the Random note, "Cycle Every N Beats", the Beat Threshold range and help, Stem
   Drift's description, "waveform line", and the other mismatches of [_spec/ui.md](_spec/ui.md). Behaviour unchanged.
   Check: each label and help reads as ui.md says.
7. **Every hidden control gets UI** (D5): floor and release per route; gain slider to 40; onset weight and temperature
   under the Prominence radar; stem provider (WebGPU / WASM) and delay in Stem Separation (the delay is in, with
   Lookahead and Lead Trim: `lookahead-sync`). Check: each control is
   there and moves what it names.
8. **Prominence as a route source** (D13): each band's prominence (0–1, sums to 1) as a source next to the bands.
   Check: a route from a band's prominence drives its channel.
9. **Clip Reactivity gets a clip** (D4): the card adds a sphere and a plane clip object; the clip position and size
   targets move and scale them. Check: with the clip on, the routed drive moves and scales it on the beat.

### Then

10. **Whole Object is rigid** (D10): one pivot, the structure's centre. Check: a Whole Object rotation turns the capsid
    as one body.
11. **Bursts are not culled** (D18): while audio drives, bounding spheres grow by the largest motion the drives can
    give (frustum, LOD, fog, near/far). Check: a full burst close up, nothing pops out at the screen edge.
12. **Record a dance** (D17): a Record button writes the Mol\* canvas to WebM (no SVG overlays). Check: record 10 s,
    the file plays the dance.
13. **The clip pass rests on a paused song** (architecture §4, still open in §7): the clip rest check is an exact 0,
    which a released route's drive never reached. 1e-3 proposed and built in `sound-stops` (once nothing is heard a
    route value below it is 0); Ludo confirms the number. Check: clip route on, pause, the clip pass stops.
