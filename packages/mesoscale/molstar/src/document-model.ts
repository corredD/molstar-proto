/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet, SortedArray } from '@molstar/core/data/int';
import { StateSelection } from '@molstar/core/state';
import { RxEventHelper } from '@molstar/core/util/rx-event-helper';
import { UUID } from '@molstar/core/util/uuid';
import {
  applyPatch,
  classifyPatch,
  type Issue,
  issue,
  type Look,
  type MesoViewSpecDoc,
  type Op,
  parseMesoQL,
  type Patch,
  PatchFormat,
  type PatchNode,
  printData,
} from '@molstar/meso-spec/format';
import { evaluateMesoQL, lociSphere, type MesoLoci, type PlacementType } from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import { classifyEdit, type ResolveOutput, type Resolver } from '@molstar/meso-spec/runtime';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import {
  type DocumentGroupBy,
  type DocumentLooks,
  type DocumentOutline,
  documentLooks,
  documentOutline,
} from './document-tree.js';
import { placementStore } from './particle-list.js';
import { type AdapterViewer, PrismMesoAdapter } from './prism-adapter.js';
import { type EditRecord, MesoSession } from './session.js';

// The owner of the open MesoViewSpec document in a Prism viewer (prism.md §1.1, §2.3, §7): one document at a time, its
// session (runtime cache, IR, issues, counts) and its adapter. A viewer proposes, the owner commits: an open, a patch or
// a close runs inside the operation's step (the adapter's API calls through the step's `api`). Undo is Prism's: the
// document is the custom state `prism-viewer.mesoviewspec`, which a checkpoint holds by reference; a restore hands it
// back (`restore`), and the owner compiles it with its cache and adopts the restored lists, writing nothing through the
// API. Placements and resolved models are kept for the IRs of the last steps Undo can reach, the others let go.

/** The custom state's key (prism.md §7.1). */
export const MesoViewSpecStateKey = 'prism-viewer.mesoviewspec';

/** What a checkpoint, a snapshot and a session hold of the document (prism.md §7.1). */
export interface SavedMesoViewSpec {
  readonly version: 1;
  readonly doc: MesoViewSpecDoc;
  readonly revision?: string;
  /** The address it came from: relative resources resolve against it again. */
  readonly url?: string;
  /** The view shown (prism.md §4.4); none: the document's own. */
  readonly shown?: string;
}

/** Where a document came from: its address, and the files dropped with it (by name). */
export interface DocumentSource {
  readonly url?: string;
  readonly files?: ReadonlyMap<string, string | Uint8Array>;
}

export interface MesoDocumentOptions {
  readonly resolvers?: readonly Resolver<any>[];
  /** A resource's text by absolute address (the viewer's asset manager); undefined when it cannot be read. */
  readonly fetchText?: (url: string) => Promise<string | undefined>;
  /** How many steps Undo can take back (`options.ui.undoSteps`): the IRs whose placements are kept, besides the current. */
  readonly undoSteps?: number;
}

/** What one step of the owner did: the session's record, the inverse of a patch (for the record), the issues. */
export interface DocumentStep {
  readonly record?: EditRecord;
  readonly inverse?: Patch | null;
  readonly issues: readonly Issue[];
  /** Nothing changed ("it is already so"). */
  readonly unchanged?: true;
}

/** The keys one state of the document needs to be drawn again: resolved models and placement sets. */
interface Held {
  readonly doc: MesoViewSpecDoc | undefined;
  readonly cache: readonly string[];
  readonly sets: readonly string[];
}

