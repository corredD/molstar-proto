# heard-frame (2026-11-27, lane of the overnight; review issue 1)

Branch `votr/heard-frame` from `votr/overnight`, worktree `~/molstar-votr-lanes/heard-frame`, port 1350.

## Brief (from [2026-11-27-overnight.md](2026-11-27-overnight.md))

- **Asked:** the capsid moves when the kick is heard, on any output (built-in speakers, Bluetooth, AirPlay).
- **Build:** one presented snapshot that every consumer reads (the shader's audio frame: bands, amplitude, stems,
  drives, scope drives; the overlay's frame, spectrum and route values; the beat cycle's status), taken from a ring of
  the last ~1 s stamped with `ctx.currentTime` and read at `currentTime − outputLatency` (read live each frame;
  undefined → 0; clamped to the ring). Typed arrays allocated once. Releases, onsets and stems timing stay in real
  time. Clock and latency are ports, so the tests inject them.
- **Tests:** with latency 0 the presented trace equals today's (the `measure` harness); with latency L the presented
  trace is today's shifted by L, within a frame; no allocation per frame (a guard).
- **Check:** `clicksync` heard column: kick → peak between 0 and 50 ms + one frame, in Ludo's Chrome.
- **Order (coordinator):** (1) the analyze-offset fix, (2) `AudioPresentedFrame` + `AudioOutputClock` +
  `webAudioOutputClock` with their spec, (3) the manager wiring, (4) spec pages, (5) clicksync before/after.

## Design (Opus)

The design accepted by the coordinator, copied as given:


### Consumers (checked)
animation-loop.ts reads tick()'s return, stems, drives, scopeCount/scopeKind/scopeDrive → setAudioFrame (audio-redraw needs no change). syncAudioAffect (audio-affect.ts:430) reads manager.scopes. CpuChannels reads audioReactive.drives (app.tsx:118). Beat cycle fed status.drives.symAxis (~30 Hz, app.tsx:483). Song detector reads status.frame.raw (app.tsx:149). Overlay reads status.visualization.spectrum, status.frame (mix, beatIntensity, bands), status.routeValues. Prominence card reads status.frame bandProminence/frequencyBands/bandOnsets. Core panel mol-plugin-ui/controls/audio-reactive.tsx reads status.frame incl. raw. status.visualization.waveform: no reader. No useMemo/React.memo keyed on status objects → status may carry reused objects. updateStatus allocates per emission (drives spread, new Map(values), status object); analyze and router.update allocate per frame — not fixed here, listed.
Verified: ambient-pulse fft 2048 @ 22050 Hz needs 4459 samples at 48 kHz; analyser buffer 8192; analyze reads samples 0..4459 → skips newest 3733 ≈ 78 ms (performance ≈ 39 ms; 0 at 44.1 kHz and for default/drums-bass-burst).

### 1. Presented snapshot — new src/mol-plugin-state/manager/audio-presented-frame.ts
`class AudioPresentedFrame`, one per manager, ring allocated once, RingCapacity = 256 (4.2 s at 60 Hz, 1.07 s at 240 Hz), struct-of-arrays index e*stride+k.
- `scalars: Float64Array(cap*S)` (Float64 so L=0 is bit-identical, `toBe`). Per entry: stamp (ctx.currentTime s); frame's 6 scalars (amplitude, peakAmplitude, beatIntensity, dominantFrequency, dominantFrequencyNormalized, mix); 6 bands × (frequencyBands, bandOnsets, bandProminence) = 18; same 24 for raw; 4 stems + stemsSeparated; 18 drives in AudioRouteTargets index order (loop by index, never Object.keys); scopeCount, scopeKind[8], scopeDrive[8]; routeCount. S = 90.
- `viz: Float32Array(cap*152)`: 96 waveform + 56 spectrum.
- Scope affects: `scopeAffect: (AudioAffect|undefined)[]` length cap*8, filled undefined in the constructor; references only, so slot i's affect/kind/drive come from the same entry.
- Route values: `routeIds: Int32Array(cap*R)`, `routeValues: Float64Array(cap*R)`, R = max(16, routes.length); grow (new arrays, copy old entries) only when setRoutes brings more than R — a user action, never a steady frame. push reads ids from the routes array, values via router.values.get(id) (no allocation).
- Presented object allocated once, mutated in place: `frame` from createEmptyAudioReactiveFrame (nested records written by band key over DefaultAudioBandDefinitions); `stems`, `stemsSeparated`; `drives: AudioRouteDrives`; `scopeCount`, `scopeKind: Float64Array(8)`, `scopeDrive: Float64Array(8)`; `scopes: AudioScopeSlot[]` from a pool of 8 slot objects (rewrite 0..count, set length = count); `routeValues: Map<number, number>` one persistent Map — if the entry's id sequence equals the last presented, only set existing keys, else clear() then set (only after a route edit); `visualization: { waveform, spectrum }` copied with an index loop (subarray allocates a view).
- API: `push(stamp, frame, stems, separated, drives, scopeCount, scopeKind, scopeDrive, scopes, routes, values, viz)`, `present(readTime)`, `flush()`.
- Read rule (one rule): the newest entry with stamp <= readTime + 1e-9; none → the oldest entry in the ring. Covers start-up, L beyond the ring (clamp), a frozen clock. Monotonic cursor: if the rule names an entry older than the last presented, keep the last (a growing L holds the picture, no replay). Backward scan from the newest, ≤ cap compares, no allocation. Never "not yet filled": the oldest entry stands in (the wiggle floor never drops to zeros).

