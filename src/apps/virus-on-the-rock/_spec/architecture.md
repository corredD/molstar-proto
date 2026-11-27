# Virus on the Rock architecture (2026-11-26)

How VotR is built (read at `b1cdfbb72` plus the uncommitted work), the path of one frame, where it is weak, and the
decisions to take. A change that moves one of these updates this page in the same commit.

## 1. The layers

```
 app            src/apps/virus-on-the-rock     sidebar, overlays (SVG), catalog, Random + song change,
                (~3.25k + 0.2k lines)          CPU channels (camera, opacity, clip, background), beat cycle
   │ plugin.managers.audioReactive (params, routes, load/play), plugin state (structures, reprs)
 manager        audio-reactive-animation.ts    audio element + graph, tick, params, status (≈30 Hz)
   ├─ analysis  audio-reactor.ts, audio-prominence.ts      bands, beat, prominence (main thread, JS FFT)
   ├─ stems     audio-stems/ (worker, onnxruntime-web)     separated levels on a context-time timeline
   └─ routing   audio-routing.ts                           routes → drives (9 GPU kinds + CPU targets), 8 Who slots
   │ drives, scopes
 loop           mol-plugin/animation-loop.ts   per frame: tick, symmetry axes, Who ranges, setAudioFrame
   │ global uniforms (≈35) + material uniforms (axes[32], ranges[8], …)
 rendering      mol-gl shaders                 applyTumble / applyWiggle / applyObjectTransform, glow, hue
```

VotR keeps no store of its own for the scene: structures and representations are Mol\* state cells. Its own state
(sidebar, axis mode, Random, visualizers) is React state, not persisted. The audio state is the manager's
(`BehaviorSubject`s and a `PD` param object).

## 2. The signal path

The only one (rule 1 of the [routing spec](audio-routing-spec.md)):

```
<audio> ─► MediaElementSource ─┬─► Delay (D) ─► speakers
                               ├─► Analysis delay (D − lead) ─► Analyser ─► silent sink ─► speakers
                               └─► AudioWorklet tap ─► stem worker (44.1 kHz STFT, ONNX) ─► timeline
analyser window ─► reactor (resample, Hann, FFT, 6 bands, flux beat, prominence)
                       └─► stems: timeline at currentTime − D + max(0, lead − 30 ms), or band stand-ins
                              └─► router: per route source → onset? → curve → floor + gain × v → release → duck
                                     └─► drives[target] (cap 40) or Who slot (≤ 8)
                                            └─► presented frame: a ring of the last 256 ticks stamped with
                                                ctx.currentTime, read at currentTime − outputLatency (what is heard)
```

The analyser reads what the context renders now; the speakers play it `outputLatency` later (~10–30 ms built in,
150–250 ms Bluetooth or AirPlay). So every consumer (the shader's audio frame, the CPU channels, Who, the overlay, the
beat cycle, the status) reads the **presented frame** (`audio-presented-frame.ts`), never the live analysis: frame,
raw, stems, drives, scope slots, route values and visualizer arrays as they were when what is heard now was analysed.
The reactor, the stems timing and the router (releases, onsets) run in real time on the live state. The clock is a port
(`AudioOutputClock`; `webAudioOutputClock` reads `currentTime` and `outputLatency` live, 0 while the context is not
running or where the browser has no `outputLatency`, clamped to 2 s). The read rule: the newest entry stamped at or
before `currentTime − outputLatency`, never older than the one presented, never ahead of what is heard. At a stamp
boundary (the read time past the newer entry's stamp by less than half its interval, at least 3 ms and at most 5 ms: L = 200 ms
at 60, 120 or 144 Hz, a clock in audio quanta) the picture stays one entry behind the rule and steps one per frame, so tick jitter does not
alternate hold and skip; the newest entry is exempt (never held back: latency 0, or a latency that drops below a frame, follows the analyser); inside an interval it follows the rule (heard-phase: the earlier one-sided rule stayed one
entry behind for good after a single late tick, ≈ 95 ms instead of ≈ 49 ms at 49 ms frames, L = 32 ms). What reads
the presented frame as sound (beat cycle, song detection) gates on the status's `heardPlaying`, not on the live
`playing` (the transport). The presented objects keep their identity and nothing is allocated per frame. No flush on pause, stop or clear: the device still plays the last `outputLatency`.

