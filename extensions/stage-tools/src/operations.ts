/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Sphere3D } from '@molstar/core/math/geometry';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { StateObjectCell } from '@molstar/core/state';
import type { Clip } from '@molstar/core/util/clip';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { Grid, Volume } from '@molstar/model/model/volume';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { OrderedSet } from '@molstar/core/data/int';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { isEmptyLoci, type Loci } from '@molstar/model/model/loci';
import { ShapeGroup } from '@molstar/model/model/shape';
import { Bond, StructureElement } from '@molstar/model/model/structure';
import { Observable, Subject } from 'rxjs';
import {
  type ApiAreaContext,
  type ApiContext,
  ApiArea,
  type ApiFailure,
  ApiResult,
} from '@molstar/prism-viewer/api/area';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { isFailure, labelOf as structureLabel, loadedStructures } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { type Cut, type CutShape, clipObjectOf, cutOf, defaultCut, flipCut } from './cuts.js';
import { CutGuideLook, CutGuideShape, CutGuideTag } from './guide.js';

// The `stage` area (apps/prism-me/_spec/features.md, "Stage tools"; Stories Untold's cuts): a cut on what the scene
// shows (a structure, a particle list, a volume): a plane, a sphere or a box, Mol*'s clip object on each of its
// representations (`cut`, `adjust`, `uncut`, `cuts`); and the cuts' guides, their shapes drawn translucent (`guides`).
// One cut per target, as in Stories Untold: a new one replaces the old.

/** Something the stage can cut: a structure, a particle list or a volume */
export interface StageTarget {
  readonly ref: string;
  readonly label: string;
  readonly kind: 'structure' | 'particles' | 'volume';
}

export interface CutInfo extends StageTarget {
  readonly cut?: Cut;
  /** Where the cut is along its normal, as a fraction of the target's radius from its center (−1 to 1) */
  readonly offset?: number;
  /** The target's radius */
  readonly reach: number;
}

const TargetParam = () =>
  PD.Text('', {
    description: 'A structure, particle list or volume by label or state ref; empty: the only one shown, or all',
  });

/** What a right-click on the canvas picked, for the stage's menu */
export type StagePick =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'guide'; readonly target: StageTarget }
  | {
      readonly kind: 'target';
      readonly target: StageTarget;
      /** The picked particle's target id and entity index (its target id on a list without entities) */
      readonly particle?: { readonly target: number; readonly entity: number; readonly name: string };
    };

/** A right-click on the canvas (no drag): where (client px) and what it picked */
export interface StageMenuRequest {
  readonly x: number;
  readonly y: number;
  readonly pick: StagePick;
  /** Centers the camera on what was picked */
  readonly focus: () => void;
  /** The canvas: the menu opens in the app's root around it (which may be in a shadow root) */
  readonly anchor?: Element;
}

export class StageApi extends ApiArea {
  readonly id = 'stage';

  private readonly requests = new Subject<StageMenuRequest>();
  /** The right-clicks on the canvas (the stage's menu opens on them) */
  readonly menuRequests: Observable<StageMenuRequest> = this.requests.asObservable();

  constructor(ctx: ApiAreaContext) {
    super(ctx);
    const plugin = ctx.plugin;
    plugin.behaviors.interaction.click.subscribe((e) => {
      if (e.button !== ButtonsType.Flag.Secondary || !e.page) return;
      const loci = e.current.loci;
      this.requests.next({
        x: e.page[0] - window.scrollX,
        y: e.page[1] - window.scrollY,
        pick: pickOf({ plugin }, loci),
        focus: () => {
          if (!isEmptyLoci(loci)) plugin.managers.camera.focusLoci(loci);
        },
        anchor: plugin.canvas3dContext?.canvas ?? undefined,
      });
    });
  }

  /** A target's cut as shown, following the state tree while watched: a read for views */
  cutState(target: string): ReadonlyState<CutInfo | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const t = stageTargets({ plugin }).find((x) => x.ref === target);
        return t ? describe({ plugin }, t) : undefined;
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** Whether anything is cut */
  hasCuts(): boolean {
    return guideCells({ plugin: this.ctx.plugin }).length > 0;
  }

