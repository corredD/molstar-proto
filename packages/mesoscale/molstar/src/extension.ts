/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Asset } from '@molstar/core/util/assets';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  type Issue,
  type MesoViewSpecDoc,
  type Patch,
  printData,
  readData,
  readPatch,
} from '@molstar/meso-spec/format';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { ApiArea, type ApiAreaContext, type ApiFailure, ApiResult } from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension } from '@molstar/prism-viewer/spec';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import { downloadBlob } from '@molstar/prism-viewer/ui/download';
import type { Loci } from '@molstar/model/model/loci';
import { cssColor } from '@molstar/mesoscale-extension/color-file';
import { registerParticleListOwner } from '@molstar/mesoscale-extension/owner';
import { Color } from '@molstar/core/util/color';
import { type CameraHere, type DocumentViews, MesoDocumentModel } from './document-model.js';
import { blockedResult, DocumentListOwner } from './list-owner.js';
import { documentVisible, type DocumentGroupBy, type DocumentLooks, type DocumentOutline } from './document-tree.js';
import { openAddresses } from './prism-viewer.js';

declare module '@molstar/prism-viewer/api' {
  // The `mesoviewspec` area: the open MesoViewSpec document (prism.md §5.3).
  interface ExtensionApis {
    mesoviewspec: MesoViewSpecApi;
  }
}

// The `mesoviewspec` extension (prism.md §3, §5.3): the owner of the open document (`MesoDocumentModel`) as operations.
// The stub in `prism-viewer.ts` declares them before this chunk loads; the chunk is what a document file, or one of
// its operations, loads.

export interface MesoViewSpecOptions {
  /** A resource's text by absolute address; default: the viewer's asset manager. */
  readonly fetchText?: (url: string) => Promise<string | undefined>;
}

/** What `mesoviewspec.save` gives. */
export interface SavedDocument {
  readonly blob: Blob;
  readonly filename: string;
}

/** What `mesoviewspec.get` gives. */
export interface DocumentInfo {
  readonly text: string;
  readonly counts: Readonly<Record<string, { readonly requested?: number; readonly achieved: number }>>;
}

/** The open document as the Scene tree reads it (prism.md §4): its rows, their eyes and dots, its own eye. */
export interface DocumentTree {
  readonly outline: DocumentOutline;
  readonly looks: DocumentLooks;
  /** Every row shown (the document's eye, the Particles category's). */
  readonly visible: boolean;
  /** The shown view has Show-only looks: Show all again is offered. */
  readonly showsOnly: boolean;
  /** The session's issues (the document row's Issues). */
  readonly issues: readonly Issue[];
  /** The Views row (prism.md §4.4): views, tours, the view shown, the tour playing. */
  readonly views: DocumentViews;
}

/** How long a tour's step holds when it does not say (ms; the semantic camera story's). */
const TourStepMs = 2000;

/** A state a view reads (Prism's `ReadonlyState`, as `watchedState` gives it). */
export type ReadonlyState<T> = ReturnType<typeof watchedState<T>>;

const MaxIssuesListed = 5;

/** The same issues, in order (the owner makes a new list at each step): the tree's Issues need not render again. */
function sameIssues(a: readonly Issue[], b: readonly Issue[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].code !== b[i].code || a[i].message !== b[i].message) return false;
  return true;
}

const SelectParam = () =>
  PD.Text('', { description: 'A MesoQL address: (population p.catalase), (in c.exosome), (instance i.x), (all)' });

const OpenParams = {
  url: OptionalParam(PD.Text('', { description: 'The address of a document (.mesoviewspec.json or .mesoviewspec)' })),
  data: OptionalParam(PD.Text('', { multiline: true, description: 'The document: its JSON or its S-expression' })),
  file: OptionalParam(PD.Value<File | null>(null, { isHidden: true, description: 'A document file' })),
  files: OptionalParam(
    PD.Value<readonly File[]>([], {
      isHidden: true,
      description: 'The files dropped with it: its relative resources (a recipe, a picks file) by name',
    }),
  ),
};

const GetParams = {
  detail: PD.Select<'summary' | 'outline' | 'document'>(
    'summary',
    [
      ['summary', 'Summary'],
      ['outline', 'Outline'],
      ['document', 'Document'],
    ],
    { description: 'summary: counts; outline: with the compartments tree; document: the whole S-expression' },
  ),
};

