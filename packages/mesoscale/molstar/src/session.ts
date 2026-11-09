/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import { type Issue, issue } from '@molstar/meso-spec/format/issues';
import type { IR } from '@molstar/meso-spec/ir/ir';
import { type CommitReport, planCommit, type RendererAdapter } from '@molstar/meso-spec/runtime/adapter';
import type { ResolveOutput } from '@molstar/meso-spec/runtime/resolver';
import {
  classifyEdit,
  compile,
  type CompileResult,
  type RuntimeOptions,
  updateView,
} from '@molstar/meso-spec/runtime/runtime';
import {
  type StreamOptions,
  type StreamPlan,
  type StreamStats,
  TileStreamer,
} from '@molstar/meso-spec/runtime/streaming';

// A session (design.md §5, §6.1): one document, edited, with the runtime's cache and an adapter. An edit is classified
// first: a view edit (looks, camera, selection) derives a new view over the same IR and commits it; a model edit
// compiles with the session's cache (only the models whose projection changed resolve) and commits by key. Each edit
// leaves a record of what it cost, which the stories show and the tests check. Edits run one at a time, in the order
// they were asked for: two in flight would diff against the same previous IR (a list orphaned), and an edit given as a
// function of the document is built when its turn comes, so two clicks compose instead of the last one winning.
// A streamed model (design.md §6.8) adds one step to each edit, between the IR and the commit: the streamer plans the
// tiles around the camera and splices the resident ones in; a load that settles queues a `stream` step of its own.

export interface EditRecord {
  readonly label: string;
  readonly kind: 'initial' | 'none' | 'view' | 'model' | 'stream';
  readonly resolverRuns: number;
  readonly cacheHits: number;
  readonly compileMs?: CompileResult['stats']['ms'];
  readonly commit?: CommitReport;
  readonly totalMs: number;
  /** The streamer's counters after the step, and what its plan asked for (a stream session only). */
  readonly stream?: StreamStats & {
    readonly plan?: { readonly request: number; readonly evict: number; readonly cancel: number };
  };
}

/** An issue a step carries over: not the adapter's (it reports again) and not the streamer's (it lists all it holds). */
const kept = (i: Issue) => i.phase !== 'render' && i.code !== 'stream.tile' && i.code !== 'stream.budget';

export type SessionOptions = Omit<RuntimeOptions, 'cache'> & {
  /** With `tiles`: the budget and the loads in flight of the stream (design.md §6.8.5). */
  readonly stream?: StreamOptions;
};

export class MesoSession {
  doc: MesoViewSpecDoc;
  ir: IR | undefined;
  issues: readonly Issue[] = [];
  counts: CompileResult['counts'] = {};
  readonly history: EditRecord[] = [];
  private readonly cache = new Map<string, ResolveOutput>();
  /** The edit in flight, or the last one: the next one starts after it (a failure does not stop the queue). */
  private pending: Promise<unknown> = Promise.resolve();
  readonly streamer: TileStreamer | undefined;
  /** A stream step is queued and has not started: loads that settle meanwhile join it. */
  private streamQueued = false;

  constructor(
    doc: MesoViewSpecDoc,
    private readonly options: SessionOptions,
    private readonly adapter?: RendererAdapter,
  ) {
    this.doc = doc;
    const { stream, ...rest } = options;
    this.options = rest;
    if (stream && options.tiles) this.streamer = new TileStreamer(options.tiles, stream, () => this.onSettled());
  }

  dispose() {
    this.streamer?.dispose();
  }

  /** A new copy budget, applied by a stream step now (0 holds level 0 only; resident tiles beyond it are evicted). */
  setBudget(copies: number): Promise<EditRecord | undefined> {
    this.streamer?.setBudget(copies);
    return this.queue(() => this.runStream());
  }

  start(): Promise<EditRecord> {
    return this.queue(() => this.run('initial', this.doc, 'open'));
  }

  /** An edit: the next document, or a function of the current one (built when the edit's turn comes). */
  edit(next: MesoViewSpecDoc | ((doc: MesoViewSpecDoc) => MesoViewSpecDoc), label: string): Promise<EditRecord> {
    return this.queue(() => {
      const doc = typeof next === 'function' ? next(this.doc) : next;
      return this.run(classifyEdit(this.doc, doc), doc, label);
    });
  }

  private queue<T>(step: () => Promise<T>): Promise<T> {
    const done = this.pending.then(step);
    this.pending = done.catch(() => {});
    return done;
  }

