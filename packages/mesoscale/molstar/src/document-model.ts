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
  indexDoc,
  type Issue,
  issue,
  LengthToAngstrom,
  type Look,
  type MesoViewSpecDoc,
  type Op,
  parseMesoQL,
  type Patch,
  PatchFormat,
  type PatchNode,
  printData,
} from '@molstar/meso-spec/format';
import {
  evaluateMesoQL,
  intersectRuns,
  lociSphere,
  type MesoLoci,
  type PlacementType,
  subtractRuns,
  unionRuns,
} from '@molstar/meso-spec/ir';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers';
import {
  classifyEdit,
  frameMatrices,
  type ResolveOutput,
  type Resolver,
  shownViewOf,
} from '@molstar/meso-spec/runtime';
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

/** A tour playing (prism.md §4.4): its id, the step shown (1-based) of how many, the step's caption. */
export interface TourPlaying {
  readonly tour: string;
  readonly step: number;
  readonly of: number;
  readonly caption?: string;
}

/** The Views row's content (prism.md §4.4). */
export interface DocumentViews {
  readonly views: readonly { readonly id: string; readonly label: string; readonly description?: string }[];
  readonly tours: readonly { readonly id: string; readonly label: string; readonly steps: number }[];
  /** The view shown; none: the document has no view. */
  readonly shown?: string;
  /** The view the saved document opens with (`session.view`). */
  readonly opensWith?: string;
  readonly playing?: TourPlaying;
}