const EditParams = {
  patch: PD.Text('', {
    multiline: true,
    description: 'A patch: (patch :ops [(set p.x :fields (:abundance (:count 300)))]) or its JSON',
  }),
};

const SaveParams = {
  format: PD.Select<'json' | 'sexpr'>(
    'json',
    [
      ['json', 'JSON (.mesoviewspec.json)'],
      ['sexpr', 'S-expression (.mesoviewspec)'],
    ],
    { description: 'The file format' },
  ),
};

export class MesoViewSpecApi extends ApiArea {
  readonly id = 'mesoviewspec';

  /** The owner of the open document (for tests and the app's views). */
  readonly model: MesoDocumentModel;
  /** The document's lists as the mesoscale area sees them (prism.md §1.1): registered on the viewer's plugin. */
  readonly owner: DocumentListOwner;
  readonly #unregister: () => void;
  readonly #unregisterOwner: () => void;

  constructor(
    readonly ctx: ApiAreaContext,
    options: MesoViewSpecOptions = {},
  ) {
    super(ctx);
    this.model = new MesoDocumentModel(
      {
        plugin: ctx.plugin,
        extensions: {
          load: async () => {
            // The particle layers (the transformer the lists are drawn by) come with their extension.
            await ctx.extensions.ensureFor({ transformers: ['ms-plugin.particles-representation-3d'] });
            return true;
          },
        },
      },
      { fetchText: options.fetchText ?? ((url) => fetchWithAssets(ctx, url)) },
    );
    this.#unregister = this.model.register();
    this.owner = new DocumentListOwner(this.model);
    this.#unregisterOwner = registerParticleListOwner(ctx.plugin, this.owner);
  }

  override dispose(): void {
    this.#stopTour();
    this.#unregisterOwner();
    this.#unregister();
    this.model.dispose();
  }

  /**
   * The open document's rows, eyes and dots (prism.md §4), following the owner while watched; the same outline while
   * only the looks change (a view edit). `groupBy` is the tree's view state (prism.md §4.2).
   */
  treeState(groupBy?: ReadonlyState<DocumentGroupBy | undefined>): ReadonlyState<DocumentTree | undefined> {
    const model = this.model;
    return watchedState(
      () => {
        const outline = model.outline(groupBy?.value ?? 'compartment');
        if (!outline) return undefined;
        const looks = model.looks(outline);
        return {
          outline,
          looks,
          visible: documentVisible(outline, looks),
          showsOnly: model.showsOnly,
          issues: model.issues,
          views: model.views()!,
        };
      },
      () => (groupBy ? [model.changed, groupBy] : model.changed),
      {
        compare: (a, b) =>
          a === b ||
          (!!a &&
            !!b &&
            a.outline === b.outline &&
            a.looks === b.looks &&
            a.showsOnly === b.showsOnly &&
            a.views === b.views &&
            sameIssues(a.issues, b.issues)),
      },
    );
  }

  /** An address's copies on the drawn lists: one loci a list (prism.md §4.6); kept while what is drawn is the same. */
  lociOf(select: string): readonly Loci[] {
    return this.model.lociOf(select);
  }

  /** The row of a drawn copy (a list's set key and its index): a population's, an instance's, a part's. */
  rowOfCopy(set: string, index: number): string | undefined {
    return this.model.rowOfCopy(set, index);
  }

  readonly focus = this.operation({
    id: 'mesoviewspec.focus',
    title: 'Focus the camera on part of the MesoViewSpec document',
    params: { select: SelectParam() },
    history: false,
    undoable: false,
    run: async ({ select }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const s = this.model.sphereOf(select);
      if (!s) return ApiResult.fail('not-found', `${select} picks no copy here.`);
      ctx.plugin.managers.camera.focusSphere(Sphere3D.create(Vec3.create(...s.center), s.radius));
      return ApiResult.ok(`Framed ${select}.`);
    },
  });

  readonly highlight = this.operation({
    id: 'mesoviewspec.highlight',
    title: 'Highlight part of the MesoViewSpec document',
    params: { select: SelectParam() },
    history: false,
    undoable: false,
    run: async ({ select }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const lights = ctx.plugin.managers.interactivity.lociHighlights;
      lights.clearHighlights();
      const loci = this.model.lociOf(select);
      for (const l of loci) lights.highlight({ loci: l }, false);
      return loci.length
        ? ApiResult.ok(`Lit ${select}.`)
        : ApiResult.fail('not-found', `${select} picks no copy here.`);
    },
  });

