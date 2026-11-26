# Virus on the Rock

Virus on the Rock (VotR) is a Mol\* app that makes a virus dance to music. A capsid (or a whole mesoscale virion) is
drawn in Mol\*; an audio file, a URL or a live radio stream plays; the sound is analysed (bands, beat, optional stems
separated in the browser) and **routed** to visual channels: the capsid bursts out along its symmetry axes on the kick,
the atoms wiggle on the "other" stem, the vocals light it up, the camera zooms and turns. With Random on, a new virus
comes at each new song.

This folder is its spec, read at `b1cdfbb72` (branch `virus-on-the-rock`, worktree `~/molstar-votr`) **plus the
uncommitted work of 2026-11-26** (mesoscale parts, the Entries tree, curves, duck, background flash, camera step, the
built-in route sets). A change to the app updates the page it touches in the same commit.

- **What it does, feature by feature, what is expected, and its status:** [features.md](features.md). Its last section
  is the checklist to test from.
- **How it is built, the per-frame path, where it is weak:** [architecture.md](architecture.md).
- **The interface, panel by panel, and where labels and help say something the code does not:** [ui.md](ui.md).
- **Every change outside the app folder** (Mol\* core, shaders, plugin managers, build), with what could go upstream:
  [core-changes.md](core-changes.md).
- **The audio routing contract** (signal path, the five rules, measured sync expectations):
  [audio-routing-spec.md](audio-routing-spec.md). It wins over this folder on routing.
- **The research behind the built-in route sets:** [audio-reactive-research.md](audio-reactive-research.md).

## Decisions on record

From Ludo, as written in the routing spec, the commits and the project notes. What is still open is at the end of
[architecture.md §7](architecture.md#7-decisions-ludo-2026-11-26).

1. **One signal path** (2026-11-26): stems, bands and beat are fixed as committed at `b1cdfbb72`; no change to them to
   make one preset look better. Shaping (gain, floor, release, curve, mode, the `Loudness (vs. the song)` source) is per
   route and opt-in.
2. **Routes belong to the user** (2026-11-26): only a preset chip, the Saved… list, the route editor and startup replace
   the routes. Loading a model or a song keeps them.
3. **A route set is routes only** (2026-11-26): it does not change the analysis or the motion shapes; it turns on a
   motion target its routes need.
4. **No change shown before it passes the expectations** of the routing spec, and no edit while Ludo is testing (each
   rebuild reloads the page, which stops the song and resets the routes).
5. **Drums & Bass Burst is the reference effect** (routing spec, "What it is for"): drum hits and the bass burst the
   capsid out along its symmetry axes in time with the kick. Every other preset or set must keep it possible.
6. **Bands first, stems later** (2026-08-13). Stems came after (`1a32a9c8a`).
7. **The interview of 2026-11-26** (18 decisions: load adds, pause and clear rest, the 9th Who refused, a clip to react,
   every hidden control in the UI, rigid whole object, prominence as a source, labels follow the code, split by card,
   canvas recording, no culling of bursts; nothing upstream, no URL parameters, no mic, no multi-fold):
   [architecture.md §7](architecture.md#7-decisions-ludo-2026-11-26).

In the code but not on record as Ludo's: HIV (cellPACK), Exosome and Machinery of Life are kept out of Random (a code
comment: 0.7–1.1 GB of JS heap, measured 2026-11-25), and Nipah is local only.

## The parts

| Part | Where | What |
| --- | --- | --- |
| The app | `src/apps/virus-on-the-rock/` (`app.tsx` ~3.25k lines, `song-change.ts`, `random-structures.ts`, `style.scss`) | the page, its sidebar and overlays, the catalog, Random and song change, the CPU channels (camera, opacity, clip, background), the beat cycle |
| Audio analysis | `mol-plugin-state/manager/audio-reactor.ts`, `audio-prominence.ts` | bands, beat, prominence from one mixed signal |
| Stems | `mol-plugin-state/manager/audio-stems/` | Spleeter, HTDemucs, SCNet in a worker (onnxruntime-web), delayed playback |
| Routing | `mol-plugin-state/manager/audio-routing.ts`, `helpers/audio-routing-inspired.ts` (untracked) | sources → channels, the route math, the 8 Who slots, save and load |
| Manager | `mol-plugin-state/manager/audio-reactive-animation.ts` | the audio element and graph, the tick, params, status |
| Who | `helpers/audio-affect.ts`, `helpers/mesoscale-part.ts` (untracked), `mol-repr/structure/audio-affect-binding.ts` | a route narrowed to a model, entity, chain, residue, atom or mesoscale part |
| Presets | `helpers/audio-reactive-presets.ts` | ten presets: analysis, motion shapes, routes |
| Rendering | `mol-geo/geometry/animation.ts`, `mol-gl` (schema, renderer, shaders), `helpers/assembly-symmetry-axis.ts` | the GPU channels: symmetry burst, instance motions, wiggle, whole object, glow, hue |
| Loop | `mol-plugin/animation-loop.ts` | per frame: tick → axes → Who → `canvas3d.setAudioFrame` |

## Running it

```
cd ~/molstar-votr
node ./scripts/build.mjs -a virus-on-the-rock
```

Open `http://localhost:1338/build/virus-on-the-rock/` (at `/`, the page's relative `molstar.js` and `molstar.css`
404). `npm run dev:all` also works but watches ~30 bundles (~1.7 GB for esbuild). Every rebuild reloads the page.

Stem weights are read from `models/stems/<id>/` (gitignored, absent today), else Hugging Face. The Nipah example needs
`data-local/nipah.bcif` and a localhost host.
