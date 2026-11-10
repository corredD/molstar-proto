/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Issue, issue, type MesoViewSpecDoc } from '@molstar/meso-spec/format';
import type { IR } from '@molstar/meso-spec/ir';
import {
  classifyEdit,
  type CommitReport,
  compile,
  type CompileResult,
  planCommit,
  type RendererAdapter,
  type ResolveOutput,
  type RuntimeOptions,
  type StreamOptions,
  type StreamPlan,
  type StreamStats,
  TileStreamer,
  updateView,
} from '@molstar/meso-spec/runtime';

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
  readonly kind: 'initial' | 'none' | 'view' | 'model' | 'stream' | 'restore';
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
  /**
   * The resolved models by key, when the caller keeps them beyond the session (a document's owner: an Undo of Close
   * opens it again from them) and lets them go itself (prism.md §7.3, point 3). Absent: the session's own.
   */
  readonly cache?: Map<string, ResolveOutput>;
};

export class MesoSession {
  doc: MesoViewSpecDoc;
  ir: IR | undefined;
  issues: readonly Issue[] = [];
  counts: CompileResult['counts'] = {};
  readonly history: EditRecord[] = [];
  private readonly cache: Map<string, ResolveOutput>;
  /** The cache keys the last compile read (superstructures' included): what a caller bounding the cache keeps. */
  cacheKeys: readonly string[] = [];
  /** The edit in flight, or the last one: the next one starts after it (a failure does not stop the queue). */
  private pending: Promise<unknown> = Promise.resolve();
  readonly streamer: TileStreamer | undefined;
  /** A stream step is queued and has not started: loads that settle meanwhile join it. */
  private streamQueued = false;
  /**
   * The view shown (a person's pick, prism.md §4.4); none, or one the document lacks: its own (`session.view`, else the
   * first). Every derivation (an edit, a stream step, a restore) takes it, so nothing snaps back to the document's.
   */
  view: string | undefined;

  constructor(
    doc: MesoViewSpecDoc,
    private readonly options: SessionOptions,
    private readonly adapter?: RendererAdapter,
  ) {
    this.doc = doc;
    const { stream, cache, ...rest } = options;
    this.options = rest;
    this.cache = cache ?? new Map();
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

  /**
   * Shows a view (prism.md §4.4): the same document, its view derived again over the same IR and drawn. The view is
   * taken when the step's turn comes, so an edit queued before it derives with the view shown then. A draw that fails
   * midway draws the IR before it again (Ludo, 2026-11-09; best effort: a second failure is let go), so the screen
   * agrees with the session's view.
   */
  show(view: string | undefined): Promise<EditRecord> {
    return this.queue(async () => {
      const was = this.view;
      this.view = view;
      try {
        return await this.run('view', this.doc, `view ${view ?? '(the document’s)'}`);
      } catch (e) {
        this.view = was;
        if (this.ir) await this.adapter?.commit(this.ir).catch(() => {});
        throw e;
      }
    });
  }

  /**
   * A restore (Undo, Redo, a session opened): the document compiled with the cache and taken as the one drawn, with no
   * commit; the caller's adapter adopts the IR from the restored state (prism.md §7.3, point 5). From a state Undo can
   * reach every model is a cache hit; from a session on a fresh page, a cold resolution. `view` is the view shown with
   * the restored state (prism.md §7.4).
   */
  restore(doc: MesoViewSpecDoc, view: string | undefined): Promise<EditRecord> {
    return this.queue(async () => {
      const t0 = performance.now();
      this.view = view;
      const r = await compile(doc, { ...this.options, cache: this.cache, view });
      this.doc = doc;
      this.ir = r.ir;
      this.counts = r.counts;
      this.issues = r.issues;
      this.cacheKeys = r.stats.models.map((m) => m.key);
      const record: EditRecord = {
        label: 'restore',
        kind: 'restore',
        resolverRuns: r.stats.resolverRuns,
        cacheHits: r.stats.cacheHits,
        compileMs: r.stats.ms,
        totalMs: performance.now() - t0,
      };
      this.history.push(record);
      return record;
    });
  }

  /**
   * A restore of the same document with another view shown (Undo past a view shown, prism.md §7.4): its view derived
   * again over the IR, nothing compiled, nothing committed (the caller's adapter adopts it).
   */
  restoreView(view: string | undefined): Promise<EditRecord> {
    return this.queue(async () => {
      const t0 = performance.now();
      this.view = view;
      if (this.ir) this.ir = updateView(this.doc, this.ir, view);
      const record: EditRecord = {
        label: 'restore',
        kind: 'restore',
        resolverRuns: 0,
        cacheHits: 0,
        totalMs: performance.now() - t0,
      };
      this.history.push(record);
      return record;
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
      ir: s ? updateView(doc, s.ir, this.view) : ir,
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
      const { ir, issues, stream } = this.stream(next, updateView(next, this.ir, this.view));
      const commit = await this.draw(ir);
      this.ir = ir;
      this.issues = [...this.issues.filter(kept), ...issues, ...(commit?.issues ?? [])];
      record = { label, kind, resolverRuns: 0, cacheHits: 0, commit, totalMs: performance.now() - t0, stream };
    } else {
      const r = await compile(next, { ...this.options, cache: this.cache, view: this.view });
      const streamed = r.ir ? this.stream(next, r.ir) : undefined;
      const ir = streamed?.ir;
      const commit = ir ? await this.draw(ir) : undefined;
      this.counts = r.counts;
      this.cacheKeys = r.stats.models.map((m) => m.key);
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
