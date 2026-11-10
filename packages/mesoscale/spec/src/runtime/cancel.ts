/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A resolution that can be stopped (prism.md §7.2: a cancelled model edit restores its checkpoint). The packers are
// loops of plain CPU work: an abort can only be seen if the loop gives the event loop back now and then. A packer is
// written as a generator that `yield`s at the top of its long loops, and `drive` runs it: with no signal straight
// through, synchronously, as it always ran (the CLI, the scaling guards, `resolve` returning its output); with a
// signal, in slices of `SliceMs` between which the event loop runs and the signal is checked.

/** How long a packer runs before it gives the event loop back (long enough that the yields cost nothing). */
export const SliceMs = 30;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** What a stopped resolution throws: an `AbortError`, as `AbortSignal.throwIfAborted` does. */
export function abortError(): Error {
  const e = new Error('The resolution was stopped.');
  e.name = 'AbortError';
  return e;
}

/** An abort (ours, the signal's own reason, or a Mol* task's): the compile stops with it instead of reporting it. */
export function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

/** Throws the abort when the signal has fired. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw isAbort(reason) ? reason : abortError();
}

/**
 * Runs a resolver written as a generator. No signal: to its end, now, returning what it returns. A signal: a promise
 * of it, the event loop given back every `SliceMs` (at the generator's next `yield`), the abort thrown there.
 */
export function drive<T>(job: { readonly signal?: AbortSignal }, steps: Generator<void, T, void>): T | Promise<T> {
  const signal = job.signal;
  if (!signal) {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
    }
  }
  return (async () => {
    let since = now();
    try {
      for (;;) {
        throwIfAborted(signal);
        const r = steps.next();
        if (r.done) return r.value;
        if (now() - since >= SliceMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          since = now();
        }
      }
    } finally {
      steps.return(undefined as never);
    }
  })();
}
