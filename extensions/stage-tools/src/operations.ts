/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { ParticleListTransform } from '@molstar/plugin/state/transforms/particles/ops';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import { movedClipObject, movedPoint } from './move.js';
import { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { setSubtreeVisibility } from '@molstar/plugin/behavior/static/state';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { type StateObjectCell, StateTransform } from '@molstar/core/state';
import { Clip } from '@molstar/core/util/clip';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Particle } from '@molstar/model/model/particles/particle-list';
import { Grid, Volume } from '@molstar/model/model/volume';
import {
  type ParticleCutProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';
import { ValueCell } from '@molstar/core/util/value-cell';
import { OrderedSet } from '@molstar/core/data/int';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { isEmptyLoci, Loci } from '@molstar/model/model/loci';
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
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { StageLabel, type StageLabelProps } from './label.js';
import { type Cut, type CutShape, clipObjectOf, cutOf, defaultCut, flipCut, type ScreenFrame } from './cuts.js';
import { type CutGuideData, CutGuides, isCutGuideData } from './guide.js';

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
  | { readonly kind: 'guide'; readonly target: StageTarget; readonly index: number }
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
  /** What the click picked, as Mol* has it (a host's menu reads its own level from it) */
  readonly loci: Loci;
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

  /** The guides hidden one by one (`target:index`), a view aid of the canvas */
  private readonly hiddenGuides = observableState<ReadonlySet<string>>(new Set());

  /** Whether one cut's guide is shown */
  guideShownState(target: string, index: number): ReadonlyState<boolean> {
    return mapState(this.hiddenGuides.asReadonly, (h) => !h.has(`${target}:${index}`));
  }

  /** Shows or hides one cut's guide (no history step: a view aid) */
  setGuideShown(target: string, index: number, shown: boolean) {
    const key = `${target}:${index}`;
    const next = new Set(this.hiddenGuides.value);
    if (shown) next.delete(key);
    else next.add(key);
    this.hiddenGuides.set(next);
    void this.guideVisuals.sync(desiredGuides({ plugin: this.ctx.plugin }, next));
  }

  /**
   * A target's cuts of the whole object (after the cuts of some of its particles), with their index among its clip
   * objects, following the state tree while watched
   */
  wholeCutsState(
    target: string,
  ): ReadonlyState<readonly { readonly index: number; readonly object: Clip.Props['objects'][number] }[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const t = stageTargets({ plugin }).find((x) => x.ref === target);
        const cell = t && representationCells({ plugin }, t)[0];
        if (!cell) return [];
        const partial = partialCuts({ plugin }, cell);
        return (clipOf(cell)?.objects ?? []).flatMap((object, index) => (index >= partial ? [{ index, object }] : []));
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** A host opens its own menu on the right-clicks (the stage's then opens none) */
  menuHosted = false;

  /** The cuts' guides on the canvas, following the state */
  readonly guideVisuals: CutGuides;
  private readonly guidesShown = observableState(true);

  constructor(ctx: ApiAreaContext) {
    super(ctx);
    const plugin = ctx.plugin;
    this.guideVisuals = new CutGuides(plugin);
    // the guides follow the cuts: synced once after each change of the state
    let queued = false;
    plugin.state.data.events.changed.subscribe(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        void this.guideVisuals.sync(desiredGuides({ plugin }, this.hiddenGuides.value));
      }, 0);
    });
    plugin.behaviors.interaction.click.subscribe((e) => {
      if (e.button !== ButtonsType.Flag.Secondary || !e.page) return;
      const loci = e.current.loci;
      this.requests.next({
        x: e.page[0] - window.scrollX,
        y: e.page[1] - window.scrollY,
        pick: pickOf({ plugin }, loci),
        loci,
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

  /** Whether anything is cut (a cut of a whole object or of some of its entities) */
  hasCuts(): boolean {
    return desiredGuides({ plugin: this.ctx.plugin }).length > 0;
  }

  /** Whether anything is cut, following the state tree while watched: a read for views */
  anyCutState(): ReadonlyState<boolean> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => desiredGuides({ plugin }).length > 0,
      () => plugin.state.data.events.changed,
    );
  }

  /** Whether the cuts' guides are shown */
  guidesState(): ReadonlyState<boolean> {
    return this.guidesShown.asReadonly;
  }

  /** The clip object `index` of a target's first representation */
  clipObject(target: string, index: number) {
    const t = stageTargets({ plugin: this.ctx.plugin }).find((x) => x.ref === target);
    const cell = t && representationCells({ plugin: this.ctx.plugin }, t)[0];
    return cell ? clipOf(cell)?.objects[index] : undefined;
  }

  /** Whether the clip object `index` of a target is a cut of some of its particles (an entity's) */
  isPartialCut(target: string, index: number): { entities: number[] } | undefined {
    const plugin = this.ctx.plugin;
    const t = stageTargets({ plugin }).find((x) => x.ref === target);
    const cell = t && representationCells({ plugin }, t)[0];
    if (!cell) return;
    const cuts = partialCutSelectors({ plugin }, cell);
    const c = cuts[index];
    return c ? { entities: c.entities.length ? [...c.entities] : [...c.targets] } : undefined;
  }

  /**
   * Shows a clip object as it would be, without changing the state: its uniforms on every representation of the
   * target and its guide (a drag's preview, at pointer rate; the drag's end commits it with \`object\`)
   */
  previewObject(target: string, index: number, object: Clip.Props['objects'][number]) {
    const plugin = this.ctx.plugin;
    const t = stageTargets({ plugin }).find((x) => x.ref === target);
    if (!t) return;
    for (const cell of representationCells({ plugin }, t)) {
      const clip = clipOf(cell);
      const repr = (cell.obj as { data?: { repr?: { renderObjects: readonly any[] } } } | undefined)?.data?.repr;
      if (!clip || !repr || index >= clip.objects.length) continue;
      const objects = clip.objects.slice();
      objects[index] = object;
      const values = Clip.getClip({ variant: clip.variant, objects });
      for (const ro of repr.renderObjects) {
        for (const r of [ro, ...((ro as { members?: any[] }).members ?? [])]) setClipUniforms(r.values, values);
      }
    }
    const bounds = boundsOf({ plugin }, t);
    void this.guideVisuals.set({
      kind: 'stage-tools-cut-guide',
      target,
      index,
      object,
      reach: Math.max(bounds?.radius ?? 1, 1),
    });
    plugin.canvas3d?.requestDraw();
  }

  /** The camera as a drag on the screen needs it, at a point of the scene */
  screenFrame(at: Vec3): ScreenFrame {
    const camera = this.ctx.plugin.canvas3d?.camera;
    if (!camera) return { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), pixel: 1 };
    const { position, target, up, fov } = camera.state;
    const forward = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), target, position));
    const right = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), forward, up));
    const screenUp = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), right, forward));
    const depth = Math.max(Vec3.dot(Vec3.sub(Vec3(), at, position), forward), 1);
    const height = this.ctx.plugin.canvas3dContext?.canvas?.clientHeight || camera.viewport.height || 1;
    return { right, up: screenUp, pixel: (2 * depth * Math.tan(fov / 2)) / height };
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
      add: PD.Boolean(false, { description: 'A cut besides its others (else it replaces them)' }),
      target: TargetParam(),
    },
    async run({ shape, add, target }, ctx) {
      const targets = pickTargets(ctx, target);
      if (isFailure(targets)) return targets;
      const view = viewDirection(ctx);
      const nodes: string[] = [];
      for (const t of targets) {
        const cut = defaultCut(shape, boundsOf(ctx, t)!, view);
        nodes.push(...(await setCut(ctx, t, cut, add ? 'add' : 'replace')));
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
    params: {
      index: OptionalParam(
        PD.Numeric(
          0,
          { min: 0, max: 15, step: 1 },
          { description: 'Only this cut (stage.cuts lists them); absent: all' },
        ),
      ),
      target: TargetParam(),
    },
    async run(values, ctx) {
      const { target } = values;
      const { index } = values as typeof values & { index?: number };
      const targets = pickTargets(ctx, target, true);
      if (isFailure(targets)) return targets;
      const cut = targets.filter((t) => describe(ctx, t).cut);
      if (!cut.length) return ApiResult.already('Nothing is cut.');
      const nodes: string[] = [];
      for (const t of cut) nodes.push(...(await setCut(ctx, t, undefined, index === undefined ? 'replace' : index)));
      return ApiResult.ok(`Removed the cut of ${names(cut)}.`, { nodes });
    },
  });

  /** Where an object is (its center, its radius): a structure, a particle list, a volume, a mesh's representation */
  objectBounds(target: string): Sphere3D | undefined {
    const plugin = this.ctx.plugin;
    const t = stageTargets({ plugin }).find((x) => x.ref === target);
    if (t) return boundsOf({ plugin }, t);
    const obj = plugin.state.data.cells.get(target)?.obj;
    if (!SO.Shape.Representation3D.is(obj)) return undefined;
    const loci = obj.data.repr.getAllLoci()[0];
    return loci ? Loci.getBoundingSphere(loci) : undefined;
  }

  /**
   * An object drawn moved by `m` (the drawing only, the state unchanged): its representations and its labels', as a drag
   * goes; the identity puts them back
   */
  previewMove(target: string, m: Mat4) {
    const plugin = this.ctx.plugin;
    const { cells, tree } = plugin.state.data;
    const reprs: string[] = [];
    const walk = (ref: string) => {
      const obj = cells.get(ref)?.obj;
      if (SO.isRepresentation3D(obj)) reprs.push(ref);
      for (const child of tree.children.get(ref).toArray()) walk(child);
    };
    walk(target);
    for (const l of labelsOf({ plugin })) if (l.target === target) walk(l.ref);
    for (const ref of reprs) {
      const obj = cells.get(ref)?.obj as { data: { repr: { setState(s: { transform: Mat4 }): void } } } | undefined;
      obj?.data.repr.setState({ transform: m });
    }
    plugin.canvas3d?.requestDraw();
  }

  readonly move = this.operation({
    id: 'stage.move',
    title: 'Move or turn an object',
    params: {
      target: PD.Text('', { description: 'A structure, particle list, volume or mesh, by state ref' }),
      matrix: PD.Value<number[]>(Array.from(Mat4.identity()), {
        description: 'A rigid transform (16 numbers, column-major), applied after where it is now',
      }),
    },
    async run({ target, matrix }, ctx) {
      const m = Mat4.fromArray(Mat4(), matrix, 0);
      if (Mat4.isIdentity(m)) return ApiResult.already('Not moved.');
      const plugin = ctx.plugin;
      const { cells, tree } = plugin.state.data;
      const cell = cells.get(target);
      if (!cell) return ApiResult.fail('not-found', `There is no object '${target}'.`);
      const t = stageTargets(ctx).find((x) => x.ref === target);
      const b = plugin.state.data.build();
      const decoratorUnder = (ref: string, transformer: unknown) =>
        tree.children
          .get(ref)
          .toArray()
          .map((c) => cells.get(c))
          .find((c) => c?.transform.transformer === transformer);
      const name = rootLabel(ctx, target) ?? cell.obj?.label ?? target;
      if (t?.kind === 'structure') {
        // the structure's own transform (Prism's, as its Move does), on top of where it is
        const r = await ctx.api.run('structure.transform', { structure: target, matrix: m, compose: true });
        if (!r.ok) return r;
      } else if (t?.kind === 'particles') {
        const l = plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === target)!;
        const old = decoratorUnder(l.cell.transform.ref, ParticleListTransform);
        if (old) {
          const prev = (old.transform.params as { transform: Mat4 }).transform;
          b.to(old).update({ transform: Mat4.mul(Mat4(), m, prev) });
        } else {
          b.to(l.cell).insert(ParticleListTransform, { transform: m });
        }
      } else if (t?.kind === 'volume') {
        const old = decoratorUnder(target, VolumeTransform);
        const prev = old ? volumeMatrixOf(old) : Mat4.identity();
        const transform = { name: 'matrix' as const, params: { data: Mat4.mul(Mat4(), m, prev), transpose: false } };
        if (old) b.to(old).update({ transform });
        else b.to(cell).insert(VolumeTransform, { transform });
      } else if (SO.Shape.Representation3D.is(cell.obj)) {
        // a mesh: its shape's instance transform (its scale kept)
        const shape = cells.get(cell.transform.parent);
        if (!shape || !SO.Shape.Provider.is(shape.obj)) return ApiResult.fail('blocked', `${name} cannot be moved.`);
        b.to(shape).update((p: any) => {
          const prev: Mat4 = p.transforms?.[0] ?? Mat4.identity();
          return { ...p, transforms: [Mat4.mul(Mat4(), m, prev)] };
        });
      } else {
        return ApiResult.fail('invalid', `${name} is not a structure, particle list, volume or mesh.`);
      }
      // what is placed with it: its clip objects and its labels
      if (t) {
        for (const r of representationCells(ctx, t)) {
          const clip = clipOf(r);
          if (!clip?.objects.length) continue;
          const objects = clip.objects.map((o) => movedClipObject(o, m));
          b.to(r).update((old: any) => ({
            ...old,
            type: { ...old.type, params: { ...old.type.params, clip: { ...old.type.params.clip, objects } } },
          }));
        }
      }
      for (const l of labelsOf(ctx)) {
        if (l.target !== target) continue;
        b.to(l.ref).update((p: StageLabelProps) => ({ ...p, position: movedPoint(Vec3.create(...l.position), m) }));
      }
      await b.commit();
      return ApiResult.ok(`Moved ${name}.`, { nodes: [target] });
    },
  });

  /** The labels of the stage, following the state tree while watched: a read for views */
  labelsState(): ReadonlyState<readonly LabelInfo[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => labelsOf({ plugin }),
      () => [plugin.state.data.events.changed, plugin.state.data.events.cell.stateUpdated],
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly label = this.operation({
    id: 'stage.label',
    title: 'Add a label',
    params: {
      text: PD.Text('Label', { description: 'What it says (plain text)' }),
      target: PD.Text('', { description: 'The object it names, by state ref (its place: in front of it)' }),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'Where (Å); absent: in front of its target' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      depth: OptionalParam(PD.Numeric(0, { min: 0 }, { description: 'Brought toward the camera by this much (Å)' })),
      size: OptionalParam(PD.Numeric(4, { min: 0.5, max: 100 }, { description: 'Its height (Å)' })),
      color: OptionalParam(PD.Text('white', { description: 'A CSS color' })),
      node: PD.Text('', { description: "The explorer's row it is listed under (its key)" }),
    },
    async run(values, ctx) {
      const v = values as typeof values &
        Partial<Record<'x' | 'y' | 'z' | 'depth' | 'size', number>> & { color?: string };
      const t = stageTargets(ctx).find((x) => x.ref === v.target);
      const bounds = t ? boundsOf(ctx, t) : undefined;
      if (v.x === undefined && !bounds) {
        return ApiResult.fail('invalid', 'Where?', 'Give x, y, z, or a target (a structure, particle list or volume).');
      }
      const radius = Math.max(bounds?.radius ?? 10, 1);
      const position = Vec3.create(v.x ?? bounds!.center[0], v.y ?? bounds!.center[1], v.z ?? bounds!.center[2]);
      const color = v.color ? cssColor(v.color) : Color(0xffffff);
      if (color === undefined) return ApiResult.fail('invalid', `'${v.color}' is not a color.`);
      const b = ctx.plugin.state.data.build();
      const label = b.toRoot().apply(StageLabel, {
        text: v.text || 'Label',
        position,
        depth: v.depth ?? (v.x === undefined ? radius : 0),
        size: v.size ?? Math.min(100, Math.max(2, radius / 12)),
        color,
        target: v.target,
        node: v.node,
      });
      label.apply(ShapeRepresentation3D, {});
      await b.commit();
      return ApiResult.ok(`Added the label "${v.text}".`, { nodes: [label.ref] });
    },
  });

  readonly editLabel = this.operation({
    id: 'stage.editLabel',
    title: 'Change a label',
    params: {
      label: PD.Text('', { description: 'The label, by state ref (stage labels lists them)' }),
      text: OptionalParam(PD.Text('', { description: 'What it says' })),
      size: OptionalParam(PD.Numeric(4, { min: 0.5, max: 100 }, { description: 'Its height (Å)' })),
      color: OptionalParam(PD.Text('white', { description: 'A CSS color' })),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'Where (Å)' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      visible: OptionalParam(PD.Boolean(true)),
      remove: PD.Boolean(false, { description: 'Remove it' }),
    },
    async run(values, ctx) {
      const v = values as typeof values &
        Partial<Record<'x' | 'y' | 'z' | 'size', number>> & { text?: string; color?: string; visible?: boolean };
      const cell = ctx.plugin.state.data.cells.get(v.label);
      if (!cell || cell.transform.transformer !== StageLabel) {
        return ApiResult.fail('not-found', `There is no label '${v.label}'.`);
      }
      const name = (cell.transform.params as StageLabelProps).text;
      if (v.remove) {
        await ctx.plugin.state.data.build().delete(v.label).commit();
        return ApiResult.ok(`Removed the label "${name}".`, { nodes: [v.label] });
      }
      const color = v.color ? cssColor(v.color) : undefined;
      if (v.color && color === undefined) return ApiResult.fail('invalid', `'${v.color}' is not a color.`);
      const old = cell.transform.params as StageLabelProps;
      const next: StageLabelProps = {
        ...old,
        ...(v.text !== undefined ? { text: v.text } : {}),
        ...(v.size !== undefined ? { size: v.size } : {}),
        ...(color !== undefined ? { color } : {}),
        position:
          v.x !== undefined || v.y !== undefined || v.z !== undefined
            ? Vec3.create(v.x ?? old.position[0], v.y ?? old.position[1], v.z ?? old.position[2])
            : old.position,
      };
      const nodes: string[] = [];
      if (JSON.stringify(next) !== JSON.stringify(old)) {
        await ctx.plugin.state.data.build().to(cell).update(next).commit();
        nodes.push(v.label);
      }
      if (v.visible !== undefined && v.visible === !!cell.state.isHidden) {
        setSubtreeVisibility(ctx.plugin.state.data, v.label, !v.visible);
        nodes.push(v.label);
      }
      if (!nodes.length) return ApiResult.already('The label is already so.');
      return ApiResult.ok(`Changed the label "${next.text}".`, { nodes });
    },
  });

  readonly guides = this.operation({
    id: 'stage.guides',
    title: 'Show or hide the cuts',
    params: { visible: PD.Boolean(true, { description: 'Show the shapes of the cuts' }) },
    // a view aid of the canvas, not of the scene: no history step
    history: false,
    run: async ({ visible }) => {
      if (this.guidesShown.value === visible) {
        return ApiResult.already(`The cuts are already ${visible ? 'shown' : 'hidden'}.`);
      }
      this.guidesShown.set(visible);
      this.guideVisuals.setVisible(visible);
      return ApiResult.ok(`${visible ? 'Showed' : 'Hid'} the cuts.`, { view: true });
    },
  });

  readonly object = this.operation({
    id: 'stage.object',
    title: 'Move, turn or size a cut',
    params: {
      target: TargetParam(),
      index: PD.Numeric(0, { min: 0, max: 15, step: 1 }, { description: 'Which of its cuts (stage.cuts lists them)' }),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'Where, in Å' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      axisX: OptionalParam(PD.Numeric(1, {}, { description: 'Turned about this axis' })),
      axisY: OptionalParam(PD.Numeric(0)),
      axisZ: OptionalParam(PD.Numeric(0)),
      angle: OptionalParam(PD.Numeric(0, { min: -180, max: 180 }, { description: 'By this angle, degrees' })),
      sx: OptionalParam(PD.Numeric(1, { min: 0 }, { description: 'Its size, in Å (a sphere: its diameter)' })),
      sy: OptionalParam(PD.Numeric(1, { min: 0 })),
      sz: OptionalParam(PD.Numeric(1, { min: 0 })),
      invert: OptionalParam(PD.Boolean(false, { description: 'Keep the inside (or the other side) instead' })),
    },
    async run(values, ctx) {
      const v = values as typeof values &
        Partial<Record<'x' | 'y' | 'z' | 'axisX' | 'axisY' | 'axisZ' | 'angle' | 'sx' | 'sy' | 'sz', number>> & {
          invert?: boolean;
        };
      const targets = pickTargets(ctx, v.target, true);
      if (isFailure(targets)) return targets;
      if (targets.length !== 1) {
        return ApiResult.fail('ambiguous', 'Which object?', `Targets: ${targets.map((t) => t.label).join(', ')}.`);
      }
      const t = targets[0];
      const cells = representationCells(ctx, t);
      const old = cells.length ? clipOf(cells[0])?.objects[v.index] : undefined;
      if (!old) return ApiResult.fail('not-found', `${t.label} has no cut ${v.index}.`, 'List them with stage.cuts.');
      const object: Clip.Props['objects'][number] = {
        ...old,
        position: Vec3.create(v.x ?? old.position[0], v.y ?? old.position[1], v.z ?? old.position[2]),
        rotation: {
          axis: Vec3.create(
            v.axisX ?? old.rotation.axis[0],
            v.axisY ?? old.rotation.axis[1],
            v.axisZ ?? old.rotation.axis[2],
          ),
          angle: v.angle ?? old.rotation.angle,
        },
        scale: Vec3.create(v.sx ?? old.scale[0], v.sy ?? old.scale[1], v.sz ?? old.scale[2]),
        invert: v.invert ?? old.invert,
      };
      if (JSON.stringify(object) === JSON.stringify(old)) return ApiResult.already('The cut is already so.');
      const b = ctx.plugin.state.data.build();
      for (const cell of cells) {
        const clip = clipOf(cell);
        if (!clip || v.index >= clip.objects.length) continue;
        const objects = clip.objects.slice();
        objects[v.index] = object;
        b.to(cell).update((p: any) => ({
          ...p,
          type: { ...p.type, params: { ...p.type.params, clip: { ...clip, objects } } },
        }));
      }
      await b.commit();
      return ApiResult.ok(`Moved the cut of ${t.label}.`, { nodes: cells.map((c) => c.transform.ref) });
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
  if (ShapeGroup.isLoci(loci) && isCutGuideData(loci.shape.sourceData)) {
    const { target, index } = loci.shape.sourceData;
    const t = targets.find((x) => x.ref === target);
    if (t) return { kind: 'guide', target: t, index };
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

/** A label of the stage, as views list it */
export interface LabelInfo {
  readonly ref: string;
  readonly text: string;
  readonly size: number;
  readonly color: number;
  readonly position: readonly [number, number, number];
  readonly target: string;
  readonly node: string;
  readonly visible: boolean;
}

/** The name of the file or entry an object came from: its root data's label */
function rootLabel(ctx: Pick<ApiContext, 'plugin'>, ref: string): string | undefined {
  const { cells, tree } = ctx.plugin.state.data;
  let root = ref;
  for (;;) {
    const parent = tree.transforms.get(root)?.parent;
    if (!parent || parent === StateTransform.RootRef) break;
    root = parent;
  }
  const obj = cells.get(root)?.obj;
  return SO.Data.String.is(obj) || SO.Data.Binary.is(obj) ? obj.label : undefined;
}

/** A volume's transform as a matrix (its decorator's: a matrix, or its parts about the origin) */
function volumeMatrixOf(cell: StateObjectCell): Mat4 {
  const t = (cell.transform.params as { transform?: { name: string; params: any } }).transform;
  if (t?.name === 'matrix') {
    const m = Mat4.clone(t.params.data);
    return t.params.transpose ? Mat4.transpose(m, m) : m;
  }
  if (t?.name === 'components') {
    const { translation, axis, angle } = t.params;
    const r = Mat4.fromRotation(Mat4(), (angle * Math.PI) / 180, axis);
    return Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), translation), r);
  }
  return Mat4.identity();
}

function labelsOf(ctx: Pick<ApiContext, 'plugin'>): LabelInfo[] {
  const out: LabelInfo[] = [];
  for (const cell of ctx.plugin.state.data.cells.values()) {
    if (cell.transform.transformer !== StageLabel) continue;
    const p = cell.transform.params as StageLabelProps;
    out.push({
      ref: cell.transform.ref,
      text: p.text,
      size: p.size,
      color: p.color,
      position: [p.position[0], p.position[1], p.position[2]],
      target: p.target,
      node: p.node,
      visible: !cell.state.isHidden,
    });
  }
  return out;
}

/** A CSS color name or #rrggbb */
function cssColor(text: string): Color | undefined {
  const c = text.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return Color(parseInt(c.slice(1), 16));
  const named = (ColorNames as Record<string, Color | undefined>)[c];
  return named;
}

function boundsOf(ctx: Pick<ApiContext, 'plugin'>, t: StageTarget): Sphere3D | undefined {
  // where it is drawn: down its decorators (a transform moves it; custom properties keep it)
  const obj = drawnObject(ctx, t.ref)?.data as any;
  if (!obj) return;
  if (t.kind === 'structure') return obj.boundary.sphere;
  if (t.kind === 'particles') return Particle.getBoundary(obj).sphere;
  return Grid.getBoundingSphere(obj.grid);
}

/** An object as drawn: the last of the decorators on it (a transform, custom properties), else itself */
export function drawnObject(ctx: Pick<ApiContext, 'plugin'>, ref: string) {
  const { cells, tree } = ctx.plugin.state.data;
  let cell = cells.get(ref);
  for (;;) {
    const next = tree.children
      .get(cell?.transform.ref ?? '')
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator && c.obj);
    if (!next) return cell?.obj;
    cell = next;
  }
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

/**
 * How many of a representation's first clip objects are cuts of some of its particles (the layers' `cuts`, the
 * mesoscale extension's per-entity cuts): the stage's cut of the whole object comes after them.
 */
function partialCuts(ctx: Pick<ApiContext, 'plugin'>, cell: StateObjectCell): number {
  return partialCutSelectors(ctx, cell).length;
}

function partialCutSelectors(ctx: Pick<ApiContext, 'plugin'>, cell: StateObjectCell): ParticleCutProps[] {
  const { tree } = ctx.plugin.state.data;
  for (const child of tree.children.get(cell.transform.ref).toArray()) {
    const t = tree.transforms.get(child);
    if (t?.transformer === ParticleRepresentation3DLayers)
      return (t.params as { cuts?: ParticleCutProps[] })?.cuts ?? [];
  }
  return [];
}

/** The guides of every clip object of every target (of its first representation: all its representations share them) */
export function desiredGuides(ctx: Pick<ApiContext, 'plugin'>, hidden?: ReadonlySet<string>): CutGuideData[] {
  const out: CutGuideData[] = [];
  for (const t of stageTargets(ctx)) {
    const cell = representationCells(ctx, t)[0];
    const objects = cell ? (clipOf(cell)?.objects ?? []) : [];
    if (!objects.length) continue;
    const reach = Math.max(boundsOf(ctx, t)?.radius ?? 1, 1);
    objects.forEach((object, index) => {
      if (object.type === 'infiniteCone' || hidden?.has(`${t.ref}:${index}`)) return;
      out.push({ kind: 'stage-tools-cut-guide', target: t.ref, index, object, reach });
    });
  }
  return out;
}

function setClipUniforms(values: any, clip: ReturnType<typeof Clip.getClip>) {
  if (!values?.uClipObjectPosition) return;
  ValueCell.update(values.uClipObjectType, clip.objects.type);
  ValueCell.update(values.uClipObjectInvert, clip.objects.invert);
  ValueCell.update(values.uClipObjectPosition, clip.objects.position);
  ValueCell.update(values.uClipObjectRotation, clip.objects.rotation);
  ValueCell.update(values.uClipObjectScale, clip.objects.scale);
}

function describe(ctx: Pick<ApiContext, 'plugin'>, t: StageTarget): CutInfo {
  const bounds = boundsOf(ctx, t);
  const reach = Math.max(bounds?.radius ?? 1, 1);
  // the whole object's cut: after the cuts of some of its particles (`partialCuts`)
  let cut: Cut | undefined;
  for (const cell of representationCells(ctx, t)) {
    const o = clipOf(cell)?.objects[partialCuts(ctx, cell)];
    if (o) {
      cut = cutOf(o, reach);
      break;
    }
  }
  let offset: number | undefined;
  if (cut && bounds) {
    const d = Vec3.sub(Vec3(), Vec3.create(...cut.center), bounds.center);
    offset = Math.round((Vec3.dot(d, Vec3.normalize(Vec3(), Vec3.create(...cut.normal))) / reach) * 100) / 100;
  }
  return { ...t, reach, ...(cut ? { cut } : {}), ...(offset !== undefined ? { offset } : {}) };
}

/** Puts the cut (none: removes it) on every representation of the target and its guide; the refs changed */
/**
 * Sets a target's cuts of the whole object (after the cuts of some of its particles, kept first): `cut` replaces them,
 * or is added after them; an index removes that one (its place among all the clip objects)
 */
async function setCut(
  ctx: ApiContext,
  t: StageTarget,
  cut: Cut | undefined,
  mode: 'replace' | 'add' | number = 'replace',
): Promise<string[]> {
  const b = ctx.plugin.state.data.build();
  const nodes: string[] = [];
  for (const cell of representationCells(ctx, t)) {
    const all = clipOf(cell)?.objects ?? [];
    const partial = partialCuts(ctx, cell);
    const kept =
      mode === 'add'
        ? all
        : typeof mode === 'number'
          ? all.filter((_, i) => i !== mode || i < partial)
          : all.slice(0, partial);
    const clip: Clip.Props = { variant: 'pixel', objects: [...kept, ...(cut ? [clipObjectOf(cut)] : [])] };
    b.to(cell).update((old: any) => ({ ...old, type: { ...old.type, params: { ...old.type.params, clip } } }));
    nodes.push(cell.transform.ref);
  }
  await b.commit();
  return nodes;
}
