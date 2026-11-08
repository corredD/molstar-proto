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
// leaves a record of what it cost, which the stories show and the tests check.

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

  constructor(
    doc: MesoViewSpecDoc,
    private readonly options: Omit<RuntimeOptions, 'cache'>,
    private readonly adapter?: RendererAdapter,
  ) {
    this.doc = doc;
  }

  async start(): Promise<EditRecord> {
    return this.run('initial', this.doc, 'open');
  }

  async edit(next: MesoViewSpecDoc, label: string): Promise<EditRecord> {
    return this.run(classifyEdit(this.doc, next), next, label);
  }

  private async run(kind: EditRecord['kind'], next: MesoViewSpecDoc, label: string): Promise<EditRecord> {
    const t0 = performance.now();
    let record: EditRecord;
    if (kind === 'none') record = { label, kind, resolverRuns: 0, cacheHits: 0, totalMs: 0 };
    else if (kind === 'view' && this.ir) {
      this.ir = updateView(next, this.ir);
      const commit = await this.adapter?.commit(this.ir);
      record = { label, kind, resolverRuns: 0, cacheHits: 0, commit, totalMs: performance.now() - t0 };
    } else {
      const r = await compile(next, { ...this.options, cache: this.cache });
      this.issues = r.issues;
      this.counts = r.counts;
      if (r.ir) this.ir = r.ir;
      const commit = r.ir ? await this.adapter?.commit(r.ir) : undefined;
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
