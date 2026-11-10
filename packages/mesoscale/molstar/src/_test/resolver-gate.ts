/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import type { ResolveJob } from '@molstar/meso-spec/runtime';

/**
 * A gate on one model's resolution (default `m.recipe`): while held, its resolver waits, and stops when the run's
 * signal fires, so what shows while an edit resolves (the status, the pill's task, Cancel) never races the packer.
 * Open, the resolvers run as they are. Give `resolvers` to `createMesoViewSpecExtension`.
 */
export function resolverGate(model = 'm.recipe') {
  let held = false;
  let open: (() => void) | undefined;
  let waiting = false;
  const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });
  const wait = (signal: AbortSignal | undefined) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(stopped());
      waiting = true;
      open = () => {
        waiting = false;
        resolve();
      };
      signal?.addEventListener(
        'abort',
        () => {
          waiting = false;
          reject(stopped());
        },
        { once: true },
      );
    });
  const resolvers = DefaultResolvers.map((r) => ({
    ...r,
    resolve: (input: unknown, job: ResolveJob) =>
      held && job.model.id === model
        ? wait(job.signal).then(() => r.resolve(input as never, job))
        : r.resolve(input as never, job),
  })) as typeof DefaultResolvers;
  return {
    resolvers,
    /** The next resolutions of the model wait. */
    hold: () => {
      held = true;
    },
    /** One is waiting at the gate. */
    get waiting() {
      return waiting;
    },
    /** The waiting one goes on, and the next ones do not wait. */
    release: () => {
      held = false;
      open?.();
    },
  };
}
