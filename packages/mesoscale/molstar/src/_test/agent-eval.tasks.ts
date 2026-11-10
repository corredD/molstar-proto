/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import type { ModelChoice, ModelSource } from '@molstar/ai';
import {
  betaCellDoc,
  BetaCellResources,
  exosomeDoc,
  ExosomeRecipe,
  syntheticPicksStar,
  syntheticVesicleObj,
} from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import type { Particle, ParticleList } from '@molstar/model/model/particles/particle-list';
import { ParticleRepresentation3DLayers, particleLayerState } from '@molstar/plugin/state/transforms/particles/layers';
import { createMesoscaleExplorerSpec } from '@molstar/prism-me-app/spec';
import { type EvalCheck, type EvalResult, runEval } from '@molstar/prism-viewer/agent/eval';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { MesoViewSpecApi } from '../extension.js';

// The agent's evals over the open document (prism.md §8, lane `mvs-agent` step 3): three requests of the brief, each
// on a headless Prism viewer with the explorer's spec, the document opened by the person first. Each is checked on its
// outcome, never on the calls: on the document (the shown view's looks as the Scene tree reads them, the view shown)
// and on what is drawn (the particle layers of the lists, read with Prism's own `particleLayerState`), then Undo turn of
// the agent's turns must give back the document and the layers as they were. The unit test runs them with scripted
// models (right ones by more than one route, and near misses the checks must reject); `agent-eval.live.ts` with real
// ones. The runner is Prism's (`runEval`): its run log, turns, approvals and report.

/** The documents a task opens: the exosome (with its recipe, picks and membrane), the β-cell (its granule recipe). */
export type EvalDocument = 'exosome' | 'beta-cell';

/** What the checks see: the viewer, the document's API, what was there before the turns, the framings asked for. */
export interface MesoEvalContext {
  readonly v: PrismViewer;
  readonly api: MesoViewSpecApi;
  readonly before: MesoEvalSnapshot;
  /** The spheres the camera was asked to frame during the turns (a headless viewer has no canvas), in order. */
  readonly framed: readonly { center: readonly number[]; radius: number }[];
}

export interface MesoEvalSnapshot {
  /** The document as the owner holds it (what Save writes). */
  readonly doc: string;
  /** The data tree's transforms with their params: the lists, their representations and their layers. */
  readonly drawn: string;
  /** The shown view's id. */
  readonly shown: string | undefined;
  /** The color the Scene tree shows for some rows, before (a task's "changed" checks). */
  readonly colors: ReadonlyMap<string, number | undefined>;
}

export interface MesoEvalTask {
  readonly id: string;
  readonly title: string;
  readonly document: EvalDocument;
  readonly prompts: readonly string[];
  check(c: MesoEvalContext): readonly EvalCheck[];
}

// --- reading the outcome ------------------------------------------------------------------------------------------

const check = (name: string, pass: boolean, detail: () => string): EvalCheck =>
  pass ? { name, pass } : { name, pass, detail: detail() };

const hex = (c: number | undefined) => (c === undefined ? 'none' : `#${c.toString(16).padStart(6, '0')}`);

/** A strong red: what "red" means, and not the document's own catalase color (#d0453a), which is reddish already. */
export function isRed(c: number | undefined): boolean {
  if (c === undefined) return false;
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return r >= 0xb0 && g <= 0x40 && b <= 0x40;
}

const looksOf = (api: MesoViewSpecApi) => {
  const t = api.treeState().value;
  if (!t) throw new Error('No document is open.');
  return t.looks;
};

/** The ids of the document's populations a predicate keeps (top level: a superstructure's own are not rows). */
function populations(api: MesoViewSpecApi, keep: (p: MesoViewSpecDoc['populations'][number]) => boolean): string[] {
  return (api.model.doc?.populations ?? []).filter(keep).map((p) => p.id);
}

/** The representations drawing a list, each with its layers cell's params (none: drawn as is). */
function representationsOf(v: PrismViewer, particles: ParticleList) {
  const state = v.plugin.state.data;
  const layersOf = new Map<string, { layers: never[]; hidden?: number[] }>();
  for (const cell of state.cells.values())
    if (cell.transform.transformer === ParticleRepresentation3DLayers)
      layersOf.set(cell.transform.parent, cell.transform.params as never);
  return v.plugin.managers.particles.hierarchy.current.lists
    .filter((l) => l.cell.obj?.data === particles)
    .flatMap((l) => l.representations)
    .map((r) => ({ hidden: !!r.cell.state.isHidden, layers: layersOf.get(r.cell.transform.ref) }));
}

