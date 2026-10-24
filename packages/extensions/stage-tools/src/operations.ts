/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Sphere3D } from '@molstar/core/math/geometry';
import { Mat4, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { ParticleListTransform } from '@molstar/plugin/state/transforms/particles/ops';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import {
  movedPoint,
  movedRepresentationParams,
  type ObjectPose,
  placementWith,
  poseOf,
  type ScreenFrame,
} from './move.js';
import { getTransformFromParams, type TransformParam } from '@molstar/plugin/state/transforms/helpers';
import { Color } from '@molstar/core/util/color';
import { ColorNames } from '@molstar/core/util/color/names';
import { setSubtreeVisibility } from '@molstar/plugin/behavior/static/state';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { type StateObjectCell, StateTransform } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Particle, type ParticleList } from '@molstar/model/model/particles/particle-list';
import { Grid, Volume } from '@molstar/model/model/volume';
import { OrderedSet } from '@molstar/core/data/int';
import { ButtonsType } from '@molstar/core/util/input/input-observer';
import { isEmptyLoci, Loci } from '@molstar/model/model/loci';
import { Bond, type Structure, StructureElement, StructureProperties, Unit } from '@molstar/model/model/structure';
import { Observable, Subject } from 'rxjs';
import {
  type ApiAreaContext,
  type ApiContext,
  type ApiFailure,
  ApiArea,
  ApiResult,
} from '@molstar/prism-viewer/api/area';
import { lociLabel } from '@molstar/model/model/label';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { labelOf as structureLabel, loadedStructures } from '@molstar/prism-viewer/api/scope';
import { watchedState } from '@molstar/prism-viewer/sources/watched';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { ObjectMoveGizmos } from './move-gizmos.js';
import { ParticleHandles } from './particle-handle.js';
import { drawnObject } from './drawn.js';
import {
  type DistancePoint,
  distanceOf,
  isStageDistanceData,
  pointLoci,
  pointOf,
  StageDistance,
  type StageDistanceProps,
} from './distance.js';
import { labelLook, StageLabel, StageLabelParams, type StageLabelProps } from './label.js';

// The `stage` area (apps/prism-me/_spec/features.md, "Stage tools"): the canvas's right-click menu, objects moved by
// hand (their clips move with them), labels. Clips are Prism's (`api.clipping`).

/** Something on the stage: a structure, a particle list or a volume */
export interface StageTarget {
  readonly ref: string;
  readonly label: string;
  readonly kind: 'structure' | 'particles' | 'volume';
}