**When the sound stops** (sound-stops, 2026-11-27). Heard = playing, or after a pause or the end of the file until the
stem delay line has drained (`heardUntil`: the stop + the delay node's time now, each tick; the stop is the element's
pause or ended event, or the first tick not playing as a fallback, so stalled ticks do not stretch the tail and a delay
changed in the tail moves it). Not heard either while the line hands over the silence it held at a (re)start with an
empty line (`primedUntil` = the start + D; the first play, after a flush, after a pause whose tail has drained): no
blocked analysis counted, no `heardPlaying`, no floor, no stem sample. A resume inside the tail is heard at once (the
silence of the pause, shorter than D, is read as heard: open, see the sound-stops progress). While heard, the analyser is read (the tail) and the stems are sampled at
t − D; once not, the silent analysis, the band stand-ins and `router.update(…, heard = false)`: every route releases to
0, no floor, with its own release, and rests at exactly 0 below `AudioRestCutoff` (1e-3). Stop, a new source and Clear
flush the delay line (a new delay node; the separator's tap on the source stays) and hear nothing at once; Clear also
resets the router. The status also emits when the presented drives and route values come to rest
(`presented.atRest`), so the last emission after Clear carries zeros. The ring carries heard, so `heardPlaying` is heard as heard (with no delay, `playing` as heard).

**Lookahead** (lookahead-sync, 2026-11-27). The delay line already holds the next D seconds of audio, so the analysis
reads them ahead of the speakers by its own lag behind a hit: the **lead** = ½ the reactor's input window + the band
attack + `lookaheadTrimMs` (`getAnalysisLeadSeconds`), within [0, D]; Drums & Bass Burst 33.3 ms, Ambient Pulse 76.4 ms
at 48 kHz. D (`getAudioDelaySeconds`): a stem model's (the Audio Delay slider, else the model's default); with no
model and lookahead on the slider, else 0.25 s; else 0. The analyser has a branch of its own beside what is heard
(departure c: parallel, not a split in series): `source → analysis delay (D − lead) → analyser → silent sink`, so the
heard delay node keeps its meaning (heardUntil, primedUntil, the separator reset) and a lead change (lookahead, trim,
a preset's window or attack) moves only the analysis branch, no click, no separator reset; a D change moves both and
resets the separator. Stop, a new source and Clear flush both. `tick` decides heard at now (the router's floor, the
ring) and analysed at now + lead (whether the analyser is read, the blocked count), so in the tail
[stop + D − lead, stop + D) the analysis reads silence while the floor holds and the routes release, and at a
(re)start the analysis warms from D − lead (a kick in the first lead of a song is partly lost). The stems are sampled
at t − D + max(0, lead − 30 ms) (`StemTimelineLeadS`: the stem timeline runs ≈ 30 ms ahead of the bands already,
departure a). The ring and the output latency are unchanged (the lead excludes L). Lookahead off, or D = 0: the lead is
0 and every trace is bit for bit what it was. Off in the core manager, on at VotR startup (`DefaultAudioSync`,
departure d: 0.25 s more latency, a 0.25 s tail on pause). Measured in the routing spec's lookahead row.

Departures from the brief, for Ludo to confirm: (a) the stems at t − D + max(0, lead − 30 ms), not t − D + lead;
(b) the lead from the analysis settings plus a trim, not one global number (35 ms would leave Ambient Pulse ~50 ms
late); (c) a parallel analysis branch, not a split in series (a second 30 s buffer, ~11.5 MB); (d) lookahead on at VotR
startup, off in core; (e) the ports spec's wiring expectations change (both delay lines); (f) `angine.mp3` (4.9 MB) in
the prd build; (g) Mol\* `Slider` in the Stem Separation card (the other cards use native range inputs); (h) the
expectation is |kick → peak| ≤ one frame or 17 ms, whichever is larger.

## 3. One frame

1. `PluginAnimationLoop.tick` (rAF; a frame's time capped at 33.3 ms).
2. `audioReactive.tick(t)`: analyser read, silence probe, visualizer arrays, `reactor.analyze`, stems, `router.update`,
   then the live state into the presented frame's ring and the entry of `currentTime − outputLatency` out of it (every
   branch, the no-audio one too), status (throttled 32 ms) from the presented objects. Steps 3–8 read only the
   presented frame.
3. `syncStructureAssemblyAxes`: per structure, its symmetry axes (≤ 32) and centre into its render objects' material
   uniforms; cached by key. Mesoscale parts of one virion share one middle (wip).
4. `syncAudioAffect`: each Who resolved to a vec4 per render object (`uAudioAffectRanges[8]`), written on change.
5. `canvas3d.setAudioFrame`: bands, scales, stems, 7 motion drives, glow (× 0.35), hue (× 0.25), scope kinds and drives;
   a redraw is forced while the wave or a scope is driven.
6. `canvas3d.tick` → draw. The vertex shader moves instances and atoms; the fragment shader adds glow and hue.
7. `didDraw` → the app's `CpuChannels.update`: clips, zoom, spin / rock / step (`camera.setState`), opacity (walks render objects), background
   (`setProps`).
8. Status (≈30 Hz) → the app: beat cycle (axis order as a representation param update), song-change detector.

## 4. The app

Files (all under `src/apps/virus-on-the-rock/`; the split of D15 happened in the lane `split-app-by-card`, PR pending):

- `app.tsx`: `VirusOnTheRockApp`: the plugin, loading, Random and song change, presets, the sync of the selected
  structure, and the composition root `VirusOnTheRockApp.create`, which builds the app with the Canvas3D adapter of the
  CPU channels' port (`canvas3d-channel-target.ts › createCanvas3DChannelTarget`) and sets the probe
  `window.__vorProbe`. The app is the one holder of `state` (a `BehaviorSubject`); `patchState` goes through
  `state-patch.ts` and emits only when a field changed.
- `state.ts`: `VirusOnTheRockState`, `createInitialState` and the pure axis and cycle-target helpers.
- `catalog.ts`: constants, the audio and mesoscale catalogs, the effect defaults, the representation params.
- `state-patch.ts`: `patchIfChanged` (a new snapshot only when a field changed, by reference).
- `beat-cycle.ts`: `BeatCycle`, the beat detector of the axis cycle (trigger 0.75, release 0.3, 400 ms), no viewer inside;
  the app applies the target it steps to.
- `cpu-channels.ts`: `CpuChannels` (clip, camera zoom, spin, rock and step, background flash, opacity) behind the
  `CpuChannelTarget` port (camera, background, render objects), so it runs in a test with no Canvas3D; the pure
  functions (`cameraZoomFov`, `opacityFactor`, ...) are exported.
- `canvas3d-channel-target.ts`: `createCanvas3DChannelTarget`, the Canvas3D adapter of that port (its camera and
  background patches made once and reused).
- `ui/controls.tsx`: `VirusOnTheRockControls` composes the cards; `ui/cards/*.tsx`: one file per sidebar card (load
  structure, audio, audio presets, stem separation, audio routing, prominence, representation, motion targets, clip
  reactivity, axis mode, visualizers, entries, session), each reading its own slice of the state.
- `ui/control-card.tsx` (the card frame), `ui/state-slice.ts` (`useStateSlice`: a card's slice subscription re-renders it
  only when the slice changed; the cards are not memoized, so a re-render of the Controls (its own slice, or the PDB
  id and audio URL inputs it holds) re-renders them all),
  `ui/visualizer-overlay.tsx` (histogram, wave lines, radial ring).
- `song-change.ts`, `random-structures.ts`, `style.scss` as before.

Behaviour changed in this lane in three places: `patchState` emits only on change (fewer re-renders); the clip pass at
rest writes the base values back once, then does nothing until a drive moves again; and that resting pass takes the
hidden objects too, so an object hidden while moved shows at its base values. Other behaviour is unchanged
(characterization tests: `beat-cycle.spec.ts`, `cpu-channels.spec.ts`).

The clip rest check is exact (`=== 0` on both clip drives). Since sound-stops (2026-11-27) a released route rests at
exactly 0 once nothing is heard (cut-off 1e-3, proposed, Ludo to confirm; [TODO.md](../TODO.md) 13), so on a paused
song the clip pass writes the base values back once and rests (`cpu-channels.spec.ts`).

- **Loading.** `loadPdb(id, replace)`, files, mesoscale examples. Add puts the new structure on a grid; replace (Random)
  removes the old after the new is drawn, prunes data, eases the camera. Mesoscale loads remove first, then build parts
  (wip). `syncSelectedStructure` runs one at a time, ≤ 3 re-passes (wip).
- **Representation.** Blob surface (default) or Spacefill, by swapping the type block of every Representation3D cell
  (the spacefill block cached per cell). Mesoscale forces Spacefill and remembers the previous mode.
- **Presets.** `applyAudioPreset(name, 'replace' | 'keep')`: analysis + animation from the preset, the user's
  sensitivities, threshold and axis order kept; routes only on `replace`.
- **CPU channels and the beat cycle** are `CpuChannels` (run from the app's `didDraw`) and `BeatCycle` (fed by the status
  handler), with their own constants (`cpu-channels.ts › CpuChannels`, `beat-cycle.ts › BeatCycle`).
- **Song change.** `IcyTitleReader` (a second fetch with `Icy-MetaData: 1`) or `SongChangeDetector` (gap, band-balance
  shift); then `loadRandomModel`.

## 5. Where it is weak

- **Audio-off regressions in plain Mol\*.** The branch makes wiggle and tumble amplitude depend on a drive: without audio,
  the `wiggleAmplitude` and `tumbleAmplitude` params no longer move anything, while `hasAnimation` still redraws every
  frame. Every plugin builds the manager and runs the two syncs each tick ([core-changes.md](core-changes.md)).
- **Drives after clear or pause.** Fixed by sound-stops (2026-11-27, D2): pause and the end of the file release every
  route to exactly 0 (after the stem delay's tail), Clear resets the router. Left: the rest takes up to
  `releaseMs · ln(v / 1e-3)` (≈ 2–2.7 s for Drums & Bass Burst), not `releaseMs`; a source removed without Clear still
  freezes the drives (no `router.update` without audio).
- **Who is per material, the ranges per visual.** See features §8: likely wrong ranges on all but the first visual of
  a representation. One range per slot; 8 slots, the 9th silently global.
- **Culling ignores the motion.** Frustum, LOD, hi-Z, fog and near/far use static bounding spheres; a burst at drive 13
  with scale 15 moves a 30 Å unit ~65 Å, at drive 40 hundreds.
- **CPU channels are the app's.** Camera, opacity, clip and background targets do nothing in other Mol\* apps; the
  Mesoscale Explorer's preset buttons never set routes.
- **Dead parameters still shown.** `audio*Source/Strength/Floor`, `tumbleTranslationMode`, `uAudioAffectCount/Instances`
  and three GLSL functions: still in the param UI and uploaded, no effect.
- **Per-frame cost scales with the scene.** The two syncs walk every render object each frame (allocations, a
  `JSON.stringify` per scope); the vertex shader runs up to 6 fbm, 5 scope loops of 8 and a 32-axis loop per vertex;
  illumination never converges while things move.
- **Uniform budget.** ~56 vec4 slots of arrays + ~60 scalars in every vertex program: may exceed WebGL1's 128 on low-end
  devices.
- **Time.** Envelopes run on the loop's capped time (slow below 30 fps); camera channels on real time.
- **Layering.** `mol-plugin-state/helpers/assembly-symmetry-axis.ts` imports `extensions/assembly-symmetry`;
  `mol-plugin/animation-loop.ts` imports the audio managers; the renderer's interface carries `AudioReactiveFrame`.
- **`app.tsx` is still large** (loading, Random, song change, presets, selected-structure sync); UI, catalog, CPU channels
  and the beat cycle moved out (D15), and the channels and the beat cycle now have tests. The app's loading paths have none.
- **Tests stop at the router.** No test for the manager's tick, stems sampling, presets, Who resolution and packing, the
  app's loading, or pixels.

## 6. What holds up

- One signal path, routes per user, measured sync (35–39 ms kick → peak) and the keep-on-load rule.
- The router: small, pure, tested, serializable; a route is one line of JSON.
- GPU motion on instances: no geometry rebuild, no shader recompile on a param or axis change (uniforms only).
- Per-virus symmetry from RCSB, mesoscale parts sharing one middle.
- Stems off the main thread, with playback delayed so what is seen matches what is heard.
- Photosensitivity guard on the background flash.

## 7. Decisions (Ludo, 2026-11-26)

Taken in an interview on the questions this spec raised. Each says what the code does today and what is to be built.
Items 1–13 of the first draft's open list are all decided; none is built yet.

1. **Load adds.** Load, the PDB chips and files keep adding beside what is there (a gallery); Random and the mesoscale
   examples keep replacing. To build: the new structure comes into view (today it lands 2.75 radii away, off screen).
2. **Pause and Clear rest.** Both bring every drive to 0 over its release; Clear resets the router. **Built** in the
   lane `sound-stops` (2026-11-27): no floor once nothing is heard, exactly 0 below 1e-3, the stem delay's tail
   followed after a pause or the end of the file; Stop, a new source and Clear silence the tail. Coordinator's
   choices, Ludo to confirm: the 1e-3 cut-off, the exponential rest (≈ 2–2.7 s, not `releaseMs`), the flush on Stop
   and a new source, floors off before the first play.
3. **The 9th narrowed route is refused.** Once 8 routes are narrowed, the Who select of the others is disabled with a
   note. Today the 9th silently acts on the whole view.
4. **Clip Reactivity gets a clip.** The card adds a sphere and a plane clip object; the clip position and size targets
   then move and scale them.
5. **Every hidden control gets UI.** Floor and release per route; the gain slider to 40 (the file limit); onset weight
   and temperature under the Prominence radar; stem provider (WebGPU / WASM) and delay in the Stem Separation card.
6. **Routings only persist.** Everything else starts fresh at each reload, as today.
7. **No URL parameters** for now.
8. **The dev server stays as is** (repo root, 0.0.0.0, no Range): LAN access is useful.
9. **Startup keeps the stream**, and `angine.mp3` is copied into the build so the fallback works.
10. **Whole Object is rigid**: one pivot, the structure's centre; today each instance turns about its own.
11. **Several folds at once is not planned.** The beat cycle (one fold at a time) stays.
12. **Nothing goes upstream; VotR is what matters.** The audio-off regressions of plain Mol\* apps on this branch
    ([core-changes.md](core-changes.md#regressions-with-audio-off)) are left as they are. core-changes.md stays as the
    record of what the branch touches, its upstream tags for information only.
13. **Prominence becomes a route source**: each band's prominence (0–1, sums to 1) as a source next to the bands. This
    replaces the 2026-08-13 "display only".
14. **Labels follow the code.** Behaviour unchanged; the text is fixed: the Random note (a model now, then one per song),
    "Cycle Every N Beats" (counts rises of the symmetry-axes drive), the Beat Threshold range and help (not used by the
    cycle), Stem Drift's description (not auto-picked), "waveform line" (one line per route). The other mismatches of
    [ui.md](ui.md) the same way.
15. **`app.tsx` is split by card** (one file per sidebar card, a module for the CPU channels and the beat cycle),
    behaviour unchanged, so lanes can work in parallel and the channels can be tested. **Built** in the lane
    `split-app-by-card`; PR pending. Behaviour unchanged except the three changes listed under §4 (state emits only on
    change, the clip pass rests, the resting pass restores hidden objects).
16. **No microphone input.**
17. **Record a dance as video, canvas only**: a Record button writes the Mol\* canvas to WebM (no SVG overlays).
18. **Bursts are not culled on screen**: while audio drives, bounding spheres grow by the largest motion the drives can
    give, so frustum, LOD, fog and near/far account for it.

### Still open

- The Who leak within one representation (features §8): fix once checklist step 11 shows it on screen.
- **The clip rest cut-off.** 1e-3 proposed and built (`AudioRestCutoff`, sound-stops, 2026-11-27): a released route
  rests at exactly 0 below it once nothing is heard, so the clip pass rests (§4). Ludo to confirm the number.
- The order of the work. A proposal: the split (15) first, then the broken items (2, 3, 9, the Who leak), then the new
  UI (4, 5, 13, 14), then rigid object (10), culling (18), recording (17).