### 2. Clock and latency ports
```ts
/** the audio clock as the presented frame reads it; read once per tick */
export interface AudioOutputClock {
    /** context time of the samples the analyser hands over now, s (AudioContext.currentTime) */
    now(): number;
    /** how far what is heard trails now(), s; finite, >= 0 */
    latency(): number;
}
export function webAudioOutputClock(ctx: AudioContext): AudioOutputClock  // same file
```
Adapter: now = ctx.currentTime; latency = 0 when ctx.state !== 'running', else ctx.outputLatency (undefined/non-finite → 0), clamped [0, 2] s; both read live every frame.
Why outputLatency not getOutputTimestamp: getOutputTimestamp returns a new object per call (hot-loop rule); outputLatency is a number and is what the review names; clicksync's heard column (getOutputTimestamp) stays an independent check. Budget: −156 + 192 ≈ +36 ms median (+10..+58) + ≤1 frame. baseLatency (~6 ms) deliberately left out (top of range is tight). Open: Safari has no outputLatency → L = 0 = today; a later fallback samples getOutputTimestamp ~1/s (not built).
Manager wiring: constructor takes ports `constructor(readonly plugin, ports: AudioReactivePorts = DefaultAudioReactivePorts)`, `AudioReactivePorts = { createContext(): AudioContext, outputClock(ctx): AudioOutputClock }`, defaults getAudioContextCtor and webAudioOutputClock; context.ts unchanged.
At the end of EVERY tick branch, incl. the no-audio early return: read once t = clock.now(), L = clock.latency(); push(t, live state); present(t − L). No context yet → no clock: use the last stamp and L = 0. Never use tick's timeMs (properTimeT capped at 33 ms/frame, slow under jank).
Flush only when the clock goes backward (t < newest stamp: context replaced, or a test). No flush on pause, seek, stop, clear or new source: the device really plays out the last L; a flush would show rest for L then the release tail L late.
Stays live (real time): reactor, router.update (releases, onsets), band-stems fallback (updateStems reads live currentFrame), areFramesClose; status loaded, playing, sourceLabel, analysisBlocked, sampleRate, stemStatus, error.
Stems: unchanged — sampled at currentTime − stemDelay; do NOT subtract L in updateStems (the ring delays everything after it). Note for sound-stops: after a pause, presented drives follow live drives L later (correct).

### 3. "analyze reads the oldest samples": fix it, own commit, FIRST in the lane
audio-reactor.ts: `const offset = samples.length - inputSampleCount`; computeRms/computePeak take (samples, offset, count); plain copy reads samples[offset + i]; resampler reads samples[offset + …] with maxIndex = offset + inputSampleCount − 1.
Sequence: (1) failing test: an impulse in the last sample of an analyser-sized buffer longer than inputSampleCount: today raw.peakAmplitude 0, after > 0. (2) fix. (3) regenerate goldens (AUDIO_GOLDEN=1): only the two ambient-pulse goldens (kick, song) may change (every other run has offset 0 at 48 kHz) — check that. (4) PR flag: "ambient-pulse goldens moved ≈78 ms earlier on purpose; performance gains ≈39 ms at 48 kHz".