  /** Whether the cuts' guides are shown */
  guidesState(): ReadonlyState<boolean> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => guideCells({ plugin }).some((c) => !c.state.isHidden),
      () => plugin.state.data.events.changed,
    );
  }

  readonly cuts = this.operation({
    id: 'stage.cuts',
    title: 'Describe the cuts',
    params: {},
    read: true,
    async run(_, ctx) {
      const infos = stageTargets(ctx).map((t) => describe(ctx, t));
      const cut = infos.filter((i) => i.cut);
      const lines = cut.map((i) => `${i.label}: ${i.cut!.shape}${i.cut!.invert ? ' (inside kept)' : ''}`);
      return ApiResult.ok(cut.length ? lines.join('\n') : 'Nothing is cut.', {}, { value: infos });
    },
  });

  readonly cut = this.operation({
    id: 'stage.cut',
    title: 'Cut open…',
    params: {
      shape: PD.Select<CutShape>('plane', [
        ['plane', 'A plane facing the camera, through the center'],
        ['sphere', 'A sphere, a window on the near side'],
        ['box', 'A box, a window on the near side'],
      ]),
      target: TargetParam(),
    },
    async run({ shape, target }, ctx) {
      const targets = pickTargets(ctx, target);
      if (isFailure(targets)) return targets;
      const view = viewDirection(ctx);
      const nodes: string[] = [];
      for (const t of targets) {
        const cut = defaultCut(shape, boundsOf(ctx, t)!, view);
        nodes.push(...(await setCut(ctx, t, cut)));
      }
      return ApiResult.ok(`Cut ${names(targets)} open with a ${shape}.`, { nodes });
    },
  });

  readonly adjust = this.operation({
    id: 'stage.adjust',
    title: 'Adjust a cut',
    params: {
      offset: OptionalParam(
        PD.Numeric(
          0,
          { min: -1, max: 1, step: 0.01 },
          { description: 'Along its normal, from the center: −1 to 1 radius' },
        ),
      ),
      size: OptionalParam(
        PD.Numeric(
          0.6,
          { min: 0.05, max: 2, step: 0.01 },
          { description: "A sphere's or box's size, in the target's radius" },
        ),
      ),
      flip: PD.Boolean(false, { description: 'Cut the other side (a plane), keep the inside (a sphere, a box)' }),
      target: TargetParam(),
    },
    async run(values, ctx) {
      const { flip, target } = values;
      const { offset, size } = values as typeof values & { offset?: number; size?: number };
      const targets = pickTargets(ctx, target, true);
      if (isFailure(targets)) return targets;
      const nodes: string[] = [];
      for (const t of targets) {
        const info = describe(ctx, t);
        if (!info.cut) continue;
        const bounds = boundsOf(ctx, t)!;
        let cut = info.cut;
        if (offset !== undefined) {
          const n = Vec3.normalize(Vec3(), Vec3.create(...cut.normal));
          const c = Vec3.scaleAndAdd(Vec3(), bounds.center, n, offset * info.reach);
          cut = { ...cut, center: [c[0], c[1], c[2]] };
        }
        if (size !== undefined && cut.shape !== 'plane') {
          const s = size * info.reach;
          cut = { ...cut, radius: s, size: [s, s, s] };
        }
        if (flip) cut = flipCut(cut);
        nodes.push(...(await setCut(ctx, t, cut)));
      }
      if (!nodes.length) return ApiResult.already('Nothing to adjust: it is not cut.');
      return ApiResult.ok(`Adjusted the cut of ${names(targets)}.`, { nodes });
    },
  });

  readonly uncut = this.operation({
    id: 'stage.uncut',
    title: 'Remove a cut',
    params: { target: TargetParam() },
    async run({ target }, ctx) {
      const targets = pickTargets(ctx, target, true);
      if (isFailure(targets)) return targets;
      const cut = targets.filter((t) => describe(ctx, t).cut);
      if (!cut.length) return ApiResult.already('Nothing is cut.');
      const nodes: string[] = [];
      for (const t of cut) nodes.push(...(await setCut(ctx, t, undefined)));
      return ApiResult.ok(`Removed the cut of ${names(cut)}.`, { nodes });
    },
  });

  readonly guides = this.operation({
    id: 'stage.guides',
    title: 'Show or hide the cuts',
    params: { visible: PD.Boolean(true, { description: 'Show the shapes of the cuts' }) },
    async run({ visible }, ctx) {
      const cells = guideCells(ctx);
      if (!cells.length) return ApiResult.already('Nothing is cut.');
      const todo = cells.filter((c) => !!c.state.isHidden === visible);
      if (!todo.length) return ApiResult.already(`The cuts are already ${visible ? 'shown' : 'hidden'}.`);
      for (const c of todo) ctx.plugin.state.data.updateCellState(c.transform.ref, { isHidden: !visible });
      return ApiResult.ok(`${visible ? 'Showed' : 'Hid'} the cuts.`, { nodes: todo.map((c) => c.transform.ref) });
    },
  });
}