export class MesoDocumentModel {
  doc: MesoViewSpecDoc | undefined;
  url: string | undefined;
  shown: string | undefined;
  session: MesoSession | undefined;
  readonly adapter: PrismMesoAdapter;
  /** Resolved models by key, across sessions: an Undo of Close or of an open finds them. */
  readonly cache = new Map<string, ResolveOutput>();
  /** The issues of the last restore the session does not hold (a list whose placements were missing). */
  private restoreIssues: readonly Issue[] = [];
  private files: ReadonlyMap<string, string | Uint8Array> = new Map();
  /**
   * The files dropped with each document state (the saved state cannot hold them): a restore takes back the files of
   * the document it restores, so an Undo past another open still reads its resources. A `.molx` does not keep them yet
   * (prism.md §7.1, Mol* assets: open).
   */
  private readonly filesOf = new WeakMap<MesoViewSpecDoc, ReadonlyMap<string, string | Uint8Array>>();
  /** The states Undo can reach, newest last: their keys are kept (prism.md §7.3, point 3). */
  private held: Held[] = [];
  /** The custom state's value while the document is unchanged: one object, so a checkpoint measures it once. */
  private saved: SavedMesoViewSpec | undefined;
  /** A step started and has not ended well: a restore adopts the tree again even for the same value. */
  private dirty = false;
  private readonly ev = RxEventHelper.create();
  /** The document, its counts or its looks changed (a step ended, a restore, a close): the tree reads them again. */
  readonly changed = this.ev<void>();
  /** The copies an address lights, by the drawn lists' revision: a hover allocates nothing twice. */
  private readonly lociCache = new Map<string, readonly Particle.Loci[]>();
  private lociRevision = -1;

  constructor(
    readonly viewer: AdapterViewer & { readonly plugin: PluginContext },
    readonly options: MesoDocumentOptions = {},
  ) {
    this.adapter = new PrismMesoAdapter(viewer, {
      labels: {
        copy: (population, ordinal) => (this.isInstance(population) ? population : `${population}#${ordinal}`),
        describe: (t) => this.describe(t),
      },
    });
  }

  // --- the Scene tree (prism.md §4) -----------------------------------------------------------------------------------

  /** The document's rows under a grouping (prism.md §4.1, §4.2); none without a document. */
  outline(groupBy: DocumentGroupBy = 'compartment'): DocumentOutline | undefined {
    const doc = this.doc;
    const session = this.session;
    if (!doc || !session) return undefined;
    return documentOutline(doc, session.ir, session.counts, groupBy);
  }

  /** The eyes and dots of an outline's rows under the shown view: one object while the view is the same. */
  looks(outline: DocumentOutline): DocumentLooks {
    const view = this.session?.ir?.view;
    const kept = this.looksOf.get(outline);
    if (kept && kept.view === view) return kept.looks;
    const looks = documentLooks(outline, this.session?.ir);
    this.looksOf.set(outline, { view, looks });
    return looks;
  }
  private readonly looksOf = new WeakMap<DocumentOutline, { view: unknown; looks: DocumentLooks }>();

  /**
   * The row of a drawn copy (prism.md §4.6, a MesoLocation `{set, index}`): its population's or instance's; an
   * expanded instance's copy, its part row (`p.granules/p.Vamp2`). Undefined for a list not the document's.
   */
  rowOfCopy(set: string, index: number): string | undefined {
    const path = this.adapter.locate(set, index);
    return path?.map((c) => c.population).join('/');
  }

  /** What an address picks, materialized over the IR (prism.md §4.6); undefined when it cannot be read. */
  mesoLoci(select: string): MesoLoci | undefined {
    const doc = this.doc;
    const ir = this.session?.ir;
    if (!doc || !ir || !select) return undefined;
    const q = parseMesoQL(select, {}, undefined, 'selection');
    if (!q.expr) return undefined;
    return evaluateMesoQL(q.expr, { doc, ir }).loci;
  }

