# Virus on the Rock UI

The interface as built (read at `b1cdfbb72` plus the uncommitted work), card by card in sidebar order, with each
control's label, range, default and what it does. **Mismatch** marks a label or help text that says something the code
does not; the text is to follow the code (decision 14, [architecture.md §7](architecture.md#7-decisions-ludo-2026-11-26)).

## 1. Layout

- The Mol\* viewport fills the page; the Mol\* left panel, sequence, log and remote state are hidden; its viewport
  controls and settings stay (screenshot reachable there).
- A left sidebar (280–360 px) over it; one column under 980 px. "←" hides it; a title and "→" bring it back.
- A full-screen SVG overlay (histogram, wave lines, radial ring); opacity 1 playing, 0.58 loaded, 0.22 otherwise.
- The session panel, bottom right; "✕" closes it, "i" brings it back.
- Drag and drop anywhere: the first audio file plays, the rest load as structures.
- Keyboard: Enter in the PDB id and the Audio URL. No shortcuts of its own.

## 2. Sidebar

**Header.** "Virus on the Rock", "←".

**Intro.** "Minimal audio-reactive virus viewer. Drag a structure or audio file anywhere onto the viewport, or use the
inputs below."

**Load Structure.**
- PDB ID (default `2tbv`, placeholder `2plv`), Load: adds.
- Chips 2TBV, 2PLV: fill and add.
- Random (toggle). **Mismatch**: turning it on says "Next model at the next song." and loads one at once.
- Mesoscale chips: SARS-CoV-2, HIV, HIV (cellPACK), Exosome, Machinery of Life, Nipah (localhost); tooltip = size and
  atoms; disabled while a model loads; replace all.
- Status: "Loading X…", or the song-change note when Random is on.
- Browser File (multiple): adds.

**Audio.**
- Audio File (`.mp3, audio/*`).
- Audio Source: Plus FM, Maple Leaf Rag, FIP Hi-Fi AAC, Le Son Parisien FLAC (default); "Custom URL" when the field
  matches none. Picking fills the URL only.
- Audio URL, Load URL.
- Play Current / Pause Current (disabled until loaded).
- Warning when the analysis reads silence for 2 s while playing (CORS).
- Help on the stream, the fallback and autoplay.

**Stem Separation.**
- Chips Off, Spleeter 4-stem, HTDemucs, SCNet.
- Four meters (drums, bass, other, vocals); faded when they are band stand-ins.
- Status line; "The audio is heard X s late…" when a model is on.
- Missing: provider (WebGPU / WASM) and delay (0–25 s).

**Audio Routing.** One block per route:
- Enabled, Source, Mode (Level / Hits), ×.
- → Target, Curve (Linear / Log / Exp).
- Who: "the whole view" for camera, opacity, clip, background, step, duck; otherwise a level (All, Model, Entity,
  Instance, Chain; + Residue, Atom for wiggle, illumination, spectrum), a choice, and ◎ (from the selection).
- Gain 0–20, step 0.1; a live meter, full at 8.
- Missing: floor and release. **Mismatch**: an imported gain above 20 shows the slider pinned.
- Buttons: + Add route (drums hits → symmetry axes, gain 1), + Instance wave (drums → wave, gain 6), Defaults.
- Library: Name ("My routing"), Save, Saved… (Saved in this browser; Inspired by acclaimed audio-visual works), Delete
  (not for built-in), Export, Import.
- Help: "Up to 8 routes can be narrowed at once." (the 9th is silently global).

**Prominence.** Radar (190 px) and "band NN%". **Mismatch**: the help says to tune Onset Weight and Temperature; there
are no such controls.

**Representation.** Spacefill / Blob Surface (default).

**Audio Presets.** Drums & Bass Burst (default), Subtle Drift, Stem Drift, Bass + Spectrum, Bass Groove Strong, Full
Spectrum, Ambient Pulse. Replace the routes. **Mismatch**: Stem Drift's description says it is picked when separation
goes on.

**Motion Targets.** Atom Wiggle, Instance Beats, Whole Object (+ Uniform / Spectral). Effect Sensitivity:
- LOD Scale Off / On.
- Beat Threshold 0–2, 0.01, 1.1. **Mismatch**: the manager's range is 0.5–4, and the beat cycle no longer reads it.
- Atom Wiggle 0–16 (1), Instance Beat 0–200 (1), Whole Object 0–32 (1), Axis Amplitude 0–200 (15).

**Clip Reactivity.** Off / On, Scale 0–4 (1). Nothing to act on until a clip object exists and a route targets it; the
app cannot add one.

**Axis Mode.** Off / On (default On). X / Y / Z, Assembly; Local / Global (not with Assembly); Manual / Beat Cycle;
order chips Auto + N-fold (Manual); Cycle Uses (X, Y, Z, folds; default the folds); Cycle Every N Beats 1–8.
**Mismatch**: it counts rises of the symmetry-axes drive, not beats.

**Visualizers.** Histogram, Wave Line, Circle. **Mismatch**: the help says "waveform line"; it is one line per route.

**Loaded Structures** (collapsed). The tree (wip): eye, label, Who ▸, Remove; mesoscale parts under their example.

## 3. Session panel

Structure ("ENTRYID | label"), Audio, Playback (Playing / Stopped), Preset, Axis Mode ("Beat Cycle · X", "Manual ·
5-fold", "Assembly unavailable", …).

## 4. Leftovers to clear

- `vor-wave-gradient` and `.vor-wave-line` (unused since wave lines are per route).
- Two stacked JSDoc blocks above `MesoscaleExample`; misplaced ones above `chooseRepresentationMode` and
  `RepresentationMode`; `ensureSpacefillRepresentation` applies the mesoscale preset.
