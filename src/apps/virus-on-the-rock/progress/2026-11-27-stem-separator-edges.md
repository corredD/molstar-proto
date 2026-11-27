# Stem separator edges (2026-11-27, lane `stem-separator-edges`)

## Brief

Copied from `2026-11-27-overnight.md` (review issue 9, `2026-11-26-audio-review.md`):

- **Build:** `setModel` re-checks the model after awaiting the tap; a failed tap setup clears `tapLoading` so a retry
  retries.
- **Tests:** the skeptic's two probes as specs (fake worker, worklet and context).
- Probe 1: `setModel('htdemucs')` while `addModule` is pending, then `setModel(undefined)`, then resolve `addModule`:
  no `load` after the `unload`, tap not turned on (today: unload, load, tap:true). Null control: Off after the load
  completed still posts tap:false and unload.
- Probe 2: first `addModule` rejects; Off; the model again: `addModule` called a second time, status reaches
  `loading` (today: once, status stays error). Null control: the success path calls `addModule` once.
- Fixes: re-check `this.model === id` (and the requested provider) after the await; clear `tapLoading` in a catch
  before rethrowing. Outside the app folder: entry in `_spec/core-changes.md`, its own commit.

## Red run (specs on today's code; 3 failed, 5 passed incl. both null controls)

```
x Off while the tap loads: no load after the unload, the tap stays off
    Expected ["unload"]  Received ["unload", "load"]
x another provider while the tap loads: only the last request loads
    Expected ["wasm"]    Received ["webgpu", "wasm"]
x a failed tap setup retries when the model is picked again after Off
    expect(modules.length).toBe(2)  Received: 1   (addModule called once, status stays error)
ok null control: Off after the load completed still unloads and turns the tap off
ok null control: the success path calls addModule once
```
(Added a third probe beyond the brief: the provider changed during the await, the "requested provider" half of the fix.)

## Built

- `setModel`: after `await ensureTap()`, returns unless `this.model === id` and the requested provider is unchanged;
  the catch sets the error status only for the current request (a stale failure must not overwrite a newer one).
- `ensureTap`: a rejected `tapLoading` is cleared (side `.catch`, the awaiting caller still sees the rejection), so
  picking the model again after Off calls `addModule` again.
- Specs: 5 (3 red on today's code, 2 null controls), fakes for Worker, AudioWorkletNode, Blob/URL, a controllable
  `addModule`. `core-changes.md` entry as its own commit.

## Decided

- Third probe (provider changed during the await) added: it is the "requested provider" half of the brief's fix.
- The catch's status guard is not in the brief; without it a stale failure would show as error over a newer load.
- Retry via a side `.catch` rather than try/catch around the IIFE: same effect, no rethrow needed.

## Learned

- The tap node stays created when the request was superseded; that is intended (the next request reuses it).

## Size

~7 production lines (brief: small), ~110 spec lines.

## Checks

`npm run lint`: 0 errors (2 pre-existing warnings); `tsc --noEmit`: clean; jest virus-on-the-rock, mol-plugin-state,
mol-repr/structure: 11 suites, 85 tests pass. `build.mjs --prd` not run (not asked); run in the review fix, see Review.

## Review (gate: lane-reviewer + lane-skeptic, fix step 2026-11-27)

Fix commits: `ab5212c53` (F4 spec), `5b7cdc8e5` (F3 + 5 specs, red), `d6927adc2` (request counter).

| # | Finding | Verdict | Action / commit |
|---|---|---|---|
| 1 | `--prd` build not run | confirmed, process | skeptic ran it, exit 0; run again in the fix step: `node ./scripts/build.mjs -a virus-on-the-rock --prd` prints Done., exit 0; `build/` removed (not in git) |
| 2 | `0d235fc4b` mixes a core spec with the progress file | confirmed, process | recorded; pushed commits are not amended; the fix commits keep core and progress apart |
| 3 (F3) | same request, Off, same request during the tap load: two loads (`["unload","load","load"]`), value comparison cannot tell the requests apart | confirmed, nit | spec `5b7cdc8e5` red (Expected 1 load, Received 2), fixed by `d6927adc2`: `private request`, `const request = ++this.request` after the same-request early return (a no-op call must not cancel a pending load), `if (request !== this.request) return` after the tap await, catch guarded by the counter, `dispose()` bumps it |
| 4 (F4) | Off then the tap fails: error status over off? | should-fix: a missing spec, code was right | spec `ab5212c53` passes on the lane's code; with the guard removed (temporary, not committed) it fails: Expected "off", Received "error" |
| 5 | retry test asserted `toContain('loading')`, true from the first request | confirmed, nit | now `sep.currentStatus.state === 'loading'` after the retry flush (the status left over from the failed first request is `error`); in `5b7cdc8e5` |
| 6 | `dispose()` during the tap await: later `load`/tap still happen | plausible, inert (worker terminated and set undefined, `post` is a no-op; predates the lane) | left open; the counter bump in `dispose()` now also stops the load post |
| R | `registerProcessor('molstar-stem-tap')` runs again on a retry after `addModule` succeeded but `AudioWorkletNode` threw, so the second `addModule` can reject | plausible, nit | left open (needs a browser to prove; the failure shows as error and Off/again retries) |
| N1 | request counter in place of value comparison | nit | `d6927adc2` |

Checks after the fix: `npm run lint` 0 errors (2 pre-existing warnings); `tsc --noEmit` clean; jest virus-on-the-rock,
mol-plugin-state, mol-repr/structure: 11 suites, 87 tests pass; `build.mjs --prd` Done.
