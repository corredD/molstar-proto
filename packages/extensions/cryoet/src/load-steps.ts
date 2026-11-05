/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Asset } from '@molstar/core/util/assets';
import { fetchData } from '@molstar/core/util/data-source';
import type { PluginContext } from '@molstar/plugin/context';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';

// The steps a cryo-ET source's load shares (_spec/empiar.md §2): files fetched before the history step, so a slow
// server holds no other edit (the history runs its steps one at a time), then read from memory by the step's own
// `Download`; a read made once.

/** A download under way: which file of how many, its bytes so far and in all (0: not said), since when (ms) */
export interface FetchProgress {
  readonly name: string;
  readonly index: number;
  readonly count: number;
  readonly loaded: number;
  readonly total: number;
  readonly started: number;
}

/** A read made once; one that failed is asked again next time */
export function once<T>(reads: Map<string, Promise<unknown>>, key: string, read: () => Promise<T>): Promise<T> {
  let p = reads.get(key) as Promise<T> | undefined;
  if (!p) {
    p = read();
    p.catch(() => reads.delete(key));
    reads.set(key, p);
  }
  return p;
}

/**
 * Files fetched ahead of a load's step, into the plugin's assets: the step's `Download` of the same address finds them
 * there (`Asset.getUrlAsset`) and reads no network. A file one load fetches another waits for. Each `fetch` holds its
 * file until its `release`: the file goes at the last one (review F3c: the first load to end let go of a file another,
 * its step still queued, had to read again inside that step). The progress of the one under way is a state (the card's
 * line); the caller's signal cancels it.
 */
export class FetchAhead {
  private readonly fetching = new Map<string, Promise<unknown>>();
  /** The `fetch`es not released yet, by address */
  private readonly holds = new Map<string, number>();
  private readonly now = observableState<FetchProgress | undefined>(undefined);
  /** The download under way, if one is */
  readonly progress = this.now.asReadonly;

  constructor(private readonly plugin: PluginContext) {}

  /** `url` in the plugin's assets, fetched unless it is there already; held until `release` (whatever the outcome) */
  fetch(url: string, at: Pick<FetchProgress, 'name' | 'index' | 'count'>, signal?: AbortSignal): Promise<unknown> {
    this.holds.set(url, (this.holds.get(url) ?? 0) + 1);
    const assets = this.plugin.managers.asset;
    if (assets.tryFindUrl(url)) return Promise.resolve();
    return once(this.fetching, url, async () => {
      const started = Date.now();
      const show = (loaded: number, total: number) => this.now.set({ ...at, loaded, total, started });
      show(0, 0);
      try {
        const bytes = await fetchData({ url, type: 'binary', signal }).run((p) => {
          const { current, max, isIndeterminate } = p.root.progress;
          show(current, isIndeterminate ? 0 : max);
        }, 250);
        assets.set(Asset.Url(url), new File([bytes], url.slice(url.lastIndexOf('/') + 1)), { isStatic: true });
      } catch (e) {
        throw new Error(`Could not read ${url}: ${messageOf(e)}`);
      } finally {
        this.fetching.delete(url);
        this.now.set(undefined);
      }
    });
  }

  /**
   * Ends a `fetch`'s hold of `url`; at the last, the file goes from the assets unless `keep` (one the scene holds keeps
   * its own bytes)
   */
  release(url: string, keep = false) {
    const n = (this.holds.get(url) ?? 0) - 1;
    if (n > 0) {
      this.holds.set(url, n);
      return;
    }
    this.holds.delete(url);
    if (keep) return;
    const assets = this.plugin.managers.asset;
    const a = assets.tryFindUrl(url);
    if (a) assets.delete(a);
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String((e as { reason?: string })?.reason ?? e));

/** Bytes as every card says them: MB of 10^6 bytes (the format's, and the guards' and speeds' own unit) */
export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)} MB`;

/** A duration as a card says it: `5 min`, `1 h` */
export const span = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.round(s / 3600)} h`);

/** The card's line for a download: `tomogram x.mrc (1 of 3): 120 of 875 MB, 0.15 MB/s, about 1 h left` */
export function progressLine(p: FetchProgress, now = Date.now()) {
  const mb = (x: number) => `${Math.round(x / 1e6)}`;
  const of = p.count > 1 ? ` (${p.index + 1} of ${p.count})` : '';
  const got = p.total ? `${mb(p.loaded)} of ${mb(p.total)} MB` : `${mb(p.loaded)} MB`;
  const speed = p.loaded / Math.max(1e-3, (now - p.started) / 1000);
  if (!p.loaded || now - p.started < 1000) return `Reading ${p.name}${of}: ${got}`;
  const left = p.total ? `, about ${span((p.total - p.loaded) / speed)} left` : '';
  return `Reading ${p.name}${of}: ${got}, ${(speed / 1e6).toFixed(2)} MB/s${left}`;
}
