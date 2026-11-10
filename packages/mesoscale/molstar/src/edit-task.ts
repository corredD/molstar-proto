/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Task } from '@molstar/core/task';
import { abortError, type CompileProgress } from '@molstar/meso-spec/runtime';
import type { PluginContext } from '@molstar/plugin/context';
import type { EditRun } from './session.js';

// A model edit as a Mol* task (prism.md §7.2; Ludo, 2026-11-09): whoever starts it (Built by, the agent,
// `api.run('mesoviewspec.edit')`), it shows in the status pill with its progress (per model) and Cancel, and stays
// there whatever row is picked. The task's abort and the run's signal are one: the pill's Cancel stops the resolution
// (the operation fails as aborted, the step is rolled back), and the run's signal ends the task.

/**
 * How often the task is told how far the edit is. A Mol* task sees an abort only when it reports (`update`), and the
 * pill lists a task only once it has reported after 250 ms: the beat is what makes both happen while a packer runs.
 */
const BeatMs = 100;

/** The task's line: the model resolving and how many are done of how many, or that it has started. */
export function resolvingLine(p: CompileProgress | undefined): string {
  return p ? `Resolving ${p.model} (${p.done + 1} of ${p.total})…` : 'Resolving…';
}

/**
 * Runs `work` (the owner's edit, given the run's signal and a progress callback) as a task of the plugin. A stop,
 * from the task or the run, rejects with an `AbortError` (or the task's abort), never with the edit half-done.
 */
export function editAsTask<T>(
  plugin: PluginContext,
  signal: AbortSignal | undefined,
  work: (run: EditRun) => Promise<T>,
): Promise<T> {
  const stop = new AbortController();
  const fromRun = () => stop.abort(signal?.reason);
  if (signal?.aborted) fromRun();
  else signal?.addEventListener('abort', fromRun, { once: true });
  let progress: CompileProgress | undefined;
  const task = Task.create('Resolving the document', async (ctx) => {
    let settled = false;
    const done = work({
      signal: stop.signal,
      onProgress: (p) => {
        progress = p;
      },
    });
    const ended = done.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled) {
      if (!stop.signal.aborted) {
        try {
          await ctx.update(
            progress
              ? { message: resolvingLine(progress), current: progress.done, max: progress.total, isIndeterminate: false }
              : resolvingLine(undefined),
          );
        } catch (e) {
          if (!Task.isAbort(e)) throw e;
          // the pill's Cancel: the resolution stops at its next check, the edit rejects
          stop.abort(abortError());
        }
      }
      let beat: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([ended, new Promise<void>((resolve) => (beat = setTimeout(resolve, BeatMs)))]);
      clearTimeout(beat);
    }
    return done;
  });
  return plugin.runTask(task).finally(() => signal?.removeEventListener('abort', fromRun));
}
