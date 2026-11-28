# Virus on the Rock features

Every feature the app has or is expected to have, what it is expected to do, and its status. Read at `b1cdfbb72` plus
the uncommitted work of 2026-11-26 (marked **(wip)**).

**Status:**
- **Tested**: built and covered by unit tests (`npm run jest`). Only the reactor, prominence, routing, stem DSP and the
  song-change detector have tests.
- **Measured**: also checked by the headless click-track scripts of the routing spec (`data-local/tests/*.mjs`). They
  read the drives, not the pixels.
- **Built**: in the code, no test. Read for this spec, not run.
- **Partial**: works with a limit, said.
- **Broken**: the code, as read, does not do what the label or help says. Not yet seen in a browser unless said.
- **Expected**: not built. The behaviour written is a proposal; the ones that need Ludo's word are in
  [architecture.md §7](architecture.md#7-decisions-ludo-2026-11-26); a row decided there says so (D1–D18).

References are `file › symbol`, the file relative to `src/apps/virus-on-the-rock/`; other paths are under `src/`.

## 1. Startup

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| A capsid at once | Tomato bushy stunt virus (2TBV) loads, blob surface, mesoscale preset, SSAO multi-scale, dark background `#09111a`, no illumination | Built | `app.tsx › initializeDefaults` |
| Music at once | The live stream Le Son Parisien starts; if it fails, `examples/angine.mp3`, copied into the build (D9); if autoplay is blocked, the status says to press Play | **Broken** (fallback) | `app.tsx › loadDefaultAudio`. Served at `/build/virus-on-the-rock/`, the fallback's relative path is `build/virus-on-the-rock/examples/angine.mp3`, which the build does not copy: it 404s |
| The reference effect at once | Drums & Bass Burst: its 6 routes (with stem events the kicks and bass notes hit the axes, the drums and bass levels stand in without them), axis amplitude 15, beat threshold 1.1 | Built | `catalog.ts › DefaultEffectKnobs`, `app.tsx › initializeDefaults` |
| Large structures stay fluid | Above 500,000 elements, LOD strides 1/15/70/200 at 500/2000/6000 Å | Built | `catalog.ts › LargeStructureElementThreshold`, `LargeStructureLodLevels` |
| Framed | The camera frames the visible scene × 1.3 | Built | `app.tsx › resetCamera` |
| URL parameters (`?pdb=`, `?audio=`, `?preset=`, `?routing=`) | A link opens a given virus, song and routing | Not planned (D7) | the app reads no URL |

## 2. Structures

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| PDB entry by id | Type an id, Enter or Load: the entry loads next to what is there, on a 3-column grid (2.75 × the largest radius) | Built | `app.tsx › loadPdb`, `app.tsx › placeNewStructuresOnGrid` |
| Example chips 2TBV, 2PLV | Fill the id and load (add) | Built | `catalog.ts › ExamplePdbIds`, `ui/cards/load-structure.tsx › LoadStructureCard` |
| Files (drag and drop, Browser File) | Any Mol\* structure format, added | Built | `app.tsx › VirusOnTheRockApp` (the drag-and-drop handler), `app.tsx › loadStructureFiles` |
| Random | On (the note says so, D14): a random virus at once, then one at each new song, replacing the current one; never the same twice in a row. Off: the title reader stops | Partial | `app.tsx › setRandomPerSong`, `onSongChange`. The note says "Next model at the next song" while it loads one at once |
| Catalog for Random | 13 icosahedral capsids (`random-structures.ts`) + SARS-CoV-2 and HIV (Petworld) | Built | `app.tsx › pickRandomModel` |
| Mesoscale examples | SARS-CoV-2, HIV (Petworld); HIV (cellPACK), Exosome, Machinery of Life (wip); Nipah on localhost only (wip). Replace all models; built as membrane / surface / interior parts; force Spacefill and give the previous mode back on the next load | Built (wip) | `catalog.ts › MesoscaleExamples`, `app.tsx › loadMesoscaleExample`, `buildCellpackParts`, `restoreModeAfterMesoscale` |
| Mesoscale parts | Petworld: membrane (asym `MEM*`) and protein groups per model. cellPACK: one hidden whole assembly + one structure per entity it places | Built (wip) | `catalog.ts › getPetworldGroups`, `app.tsx › buildCellpackParts` |
| Old downloads freed | Data with no drawn structure left is deleted after a remove, a replace or a mesoscale load | Built (wip) | `app.tsx › pruneDataWithoutStructures` |
| Representation | Blob Surface (default) or Spacefill for every structure, switched in place; Spacefill forced on mesoscale, the previous mode back on the next load; a pick by the user wins | Built | `app.tsx › setRepresentationMode` |
| Symmetry per virus | Each structure gets its RCSB assembly symmetry (hidden repr) and its own axes in the shader | Built | `app.tsx › runSelectedStructureSync`, `app.tsx › ensureAssemblySymmetry` |
| Loaded structures tree | Mesoscale parts under their example; eye, remove, a Who picker per row | Built (wip) | `ui/cards/entries.tsx › EntriesTree`, `EntryRow` |
| Load while loading | A second load waits or is refused; every load control is disabled meanwhile | Partial | only the Mesoscale chips are disabled (`ui/cards/load-structure.tsx › LoadStructureCard`) |
| Load a PDB after a virion | The PDB comes into view (D1) | Partial | it goes on the grid 2.75 virion radii away, off screen |

## 3. Audio input and playback

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Audio file | Input or drop (`audio/*`, mp3, wav, ogg, m4a, aac, flac): load, play; routes kept | Built | `app.tsx › loadAudioFile` |
| Audio URL | Load URL or Enter; `.pls`, `.m3u`, `.m3u8` resolved to their first entry; routes kept | Built | `app.tsx › isPlaylistAudioUrl`, `resolveAudioUrl`, `loadAudioUrl` |
| Radio presets | Plus FM, Maple Leaf Rag, FIP, Le Son Parisien (Cloudflare proxy); picking one fills the URL, Load plays it | Built | `catalog.ts › AudioUrlPresets` |
| Play / Pause | Pause brings every drive to rest over its release (D2) | Tested | sound-stops: no floor once nothing is heard, exactly 0 below 1e-3 (≈ 2–2.7 s for Drums & Bass Burst); with stems on, the delay line's tail first (`audio-pipeline.spec.ts` › rest once the sound stops) |
| Clear / no audio | Every channel at rest; the router reset (D2) | Tested | sound-stops: Clear resets the router and flushes the delay line, every drive 0 on the next frame. A source removed without Clear still freezes the drives |
| CORS-blocked stream | Say so instead of a still virus | Built | `analysisBlocked` after 2 s of silence while playing, `ui/cards/audio-routing.tsx › AudioAnalysisWarning` |
| Microphone / line in | Dance to a live room | Not planned (D16) | no `getUserMedia` |
| Sync | Kick → symmetry burst peak ≤ 50 ms + a frame | Measured | 35–39 ms median, separation off (routing spec). Separation on: not measured |

## 4. Analysis

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Six bands | sub-bass 20–60, bass 60–250, low-mids 250–500, mids 500–2k, high-mids 2k–8k, treble 8k–20k Hz; level 0–1 | Tested | audio-reactor.ts:17-24 |
| Loudness, peak, dominant frequency, mix | RMS, max, argmax bin, band mean | Tested | audio-reactor.ts:313-455 |
| Beat | Spectral-flux onset over its EMA baseline × threshold (no tempo) | Tested | audio-reactor.ts:388-395 |
| Prominence | level + onsetWeight × leaky onset, softmax with temperature over the active bands; sums to 1 playing, 0 silent | Tested | audio-prominence.ts |
| Loudness (vs. the song) | Loudness over twice its 8 s average, capped at 1 (the song's average reads 0.5) | Tested (wip) | audio-routing.ts |
| Treble above 12 kHz | Read | Partial | most presets analyse at 24 kHz with a linear resampler and no anti-alias filter: treble covers 8–12 kHz, above aliases |

## 5. Stems

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Separation in the browser | Off, Spleeter 4-stem (4 × 19.7 MB, 6 s late), HTDemucs (126 MB, 10 s), SCNet (12.9 MB int8, 11 s); drums / bass / other / vocals; a model change during a run is safe; HTDemucs' energy is its stems' audio | Tested | stem-models.ts › StemModels, demucsStemEnergies; stem-worker-core.ts. Stem study 2026-11-27 ([progress](../progress/2026-11-27-stem-study.md)): all three on time (kicks within ±5 ms), levels follow the reference 0.94–0.999, live WebGPU matches the offline replay |
| Stem events | kicks, snare/hats and bass notes found in the separated drums and bass by every model (the study's reference detector, in the worker, 0.35 s behind each run inside the delay); each fires once on the frame it is heard, its strength against its kind's loud level | Tested, Measured | stem-events.ts, stem-worker-core.ts, stem-separator.ts › sampleEvents. `angine.mp3` on the study's stems: kicks 100 % / 0.5 % extra against the reference; Drums & Bass Burst kicks 77.5 % hit, valley/peak 0.25 (59 %, 0.73 before); Ludo: "working nicely" (study page preview). Spleeter and SCNet events not yet checked on their own separation |
| Listen to a stem | A speaker toggle per stem on the Stem Separation card: the separated stem (mono, 4 stems from each model) is heard instead of the mix, started on the context clock at its start + D, so in time with the capsid; the mix is muted from the first stem chunk while any is on; a stretch the model lost is silence; off by default, not saved | Tested, Measured | stem-player.ts, stem-worker-core.ts › listening, `scripts/votr-sync/listensync.mjs` (numbers in the stem-listen progress) |
| Heard in time with the stems | Playback is delayed by the model's latency, so the bands and stems match what is heard | Built | DelayNode, `ensureAnalyser` |
| Lookahead | The analysis reads the audio ahead of what is heard by its own lag (½ window + band attack + trim), so a hit moves the visuals on the frame it is heard; 0.25 s delay with no model; on at VotR startup | Tested | lookahead-sync: `audio-pipeline.spec.ts` › lookahead (heard kick → peak 0 frames, was 2), clicksync `--lookahead` (heard 9 / 2 / 12 ms, was 51 / 32 / 39); Ludo's Chrome and HTDemucs not run yet |
| Stand-ins without a model | drums = kick onset over its running peak, squared; bass = max(sub-bass, bass); other = mean(low-mids, high-mids, treble); vocals = mids | Built | audio-reactive-animation.ts:105-121. Raw and weak (0.01–0.1) |
| Status | loading, warming, running (provider, % of real time, seconds ahead), Behind (bands meanwhile), error (bands) | Built | `ui/cards/stem-separation.tsx › describeStemStatus` |
| Weights | Local `models/stems/`, else Hugging Face | Partial | no local copy; URLs on `resolve/main`, not pinned as the comment says |
| Provider and delay controls | WebGPU / WASM, delay 0–25 s, in the card (D5) | Partial | delay, Lookahead and Lead Trim in the card (lookahead-sync); the provider has no UI in the app |
| Retry a failed model | Pick it again | Partial | the same id is ignored: pick Off then the model |
| Turning separation on or off on live radio | Smooth | Partial | playback jumps by the model's delay (6–11 s) |

## 6. Routing

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| A route | enabled, source, mode (Level / Hits), curve (Linear / Log / Exp, wip), target, gain, floor, release, Hit threshold, Stand-in, Who | Tested | audio-routing.ts › AudioRoute |
| Hit threshold | the source at or under it reads 0, above it (x − t) / (1 − t); 0 by default | Tested | audio-routing.spec.ts › stem events |
| Stand-in | the route rests while stem events arrive, acts again when they stop; Drums & Bass Burst's drums and bass routes | Tested | audio-routing.spec.ts, audio-pipeline.spec.ts › stem events |
| Route math | floor + gain × curve(input); rise at once, fall over release; duck; sum per channel, cap 40 | Tested (curve, duck, slots, cap on parse), Measured (gain, sync); release not tested | audio-routing.ts:180-243 |
| Hits mode | the rise over its own 3 s running peak; on an event source (stem events) the event's strength, as Level | Built (bands), Tested (events) | bands: no test; events: audio-routing.spec.ts › stem events |
| Sources | Drums, Bass, Other, Vocals (stems), Kick, Snare/hats, Bass notes (stem events), Beat, Loudness, Loudness (vs. the song), Sub-bass, Bass band, Low-mids, Mids, High-mids, Treble, Mids/Treble | Tested | audio-routing.ts › AudioRouteSources |
| Duck (wip) | A duck route scales every other route by max(0.1, 1 − its value); its own source, other duck and camera-step routes untouched | Tested | |
| Gain ×2 → motion ×2 | linear | Measured | 1.96 |
| Routes survive a load | same routes after a song or model load | Measured | `keep.mjs` |
| Edit floor and release | in the route row (D5) | **Expected** | presets and files only |
| Gain above 20 | the slider goes to 40 (D5) | Partial | slider 0–20, files clamp at 40: a gain of 30 shows pinned |
| Save, load, delete, export, import | browser storage (`vor.audioRouting.v1`, 50 sets), `.json` files; import merges by name; loading reattaches each Who to the models loaded | Tested (parser) / Built (UI) | audio-routing.ts:329-464, `ui/cards/audio-routing.tsx › AudioRoutingLibrary` |
| Built-in route sets (wip) | Datamatics, MilkDrop Breath, Emergence, Hollow Descent, Sidechain Pump, Watercolour; routes only; load turns on the motion they need (as any added, enabled or retargeted route does); not deletable | Partial | audio-routing-inspired.ts. Weak with separation off (routing spec: needs tuning, route by route) |

## 7. Visual channels (route targets)

GPU channels run in the vertex or fragment shader of spheres, cylinders, lines, meshes and points (not volumes, images
or text). CPU channels run in the app after each draw, so they exist only in VotR.

| Target | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Symmetry axes (beat cycle) | Each instance moves out along its nearest symmetry axis (of the order chosen), size tumbleAmplitude / radius × drive × axis amplitude; straight out from the middle without axes | Measured | glsl applyTumble, kind 1. Needs Instance Beats on |
| Instances: random | Per-instance noisy rotation and translation | Built | kind 2 |
| Instances: along an axis | Along X, Y or Z, local or global (outward) | Built | kind 3 |
| Instances: along the normal | Radially out from the assembly middle | Built | kind 4 |
| Instances: position wave | A wave (≈251 Å, ≈3.9 s) across the instances, circular; radial in and out on membrane and surface parts (wip). Runs with Instance Beats off | Built | kind 5 |
| Atoms: wiggle | Noise displacement, amplitude × drive^0.65 | Built | kind 6 |
| Whole object | Slow rotation and drift of the object; Spectral scales X/Y/Z by bass/mids/treble | Partial | to be rigid about the structure's centre (D10); today each instance turns about its own centre |
| Illumination | Emissive glow, 0.35 per unit of drive | Partial | no cap (drive 40 = 14 × the colour); not in lines and points; missing from traced light and bloom (read in code, not run) |
| Colors: spectrum | Hue turns up to one turn (saturates at drive 4), varied per 20 Å cell | Partial | cells fixed in world space flicker as geometry moves; volumes one hue per ray |
| Opacity (fade) | alpha = max(0.15, 1 − 0.4 × drive) | Built | `cpu-channels.ts › opacityFactor`, `CpuChannels.updateOpacity` |
| Camera zoom | FOV narrows 8 % per unit, at most 30 % | Built | `cpu-channels.ts › cameraZoomFov`, `CpuChannels.updateCameraZoom` |
| Camera spin | 0.5 rad/s per unit about the view's up axis | Built | |
| Camera rock | ±0.25 rad per unit, 4 s period | Built | |
| Camera step (wip) | π/4 every 16th rise of the route, eased over 1.6 s | Built | `cpu-channels.ts › CpuChannels.updateCameraStep` |
| Background flash (wip) | Toward `#e8eef4`, at most 60 %, at most one flash per 400 ms (WCAG 2.3.1) | Built | `cpu-channels.ts › backgroundFlashShare`, `CpuChannels.updateBackground` |
| Clip object: position, size | A plane moves 50 Å per unit along its normal; sphere, cube, cylinder scale 1 + drive, cone 1 + drive/2 | Partial | the card is to add a sphere and a plane clip (D4); today the app gives no way to add a clip object; nothing happens until one exists and Clip Reactivity is On |
| Duck the other routes (wip) | See §6 | Tested | |
| Geometry stays visible while it moves | Instances on screen are drawn: bounding spheres grow by the largest motion while audio drives (D18) | Partial | culling, LOD, fog and near/far use static positions: a burst of hundreds of Å can be culled or clipped |

## 8. Who (narrowing a route)

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Levels | All, Model, Entity, Instance, Chain; Residue and Atom for wiggle, illumination, spectrum; camera, opacity, clip, background, step, duck always the whole view | Tested | `maxScopeLevel` audio-routing.ts:277-282 |
| Pick from the viewer selection (◎) | The selection, else the focus | Built | audio-reactive-animation.ts:322-342 |
| Mesoscale parts (wip) | membrane / surface / interior / other groups and single parts; a group only whole | Built | audio-affect.ts, mesoscale-part.ts |
| Who per entry (wip) | From the Loaded Structures tree, give a route to that model or group | Built | `ui/cards/entries.tsx › EntryWhoPicker` |
| Narrowed routes are correct per visual | Each visual draws with its own ranges | Partial (read in code, not run) | `uAudioAffectRanges` is a `'material'` uniform (schema.ts:486); all visuals of one representation share one material id and material uniforms are re-sent only on a material switch (render-item.ts:242-250). Routes on a model or a mesoscale part (their own representations) are safe; an entity, chain or residue inside one representation can draw with the previous visual's ranges. Settled by checklist step 11 |
| More than 8 narrowed routes | Refused: the Who select disabled with a note (D3) | Tested (router, manager) / Built (UI) | `canNarrowRoute`, `setRouteAffect` returns false, `AudioRouter.update` drops a narrowed route with the slots full (never the global drive); `ui/cards/audio-routing.tsx › RouteAffectRow`, `entries.tsx › EntryWhoPicker`. `setRoutes` (every install: load, preset, Defaults, Add) widens narrowed routes past the 8th, in array order and counting disabled ones, to All, so a saved set or an old file with 9+ narrowed routes loads with 8; the router still drops a 9th if one is ever set around it |
| A non-contiguous selection | All its spans | Partial | one range per slot: the first span only |
| A chain or residue on an instance channel | That part moves | Partial | the whole instance moves |
| Who whose target is gone | Said, or dropped | Partial | falls back to the first loaded model (intended for the built-in sets) |

## 9. Presets and motion settings

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Preset chips | Drums & Bass Burst (default), Subtle Drift, Stem Drift, Bass + Spectrum, Bass Groove Strong, Full Spectrum, Ambient Pulse: replace the routes, set the analysis and motion shapes, keep the user's sensitivities, threshold and axis order | Built | `catalog.ts › FeaturedPresetNames`, `app.tsx › applyAudioPreset` |
| Stem Drift's description | says what it does: not auto-picked (D14) | **Broken** (text) | it claims to be picked when separation goes on; `ui/cards/stem-separation.tsx › StemSeparationCard` does not |
| A route never moves nothing because its motion is off | `getPresetRoutes` makes no route on a motion its preset turns off (Ambient Pulse has no instance route); a route added, enabled or retargeted to a motion that is off turns that motion on, once (a gain, floor or curve edit never does); instanceWave needs no motion; loading a model or a song (`applyAudioPreset(name, 'keep')`) keeps the motion flags as they are, only a preset chip or startup applies the preset's | Built | `route-motions.ts`, wired in `app.tsx`; tests `route-motions.spec.ts`, `audio-reactive-presets.spec.ts` |
| Motion targets | Atom Wiggle, Instance Beats, Whole Object (Uniform / Spectral) | Built | `ui/cards/motion-targets.tsx › MotionTargetsCard` |
| Sensitivities | Beat threshold 0–2 (1.1), wiggle 0–16 (1), instance 0–200 (1), object 0–32 (1), axis amplitude 0–200 (15), LOD scale off | Partial | manager's beat threshold range is 0.5–4; the beat cycle no longer reads the threshold |

## 10. Symmetry axes and the beat cycle

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Axis mode | On (default): Assembly or local X/Y/Z, Local or Global frame | Built | `ui/cards/axis-mode.tsx › AxisModeCard` |
| Fold order | Auto (highest) or N-fold from the structure's RCSB symmetry (2, 3, 5 for icosahedral) | Built | assembly-symmetry-axis.ts |
| Beat cycle | Step to the next enabled fold (and X/Y/Z if chosen) every N rises of the symmetry-axes drive (0.75 of its running peak, re-arm 0.3, ≥ 400 ms apart) | Built | `beat-cycle.ts › BeatCycle`, `app.tsx › updateAxisCycle` |
| Label "Cycle Every N Beats" | says it counts rises of the drive (D14) | Partial | counts rises of the drive, not detected beats |
| Several folds open at once (2, 3 and 5 each on its own band) | the viralbeat Phase 2 | Not planned (D11) | the shader holds one axis set per object |
| No symmetry (mesoscale, files) | Straight out from the virion middle, shared by all parts of one virion (wip) | Built | assembly-symmetry-axis.ts |

## 11. Song change

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| By title (ICY) | On a stream that sends `icy-metaint` with CORS, a new `StreamTitle` = a new song (the first is ignored) | Built | song-change.ts:123-194 |
| By sound | A gap (< 0.012 for 600 ms, then sound) or a shift of the band balance (6 s vs the 16 s before, ≥ 0.2 and ≥ 2.2 × the median shift), at most one per 75 s | Tested | song-change.ts:13-97 |
| New audio source | counts as a new song | Built | `app.tsx › onNewAudioSource` |
| Note | "<model>, on <reason>" | Built | `app.tsx › onSongChange` |
| Stream drops while reading titles | falls back to the sound | **Broken** | the reader dies silently and stays "active": no song change until the next source |
| A song change during a load | handled after it | Partial | dropped |

## 12. Visualizers and the session panel

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Histogram | 20–56 bars, reflected | Built | `ui/visualizer-overlay.tsx › AudioVisualizerOverlay` (`barCount`) |
| Wave lines | One scrolling line per enabled route (~5 s), coloured by source, labelled Source → Target | Built | `ui/visualizer-overlay.tsx › AudioVisualizerOverlay` (`buildWavePath`, `RouteLineSamples`) |
| Radial ring | 12–28 mirrored spokes around the projected scene; drag to move, outer handle to scale (0.45–2.6) | Built | `ui/visualizer-overlay.tsx › AudioVisualizerOverlay` (`radialCount`). Not kept |
| Prominence radar | Share of each band; each band's prominence also a route source (D13); onset weight and temperature under it (D5) | Partial (source and controls not built) | `ui/cards/prominence.tsx › AudioProminenceReadout` |
| Session panel | structure, audio, playing, preset, axis mode; closable | Built | `ui/cards/session.tsx › SessionCard` |

## 13. Persistence and sharing

| Feature | Expected behaviour | Status | Where |
| --- | --- | --- | --- |
| Saved routings | browser storage, files | Built | §6 |
| Everything else kept (preset, sliders, representation, visualizers, ring, stem model) | starts fresh at each reload | Built (D6) | only routings persist |
| Record a dance | A Record button writes the Mol\* canvas to WebM, no overlays (D17) | **Expected** | none today |

## 14. Known issues found on the way

- `window.__vorProbe` is kept, with the same global and shape (the app instance), set in `app.tsx › VirusOnTheRockApp.create`. It is read by `scripts/votr-sync/clicksync.mjs` and the local `data-local/tests/sync.mjs` and `keep.mjs`; no longer TEMP (Ludo, 2026-11-26).
- `app.tsx`, `audio-affect.ts` and `assembly-symmetry-axis.ts` import the untracked `audio-routing-inspired.ts` and
  `mesoscale-part.ts`: committing only the modified files breaks the build.
- Below 30 fps every envelope and release slows against real time (the loop caps a frame at 33.3 ms); the camera
  channels use real time.
- The dev server serves the whole repo on every interface, with no Range requests (seeking, Safari).
- NaN on the overlay (`<text> y` / `<path> d` "NaN" from the route lines): a non-finite source stuck a route at NaN for
  good. Fixed in `AudioRouter.update` (a non-finite source or `dtMs` reads as 0; Tested, audio-routing.spec.ts) and in `StemSeparator` (a non-finite model energy is stored as 0; Tested, stem-separator.spec.ts).
- Plain Mol\* regressions with audio off: see [core-changes.md](core-changes.md#regressions-with-audio-off). Left as is (D12).

## 15. Testing it (for Ludo)

Start: `node ./scripts/build.mjs -a virus-on-the-rock`, open `http://localhost:1338/build/virus-on-the-rock/`. Do not
edit the code while testing (each rebuild reloads).

1. Startup: 2TBV, blob surface, Le Son Parisien plays (or press Play Current). The capsid bursts along its axes on the
   kick; the Axis Mode status steps fold to fold (Beat Cycle).
2. Audio File: `examples/vitalic.mp3`. Routes unchanged (count them before and after).
3. Load `2plv`: it appears beside 2TBV; both burst, each on its own axes. Remove 2TBV in Loaded Structures.
4. Random On: a new virus at once; Audio File again: a new virus and the note "…on new audio source". Turn Random Off.
5. Mesoscale › SARS-CoV-2: Spacefill forced; Loaded Structures shows membrane and protein; give the drums route to the
   membrane with its Who ▸; the membrane alone moves. Remove the virion (Loaded Structures › Remove), then load
   `2tbv`: blob surface comes back.
6. Stem Separation › SCNet: status loading → warming → running; the sound is ~11 s late; the stem meters go solid. Off.
7. Audio Routing: + Instance wave; Curve Log on a route; Save as "test"; Defaults; Saved… › test brings it back; Export,
   Import the file. Saved… › Sidechain Pump: the other routes dip on each kick.
8. Presets: Subtle Drift, then Drums & Bass Burst: the routes are replaced each time.
9. Pause: the burst stops and the atoms come to rest within ~3 s (no floor). Play. Stop: no sound after it.
10. Visualizers: each toggle; drag the ring and its handle.
11. Who within one representation: on 2TBV alone, narrow the drums route to one chain (Who › Chain). Only that chain's
    instances should burst; if other chains move with it, the material-uniform leak (§8) is real.