### 4. API surface, minimal diff
Existing names keep their meaning "what the visuals show now" = presented values: tick() returns presented.frame; getters frame, stems, drives, scopes, scopeCount, scopeKind, scopeDrive return presented; status.frame, visualization, stems, stemsSeparated, drives, routeValues point at the presented (reused) objects — no spread, no new Map. Status object itself still one allocation per emission (≤ 30 Hz): open. Private fields keep live values under current names (currentFrame, currentStems, router.*).
| File | Change |
| audio-reactor.ts | offset fix (commit 1) |
| audio-presented-frame.ts | new, ~150 lines: ring, read rule, AudioOutputClock, webAudioOutputClock |
| audio-reactive-animation.ts | ports in constructor; push+present at the end of tick; getters and updateStatus read the presenter; setRoutes sizes the route block (~50 lines) |
| animation-loop, CpuChannels, beat-cycle, overlay, cards, audio-redraw, audio-affect, app.tsx | no edit |
| _spec/core-changes.md, audio-routing-spec.md | heard row becomes the expectation; media "for information" |
~200 production lines.

### 5. Tests
Fake clock: now = wall time (keeps running through paused ranges; not media time), latency = L. With the measure harness driving the real manager: FakeAudioContext { currentTime advanced by frameMs/1000 per tick incl. paused, state 'running', settable outputLatency incl. undefined }, injected via ports.createContext; outputClock stays the real webAudioOutputClock (adapter under test).
1. L = 0: every presented field === the live value of the same frame (toBe); goldens still pass recorded from presented values.
2. L = 100 and 200 ms at 16 ms frames (not multiples of the frame: no float ties): k = ceil(L/frame); presentedL[i] === live0[i − k] (toBe) for every drive, stem, route value, i ≥ k, also across a paused range (proves no flush); i < k shows the oldest entry; kick → peak lag grows by exactly k frames.
3. Edges: L beyond the ring clamps to the oldest; a growing L holds the picture (monotonic cursor); clock backward flushes; state !== 'running' and outputLatency undefined → L = 0; after a route edit, routeValues and scopes show for k frames the old ids/affects of their entry, consistently.
4. Allocation guard (presenter only): over 1000 steady push+present, every handed-out object keeps its identity (frame, frame.frequencyBands, frame.raw, drives, stems, routeValues, scopes and slots, scopeKind, scopeDrive, visualization); spies on globalThis.Map/Set/Array/Float32Array/Float64Array count 0 constructions inside push and present. analyze and router allocations: listed in the PR, not fixed.
5. The analyze offset test (§3).
6. clicksync (record in PR): heard column kick → peak median ≥ 0 and ≤ 50 ms + one frame, headless (expected ≈ +33 ms, from −1 today) and in Ludo's Chrome (expected ≈ +36 ms); media column moves by ≈ L, "for information".

## Log

### Step 1: analyze reads the newest samples (bb2b5778e)

- Red: `npx jest src/mol-plugin-state/manager/_spec/audio-reactive-animation.spec.ts`: 2 failed, 6 passed. Both new
  tests (an impulse in the last sample of an 8192 buffer, fft 2048 at 22050 Hz from 48 kHz; and of a 2048 buffer, fft
  1024 at the context rate): `raw.peakAmplitude` expected > 0, received 0.
- After the fix, before regenerating: `audio-pipeline.spec.ts` 2 failed, 17 passed, and the two are exactly
  `ambient/kick` and `ambient/song` (golden traces); DERIVED, the burst runs and the pause block unchanged.
- Regenerated (`AUDIO_GOLDEN=1`), pasted only those two blocks: the ambient-pulse drives move ~78 ms earlier (the
  kick at 0.25 s shows from row 0.256 now, from 0.384 before). Same commit as the fix, so every commit is green.

### clicksync before (staging + step 1, which leaves drums-bass-burst unchanged; headless Chromium, port 1350)

