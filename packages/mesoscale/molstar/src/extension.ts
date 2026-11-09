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
import { MesoDocumentModel } from './document-model.js';
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
}

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
  readonly #unregister: () => void;

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
  }

  override dispose(): void {
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