/** What a right-click on the canvas picked, for the stage's menu */
export type StagePick =
  | { readonly kind: 'nothing' }
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
  /** Where it was clicked in 3D (on what it picked), if on something */
  readonly position?: Vec3;
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

  /** What opens on a right-click: a host's menu if one is set (prism-me's), else the stage's own */
  private menus: { own?: (request: StageMenuRequest) => void; host?: (request: StageMenuRequest) => void } = {};

  /**
   * Sets what opens on the canvas's right-clicks: the stage's own menu (`host: false`), or a host's, which then opens
   * instead (the stage's own opens none); for the viewer's life (the area holds the one subscription)
   */
  setMenu(open: (request: StageMenuRequest) => void, host = false) {
    if (host) this.menus.host = open;
    else this.menus.own = open;
  }

  /** The handles that move a particle list, a volume or a mesh by hand (a structure's are Prism's, `api.move`) */
  readonly moveGizmos: ObjectMoveGizmos;

  /** A particle's local handle (its offsets, or itself), once the stage's views gave it the viewer's API */
  particleHandles: ParticleHandles | undefined;

  /** The particle handle, made with the viewer's API (it runs the cryo-ET area's offsets by id) */
  useParticleHandles(api: ViewerApi): ParticleHandles {
    this.particleHandles ??= new ParticleHandles(this.ctx.plugin, api);
    return this.particleHandles;
  }

  constructor(ctx: ApiAreaContext) {
    super(ctx);
    const plugin = ctx.plugin;
    this.moveGizmos = new ObjectMoveGizmos(plugin, this);
    this.requests.subscribe((request) => (this.menus.host ?? this.menus.own)?.(request));
    plugin.behaviors.interaction.click.subscribe((e) => {
      // a click on the background (a click, not a drag's end: Mol*'s clicks are only those) resets the view: the
      // particle's handle goes with it
      if (e.button === ButtonsType.Flag.Primary && isEmptyLoci(e.current.loci)) this.particleHandles?.hide();
      if (e.button !== ButtonsType.Flag.Secondary || !e.page) return;
      const loci = e.current.loci;
      this.requests.next({
        x: e.page[0] - window.scrollX,
        y: e.page[1] - window.scrollY,
        pick: pickOf({ plugin }, loci),
        loci,
        ...(e.position ? { position: Vec3.clone(e.position) } : {}),
        focus: () => {
          if (!isEmptyLoci(loci)) plugin.managers.camera.focusLoci(loci);
        },
        anchor: plugin.canvas3dContext?.canvas ?? undefined,
      });
    });
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
   * Where an object is placed (a particle list, a volume, a mesh): its transform on top of where it was loaded, its
   * center there, its reach; for the handles that move it (`ObjectMoveGizmos`)
   */
  placementOf(target: string): ObjectPlacement | undefined {
    const plugin = this.ctx.plugin;
    const ctx = { plugin };
    const { cells } = plugin.state.data;
    const cell = cells.get(target);
    if (!cell) return undefined;
    const t = stageTargets(ctx).find((x) => x.ref === target);
    if (t?.kind === 'structure') {
      // its transform (Prism's, a decorator on it) on top of the structure as loaded
      const s = plugin.managers.structure.hierarchy.current.structures.find((x) => x.cell.transform.ref === target);
      const data = s?.cell.obj?.data;
      if (!s || !data) return undefined;
      const sphere = data.boundary.sphere;
      const param = (s.transform?.cell.transform.params as { transform?: TransformParam } | undefined)?.transform;
      return {
        matrix: param ? getTransformFromParams(param, sphere.center) : Mat4.identity(),
        center: Vec3.clone(sphere.center),
        radius: Math.max(sphere.radius, 1),
      };
    }
    if (t?.kind === 'particles') {
      const data = cell.obj?.data as ParticleList | undefined;
      if (!data) return undefined;
      const old = decoratorUnder(ctx, target, ParticleListTransform);
      const sphere = Particle.getBoundary(data).sphere;
      // as drawn: its positions scaled about the origin, then moved (a move between two placements: the scale cancels)
      const scale = this.scaleOf(target);
      const moved = old ? Mat4.clone((old.transform.params as { transform: Mat4 }).transform) : Mat4.identity();
      return {
        matrix: scale === 1 ? moved : Mat4.mul(Mat4(), moved, Mat4.fromUniformScaling(Mat4(), scale)),
        center: Vec3.clone(sphere.center),
        radius: Math.max(sphere.radius * scale, 1),
      };
    }
    if (t?.kind === 'volume') {
      const data = cell.obj?.data as Volume | undefined;
      if (!data) return undefined;
      const old = decoratorUnder(ctx, target, VolumeTransform);
      const sphere = Grid.getBoundingSphere(data.grid);
      return {
        matrix: old ? volumeMatrixOf(old) : Mat4.identity(),
        center: Vec3.clone(sphere.center),
        radius: Math.max(sphere.radius, 1),
      };
    }
    if (SO.Shape.Representation3D.is(cell.obj)) {
      const shape = cells.get(cell.transform.parent);
      if (!shape || !SO.Shape.Provider.is(shape.obj)) return undefined;
      const matrix: Mat4 = Mat4.clone(
        (shape.transform.params as { transforms?: Mat4[] }).transforms?.[0] ?? Mat4.identity(),
      );
      const drawn = this.objectBounds(target);
      if (!drawn) return undefined;
      // its center as loaded: where it is drawn, the transform undone
      const center = Vec3.transformMat4(Vec3(), drawn.center, Mat4.invert(Mat4(), matrix));
      return { matrix, center, radius: Math.max(drawn.radius, 1) };
    }
    return undefined;
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

  /** A particle list's scale (Å per unit of its file), 1 when not scaled */
  scaleOf(target: string): number {
    return listScale({ plugin: this.ctx.plugin }, target);
  }

  /** An object's pose (its center, its Euler turn: `ObjectPose`), following the state tree while watched */
  poseState(target: string): ReadonlyState<ObjectPose | undefined> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => {
        const p = this.placementOf(target);
        return p ? poseOf(p) : undefined;
      },
      () => plugin.state.data.events.changed,
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  /** An object drawn at `pose` (the drawing only, as a slider moves); its own pose puts it back */
  previewPose(target: string, pose: ObjectPose) {
    const p = this.placementOf(target);
    if (!p) return;
    this.previewMove(target, Mat4.mul(Mat4(), placementWith(p, pose), Mat4.invert(Mat4(), p.matrix)));
  }

  readonly pose = this.operation({
    id: 'stage.pose',
    title: 'Place an object (its center, its turn)',
    params: {
      target: PD.Text('', { description: 'A structure, particle list, volume or mesh, by state ref' }),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'Where its center is (Å); absent: where it is' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      ex: OptionalParam(PD.Numeric(0, { min: -180, max: 180 }, { description: 'Turned about X (°), then Y, then Z' })),
      ey: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
      ez: OptionalParam(PD.Numeric(0, { min: -180, max: 180 })),
    },
    async run(values, ctx) {
      const v = values as { target: string } & Partial<Record<'x' | 'y' | 'z' | 'ex' | 'ey' | 'ez', number>>;
      const area = ctx.api.stage!;
      const p = area.placementOf(v.target);
      if (!p)
        return ApiResult.fail('not-found', `'${v.target}' cannot be placed.`, 'A structure, list, volume or mesh.');
      const now = poseOf(p);
      const pose: ObjectPose = {
        position: [v.x ?? now.position[0], v.y ?? now.position[1], v.z ?? now.position[2]],
        euler: [v.ex ?? now.euler[0], v.ey ?? now.euler[1], v.ez ?? now.euler[2]],
      };
      // the change as a move after where it is: one step, its clips and labels with it
      const m = Mat4.mul(Mat4(), placementWith(p, pose), Mat4.invert(Mat4(), p.matrix));
      return ctx.api.run('stage.move', { target: v.target, matrix: Array.from(m) });
    },
  });

  /** A particle list's scale, following the state tree while watched: a read for views */
  scaleState(target: string): ReadonlyState<number> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => listScale({ plugin }, target),
      () => plugin.state.data.events.changed,
    );
  }

  readonly scale = this.operation({
    id: 'stage.scale',
    title: "Scale a particle list's positions",
    params: {
      target: PD.Text('', { description: 'A particle list by state ref' }),
      scale: PD.Numeric(
        1,
        { min: 1e-6, max: 1e6, step: 0.01 },
        { description: "Å per unit of the file (a tomogram's pixel size): the positions scaled about the origin" },
      ),
    },
    async run({ target, scale }, ctx) {
      const plugin = ctx.plugin;
      const l = plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === target);
      if (!l) return ApiResult.fail('not-found', `'${target}' is not a particle list.`, 'Only particles are scaled.');
      if (!(scale > 0)) return ApiResult.fail('invalid', 'A scale is more than 0.');
      if (listScale(ctx, target) === scale) return ApiResult.already(`Its scale is ${scale} already.`);
      const old = decoratorUnder(ctx, target, ParticleListTransform);
      const b = plugin.state.data.build();
      if (old) b.to(old).update((p: any) => ({ ...p, scale }));
      else b.to(l.cell).insert(ParticleListTransform, { transform: Mat4.identity(), scale });
      await b.commit();
      return ApiResult.ok(`Scaled ${rootLabel(ctx, target) ?? l.cell.obj?.label ?? target} to ${scale} Å per unit.`, {
        nodes: [target],
      });
    },
  });

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
      const { cells } = plugin.state.data;
      const cell = cells.get(target);
      if (!cell) return ApiResult.fail('not-found', `There is no object '${target}'.`);
      const t = stageTargets(ctx).find((x) => x.ref === target);
      const b = plugin.state.data.build();
      const name = rootLabel(ctx, target) ?? cell.obj?.label ?? target;
      if (t?.kind === 'structure') {
        // the structure's own transform (Prism's, as its Move does), on top of where it is
        const r = await ctx.api.run('structure.transform', { structure: target, matrix: m, compose: true });
        if (!r.ok) return r;
      } else if (t?.kind === 'particles') {
        const l = plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === target)!;
        const old = decoratorUnder(ctx, l.cell.transform.ref, ParticleListTransform);
        if (old) {
          const prev = (old.transform.params as { transform: Mat4 }).transform;
          // its scale (and any other param) kept
          b.to(old).update((p: any) => ({ ...p, transform: Mat4.mul(Mat4(), m, prev) }));
        } else {
          b.to(l.cell).insert(ParticleListTransform, { transform: m });
        }
      } else if (t?.kind === 'volume') {
        const old = decoratorUnder(ctx, target, VolumeTransform);
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
      // what is placed with it: its clip objects, a volume's plane slices, its labels
      if (t) {
        for (const r of representationCells(ctx, t)) {
          const moved = movedRepresentationParams(r.transform.params as { type?: { params?: object } }, m);
          if (moved) b.to(r).update(moved);
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

  /**
   * The label under a point of the page (client px), if any: a text is drawn but not picked by Mol*, so its box on the
   * screen is measured (its place brought toward the camera, its height, its text's length; set off when tethered)
   */
  labelAt(x: number, y: number): string | undefined {
    const plugin = this.ctx.plugin;
    const camera = plugin.canvas3d?.camera;
    const canvas = plugin.canvas3dContext?.canvas;
    if (!camera || !canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    // window px (the drawing buffer's) per client px
    const ratio = camera.viewport.width / Math.max(1, rect.width);
    const toCamera = Vec3();
    const p = Vec3();
    const out = Vec4();
    let best: { ref: string; z: number } | undefined;
    for (const l of labelsOf({ plugin })) {
      if (!l.visible) continue;
      Vec3.normalize(toCamera, Vec3.sub(toCamera, camera.state.position, Vec3.create(...l.position)));
      Vec3.scaleAndAdd(p, Vec3.create(...l.position), toCamera, l.depth);
      camera.project(out, p);
      if (out[3] <= 0) continue;
      const pixel = camera.getPixelSize(p) * ratio;
      if (!(pixel > 0)) continue;
      // its box, in client px: about 0.6 of its height per character, a margin around
      const h = (l.size * 1.4) / pixel;
      const w = (l.size * (0.6 * Math.max(1, l.text.length) + 0.6)) / pixel;
      let cx = rect.left + out[0] / ratio;
      let cy = rect.top + out[1] / ratio;
      if (l.tether) {
        const off = (l.tetherLength * l.size) / pixel;
        cx += off + w / 2;
        cy -= off + h / 2;
      }
      if (Math.abs(x - cx) > w / 2 || Math.abs(y - cy) > h / 2) continue;
      if (!best || out[2] < best.z) best = { ref: l.ref, z: out[2] };
    }
    return best?.ref;
  }

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
      size: OptionalParam(PD.Numeric(4, { min: 0.1, max: 10000 }, { description: 'Its height (Å)' })),
      color: OptionalParam(PD.Text('white', { description: 'A CSS color' })),
      tether: OptionalParam(PD.Boolean(false, { description: 'A line from the place to the text, set off from it' })),
      node: PD.Text('', { description: "The explorer's row it is listed under (its key)" }),
    },
    async run(values, ctx) {
      const v = values as typeof values &
        Partial<Record<'x' | 'y' | 'z' | 'depth' | 'size', number>> & { color?: string; tether?: boolean };
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
      const labelParams = {
        text: v.text || 'Label',
        position,
        depth: v.depth ?? (v.x === undefined ? radius : 0),
        size: v.size ?? Math.max(2, radius / 12),
        color,
        target: v.target,
        node: v.node,
        ...(v.tether !== undefined ? { tether: v.tether } : {}),
      };
      const label = b.toRoot().apply(StageLabel, labelParams);
      // its look on the representation too (a text's plate color and opacity are its props, not its geometry's)
      label.apply(
        ShapeRepresentation3D,
        labelLook({ ...PD.getDefaultValues(StageLabelParams), ...labelParams }) as never,
      );
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
      size: OptionalParam(PD.Numeric(4, { min: 0.1, max: 10000 }, { description: 'Its height (Å)' })),
      color: OptionalParam(PD.Text('white', { description: 'A CSS color' })),
      x: OptionalParam(PD.Numeric(0, {}, { description: 'Where (Å)' })),
      y: OptionalParam(PD.Numeric(0)),
      z: OptionalParam(PD.Numeric(0)),
      visible: OptionalParam(PD.Boolean(true)),
      background: OptionalParam(PD.Boolean(true, { description: 'A plate behind the text' })),
      backgroundColor: OptionalParam(PD.Text('#202020', { description: "The plate's CSS color" })),
      backgroundOpacity: OptionalParam(PD.Numeric(0.7, { min: 0, max: 1, step: 0.01 })),
      tether: OptionalParam(PD.Boolean(false, { description: 'A line from the place to the text, set off from it' })),
      tetherLength: OptionalParam(
        PD.Numeric(1, { min: 0.1, max: 10, step: 0.1 }, { description: "In the text's heights" }),
      ),
      remove: PD.Boolean(false, { description: 'Remove it' }),
    },
    async run(values, ctx) {
      const v = values as typeof values &
        Partial<Record<'x' | 'y' | 'z' | 'size' | 'backgroundOpacity' | 'tetherLength', number>> & {
          text?: string;
          color?: string;
          visible?: boolean;
          background?: boolean;
          backgroundColor?: string;
          tether?: boolean;
        };
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
      const backgroundColor = v.backgroundColor ? cssColor(v.backgroundColor) : undefined;
      if (v.backgroundColor && backgroundColor === undefined) {
        return ApiResult.fail('invalid', `'${v.backgroundColor}' is not a color.`);
      }
      const old = { ...PD.getDefaultValues(StageLabelParams), ...(cell.transform.params as StageLabelProps) };
      const next: StageLabelProps = {
        ...old,
        ...(v.text !== undefined ? { text: v.text } : {}),
        ...(v.size !== undefined ? { size: v.size } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(v.background !== undefined ? { background: v.background } : {}),
        ...(backgroundColor !== undefined ? { backgroundColor } : {}),
        ...(v.backgroundOpacity !== undefined ? { backgroundOpacity: v.backgroundOpacity } : {}),
        ...(v.tether !== undefined ? { tether: v.tether } : {}),
        ...(v.tetherLength !== undefined ? { tetherLength: v.tetherLength } : {}),
        position:
          v.x !== undefined || v.y !== undefined || v.z !== undefined
            ? Vec3.create(v.x ?? old.position[0], v.y ?? old.position[1], v.z ?? old.position[2])
            : old.position,
      };
      const nodes: string[] = [];
      if (JSON.stringify(next) !== JSON.stringify(old)) {
        const b = ctx.plugin.state.data.build().to(cell).update(next);
        // its look on its representation too
        for (const child of ctx.plugin.state.data.tree.children.get(v.label).toArray()) {
          if (ctx.plugin.state.data.cells.get(child)?.transform.transformer === ShapeRepresentation3D) {
            b.to(child).update(labelLook(next) as never);
          }
        }
        await b.commit();
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

  /** The distances of the stage, following the state tree while watched: a read for views */
  distancesState(): ReadonlyState<readonly DistanceInfo[]> {
    const plugin = this.ctx.plugin;
    return watchedState(
      () => distancesOf({ plugin }),
      () => [plugin.state.data.events.changed, plugin.state.data.events.cell.stateUpdated],
      { compare: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    );
  }

  readonly distance = this.operation({
    id: 'stage.distance',
    title: 'Measure a distance',
    params: {
      a: PD.Value<DistanceTarget>('', {
        description:
          "The first point: an atom, a residue, a chain (A:10@CA, A:10, chain A) on a structure, or a particle as '<list ref>#<index>'",
      }),
      b: PD.Value<DistanceTarget>('', { description: 'The second point, as the first' }),
      structure: PD.Text('', {
        description: 'The structure of a text point (by label or state ref); empty: the only one',
      }),
      node: PD.Text('', {
        description: "The explorer's row it is listed under (its key); empty: the first point's object",
      }),
      nodeB: PD.Text('', { description: "The explorer's row of the second point (its key)" }),
    },
    async run(v, ctx) {
      const a = await distancePoint(ctx, v.a, v.structure, v.node, 'first');
      if (ApiResult.isFailure(a)) return a;
      const b = await distancePoint(ctx, v.b, v.structure, v.nodeB, 'second');
      if (ApiResult.isFailure(b)) return b;
      const la = pointLoci(ctx.plugin, a);
      const lb = pointLoci(ctx.plugin, b);
      if (!la || !lb) return ApiResult.fail('invalid', 'A point selects nothing.');
      const value = distanceOf(la.loci, lb.loci);
      const node = v.node || `o:${a.ref}`;
      // the same two points, either way round, from any row: the same distance
      const pair = [pointId(a), pointId(b)].sort().join('\n');
      const sameRef = [...ctx.plugin.state.data.cells.values()].find((c) => {
        if (c.transform.transformer !== StageDistance) return false;
        const p = c.transform.params as StageDistanceProps;
        return [pointId(p.a), pointId(p.b)].sort().join('\n') === pair;
      })?.transform.ref;
      const same = sameRef ? distancesOf(ctx).find((d) => d.ref === sameRef) : undefined;
      if (same && !ctx.copy) {
        return ApiResult.already(`It is already measured: ${same.label}.`, {
          value: { ref: same.ref, distance: same.distance },
        });
      }
      const build = ctx.plugin.state.data.build();
      const dependsOn = a.ref === b.ref ? [a.ref] : [a.ref, b.ref];
      const made = build.toRoot().apply(StageDistance, { a, b, node }, { dependsOn });
      await build.commit();
      return ApiResult.ok(
        `Measured ${value.toFixed(2)} Å between ${a.label} and ${b.label}.`,
        { nodes: [made.ref] },
        { value: { ref: made.ref, distance: value } },
      );
    },
  });

  readonly editDistance = this.operation({
    id: 'stage.editDistance',
    title: 'Change a distance',
    params: {
      distance: PD.Text('', { description: 'The distance, by state ref' }),
      textSize: OptionalParam(PD.Numeric(1, { min: 0.1, max: 10 }, { description: "Its text's size, times its own" })),
      lineWidth: OptionalParam(
        PD.Numeric(1, { min: 0.1, max: 10 }, { description: "Its line's width, times its own" }),
      ),
      opacity: OptionalParam(PD.Numeric(1, { min: 0, max: 1 })),
      visible: OptionalParam(PD.Boolean(true)),
      remove: PD.Boolean(false, { description: 'Remove it' }),
    },
    async run(values, ctx) {
      const v = values as typeof values & {
        textSize?: number;
        lineWidth?: number;
        opacity?: number;
        visible?: boolean;
      };
      const state = ctx.plugin.state.data;
      const cell = state.cells.get(v.distance);
      if (!cell || cell.transform.transformer !== StageDistance) {
        return ApiResult.fail('not-found', `There is no distance '${v.distance}'.`);
      }
      const name = cell.obj?.label ?? 'distance';
      if (v.remove) {
        await state.build().delete(v.distance).commit();
        return ApiResult.ok(`Removed the distance ${name}.`, { nodes: [v.distance] });
      }
      const old = cell.transform.params as StageDistanceProps;
      const next: StageDistanceProps = {
        ...old,
        ...(v.textSize !== undefined ? { textSize: v.textSize } : {}),
        ...(v.lineWidth !== undefined ? { lineWidth: v.lineWidth } : {}),
        ...(v.opacity !== undefined ? { opacity: v.opacity } : {}),
      };
      const nodes: string[] = [];
      if (next.textSize !== old.textSize || next.lineWidth !== old.lineWidth || next.opacity !== old.opacity) {
        await state.build().to(cell).update(next).commit();
        nodes.push(v.distance);
      }
      if (v.visible !== undefined && v.visible === !!cell.state.isHidden) {
        setSubtreeVisibility(state, v.distance, !v.visible);
        nodes.push(v.distance);
      }
      if (!nodes.length) return ApiResult.already('The distance is already so.');
      return ApiResult.ok(`Changed the distance ${name}.`, { nodes });
    },
  });
}

export { drawnObject };

// --- picks ---------------------------------------------------------------------------------------------------------

/** The target a picked loci belongs to: its structure (the root of a component's), particle list or volume */
function pickOf(ctx: Pick<ApiContext, 'plugin'>, loci: Loci): StagePick {
  if (isEmptyLoci(loci)) return { kind: 'nothing' };
  const targets = stageTargets(ctx);
  const cells = ctx.plugin.state.data.cells;
  if (StructureElement.Loci.is(loci) || Bond.isLoci(loci)) {
    const refs = structureRefsOf(ctx, loci.structure);
    const t = targets.find((x) => refs.has(x.ref));
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
  readonly background: boolean;
  readonly backgroundColor: number;
  readonly backgroundOpacity: number;
  readonly tether: boolean;
  readonly tetherLength: number;
  /** Brought toward the camera by this much (Å) */
  readonly depth: number;
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
  return SO.Data.String.is(obj) || SO.Data.Binary.is(obj) || SO.Data.Response.is(obj) ? obj.label : undefined;
}

/** An object's placement, as its handles take it */
export interface ObjectPlacement {
  /** Its transform on top of where it was loaded */
  readonly matrix: Mat4;
  /** Its center where it was loaded */
  readonly center: Vec3;
  readonly radius: number;
}

/** A particle list's scale (its transform's: Å per unit of its file), 1 when not scaled */
function listScale(ctx: Pick<ApiContext, 'plugin'>, target: string): number {
  const old = decoratorUnder(ctx, target, ParticleListTransform);
  return (old?.transform.params as { scale?: number } | undefined)?.scale ?? 1;
}

/** The decorator of a transformer right under a cell (a particle list's or a volume's transform), if any */
function decoratorUnder(ctx: Pick<ApiContext, 'plugin'>, ref: string, transformer: unknown) {
  const { cells, tree } = ctx.plugin.state.data;
  return tree.children
    .get(ref)
    .toArray()
    .map((c) => cells.get(c))
    .find((c) => c?.transform.transformer === transformer);
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
    const p = { ...PD.getDefaultValues(StageLabelParams), ...(cell.transform.params as StageLabelProps) };
    out.push({
      ref: cell.transform.ref,
      text: p.text,
      size: p.size,
      color: p.color,
      position: [p.position[0], p.position[1], p.position[2]],
      target: p.target,
      node: p.node,
      visible: !cell.state.isHidden,
      background: p.background,
      backgroundColor: p.backgroundColor,
      backgroundOpacity: p.backgroundOpacity,
      tether: p.tether,
      tetherLength: p.tetherLength,
      depth: p.depth,
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

/**
 * The cells a picked structure may belong to: its root (decorators skipped: a moved structure), the last decorator on
 * it, and the cell holding the structure itself with its ancestors (a pick on the root structure's own drawing)
 */
function structureRefsOf(ctx: Pick<ApiContext, 'plugin'>, structure: Structure): Set<string> {
  const helper = ctx.plugin.helpers.substructureParent;
  const refs = new Set<string>();
  for (const c of [helper.get(structure, true), helper.get(structure)]) if (c) refs.add(c.transform.ref);
  const { cells, tree } = ctx.plugin.state.data;
  for (const s of [structure, structure.root]) {
    for (const cell of cells.values()) {
      if (cell.obj?.data !== s) continue;
      for (
        let ref = cell.transform.ref;
        ref && ref !== StateTransform.RootRef;
        ref = tree.transforms.get(ref)?.parent
      ) {
        refs.add(ref);
      }
    }
  }
  return refs;
}

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

// --- distances -----------------------------------------------------------------------------------------------------

/** A point of `stage.distance`: what a pick gave (`{ loci }`), or a text (a structure's target, `<list ref>#<index>`) */
export type DistanceTarget = string | { readonly loci: Loci };

/** A distance's point: its object, the point on it, its name and its row */
async function distancePoint(
  ctx: ApiContext,
  target: DistanceTarget,
  structure: string,
  key: string,
  which: string,
): Promise<DistancePoint | ApiFailure> {
  let loci: Loci | undefined;
  if (typeof target === 'object' && target && 'loci' in target) loci = target.loci;
  else if (typeof target === 'string' && target.trim()) {
    const particle = /^(.+)#(\d+)$/.exec(target.trim());
    const list = particle ? drawnObject(ctx, particle[1]) : undefined;
    if (particle && SO.Particle.List.is(list)) {
      const i = Number(particle[2]);
      if (i >= list.data.count)
        return ApiResult.fail('invalid', `The ${which} point: the list has ${list.data.count} particles.`);
      loci = Particle.Loci(list.data, OrderedSet.ofSingleton(i));
    } else {
      const resolved = await ctx.targets.resolve(target, structure ? { structure } : {});
      if (ApiResult.isFailure(resolved)) return resolved;
      const parts = resolved.parts.filter((p) => p.selected.atoms > 0);
      if (parts.length !== 1) {
        return ApiResult.fail(
          parts.length ? 'ambiguous' : 'invalid',
          parts.length ? `The ${which} point is on ${parts.length} structures.` : `The ${which} point selects nothing.`,
          parts.length ? 'Name the structure.' : 'Name an atom or a residue that exists, e.g. A:10@CA.',
        );
      }
      loci = parts[0].loci;
    }
  }
  if (!loci || isEmptyLoci(loci)) return ApiResult.fail('invalid', `The ${which} point is missing.`);
  const pick = pickOf(ctx, loci);
  if (pick.kind !== 'target' || pick.target.kind === 'volume') {
    return ApiResult.fail('invalid', `The ${which} point is not on a structure or a particle list.`);
  }
  const what = pointName(loci);
  const indices = Particle.isLoci(loci) ? loci.indices : undefined;
  const label =
    pick.particle && indices
      ? OrderedSet.size(indices) > 1
        ? `${pick.particle.name} (${OrderedSet.size(indices)} particles)`
        : `${pick.particle.name} #${OrderedSet.getAt(indices, 0)}`
      : what;
  const point = pointOf(loci, { ref: pick.target.ref, label: label || pick.target.label, key });
  return point ?? ApiResult.fail('invalid', `The ${which} point is not on a structure or a particle list.`);
}

/** A point's short name: "THR 1 CA (A)" for an atom, "LYS 120 (A)" for a residue, else the condensed loci label */
function pointName(loci: Loci): string {
  if (StructureElement.Loci.is(loci) && loci.elements.length === 1) {
    const { unit, indices } = loci.elements[0];
    const first = unit.elements[OrderedSet.getAt(indices, 0)];
    const last = unit.elements[OrderedSet.getAt(indices, OrderedSet.size(indices) - 1)];
    const residue = unit.model.atomicHierarchy.residueAtomSegments.index;
    if (Unit.isAtomic(unit) && residue[first] === residue[last]) {
      const l = StructureElement.Location.create(loci.structure, unit, first);
      const P = StructureProperties;
      const atom = OrderedSet.size(indices) === 1 ? ` ${P.atom.label_atom_id(l)}` : '';
      return `${P.atom.label_comp_id(l)} ${P.residue.auth_seq_id(l)}${atom} (${P.chain.auth_asym_id(l)})`;
    }
  }
  return lociLabel(loci, { htmlStyling: false, condensed: true }).trim();
}

/** What a point is (its object and its elements or particle), not its name or row: a distance's identity */
const pointId = (p: DistancePoint) =>
  JSON.stringify([p.ref, p.particle ?? null, p.particles ?? null, p.bundle ?? null]);

/** A point as views list it: its object, name and row */
const brief = (p: DistancePoint) => ({ ref: p.ref, label: p.label, key: p.key });

/** A distance of the stage, as views list it */
export interface DistanceInfo {
  readonly ref: string;
  /** The explorer's row it is listed under (its key) */
  readonly node: string;
  /** Its value (Å) */
  readonly distance: number;
  /** "12.34 Å" */
  readonly label: string;
  readonly a: { readonly ref: string; readonly label: string; readonly key: string };
  readonly b: { readonly ref: string; readonly label: string; readonly key: string };
  readonly textSize: number;
  readonly lineWidth: number;
  readonly opacity: number;
  readonly visible: boolean;
}

function distancesOf(ctx: Pick<ApiContext, 'plugin'>): DistanceInfo[] {
  const out: DistanceInfo[] = [];
  for (const cell of ctx.plugin.state.data.cells.values()) {
    if (cell.transform.transformer !== StageDistance) continue;
    const p = cell.transform.params as StageDistanceProps;
    const data = cell.obj?.data.sourceData;
    // measured once by the transform, not at every read
    const distance = isStageDistanceData(data) ? data.value : NaN;
    out.push({
      ref: cell.transform.ref,
      node: p.node,
      distance,
      label: Number.isFinite(distance) ? `${distance.toFixed(2)} Å` : 'Distance',
      a: brief(p.a),
      b: brief(p.b),
      textSize: p.textSize,
      lineWidth: p.lineWidth,
      opacity: p.opacity,
      visible: !cell.state.isHidden,
    });
  }
  return out;
}
