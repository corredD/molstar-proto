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

// The yield between slices. Never a timer where there is anything else: `setTimeout(0)` is clamped to 4 ms once nested
// and to a second or more in a background tab, so a long resolution would crawl. In a browser, `scheduler.yield` (the
// task queue, its priority kept), else a message on a channel. In Node, `setImmediate`: there a channel's messages
// posted from its own handler are delivered in the same turn, and the timers (an abort set by one) would never run.
let channel: { port: MessagePort; waiting: (() => void)[] } | undefined;
function viaChannel(): Promise<void> {
  if (!channel) {
    const c = new MessageChannel();
    const waiting: (() => void)[] = [];
    c.port1.onmessage = () => waiting.shift()?.();
    channel = { port: c.port2, waiting };
  }
  const { port, waiting } = channel;
  return new Promise<void>((resolve) => {
    waiting.push(resolve);
    port.postMessage(undefined);
  });
}

/** Gives the event loop back once (between two slices of a packer). */
export function yieldToEventLoop(): Promise<void> {
  const g = globalThis as {
    scheduler?: { yield?: () => Promise<void> };
    setImmediate?: (f: () => void) => unknown;
  };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof g.setImmediate === 'function') return new Promise<void>((resolve) => g.setImmediate!(resolve));
  if (typeof MessageChannel !== 'undefined') return viaChannel();
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
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
          await yieldToEventLoop();
          since = now();
        }
      }
    } finally {
      steps.return(undefined as never);
    }
  })();
}