  /**
   * An address's copies as one `Particle.Loci` a drawn list (prism.md §4.6): its runs on each list as drawn (an
   * expanded instance's through its expansion). Kept per address until what is drawn changes.
   */
  lociOf(select: string): readonly Particle.Loci[] {
    if (this.lociRevision !== this.adapter.revision) {
      this.lociCache.clear();
      this.lociRevision = this.adapter.revision;
    }
    const kept = this.lociCache.get(select);
    if (kept) return kept;
    const loci = this.mesoLoci(select);
    const out: Particle.Loci[] = [];
    if (loci) {
      for (const [ref, runs] of this.adapter.drawnRuns(loci)) {
        const data = drawnList(this.viewer.plugin, ref);
        if (data) out.push(Particle.Loci(data, runsToSet(runs)));
      }
    }
    this.lociCache.set(select, out);
    return out;
  }

  /** The sphere around an address's copies (Å, world: `lociSphere`, through superstructure instances): what Focus frames. */
  sphereOf(select: string): { center: [number, number, number]; radius: number } | undefined {
    const loci = this.mesoLoci(select);
    const ir = this.session?.ir;
    return loci && ir ? lociSphere(loci, ir) : undefined;
  }

  /**
   * The patch an eye makes (prism.md §5.2, §5.3): on the shown view, one look `l.eye.<n>` an address, `visible`; an eye
   * look of the same address is set and moved last (later looks win), else one is inserted last. No view: `v.prism`
   * ("Edited in Prism") is inserted with them. Undefined without a document.
   */
  eyePatch(selects: readonly string[], visible: boolean): Patch | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    return lookPatch(doc, (looks, next) => {
      const ops: Op[] = [];
      const add: Look[] = [];
      for (const select of selects) {
        const had = looks.find((l) => l.id?.startsWith('l.eye.') && l.select === select);
        if (had?.id) {
          if (had.visible !== visible) ops.push({ op: 'set', id: had.id, fields: { visible } });
          ops.push({ op: 'move', id: had.id, after: 'last' });
        } else add.push({ id: next('l.eye.'), select, visible });
      }
      return { ops, add };
    });
  }

  /**
   * Show only (prism.md §5.2): the Show-only looks (`l.only.<n>`) removed, then, for an address, two inserted last:
   * `(all)` hidden, the address shown. None: Show all again (only those looks go; the eyes' and the author's stay).
   */
  showOnlyPatch(select: string | undefined): Patch | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    return lookPatch(doc, (looks, next) => {
      const ops: Op[] = looks
        .filter((l) => l.id?.startsWith('l.only.'))
        .map((l) => ({ op: 'remove', id: l.id! }) as Op);
      const add: Look[] = select
        ? [
            { id: next('l.only.'), select: '(all)', visible: false },
            { id: next('l.only.'), select, visible: true },
          ]
        : [];
      return { ops, add };
    });
  }

  /** Whether the shown view has Show-only looks (Show all again is offered). */
  get showsOnly(): boolean {
    const doc = this.doc;
    const view = doc && shownView(doc);
    return !!view?.looks?.some((l) => l.id?.startsWith('l.only.'));
  }

  private isInstance(id: string) {
    // the session's document: an open draws its lists before `doc` is set
    return !!(this.session?.doc ?? this.doc)?.instances?.some((i) => i.id === id);
  }

  /** A type's entity and compartment, by their labels: the hover label's second line (prism.md §4.6). */
  private describe(t: PlacementType): string | undefined {
    const doc = this.session?.doc ?? this.doc;
    if (!doc) return undefined;
    const entity = findById(doc, 'entities', t.entity)?.label;
    const compartment = findById(doc, 'compartments', t.compartment)?.label;
    const parts = [entity, compartment].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  }

  get issues(): readonly Issue[] {
    return [...(this.session?.issues ?? []), ...this.restoreIssues];
  }

  /** Registers the custom state on the viewer's plugin; returns its removal. */
  register(): () => void {
    return this.viewer.plugin.state.registerCustomState(MesoViewSpecStateKey, {
      get: () => this.saved,
      set: (value) => this.restore(value),
    });
  }

  /** Opens a document in place of the one open (one at a time: prism.md §1.1), inside the caller's step. */
  async open(doc: MesoViewSpecDoc, source: DocumentSource, api: ViewerApi): Promise<DocumentStep> {
    return this.step(async () => {
      if (this.session) await this.closeLists(api);
      this.url = source.url;
      this.files = source.files ?? new Map();
      this.shown = undefined;
      this.filesOf.set(doc, this.files);
      this.session = this.newSession(doc);
      const session = this.session;
      const record = await this.adapter.bound(api, () => session.start());
      this.doc = doc;
      this.restoreIssues = [];
      return { record, issues: session.issues };
    });
  }

  /** A patch (prism.md §2): refused whole with the validation's issues, else committed with a new revision. */
  async edit(patch: Patch, api: ViewerApi, label = 'edit'): Promise<DocumentStep> {
    const doc = this.doc;
    const session = this.session;
    if (!doc || !session) return { issues: [issue('document.none', 'error', 'static', 'No document is open.')] };
    const r = applyPatch(doc, { ...patch, revision: patch.revision ?? newRevision() });
    if (r.issues.length) return { issues: r.issues, inverse: null };
    if (classifyEdit(doc, r.doc) === 'none') return { issues: [], unchanged: true };
    this.filesOf.set(r.doc, this.files);
    return this.step(async () => {
      const record = await this.adapter.bound(api, () =>
        session.edit(r.doc, `${label} (${classifyPatch(doc, patch)})`),
      );
      this.doc = r.doc;
      return { record, inverse: r.inverse, issues: session.issues };
    });
  }

  /** Closes the document: its lists go, its placements stay for an Undo (prism.md §7.3, point 3). */
  async close(api: ViewerApi): Promise<DocumentStep> {
    if (!this.session) return { issues: [], unchanged: true };
    return this.step(async () => {
      await this.closeLists(api);
      return { issues: [] };
    });
  }

  /** The document as a file: JSON (`.mesoviewspec.json`) or the S-expression (`.mesoviewspec`). */
  save(format: 'json' | 'sexpr' = 'json'): { readonly text: string; readonly filename: string } | undefined {
    if (!this.doc) return undefined;
    const base = fileBase(this.doc, this.url);
    return format === 'sexpr'
      ? { text: printData(this.doc), filename: `${base}.mesoviewspec` }
      : { text: `${JSON.stringify(this.doc, null, 2)}\n`, filename: `${base}.mesoviewspec.json` };
  }

  /**
   * The custom state's `set` (a restore: Undo, Redo, a failed step's rollback, a session or snapshot opened): the
   * document compiled with the cache, the restored lists adopted. Nothing goes through the API (prism.md §7.3, point 5).
   */
  async restore(value: unknown): Promise<void> {
    if (value === this.saved && !this.dirty) return;
    const saved = readSaved(value);
    this.dirty = false;
    if (!saved) {
      this.forget();
      return;
    }
    const same = saved.doc === this.doc && saved.url === this.url && this.session?.ir;
    this.files = this.filesOf.get(saved.doc) ?? new Map();
    this.url = saved.url;
    this.shown = saved.shown;
    this.session ??= this.newSession(saved.doc);
    if (!same) await this.session.restore(saved.doc);
    this.doc = saved.doc;
    const ir = this.session.ir;
    const { filled } = ir ? await this.adapter.adopt(ir) : { filled: [] };
    this.restoreIssues = filled.length
      ? [
          issue(
            'placements.missing',
            'info',
            'render',
            `${filled.length} list${filled.length === 1 ? '' : 's'} restored without ${filled.length === 1 ? 'its' : 'their'} placements: resolved again`,
          ),
        ]
      : [];
    this.saved = value === this.saved ? this.saved : saved;
    if (!this.held.some((h) => h.doc === saved.doc)) this.hold();
    this.changed.next();
  }

  /** Lets go of the session (the owner's viewer goes); the placements go with the plugin. */
  dispose() {
    this.session?.dispose();
    this.session = undefined;
    this.ev.dispose();
  }

  private newSession(doc: MesoViewSpecDoc) {
    return new MesoSession(
      doc,
      { resolvers: this.options.resolvers ?? DefaultResolvers, load: (id) => this.load(id), cache: this.cache },
      this.adapter,
    );
  }

  /** A step of the owner: marked dirty until it ends well, then its keys held and the saved value made again. */
  private async step(work: () => Promise<DocumentStep>): Promise<DocumentStep> {
    this.dirty = true;
    const out = await work();
    this.saved = this.doc ? savedOf(this.doc, this.url, this.shown) : undefined;
    this.hold();
    this.dirty = false;
    this.changed.next();
    return out;
  }

  private async closeLists(api: ViewerApi) {
    await this.adapter.bound(api, () => this.adapter.clear());
    this.session?.dispose();
    this.session = undefined;
    this.doc = undefined;
    this.restoreIssues = [];
  }

  /** The document is gone from the restored state: the owner's too, with no write (the tree has no lists). */
  private forget() {
    this.session?.dispose();
    this.session = undefined;
    this.doc = undefined;
    this.url = undefined;
    this.shown = undefined;
    this.saved = undefined;
    this.restoreIssues = [];
    this.adapter.forget();
    this.changed.next();
  }

  /**
   * Keeps the keys of the current state and of the last `undoSteps` (prism.md §7.3, point 3); the store's and the
   * cache's other entries go. Older checkpoints are too old to undo (sequence.md §7.4), so nothing reaches them.
   */
  private hold() {
    this.held.push({
      doc: this.doc,
      cache: this.session?.cacheKeys ?? [],
      sets: this.session ? this.adapter.keys() : [],
    });
    const keep = (this.options.undoSteps ?? 10) + 1;
    if (this.held.length > keep) this.held.splice(0, this.held.length - keep);
    const cache = new Set(this.held.flatMap((h) => h.cache));
    const sets = new Set(this.held.flatMap((h) => h.sets));
    for (const k of [...this.cache.keys()]) if (!cache.has(k)) this.cache.delete(k);
    const store = placementStore(this.viewer.plugin);
    for (const k of [...store.keys()]) if (!sets.has(k)) store.delete(k);
  }

  /**
   * A resource's content (prism.md §3): a file dropped with the document, by name; else its address resolved against
   * the document's (`fixture://x` as the CLI reads it: `fixtures/x` beside the document). An accession alone is not
   * resolved here: unavailable, the model fails with its cause and the rest is drawn.
   */
  private async load(id: string): Promise<unknown> {
    const doc = this.session?.doc ?? this.doc;
    const uri = doc?.resources?.find((r) => r.id === id)?.uri;
    if (!uri) return undefined;
    const path = uri.startsWith('fixture://') ? `fixtures/${uri.slice('fixture://'.length)}` : uri;
    const dropped = this.files.get(path.slice(path.lastIndexOf('/') + 1));
    if (dropped !== undefined) return typeof dropped === 'string' ? dropped : new TextDecoder().decode(dropped);
    let href: string;
    try {
      href = new URL(path, this.url).href;
    } catch {
      return undefined; // relative, and the document has no address (data, or a file dropped alone)
    }
    return this.options.fetchText?.(href);
  }
}