/** How the copies of an address are drawn: how many, how many seen, and the colors painted over them. */
export interface DrawnCopies {
  readonly copies: number;
  readonly visible: number;
  /** The overpaint of each seen copy (undefined: the representation's own color), counted. */
  readonly colors: ReadonlyMap<number | undefined, number>;
}

/** Reads the drawn layers for an address's copies: later layers over earlier ones, as Prism draws them. */
export function drawnCopies(v: PrismViewer, api: MesoViewSpecApi, select: string): DrawnCopies {
  let copies = 0;
  let visible = 0;
  const colors = new Map<number | undefined, number>();
  for (const loci of api.model.lociOf(select)) {
    const particles = loci.particles;
    const states = representationsOf(v, particles)
      .filter((r) => !r.hidden)
      .map((r) => (r.layers ? particleLayerState(r.layers.layers, particles, r.layers.hidden ?? []) : undefined));
    OrderedSet.forEach(loci.indices, (j) => {
      copies++;
      let seen = false;
      let color: number | undefined;
      for (const s of states) {
        let alpha = 0;
        let painted: number | undefined;
        if (s) {
          // the layers are of this list's particles (`particleLayerState` makes them so)
          const has = (l: { loci: unknown }) => OrderedSet.has((l.loci as Particle.Loci).indices, j);
          for (const l of s.transparency.layers) if (has(l)) alpha = l.value;
          for (const l of s.overpaint.layers) if (has(l)) painted = l.color as number;
        }
        if (alpha < 1) {
          seen = true;
          color = painted;
          break;
        }
      }
      if (seen) {
        visible++;
        colors.set(color, (colors.get(color) ?? 0) + 1);
      }
    });
  }
  return { copies, visible, colors };
}

const colorsText = (d: DrawnCopies) => [...d.colors].map(([c, n]) => `${hex(c)}×${n}`).join(', ') || 'none';

/** Every copy of the address drawn and seen (and there are copies). */
function allSeen(c: MesoEvalContext, select: string): EvalCheck {
  const d = drawnCopies(c.v, c.api, select);
  return check(`drawn: ${select} seen`, d.copies > 0 && d.visible === d.copies, () => `${d.visible} of ${d.copies}`);
}

/** No copy of the address seen (a list not drawn at all is not seen either). */
function noneSeen(c: MesoEvalContext, select: string): EvalCheck {
  const d = drawnCopies(c.v, c.api, select);
  return check(`drawn: ${select} hidden`, d.visible === 0, () => `${d.visible} of ${d.copies} still seen`);
}

const docVisible = (c: MesoEvalContext, row: string, want: boolean): EvalCheck => {
  const got = looksOf(c.api).visible(row);
  return check(`document: ${row} ${want ? 'shown' : 'hidden'}`, got === want, () => `visible is ${got}`);
};

// --- the tasks ----------------------------------------------------------------------------------------------------

/**
 * "Catalase" is the population `p.catalase` (the packed copies, the row the outline calls catalase); the picked copies
 * (`p.catalase.observed`, the same entity, amber in the overview) may be colored too or not. The lipids are
 * `p.lipids`. Nothing else is hidden, and nothing else turns red (coloring the whole exosome is a near miss).
 */
const HideLipidsColorCatalase: MesoEvalTask = {
  id: 'hide-lipids-red-catalase',
  title: 'hide the lipids and color catalase red (exosome)',
  document: 'exosome',
  prompts: ['hide the lipids and color catalase red'],
  check(c) {
    const looks = looksOf(c.api);
    const red = looks.color('p.catalase');
    const others = populations(c.api, (p) => p.id !== 'p.lipids' && !p.id.startsWith('p.catalase'));
    const hiddenOthers = others.filter((id) => looks.visible(id) === false);
    const redOthers = others.filter((id) => isRed(looks.color(id)));
    const catalase = drawnCopies(c.v, c.api, '(population p.catalase)');
    const drawnRed = catalase.colors.size === 1 && isRed([...catalase.colors.keys()][0]);
    const rab = drawnCopies(c.v, c.api, '(population p.RAB5A)');
    return [
      docVisible(c, 'p.lipids', false),
      docVisible(c, 'p.catalase', true),
      check('document: p.catalase red', isRed(red), () => `its color is ${hex(red)}`),
      check('document: p.catalase changed color', red !== c.before.colors.get('p.catalase'), () => `still ${hex(red)}`),
      check('document: nothing else hidden', hiddenOthers.length === 0, () => hiddenOthers.join(', ')),
      check('document: nothing else red', redOthers.length === 0, () => redOthers.join(', ')),
      noneSeen(c, '(population p.lipids)'),
      allSeen(c, '(population p.catalase)'),
      check('drawn: p.catalase painted red', drawnRed, () => colorsText(catalase)),
      check(
        'drawn: p.RAB5A not red',
        rab.visible > 0 && ![...rab.colors.keys()].some(isRed),
        () => `${rab.visible} seen, ${colorsText(rab)}`,
      ),
    ];
  },
};

