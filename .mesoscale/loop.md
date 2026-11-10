# MesoViewSpec in prism-me: the loop

The prompt one round of the loop runs (`/loop` pointed at this file, or the orchestrator). It works the
[checklist](checklist.md) under the rules of `apps/prism-me/AGENTS.md` ("How we work") and prism.md §12.1 (stacking).

## One round

1. **Read** `checklist.md`. If "Open for Ludo" lists anything, stop and report it: nothing else runs.
2. **Pick** the first unticked item of the lane in flight (one lane at a time unless the checklist says two run in
   parallel). A lane not started begins with its brief: copy prism.md §12.2's into
   `apps/prism-me/progress/<date>-<slug>.md`, make the worktree `~/prism-me-lanes/<slug>` on `me/<slug>` from
   `me/mesoviewspec`, with the port the progress file names.
3. **Do** that one item:
   - a failing test first, then the code; small commits, one cause each; the lane's changelog in
     `.v6/changelogs/<slug>.md`;
   - Sonnet for mechanical steps, Opus for design and every review, as the brief says;
   - the checks before ticking a build step: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
     `pnpm format:check`, `pnpm check:workspace`, the quick lane.
4. **Record**: tick the item, append one line to the lane's progress file, commit (lane files in the lane; the checklist
   in the main checkout).
5. **End the round.** One item a round.

## The gate (a lane's last step)

- **Reviewer** (Opus, read-only): reads the lane's diff against its brief and the spec; lists findings as must-fix,
  should-fix or nit, each with file:line and evidence.
- **Skeptic** (Opus, read-only): tries to refute each finding against the code; a verdict per finding (confirmed,
  plausible, refuted) and its own severity.
- **Fix**: each confirmed must-fix and should-fix gets a failing test, then its fix, in its own commit. The rest go to
  the progress file's Open list. The progress file's Review table is the record.

## Hard stops

- A decision that is Ludo's (a design choice, a spec contradiction, a scope change): write it under "Open for Ludo" and
  end the round.
- The work turns out different from the brief: stop and say how.
- Ludo's check in the app: ask for it, never tick it yourself.
- Never push, never open a PR. A lane merges into `me/mesoviewspec` locally, and only after Ludo's check.