/** The view looks are written to: the one the runtime shows (`session.view ?? views[0]`, prism.md §4.4). */
function shownView(doc: MesoViewSpecDoc) {
  const id = doc.session?.view;
  return (id !== undefined ? doc.views?.find((v) => v.id === id) : undefined) ?? doc.views?.[0];
}

/**
 * A look patch on the shown view: `edit` gives the ops on its looks and the looks to insert last, with fresh ids from
 * `next(prefix)` (`l.eye.3`: past every id of the document's looks). No view: `v.prism` with the looks. Undefined when
 * there is nothing to do.
 */
function lookPatch(
  doc: MesoViewSpecDoc,
  edit: (looks: readonly Look[], next: (prefix: string) => string) => { ops: Op[]; add: Look[] },
): Patch | undefined {
  const view = shownView(doc);
  const taken = new Set<string>();
  for (const v of doc.views ?? []) for (const l of v.looks ?? []) if (l.id) taken.add(l.id);
  const counters = new Map<string, number>();
  const next = (prefix: string) => {
    let n = counters.get(prefix) ?? 1;
    while (taken.has(`${prefix}${n}`)) n++;
    counters.set(prefix, n + 1);
    taken.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };
  const { ops, add } = edit(view?.looks ?? [], next);
  if (view)
    for (const node of add)
      ops.push({ op: 'insert', node: { ...node } as PatchNode, parent: view.id, list: 'looks', after: 'last' });
  else if (add.length) {
    ops.push({
      op: 'insert',
      node: { id: PrismView, label: 'Edited in Prism', looks: add },
      parent: 'views',
      after: 'last',
    });
  }
  return ops.length ? { format: PatchFormat, ops } : undefined;
}

