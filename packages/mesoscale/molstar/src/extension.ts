/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describeDocument, documentState, idText, issueLines } from './agent-state.js';
import { quoted } from '@molstar/prism-viewer/agent/account';
import { allowedAddress } from '@molstar/prism-viewer/agent/policies';
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
import { type CompileProgress, isAbort } from '@molstar/meso-spec/runtime';
import { Task } from '@molstar/core/task';
import { type CameraHere, type DocumentViews, MesoDocumentModel, type MesoDocumentOptions } from './document-model.js';
import { editAsTask } from './edit-task.js';
import { blockedResult, DocumentListOwner } from './list-owner.js';
import { documentVisible, type DocumentGroupBy, type DocumentLooks, type DocumentOutline } from './document-tree.js';
import { resourceAddresses } from './prism-viewer.js';

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
  /** The resolvers a document's models are resolved by; default: the runtime's (`DefaultResolvers`). */
  readonly resolvers?: MesoDocumentOptions['resolvers'];
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
  resources: OptionalParam(
    PD.Text('', {
      multiline: true,
      description:
        "With url: the addresses of the document's resources on other hosts, one a line, that the open may fetch (the agent's open names them; the person is asked for a host not known)",
    }),
  ),
};

/** The lines of `text` (the addresses an agent's open names): none for none. */
const linesOf = (text: unknown) =>
  typeof text === 'string'
    ? text
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

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
      {
        fetchText: options.fetchText ?? ((url) => fetchWithAssets(ctx, url)),
        ...(options.resolvers ? { resolvers: options.resolvers } : {}),
      },
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

  /** The model the edit in flight is resolving, and how far it is (models done of the total); nothing between edits. */
  progressState(): ReadonlyState<CompileProgress | undefined> {
    const model = this.model;
    return watchedState(
      () => model.progress,
      () => model.resolving,
      { compare: (a, b) => a?.model === b?.model && a?.done === b?.done && a?.total === b?.total },
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
   * Shows a view (prism.md §4.4): one step (Ludo, 2026-11-10), so Undo shows the view before again, and the agent's
   * Undo turn takes it back. The looks it writes are part of its run, never steps of their own; its checkpoint notes
   * the view shown (§7.4). Showing the view shown again sets its camera only: unchanged, no step.
   */
  readonly view = this.operation({
    id: 'mesoviewspec.view',
    title: 'Show a view of the MesoViewSpec document',
    params: { view: PD.Text('', { description: 'The id of one of the document’s views (v.cell)' }) },
    quiet: true,
    run: async ({ view }, ctx) => this.#show(view, ctx.api),
  });

  /**
   * A tour's view (prism.md §4.4): as `mesoviewspec.view`, but no step (`undoable: false`, as `snapshot.apply`): in
   * order with the steps, with a history context, so a tour leaves no step a view. Run by `tour.play` only.
   */
  readonly tourView = this.operation({
    id: 'mesoviewspec.tour.view',
    title: 'Show a view of a MesoViewSpec tour',
    params: { view: PD.Text('', { description: 'The id of one of the document’s views (v.cell)' }) },
    undoable: false,
    quiet: true,
    run: async ({ view }, ctx) => this.#show(view, ctx.api),
  });

  /** Shows iew through pi (the run's): the model's show, said as a result. */
  async #show(view: string, api: ApiAreaContextApi) {
    if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
    const id = view.trim();
    if (!this.model.doc.views?.some((v) => v.id === id)) {
      const ids = (this.model.doc.views ?? []).map((v) => v.id);
      return ApiResult.fail(
        'not-found',
        `The document has no view '${id}'.`,
        ids.length ? `Its views: ${ids.map((x) => idText(x)).join(', ')}.` : 'It has no views.',
      );
    }
    let step: Awaited<ReturnType<MesoDocumentModel['show']>>;
    try {
      step = await this.model.show(id, api);
    } catch (e) {
      return ApiResult.fail('failed', `Could not show ${id}: ${(e as Error).message}`);
    }
    const label = this.model.doc.views.find((v) => v.id === id)?.label;
    // the label is the document's text: quoted (data, never instructions)
    const name = label ? `${quoted(String(label))} (${idText(id)})` : idText(id);
    // the camera is view state, which no checkpoint holds: nothing for a step to restore
    if (step.again)
      return {
        ...ApiResult.ok(`${name} is shown: its camera is set again.`, { view: true }),
        unchanged: true as const,
      };
    if (!step.record) return ApiResult.fail('invalid', issueLines(step.issues).join('; ') || `Could not show ${id}.`);
    return ApiResult.ok(`Showing ${name}.`, { view: true });
  }

  /** Where the person stands: `given` (Å, the world frame), else the canvas's camera; none headless without one. */
  #here(given: CameraHere | undefined): CameraHere | undefined {
    if (given) return given;
    const s = this.ctx.plugin.canvas3d?.camera.getSnapshot();
    // the canvas's fov is radians, the format's degrees
    return s && { position: [...s.position], target: [...s.target], up: [...s.up], fov: (s.fov * 180) / Math.PI };
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
      const was = this.model.doc.views?.find((v) => v.id === id)?.camera;
      const semantic = (['focus', 'from', 'framing'] as const).filter((k) => was?.[k] !== undefined);
      const patch = this.model.updateCameraPatch(here);
      if (!patch) return ApiResult.fail('invalid', `The frame of ${id} cannot be inverted: its camera is left.`);
      const r = await this.applyLooks(patch, ctx.api, 'camera');
      if (!r.ok || r.unchanged) return r;
      // a semantic camera becomes numeric (Ludo, 2026-11-09): what it said is gone, and the result says so
      return ApiResult.ok(
        semantic.length
          ? `Set the camera of ${id} to this one: its ${semantic.join(', ')} ${semantic.length === 1 ? 'is' : 'are'} replaced by a fixed position.`
          : `Set the camera of ${id} to this one.`,
      );
    },
  });

  /** Open with this view (prism.md §4.4, a view's ⋯): `session.view`, a patch, one step; the view shown stays. */
  readonly openWith = this.operation({
    id: 'mesoviewspec.openWith',
    title: 'Open the MesoViewSpec document with this view',
    params: {
      view: OptionalParam(
        PD.Text('', { description: 'The id of one of the document’s views (v.cell); none: the view shown' }),
      ),
    },
    run: async ({ view }, ctx) => {
      const doc = this.model.doc;
      if (!doc) return ApiResult.fail('not-found', 'No document is open.');
      // no view named: the view shown
      const id = view?.trim() || this.model.shownId;
      if (!id) return ApiResult.fail('not-found', 'The document has no view.', 'Make one with New view from here.');
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
   * Plays a tour (prism.md §4.4, as `snapshot.play`): no step; each of its steps runs as `mesoviewspec.tour.view` with the
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
          tours.length ? `Its tours: ${tours.map((x) => idText(x.id)).join(', ')}.` : undefined,
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
      return ApiResult.ok(`Playing ${t.label ? quoted(String(t.label)) : idText(t.id)} (${t.steps.length} views).`, {
        view: true,
      });
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
        const r = await api.run('mesoviewspec.tour.view', { view: step.view });
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
    addresses: openDocumentAddresses,
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
      // The agent's open by URL (Ludo, 2026-11-10): its resources' hosts are known only now. Those beside the document
      // or on a known service are fetched; any other must be named in `resources`, so the call that names them is the
      // one the person is asked for (its addresses), before anything of it is fetched.
      if (url && ctx.origin.kind === 'agent') {
        const named = new Set(linesOf(values.resources).map(originOf));
        const unasked = foreignAddresses(resourceUris(read.doc), url).filter(
          (a) => !allowedAddress(a) && !named.has(originOf(a)),
        );
        if (unasked.length) {
          return ApiResult.fail(
            'blocked',
            `The document's resources are on hosts not asked for: ${[...new Set(unasked.map(originOf))].join(', ')}. Nothing was fetched from them.`,
            `Open it again with resources (one a line): ${unasked.join(' ')}. The person is asked for a host the agent does not know.`,
          );
        }
      }
      const files = new Map<string, string | Uint8Array>();
      for (const f of values.files ?? []) files.set(f.name, new Uint8Array(await f.arrayBuffer()));
      let step: Awaited<ReturnType<MesoDocumentModel['open']>>;
      // a tour of the document open stops now, not after its step's hold (not awaited: its next view may queue behind)
      this.#stopTour();
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
        `Opened ${quoted(String(title))}: ${copies} ${copies === 1 ? 'copy' : 'copies'} in ${lists} ${lists === 1 ? 'list' : 'lists'}.`,
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
      // the tour playing stops now, not after its step's hold
      this.#stopTour();
      await this.model.close(ctx.api);
      return ApiResult.ok('Closed the document: its lists are gone.');
    },
  });

  /** What the agent is told of the open document each turn (agent-state.ts); undefined with none open. */
  agentState(): string | undefined {
    const { doc, session } = this.model;
    if (!doc) return undefined;
    return documentState({ doc, counts: session?.counts ?? {}, shown: this.model.shownId, issues: this.model.issues });
  }

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
    // a patch that writes a resource's uri makes the document fetch it: the agent asks for a host it does not know
    approval: 'network',
    addresses: ({ patch }) => patchAddresses(patch, this.model.url),
    run: async ({ patch }, ctx) => {
      if (!this.model.doc) return ApiResult.fail('not-found', 'No document is open.');
      const read = parsePatch(patch);
      if ('ok' in read) return read;
      let step: Awaited<ReturnType<MesoDocumentModel['edit']>>;
      try {
        // a Mol* task in the status pill, with its progress and Cancel; the pill's Cancel or the run's signal stops
        // the resolution: the step is rolled back, nothing is half-drawn (prism.md §7.2)
        step = await editAsTask(ctx.plugin, ctx.signal, (run) => this.model.edit(read.patch, ctx.api, 'edit', run));
      } catch (e) {
        // a stop is the run's abort (Prism rolls the step back), not a patch that could not be applied
        if (isAbort(e) || Task.isAbort(e)) throw e;
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

/**
 * What an open reaches (agent.md §4): its address; for a document given as data, read as the run reads it (JSON or
 * S-expression), every absolute address of its resources; the resources an agent's open by URL names (the run
 * refuses one by URL whose resources are on hosts it does not name). Data that does not read reaches nothing: the run
 * refuses it.
 */
export function openDocumentAddresses(v: {
  readonly url?: string;
  readonly data?: string;
  readonly resources?: string;
}): string[] {
  // the resources an agent's open by URL names (what it may fetch beside the document's host): asked for here
  const out = [...(v.url ? [v.url] : []), ...linesOf(v.resources)];
  if (typeof v.data !== 'string' || !v.data.trim()) return out;
  const read = parseDocument(v.data);
  return 'ok' in read ? out : [...out, ...resourceAddresses(read.doc)];
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

/**
 * What an edit reaches (agent.md §4): every resource `uri` the patch writes (a `set`'s fields, an `insert`'s node),
 * resolved as the owner loads it (`fixture://x` is `fixtures/x` beside the document; the base is the document's
 * address), those of the document's own origin left out. A patch that does not read reaches nothing: the run refuses it.
 */
export function patchAddresses(text: unknown, documentUrl: string | undefined): string[] {
  const read = typeof text === 'string' ? parsePatch(text) : undefined;
  if (!read || 'ok' in read || !Array.isArray(read.patch.ops)) return [];
  const uris: string[] = [];
  const collect = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || depth > 8) return;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'uri' && typeof v === 'string') uris.push(v);
      else collect(v, depth + 1);
    }
  };
  for (const op of read.patch.ops as readonly Partial<Record<string, unknown>>[]) {
    if (op?.op === 'set') collect(op.fields, 0);
    else if (op?.op === 'insert') collect(op.node, 0);
  }
  return foreignAddresses(uris, documentUrl);
}

/** A document's resource uris, as written. */
function resourceUris(doc: MesoViewSpecDoc): string[] {
  const resources: unknown = doc.resources;
  if (!Array.isArray(resources)) return [];
  return resources.flatMap((r) => (typeof r?.uri === 'string' ? [r.uri as string] : []));
}

/** An address's origin (`https://host:port`); the address itself when it is not one. */
const originOf = (a: string) => {
  try {
    return new URL(a).origin;
  } catch {
    return a;
  }
};

/** Resource uris as the owner fetches them (`MesoDocumentModel.load`), those of the document's origin left out. */
function foreignAddresses(uris: readonly string[], base: string | undefined): string[] {
  let origin: string | undefined;
  try {
    origin = base ? new URL(base).origin : undefined;
  } catch {
    origin = undefined;
  }
  const out = new Set<string>();
  for (const uri of uris) {
    const path = uri.startsWith('fixture://') ? `fixtures/${uri.slice('fixture://'.length)}` : uri;
    let href: URL;
    try {
      href = new URL(path, base);
    } catch {
      continue; // relative, and the document has no address: not fetched
    }
    if (origin !== undefined && origin !== 'null' && href.origin === origin) continue;
    out.add(href.href);
  }
  return [...out];
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