/**
 * The lumen is the exosome's interior: its interior populations shown, the lipids and the plasma around it (the
 * medium's own populations) hidden. The membrane proteins may stay or go: the document's own "Lumen only" view keeps
 * them. Near misses: Show only the exosome (the lipids are in it), hiding the medium only, hiding the lipids only.
 */
const LumenOnly: MesoEvalTask = {
  id: 'lumen-only',
  title: 'show me the lumen only (exosome)',
  document: 'exosome',
  prompts: ['show me the lumen only'],
  check(c) {
    const lumen = populations(c.api, (p) => p.compartment === 'c.exosome' && p.location === 'interior');
    const medium = populations(c.api, (p) => p.compartment === 'medium');
    if (!lumen.length || !medium.length) throw new Error('The exosome has no lumen or no medium populations.');
    const looks = looksOf(c.api);
    const lumenHidden = lumen.filter((id) => looks.visible(id) !== true);
    const mediumShown = medium.filter((id) => looks.visible(id) !== false);
    return [
      docVisible(c, 'p.lipids', false),
      check('document: the medium hidden', mediumShown.length === 0, () => `shown: ${mediumShown.join(', ')}`),
      check('document: the lumen shown', lumenHidden.length === 0, () => `hidden: ${lumenHidden.join(', ')}`),
      noneSeen(c, '(population p.lipids)'),
      noneSeen(c, `(population ${medium.join(' ')})`),
      allSeen(c, `(population ${lumen.join(' ')})`),
    ];
  },
};

/**
 * The camera asked to frame the docked granule (`i.granule-docked`): a Focus on it (its sphere), or a view whose camera
 * targets it. Near misses: all the granules (their sphere is the cell's), the whole slice, the other named granule.
 */
const FrameDockedGranule: MesoEvalTask = {
  id: 'frame-docked-granule',
  title: 'frame the docked granule (β-cell)',
  document: 'beta-cell',
  prompts: ['frame the docked granule'],
  check(c) {
    const want = c.api.model.sphereOf('(instance i.granule-docked)');
    if (!want) throw new Error('The β-cell has no docked granule.');
    const camera = c.api.model.session?.ir?.view.camera;
    const viewChanged = c.api.model.shown !== c.before.shown;
    const asked =
      c.framed.at(-1) ??
      (viewChanged && camera ? { center: camera.target, radius: camera.focus?.radius ?? Infinity } : undefined);
    const dist = asked ? Math.hypot(...asked.center.map((x, i) => x - want.center[i])) : Infinity;
    const at = (s: { center: readonly number[]; radius: number }) =>
      `center [${s.center.map((x) => x.toFixed(0)).join(', ')}], radius ${s.radius.toFixed(0)}`;
    return [
      check('the camera was asked to frame something', !!asked, () => 'no Focus, no view with a camera'),
      check(
        'framed: on the docked granule',
        !!asked && dist <= want.radius * 0.25 && asked.radius <= want.radius * 3,
        () => (asked ? `${at(asked)}; the docked granule: ${at(want)}` : 'nothing'),
      ),
    ];
  },
};

export const MesoAgentEvalTasks: readonly MesoEvalTask[] = [HideLipidsColorCatalase, LumenOnly, FrameDockedGranule];

// --- running one ------------------------------------------------------------------------------------------------

/** The rows whose color a task compares with before. */
const ColorRows = ['p.catalase'];

const exosomeFiles = () => [
  new File([JSON.stringify(ExosomeRecipe)], 'exosome.cellpack-gpu.json'),
  new File([syntheticPicksStar()], 'catalase_picks.star'),
  new File([syntheticVesicleObj()], 'membrane.obj'),
];