```
full preset x1: output delay median 31 ms, baseLatency 5 ms, outputLatency 32 ms
  kick->peak MEDIA median 40 ms (min 23, max 58) | HEARD median 11 ms (min -8, max 30) | peak 12.53 | rest/peak 0.50
drums only x1:  MEDIA median 37 ms (19..53) | HEARD median 4 ms (-9..24) | peak 6.50 | rest/peak 0.28 max 0.32
bass only x1:   MEDIA median 40 ms (20..65) | HEARD median 8 ms (-8..36) | peak 6.04 | rest/peak 0.69
full preset x2: MEDIA median 40 ms (18..57) | HEARD median 11 ms (-11..26) | peak 24.92; gain x2 -> peak ratio 1.99
```
(media step ~40 ms per frame headless.)

### Step 2: AudioPresentedFrame and the output clock (2af6f6dce)

- Red: `audio-presented-frame.spec.ts` without the module: cannot find module (0 tests). Then 2 failures that were
  the spec's own (its live fake wrote route values for the original route list), fixed in the spec.
- The allocation guard is proven to bite: a `new Float64Array(1)` injected in `present` makes it count 1000 (reverted).
- 13 tests: the read rule, exact stamps, the oldest before the first stamp, the clamp past the ring (300 pushes, cap
  256 → entry 44), the monotonic cursor, equal stamps (frozen clock) keep the ring, a backward clock flushes, nothing
  pushed changes nothing, a route edit (each entry its own ids and affects, Map and scopes keep their identity), the
  route block growing (16 → 20 routes, older entries kept), the guard (1000 push + present: 17 handed-out objects keep
  identity, 0 constructions of Map, Set, Array, Float32Array, Float64Array, Int32Array, Object), the spy's own control;
  `webAudioOutputClock`: live reads, undefined / NaN / Infinity → 0, suspended / closed → 0, clamp [0, 2].

### Step 3: the manager reads the presented frame (5af12fc3f)

- Red (the 6 tests run on the unwired manager): 5 failed: latency 0 identity (status.drives was a spread, the frame
  new each tick), the 7- and 13-frame shifts at 100 and 200 ms, the lag +7 / +13. Green after: every golden unchanged
  at latency 0; presented[i] === live0[max(0, i − k)] (`toBe`) for 18 drives, 4 stems and every route value over a run
  with a 3–5 s pause; kick → peak lag median, min and max each + k exactly (2 → 9 at 100 ms, 2 → 15 at 200 ms).
- 2a26bd45d widens the latency-0 test to every presented field (all scalars, 6 bands × 3 sets × frame/raw,
  stemsSeparated, both visualizer arrays).
- The no-audio branch (source removed at frame 200, 100 ms): the presented amplitude stays > 0 one frame after, is 0
  at 200 + k + 1, and the status keeps emitting (throttled) until then, then stops.

### clicksync after (headless Chromium, port 1350, outputLatency 32 ms, ~38 ms per frame)

