# heard-phase: the presented frame lags the read rule by a whole frame

Branch `votr/heard-phase` from `votr/overnight`, worktree `~/molstar-votr-lanes/heard-phase`. Follows
[2026-11-27-heard-frame.md](2026-11-27-heard-frame.md) (design, read rule, the gate's findings 2 and N1).

## Brief (coordinator)

- **Defect (measured in Ludo's Chrome, staging build, 3 runs, 49 ms frames, outputLatency 32 ms):** the presented
  drive lags the live drive by ≈ 95 ms (two frames) instead of ≈ L + half a frame. Cause,
  `audio-presented-frame.ts:233`: `if (presentedSeq >= 0 && next >= first && (seq === next || seq === next + 1)) seq = next;`
  — once the rule says next + 1 the cursor takes next and then stays one entry behind for ever (every later frame
  compares against the lagged cursor). The one-sided fix bought 0 holds/skips with a permanent frame of lag
  (16 ms at 60 Hz, 49 ms at 20 Hz).
- **Goal:** a read rule that (1) is never early (presented stamp ≤ t − L), (2) lags the rule by ~0 entries on average
  in steady state (no permanent +1), (3) keeps holds/skips rare under ±1.5 ms jitter and coarse clock steps (128–1024
  frames), (4) re-syncs after L steps, (5) allocates nothing.
- **Candidates**, evaluated with the skeptic's simulations (sk/fix.mjs extended into a table): (a) absorb a single +1
  but catch up when the rule says ≥ next + 1 on two consecutive frames; (b) phase tracking: an EMA of the fractional
  position of the read time between entry stamps, target a fixed phase, rare corrections; (c) our own. For each: mean
  and max lag vs the rule (entries, ms at 60 and 20 Hz), % holds, % skips, early count (must be 0), across the L
  sweep, clock steps and drift. Pick the best, record the table and why.
- **Tests first** (red on the current rule): continuous clock, L = 32 ms at 49 ms frames → mean lag vs the rule
  ≤ 0.1 entry over 1000 frames (today ≈ 1). Every existing presented-frame test stays green (the jitter 0 holds/skips
  may relax to a small bound, justified and recorded; never early stays exact); the L = 0 identity and the k-frame shift
  tests in `audio-pipeline.spec.ts` stay green (run, not edited).
- **Scope:** only `audio-presented-frame.ts`, its spec, the spec pages and this file (the sound-stops lane changes the
  manager and the pipeline harness). One commit per cause, core commits with no app hunks; `_spec/architecture.md` §2
  (the read rule) and `core-changes.md` in an app commit.
- **Checks:** `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npx jest src/apps/virus-on-the-rock
  src/mol-plugin-state src/mol-repr/structure src/mol-canvas3d`. Push; no PR, no gate.
- **Size:** ~10 production lines (the read rule and its doc), ~60 test lines.

## Log

### The candidates, simulated (Opus)

The skeptic's `sk/fix.mjs` extended (script at the end): stamps from a tick clock (60 Hz, or 49 ms frames, "20"), ticks
jittered ±1.5 ms, 200 ppm drift, optionally quantized to 128/512/1024 frames at 48 kHz; the present rule run on them.
Scenarios: steady; L steps 0, +40, 0, −20, 0 ms; L 32 ms → 0 → 32 ms; 1 % of ticks 0.4 frame late (a missed vsync);
gaps drawn from vsync multiples {17, 33, 50, 67} ms (mean 49; advisor's acceptance row); ±8 ms jitter. "Lag" is
rule − presented, the rule being the newest entry stamped at or before the read time.

Variants: **rule** (no hysteresis); **asym** (today: `seq ∈ {next, next+1}` → next); **a** (absorb one +1, catch up
when the rule says ≥ next+1 two frames running); **b** (EMA of the read time's phase in the rule's interval; one entry
back while the phase is < 0.2, back at > 0.3; a linear EMA of a wrapping phase, so it flaps near the boundary, as the
advisor noted); **B0.1** (fair (b): EMA of the unwrapped offset of the read time from the cursor's next entry, in
intervals; step one per frame, catch up when the EMA is > 1.1, re-sync on jumps); **c0.25** (ours: the hysteresis
only when the read time is past the newer entry's stamp by < 0.25 of its interval; the newest entry never held);
**d16** (c with the tolerance = the spread of the last 16 stamp gaps, the timing noise read from the ring);
**e16x0.25** (min of c and d).

Cells: mean lag in entries / mean lag in ms / holds + skips in %. Max lag is 1 entry for every variant but `rule` (0),
about one frame in ms (19–21 ms at 60 Hz, 52–85 ms at 49 ms frames). **Early: 0 in every row of every variant.**

Averaged over an L sweep across one frame (30 values from 100 ms at 60 Hz, from 32 ms at 49 ms frames):

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 |
|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 0.00 / 0 / 8.4 | 0.18 / 3 / 0.0 | 0.04 / 1 / 4.3 | 0.14 / 2 / 7.3 | 0.10 / 2 / 0.7 | 0.12 / 2 / 0.5 | 0.13 / 2 / 0.3 | 0.11 / 2 / 0.6 |
| 60 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 8.4 | 0.27 / 4 / 0.0 | 0.04 / 1 / 4.2 | 0.14 / 2 / 7.4 | 0.10 / 2 / 0.7 | 0.12 / 2 / 0.5 | 0.12 / 2 / 0.3 | 0.11 / 2 / 0.6 |
| 60 | 0 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 / 5.5 | 0.11 / 2 / 0.1 | 0.03 / 0 / 2.8 | 0.13 / 2 / 4.8 | 0.06 / 1 / 0.5 | 0.07 / 1 / 0.4 | 0.08 / 1 / 0.3 | 0.07 / 1 / 0.4 |
| 60 | 0 | hiccups 1% | 0.00 / 0 / 9.7 | 0.50 / 8 / 0.0 | 0.05 / 1 / 4.8 | 0.13 / 2 / 8.5 | 0.11 / 2 / 1.3 | 0.11 / 2 / 1.5 | 0.16 / 3 / 0.8 | 0.11 / 2 / 1.6 |
| 60 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 / 27.3 | 0.30 / 14 / 5.1 | 0.13 / 5 / 20.4 | 0.00 / 0 / 27.3 | 0.25 / 12 / 5.5 | 0.14 / 7 / 14.9 | 0.28 / 13 / 5.3 | 0.14 / 7 / 14.9 |
| 60 | 0 | jitter +-8 ms | 0.00 / 0 / 44.2 | 0.46 / 7 / 7.6 | 0.21 / 2 / 23.2 | 0.00 / 0 / 44.2 | 0.22 / 3 / 20.2 | 0.09 / 1 / 34.2 | 0.45 / 7 / 7.7 | 0.09 / 1 / 34.2 |
| 60 | 128 | steady | 0.00 / 0 / 10.7 | 0.29 / 5 / 0.0 | 0.05 / 1 / 5.8 | 0.10 / 2 / 10.6 | 0.12 / 2 / 1.1 | 0.10 / 2 / 1.7 | 0.13 / 2 / 0.5 | 0.10 / 2 / 1.8 |
| 60 | 128 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 10.4 | 0.30 / 5 / 0.1 | 0.05 / 1 / 5.4 | 0.12 / 2 / 9.7 | 0.11 / 2 / 1.3 | 0.10 / 2 / 1.7 | 0.14 / 2 / 0.6 | 0.10 / 2 / 1.9 |
| 60 | 128 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 / 7.0 | 0.18 / 3 / 0.1 | 0.03 / 1 / 3.8 | 0.10 / 2 / 6.9 | 0.07 / 1 / 0.8 | 0.07 / 1 / 1.2 | 0.08 / 1 / 0.4 | 0.07 / 1 / 1.3 |
| 60 | 128 | hiccups 1% | 0.00 / 0 / 11.9 | 0.52 / 9 / 0.0 | 0.06 / 1 / 6.4 | 0.10 / 2 / 11.7 | 0.12 / 2 / 1.7 | 0.11 / 2 / 2.7 | 0.17 / 3 / 1.0 | 0.10 / 2 / 2.8 |
| 60 | 128 | vsync gaps 17/33/50/67 | 0.00 / 0 / 27.7 | 0.31 / 15 / 5.2 | 0.13 / 5 / 20.7 | 0.00 / 0 / 27.7 | 0.25 / 12 / 5.6 | 0.14 / 7 / 15.0 | 0.29 / 14 / 5.4 | 0.14 / 7 / 15.1 |
| 60 | 128 | jitter +-8 ms | 0.00 / 0 / 44.5 | 0.46 / 7 / 7.6 | 0.21 / 2 / 23.4 | 0.00 / 0 / 44.5 | 0.23 / 3 / 20.1 | 0.09 / 1 / 34.6 | 0.45 / 6 / 7.7 | 0.09 / 1 / 34.7 |
| 60 | 512 | steady | 0.00 / 0 / 39.9 | 0.68 / 10 / 0.0 | 0.20 / 2 / 9.8 | 0.13 / 2 / 40.0 | 0.16 / 2 / 10.3 | 0.14 / 2 / 26.9 | 0.59 / 9 / 2.5 | 0.14 / 2 / 26.9 |
| 60 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 28.4 | 0.58 / 9 / 0.1 | 0.14 / 2 / 7.9 | 0.14 / 2 / 29.6 | 0.11 / 1 / 9.1 | 0.11 / 2 / 19.6 | 0.42 / 6 / 2.0 | 0.11 / 2 / 19.6 |
| 60 | 512 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 / 25.9 | 0.44 / 7 / 0.1 | 0.13 / 1 / 6.4 | 0.13 / 2 / 26.0 | 0.10 / 1 / 6.8 | 0.09 / 1 / 17.5 | 0.38 / 6 / 1.7 | 0.09 / 1 / 17.5 |
| 60 | 512 | hiccups 1% | 0.00 / 0 / 40.1 | 0.68 / 10 / 0.1 | 0.20 / 2 / 10.6 | 0.10 / 2 / 40.2 | 0.17 / 2 / 10.6 | 0.14 / 2 / 27.3 | 0.58 / 9 / 2.8 | 0.14 / 2 / 27.3 |
| 60 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 / 34.5 | 0.35 / 16 / 5.5 | 0.16 / 6 / 22.0 | 0.00 / 0 / 34.5 | 0.30 / 14 / 6.2 | 0.17 / 8 / 16.1 | 0.34 / 16 / 5.5 | 0.17 / 8 / 16.2 |
| 60 | 512 | jitter +-8 ms | 0.00 / 0 / 49.3 | 0.50 / 7 / 9.0 | 0.22 / 2 / 28.1 | 0.05 / 1 / 49.6 | 0.36 / 5 / 17.4 | 0.08 / 1 / 41.3 | 0.47 / 6 / 10.1 | 0.08 / 1 / 41.3 |
| 60 | 1024 | steady | 0.00 / 0 / 43.7 | 0.56 / 7 / 0.1 | 0.22 / 0 / 42.4 | 0.21 / 4 / 49.5 | 0.56 / 7 / 0.4 | 0.00 / 0 / 43.5 | 0.56 / 7 / 0.1 | 0.00 / 0 / 43.7 |
| 60 | 1024 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 43.7 | 0.53 / 7 / 3.3 | 0.22 / 0 / 36.5 | 0.22 / 5 / 50.5 | 0.53 / 7 / 4.4 | 0.00 / 0 / 43.6 | 0.53 / 7 / 3.3 | 0.00 / 0 / 43.7 |
| 60 | 1024 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 / 28.4 | 0.36 / 5 / 0.1 | 0.14 / 0 / 27.6 | 0.21 / 4 / 36.3 | 0.36 / 5 / 0.3 | 0.00 / 0 / 28.3 | 0.36 / 5 / 0.1 | -0.00 / 0 / 28.4 |
| 60 | 1024 | hiccups 1% | 0.00 / 0 / 44.0 | 0.56 / 7 / 0.5 | 0.22 / 0 / 42.0 | 0.21 / 4 / 49.8 | 0.56 / 7 / 0.8 | 0.00 / 0 / 43.8 | 0.56 / 7 / 0.5 | 0.00 / 0 / 44.0 |
| 60 | 1024 | vsync gaps 17/33/50/67 | 0.00 / 0 / 35.2 | 0.43 / 19 / 7.2 | 0.16 / 6 / 24.1 | 0.04 / 2 / 34.7 | 0.32 / 14 / 9.4 | 0.14 / 6 / 24.9 | 0.39 / 17 / 8.2 | 0.14 / 6 / 24.9 |
| 60 | 1024 | jitter +-8 ms | 0.00 / 0 / 58.1 | 0.40 / 4 / 17.9 | 0.24 / 0 / 35.8 | 0.18 / 4 / 63.5 | 0.40 / 4 / 18.7 | 0.01 / 0 / 56.9 | 0.40 / 4 / 17.9 | 0.01 / 0 / 57.1 |
| 20 | 0 | steady | 0.00 / 0 / 3.5 | 0.06 / 3 / 0.0 | 0.02 / 1 / 1.4 | 0.17 / 8 / 3.3 | 0.06 / 3 / 0.0 | 0.06 / 3 / 0.0 | 0.04 / 2 / 0.1 | 0.04 / 2 / 0.1 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 3.4 | 0.49 / 24 / 0.0 | 0.02 / 1 / 1.5 | 0.20 / 10 / 3.0 | 0.08 / 4 / 0.0 | 0.11 / 6 / 0.0 | 0.04 / 2 / 0.1 | 0.04 / 2 / 0.1 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 2.3 | 0.15 / 7 / 0.0 | 0.01 / 1 / 0.9 | 0.18 / 9 / 2.1 | 0.15 / 7 / 0.0 | 0.04 / 2 / 0.1 | 0.03 / 1 / 0.1 | 0.03 / 1 / 0.1 |
| 20 | 0 | hiccups 1% | 0.00 / 0 / 5.0 | 0.44 / 21 / 0.0 | 0.03 / 1 / 2.1 | 0.19 / 9 / 4.4 | 0.07 / 4 / 0.6 | 0.15 / 7 / 1.0 | 0.10 / 5 / 0.7 | 0.07 / 3 / 1.1 |
| 20 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 / 23.3 | 0.62 / 31 / 1.7 | 0.11 / 4 / 13.6 | 0.10 / 5 / 21.9 | 0.18 / 8 / 10.0 | 0.09 / 4 / 14.4 | 0.48 / 23 / 3.5 | 0.09 / 4 / 14.4 |
| 20 | 0 | jitter +-8 ms | 0.00 / 0 / 19.0 | 0.33 / 16 / 0.0 | 0.10 / 4 / 7.6 | 0.01 / 0 / 18.8 | 0.11 / 5 / 4.3 | 0.11 / 5 / 6.1 | 0.24 / 12 / 0.4 | 0.11 / 5 / 6.1 |
| 20 | 128 | steady | 0.00 / 0 / 5.2 | 0.06 / 3 / 0.0 | 0.03 / 1 / 1.3 | 0.17 / 8 / 4.8 | 0.06 / 3 / 0.0 | 0.06 / 3 / 0.0 | 0.05 / 2 / 0.1 | 0.05 / 2 / 0.1 |
| 20 | 128 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 4.5 | 0.48 / 24 / 0.0 | 0.02 / 1 / 1.6 | 0.18 / 9 / 4.1 | 0.09 / 4 / 0.0 | 0.10 / 5 / 0.0 | 0.05 / 3 / 0.3 | 0.05 / 3 / 0.3 |
| 20 | 128 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 3.3 | 0.15 / 7 / 0.0 | 0.02 / 1 / 0.8 | 0.17 / 8 / 3.1 | 0.15 / 7 / 0.0 | 0.04 / 2 / 0.1 | 0.03 / 2 / 0.1 | 0.03 / 2 / 0.1 |
| 20 | 128 | hiccups 1% | 0.00 / 0 / 6.6 | 0.43 / 21 / 0.0 | 0.03 / 2 / 2.0 | 0.19 / 9 / 5.9 | 0.07 / 3 / 0.6 | 0.14 / 7 / 1.0 | 0.10 / 5 / 0.7 | 0.07 / 3 / 1.2 |
| 20 | 128 | vsync gaps 17/33/50/67 | 0.00 / 0 / 24.1 | 0.62 / 30 / 1.8 | 0.12 / 4 / 14.0 | 0.08 / 4 / 23.2 | 0.18 / 9 / 9.9 | 0.10 / 5 / 14.4 | 0.47 / 23 / 3.5 | 0.10 / 5 / 14.4 |
| 20 | 128 | jitter +-8 ms | 0.00 / 0 / 19.4 | 0.33 / 16 / 0.0 | 0.10 / 4 / 7.8 | 0.01 / 0 / 19.2 | 0.11 / 5 / 4.6 | 0.11 / 5 / 6.4 | 0.24 / 12 / 0.4 | 0.11 / 5 / 6.4 |
| 20 | 512 | steady | 0.00 / 0 / 18.9 | 0.14 / 6 / 0.0 | 0.09 / 4 / 8.9 | 0.10 / 5 / 18.9 | 0.10 / 5 / 4.9 | 0.14 / 6 / 0.0 | 0.14 / 6 / 0.0 | 0.14 / 6 / 0.0 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 16.7 | 0.52 / 25 / 0.0 | 0.08 / 4 / 6.9 | 0.10 / 5 / 16.6 | 0.10 / 4 / 4.1 | 0.12 / 5 / 0.0 | 0.12 / 5 / 0.0 | 0.12 / 5 / 0.0 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 11.9 | 0.17 / 8 / 0.0 | 0.06 / 3 / 5.6 | 0.10 / 5 / 11.9 | 0.15 / 7 / 3.8 | 0.09 / 4 / 0.1 | 0.09 / 4 / 0.1 | 0.09 / 4 / 0.1 |
| 20 | 512 | hiccups 1% | 0.00 / 0 / 19.8 | 0.47 / 23 / 0.0 | 0.10 / 4 / 9.3 | 0.10 / 5 / 19.7 | 0.11 / 5 / 5.4 | 0.14 / 6 / 1.2 | 0.18 / 8 / 0.4 | 0.14 / 6 / 1.2 |
| 20 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 / 29.1 | 0.59 / 29 / 2.7 | 0.14 / 5 / 18.3 | 0.01 / 1 / 29.0 | 0.20 / 9 / 11.8 | 0.12 / 6 / 16.6 | 0.49 / 23 / 3.8 | 0.12 / 6 / 16.6 |
| 20 | 512 | jitter +-8 ms | 0.00 / 0 / 22.2 | 0.44 / 21 / 0.0 | 0.11 / 5 / 9.3 | 0.06 / 3 / 21.6 | 0.14 / 6 / 4.0 | 0.12 / 6 / 7.1 | 0.28 / 13 / 0.9 | 0.12 / 6 / 7.1 |
| 20 | 1024 | steady | 0.00 / 0 / 25.8 | 0.13 / 6 / 0.0 | 0.13 / 6 / 0.0 | 0.10 / 5 / 25.8 | 0.13 / 5 / 0.8 | 0.06 / 3 / 13.9 | 0.13 / 6 / 0.0 | 0.06 / 3 / 13.9 |
| 20 | 1024 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 24.9 | 0.47 / 22 / 0.0 | 0.12 / 5 / 5.8 | 0.08 / 4 / 24.9 | 0.14 / 6 / 1.7 | 0.07 / 3 / 13.5 | 0.15 / 7 / 0.0 | 0.07 / 3 / 13.5 |
| 20 | 1024 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 16.3 | 0.17 / 8 / 0.0 | 0.08 / 4 / 0.1 | 0.10 / 5 / 16.3 | 0.17 / 8 / 0.5 | 0.04 / 2 / 8.8 | 0.08 / 3 / 0.1 | 0.04 / 2 / 8.8 |
| 20 | 1024 | hiccups 1% | 0.00 / 0 / 26.5 | 0.69 / 33 / 0.2 | 0.13 / 6 / 0.7 | 0.13 / 7 / 26.5 | 0.13 / 5 / 1.4 | 0.06 / 3 / 14.7 | 0.17 / 7 / 0.5 | 0.06 / 3 / 14.7 |
| 20 | 1024 | vsync gaps 17/33/50/67 | 0.00 / 0 / 35.7 | 0.60 / 29 / 2.8 | 0.17 / 6 / 15.3 | 0.06 / 3 / 35.9 | 0.24 / 11 / 10.0 | 0.08 / 3 / 25.2 | 0.46 / 21 / 4.7 | 0.08 / 3 / 25.2 |
| 20 | 1024 | jitter +-8 ms | 0.00 / 0 / 28.4 | 0.63 / 30 / 0.0 | 0.14 / 6 / 2.4 | 0.09 / 5 / 28.4 | 0.13 / 6 / 2.7 | 0.06 / 3 / 16.4 | 0.23 / 10 / 0.9 | 0.06 / 3 / 16.4 |


At the measured point (49 ms frames, L = 32 ms; and 60 Hz, L = 200 ms, a read time exactly on a boundary):

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 |
|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 0.00 / 0 / 49.8 | 0.51 / 8 / 0.0 | 0.25 / 4 / 26.1 | 0.00 / 0 / 49.8 | 0.51 / 8 / 0.0 | 0.51 / 8 / 0.0 | 0.51 / 8 / 0.0 | 0.51 / 8 / 0.0 |
| 60 | 128 | steady | 0.00 / 0 / 29.6 | 0.82 / 14 / 0.0 | 0.15 / 2 / 24.6 | 0.73 / 12 / 8.5 | 0.82 / 14 / 0.0 | 0.82 / 13 / 0.0 | 0.77 / 13 / 1.5 | 0.70 / 11 / 3.9 |
| 20 | 0 | steady | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 0.0 | 0.67 / 33 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 0.0 | 0.37 / 18 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.37 / 18 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 0 | hiccups 1% | 0.00 / 0 / 1.7 | 0.99 / 48 / 0.0 | 0.01 / 0 / 1.7 | 0.00 / 0 / 1.7 | 0.00 / 0 / 1.7 | 0.00 / 0 / 1.7 | 0.12 / 6 / 1.6 | 0.00 / 0 / 1.7 |
| 20 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 / 12.3 | 0.93 / 46 / 0.1 | 0.06 / 1 / 11.6 | 0.00 / 0 / 12.3 | 0.04 / 2 / 11.7 | 0.01 / 0 / 12.2 | 0.67 / 32 / 3.2 | 0.01 / 0 / 12.2 |
| 20 | 0 | jitter +-8 ms | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 512 | steady | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 / 0.0 | 0.67 / 33 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 / 0.0 | 0.37 / 18 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.37 / 18 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |
| 20 | 512 | hiccups 1% | 0.00 / 0 / 0.6 | 1.00 / 49 / 0.0 | 0.00 / 0 / 0.6 | 0.00 / 0 / 0.6 | 0.00 / 0 / 0.6 | 0.00 / 0 / 0.6 | 0.05 / 2 / 0.6 | 0.00 / 0 / 0.6 |
| 20 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 / 9.9 | 0.95 / 47 / 0.0 | 0.05 / 1 / 9.5 | 0.00 / 0 / 9.9 | 0.04 / 2 / 9.4 | 0.01 / 0 / 9.9 | 0.68 / 33 / 2.8 | 0.01 / 0 / 9.9 |
| 20 | 512 | jitter +-8 ms | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 | 0.00 / 0 / 0.0 |


Reading the tables:

- **asym** (today) has 0 holds/skips everywhere but pays for it with a lag that never comes back: 0.99 entry (48 ms)
  at the measured point once any late tick happened, 0.93 with vsync gaps, 0.67 after an L step. This is the
  coordinator's 95 ms (49 ms frame + the 49 ms lock). In pure steady state (no trigger) it is 0 there: the lock needs a
  trigger, so the brief's "today ≈ 1 entry" holds after one late tick (the red tests include it).
- **c0.25** is at 0.00–0.01 entry at the measured point in every scenario, with the holds/skips of the rule itself
  (a 17 ms gap after a 50 ms one means nothing new is heard: those holds are the frame timing's, not the rule's). On
  a boundary (60 Hz, 200 ms) it is asym: 0.51 entry, 0 holds — the price of never early with jitter is unavoidable
  there. Over the sweep: 0.06–0.15 entry, holds/skips 0–2.7 % with a continuous or 128-frame clock.
- **d16** (noise-adaptive) turns back into asym when the noise reaches the margin: 0.67 entry with vsync gaps, 0.12
  after 1 % late ticks at the measured point. Rejected: its lag depends on a noise distribution we cannot measure.
- **e16x0.25** is c with a slightly smaller tolerance in low noise: lag 0.01–0.04 lower, holds a little higher; not
  worth a 16-entry scan.
- **a** catches up after any second frame behind, so a boundary read time alternates: 26 % holds/skips at 60 Hz,
  200 ms (asym and c: 0). **b/B0.1** track the mean but react slowly: B0.1 at the measured point is 0.04 with vsync
  gaps (c 0.01) and 0.51 on the boundary (as c), with more state (an EMA and a reset).
- **Coarse clocks at 60 Hz (512, 1024 frames = 10.7, 21.3 ms ≥ 0.64 frame):** the stamps themselves repeat or jump a
  frame, the rule holds/skips 40–44 %; c keeps 27 % (512) and 43 % (1024) of them where asym keeps 0 % at 0.56–0.68
  entry of lag. Those holds are the clock's, not the rule's; by the advisor's note this row does not pick the rule.
  At 49 ms frames the same clocks give c 0 % (512) and 14 % (1024) over the sweep, 0 % at the measured point.

**Chosen: c0.25** — one condition on the existing line, no state, O(1), nothing allocated: never early, lag ≈ 0 off
the boundary, one entry behind (as today) only on it.

### Step 1: the read rule (3f1429ec4, core)

- **Red** (the two new tests on the old rule): `49 ms frames, latency 32 ms, one late tick` mean lag 1 (expected ≤ 0.1);
  `a late tick every 50 frames` 0.98. Then a third test, `a latency that drops from 32 ms to 0 presents the newest
  entry`, is red on the old rule (locked one behind at L = 0) and on c without the newest-entry exemption (mutant run:
  1 failed), green with it.
- **Green:** 20 presented-frame tests. Every existing expectation unchanged, including the exact 0 holds / 0 skips of
  the ±1.5 ms jitter and 5.3 ms quanta tests and `never goes back` (exact 16 ms stamps: the read time on the stamp,
  margin 0 < 4 ms → 15, as before). No bound relaxed.
- **The tolerance bites:** `StepTolerance = 0` (mutant) fails 4 tests (never goes back, 60 Hz jitter, quanta, ±40 ms
  steps).
- `audio-pipeline.spec.ts` (not edited): the latency-0 identity and the k-frame shift / lag tests pass (`-t
  "latency|shift|lag"`: 9 passed); the whole file passes in the full run.
- Checks: `npm run lint` 0 errors (2 warnings, unused eslint-disable in `app.tsx:534,540`, not this lane's);
  `npx tsc --noEmit -p tsconfig.json` clean; `npx jest src/apps/virus-on-the-rock src/mol-plugin-state
  src/mol-repr/structure src/mol-canvas3d`: 21 suites, 178 tests passed.

### Step 2: spec pages (app commit)

`_spec/architecture.md` §2 (the read rule) and `_spec/core-changes.md` (`audio-presented-frame.ts` row).

## Decided (by me, within the brief)

- **c0.25 over (a) and (b)**: the table above. 0.25 because the measured point sits at 0.35 of a frame (17 ms past the
  stamp at 49 ms frames, L = 32 ms): 0.35 would hold it one behind; 0.25 leaves 5 ms and still covers ±1.5 ms jitter
  at 60 Hz (4 ms tolerance).
- **The newest entry is never held back**: without it a latency that drops below one frame (to 0 when the context
  stops) locks the picture one behind at L = 0, where the rule cannot flip (the read time is the newest stamp).
- **The doc on `present`** no longer says "a latency that shrinks by less than two frames can leave the picture one
  entry behind": that holds now only on a boundary (within a quarter interval), where one behind is the point.

## Size

8 production lines (the condition, the constant), 15 doc lines; 3 tests, ~40 test lines. Brief: ~10 / ~60.

## Open

- Ludo's Chrome check (clicksync heard column, and the presented − live lag): expected ≈ 49 ms (one frame at 49 ms
  frames, L = 32 ms) instead of ≈ 95 ms. Not run by this lane (no browser here).
- Coarse clocks (≥ 512 frames) at 60 Hz keep most of the rule's own holds/skips (see the table): accepted, the stamps
  carry no finer time; a de-quantized clock (smoothing currentTime against performance.now) would be its own lane.

## The simulation (`node sim.mjs <variants> [scenario prefix | all]`, `node pivot.mjs out.md`)

```js
// heard-phase: read-rule candidates vs the rule alone. Extends sk/fix.mjs.
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const makeVariant = (name) => {
  let last = -1, behind = false, phi = 0.5, o = 0, init = false;
  return (stamps, n, read) => {
    let seq = n - 1;
    while (seq > 0 && stamps[seq] > read + 1e-9) seq--;
    const next = last + 1;
    let pick;
    if (last < 0) pick = seq;
    else if (name === 'rule') pick = seq;
    else if (name === 'asym') pick = (seq === next || seq === next + 1) ? next : seq;
    else if (name === 'a') {
      if (seq === next + 1 && !behind) { pick = next; behind = true; } else { pick = seq; behind = false; }
      if (pick === next && seq === next) behind = false;
    } else if (name.startsWith('c')) {
      const alpha = +name.slice(1);
      pick = seq;
      if (seq === next + 1 && seq < n - 1 && read - stamps[seq] < alpha * (stamps[seq] - stamps[next])) pick = next;
    } else if (name.startsWith('d')) {
      // tolerance = the spread of the last K stamp gaps (timing noise read from the ring), times beta
      const [K, beta] = name.slice(1).split('x').map(Number);
      let lo = Infinity, hi = -Infinity;
      for (let j = n - 1; j > n - 1 - K && j > 0; j--) { const g = stamps[j] - stamps[j - 1]; if (g < lo) lo = g; if (g > hi) hi = g; }
      const h = hi > lo ? (hi - lo) * (beta || 1) : 0;
      pick = seq;
      if (seq === next + 1 && seq < n - 1 && read - stamps[seq] < h) pick = next;
    } else if (name.startsWith('e')) {
      const [K, alpha] = name.slice(1).split('x').map(Number);
      let lo = Infinity, hi = -Infinity;
      for (let j = n - 1; j > n - 1 - K && j > 0; j--) { const g = stamps[j] - stamps[j - 1]; if (g < lo) lo = g; if (g > hi) hi = g; }
      pick = seq;
      if (seq === next + 1 && seq < n - 1) {
        const h = Math.min(hi - lo, alpha * (stamps[seq] - stamps[next]));
        if (read - stamps[seq] < h - 1e-9) pick = next;
      }
    } else if (name.startsWith('B')) {
      // unwrapped offset of the read time from the cursor's next entry, in gaps; EMA; catch up when persistently behind
      const band = +name.slice(1) || 0.1;
      pick = seq;
      if (seq === next || seq === next + 1) {
        const g = next + 1 < n ? stamps[next + 1] - stamps[next] : 0;
        const u = g > 0 ? (read - stamps[next]) / g : 0;
        phi = init ? phi + 0.1 * (u - phi) : u; init = true;
        pick = seq === next + 1 && phi > 1 + band ? seq : next;
        if (pick === seq && seq === next + 1) phi -= 1; // caught up: the offset is now from the new next
      } else { init = false; }
    } else if (name === 'b') {
      // phase EMA of the read time within the rule's interval; offset one entry (mid-previous interval) near a boundary
      if (seq + 1 < n && stamps[seq + 1] > stamps[seq] && stamps[seq] <= read) {
        const f = (read - stamps[seq]) / (stamps[seq + 1] - stamps[seq]);
        if (!init) { phi = f; init = true; } else phi += 0.05 * (f - phi);
      }
      if (o === 0 && phi < 0.2) o = 1; else if (o === 1 && phi > 0.3) o = 0;
      pick = seq;
      if (o === 1) { // the newest entry at or before read - (phi + 0.5) gaps
        const gap = seq > 0 ? stamps[seq] - stamps[seq - 1] : 0;
        const r2 = read - (phi + 0.5) * gap;
        while (pick > 0 && stamps[pick] > r2 + 1e-9) pick--;
      }
    }
    if (pick < last) pick = last;
    last = pick;
    return { pick, seq };
  };
};
const vsync = [[0.05, 1], [0.1, 2], [0.7, 3], [0.15, 4]]; // vsync multiples at 60 Hz: mean 49.2 ms
function run({ fps, qFrames, sr = 48000, ppm, jitMs, hiccup = 0, Lfn, variant, n, gaps = null }) {
  let wallAcc = 0;
  const stamps = new Float64Array(n); const step = makeVariant(variant);
  let prev = -1, holds = 0, skips = 0, early = 0, cnt = 0, sumLag = 0, maxLag = 0, sumMs = 0, maxMs = 0;
  const q = qFrames / sr, F = 1 / fps;
  for (let i = 0; i < n; i++) {
    const late = hiccup > 0 && rnd() < hiccup ? 0.4 * F : 0;
    let wall;
    if (gaps === 'vsync') { if (i > 0) { const r = rnd(); let c = 0, m = 3; for (const [p, k] of vsync) { c += p; if (r < c) { m = k; break; } } wallAcc += m / 60; } wall = wallAcc + (rnd() * 2 - 1) * jitMs / 1000; }
    else wall = i * F + (rnd() * 2 - 1) * jitMs / 1000 + late;
    const audio = wall * (1 + ppm * 1e-6) + 0.00123;
    const now = q > 0 ? Math.floor(audio / q) * q : audio;
    stamps[i] = i > 0 && now < stamps[i - 1] ? stamps[i - 1] : now;
    const read = stamps[i] - Lfn(i);
    const { pick, seq } = step(stamps, i + 1, read);
    if (i > 600) {
      const s = pick - prev; if (s === 0) holds++; else if (s >= 2) skips++; cnt++;
      if (pick !== prev && stamps[pick] > read + 1e-9) early++;
      const lag = seq - pick, ms = (stamps[seq] - stamps[pick]) * 1000;
      sumLag += lag; maxLag = Math.max(maxLag, lag); sumMs += ms; maxMs = Math.max(maxMs, ms);
    }
    prev = pick;
  }
  return { holds: holds / cnt, skips: skips / cnt, early, lag: sumLag / cnt, maxLag, ms: sumMs / cnt, maxMs };
}
const variants = (process.argv[2] ?? 'rule,asym,a,b,c0.15,c0.25,c0.35').split(',');
const only = process.argv[3];
const scen = [
  ['steady', () => 0, 0],
  ['L steps 0,+40,0,-20,0 ms', (i, n) => [0, 0.04, 0, -0.02, 0][Math.floor(5 * i / n)], 0],
  ['L 32 ms -> 0 -> 32 ms', (i, n, L) => [0, -L, 0][Math.floor(3 * i / n)], 0],
  ['hiccups 1%', () => 0, 0.01],
  ['vsync gaps 17/33/50/67', () => 0, 0, 'vsync'],
  ['jitter +-8 ms', () => 0, 0, null, 8],
];
console.log('| fps | clock (frames) | scenario | variant | mean lag (entries) | max lag | mean lag ms | max ms | holds % | skips % | early |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const fps of [60, 1000 / 49]) for (const q of [0, 128, 512, 1024]) for (const [sn, dL, hic, gaps = null, jit = 1.5] of scen) for (const v of variants) {
  if (only && only !== 'all' && !sn.startsWith(only)) continue;
  const K = 30, n = fps > 30 ? 12000 : 6000, F = 1 / fps, base = fps > 30 ? 0.1 : 0.032;
  let a = { holds: 0, skips: 0, early: 0, lag: 0, maxLag: 0, ms: 0, maxMs: 0 };
  for (let k = 0; k < K; k++) {
    const L = base + k * F / K;
    seed = 11 + k;
    const r = run({ fps, qFrames: q, ppm: 200, jitMs: jit, hiccup: hic, gaps, variant: v, n, Lfn: i => L + dL(i, n, L) });
    a.holds += r.holds / K; a.skips += r.skips / K; a.early += r.early; a.lag += r.lag / K; a.ms += r.ms / K;
    a.maxLag = Math.max(a.maxLag, r.maxLag); a.maxMs = Math.max(a.maxMs, r.maxMs);
  }
  console.log(`| ${fps.toFixed(0)} | ${q} | ${sn} | ${v} | ${a.lag.toFixed(3)} | ${a.maxLag} | ${a.ms.toFixed(1)} | ${a.maxMs.toFixed(1)} | ${(100 * a.holds).toFixed(2)} | ${(100 * a.skips).toFixed(2)} | ${a.early} |`);
}
```

```js
import { readFileSync } from 'fs';
const [file, ...want] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').split('\n').filter(l => /^\| \d/.test(l)).map(l => l.split('|').slice(1, -1).map(x => x.trim()));
const vs = [...new Set(rows.map(r => r[3]))];
const keys = [...new Set(rows.map(r => r.slice(0, 3).join(' | ')))].filter(k => !want.length || want.some(w => k.includes(w)));
let early = 0;
console.log('| fps | clock | scenario | ' + vs.join(' | ') + ' |'); console.log('|---|---|---|' + vs.map(() => '---').join('|') + '|');
for (const k of keys) {
  const cells = vs.map(v => { const r = rows.find(r => r.slice(0, 3).join(' | ') === k && r[3] === v); early += +r[10]; return `${(+r[4]).toFixed(2)} / ${(+r[6]).toFixed(0)} / ${(+r[8] + +r[9]).toFixed(1)}`; });
  console.log(`| ${k} | ${cells.join(' | ')} |`);
}
console.log(`\nearly, all rows, all variants: ${early}`);
```
