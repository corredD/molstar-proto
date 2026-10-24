/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GizmoBinding, GizmoController, type GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import { type DragFrame, frameOfPose, poseGesture, poseOfFrame } from '@molstar/graphics/util/gizmo/gestures';
import type { Handle } from '@molstar/graphics/util/gizmo/handle';
import { transformHandles } from '@molstar/graphics/util/gizmo/transform';
import { Grid, type Volume } from '@molstar/model/model/volume';
import type { PluginContext } from '@molstar/plugin/context';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { obliqueFrame, obliquePlane, obliquePoseOf, obliquePoseOfPlane, type SlicePlane } from './oblique.js';

// An oblique slice's handle (apps/prism-me/_spec/ui.md, the oblique slice): Prism's gizmo library on the slice's
// point, its Z the plane's normal: moved anywhere, tilted about X and Y (no ring about its normal, which a plane cannot
// hold). A drag shows the slice cut where the handle is (its representation given the plane: the state, and its
// history, untouched), its release is one step (`cryoet.oblique`).

/** The oblique slice the handle is on */
export interface ObliqueHandleTarget {
  /** The volume (its state ref) */
  readonly volume: string;
  /** The slice's representation (its state ref) */
  readonly slice: string;
}

interface HandleValue {
  /** The handle's frame in the scene: at the slice's point, its Z the normal */
  readonly frame: Mat4;
  readonly size: number;
}

/** The smallest the handle is (Å) */
const MinHandleSize = 20;

/** The longest a commit holds the canvas's frames (ms) */
const MaxCommitHoldMs = 3000;

type SliceRepr = { createOrUpdate(p: object, d?: Volume): any };

/** The volume the slice samples (a moved volume's grid: its last decorator's, not the volume's own cell) */
function sliceVolume(plugin: PluginContext, slice: string): Volume | undefined {
  return (plugin.state.data.cells.get(slice)?.obj?.data as { sourceData?: Volume } | undefined)?.sourceData;
}

/** The slice's plane as the state holds it */
function statePlane(plugin: PluginContext, slice: string): SlicePlane | undefined {
  const p = plugin.state.data.cells.get(slice)?.transform.params as
    | { type?: { params?: { mode?: string; plane?: SlicePlane } } }
    | undefined;
  return p?.type?.params?.mode === 'plane' ? p.type.params.plane : undefined;
}

/** A frame's plane: its point, its Z */
function planeOfFrame(m: Mat4): SlicePlane {
  return { point: Mat4.getTranslation(Vec3(), m), normal: Vec3.normalize(Vec3(), Vec3.create(m[8], m[9], m[10])) };
}

/** The same plane, as the state rounds it (Å, a normal's components) */
function samePlane(a: SlicePlane, b: SlicePlane) {
  return Vec3.distance(a.point, b.point) < 1e-3 && Vec3.distance(a.normal, Vec3.normalize(Vec3(), b.normal)) < 1e-6;
}

class ObliqueHandleBinding implements GizmoBinding<HandleValue> {
  readonly #invalidated = new Subject<string>();

  constructor(
    private readonly plugin: PluginContext,
    private readonly api: ViewerApi,
    private readonly target: () => ObliqueHandleTarget | undefined,
    readonly items: Observable<readonly GizmoItem<HandleValue>[]>,
    /** A frame released at, its turn about the normal kept for the handle (the plane cannot hold it) */
    private readonly released: (slice: string, frame: Mat4) => void,
  ) {}

  get invalidated(): Observable<string> {
    return this.#invalidated;
  }

  layout(item: GizmoItem<HandleValue>) {
    return { ...transformHandles(item.value.size, { rotate: [0, 1] }), frame: item.value.frame };
  }

  sameGeometry(a: HandleValue, b: HandleValue) {
    return a.size === b.size;
  }

  equal(a: HandleValue, b: HandleValue) {
    return Mat4.areEqual(a.frame, b.frame, 1e-6);
  }

  apply(from: HandleValue, handle: Handle, frame: DragFrame, dx: number, dy: number): HandleValue {
    const pose = poseGesture(poseOfFrame(from.frame), handle, frame, dx, dy);
    return pose ? { ...from, frame: frameOfPose(pose) } : from;
  }