```
full preset x1: MEDIA median 81 ms (65..98) | HEARD median 51 ms (33..68) | peak 12.45 | rest/peak 0.52
drums only x1:  MEDIA median 78 ms (56..106) | HEARD median 48 ms (27..74) | peak 6.50 | rest/peak 0.32
bass only x1:   MEDIA median 85 ms (64..98) | HEARD median 57 ms (32..68) | peak 6.09 | rest/peak 0.67
full preset x2: MEDIA median 77 ms (60..100) | HEARD median 47 ms (29..71) | peak 25.07; gain x2 -> peak ratio 2.01
```
Heard moved +40 ms (11 → 51), not the +32 of the latency: at ~38 ms per frame headless, 32 ms of latency is one whole
frame back (the newest entry at or before now − L). At 60 fps it is 2 frames, 33 ms. Every heard kick is ≥ 0 (min 27),
the medians are within 50 ms + one frame (88 ms). Ludo's Chrome on Bluetooth/AirPlay is the check still to do
(expected ≈ +36 ms median from the review's −156 ms).

### Fix step (after the gate)

- **2 + N1, one entry per frame (ebfe3538b, core).** Red, the reviewer's jit/quant probes and an L step ported into
  `audio-presented-frame.spec.ts`: 60 Hz, L = 200 ms (12 frames exactly), ticks ±1.5 ms: 418 holds and 417 skips in
  1700 frames; a 5.3 ms quantized clock (256 samples at 48 kHz), L = 0.2: 63 holds, 62 skips in 500; ±40 ms steps in L:
  254 holds, 253 skips in 990 (the test first stepped +40, −80, +40; cf79b8c71 makes it 0.2 → 0.24 → 0.2 → 0.16 → 0.2,
  and against the old rule (mutant run) that gives 248 holds, 249 skips in the first window). Fix: the skeptic's one-sided variant (c): the rule's own target `seq` (before the
  monotonic hold); `seq` = last + 1 or last + 2 → last + 1; otherwise the rule (monotonic hold, re-sync). Green: 0 holds,
  0 skips, 0 early, at most 1 behind the rule, never ahead; through the ±40 ms steps |presented − rule| ≤ 2 at every
  frame and steady again 10 frames after each step; L = 0 presents the newest entry every frame, and every L = 0 golden
  and the k-frame shift and lag tests are unchanged (the tripwire). Two older expectations moved on purpose: "never
  goes back" (the rule names 16 two past 14 → 15, then 18 three past), and the allocation guard's warm-up now reads at
  the same offset as its steady loop (a one-frame latency shrink would otherwise lock it one behind: documented on
  `present`, "a latency that shrinks by less than two frames can leave the picture one entry behind").
- **1, heardPlaying (13c2f8708 core, aa6ed01f1 app).** Core red: `heardPlaying` undefined (2 failed). Each ring entry
  carries `playing` (no source → 0); the status adds `heardPlaying` (documented: playing as heard, for what reads the
  presented frame as sound; `playing` stays live, for the transport). A change of `heardPlaying` is emitted at once (not
  throttled): mutant run without it, the last status after the source is removed said `heardPlaying: true` (the beat
  cycle would never get `pause()`). Tests: L = 0 heardPlaying === playing every frame; at 100 ms it is playing 7 frames
  late through a pause; every emission carries the presented value; the last emission after removal is false.
  App: the status → song detector feed moved to `song-change.ts` (`feedSongDetector`, gates on `heardPlaying`) so the
  spec runs the app's own feed; the beat cycle gate (`updateAxisCycle`) reads `heardPlaying`. Red (the feed extracted
  as it was, on `playing`): L = 0.7 → `["gap"]`; green `[]`; L = 0 `[]` both. The beat-cycle gate has no test of its own
  (a private method of the app; same one-line gate).
- **4 (4c790bab8).** The plain-copy test adds a bass tone in the newest 1024 of 2048 samples: mutant (copy offset
  reverted, `audio-reactor.ts` restored after): bass 0; fixed > 0.3.
- **7 (f58b34853).** Chosen: document, ring kept at 256. The 2 s clamp guards the clock, not the ring; the ring spans
  4.3 s at 60 Hz, 1.07 s at 240 Hz; past it the oldest entry stands in (at most the span late). Real outputs ≤ ~0.3 s.
- **8 (58f619c49).** `AudioReactiveStatus` documents frame, visualization, stems, drives and routeValues as the same
  objects every emission (read on emission, do not keep or mutate); `Readonly<>` on frame, visualization, stems, drives
  (shallow; no reader needed a change, tsc clean).
- **9 (09274e90f).** `audio-reactive-ports.spec.ts`: the manager built with fake ports; `play()` makes the context
  through `createContext`, `tick` resolves `outputClock` once for that context and presents (k + 0.5) frames late as
  k + 1 entries. Mutant (the port bypassed with `webAudioOutputClock`): fails.
- **10 (664d90d8f).** Routing spec rest row: measured at latency 0, on screen L later.
- Spec pages (4680f5e7c): core-changes and architecture record one entry per frame and `heardPlaying`; 61640a17b puts
  the clicksync after the fix step in the routing spec's heard row, and "exactly ⌈L / frame⌉" is offline (no jitter),
  at most one entry more with jitter.
- Live `playing` readers left as they are (transport and UI, not sound): the app state `audioPlaying` (play/pause
  button), the overlay's opacity (`visualizer-overlay.tsx:117`), the core panel's "Playing" text.

### clicksync after the fix (headless Chromium, port 1350, outputLatency 32 ms, ~38 ms per frame)

