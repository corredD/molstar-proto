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
gaps drawn from vsync multiples {17, 33, 50, 67} ms (mean 49; the advisor's acceptance row); ±8 ms jitter. Lag is
rule − presented, the rule being the newest entry stamped at or before the read time.

Variants: **rule** (no hysteresis); **asym** (the old rule: `seq ∈ {next, next+1}` → next); **a** (absorb one +1,
catch up when the rule says ≥ next+1 two frames running); **b** (EMA of the read time's phase in the rule's interval;
one entry back while the phase is < 0.2, back at > 0.3; a linear EMA of a wrapping phase, so it flaps near the
boundary, as the advisor noted); **B0.1** (a fair (b): EMA of the unwrapped offset of the read time from the cursor's
next entry, in intervals; one per frame, catch up when the EMA is > 1.1, re-sync on jumps); **c0.25** (ours: the
hysteresis only when the read time is past the newer entry's stamp by < 0.25 of its interval; the newest entry never
held); **d16** (c with the tolerance = the spread of the last 16 stamp gaps, the timing noise read from the ring);
**e16x0.25** (min of c and d); **f6** (c with the tolerance capped at 6 ms: min(0.25 interval, 6 ms)).

**Mean lag**, entries / ms, averaged over an L sweep across one frame (30 values from 100 ms at 60 Hz, from 32 ms at
49 ms frames):

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 | f6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 0.00 / 0 | 0.18 / 3 | 0.04 / 1 | 0.14 / 2 | 0.10 / 2 | 0.12 / 2 | 0.13 / 2 | 0.11 / 2 | 0.12 / 2 |
| 60 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.27 / 4 | 0.04 / 1 | 0.14 / 2 | 0.10 / 2 | 0.12 / 2 | 0.12 / 2 | 0.11 / 2 | 0.12 / 2 |
| 60 | 0 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 | 0.11 / 2 | 0.03 / 0 | 0.13 / 2 | 0.06 / 1 | 0.07 / 1 | 0.08 / 1 | 0.07 / 1 | 0.07 / 1 |
| 60 | 0 | hiccups 1% | 0.00 / 0 | 0.50 / 8 | 0.05 / 1 | 0.13 / 2 | 0.11 / 2 | 0.11 / 2 | 0.16 / 3 | 0.11 / 2 | 0.11 / 2 |
| 60 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.30 / 14 | 0.13 / 5 | 0.00 / 0 | 0.25 / 12 | 0.14 / 7 | 0.28 / 13 | 0.14 / 7 | 0.07 / 4 |
| 60 | 0 | jitter +-8 ms | 0.00 / 0 | 0.46 / 7 | 0.21 / 2 | 0.00 / 0 | 0.22 / 3 | 0.09 / 1 | 0.45 / 7 | 0.09 / 1 | 0.09 / 1 |
| 60 | 128 | steady | 0.00 / 0 | 0.29 / 5 | 0.05 / 1 | 0.10 / 2 | 0.12 / 2 | 0.10 / 2 | 0.13 / 2 | 0.10 / 2 | 0.10 / 2 |
| 60 | 128 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.30 / 5 | 0.05 / 1 | 0.12 / 2 | 0.11 / 2 | 0.10 / 2 | 0.14 / 2 | 0.10 / 2 | 0.10 / 2 |
| 60 | 128 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 | 0.18 / 3 | 0.03 / 1 | 0.10 / 2 | 0.07 / 1 | 0.07 / 1 | 0.08 / 1 | 0.07 / 1 | 0.07 / 1 |
| 60 | 128 | hiccups 1% | 0.00 / 0 | 0.52 / 9 | 0.06 / 1 | 0.10 / 2 | 0.12 / 2 | 0.11 / 2 | 0.17 / 3 | 0.10 / 2 | 0.10 / 2 |
| 60 | 128 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.31 / 15 | 0.13 / 5 | 0.00 / 0 | 0.25 / 12 | 0.14 / 7 | 0.29 / 14 | 0.14 / 7 | 0.08 / 4 |
| 60 | 128 | jitter +-8 ms | 0.00 / 0 | 0.46 / 7 | 0.21 / 2 | 0.00 / 0 | 0.23 / 3 | 0.09 / 1 | 0.45 / 6 | 0.09 / 1 | 0.09 / 1 |
| 60 | 512 | steady | 0.00 / 0 | 0.68 / 10 | 0.20 / 2 | 0.13 / 2 | 0.16 / 2 | 0.14 / 2 | 0.59 / 9 | 0.14 / 2 | 0.14 / 2 |
| 60 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.58 / 9 | 0.14 / 2 | 0.14 / 2 | 0.11 / 1 | 0.11 / 2 | 0.42 / 6 | 0.11 / 2 | 0.11 / 2 |
| 60 | 512 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 | 0.44 / 7 | 0.13 / 1 | 0.13 / 2 | 0.10 / 1 | 0.09 / 1 | 0.38 / 6 | 0.09 / 1 | 0.09 / 1 |
| 60 | 512 | hiccups 1% | 0.00 / 0 | 0.68 / 10 | 0.20 / 2 | 0.10 / 2 | 0.17 / 2 | 0.14 / 2 | 0.58 / 9 | 0.14 / 2 | 0.14 / 2 |
| 60 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.35 / 16 | 0.16 / 6 | 0.00 / 0 | 0.30 / 14 | 0.17 / 8 | 0.34 / 16 | 0.17 / 8 | 0.11 / 5 |
| 60 | 512 | jitter +-8 ms | 0.00 / 0 | 0.50 / 7 | 0.22 / 2 | 0.05 / 1 | 0.36 / 5 | 0.08 / 1 | 0.47 / 6 | 0.08 / 1 | 0.08 / 1 |
| 60 | 1024 | steady | 0.00 / 0 | 0.56 / 7 | 0.22 / 0 | 0.21 / 4 | 0.56 / 7 | 0.00 / 0 | 0.56 / 7 | 0.00 / 0 | 0.00 / 0 |
| 60 | 1024 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.53 / 7 | 0.22 / 0 | 0.22 / 5 | 0.53 / 7 | 0.00 / 0 | 0.53 / 7 | 0.00 / 0 | 0.00 / 0 |
| 60 | 1024 | L 32 ms -> 0 -> 32 ms | -0.00 / 0 | 0.36 / 5 | 0.14 / 0 | 0.21 / 4 | 0.36 / 5 | 0.00 / 0 | 0.36 / 5 | -0.00 / 0 | -0.00 / 0 |
| 60 | 1024 | hiccups 1% | 0.00 / 0 | 0.56 / 7 | 0.22 / 0 | 0.21 / 4 | 0.56 / 7 | 0.00 / 0 | 0.56 / 7 | 0.00 / 0 | 0.00 / 0 |
| 60 | 1024 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.43 / 19 | 0.16 / 6 | 0.04 / 2 | 0.32 / 14 | 0.14 / 6 | 0.39 / 17 | 0.14 / 6 | 0.12 / 5 |
| 60 | 1024 | jitter +-8 ms | 0.00 / 0 | 0.40 / 4 | 0.24 / 0 | 0.18 / 4 | 0.40 / 4 | 0.01 / 0 | 0.40 / 4 | 0.01 / 0 | 0.01 / 0 |
| 20 | 0 | steady | 0.00 / 0 | 0.06 / 3 | 0.02 / 1 | 0.17 / 8 | 0.06 / 3 | 0.06 / 3 | 0.04 / 2 | 0.04 / 2 | 0.06 / 3 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.49 / 24 | 0.02 / 1 | 0.20 / 10 | 0.08 / 4 | 0.11 / 6 | 0.04 / 2 | 0.04 / 2 | 0.06 / 3 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.15 / 7 | 0.01 / 1 | 0.18 / 9 | 0.15 / 7 | 0.04 / 2 | 0.03 / 1 | 0.03 / 1 | 0.04 / 2 |
| 20 | 0 | hiccups 1% | 0.00 / 0 | 0.44 / 21 | 0.03 / 1 | 0.19 / 9 | 0.07 / 4 | 0.15 / 7 | 0.10 / 5 | 0.07 / 3 | 0.07 / 3 |
| 20 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.62 / 31 | 0.11 / 4 | 0.10 / 5 | 0.18 / 8 | 0.09 / 4 | 0.48 / 23 | 0.09 / 4 | 0.06 / 3 |
| 20 | 0 | jitter +-8 ms | 0.00 / 0 | 0.33 / 16 | 0.10 / 4 | 0.01 / 0 | 0.11 / 5 | 0.11 / 5 | 0.24 / 12 | 0.11 / 5 | 0.06 / 3 |
| 20 | 128 | steady | 0.00 / 0 | 0.06 / 3 | 0.03 / 1 | 0.17 / 8 | 0.06 / 3 | 0.06 / 3 | 0.05 / 2 | 0.05 / 2 | 0.06 / 3 |
| 20 | 128 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.48 / 24 | 0.02 / 1 | 0.18 / 9 | 0.09 / 4 | 0.10 / 5 | 0.05 / 3 | 0.05 / 3 | 0.06 / 3 |
| 20 | 128 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.15 / 7 | 0.02 / 1 | 0.17 / 8 | 0.15 / 7 | 0.04 / 2 | 0.03 / 2 | 0.03 / 2 | 0.04 / 2 |
| 20 | 128 | hiccups 1% | 0.00 / 0 | 0.43 / 21 | 0.03 / 2 | 0.19 / 9 | 0.07 / 3 | 0.14 / 7 | 0.10 / 5 | 0.07 / 3 | 0.07 / 4 |
| 20 | 128 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.62 / 30 | 0.12 / 4 | 0.08 / 4 | 0.18 / 9 | 0.10 / 5 | 0.47 / 23 | 0.10 / 5 | 0.06 / 3 |
| 20 | 128 | jitter +-8 ms | 0.00 / 0 | 0.33 / 16 | 0.10 / 4 | 0.01 / 0 | 0.11 / 5 | 0.11 / 5 | 0.24 / 12 | 0.11 / 5 | 0.06 / 3 |
| 20 | 512 | steady | 0.00 / 0 | 0.14 / 6 | 0.09 / 4 | 0.10 / 5 | 0.10 / 5 | 0.14 / 6 | 0.14 / 6 | 0.14 / 6 | 0.08 / 4 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.52 / 25 | 0.08 / 4 | 0.10 / 5 | 0.10 / 4 | 0.12 / 5 | 0.12 / 5 | 0.12 / 5 | 0.07 / 3 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.17 / 8 | 0.06 / 3 | 0.10 / 5 | 0.15 / 7 | 0.09 / 4 | 0.09 / 4 | 0.09 / 4 | 0.05 / 2 |
| 20 | 512 | hiccups 1% | 0.00 / 0 | 0.47 / 23 | 0.10 / 4 | 0.10 / 5 | 0.11 / 5 | 0.14 / 6 | 0.18 / 8 | 0.14 / 6 | 0.08 / 4 |
| 20 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.59 / 29 | 0.14 / 5 | 0.01 / 1 | 0.20 / 9 | 0.12 / 6 | 0.49 / 23 | 0.12 / 6 | 0.07 / 3 |
| 20 | 512 | jitter +-8 ms | 0.00 / 0 | 0.44 / 21 | 0.11 / 5 | 0.06 / 3 | 0.14 / 6 | 0.12 / 6 | 0.28 / 13 | 0.12 / 6 | 0.07 / 3 |
| 20 | 1024 | steady | 0.00 / 0 | 0.13 / 6 | 0.13 / 6 | 0.10 / 5 | 0.13 / 5 | 0.06 / 3 | 0.13 / 6 | 0.06 / 3 | 0.04 / 2 |
| 20 | 1024 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.47 / 22 | 0.12 / 5 | 0.08 / 4 | 0.14 / 6 | 0.07 / 3 | 0.15 / 7 | 0.07 / 3 | 0.04 / 2 |
| 20 | 1024 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.17 / 8 | 0.08 / 4 | 0.10 / 5 | 0.17 / 8 | 0.04 / 2 | 0.08 / 3 | 0.04 / 2 | 0.03 / 1 |
| 20 | 1024 | hiccups 1% | 0.00 / 0 | 0.69 / 33 | 0.13 / 6 | 0.13 / 7 | 0.13 / 5 | 0.06 / 3 | 0.17 / 7 | 0.06 / 3 | 0.04 / 2 |
| 20 | 1024 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.60 / 29 | 0.17 / 6 | 0.06 / 3 | 0.24 / 11 | 0.08 / 3 | 0.46 / 21 | 0.08 / 3 | 0.05 / 2 |
| 20 | 1024 | jitter +-8 ms | 0.00 / 0 | 0.63 / 30 | 0.14 / 6 | 0.09 / 5 | 0.13 / 6 | 0.06 / 3 | 0.23 / 10 | 0.06 / 3 | 0.04 / 2 |

max lag (entries / ms) over these rows: rule 0 / 0, asym 1 / 85, a 1 / 68, b 1 / 85, B0.1 1 / 85, c0.25 1 / 75, d16 1 / 85, e16x0.25 1 / 75, f6 1 / 75; early, every row and variant: 0

**Holds % / skips %**, same runs:

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 | f6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 4.2 / 4.2 | 0.0 / 0.0 | 2.1 / 2.1 | 3.7 / 3.7 | 0.3 / 0.3 | 0.2 / 0.2 | 0.2 / 0.2 | 0.3 / 0.3 | 0.2 / 0.2 |
| 60 | 0 | L steps 0,+40,0,-20,0 ms | 4.2 / 4.2 | 0.0 / 0.0 | 2.1 / 2.1 | 3.7 / 3.7 | 0.4 / 0.3 | 0.3 / 0.2 | 0.2 / 0.2 | 0.3 / 0.3 | 0.3 / 0.2 |
| 60 | 0 | L 32 ms -> 0 -> 32 ms | 2.8 / 2.7 | 0.1 / 0.0 | 1.4 / 1.4 | 2.4 / 2.4 | 0.3 / 0.2 | 0.2 / 0.2 | 0.2 / 0.1 | 0.3 / 0.2 | 0.2 / 0.2 |
| 60 | 0 | hiccups 1% | 4.8 / 4.8 | 0.0 / 0.0 | 2.4 / 2.4 | 4.2 / 4.2 | 0.7 / 0.7 | 0.8 / 0.8 | 0.4 / 0.4 | 0.8 / 0.8 | 0.8 / 0.8 |
| 60 | 0 | vsync gaps 17/33/50/67 | 13.8 / 13.6 | 3.4 / 1.7 | 10.6 / 9.9 | 13.8 / 13.6 | 3.0 / 2.5 | 7.6 / 7.3 | 3.3 / 1.9 | 7.6 / 7.3 | 10.3 / 10.0 |
| 60 | 0 | jitter +-8 ms | 22.4 / 21.8 | 5.1 / 2.5 | 12.2 / 11.1 | 22.4 / 21.8 | 10.5 / 9.7 | 17.5 / 16.8 | 5.1 / 2.6 | 17.5 / 16.8 | 17.5 / 16.8 |
| 60 | 128 | steady | 5.4 / 5.4 | 0.0 / 0.0 | 2.9 / 2.9 | 5.3 / 5.3 | 0.5 / 0.5 | 0.8 / 0.8 | 0.2 / 0.2 | 0.9 / 0.9 | 0.9 / 0.9 |
| 60 | 128 | L steps 0,+40,0,-20,0 ms | 5.2 / 5.2 | 0.0 / 0.0 | 2.7 / 2.7 | 4.8 / 4.8 | 0.7 / 0.7 | 0.9 / 0.8 | 0.3 / 0.3 | 0.9 / 0.9 | 0.9 / 0.8 |
| 60 | 128 | L 32 ms -> 0 -> 32 ms | 3.5 / 3.5 | 0.1 / 0.0 | 1.9 / 1.9 | 3.5 / 3.4 | 0.4 / 0.3 | 0.6 / 0.6 | 0.2 / 0.2 | 0.7 / 0.6 | 0.6 / 0.6 |
| 60 | 128 | hiccups 1% | 6.0 / 6.0 | 0.0 / 0.0 | 3.2 / 3.2 | 5.8 / 5.8 | 0.8 / 0.8 | 1.4 / 1.4 | 0.5 / 0.5 | 1.4 / 1.4 | 1.4 / 1.4 |
| 60 | 128 | vsync gaps 17/33/50/67 | 13.9 / 13.7 | 3.5 / 1.7 | 10.7 / 10.0 | 13.9 / 13.7 | 3.1 / 2.5 | 7.7 / 7.3 | 3.4 / 2.0 | 7.7 / 7.3 | 10.4 / 10.1 |
| 60 | 128 | jitter +-8 ms | 22.6 / 21.9 | 5.0 / 2.5 | 12.3 / 11.2 | 22.6 / 21.9 | 10.5 / 9.6 | 17.7 / 16.9 | 5.1 / 2.6 | 17.8 / 17.0 | 17.8 / 17.0 |
| 60 | 512 | steady | 19.9 / 19.9 | 0.0 / 0.0 | 4.9 / 4.9 | 20.0 / 20.0 | 5.2 / 5.2 | 13.5 / 13.5 | 1.2 / 1.2 | 13.5 / 13.5 | 13.5 / 13.5 |
| 60 | 512 | L steps 0,+40,0,-20,0 ms | 14.2 / 14.2 | 0.0 / 0.0 | 4.0 / 3.9 | 14.8 / 14.8 | 4.6 / 4.5 | 9.8 / 9.8 | 1.0 / 1.0 | 9.8 / 9.8 | 9.8 / 9.8 |
| 60 | 512 | L 32 ms -> 0 -> 32 ms | 13.0 / 12.9 | 0.1 / 0.0 | 3.3 / 3.2 | 13.0 / 13.0 | 3.4 / 3.4 | 8.8 / 8.7 | 0.9 / 0.8 | 8.8 / 8.7 | 8.8 / 8.7 |
| 60 | 512 | hiccups 1% | 20.0 / 20.0 | 0.1 / 0.0 | 5.3 / 5.3 | 20.1 / 20.1 | 5.3 / 5.3 | 13.7 / 13.6 | 1.4 / 1.4 | 13.7 / 13.6 | 13.7 / 13.6 |
| 60 | 512 | vsync gaps 17/33/50/67 | 17.4 / 17.1 | 3.6 / 1.8 | 11.5 / 10.6 | 17.4 / 17.1 | 3.4 / 2.8 | 8.3 / 7.8 | 3.5 / 1.9 | 8.3 / 7.8 | 11.3 / 10.8 |
| 60 | 512 | jitter +-8 ms | 25.2 / 24.1 | 6.0 / 3.0 | 14.9 / 13.2 | 25.5 / 24.1 | 9.8 / 7.5 | 21.3 / 20.0 | 6.5 / 3.6 | 21.3 / 20.0 | 21.3 / 20.0 |
| 60 | 1024 | steady | 21.9 / 21.9 | 0.1 / 0.0 | 21.2 / 21.2 | 27.7 / 21.9 | 0.2 / 0.2 | 21.8 / 21.8 | 0.1 / 0.0 | 21.9 / 21.9 | 21.9 / 21.9 |
| 60 | 1024 | L steps 0,+40,0,-20,0 ms | 21.9 / 21.9 | 2.2 / 1.1 | 18.3 / 18.2 | 28.6 / 21.9 | 2.7 / 1.7 | 21.8 / 21.8 | 2.2 / 1.1 | 21.9 / 21.9 | 21.9 / 21.9 |
| 60 | 1024 | L 32 ms -> 0 -> 32 ms | 14.2 / 14.2 | 0.1 / 0.0 | 13.8 / 13.8 | 20.1 / 16.2 | 0.2 / 0.1 | 14.2 / 14.1 | 0.1 / 0.0 | 14.2 / 14.2 | 14.2 / 14.2 |
| 60 | 1024 | hiccups 1% | 22.0 / 22.0 | 0.4 / 0.2 | 21.1 / 21.0 | 27.9 / 22.0 | 0.5 / 0.3 | 21.9 / 21.9 | 0.4 / 0.2 | 22.0 / 22.0 | 22.0 / 22.0 |
| 60 | 1024 | vsync gaps 17/33/50/67 | 17.8 / 17.5 | 4.8 / 2.4 | 12.7 / 11.5 | 17.5 / 17.1 | 5.2 / 4.2 | 12.7 / 12.2 | 5.1 / 3.1 | 12.7 / 12.2 | 13.3 / 12.9 |
| 60 | 1024 | jitter +-8 ms | 30.4 / 27.7 | 12.0 / 5.9 | 19.8 / 16.0 | 35.9 / 27.6 | 12.4 / 6.3 | 29.8 / 27.1 | 12.0 / 5.9 | 29.9 / 27.2 | 29.9 / 27.2 |
| 20 | 0 | steady | 1.8 / 1.8 | 0.0 / 0.0 | 0.7 / 0.7 | 1.6 / 1.6 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.0 / 0.0 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 1.7 / 1.7 | 0.0 / 0.0 | 0.8 / 0.8 | 1.5 / 1.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.0 / 0.0 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 1.1 / 1.1 | 0.0 / 0.0 | 0.5 / 0.5 | 1.1 / 1.1 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.0 / 0.0 |
| 20 | 0 | hiccups 1% | 2.5 / 2.5 | 0.0 / 0.0 | 1.1 / 1.1 | 2.2 / 2.2 | 0.3 / 0.3 | 0.5 / 0.5 | 0.3 / 0.3 | 0.6 / 0.6 | 0.6 / 0.6 |
| 20 | 0 | vsync gaps 17/33/50/67 | 11.7 / 11.5 | 1.1 / 0.6 | 6.9 / 6.7 | 11.1 / 10.8 | 5.1 / 4.9 | 7.3 / 7.1 | 2.0 / 1.5 | 7.3 / 7.1 | 9.0 / 8.8 |
| 20 | 0 | jitter +-8 ms | 9.5 / 9.5 | 0.0 / 0.0 | 3.8 / 3.8 | 9.4 / 9.4 | 2.1 / 2.1 | 3.0 / 3.0 | 0.2 / 0.2 | 3.0 / 3.0 | 5.6 / 5.6 |
| 20 | 128 | steady | 2.6 / 2.6 | 0.0 / 0.0 | 0.6 / 0.6 | 2.4 / 2.4 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.0 / 0.0 |
| 20 | 128 | L steps 0,+40,0,-20,0 ms | 2.3 / 2.3 | 0.0 / 0.0 | 0.8 / 0.8 | 2.1 / 2.1 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.1 / 0.1 |
| 20 | 128 | L 32 ms -> 0 -> 32 ms | 1.7 / 1.7 | 0.0 / 0.0 | 0.4 / 0.4 | 1.6 / 1.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.1 / 0.1 | 0.1 / 0.1 | 0.1 / 0.1 |
| 20 | 128 | hiccups 1% | 3.3 / 3.3 | 0.0 / 0.0 | 1.0 / 1.0 | 2.9 / 2.9 | 0.3 / 0.3 | 0.5 / 0.5 | 0.3 / 0.3 | 0.6 / 0.6 | 0.7 / 0.7 |
| 20 | 128 | vsync gaps 17/33/50/67 | 12.1 / 11.9 | 1.2 / 0.6 | 7.1 / 6.9 | 11.7 / 11.5 | 5.0 / 4.8 | 7.3 / 7.1 | 2.0 / 1.5 | 7.3 / 7.1 | 9.0 / 8.8 |
| 20 | 128 | jitter +-8 ms | 9.7 / 9.7 | 0.0 / 0.0 | 3.9 / 3.9 | 9.6 / 9.6 | 2.3 / 2.3 | 3.2 / 3.2 | 0.2 / 0.2 | 3.2 / 3.2 | 5.8 / 5.8 |
| 20 | 512 | steady | 9.4 / 9.4 | 0.0 / 0.0 | 4.4 / 4.4 | 9.4 / 9.4 | 2.5 / 2.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 4.0 / 4.0 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 8.3 / 8.3 | 0.0 / 0.0 | 3.5 / 3.5 | 8.3 / 8.3 | 2.0 / 2.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 3.6 / 3.6 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 6.0 / 6.0 | 0.0 / 0.0 | 2.8 / 2.8 | 6.0 / 6.0 | 1.9 / 1.9 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 2.6 / 2.6 |
| 20 | 512 | hiccups 1% | 9.9 / 9.9 | 0.0 / 0.0 | 4.7 / 4.7 | 9.9 / 9.9 | 2.7 / 2.7 | 0.6 / 0.6 | 0.2 / 0.2 | 0.6 / 0.6 | 4.6 / 4.6 |
| 20 | 512 | vsync gaps 17/33/50/67 | 14.7 / 14.4 | 1.8 / 0.9 | 9.3 / 9.0 | 14.7 / 14.4 | 6.1 / 5.8 | 8.4 / 8.2 | 2.2 / 1.6 | 8.4 / 8.2 | 10.9 / 10.6 |
| 20 | 512 | jitter +-8 ms | 11.1 / 11.1 | 0.0 / 0.0 | 4.7 / 4.7 | 10.8 / 10.8 | 2.0 / 2.0 | 3.5 / 3.5 | 0.4 / 0.4 | 3.5 / 3.5 | 6.5 / 6.5 |
| 20 | 1024 | steady | 12.9 / 12.9 | 0.0 / 0.0 | 0.0 / 0.0 | 12.9 / 12.9 | 0.4 / 0.4 | 6.9 / 6.9 | 0.0 / 0.0 | 6.9 / 6.9 | 8.9 / 8.9 |
| 20 | 1024 | L steps 0,+40,0,-20,0 ms | 12.4 / 12.4 | 0.0 / 0.0 | 2.9 / 2.9 | 12.4 / 12.4 | 0.9 / 0.9 | 6.7 / 6.7 | 0.0 / 0.0 | 6.7 / 6.7 | 9.2 / 9.2 |
| 20 | 1024 | L 32 ms -> 0 -> 32 ms | 8.1 / 8.1 | 0.0 / 0.0 | 0.0 / 0.0 | 8.1 / 8.1 | 0.3 / 0.3 | 4.4 / 4.4 | 0.0 / 0.0 | 4.4 / 4.4 | 5.6 / 5.6 |
| 20 | 1024 | hiccups 1% | 13.2 / 13.2 | 0.1 / 0.1 | 0.4 / 0.4 | 13.3 / 13.2 | 0.7 / 0.7 | 7.3 / 7.3 | 0.2 / 0.2 | 7.3 / 7.3 | 9.3 / 9.3 |
| 20 | 1024 | vsync gaps 17/33/50/67 | 18.0 / 17.7 | 1.9 / 0.9 | 7.9 / 7.4 | 18.2 / 17.7 | 5.2 / 4.7 | 12.8 / 12.4 | 2.7 / 2.0 | 12.8 / 12.4 | 14.5 / 14.1 |
| 20 | 1024 | jitter +-8 ms | 14.2 / 14.2 | 0.0 / 0.0 | 1.2 / 1.2 | 14.2 / 14.2 | 1.4 / 1.4 | 8.2 / 8.2 | 0.5 / 0.5 | 8.2 / 8.2 | 10.1 / 10.1 |

max lag (entries / ms) over these rows: rule 0 / 0, asym 1 / 85, a 1 / 68, b 1 / 85, B0.1 1 / 85, c0.25 1 / 75, d16 1 / 85, e16x0.25 1 / 75, f6 1 / 75; early, every row and variant: 0

At the measured point (49 ms frames, L = 32 ms; 60 Hz, L = 200 ms, a read time exactly on a boundary), mean lag
entries / ms:

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 | f6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 0.00 / 0 | 0.51 / 8 | 0.25 / 4 | 0.00 / 0 | 0.51 / 8 | 0.51 / 8 | 0.51 / 8 | 0.51 / 8 | 0.51 / 8 |
| 60 | 128 | steady | 0.00 / 0 | 0.82 / 14 | 0.15 / 2 | 0.73 / 12 | 0.82 / 14 | 0.82 / 13 | 0.77 / 13 | 0.70 / 11 | 0.82 / 13 |
| 20 | 0 | steady | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.67 / 33 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 0 | hiccups 1% | 0.00 / 0 | 0.99 / 48 | 0.01 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.12 / 6 | 0.00 / 0 | 0.00 / 0 |
| 20 | 0 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.93 / 46 | 0.06 / 1 | 0.00 / 0 | 0.04 / 2 | 0.01 / 0 | 0.67 / 32 | 0.01 / 0 | 0.01 / 0 |
| 20 | 0 | jitter +-8 ms | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 128 | steady | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 128 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.67 / 33 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 128 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 128 | hiccups 1% | 0.00 / 0 | 0.99 / 49 | 0.01 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.10 / 5 | 0.00 / 0 | 0.00 / 0 |
| 20 | 128 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.94 / 46 | 0.05 / 1 | 0.00 / 0 | 0.04 / 2 | 0.01 / 0 | 0.65 / 31 | 0.01 / 0 | 0.01 / 0 |
| 20 | 128 | jitter +-8 ms | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 512 | steady | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 0.00 / 0 | 0.67 / 33 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.37 / 18 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| 20 | 512 | hiccups 1% | 0.00 / 0 | 1.00 / 49 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.05 / 2 | 0.00 / 0 | 0.00 / 0 |
| 20 | 512 | vsync gaps 17/33/50/67 | 0.00 / 0 | 0.95 / 47 | 0.05 / 1 | 0.00 / 0 | 0.04 / 2 | 0.01 / 0 | 0.68 / 33 | 0.01 / 0 | 0.01 / 0 |
| 20 | 512 | jitter +-8 ms | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |

max lag (entries / ms) over these rows: rule 0 / 0, asym 1 / 75, a 1 / 53, b 1 / 21, B0.1 1 / 75, c0.25 1 / 35, d16 1 / 75, e16x0.25 1 / 35, f6 1 / 35; early, every row and variant: 0

Holds % / skips %:

| fps | clock | scenario | rule | asym | a | b | B0.1 | c0.25 | d16 | e16x0.25 | f6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | 0 | steady | 24.9 / 24.9 | 0.0 / 0.0 | 13.1 / 13.1 | 24.9 / 24.9 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 60 | 128 | steady | 14.8 / 14.8 | 0.0 / 0.0 | 12.3 / 12.3 | 4.3 / 4.3 | 0.0 / 0.0 | 0.0 / 0.0 | 0.8 / 0.8 | 1.9 / 1.9 | 0.0 / 0.0 |
| 20 | 0 | steady | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 0 | L steps 0,+40,0,-20,0 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 0 | L 32 ms -> 0 -> 32 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 0 | hiccups 1% | 0.8 / 0.8 | 0.0 / 0.0 | 0.8 / 0.8 | 0.8 / 0.8 | 0.8 / 0.8 | 0.8 / 0.8 | 0.8 / 0.8 | 0.8 / 0.8 | 0.8 / 0.8 |
| 20 | 0 | vsync gaps 17/33/50/67 | 6.2 / 6.1 | 0.0 / 0.0 | 5.8 / 5.8 | 6.2 / 6.1 | 5.9 / 5.8 | 6.1 / 6.1 | 1.6 / 1.6 | 6.1 / 6.1 | 6.1 / 6.1 |
| 20 | 0 | jitter +-8 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 128 | steady | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 128 | L steps 0,+40,0,-20,0 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 128 | L 32 ms -> 0 -> 32 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 128 | hiccups 1% | 0.6 / 0.6 | 0.0 / 0.0 | 0.6 / 0.6 | 0.6 / 0.6 | 0.6 / 0.6 | 0.6 / 0.6 | 0.6 / 0.6 | 0.6 / 0.6 | 0.6 / 0.6 |
| 20 | 128 | vsync gaps 17/33/50/67 | 5.2 / 5.2 | 0.0 / 0.0 | 5.0 / 5.0 | 5.2 / 5.2 | 5.0 / 5.0 | 5.2 / 5.2 | 1.6 / 1.6 | 5.2 / 5.2 | 5.2 / 5.2 |
| 20 | 128 | jitter +-8 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 512 | steady | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 512 | L steps 0,+40,0,-20,0 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 512 | L 32 ms -> 0 -> 32 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 20 | 512 | hiccups 1% | 0.3 / 0.3 | 0.0 / 0.0 | 0.3 / 0.3 | 0.3 / 0.3 | 0.3 / 0.3 | 0.3 / 0.3 | 0.3 / 0.3 | 0.3 / 0.3 | 0.3 / 0.3 |
| 20 | 512 | vsync gaps 17/33/50/67 | 4.9 / 4.9 | 0.0 / 0.0 | 4.7 / 4.7 | 4.9 / 4.9 | 4.7 / 4.7 | 4.9 / 4.9 | 1.4 / 1.4 | 4.9 / 4.9 | 4.9 / 4.9 |
| 20 | 512 | jitter +-8 ms | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |

max lag (entries / ms) over these rows: rule 0 / 0, asym 1 / 75, a 1 / 53, b 1 / 21, B0.1 1 / 75, c0.25 1 / 35, d16 1 / 75, e16x0.25 1 / 35, f6 1 / 35; early, every row and variant: 0

**Per latency at 49 ms frames** (128-frame clock, 1 % late ticks; lag entries / holds % / skips %): c0.25 locks one
behind from L = 41 ms (8 ms past the stamp < its 12 ms tolerance), f6 from L = 45 ms (4 ms past):

| L ms | asym | c0.25 | f6 |
|---|---|---|---|
| 33 |  0.991  /  0.00  /  0.00  |  0.000  /  0.85  /  0.85  |  0.000  /  0.85  /  0.85  | 
| 35 |  0.991  /  0.00  /  0.00  |  0.000  /  0.85  /  0.85  |  0.000  /  0.85  /  0.85  | 
| 37 |  0.991  /  0.00  /  0.00  |  0.000  /  0.85  /  0.85  |  0.000  /  0.85  /  0.85  | 
| 39 |  0.991  /  0.00  /  0.00  |  0.001  /  0.85  /  0.85  |  0.000  /  0.85  /  0.85  | 
| 41 |  0.991  /  0.00  /  0.00  |  0.144  /  0.85  /  0.85  |  0.001  /  0.85  /  0.85  | 
| 42 |  0.991  /  0.00  /  0.00  |  0.367  /  0.85  /  0.87  |  0.001  /  0.85  /  0.85  | 
| 43 |  0.991  /  0.00  /  0.00  |  0.690  /  0.85  /  0.85  |  0.006  /  0.85  /  0.85  | 
| 44 |  0.991  /  0.00  /  0.00  |  0.917  /  0.85  /  0.85  |  0.006  /  0.85  /  0.85  | 
| 45 |  0.991  /  0.00  /  0.00  |  0.983  /  0.85  /  0.85  |  0.265  /  0.85  /  0.85  | 
| 46 |  0.930  /  0.00  /  0.00  |  0.921  /  0.85  /  0.85  |  0.800  /  2.52  /  2.50  | 
| 47 |  0.930  /  0.00  /  0.00  |  0.921  /  0.85  /  0.85  |  0.800  /  2.52  /  2.50  | 
| 48 |  0.930  /  0.00  /  0.00  |  0.921  /  0.85  /  0.85  |  0.921  /  0.85  /  0.85  | 

Reading the tables:

- **asym** (the old rule) has ~0 holds/skips but a lag that does not come back: 0.99 entry (48 ms) at the measured
  point once a late tick happened, 0.93 with vsync gaps, 0.67 after an L step; at every L from 33 to 48 ms. That is
  the coordinator's 95 ms (49 ms frame + the 49 ms lock). In pure steady state (no trigger) it is 0 there: the lock
  needs a trigger, so the brief's "today ≈ 1 entry" holds after one late tick (the red tests include one).
- **c0.25** is at 0.00–0.01 at the measured point, but a quarter of 49 ms is 12 ms: a read time 7–12 ms past a stamp
  (which ±1.5 ms of jitter cannot flip) locks one behind for good after a trigger (L = 41: 0.14 → L = 44: 0.92; the
  advisor's finding, confirmed in the sweep, 0.15 entry with late ticks).
- **f6** caps that band at 6 ms: at 49 ms frames the lock starts at L = 45 (4 ms past); mean lag over the sweep
  0.03–0.08 entry in every scenario and clock (c0.25 0.04–0.15); holds/skips each ≤ 0.7 % with a continuous or
  128-frame clock in the steady, L-step and late-tick rows (c0.25 ≤ 0.5 %). At 60 Hz it is c0.25 (the quarter,
  4.2 ms, binds). Its cost is more of the rule's own holds/skips where the noise is larger than 6 ms, at 49 ms frames:
  vsync gaps 9 % each (c0.25 7 %), ±8 ms jitter 6 % (3 %), a 512-frame clock 3–5 % in the steady rows (0 %), a
  1024-frame clock 6–9 % (4–7 %).
- **d16** (noise-adaptive) turns back into asym when the noise reaches the margin: 0.65–0.74 entry with vsync gaps at
  the measured point, 0.05–0.12 after late ticks. Rejected: its lag depends on a noise distribution not measured.
- **e16x0.25** helps where noise is low (0.07 vs 0.15 at 49 ms with late ticks, 0.04 vs 0.11 after L steps) but
  keeps c's 12 ms band where the noise is large (vsync gaps, ±8 ms, 512/1024 frames: e = c); f6 is at or below it in
  every 49 ms row without a 16-entry scan.
- **a** catches up after any second frame behind, so a boundary read time alternates: 13 % holds and 13 % skips at
  60 Hz, 200 ms (asym, c, f: 0). **b/B0.1** track the mean but slowly: B0.1 is 0.04 with vsync gaps at the measured
  point (f6 0.01) and 0.51 on the boundary (as c and f), with more state (an EMA and a reset).
- **Coarse clocks at 60 Hz (512, 1024 frames = 10.7, 21.3 ms ≥ 0.64 frame):** the stamps themselves repeat or jump a
  frame; the rule holds/skips ≈ 20–22 % each, c/f keep most of them (13 %, 22 %) where asym has ~0 % at 0.56–0.68
  entry of lag. Those holds are the clock's, not the rule's; by the advisor's note this row does not pick the rule.
- **Never early: 0** in every row of every variant; **max lag: 1 entry** for every variant but `rule` (about one frame
  in ms: up to 21 ms at 60 Hz, 35–85 ms at 49 ms frames).

**Chosen: f6** = c0.25 capped at 6 ms — one condition on the existing line, no state, O(1), nothing allocated: never
early; one entry behind only while the read time is within min(¼ interval, 6 ms) past a stamp (where jitter flips the
rule); the rule elsewhere.

### Step 1: the read rule (3f1429ec4, core)

- **Red** (the two new tests on the old rule): `49 ms frames, latency 32 ms, one late tick` mean lag 1 (expected
  ≤ 0.1); `a late tick every 50 frames` 0.98. A third test, `a latency that drops from 32 ms to 0 presents the newest
  entry`, is red on the old rule (locked one behind at L = 0) and on c without the newest-entry exemption (mutant
  run: 1 failed), green with it.
- **Green:** 20 presented-frame tests; every existing expectation unchanged, including the exact 0 holds / 0 skips of
  the ±1.5 ms jitter and 5.3 ms quanta tests and `never goes back` (exact 16 ms stamps: margin 0 < 4 ms → 15, as
  before). No bound relaxed. `StepTolerance = 0` (mutant) fails 4 tests.

### Step 2: the 6 ms cap (404638e5d, core; after the advisor's review of step 1)

- **Red** on step 1 (c0.25): `every latency from 33 to 42 ms, one late tick` fails at L = 41 (mean lag 1);
  `a latency step from 60 to 42 ms` mean lag 1. Green with `MaxStepTolerance = 0.006`: 22 tests.
- `MaxStepTolerance = 0.002` (mutant) fails 3 tests (60 Hz jitter, 5.3 ms quanta, ±40 ms steps): the cap must cover
  the jitter. 4, 5 and 6 ms all pass the spec; 6 ms covers ±1.5 ms of tick jitter (3 ms between two ticks) plus a
  128-frame clock step (2.7 ms).
- `audio-pipeline.spec.ts` (not edited): the latency-0 identity and the k-frame shift / lag tests pass (`-t
  "latency|shift|lag"`: 9 passed); the whole file passes in the full run.
- Checks: `npm run lint` 0 errors (2 warnings, unused eslint-disable in `app.tsx:534,540`, not this lane's);
  `npx tsc --noEmit -p tsconfig.json` clean; `npx jest src/apps/virus-on-the-rock src/mol-plugin-state
  src/mol-repr/structure src/mol-canvas3d`: 21 suites, 180 tests passed.

### Step 3: spec pages (app commits)

`_spec/architecture.md` §2 (the read rule) and `_spec/core-changes.md` (`audio-presented-frame.ts` row).

## Decided (by me, within the brief)

- **Superseded by the gate (alt3: min(5 ms, max(3 ms, ½ interval)))**; the line below is the first decision, the quarter and the 6 ms cap.
- **f6 over (a), (b) and the noise-adaptive d**: the tables above. The quarter because it covers ±1.5 ms of jitter at
  60 Hz (4.2 ms) and keeps every existing test exact; the 6 ms cap because a quarter of a slow frame (12 ms at 49 ms)
  is a band where nothing flips the rule yet the picture stays one behind.
- **The newest entry is never held back**: without it a latency that drops below one frame (to 0 when the context
  stops) locks the picture one behind at L = 0, where the rule cannot flip (the read time is the newest stamp).
- **The doc on `present`** now names the band ("a read time within the tolerance of a stamp stays one entry behind
  while it sits there") instead of "a latency that shrinks by less than two frames can leave the picture one behind".

## Review (gate, fix step)

Reviewer and skeptic (Opus); the coordinator's decision: replace the tolerance by alt3, `min(5 ms, max(3 ms, ½ · (stamp(seq) − stamp(next))))`.
Skeptic's table (±1.5 ms jitter): holds and skips at the exact boundary 0 % at 60, 120 and 144 Hz (the quarter rule: 0 / 7.3 / 11.2 %);
0.9 % with a noisy L at 60 Hz (5.7 %); at 49 ms frames the defect stays fixed (entry lag 0.03-0.08, old rule 0.42); early 0 everywhere.

| # | Finding | Reviewer / skeptic | Grade | Fix |
|---|---|---|---|---|
| 1 | the quarter-interval tolerance holds and skips at the boundary at 120 and 144 Hz (L = k frames, ±1.5 ms: 7.3 / 11.2 %, old rule 0 %) | should (production-code probe) / confirmed in the model, jitter premise plausible | should | red test `001430886` (120 and 144 Hz, 0 holds and skips), fix `7d89312d2` (alt3) |
| 2 | `_spec/audio-routing-spec.md` heard row names the old rule and lacks the Chrome numbers | should / confirmed | should | the read rule as built, the 49 ms numbers (presented − live 50 / 51 / 53 ms, ≈ 95 ms before; heard median 47 / 66 / 58 ms) and the 60 Hz caveat; the spec commit below |
| 3 | the constants are not pinned from above and below | should / confirmed by mutants (0.3–1 and 3–9 ms passed 22/22) | should | `0d0b9aa01`: cap, floor and half pinned (below); 7 mutants run |
| 4 | `architecture.md` §2 does not say the newest entry is exempt | confirmed | nit | the spec commit below |
| 5 | at 60 Hz with L ≈ 32 ms the lag win is small | confirmed (0.79 vs 0.84) | nit | one sentence under Open, in the routing spec |
| 6 | a noisy `outputLatency` is not modelled | confirmed | nit | modelled now (0.9 %), under Open |
| N1 | the `MaxStepTolerance` docstring budget | confirmed | nit | docstring rewritten for 3 / ½ / 5 ms (`7d89312d2`) |
| N2 | the tolerance is taken from the jittered stamp interval, not the frame period (≈ 1 ms at 144 Hz with ±1.5 ms), so a pure fraction fails at the boundary | — / skeptic, confirmed (bound2 144 Hz: ½ alone 0.9 %, with the 3 ms floor 0 %) | nit | fixed by the 3 ms floor, 7d89312d2 |

Mutants run on `audio-presented-frame.ts` (the spec file `audio-presented-frame.spec.ts`; 27 tests, all pass unmutated):

| Mutant | Fails |
|---|---|
| cap 6 ms | the cap, 5.5 ms outside the band |
| cap 4 ms | the cap, 4.5 ms inside the band |
| no floor | the floor (144 Hz alternating ±1.5 ms); 120 and 144 Hz at L = k frames |
| floor 2 ms | the same two |
| floor 4 ms | the half (3.3 / 3.7 ms at 144 Hz) |
| ½ → 0.25 | the half; the cap 4.5 ms |
| ½ → 1 | the half |

The pins use no random jitter: one exit from the band ends it for good (the picture is on the rule from then on), so
the mean over 900 frames cannot tell 3.2 from 3.7 ms under ±0.3 ms jitter (measured: sharp edge at the floor, not at the half).

## Size

6 production lines (the condition, two constants), ~20 doc lines; 5 tests, ~55 test lines. Brief: ~10 / ~60.

## Open

- **At 60 Hz with L ≈ 32 ms the lag win is small** (review finding 5): mean lag 0.79 entry against 0.84 with the old
  one-sided rule; the rule matters at slow frames (49 ms: 0.03-0.08 against 0.42) and at the boundary, not there.
- **A noisy `outputLatency`** (finding 6) is modelled now: ±2 ms per read at 60 Hz, 0.9 % holds and skips (the quarter
  rule: 5.7 %). Chrome's own reports are not measured.
- **Chrome's `currentTime` step is not measured** (the heard-frame review lists it too). The 6 ms cap assumes a
  128-frame step; with 512 frames (10.7 ms) at 49 ms frames f6 keeps 4–11 % holds and skips each (see the tables).
  A one-line log of `currentTime` deltas in Ludo's Chrome would settle it.
- Ludo's Chrome check (clicksync heard column, and the presented − live lag): expected ≈ 49 ms (one frame at 49 ms
  frames, L = 32 ms) instead of ≈ 95 ms. Not run by this lane (no browser here).
- Coarse clocks (≥ 512 frames) at 60 Hz keep most of the rule's own holds/skips: accepted, the stamps carry no finer
  time; a de-quantized clock (currentTime smoothed against performance.now) would be its own lane.

## The simulation (`node sim.mjs <variants> [scenario prefix | all]`, `node pivot.mjs out.md lag|hs [rows]`)

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
    } else if (name.startsWith('f')) {
      // c with the tolerance capped in ms: min(0.25 * interval, T)
      const T = +name.slice(1) / 1000;
      pick = seq;
      if (seq === next + 1 && seq < n - 1 && read - stamps[seq] < Math.min(0.25 * (stamps[seq] - stamps[next]), T) - 1e-9) pick = next;
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
// node pivot.mjs out.md <lag|hs> [row filters...]: lag = mean lag entries / ms; hs = holds % / skips %
import { readFileSync } from 'fs';
const [file, mode, ...want] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').split('\n').filter(l => /^\| \d/.test(l)).map(l => l.split('|').slice(1, -1).map(x => x.trim()));
const vs = [...new Set(rows.map(r => r[3]))];
const keys = [...new Set(rows.map(r => r.slice(0, 3).join(' | ')))].filter(k => !want.length || want.some(w => k.includes(w)));
console.log('| fps | clock | scenario | ' + vs.join(' | ') + ' |'); console.log('|---|---|---|' + vs.map(() => '---').join('|') + '|');
const maxLag = {}, maxMs = {}; let early = 0;
for (const k of keys) {
  const cells = vs.map(v => {
    const r = rows.find(r => r.slice(0, 3).join(' | ') === k && r[3] === v);
    early += +r[10]; maxLag[v] = Math.max(maxLag[v] ?? 0, +r[5]); maxMs[v] = Math.max(maxMs[v] ?? 0, +r[7]);
    return mode === 'hs' ? `${(+r[8]).toFixed(1)} / ${(+r[9]).toFixed(1)}` : `${(+r[4]).toFixed(2)} / ${(+r[6]).toFixed(0)}`;
  });
  console.log(`| ${k} | ${cells.join(' | ')} |`);
}
console.log(`\nmax lag (entries / ms) over these rows: ${vs.map(v => `${v} ${maxLag[v]} / ${maxMs[v].toFixed(0)}`).join(', ')}; early, every row and variant: ${early}`);
```