/** The β-cell's recipe as a file named by its resource's address (a document's files are by name). */
const betaCellFiles = (doc: MesoViewSpecDoc) =>
  (doc.resources ?? []).flatMap((r) => {
    const make = r.id in BetaCellResources ? BetaCellResources[r.id] : undefined;
    return make && r.uri ? [new File([JSON.stringify(make())], r.uri.slice(r.uri.lastIndexOf('/') + 1))] : [];
  });

/** A headless viewer with the explorer's spec, the task's document opened by the person. */
export async function openForEval(document: EvalDocument): Promise<{ v: PrismViewer; api: MesoViewSpecApi }> {
  const v = await createPrismViewerHeadless({ spec: createMesoscaleExplorerSpec('') });
  const doc = document === 'exosome' ? exosomeDoc() : betaCellDoc();
  const files = document === 'exosome' ? exosomeFiles() : betaCellFiles(doc);
  const r = await v.api.as({ kind: 'person' }).run('mesoviewspec.open', { data: JSON.stringify(doc), files });
  if (!r.ok) throw new Error(`Could not open the ${document}: ${r.message}`);
  return { v, api: (v.api as unknown as { mesoviewspec: MesoViewSpecApi }).mesoviewspec };
}

/** Where two texts part, with some context on each side (a report line, not a diff). */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const at = Math.max(0, i - 80);
  return `at ${i}: was …${a.slice(at, i + 160)}… now …${b.slice(at, i + 160)}…`;
}

function snapshot(v: PrismViewer, api: MesoViewSpecApi): MesoEvalSnapshot {
  const drawn = [...v.plugin.state.data.cells.values()]
    .map(({ transform: t }) => `${t.ref} ${t.transformer.id} ${JSON.stringify(t.params ?? {})}`)
    .sort()
    .join('\n');
  const looks = api.treeState().value?.looks;
  return {
    doc: JSON.stringify(api.model.doc),
    drawn,
    shown: api.model.shown,
    colors: new Map(ColorRows.map((id) => [id, looks?.color(id)])),
  };
}

/**
 * Runs a task: opens its document, runs the turns with Prism's `runEval` (approvals answered Allow), checks the outcome,
 * then takes back each turn the agent made a step in with Undo turn (newest first) and checks the document and the
 * layers are as before. A turn that made no step (a Focus) has nothing to take back: they must be as before already.
 */
export async function runMesoEval<M extends ModelChoice>(
  task: MesoEvalTask,
  o: { readonly models: ModelSource<M>; readonly model?: M },
): Promise<EvalResult> {
  const { v, api } = await openForEval(task.document);
  try {
    const before = snapshot(v, api);
    const framed: { center: readonly number[]; radius: number }[] = [];
    // a headless viewer has no canvas: the camera manager is asked to frame the sphere; the ask is the outcome
    v.plugin.managers.camera.focusSphere = (s) => void framed.push({ center: [...s.center], radius: s.radius });
    const r = await runEval(
      v,
      { id: task.id, title: task.title, prompts: task.prompts, check: () => task.check({ v, api, before, framed }) },
      { models: o.models, ...(o.model ? { model: o.model } : {}) },
    );
    const checks = [...r.checks];
    const turns: string[] = [];
    // the agent's turns in the history (the person's open is the only other step), oldest first
    for (const s of [...v.managers.history.steps.value].sort((a, b) => a.id - b.id))
      if (s.origin.kind === 'agent' && s.origin.turn && !turns.includes(s.origin.turn)) turns.push(s.origin.turn);
    for (const turn of turns.reverse()) {
      const u = await v.api.history.undoTurn({ turn });
      if (!u.ok) checks.push({ name: `Undo turn ${turn}`, pass: false, detail: u.message });
    }
    const after = snapshot(v, api);
    checks.push(
      check('Undo turn restores the document', after.doc === before.doc && after.shown === before.shown, () =>
        after.shown !== before.shown
          ? `the view shown is ${after.shown}, was ${before.shown}`
          : `the document differs: ${firstDifference(before.doc, after.doc)}`,
      ),
      check('Undo turn restores the layers', after.drawn === before.drawn, () =>
        firstDifference(before.drawn, after.drawn),
      ),
    );
    return { ...r, checks, pass: checks.every((x) => x.pass) };
  } finally {
    await v.dispose();
  }
}