```
full preset x1: MEDIA median 73 ms (65..96) | HEARD median 42 ms (35..67) | peak 12.57 | rest/peak 0.50
drums only x1:  MEDIA median 71 ms (50..82) | HEARD median 38 ms (20..49) | peak 6.50 | rest/peak 0.32
bass only x1:   MEDIA median 84 ms (65..116) | HEARD median 54 ms (35..84) | peak 6.03 | rest/peak 0.66
full preset x2: MEDIA median 77 ms (66..100) | HEARD median 47 ms (34..69) | peak 25.10; gain x2 -> peak ratio 2.00
```
Heard 42 ms median (51 before the fix step), every heard kick ≥ 0 (min 20), max 84 ≤ 88 (50 ms + one frame). Headless
frame jitter makes run-to-run differences of ~10 ms; the one-behind lock did not push the median later here.

## Review (gate: reviewer + skeptic, Opus)

| # | Finding | Reviewer | Skeptic | Grade | Outcome |
|---|---|---|---|---|---|
| 1 | Song detector and beat cycle gate on the live `playing` while reading the presented frame: a resume heard L late is fed as playing (L = 0.7 → 'gap') | found (j/song, j/resume probes) | confirmed (per the fix brief) | should | fixed: 13c2f8708 (core, `heardPlaying`), aa6ed01f1 (app) |
| 2 | The read rule alternates hold and skip when L is near a frame multiple, with tick jitter | found (j/jit probe) | confirmed (sk/rule.mjs; per the fix brief) | should | fixed: ebfe3538b |
| N1 | Same with an audio clock in quanta (j/quant); the fix must not present early | — (j/quant is the reviewer's probe) | new (sk/fix.mjs, fix-steady.mjs: variants pm1, asym) | should | fixed with the skeptic's one-sided variant (c): ebfe3538b |
| 3 | (content not in the fix brief) | found | no defect (per the fix brief) | nit | left as is |
| 4 | The plain-copy offset test passes with the copy offset reverted (peak is computePeak's) | found (m/probe.ts) | not given to the fix step; the skeptic planted the mutant in `audio-reactor.ts` and restored it (backup sk/audio-reactor.ts.bak identical to HEAD, git status clean) | nit | fixed: 4c790bab8 |
| 5 | not handed to the fix step | — | — | — | coordinator: verdict from the gate |
| 6 | not handed to the fix step | — | — | — | coordinator: verdict from the gate |
| 7 | The 2 s latency clamp exceeds the ring span (1.07 s at 240 Hz) | found | not given to the fix step | nit | documented, ring kept at 256: f58b34853 |
| 8 | The status's presented objects are shared across emissions, undocumented | found | not given to the fix step | nit | documented + Readonly: 58f619c49 |
| 9 | No spec injects the ports through the constructor | found | not given to the fix step | nit | `audio-reactive-ports.spec.ts`: 09274e90f |
| 10 | Routing spec rest row: at which latency | found | not given to the fix step | nit | 664d90d8f |

Verdict cells: the fix brief gave the grades, N1's origin and "3: no defect"; the skeptic's verdict per finding
otherwise was not handed to the fix step ("not given"); 5 and 6 were not in the fix brief at all. The coordinator fills
them from the gate's text before the PR body.

## Built

- `audio-reactor.ts`: analyze reads the newest samples of a longer analyser buffer (ambient-pulse was ~78 ms late at
  48 kHz).
- `audio-presented-frame.ts` (new): `AudioPresentedFrame` (ring of 256 ticks, struct of arrays, presented objects
  allocated once), `AudioOutputClock`, `webAudioOutputClock`.
- `audio-reactive-animation.ts`: `AudioReactivePorts` (createContext, outputClock) with browser defaults; push +
  present at the end of every tick branch; getters, `tick`'s return and the status read the presented objects;
  `setRoutes` sizes the route block.
- Spec pages: routing spec (heard row is the expectation, media for information), architecture §2/§3, core-changes.
- Fix step: the read rule steps one entry per frame (one-sided hysteresis); `heardPlaying` on the status (each ring
  entry carries `playing`); the song detector's feed (`feedSongDetector`, `song-change.ts`) and the beat cycle gate on
  it; `audio-reactive-ports.spec.ts`; docs on the clamp vs the ring and on the shared status objects.

## Decided (by me, within the design)

- **The clock is resolved per context in `tick`** (cached by context identity), not where the context is made: the
  offline harness sets the private `audioContext` directly, so this is what makes it run the real `webAudioOutputClock`
  on its fake context (the helper needed no change; `ports.createContext` is still the port `ensureAnalyser` uses).
- **Deviation: the no-audio branch keeps emitting the status** (throttled) while the presented frame is not at rest.
  Before, it emitted once when the live frame cleared; with the frame presented L late that one emission would show
  the last heard values and freeze the overlay on them.
- **Deviation: forced status emissions (setRoutes, setParams, stop, clear, play/pause events) show the last presented
  values** until the next tick, where they showed the live router values (a new Map) before. No reader depends on it
  (grepped: overlay, cards, beat cycle, song detector, core panel read status per emission).
- **The step-1 goldens are in the fix's commit**, so every commit is green.
- **The lag test runs without a pause**: `kickPeakStats` places kicks on the wall clock, so a paused run gives
  meaningless lags; the shift test carries the pause.
- **Deviation: `push` also calls `ensureRouteCapacity`** (a no-op when the routes fit), not only `setRoutes`: the app or
  a test can set `state.routes` without `setRoutes`, and a ring too small would write past an entry's route block. A
  steady frame never grows it.
- **Consumers with retained references, read (after the gate-less self-check):** none. `animation-loop.ts` copies the
  frame's and stems' numbers into a new `setAudioFrame` object; `audio-redraw.ts` and `renderer.ts` copy scope kinds and
  drives into their own arrays field by field; `syncAudioAffect` keys on the affects' JSON, not on slot identity;
  `CpuChannels` reads `drives()` fields per pass; the React readers read the status per emission.
- `presented.routeValues` holds the current routes' values only (the router's Map can keep a removed route's value
  until its states shrink): same for every reader.

- **Fix step (by me, within the gate's brief):** `playing` is `push`'s second argument (after the stamp); the no-audio
  branch pushes `playing` 0 (no source: nothing plays, though the live status `playing` can say true with an empty
  `src`); a change of `heardPlaying` bypasses the 32 ms throttle (else the last emission after a removal can say
  playing); the feed moved to `song-change.ts` so the spec runs the app's code; the ring stays at 256 (nit 7:
  documented, not sized from the clamp).

## Learned

- The headless frame (~38 ms) quantizes the latency: the presented shift is ⌈L / frame⌉ frames, so 32 ms costs a
  whole 38 ms frame headless and 33 ms at 60 fps.
- Not fixed, listed: `reactor.analyze` and `router.update` allocate per frame (new frame object, new scope slots,
  spread band records); the status object is still one allocation per emission (≤ 30 Hz). Safari has no
  `outputLatency`: latency 0 there, as before (a fallback sampling `getOutputTimestamp` ~1/s is not built).

## Size

Brief ~200 production lines. Actual: `audio-presented-frame.ts` 254 (with docs), `audio-reactive-animation.ts`
+88 −30, `audio-reactor.ts` +11 −9: ~290. What took the room: the struct-of-arrays read/write per scalar set and the
route block growth.
Fix step: `audio-presented-frame.ts` +24 −4 (the rule 2 lines, the rest docs and `playing`), `audio-reactive-animation.ts`
+34 −13 (mostly docs), `song-change.ts` +19, `app.tsx` +5 −12: ~45 net, mostly documentation.

## Checks

After the fix step (HEAD 4680f5e7c + this file):
- `npm run lint`: 0 errors (2 warnings, unused eslint-disable in `app.tsx` 534/540, not this lane's).
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx jest src/apps/virus-on-the-rock src/mol-plugin-state src/mol-repr/structure src/mol-canvas3d`: 21 suites,
  175 tests passed.
- `node ./scripts/build.mjs -a virus-on-the-rock --prd`: built, then `build/` removed.
- clicksync on 1350: above (server stopped, port free).

Before the fix step:
- `npm run lint`: 0 errors (2 warnings, unused eslint-disable in `app.tsx` 541/547, not this lane's).
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx jest src/apps/virus-on-the-rock src/mol-plugin-state src/mol-repr/structure src/mol-canvas3d`: 20 suites,
  166 tests passed (before 2a26bd45d, which only widens one test; its spec re-run: 25 passed).
- `node ./scripts/build.mjs -a virus-on-the-rock --prd`: built, then `build/` removed.