// --- picks ---------------------------------------------------------------------------------------------------------

/** The target a picked loci belongs to: its structure (the root of a component's), particle list or volume */
function pickOf(ctx: Pick<ApiContext, 'plugin'>, loci: Loci): StagePick {
  if (isEmptyLoci(loci)) return { kind: 'nothing' };
  const targets = stageTargets(ctx);
  const cells = ctx.plugin.state.data.cells;
  if (StructureElement.Loci.is(loci) || Bond.isLoci(loci)) {
    const root = ctx.plugin.helpers.substructureParent.get(loci.structure);
    const t = targets.find((x) => x.ref === root?.transform.ref);
    if (t) return { kind: 'target', target: t };
  }
  if (Particle.isLoci(loci)) {
    for (const t of targets) {
      if (t.kind !== 'particles') continue;
      const l = ctx.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === t.ref);
      const datas = [l?.cell.obj?.data, ...(l?.representations.map((r) => r.cell.obj?.data.sourceData) ?? [])];
      if (!datas.includes(loci.particles)) continue;
      const i = OrderedSet.getAt(loci.indices, 0);
      const target = loci.particles.targets[i];
      // a list without entities has one per target (as the mesoscale area counts them)
      const entity = loci.particles.entityInfo ? Particle.entityOf(loci.particles, i) : target;
      const name =
        loci.particles.entityInfo?.get(entity)?.name ??
        loci.particles.targetInfo.get(target)?.name ??
        `Target ${target}`;
      return { kind: 'target', target: t, particle: { target, entity, name } };
    }
  }
  if (
    Volume.isLoci(loci) ||
    Volume.Isosurface.isLoci(loci) ||
    Volume.Cell.isLoci(loci) ||
    Volume.Segment.isLoci(loci)
  ) {
    const t = targets.find((x) => x.kind === 'volume' && cells.get(x.ref)?.obj?.data === loci.volume);
    if (t) return { kind: 'target', target: t };
  }
  if (ShapeGroup.isLoci(loci)) {
    const guide = guideCells(ctx).find((c) => (c.obj?.data as any)?.data === loci.shape.sourceData);
    const t = guide && targets.find((x) => x.ref === guide.transform.params?.target);
    if (t) return { kind: 'guide', target: t };
  }
  return { kind: 'nothing' };
}

// --- targets ------------------------------------------------------------------------------------------------------

/** What the stage can cut: the loaded structures (named as the viewer names them), particle lists and volumes */
export function stageTargets(ctx: Pick<ApiContext, 'plugin'>): StageTarget[] {
  const out: StageTarget[] = [];
  for (const s of loadedStructures(ctx))
    out.push({ ref: s.cell.transform.ref, label: structureLabel(ctx, s), kind: 'structure' });
  for (const l of ctx.plugin.managers.particles.hierarchy.current.lists) {
    out.push({ ref: l.cell.transform.ref, label: l.cell.obj?.label ?? l.cell.transform.ref, kind: 'particles' });
  }
  for (const v of ctx.plugin.managers.volume.hierarchy.current.volumes) {
    out.push({ ref: v.cell.transform.ref, label: v.cell.obj?.label ?? v.cell.transform.ref, kind: 'volume' });
  }
  return out;
}

function pickTargets(ctx: ApiContext, name: string, cutOnly = false): StageTarget[] | ApiFailure {
  const all = stageTargets(ctx);
  if (!all.length) return ApiResult.fail('not-found', 'Nothing is loaded.', 'Open a structure, particles or a volume.');
  const n = name.trim().toLowerCase();
  if (n === 'all' || n === 'everything') return all;
  if (!n) {
    if (cutOnly) {
      const cut = all.filter((t) => describe(ctx, t).cut);
      if (cut.length) return cut;
    }
    if (all.length === 1) return all;
    return all;
  }
  const found = all.filter((t) => t.ref === name.trim() || t.label.toLowerCase() === n);
  if (!found.length) {
    return ApiResult.fail(
      'not-found',
      `Nothing is named '${name}'.`,
      `Targets: ${all.map((t) => t.label).join(', ')}.`,
    );
  }
  return found;
}

