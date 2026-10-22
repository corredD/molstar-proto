/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat3, Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { type GizmoBinding, GizmoController, type GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import { type DragFrame, type GizmoPose, poseGesture } from '@molstar/graphics/util/gizmo/gestures';
import type { Handle } from '@molstar/graphics/util/gizmo/handle';
import { transformHandles } from '@molstar/graphics/util/gizmo/transform';
import type { PluginContext } from '@molstar/plugin/context';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import type { ObjectPlacement, StageApi } from './operations.js';

// An object moved by hand (apps/prism-me/_spec/ui.md, Prism first): Prism's gizmo library, its transform handles, on a
// particle list, a volume or a mesh, as Prism's structure move has them on a structure (sources/structure-move): a
// rigid move about the object's center, its own transform (a mesh's scale) kept under the turn. A drag's preview moves
// the object as drawn (`previewMove`), its release is one `stage.move` (the move beyond where it was), frames held
// until the state has it.

/** The pose of a placement: its center as placed, its turn (a scale in its matrix taken out) */
function placementPose(p: ObjectPlacement): GizmoPose {
  const position = Vec3.transformMat4(Vec3(), p.center, p.matrix);
  const m = Mat3.fromMat4(Mat3(), p.matrix);
  // the columns unit: the turn without a scale
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(m[3 * c], m[3 * c + 1], m[3 * c + 2]) || 1;
    for (let r = 0; r < 3; r++) m[3 * c + r] /= n;
  }
  const rotation = Quat.normalize(Quat(), Quat.fromMat3(Quat(), m));
  return { position, rotation, scale: Vec3.create(1, 1, 1) };
}

/** The rigid matrix of a pose about `center`: `T(position) R T(−center)` */
function poseMatrix(pose: GizmoPose, center: Vec3): Mat4 {
  const out = Mat4.fromTranslation(Mat4(), pose.position);
  Mat4.mul(out, out, Mat4.fromQuat(Mat4(), pose.rotation));
  return Mat4.mul(out, out, Mat4.fromTranslation(Mat4(), Vec3.negate(Vec3(), center)));
}

/** A drag on `handle` from `from`: the new pose, what the matrix has beyond a rigid move (a scale) kept under it */
export function dragPlacement(
  from: ObjectPlacement,
  handle: Handle,
  frame: DragFrame,
  dx: number,
  dy: number,
): ObjectPlacement {
  const base = placementPose(from);
  const pose = poseGesture(base, handle, frame, dx, dy);
  if (!pose) return from;
  const residual = Mat4.mul(Mat4(), Mat4.invert(Mat4(), poseMatrix(base, from.center)), from.matrix);
  return { ...from, matrix: Mat4.mul(Mat4(), poseMatrix(pose, from.center), residual) };
}

/** The move from one placement to another (what `stage.move` applies, after where it is) */
export function moveBetween(from: ObjectPlacement, next: ObjectPlacement): Mat4 {
  return Mat4.mul(Mat4(), next.matrix, Mat4.invert(Mat4(), from.matrix));
}

/** The longest a commit holds the canvas's frames (ms) */
const MaxCommitHoldMs = 3000;

class ObjectMoveBinding implements GizmoBinding<ObjectPlacement> {
  readonly #invalidated = new Subject<string>();

  constructor(
    private readonly plugin: PluginContext,
    private readonly area: StageApi,
    readonly items: Observable<readonly GizmoItem<ObjectPlacement>[]>,
  ) {}

  get invalidated(): Observable<string> {
    return this.#invalidated;
  }

  layout(item: GizmoItem<ObjectPlacement>) {
    const pose = placementPose(item.value);
    const frame = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), pose.position), Mat4.fromQuat(Mat4(), pose.rotation));
    return { ...transformHandles(item.value.radius * 0.6), frame };
  }

  sameGeometry(a: ObjectPlacement, b: ObjectPlacement) {
    return a.radius === b.radius;
  }

  equal(a: ObjectPlacement, b: ObjectPlacement) {
    return Mat4.areEqual(a.matrix, b.matrix, 1e-6);
  }

  apply(from: ObjectPlacement, handle: Handle, frame: DragFrame, dx: number, dy: number): ObjectPlacement {
    return dragPlacement(from, handle, frame, dx, dy);
  }

  async preview(key: string, from: ObjectPlacement, next: ObjectPlacement) {
    this.area.previewMove(key, moveBetween(from, next));
  }

  async commit(key: string, from: ObjectPlacement, next: ObjectPlacement) {
    const done = (async () => {
      try {
        const r = await this.area.move({ target: key, matrix: Array.from(moveBetween(from, next)) } as never);
        return r.ok;
      } finally {
        // drawn as the state has it now (moved, or not)
        this.area.previewMove(key, Mat4.identity());
      }
    })();
    this.plugin.canvas3d?.holdFrames(done, MaxCommitHoldMs);
    return done;
  }

  cancel(key: string) {
    this.area.previewMove(key, Mat4.identity());
  }

  dispose() {
    this.#invalidated.complete();
  }
}

/** The handles on an object (a particle list, a volume, a mesh) while shown */
export class ObjectMoveGizmos {
  readonly #target = observableState<string | undefined>(undefined);
  readonly #shown = observableState(false);
  readonly #items = new BehaviorSubject<readonly GizmoItem<ObjectPlacement>[]>([]);
  #controller: GizmoController<ObjectPlacement> | undefined;
  #binding: ObjectMoveBinding | undefined;
  #release: (() => void) | undefined;
  #sub: { unsubscribe(): void } | undefined;

  constructor(
    private readonly plugin: PluginContext,
    private readonly area: StageApi,
  ) {}

  /** The object the handles are on (its ref) */
  get target(): ReadonlyState<string | undefined> {
    return this.#target.asReadonly;
  }

  get shown(): ReadonlyState<boolean> {
    return this.#shown.asReadonly;
  }

  setTarget(ref: string | undefined) {
    this.#target.set(ref);
    this.#publish();
  }

  /** The handles on the target; without a canvas (headless): false */
  show(): boolean {
    if (this.#controller) return true;
    const canvas = this.plugin.canvas3d;
    if (!canvas) return false;
    const binding = new ObjectMoveBinding(this.plugin, this.area, this.#items);
    const controller = new GizmoController(canvas, binding);
    this.#binding = binding;
    this.#controller = controller;
    this.#release = this.plugin.managers.interactivity.clickOwners.claim((r) => controller.owns(r));
    this.#sub = this.plugin.state.data.events.changed.subscribe(() => this.#publish());
    this.#publish();
    this.#shown.set(true);
    return true;
  }

  hide() {
    if (!this.#controller) return;
    this.#sub?.unsubscribe();
    this.#release?.();
    this.#controller.dispose();
    this.#binding?.dispose();
    this.#controller = undefined;
    this.#binding = undefined;
    this.#shown.set(false);
  }

  /** The target as an item: its placement now */
  #publish() {
    const ref = this.#target.value;
    const value = ref ? this.area.placementOf(ref) : undefined;
    const label = ref ? (this.plugin.state.data.cells.get(ref)?.obj?.label ?? 'Object') : '';
    this.#items.next(ref && value ? [{ key: ref, value, label }] : []);
  }
}
