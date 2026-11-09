/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '@molstar/meso-spec/format/doc';
import type { Issue } from '@molstar/meso-spec/format/issues';
import type { IR } from '@molstar/meso-spec/ir/ir';
import type { CommitReport, RendererAdapter } from '@molstar/meso-spec/runtime/adapter';
import type { ResolveOutput } from '@molstar/meso-spec/runtime/resolver';
import {
  classifyEdit,
  compile,
  type CompileResult,
  type RuntimeOptions,
  updateView,
} from '@molstar/meso-spec/runtime/runtime';

// A session (design.md §5, §6.1): one document, edited, with the runtime's cache and an adapter. An edit is classified
// first: a view edit (looks, camera, selection) derives a new view over the same IR and commits it; a model edit
// compiles with the session's cache (only the models whose projection changed resolve) and commits by key. Each edit
// leaves a record of what it cost, which the stories show and the tests check. Edits run one at a time, in the order
// they were asked for: two in flight would diff against the same previous IR (a list orphaned), and an edit given as a
// function of the document is built when its turn comes, so two clicks compose instead of the last one winning.

export interface EditRecord {
  readonly label: string;
  readonly kind: 'initial' | 'none' | 'view' | 'model';
  readonly resolverRuns: number;
  readonly cacheHits: number;
  readonly compileMs?: CompileResult['stats']['ms'];
  readonly commit?: CommitReport;
  readonly totalMs: number;
}

export class MesoSession {
  doc: MesoViewSpecDoc;
  ir: IR | undefined;
  issues: readonly Issue[] = [];
  counts: CompileResult['counts'] = {};
  readonly history: EditRecord[] = [];
  private readonly cache = new Map<string, ResolveOutput>();
  /** The edit in flight, or the last one: the next one starts after it (a failure does not stop the queue). */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    doc: MesoViewSpecDoc,
    private readonly options: Omit<RuntimeOptions, 'cache'>,
    private readonly adapter?: RendererAdapter,
  ) {
    this.doc = doc;
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

  // The session's state (ir, doc, issues, counts, history) changes only once the commit has succeeded: an edit that
  // fails leaves the session as it was, consistent with what the viewer last drew.
  private async run(kind: EditRecord['kind'], next: MesoViewSpecDoc, label: string): Promise<EditRecord> {
    const t0 = performance.now();
    let record: EditRecord;
    if (kind === 'none') record = { label, kind, resolverRuns: 0, cacheHits: 0, totalMs: 0 };
    else if (kind === 'view' && this.ir) {
      const ir = updateView(next, this.ir);
      const commit = await this.adapter?.commit(ir);
      this.ir = ir;
      this.issues = [...this.issues.filter((i) => i.phase !== 'render'), ...(commit?.issues ?? [])];
      record = { label, kind, resolverRuns: 0, cacheHits: 0, commit, totalMs: performance.now() - t0 };
    } else {
      const r = await compile(next, { ...this.options, cache: this.cache });
      const commit = r.ir ? await this.adapter?.commit(r.ir) : undefined;
      this.counts = r.counts;
      if (r.ir) this.ir = r.ir;
      this.issues = [...r.issues, ...(commit?.issues ?? [])];
      record = {
        label,
        kind,
        resolverRuns: r.stats.resolverRuns,
        cacheHits: r.stats.cacheHits,
        compileMs: r.stats.ms,
        commit,
        totalMs: performance.now() - t0,
      };
    }
    this.doc = next;
    this.history.push(record);
    return record;
  }
}