const names = (targets: readonly StageTarget[]) =>
  targets.length <= 3 ? targets.map((t) => t.label).join(', ') : `${targets.length} objects`;

/** The representations that draw a target */
function representationCells(ctx: Pick<ApiContext, 'plugin'>, t: StageTarget): StateObjectCell[] {
  const p = ctx.plugin.managers;
  if (t.kind === 'structure') {
    const s = p.structure.hierarchy.current.structures.find((x) => x.cell.transform.ref === t.ref);
    return s ? s.components.flatMap((c) => c.representations.map((r) => r.cell)) : [];
  }
  if (t.kind === 'particles') {
    const l = p.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === t.ref);
    return l ? l.representations.map((r) => r.cell) : [];
  }
  const v = p.volume.hierarchy.current.volumes.find((x) => x.cell.transform.ref === t.ref);
  return v ? v.representations.map((r) => r.cell) : [];
}

function boundsOf(ctx: Pick<ApiContext, 'plugin'>, t: StageTarget): Sphere3D | undefined {
  const cell = ctx.plugin.state.data.cells.get(t.ref);
  const obj = cell?.obj?.data as any;
  if (!obj) return;
  if (t.kind === 'structure') return obj.boundary.sphere;
  if (t.kind === 'particles') return Particle.getBoundary(obj).sphere;
  return Grid.getBoundingSphere(obj.grid);
}

/** From the camera to its target; down −z without a canvas */
function viewDirection(ctx: Pick<ApiContext, 'plugin'>): Vec3 {
  const camera = ctx.plugin.canvas3d?.camera;
  if (!camera) return Vec3.create(0, 0, -1);
  return Vec3.normalize(Vec3(), Vec3.sub(Vec3(), camera.state.target, camera.state.position));
}

function clipOf(cell: StateObjectCell): Clip.Props | undefined {
  return (cell.transform.params as any)?.type?.params?.clip;
}

function describe(ctx: Pick<ApiContext, 'plugin'>, t: StageTarget): CutInfo {
  const bounds = boundsOf(ctx, t);
  const reach = Math.max(bounds?.radius ?? 1, 1);
  const first = representationCells(ctx, t)
    .map(clipOf)
    .find((c) => c?.objects.length);
  const cut = first ? cutOf(first.objects[0], reach) : undefined;
  let offset: number | undefined;
  if (cut && bounds) {
    const d = Vec3.sub(Vec3(), Vec3.create(...cut.center), bounds.center);
    offset = Math.round((Vec3.dot(d, Vec3.normalize(Vec3(), Vec3.create(...cut.normal))) / reach) * 100) / 100;
  }
  return { ...t, reach, ...(cut ? { cut } : {}), ...(offset !== undefined ? { offset } : {}) };
}

function guideCells(ctx: Pick<ApiContext, 'plugin'>): StateObjectCell[] {
  return Array.from(ctx.plugin.state.data.cells.values()).filter((c) => c.transform.transformer === CutGuideShape);
}

/** Puts the cut (none: removes it) on every representation of the target and its guide; the refs changed */
async function setCut(ctx: ApiContext, t: StageTarget, cut: Cut | undefined): Promise<string[]> {
  const clip: Clip.Props = { variant: 'pixel', objects: cut ? [clipObjectOf(cut)] : [] };
  const b = ctx.plugin.state.data.build();
  const nodes: string[] = [];
  for (const cell of representationCells(ctx, t)) {
    b.to(cell).update((old: any) => ({ ...old, type: { ...old.type, params: { ...old.type.params, clip } } }));
    nodes.push(cell.transform.ref);
  }
  const guide = guideCells(ctx).find((c) => c.transform.params?.target === t.ref);
  if (!cut) {
    if (guide) b.delete(guide.transform.ref);
  } else if (guide) {
    b.to(guide).update({ cut, target: t.ref });
  } else {
    const shown = guideCells(ctx).every((c) => !c.state.isHidden);
    b.toRoot()
      .apply(CutGuideShape, { cut, target: t.ref }, { tags: [CutGuideTag], state: { isHidden: !shown } })
      .apply(ShapeRepresentation3D, CutGuideLook as never);
  }
  await b.commit();
  return nodes;
}
