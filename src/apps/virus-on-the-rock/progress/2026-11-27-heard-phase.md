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
