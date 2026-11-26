# Virus on the Rock — TODO

## Next

Ludo's items, in the order to build them: one item a lane. Each says what he wants to see and how he checks it, in
his words; the lane turns it into a brief, spec and tests. Seeded 2026-11-26 from the decisions of
[_spec/architecture.md §7](_spec/architecture.md#7-decisions-ludo-2026-11-26), in the order §7 proposes (the order
itself is still open there: Ludo reorders this list).

<!-- - **Title** (Dn): what I want to see. Check: what I do in the app and what I expect. -->

### Broken items

1. **Pause and Clear rest** (D2): both bring every drive to 0 over its release; Clear resets the router. Check:
   Pause, the atoms stop wiggling (today the 0.2 floor keeps them moving); Clear, nothing stays frozen mid-burst.
2. **The 9th narrowed route is refused** (D3): once 8 routes are narrowed, the Who select of the others is disabled
   with a note. Check: narrow 8 routes, the 9th's Who is greyed with the note.
3. **Startup fallback plays** (D9): startup keeps the stream; `angine.mp3` is copied into the build so the fallback
   works. Check: with the stream unreachable, startup plays angine.mp3.
4. **The Who leak within one representation** (features §8, still open in §7): fix once checklist step 11 shows it.
   Check: step 11, only the narrowed chain's instances burst.

### New UI

5. **Load adds, in view** (D1): Load, the PDB chips and files keep adding beside what is there; the new structure comes
   into view (today it lands 2.75 radii away, off screen). Check: checklist step 3, 2PLV is on screen beside 2TBV.
6. **Labels follow the code** (D14): the Random note, "Cycle Every N Beats", the Beat Threshold range and help, Stem
   Drift's description, "waveform line", and the other mismatches of [_spec/ui.md](_spec/ui.md). Behaviour unchanged.
   Check: each label and help reads as ui.md says.
7. **Every hidden control gets UI** (D5): floor and release per route; gain slider to 40; onset weight and temperature
   under the Prominence radar; stem provider (WebGPU / WASM) and delay in Stem Separation. Check: each control is
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