function sameViews(a: DocumentViews, b: DocumentViews): boolean {
  const same = <T>(x: readonly T[], y: readonly T[], eq: (p: T, q: T) => boolean) =>
    x.length === y.length && x.every((p, i) => eq(p, y[i]));
  return (
    a.shown === b.shown &&
    a.opensWith === b.opensWith &&
    a.playing === b.playing &&
    same(a.views, b.views, (p, q) => p.id === q.id && p.label === q.label && p.description === q.description) &&
    same(a.tours, b.tours, (p, q) => p.id === q.id && p.label === q.label && p.steps === q.steps)
  );
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
  /** The view shown was shown again: its camera set back, nothing else drawn. */
  readonly again?: true;
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
    return lookPatch(doc, this.shown, (looks, next) => {
      const ops: Op[] = [];
      const add: Look[] = [];
      // the eye looks by address, once (a drag gives many rows)
      const eyes = new Map<string, Look>();
      for (const l of looks) if (l.id?.startsWith('l.eye.')) eyes.set(l.select, l);
      for (const select of new Set(selects)) {
        const had = eyes.get(select);
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
    return lookPatch(doc, this.shown, (looks, next) => {
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

  /**
   * The patch a style makes (prism.md §5.1, §5.3: `mesoscale.style`, colors, imports): on the shown view, one look
   * `l.style.<n>` an address. A style look of the same address is set and moved last (later looks win), else one is
   * inserted last; `null` removes a field (a color back to the default); `reset` removes the look. The eyes', Show
   * only's and the author's looks are never touched. No view: `v.prism` is inserted. No patch when nothing changes.
   *
   * A color back to the default, or a reset, reaches the style looks at other addresses too (§5.1: theme sets "the
   * looks' color to null"): a look whose copies all lie within the change's (a population's look, under a theme over
   * its list) loses its color or goes. A look that also reaches other copies (a compartment's, under one list's theme)
   * is left as it is and named in `blocked`: clearing it would change copies the person did not pick.
   */
  stylePatch(styles: readonly { readonly select: string; readonly change: LookChange }[]): {
    readonly patch?: Patch;
    readonly blocked: readonly string[];
  } {
    const doc = this.doc;
    const blocked: string[] = [];
    if (!doc) return { blocked };
    const patch = lookPatch(doc, this.shown, (looks, next) => {
      const ops: Op[] = [];
      const add: Look[] = [];
      const mine = new Map<string, Look>();
      for (const l of looks) if (l.id?.startsWith('l.style.')) mine.set(l.select, l);
      // one change an address: the last given wins
      const bySelect = new Map<string, LookChange>();
      for (const s of styles) bySelect.set(s.select, { ...bySelect.get(s.select), ...s.change });
      this.clearOthers(mine, bySelect, ops, blocked);
      for (const [select, change] of bySelect) {
        const had = mine.get(select);
        if (change.reset) {
          if (had?.id) ops.push({ op: 'remove', id: had.id });
          continue;
        }
        const fields = lookFields(change);
        if (had?.id) {
          const was = had as unknown as Record<string, unknown>;
          const set = Object.fromEntries(Object.entries(fields).filter(([k, v]) => was[k] !== (v ?? undefined)));
          // a style look left saying nothing (its color back to the default, nothing else) goes
          const left = LookFields.filter((k) => (k in set ? set[k] !== null : was[k] !== undefined));
          if (!left.length) {
            ops.push({ op: 'remove', id: had.id });
            continue;
          }
          if (Object.keys(set).length) ops.push({ op: 'set', id: had.id, fields: set });
          if (Object.keys(set).length || looks.at(-1) !== had) ops.push({ op: 'move', id: had.id, after: 'last' });
        } else {
          const stated = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
          if (Object.keys(stated).length) add.push({ id: next('l.style.'), select, ...stated });
        }
      }
      return { ops, add };
    });
    return blocked.length ? { blocked } : { patch, blocked };
  }

  /**
   * The style looks at other addresses a clear reaches (`stylePatch`): those within the cleared copies lose their color
   * (or go, when nothing else is left) or, under a reset, go; those reaching beyond are `blocked`.
   */
  private clearOthers(
    mine: ReadonlyMap<string, Look>,
    bySelect: ReadonlyMap<string, LookChange>,
    ops: Op[],
    blocked: string[],
  ) {
    const cleared = (test: (c: LookChange) => boolean) => {
      const selects = [...bySelect].filter(([, c]) => test(c)).map(([s]) => s);
      if (!selects.length) return undefined;
      const all = new Map<string, number[]>();
      for (const s of selects)
        for (const [set, runs] of this.mesoLoci(s)?.copies ?? []) all.set(set, unionRuns(all.get(set) ?? [], runs));
      return all;
    };
    const resets = cleared((c) => !!c.reset);
    const colors = cleared((c) => !c.reset && c.color === null);
    if (!resets && !colors) return;
    for (const [select, look] of mine) {
      if (bySelect.has(select) || !look.id) continue;
      const reaches = (by: ReadonlyMap<string, readonly number[]> | undefined) => {
        if (!by) return 'none' as const;
        const loci = this.mesoLoci(select);
        if (!loci) return 'none' as const;
        let some = false;
        let beyond = false;
        for (const [set, runs] of loci.copies) {
          const within = by.get(set) ?? [];
          if (intersectRuns(runs, within).length) some = true;
          if (subtractRuns(runs, within).length) beyond = true;
        }
        return !some ? ('none' as const) : beyond ? ('beyond' as const) : ('within' as const);
      };
      const r = reaches(resets);
      if (r === 'within') {
        ops.push({ op: 'remove', id: look.id });
        continue;
      }
      if (r === 'beyond') {
        blocked.push(select);
        continue;
      }
      if (look.color === undefined) continue;
      const c = reaches(colors);
      if (c === 'beyond') blocked.push(select);
      if (c !== 'within') continue;
      const left = LookFields.filter(
        (k) => k !== 'color' && (look as unknown as Record<string, unknown>)[k] !== undefined,
      );
      ops.push(left.length ? { op: 'set', id: look.id, fields: { color: null } } : { op: 'remove', id: look.id });
    }
  }

  /** Whether the shown view has Show-only looks (Show all again is offered). */
  get showsOnly(): boolean {
    const doc = this.doc;
    const view = doc && shownViewOf(doc, this.shown);
    return !!view?.looks?.some((l) => l.id?.startsWith('l.only.'));
  }

  private isInstance(id: string) {
    // the session's document: an open draws its lists before `doc` is set
    const doc = this.session?.doc ?? this.doc;
    return !!doc && indexOf(doc).instances.has(id);
  }

  /** A type's entity and compartment, by their labels: the hover label's second line (prism.md §4.6). */
  private describe(t: PlacementType): string | undefined {
    const doc = this.session?.doc ?? this.doc;
    if (!doc) return undefined;
    const index = indexOf(doc);
    const parts = [index.entities.get(t.entity), index.compartments.get(t.compartment)].filter(Boolean);
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

  /**
   * Shows a view (prism.md §4.4: `mesoviewspec.view`, no step): its looks and camera drawn through `api` (the run's, so
   * the writes are part of it and no change outside the API), the document unchanged. The saved value is made again
   * with the view shown, so the next step's checkpoint notes it and Undo shows it again (§7.4). No keys are held: a
   * show is no step of the window Undo reaches.
   */
  async show(view: string, api: ViewerApi): Promise<DocumentStep> {
    const doc = this.doc;
    const session = this.session;
    if (!doc || !session) return { issues: [issue('document.none', 'error', 'static', 'No document is open.')] };
    if (!doc.views?.some((v) => v.id === view))
      return { issues: [issue('view.unknown', 'error', 'static', `The document has no view ${view}.`)] };
    // the view shown, shown again (Ludo, 2026-11-09): its camera set back, the person's moves undone; nothing redrawn
    if (this.shownId === view) {
      this.adapter.applyCamera();
      return { issues: [], again: true };
    }
    try {
      const record = await this.adapter.bound(api, () => session.show(view));
      this.shown = view;
      this.saved = savedOf(doc, this.url, this.shown);
      // the keys a view's expansions add (none today: a view changes looks, not sets) kept with the current state's
      const last = this.held.at(-1);
      if (last)
        this.held[this.held.length - 1] = { ...last, sets: [...new Set([...last.sets, ...this.adapter.keys()])] };
      return { record, issues: session.issues };
    } finally {
      this.changed.next();
    }
  }

  /** The id of the view shown (prism.md §4.4): the one picked while the document has it, else its own; none: no view. */
  get shownId(): string | undefined {
    return this.doc ? shownViewOf(this.doc, this.shown)?.id : undefined;
  }

  /**
   * New view from here (prism.md §4.4): a view inserted last with the camera `here` (Å, the world frame) in the
   * document's unit, and the view shown's looks copied with new ids (an edit's kind kept: `l.style.`, `l.eye.`,
   * `l.only.`; the author's `l.copy.`). Its id `v.view.<n>`, its label `View <n>` unless given.
   */
  newViewPatch(here: CameraHere, label?: string): { readonly patch: Patch; readonly id: string } | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    const n = freshNumber(doc, 'v.view.');
    const id = `v.view.${n}`;
    const next = lookIds(doc);
    const looks = (shownViewOf(doc, this.shown)?.looks ?? []).map((l) => ({
      ...l,
      id: next(LookKinds.find((k) => l.id?.startsWith(k)) ?? 'l.copy.'),
    }));
    const node = {
      id,
      label: label?.trim() || `View ${n}`,
      camera: cameraIn(doc, undefined, here),
      ...(looks.length ? { looks } : {}),
    };
    return { id, patch: { format: PatchFormat, ops: [{ op: 'insert', node, parent: 'views', after: 'last' }] } };
  }

  /**
   * Update camera (prism.md §4.4): the view shown's camera set to `here` (Å, the world frame), numeric, in its frame
   * (a view with a frame: through the frame's inverse) or the document's unit. The whole camera is replaced (Ludo,
   * 2026-11-09): a semantic one's `focus`, `from`, `framing` go; the fov is `here`'s (the view's when `here` has none)
   * and the view's `transition` is kept. Undefined without a view shown.
   */
  updateCameraPatch(here: CameraHere): Patch | undefined {
    const doc = this.doc;
    const view = doc && shownViewOf(doc, this.shown);
    if (!doc || !view) return undefined;
    const at = cameraIn(doc, view, here);
    if (!at) return undefined;
    const was = view.camera;
    const fov = at.fov ?? was?.fov;
    const camera = {
      ...at,
      ...(fov !== undefined ? { fov } : {}),
      ...(was?.transition !== undefined ? { transition: was.transition } : {}),
    };
    return { format: PatchFormat, ops: [{ op: 'set', id: view.id, fields: { camera } }] };
  }

  /**
   * Add label (prism.md §5.2): an annotation `{id: an.<n>, target: select, text}` inserted last in the view shown's
   * annotations; no view: `v.prism` with it. Its id past every id of the document.
   */
  annotationPatch(select: string, text: string): Patch | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    const node = { id: `an.${freshNumber(doc, 'an.')}`, target: select, text };
    const view = shownViewOf(doc, this.shown);
    const op: Op = view
      ? { op: 'insert', node, parent: view.id, list: 'annotations', after: 'last' }
      : {
          op: 'insert',
          node: { id: PrismView, label: 'Edited in Prism', annotations: [node] },
          parent: 'views',
          after: 'last',
        };
    return { format: PatchFormat, ops: [op] };
  }

  /**
   * The view shown picked as it is, when none is (the document's own shown): an edit of `session.view` then leaves the
   * screen as it is (Open with this view is what the file opens with, not what is shown).
   */
  pin() {
    const id = this.shownId;
    if (this.shown !== undefined || id === undefined) return;
    this.shown = id;
    if (this.session) this.session.view = id;
  }

  /** Open with this view (prism.md §4.4): `session.view` set, what the saved document opens with. */
  openWithPatch(view: string): Patch | undefined {
    const doc = this.doc;
    if (!doc || doc.session?.view === view) return undefined;
    return { format: PatchFormat, ops: [{ op: 'set', id: 'document', fields: { session: { ...doc.session, view } } }] };
  }

  /** The tour playing and where it is (`mesoviewspec.tour.play`); none: no tour plays. */
  get playing(): TourPlaying | undefined {
    return this.#playing;
  }
  set playing(p: TourPlaying | undefined) {
    if (p === this.#playing) return;
    this.#playing = p;
    this.changed.next();
  }
  #playing: TourPlaying | undefined;

  /**
   * The Views row (prism.md §4.4): the document's views and tours, the view shown, the one it opens with, the tour
   * playing. The same object while none of them changed (a look edit makes new views, not new rows).
   */
  views(): DocumentViews | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    const next: DocumentViews = {
      views: (doc.views ?? []).map((v) => ({
        id: v.id,
        label: v.label ?? v.id,
        ...(v.description ? { description: v.description } : {}),
      })),
      tours: (doc.tours ?? []).map((t) => ({ id: t.id, label: t.label ?? t.id, steps: t.steps.length })),
      ...(this.shownId !== undefined ? { shown: this.shownId } : {}),
      ...(doc.session?.view !== undefined ? { opensWith: doc.session.view } : {}),
      ...(this.#playing ? { playing: this.#playing } : {}),
    };
    if (this.#views && sameViews(this.#views, next)) return this.#views;
    this.#views = next;
    return next;
  }
  #views: DocumentViews | undefined;

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
    // the view noted with the checkpoint shown again (prism.md §7.4): the restored tree already draws its looks; the
    // camera is view state, which no checkpoint holds, and stays where it is
    if (!same) await this.session.restore(saved.doc, saved.shown);
    else if (this.session.view !== saved.shown) await this.session.restoreView(saved.shown);
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
    // a view picked that the edit removed: none picked, the document's own shown (prism.md §4.4)
    if (this.shown !== undefined && !this.doc?.views?.some((v) => v.id === this.shown)) {
      this.shown = undefined;
      if (this.session) this.session.view = undefined;
    }
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

/**
 * A look patch on the view shown (prism.md §4.4: `shown` when the document has it, else its own): `edit` gives the ops
 * on its looks and the looks to insert last, with fresh ids from `next(prefix)` (`l.eye.3`: past every id of the
 * document's looks). No view: `v.prism` with the looks. Undefined when there is nothing to do.
 */
function lookPatch(
  doc: MesoViewSpecDoc,
  shown: string | undefined,
  edit: (looks: readonly Look[], next: (prefix: string) => string) => { ops: Op[]; add: Look[] },
): Patch | undefined {
  const view = shownViewOf(doc, shown);
  const { ops, add } = edit(view?.looks ?? [], lookIds(doc));
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

/** Fresh look ids by prefix (`l.eye.3`): past every id of the document's looks, none given twice. */
function lookIds(doc: MesoViewSpecDoc): (prefix: string) => string {
  const taken = new Set<string>();
  for (const v of doc.views ?? []) for (const l of v.looks ?? []) if (l.id) taken.add(l.id);
  const counters = new Map<string, number>();
  return (prefix: string) => {
    let n = counters.get(prefix) ?? 1;
    while (taken.has(`${prefix}${n}`)) n++;
    counters.set(prefix, n + 1);
    taken.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };
}

/** The first `n` whose `<prefix><n>` is no id of the document (one namespace: format.md, `indexDoc`). */
function freshNumber(doc: MesoViewSpecDoc, prefix: string): number {
  const taken = indexDoc(doc).kinds;
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return n;
}

/** The look ids an edit writes, by kind (prism.md §5.3): a copy keeps its kind. */
const LookKinds = ['l.style.', 'l.eye.', 'l.only.'] as const;

/** A camera where the person stands (Å, the world frame): the canvas's. */
export interface CameraHere {
  readonly position: readonly number[];
  readonly target: readonly number[];
  readonly up: readonly number[];
  /** The vertical field of view (degrees, as the format's `fov`). */
  readonly fov?: number;
}

/**
 * `here` as a view's numeric camera (format.md: read in its view's frame, else the document's unit), its fov with it
 * when known. Undefined when the frame's matrix cannot be inverted.
 */
function cameraIn(
  doc: MesoViewSpecDoc,
  view: { readonly frame?: string } | undefined,
  here: CameraHere,
): { position: number[]; target: number[]; up: number[]; fov?: number } | undefined {
  const at = placeCamera(doc, view, here);
  return at && here.fov !== undefined ? { ...at, fov: Math.round(here.fov * 100) / 100 } : at;
}

/**
 * `here`'s position, target and up in a view's frame: a frame's matrix inverted (its points and directions), else Å
 * into the document's unit. Rounded to a thousandth; the up made unit. Undefined when the matrix cannot be inverted.
 */
function placeCamera(
  doc: MesoViewSpecDoc,
  view: { readonly frame?: string } | undefined,
  here: CameraHere,
): { position: number[]; target: number[]; up: number[] } | undefined {
  const unit = doc.units?.length ?? 'nm';
  const M = view?.frame ? frameMatrices(doc, unit).get(view.frame) : undefined;
  const round = (x: number) => Math.round(x * 1000) / 1000 + 0;
  const unitUp = (v: readonly number[]) => {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((x) => round(x / n));
  };
  if (!M) {
    const f = LengthToAngstrom[unit];
    return {
      position: here.position.map((x) => round(x / f)),
      target: here.target.map((x) => round(x / f)),
      up: unitUp(here.up),
    };
  }
  // A (3×3, column-major in M) and t: world = A·p + t, so p = A⁻¹·(world − t)
  const a = (r: number, c: number) => M[4 * c + r];
  const det =
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  if (!det) return undefined;
  const inv = [
    [
      a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1),
      a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2),
      a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1),
    ],
    [
      a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2),
      a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0),
      a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2),
    ],
    [
      a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0),
      a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1),
      a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0),
    ],
  ].map((row) => row.map((x) => x / det));
  const turn = (v: readonly number[]) => inv.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const place = (p: readonly number[]) => turn([p[0] - M[12], p[1] - M[13], p[2] - M[14]]).map(round);
  return { position: place(here.position), target: place(here.target), up: unitUp(turn(here.up)) };
}

