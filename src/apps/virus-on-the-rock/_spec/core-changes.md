# Virus on the Rock's changes outside the app

Every change the `virus-on-the-rock` branch makes outside `src/apps/virus-on-the-rock`, so they can be tested together
and as the record of what it touches. Ludo decided (2026-11-26) that nothing goes upstream and the audio-off
regressions are left as they are: the upstream tags below are for information only. A change that adds one adds an entry here.

- **Merge-base:** `5bd9cb1f3` (origin/master, "Merge pull request #1914 from giagitom/illumination-fix-artifacts").
  Branch tip when written: `b1cdfbb72`, plus the uncommitted work of 2026-11-26 (**wip**).
- **The file list:** `git diff --numstat $(git merge-base HEAD origin/master) -- src scripts package.json .gitignore
  ':!src/apps/virus-on-the-rock'`. Untracked files are not in it: `git status --short src`.
- **Upstream:** `candidate` = a general feature or fix master would want; `needs work` = generic but needs cleanup or a
  generic API first; `votr only` = app-specific; `fix first` = breaks plain Mol\* today.
- Wiggle and tumble (`uWiggle*`, `uTumble*`, the wiggle texture) are upstream's (procedural animation, merged in
  `169fceb80`); the entries below are what the branch adds on top.

## Regressions with audio off

These change plain Mol\* with no audio loaded and block any upstream move. Read in code against the merge-base (there,
`applyWiggle` and `applyTumble` used `uWiggleAmplitude` and `uTumbleAmplitude` directly), not run.

1. **Wiggle no longer animates from its param.** `applyWiggle` sets the amplitude to 0 unless
   `uAudioDriveWiggle + scopedDrive > 0` (glsl:183-186); only the wiggle-texture theme still moves.
2. **Tumble no longer animates from its param.** `hasNoise` needs a drive sum above 0 (glsl:228).
3. **Redraw with nothing moving.** `scene.hasAnimation` still returns true for an amplitude > 0, so the canvas redraws
   every frame.
4. **Every plugin pays.** `context.ts` builds `AudioReactiveAnimationManager` for every plugin; the loop runs
   `syncStructureAssemblyAxes`, `syncAudioAffect` and `setAudioFrame` each tick, audio or not.
5. **Larger programs.** Every mesh, spheres, cylinders, lines and points program, in every variant, carries the audio
   uniforms (~56 vec4 of arrays, ~60 scalars) and one more varying.

Fix: when no drive is routed to a channel, fall back to the param's amplitude as upstream did; skip the syncs when the
manager has no audio and no Who.

## Summary

| Area | Files | Lines (+/−) | Upstream |
| --- | --- | --- | --- |
| Shaders and renderer | `mol-gl/` (schema, renderer, scene, 11 shader files) | +564 / −44 | fix first, then needs work |
| Animation params | `mol-geo/geometry/animation.ts` | +220 / −2 | needs work |
| Canvas | `mol-canvas3d/canvas3d.ts` | +14 / −1 | needs work |
| Loop and context | `mol-plugin/animation-loop.ts`, `context.ts` | +86 / −3 | fix first |
| Audio managers | `mol-plugin-state/manager/audio-*.ts`, `audio-stems/` | +2,705 (+486 tests) | needs work (analysis), votr only (routing) |
| Helpers | `assembly-symmetry-axis.ts`, `audio-affect.ts`, `audio-reactive-presets.ts`, untracked `audio-routing-inspired.ts`, `mesoscale-part.ts` | +1,431 + 257 | votr only / needs work |
| Representations | `audio-affect-binding.ts`, `units-visual.ts`, `complex-visual.ts` | +35 / −2 | votr only |
| UI | `mol-plugin-ui/controls/audio-reactive.tsx`, `audio-prominence-radar.tsx`, `structure/procedural-animation.tsx` | +274 | needs work |
| Mesoscale Explorer | `apps/mesoscale-explorer/ui/states.tsx` | +51 | votr only |
| Build | `scripts/build.mjs`, `package.json` (onnxruntime-web 1.31.1), `.gitignore` (`models/`) | +166 / −8 | votr only |
| Trivial | `camera-spin.ts` (trailing newline) | | drop |

## graphics (`mol-gl`, `mol-geo`, `mol-canvas3d`)

- **Global audio uniforms** (`schema.ts` GlobalUniformSchema, `renderer.ts` `setAudioFrame`): bands, amplitude, beat,
  stems, 7 drives, glow, hue, scope count/kind/drive [8]. `updateIfChanged`, forced redraw while the wave or a scope is
  driven. *needs work*: replace `AudioReactiveFrame` in the renderer and Canvas3D interfaces by a generic "external
  drives" API; stem, mix and dominant-frequency uniforms are unused.