  private onSettled() {
    if (this.streamQueued) return;
    this.streamQueued = true;
    this.queue(() => {
      this.streamQueued = false;
      return this.runStream();
    }).catch(() => {});
  }

  /** The streamer's step over `ir` (compiled or view-updated), the views derived again for the sets it spliced in. */
  private stream(doc: MesoViewSpecDoc, ir: IR) {
    const s = this.streamer?.step(ir);
    // `issues` are all the stream's standing ones (a model edit rebuilds the session's issues), `fresh` the new ones
    return {
      ir: s ? updateView(doc, s.ir) : ir,
      issues: this.streamer?.issues() ?? [],
      fresh: s?.issues ?? [],
      stream: this.streamRecord(s?.plan),
    };
  }

  private streamRecord(plan?: StreamPlan): EditRecord['stream'] {
    const stats = this.streamer?.stats();
    return (
      stats && {
        ...stats,
        ...(plan
          ? { plan: { request: plan.request.length, evict: plan.evict.length, cancel: plan.cancel.length } }
          : {}),
      }
    );
  }

  /** The adapter's commit; when it throws, the streamer goes back to the tiles the viewer still shows (`this.ir`). */
  private async draw(ir: IR): Promise<CommitReport | undefined> {
    try {
      return await this.adapter?.commit(ir);
    } catch (e) {
      this.streamer?.restore(this.ir);
      throw e;
    }
  }

  /** A stream step on the current IR: the arrivals in, the evictions out, one commit (none when nothing changed). */
  private async runStream(): Promise<EditRecord | undefined> {
    if (!this.ir || !this.streamer) return undefined;
    const t0 = performance.now();
    const { ir, issues, fresh, stream } = this.stream(this.doc, this.ir);
    const plan = planCommit(this.ir, ir);
    if (!plan.add.length && !plan.remove.length && !fresh.length) return undefined;
    let commit: CommitReport | undefined;
    try {
      commit = await this.draw(ir);
    } catch (e) {
      // nothing is drawn of this step: the session keeps its IR, says so, and the next step takes the arrivals in again
      this.issues = [
        ...this.issues.filter(kept),
        ...issues,
        issue('adapter.failed', 'error', 'render', `the stream step was not drawn: ${(e as Error)?.message ?? e}`),
      ];
      return undefined;
    }
    this.ir = ir;
    this.issues = [...this.issues.filter(kept), ...issues, ...(commit?.issues ?? [])];
    const record: EditRecord = {
      label: 'stream',
      kind: 'stream',
      resolverRuns: 0,
      cacheHits: 0,
      commit,
      totalMs: performance.now() - t0,
      stream,
    };
    this.history.push(record);
    return record;
  }

  // The session's state (ir, doc, issues, counts, history) changes only once the commit has succeeded: an edit that
  // fails leaves the session as it was, consistent with what the viewer last drew.
  private async run(kind: EditRecord['kind'], next: MesoViewSpecDoc, label: string): Promise<EditRecord> {
    const t0 = performance.now();
    let record: EditRecord;
    if (kind === 'none') record = { label, kind, resolverRuns: 0, cacheHits: 0, totalMs: 0 };
    else if (kind === 'view' && this.ir) {
      const { ir, issues, stream } = this.stream(next, updateView(next, this.ir));
      const commit = await this.draw(ir);
      this.ir = ir;
      this.issues = [...this.issues.filter(kept), ...issues, ...(commit?.issues ?? [])];
      record = { label, kind, resolverRuns: 0, cacheHits: 0, commit, totalMs: performance.now() - t0, stream };
    } else {
      const r = await compile(next, { ...this.options, cache: this.cache });
      const streamed = r.ir ? this.stream(next, r.ir) : undefined;
      const ir = streamed?.ir;
      const commit = ir ? await this.draw(ir) : undefined;
      this.counts = r.counts;
      // a document that does not compile has no IR (its errors are the issues); the viewer keeps the last one drawn
      this.ir = ir;
      this.issues = [...r.issues, ...(streamed?.issues ?? []), ...(commit?.issues ?? [])];
      record = {
        label,
        kind,
        resolverRuns: r.stats.resolverRuns,
        cacheHits: r.stats.cacheHits,
        compileMs: r.stats.ms,
        commit,
        totalMs: performance.now() - t0,
        stream: streamed?.stream,
      };
    }
    this.doc = next;
    this.history.push(record);
    return record;
  }
}