/** A style's change to a look: absent fields kept, null removes one (a color back to the default), reset drops it. */
export interface LookChange {
  readonly visible?: boolean;
  /** `#rrggbb` */
  readonly color?: string | null;
  readonly transparency?: number | null;
  readonly emissive?: number | null;
  readonly reset?: boolean;
}

/** What a look can say besides its address. */
const LookFields = ['visible', 'color', 'transparency', 'emissive', 'representation'] as const;

/** A change's look fields: those given, null kept (a removal). */
function lookFields(c: LookChange): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.visible !== undefined) out.visible = c.visible;
  if (c.color !== undefined) out.color = c.color;
  if (c.transparency !== undefined) out.transparency = c.transparency;
  if (c.emissive !== undefined) out.emissive = c.emissive;
  return out;
}

/** The view the first look edit makes when a document has none (prism.md §4.4). */
export const PrismView = 'v.prism';

/** A document's labels by id (entities and compartments, superstructures' too) and its instances: made once a document. */
const Indexes = new WeakMap<MesoViewSpecDoc, DocumentIndex>();
interface DocumentIndex {
  readonly entities: ReadonlyMap<string, string>;
  readonly compartments: ReadonlyMap<string, string>;
  readonly instances: ReadonlySet<string>;
}
function indexOf(doc: MesoViewSpecDoc): DocumentIndex {
  let index = Indexes.get(doc);
  if (index) return index;
  const entities = new Map<string, string>();
  const compartments = new Map<string, string>();
  for (const ss of doc.superstructures ?? []) {
    for (const e of ss.entities ?? []) entities.set(e.id, e.label);
    for (const c of ss.compartments) compartments.set(c.id, c.label);
  }
  // the document's own win over a superstructure's of the same id
  for (const e of doc.entities) entities.set(e.id, e.label);
  for (const c of doc.compartments) compartments.set(c.id, c.label);
  index = { entities, compartments, instances: new Set((doc.instances ?? []).map((i) => i.id)) };
  Indexes.set(doc, index);
  return index;
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