/** The view the first look edit makes when a document has none (prism.md §4.4). */
export const PrismView = 'v.prism';

/** A node of a document section by id (entities and compartments also inside superstructures). */
function findById(doc: MesoViewSpecDoc, section: 'entities' | 'compartments', id: string) {
  const own = (doc[section] as readonly { id: string; label?: string }[]).find((x) => x.id === id);
  if (own) return own;
  for (const ss of doc.superstructures ?? [])
    for (const x of (ss[section] ?? []) as readonly { id: string; label?: string }[]) if (x.id === id) return x;
  return undefined;
}

/** The list a representation draws (its source: decorated or not), else the list's own data. */
function drawnList(plugin: PluginContext, ref: string): ParticleList | undefined {
  const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
  const repr = plugin.state.data.select(q)[0]?.obj;
  return (
    (repr?.data.sourceData as ParticleList | undefined) ??
    (plugin.state.data.cells.get(ref)?.obj?.data as ParticleList | undefined)
  );
}

/** Runs `[s, e, …]` as an ordered set of copy indices: one run a range, else the indices. */
function runsToSet(runs: readonly number[]): OrderedSet {
  if (runs.length === 2) return OrderedSet.ofBounds(runs[0], runs[1]);
  let n = 0;
  for (let i = 0; i < runs.length; i += 2) n += runs[i + 1] - runs[i];
  const out = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < runs.length; i += 2) for (let j = runs[i]; j < runs[i + 1]; j++) out[k++] = j;
  return OrderedSet.ofSortedArray(SortedArray.ofSortedArray(out));
}

/** A revision id for a committed patch. */
function newRevision() {
  return `r.${UUID.create22()}`;
}

function savedOf(doc: MesoViewSpecDoc, url: string | undefined, shown: string | undefined): SavedMesoViewSpec {
  return {
    version: 1,
    doc,
    ...(doc.revision !== undefined ? { revision: doc.revision } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(shown !== undefined ? { shown } : {}),
  };
}

/** The saved value, when it is one this version reads (another version, or none: no document). */
function readSaved(value: unknown): SavedMesoViewSpec | undefined {
  const v = value as Partial<SavedMesoViewSpec> | undefined;
  if (!v || v.version !== 1 || !v.doc || typeof v.doc !== 'object') return undefined;
  return v as SavedMesoViewSpec;
}

/** A file name for the document: its address's, else its title's, else `document`. */
function fileBase(doc: MesoViewSpecDoc, url: string | undefined) {
  const fromUrl = url
    ?.split(/[?#]/)[0]
    .split('/')
    .pop()
    ?.replace(/\.mesoviewspec(\.json)?$/i, '');
  const title = doc.metadata?.title
    ?.trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return fromUrl || title || 'document';
}
