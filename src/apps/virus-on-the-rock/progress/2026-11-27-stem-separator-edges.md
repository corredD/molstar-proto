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
