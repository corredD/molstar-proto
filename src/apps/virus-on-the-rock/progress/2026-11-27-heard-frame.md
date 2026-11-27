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