  /**
   * Shows a view (prism.md §4.4): no step (`undoable: false`, as `snapshot.apply`), in order with the steps and with a
   * history context, so the looks it writes are part of its run and never steps of their own. The next step's
   * checkpoint notes the view shown, and Undo shows it again with the scene it restores (§7.4).
   */
  readonly view = this.operation({
    id: 'mesoviewspec.view',
    title: 'Show a view of the MesoViewSpec document',
    params: { view: PD.Text('', { description: 'The id of one of the document’s views (v.cell)' }) },
    undoable: false,
    quiet: true,
    run: async ({ view }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const id = view.trim();
      if (!this.model.doc.views?.some((v) => v.id === id)) {
        const ids = (this.model.doc.views ?? []).map((v) => v.id);
        return ApiResult.fail(
          'not-found',
          `The document has no view '${id}'.`,
          ids.length ? `Its views: ${ids.join(', ')}.` : 'It has no views.',
        );
      }
      let step: Awaited<ReturnType<MesoDocumentModel['show']>>;
      try {
        step = await this.model.show(id, ctx.api);
      } catch (e) {
        return ApiResult.fail('failed', `Could not show ${id}: ${(e as Error).message}`);
      }
      if (step.unchanged) return ApiResult.already(`${id} is shown.`);
      if (!step.record) return ApiResult.fail('invalid', issueLines(step.issues).join('; ') || `Could not show ${id}.`);
      const label = this.model.doc.views.find((v) => v.id === id)?.label;
      return ApiResult.ok(`Showing ${label ? `${label} (${id})` : id}.`, { view: true });
    },
  });