- **Forced redraw of an audio frame** (`canvas3d.ts` `setAudioFrame`, new `audio-redraw.ts` `AudioRedrawTracker`,
  spec `mol-canvas3d/_spec/audio-redraw.spec.ts`; redraw-and-axes-cache, 2026-11-27): the tracker keeps the previous
  frame (preallocated, nothing allocated per frame). Illumination and hue (global, and narrowed kinds 8, 9) render on
  change only, since their shader terms have no time term (a held value does not render); the instance wave and
  narrowed motion kinds render while above 0 and once more on the drop to 0 (they use `uTime`). Before, illumination
  and hue forced no render at all. VotR presets mask the difference through `hasAnimation`. Commits `canvas3d: ...`,
  no app hunks. *votr only*.
- **Material animation uniforms** (`AnimationSchema`): motion toggles, object transform, axis set (`uAudioAssemblyAxes`
  v3[32], count, centre), `uAudioWaveRadial` (wip), Who ranges v4[8]. *needs work*: the Who ranges differ per visual but
  are uploaded per material (render-item.ts:242-250; all visuals of a representation share one material id), so they
  can leak from one visual to the next. `uAudioAffectCount/Instances` and the `audio*Source/Strength/Floor`,
  `tumbleTranslationMode` uniforms are dead but uploaded and shown.
- **`applyTumble`** (common-animation.glsl.ts:218-325): five instance channels summed: random (fbm), along an axis,
  along the normal, nearest symmetry axis (≤ 32, outward), position wave (radial on surface parts, wip). *candidate*
  for the axis, normal and symmetry burst once behind the toggles; *needs work* for the culling (static bounding
  spheres).
- **`applyObjectTransform`**: rotation and drift, Spectral scaling. *needs work*: pivots on each instance's own centre.
- **`applyWiggle`** with drives and Who: see the regressions.
- **Glow and hue** (`apply-light-color.glsl.ts`, `assign-color-varying`, `color-*-params`, `common-frag-params`,
  `direct-volume.frag`): emissive boost, hue rotation per 20 Å cell, per-vertex Who through `vAudioLight`. *needs work*:
  glow uncapped, missing in tracing and bloom variants, hue cells fixed in world space.
- **Motion toggles** (`atomWiggleEnabled`, `instanceTumbleEnabled`) and their `scene.ts` guards. *candidate*.
- **Dead GLSL**: `getAudioSource`, `getSoftAudioDrive`, `hasResolvedAssemblyTumbleAxis`, `getAssemblyAxisDrive`.
- **Duplicate constant**: `AnimationAssemblyAxisMaxCount` and `AudioReactiveAssemblyAxisMaxCount` (both 32).

## plugin

- **`animation-loop.ts`**: the per-frame audio steps (§3 of architecture.md); `IlluminationGlow` 0.35, `HueTurnPerDrive`
  0.25; LOD motion scale (uncapped). *fix first*: imports the audio managers into the loop.
- **`context.ts`**: `managers.audioReactive`. *fix first*: make it opt-in (a behavior or the app).

## plugin-state

- **`audio-reactor.ts`**, **`audio-prominence.ts`** (tested): bands, flux beat, prominence. *candidate* as a small
  analysis module; the resampler needs an anti-alias filter. Analysis reads the newest `inputSampleCount` samples of
  the analyser buffer (heard-frame, 2026-11-27; it read the oldest, ~78 ms late for ambient-pulse at 48 kHz; the two
  ambient-pulse goldens moved, on purpose).
- **`audio-presented-frame.ts`** (new, heard-frame, 2026-11-27, tested): `AudioPresentedFrame`, a ring of the last 256
  ticks of audio state read at what is heard (`currentTime − outputLatency`), allocated once; at a stamp boundary one
  entry per frame, one behind the read rule, elsewhere the rule (heard-phase, 2026-11-27: the hysteresis applies only
  when the read time is within a quarter interval of the newer stamp, so a late tick no longer leaves a lasting
  frame of lag; never ahead of the rule, the newest entry never held back); each entry carries `playing`; the
  `AudioOutputClock` port and its `webAudioOutputClock` adapter. *votr only*.