  /** The slice cut on this plane (the drawing only); none: as the state has it */
  async #draw(plane: SlicePlane | undefined) {
    const t = this.target();
    const cell = t && this.plugin.state.data.cells.get(t.slice);
    const repr = (cell?.obj?.data as { repr?: SliceRepr } | undefined)?.repr;
    const volume = t && sliceVolume(this.plugin, t.slice);
    const p = plane ?? (t && statePlane(this.plugin, t.slice));
    if (!repr || !volume || !p) return;
    await this.plugin.runTask(repr.createOrUpdate({ plane: p }, volume));
    this.plugin.canvas3d?.requestDraw();
  }

  /** The plane of a handle's frame (its turn about the normal left out) */
  #plane(frame: Mat4): SlicePlane | undefined {
    const t = this.target();
    const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
    return grid && obliquePlane(grid, obliquePoseOf(grid, frame));
  }

  async preview(_key: string, _from: HandleValue, next: HandleValue) {
    const plane = this.#plane(next.frame);
    if (plane) await this.#draw(plane);
  }

  async commit(_key: string, _from: HandleValue, next: HandleValue) {
    const t = this.target();
    const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
    if (!t || !grid) return false;
    const {
      position: [x, y, z],
      tilt: [ex, ey],
    } = obliquePoseOf(grid, next.frame);
    const done = (async () => {
      this.released(t.slice, next.frame);
      const r = await this.api.run('cryoet.oblique', { volume: t.volume, slice: t.slice, x, y, z, ex, ey });
      // drawn as the state has it now (placed, or not)
      if (!r.ok || r.unchanged) await this.#draw(undefined);
      return r.ok;
    })();
    this.plugin.canvas3d?.holdFrames(done, MaxCommitHoldMs);
    return done;
  }

  cancel() {
    void this.#draw(undefined);
  }

  dispose() {
    this.#invalidated.complete();
  }
}

/** The handle on an oblique slice while shown */
export class ObliqueHandles {
  readonly #target = observableState<ObliqueHandleTarget | undefined>(undefined);
  readonly #items = new BehaviorSubject<readonly GizmoItem<HandleValue>[]>([]);
  /** The frame the handle was last released at, by slice: shown while the slice's plane is that frame's */
  readonly #released = new Map<string, Mat4>();
  #controller: GizmoController<HandleValue> | undefined;
  #binding: ObliqueHandleBinding | undefined;
  #release: (() => void) | undefined;
  #sub: { unsubscribe(): void } | undefined;

  constructor(
    private readonly plugin: PluginContext,
    private readonly api: ViewerApi,
  ) {}

  /** The slice the handle is on, while shown */
  get target(): ReadonlyState<ObliqueHandleTarget | undefined> {
    return this.#target.asReadonly;
  }

  show(target: ObliqueHandleTarget): boolean {
    const canvas = this.plugin.canvas3d;
    if (!canvas) return false;
    this.#target.set(target);
    if (!this.#controller) {
      const binding = new ObliqueHandleBinding(
        this.plugin,
        this.api,
        () => this.#target.value,
        this.#items,
        (slice, frame) => this.#released.set(slice, frame),
      );
      const controller = new GizmoController(canvas, binding);
      this.#binding = binding;
      this.#controller = controller;
      this.#release = this.plugin.managers.interactivity.clickOwners.claim((r) => controller.owns(r));
      this.#sub = this.plugin.state.data.events.changed.subscribe(() => this.#publish());
    }
    this.#publish();
    return true;
  }

  hide() {
    this.#target.set(undefined);
    if (!this.#controller) return;
    this.#sub?.unsubscribe();
    this.#release?.();
    this.#controller.dispose();
    this.#binding?.dispose();
    this.#controller = undefined;
    this.#binding = undefined;
  }

  /** The slice as an item: its plane's frame as the state has it, a size of the volume's */
  #publish() {
    const t = this.#target.value;
    const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
    const plane = t && statePlane(this.plugin, t.slice);
    if (!t || !grid || !plane) {
      // its slice or volume removed: no handle
      if (t) this.hide();
      this.#items.next([]);
      return;
    }
    const size = Math.max(Grid.getBoundingSphere(grid).radius * 0.5, MinHandleSize);
    // as released (a turn about the normal kept: no spin on release) while the plane is its; else the plane's own
    const released = this.#released.get(t.slice);
    const frame = released && samePlane(planeOfFrame(released), plane) ? released : undefined;
    if (!frame) this.#released.delete(t.slice);
    this.#items.next([
      {
        key: t.slice,
        value: { frame: frame ?? obliqueFrame(grid, obliquePoseOfPlane(grid, plane)), size },
        label: 'Oblique slice',
      },
    ]);
  }
}
