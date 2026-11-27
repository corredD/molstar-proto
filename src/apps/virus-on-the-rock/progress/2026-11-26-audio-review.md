# Audio-reactive review (2026-11-26, Alex mode, after #65 and #66)

Scope: every audio → movement mapping (analysis, stems, routing, drives, shader and CPU channels), its sync and its
state, on `virus-on-the-rock` at `db9e02f0a`. Sources: `/code-review high` over the 20 pipeline files (10 findings,
read only), a skeptic pass with probes, and Alex's own probes. Each issue is proven before it is listed; fixes land
through lanes, test first.

## Issues

### 1. ISSUE — the visuals run ahead of the sound by the output latency (measured −156 ms)

- **Where:** `src/mol-plugin-state/manager/audio-reactive-animation.ts` `tick` (and `updateStems`): the analyser reads
  the samples the context renders now; the speakers play them `AudioContext.outputLatency` later. Nothing in the
  pipeline reads `outputLatency` or `getOutputTimestamp` (`grep -rn outputLatency src` → none).
- **Proof** (Chrome, port 1350, `kick120.wav`, Drums & Bass Burst, separation off, 191 frames at ~50 ms): kick →
  symmetry-axes peak, median over 13 kicks, **+45 ms against the media clock** (the control: it reproduces
  `clicksync`'s 34–47 ms) and **−156 ms against what is heard** (−134 to −182 ms, every kick early).
  `outputLatency` 192 ms, heard-vs-context 201 ms (`getOutputTimestamp`), base latency 5.8 ms.
- **Why the spec misses it:** `clicksync.mjs` measures against `audio.currentTime`, which is ahead of the speakers by
  the output latency; the routing spec's 50 ms expectation passes while the eye sees the burst before the ear hears
  the kick. Built-in speakers (~10–30 ms) hide it; Bluetooth or AirPlay (~150–250 ms) show it.
- **Fix:** delay the router's outputs (drives, scope drives, route values) by `outputLatency`: a ring of the last
  ~1 s of outputs stamped with `ctx.currentTime`, read at `currentTime − outputLatency` (typed arrays, allocated once:
  hot-loop rule). The router's own state (releases, onsets) keeps running in real time; the stems' `heard` time stays
  as is, since the whole output is delayed after it. `clicksync` gains a "heard" column (via `getOutputTimestamp`) and
  the expectation moves to it: kick → peak ≥ 0 and ≤ 50 ms + one frame, heard.
- **Status:** open, to a lane.

## Still to deliver (ranked; proof state after the skeptic pass)

| Next | Finding | Grade | Proof | VotR reachable | Known |
| --- | --- | --- | --- | --- | --- |
| 2 | Ambient Pulse makes an `amplitude → instanceRandom` route while it turns Instance Beats off; Defaults, + Add route and a target change never call `enableMotionsFor` | ISSUE (low) | probe: 1 of 10 presets fails (`getPresetRoutes` × `instanceTumbleEnabled`) | yes, featured chip | no |
| 3 | stems on: pause and the end of a file analyse silence while the delay line still plays 6–11 s (`audio-reactive-animation.ts` tick) | ISSUE | plausible (read); needs a browser probe | stems on only | no |
| 4 | illumination and hue never force a redraw: the vocals glow freezes with all three motion chips off (`canvas3d.ts` setAudioFrame, `scene.ts` hasAnimation) | ISSUE (low) | read | UI only | no |
| 5 | a 9th narrowed route falls into the global drive | ISSUE | probe 9 vs 8 | yes | D3 / TODO 2 |
| 6 | Pause keeps the floors (wiggle 0.2); Clear freezes drives (core panel only) | ISSUE | probe | Pause yes, Clear no | D2 / TODO 1 |
| 7 | axes cache never hits (`assembly-symmetry-axis.ts:124`) | COMMENT | probe 2,2,2,2 vs fixed 2,1,1,1 | every frame | no |
| 8 | `hasNoise` needs tumble speed and frequency > 0 for the symmetry, axis and normal bursts, which use neither | COMMENT | read; all presets > 0, not in VotR UI | no | no |
| 9 | stem separator: Off during the first tap load reloads the model; a failed tap never retries | COMMENT | probes | ms window / rare | no |
| 10 | per-frame allocations: hierarchy syncs in every app; `getRenderObjects()` with clip or opacity on | COMMENT | read / probe 0,10,10,10 | yes | §5, D12; split review |
| 11 | a released drive sticks at a denormal (4e-323): forced redraws, clip never rests | COMMENT | probe | hidden in VotR | TODO 13 |
| 12 | `packSlot` keeps one range; > 8 serial ranges merge min..max | COMMENT | read | no (units visuals) | partly features §8 |