- **`audio-reactive-animation.ts`**: the manager. `setRouteAffect` and `pickRouteAffect` return false when refused (a 9th
  narrowed route, D3). A read-only `routeValues` getter (next to `frame`, `stems` and `drives`) lets the offline pipeline
  spec (`manager/_spec/audio-pipeline.spec.ts`, which drives the real `tick`) read each frame's route values (measure,
  2026-11-27; no behaviour change). The test fakes set two private fields (`audioContext`, `analyser`) through one
  documented cast in `_spec/audio-pipeline-helper.ts`. The getters, `tick`'s return and the status read the presented
  frame (what is heard; the same objects every frame, no spread or new Map per status emission); the constructor takes
  `AudioReactivePorts` (`createContext`, `outputClock`) with browser defaults; the status adds `heardPlaying` (playing as
  heard, for the beat cycle and the song detector; `playing` stays live for the transport) and documents its presented
  objects as shared, `Readonly` (heard-frame, 2026-11-27). *needs work*: `tick` skips `router.update` without audio (drives
  freeze); `stemModel` description says WebGPU only.
- **Measuring stick (measure, 2026-11-27; test and tooling only)**: `mol-plugin-state/manager/_spec/audio-pipeline-helper.ts` and
  `audio-pipeline.spec.ts` (offline pipeline, golden traces, drives the real `tick`), and `scripts/votr-sync/clicksync.mjs`
  (browser sync test with a generated click track, `--port` required).
- **`audio-routing.ts`** (tested; curve, duck, `songLoudness`, background, camera step wip). *votr only* as is (its CPU
  targets exist only in the app); the router core is generic. A non-finite source or `dtMs` reads as 0 in
  `AudioRouter.update` (router-nan-guard, 2026-11-26; commit `audio routing: a non-finite source reads as 0…`). A
  narrowed route finds the 8 slots full and adds nothing, never the global drive; `canNarrowRoute(routes, id)` (narrowed-slots,
  2026-11-27, D3).
- **`audio-stems/`** (DSP tested): Spleeter, HTDemucs, SCNet runners, worker, separator. *votr only*; weights on
  Hugging Face `resolve/main` (not pinned). `StemSeparator.onWorkerMessage` stores a non-finite worker energy as 0 (a NaN
  in the model output stuck the running peaks and every stem level for good; router-nan-guard, 2026-11-26).
  `setModel` returns after the tap await when a newer request (a request counter) came meanwhile (Off during the load
  no longer posts `load` and turns the tap on), and a failed tap setup clears `tapLoading` so picking the model again
  after Off retries (stem-separator-edges, 2026-11-27).
- **`assembly-symmetry-axis.ts`**: axes per structure from RCSB symmetry; mesoscale parts share a middle (wip). The
  per-structure cache stores the bare key (it stored `key:count` and compared the bare key, so it never hit: two
  provider reads per structure per sync, now one after the first; redraw-and-axes-cache, 2026-11-27, spec
  `mol-plugin-state/helpers/_spec/assembly-symmetry-axis.spec.ts`; commit of its own, no app hunks).
  *needs work*: imports `extensions/assembly-symmetry` from `mol-plugin-state`; header `@author OpenAI`.
- **`audio-affect.ts`**: Who resolution and packing; mesoscale owners (wip). *votr only*.
- **`audio-reactive-presets.ts`**: ten presets; `getPresetRoutes` makes no route on a motion the preset turns off, and `MotionFlagOfTarget` names the motion switch a route target needs. *votr only*.
- **`audio-routing-inspired.ts`** (untracked, wip): six built-in route sets. *votr only*.
- **`mesoscale-part.ts`** (untracked, wip): membrane / surface / interior / other, the `mesoscale-base` tag. Imported by
  `app.tsx`, `audio-affect.ts`, `assembly-symmetry-axis.ts`: **must be committed with them**.

## repr

- **`audio-affect-binding.ts`**, `units-visual.ts:60`, `complex-visual.ts:58`: each visual's structure and group for
  Who. *votr only*; the binding is set once at creation and likely goes stale when a render object is reused (read in
  code, not run).

## ui

- **`audio-reactive.tsx`**, **`audio-prominence-radar.tsx`**, **`procedural-animation.tsx`**: the generic panel and
  radar. Their preset buttons set analysis and animation, never routes. *needs work*.

## apps/mesoscale-explorer

- **`states.tsx`**: preset buttons and the generic panel in Procedural Animation; membranes get no tumble. *votr
  only* (keep on this branch).

## build

- **`scripts/build.mjs`**: the app entry, `stem-worker.js`, ORT wasm copied to `ort/`; a custom server on 0.0.0.0
  serving the repo root (`no-store`, `/` rewritten to the app, no Range); the live-reload token. *votr only*; kept as is (decision 8).
- **`package.json`**: `onnxruntime-web` 1.31.1. **`.gitignore`**: `models/`.

## Open

- Commit `mesoscale-part.ts` and `audio-routing-inspired.ts` with the wip that imports them.