  /** Where the person stands: `given` (Å, the world frame), else the canvas's camera; none headless without one. */
  #here(given: CameraHere | undefined): CameraHere | undefined {
    if (given) return given;
    const s = this.ctx.plugin.canvas3d?.camera.getSnapshot();
    return s && { position: [...s.position], target: [...s.target], up: [...s.up] };
  }

  /**
   * New view from here (prism.md §4.4, the Views row's ⋯): a patch, one step, inserting a view with the camera here and
   * the view shown's looks (new ids); the new view is then the one shown, in the same step.
   */
  readonly newView = this.operation({
    id: 'mesoviewspec.newView',
    title: 'New view of the MesoViewSpec document from here',
    params: {
      label: OptionalParam(PD.Text('', { description: 'Its name; none: View <n>' })),
      camera: OptionalParam(PD.Value<CameraHere | undefined>(undefined, { isHidden: true })),
    },
    run: async ({ label, camera }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const here = this.#here(camera);
      if (!here) return ApiResult.fail('not-found', 'There is no camera here (no canvas).');
      const made = this.model.newViewPatch(here, label);
      if (!made) return ApiResult.fail('not-found', 'No document is open.');
      const r = await this.applyLooks(made.patch, ctx.api, 'new view');
      if (!r.ok || r.unchanged) return r;
      await this.model.show(made.id, ctx.api);
      return ApiResult.ok(`Made the view ${made.id} from here; it is shown.`, {}, { value: { id: made.id } });
    },
  });

  /** Update camera (prism.md §4.4, the shown view's ⋯): the view shown's camera set to the one here; a patch, one step. */
  readonly updateCamera = this.operation({
    id: 'mesoviewspec.updateCamera',
    title: "Set the shown view's camera to this one",
    params: { camera: OptionalParam(PD.Value<CameraHere | undefined>(undefined, { isHidden: true })) },
    run: async ({ camera }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const here = this.#here(camera);
      if (!here) return ApiResult.fail('not-found', 'There is no camera here (no canvas).');
      const id = this.model.shownId;
      if (!id) return ApiResult.fail('not-found', 'The document has no view.', 'Make one with New view from here.');
      const patch = this.model.updateCameraPatch(here);
      if (!patch) return ApiResult.fail('invalid', `The frame of ${id} cannot be inverted: its camera is left.`);
      const r = await this.applyLooks(patch, ctx.api, 'camera');
      return r.ok && !r.unchanged ? ApiResult.ok(`Set the camera of ${id} to this one.`) : r;
    },
  });

  /** Open with this view (prism.md §4.4, a view's ⋯): `session.view`, a patch, one step; the view shown stays. */
  readonly openWith = this.operation({
    id: 'mesoviewspec.openWith',
    title: 'Open the MesoViewSpec document with this view',
    params: { view: PD.Text('', { description: 'The id of one of the document’s views (v.cell)' }) },
    run: async ({ view }, ctx) => {
      const doc = this.model.doc;
      if (!doc) return ApiResult.fail('not-found', 'No document is open.');
      const id = view.trim();
      if (!doc.views?.some((v) => v.id === id)) return ApiResult.fail('not-found', `The document has no view '${id}'.`);
      const patch = this.model.openWithPatch(id);
      if (!patch) return ApiResult.already(`The document opens with ${id}.`);
      // the view shown stays the one shown: an edit of session.view would show its view where none was picked
      this.model.pin();
      const r = await this.applyLooks(patch, ctx.api, 'open with');
      return r.ok && !r.unchanged ? ApiResult.ok(`The document opens with ${id}.`) : r;
    },
  });

  /**
   * Add label on a document row (prism.md §5.2): an annotation of the view shown, its target the row's address; a
   * patch, one step, saved in the document; the adapter draws it as Prism's label while its view is shown.
   */
  readonly label = this.operation({
    id: 'mesoviewspec.label',
    title: 'Label part of the MesoViewSpec document',
    params: {
      select: SelectParam(),
      text: PD.Text('', { description: 'What it says; none: Label' }),
    },
    run: async ({ select, text }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const address = select.trim();
      if (!address) return ApiResult.fail('invalid', 'Label what? Give an address.');
      if (!this.model.sphereOf(address)) return ApiResult.fail('not-found', `${address} picks no copy here.`);
      const said = text.trim() || 'Label';
      const r = await this.applyLooks(this.model.annotationPatch(address, said), ctx.api, 'label');
      return r.ok && !r.unchanged ? ApiResult.ok(`Added the label "${said}" on ${address}.`) : r;
    },
  });

  /** The tour playing: stopped by Stop, another tour, Undo or Redo, a close or an open. */
  #tour: { readonly stop: AbortController; readonly ended: Promise<void> } | undefined;

  /** Resolves when no tour plays (for tests and the app: after a Stop, the tour's end). */
  async tourEnded(): Promise<void> {
    while (this.#tour) await this.#tour.ended;
  }

  /** Stops the tour playing, if one is: the view it showed last stays shown (prism.md §4.4). */
  #stopTour(): boolean {
    const t = this.#tour;
    if (!t) return false;
    t.stop.abort();
    return true;
  }

  /**
   * Plays a tour (prism.md §4.4, as `snapshot.play`): no step; each of its steps runs as `mesoviewspec.view` with the
   * caller's origin (no step either: in order with the steps, its looks part of its run), holds for its duration, its
   * caption the Views row's. The agent asks once for the whole tour (`undoable: false`, agent.md §4); its views are not
   * asked again. Returns once it plays.
   */
  readonly tourPlay = this.operation({
    id: 'mesoviewspec.tour.play',
    title: 'Play a tour of the MesoViewSpec document',
    params: {
      tour: OptionalParam(
        PD.Text('', { description: "A tour's id (t.granule); none: the document's own, else its first" }),
      ),
    },
    history: false,
    undoable: false,
    run: async ({ tour }, ctx) => {
      const doc = this.model.doc;
      if (!doc) return ApiResult.fail('not-found', 'No document is open.');
      const tours = doc.tours ?? [];
      const id = tour?.trim() || doc.session?.tour || tours[0]?.id;
      const t = tours.find((x) => x.id === id);
      if (!t) {
        return ApiResult.fail(
          'not-found',
          id ? `The document has no tour '${id}'.` : 'The document has no tour.',
          tours.length ? `Its tours: ${tours.map((x) => x.id).join(', ')}.` : undefined,
        );
      }
      if (!t.steps.length) return ApiResult.fail('invalid', `The tour ${t.id} has no steps.`);
      this.#stopTour();
      const stop = new AbortController();
      const entry = { stop, ended: Promise.resolve() };
      entry.ended = this.#play(t, stop.signal, ctx.api).finally(() => {
        if (this.#tour === entry) this.#tour = undefined;
      });
      this.#tour = entry;
      return ApiResult.ok(`Playing ${t.label ?? t.id} (${t.steps.length} views).`, { view: true });
    },
  });

  readonly tourStop = this.operation({
    id: 'mesoviewspec.tour.stop',
    title: 'Stop the tour playing',
    params: {},
    history: false,
    run: async () => {
      if (!this.#stopTour()) return ApiResult.already('No tour is playing.');
      await this.tourEnded();
      return ApiResult.ok(`Stopped the tour: ${this.model.shownId ?? 'its last view'} is shown.`, { view: true });
    },
  });

  async #play(
    t: NonNullable<MesoViewSpecDoc['tours']>[number],
    signal: AbortSignal,
    api: ApiAreaContextApi,
  ): Promise<void> {
    const session = this.model.session;
    // Undo and Redo bring back another scene: the tour stops (as an animation does on a restore)
    const history = this.ctx.managers.history;
    const subs = [history.undone, history.redone].map((e) => e.subscribe(() => this.#stopTour()));
    try {
      for (let i = 0; i < t.steps.length && !signal.aborted; i++) {
        // closed, or another document opened: the tour is the last one's
        if (this.model.session !== session || !this.model.doc) break;
        const step = t.steps[i];
        // a view the document no longer has (an edit while it plays): skipped
        if (!this.model.doc.views?.some((v) => v.id === step.view)) continue;
        this.model.playing = {
          tour: t.id,
          step: i + 1,
          of: t.steps.length,
          ...(step.caption ? { caption: step.caption } : {}),
        };
        const r = await api.run('mesoviewspec.view', { view: step.view });
        if (!r.ok || signal.aborted) break;
        await holdFor(step.duration ?? TourStepMs, signal);
      }
    } finally {
      for (const s of subs) s.unsubscribe();
      this.model.playing = undefined;
    }
  }

  readonly eye = this.operation({
    id: 'mesoviewspec.eye',
    title: 'Show or hide part of the MesoViewSpec document',
    params: {
      select: PD.Text('', {
        multiline: true,
        description: 'MesoQL addresses, one a line: each gets its eye look (l.eye.<n>) on the shown view',
      }),
      visible: PD.Boolean(true),
    },
    run: async ({ select, visible }, ctx) => {
      const selects = select
        .split('\n')
        .map((x: string) => x.trim())
        .filter(Boolean);
      if (!selects.length) return ApiResult.fail('invalid', 'Show or hide what? Give an address.');
      return this.applyLooks(this.model.eyePatch(selects, visible), ctx.api, visible ? 'show' : 'hide');
    },
  });

  readonly showOnly = this.operation({
    id: 'mesoviewspec.showOnly',
    title: 'Show only part of the MesoViewSpec document',
    params: {
      select: OptionalParam(PD.Text('', { description: 'A MesoQL address; none: show all again' })),
    },
    run: async ({ select }, ctx) =>
      this.applyLooks(this.model.showOnlyPatch(select?.trim() || undefined), ctx.api, 'show only'),
  });

  readonly look = this.operation({
    id: 'mesoviewspec.look',
    title: 'Style part of the MesoViewSpec document',
    params: {
      select: SelectParam(),
      color: OptionalParam(PD.Text('', { description: 'A CSS color (tomato, #ff6347)' })),
      defaultColor: OptionalParam(PD.Boolean(false, { description: 'Back to the default color' })),
      visible: OptionalParam(PD.Boolean(true)),
      transparency: OptionalParam(PD.Numeric(0, { min: 0, max: 1, step: 0.01 })),
      emissive: OptionalParam(PD.Numeric(0, { min: 0, max: 1, step: 0.01 })),
    },
    run: async (values, ctx) => {
      const { select, color, defaultColor, visible, transparency, emissive } = values as {
        select: string;
        color?: string;
        defaultColor?: boolean;
        visible?: boolean;
        transparency?: number;
        emissive?: number;
      };
      if (!select.trim()) return ApiResult.fail('invalid', 'Style what? Give an address.');
      const parsed = color?.trim() ? cssColor(color.trim()) : undefined;
      if (color?.trim() && parsed === undefined) {
        return ApiResult.fail('invalid', `'${color}' is not a color.`, 'Give a color name (tomato), #rrggbb or rgb().');
      }
      const hex = parsed !== undefined ? Color.toHexStyle(parsed).toLowerCase() : undefined;
      const change = {
        ...(defaultColor ? { color: null } : hex ? { color: hex } : {}),
        ...(visible !== undefined ? { visible } : {}),
        ...(transparency !== undefined ? { transparency } : {}),
        ...(emissive !== undefined ? { emissive } : {}),
      };
      if (!Object.keys(change).length) {
        return ApiResult.fail(
          'invalid',
          'Nothing to change.',
          'Give a color, defaultColor, visible, transparency or emissive.',
        );
      }
      const { patch, blocked } = this.model.stylePatch([{ select: select.trim(), change }]);
      if (blocked.length) return blockedResult(blocked);
      return this.applyLooks(patch, ctx.api, 'style');
    },
  });

  /** A look patch committed as one step (an eye, Show only): saved in the document (prism.md §11, question 3). */
  private async applyLooks(patch: Patch | undefined, api: ApiAreaContextApi, label: string) {
    if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
    if (!patch) return ApiResult.already('It is already so.');
    let step: Awaited<ReturnType<MesoDocumentModel['edit']>>;
    try {
      step = await this.model.edit(patch, api, label);
    } catch (e) {
      return ApiResult.fail('failed', `Could not change the looks: ${(e as Error).message}`);
    }
    if (step.unchanged) return ApiResult.already('It is already so.');
    if (!step.record) return ApiResult.fail('invalid', issueLines(step.issues).join('; ') || 'The looks were refused.');
    return ApiResult.ok(`Changed the looks (${label}).`);
  }

  readonly open = this.operation({
    id: 'mesoviewspec.open',
    title: 'Open a MesoViewSpec document',
    params: OpenParams,
    approval: 'network',
    addresses: openAddresses,
    run: async (values, ctx) => {
      const given = [
        values.url?.trim() ? 'url' : '',
        values.data?.trim() ? 'data' : '',
        values.file ? 'file' : '',
      ].filter(Boolean);
      if (given.length !== 1) {
        return ApiResult.fail(
          'invalid',
          given.length ? 'Give one of url, data or file, not several.' : 'Open what? Give url, data or file.',
        );
      }
      // One at a time (prism.md §1.1); the agent closes first (§5.3), the person's Open asks in the UI.
      if (this.model.doc && ctx.origin.kind === 'agent') {
        return ApiResult.fail(
          'blocked',
          'A document is open.',
          'Close it first with mesoviewspec.close, then open the other.',
        );
      }
      const url = absolute(values.url?.trim());
      let text: string | undefined;
      try {
        text = url ? await this.model.options.fetchText?.(url) : values.file ? await values.file.text() : values.data;
      } catch (e) {
        return ApiResult.fail('failed', `Could not read the document: ${(e as Error).message}`);
      }
      if (text === undefined) return ApiResult.fail('failed', `Could not read ${url}.`);
      const read = parseDocument(text);
      if ('ok' in read) return read;
      const files = new Map<string, string | Uint8Array>();
      for (const f of values.files ?? []) files.set(f.name, new Uint8Array(await f.arrayBuffer()));
      let step: Awaited<ReturnType<MesoDocumentModel['open']>>;
      try {
        step = await this.model.open(read.doc, { ...(url ? { url } : {}), files }, ctx.api);
      } catch (e) {
        return ApiResult.fail('failed', `Could not open the document: ${(e as Error).message}`);
      }
      const counts = this.model.session?.counts ?? {};
      const copies = Object.values(counts).reduce((n, c) => n + c.achieved, 0);
      const lists = this.model.adapter.keys().length;
      const title = read.doc.metadata?.title || values.file?.name || url?.split('/').pop() || 'the document';
      const problems = step.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
      // files dropped with it that no resource names are not opened as data either (load.files hands them all here)
      const named = new Set(
        (read.doc.resources ?? []).map((r) => r.uri?.slice((r.uri?.lastIndexOf('/') ?? -1) + 1)).filter(Boolean),
      );
      const stray = [...files.keys()].filter((name) => !named.has(name));
      const warnings = [
        ...issueLines(problems),
        ...(stray.length ? [`Not opened (the document names no such resource): ${stray.join(', ')}.`] : []),
      ];
      return ApiResult.ok(
        `Opened ${title}: ${copies} ${copies === 1 ? 'copy' : 'copies'} in ${lists} ${lists === 1 ? 'list' : 'lists'}.`,
        {},
        warnings.length ? { warnings } : {},
      );
    },
  });

  readonly close = this.operation({
    id: 'mesoviewspec.close',
    title: 'Close the MesoViewSpec document',
    approval: 'destructive',
    params: {},
    run: async (_values, ctx) => {
      if (!this.model.doc) return ApiResult.already('No document is open.');
      await this.model.close(ctx.api);
      return ApiResult.ok('Closed the document: its lists are gone.');
    },
  });

  readonly get = this.operation({
    id: 'mesoviewspec.get',
    title: 'Describe the MesoViewSpec document',
    params: GetParams,
    read: true,
    run: async ({ detail }) => {
      const doc = this.model.doc;
      if (!doc) return ApiResult.fail('not-found', 'No document is open.');
      const counts = this.model.session?.counts ?? {};
      const text = detail === 'document' ? printData(doc) : describeDocument(doc, counts, this.model.issues, detail);
      return ApiResult.ok(text, {}, { value: { text, counts } as DocumentInfo });
    },
  });

  readonly edit = this.operation({
    id: 'mesoviewspec.edit',
    title: 'Edit the MesoViewSpec document',
    params: EditParams,
    run: async ({ patch }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const read = parsePatch(patch);
      if ('ok' in read) return read;
      let step: Awaited<ReturnType<MesoDocumentModel['edit']>>;
      try {
        step = await this.model.edit(read.patch, ctx.api, 'edit');
      } catch (e) {
        return ApiResult.fail('failed', `Could not apply the patch: ${(e as Error).message}`);
      }
      if (step.unchanged) return ApiResult.already('It is already so.');
      if (!step.record) {
        return ApiResult.fail('invalid', issueLines(step.issues).join('; ') || 'The patch was refused.');
      }
      const r = step.record;
      // what the edit left unresolved is said, as an open says it (a model whose resource is missing draws nothing)
      const problems = step.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
      return ApiResult.ok(
        `Edited the ${r.kind}: ${r.resolverRuns} resolver ${r.resolverRuns === 1 ? 'run' : 'runs'}, ${r.cacheHits} cache ${r.cacheHits === 1 ? 'hit' : 'hits'}.`,
        {},
        problems.length ? { warnings: issueLines(problems) } : {},
      );
    },
  });

  readonly save = this.operation({
    id: 'mesoviewspec.save',
    title: 'Save the MesoViewSpec document',
    params: SaveParams,
    history: false,
    undoable: false,
    run: async ({ format }) => {
      const saved = this.model.save(format);
      if (!saved) return ApiResult.fail('not-found', 'No document is open.');
      const blob = new Blob([saved.text], { type: format === 'json' ? 'application/json' : 'text/plain' });
      return ApiResult.ok(
        `Saved ${saved.filename}.`,
        {},
        { value: { blob, filename: saved.filename } as SavedDocument },
      );
    },
  });
}

/** Waits `ms`, or less when `signal` aborts. */
function holdFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/** The document in `text`: its JSON, or its S-expression; refused when it is not a MesoViewSpec. */
function parseDocument(text: string): { doc: MesoViewSpecDoc } | ApiFailure {
  let value: unknown;
  if (text.trimStart().startsWith('{')) {
    try {
      value = JSON.parse(text);
    } catch (e) {
      return ApiResult.fail('invalid', `The document is not valid JSON: ${(e as Error).message}`);
    }
  } else {
    const r = readData(text);
    if (r.error) return ApiResult.fail('invalid', `The document is not readable: ${r.error.message}`);
    value = r.value;
  }
  if (!value || typeof value !== 'object' || (value as { format?: unknown }).format !== 'meso_view_spec') {
    return ApiResult.fail('invalid', 'This is not a MesoViewSpec document.', 'Its format must be meso_view_spec.');
  }
  return { doc: value as MesoViewSpecDoc };
}

/** The patch in `text`: its S-expression, or its JSON. */
function parsePatch(text: string): { patch: Patch } | ApiFailure {
  if (!text.trim()) return ApiResult.fail('invalid', 'Edit with what? Give a patch.');
  if (text.trimStart().startsWith('{')) {
    try {
      return { patch: JSON.parse(text) as Patch };
    } catch (e) {
      return ApiResult.fail('invalid', `The patch is not valid JSON: ${(e as Error).message}`);
    }
  }
  const r = readPatch(text);
  return r.patch ? { patch: r.patch } : ApiResult.fail('invalid', `The patch is not readable: ${r.error?.message}`);
}

const issueLines = (issues: readonly Issue[]) => {
  const lines = issues.slice(0, MaxIssuesListed).map((i) => i.message);
  if (issues.length > MaxIssuesListed) lines.push(`and ${issues.length - MaxIssuesListed} more`);
  return lines;
};

/** The summary, and with `outline` the compartments' tree. */
function describeDocument(
  doc: MesoViewSpecDoc,
  counts: DocumentInfo['counts'],
  issues: readonly Issue[],
  detail: 'summary' | 'outline',
): string {
  const lines = [`${doc.metadata?.title || 'Untitled'} (${doc.format} ${doc.version})`];
  if (detail === 'outline') {
    const walk = (parent: string | undefined, depth: number) => {
      for (const c of doc.compartments.filter((c) => c.parent === parent)) {
        lines.push(`${'  '.repeat(depth + 1)}${c.id}: ${c.label} (${c.kind})`);
        for (const p of doc.populations.filter((p) => p.compartment === c.id))
          lines.push(populationLine(p, counts, depth + 2));
        walk(c.id, depth + 1);
      }
    };
    lines.push('Compartments:');
    walk(undefined, 0);
  } else {
    lines.push('Populations:');
    for (const p of doc.populations) lines.push(populationLine(p, counts, 1));
  }
  lines.push(
    `Models: ${doc.models?.length ?? 0}`,
    `Views: ${doc.views?.length ?? 0}`,
    `Issues: ${issues.length}${issues.length ? ` (${issueLines(issues).join('; ')})` : ''}`,
  );
  return lines.join('\n');
}

function populationLine(
  p: MesoViewSpecDoc['populations'][number],
  counts: DocumentInfo['counts'],
  depth: number,
): string {
  const c = counts[p.id];
  const n = c ? `${c.achieved}${c.requested !== undefined ? ` of ${c.requested}` : ''}` : 'not placed';
  return `${'  '.repeat(depth)}${p.id} (${p.entity}): ${n}`;
}

/** A resource's text through the viewer's asset manager; undefined when it cannot be read. */
async function fetchWithAssets(ctx: ApiAreaContext, url: string): Promise<string | undefined> {
  const { plugin } = ctx;
  try {
    const wrapper = await plugin.runTask(
      plugin.managers.asset.resolve(Asset.getUrlAsset(plugin.managers.asset, url), 'string'),
    );
    try {
      return String(wrapper.data);
    } finally {
      wrapper.dispose();
    }
  } catch {
    return undefined;
  }
}

type ApiAreaContextApi = Parameters<MesoDocumentModel['edit']>[1];

export function createMesoViewSpecExtension(o: MesoViewSpecOptions = {}): ViewerExtension {
  return {
    id: 'mesoviewspec',
    title: 'MesoViewSpec',
    api: { mesoviewspec: (ctx: ApiAreaContext) => new MesoViewSpecApi(ctx, o) },
    commands: (api) => {
      const m = api.mesoviewspec;
      if (!m) return [];
      const category = 'MesoViewSpec';
      return [
        operationCommand(api, m.open, {
          category,
          icon: 'folder-open',
          alias: ['mesoviewspec', 'meso view spec', 'document', 'open document'],
          action: 'Open',
        }),
        operationCommand(api, m.close, {
          category,
          icon: 'x',
          alias: ['mesoviewspec close', 'close document'],
          action: 'Close',
        }),
        operationCommand(api, m.get, {
          category,
          icon: 'info',
          alias: ['mesoviewspec get', 'document outline'],
          action: 'Show',
        }),
        operationCommand(api, m.edit, {
          category,
          icon: 'pencil',
          alias: ['mesoviewspec edit', 'mesoviewspec.edit', 'patch', 'edit document'],
          action: 'Apply',
        }),
        {
          ...operationCommand(api, m.save, {
            category,
            icon: 'save',
            alias: ['mesoviewspec save', 'save document', 'export document'],
            action: 'Save',
          }),
          async run(args) {
            const r = await m.save(args as never);
            if (!r.ok) throw new Error(r.hint ? `${r.message} ${r.hint}` : r.message);
            if (r.value) downloadBlob(r.value.blob, r.value.filename);
            return { message: r.did, ops: `mesoviewspec.save(${JSON.stringify(args)})` };
          },
        },
      ];
    },
  };
}

export const MesoViewSpecExtension: ViewerExtension = createMesoViewSpecExtension();

/** An address relative to the page (`?mesoviewspec=/path/doc.json`) made absolute: the resources resolve against it. */
function absolute(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, (globalThis as { location?: { href?: string } }).location?.href).href;
  } catch {
    return url;
  }
}
