/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { StateObjectCell } from '@molstar/core/state';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { Grid } from '@molstar/model/model/volume';
import type { PluginContext } from '@molstar/plugin/context';
import {
  offsetParticles,
  ParticleListOffsets,
  type ParticleInstanceOffsetProps,
  type ParticleOffsetProps,
} from '@molstar/plugin/state/transforms/particles/ops';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { type FrameValue, frameHandles, GizmoHandles } from '@molstar/prism-viewer/sources/gizmos';
import { placementWith, poseOf } from './move.js';

// A particle's local handle (apps/prism-me/_spec/ui.md, step 4): Prism's handles (`GizmoHandles`, on a frame:
// `frameHandles`) on one particle, in its own frame, that edits an offset of what decorates the particles (`ParticleListOffsets`): with All on, its target's (its
// class, its kind: every particle like it) or the list's; with All off, its own alone (`instances`). A drag shows the
// particles offset as drawn only (the list's representations given the offset particles: the state, and its history,
// untouched), its release is one step (`cryoet.offset` or `cryoet.instance`).

/** What a particle's handle edits: one particle's own offset, or some targets' ('': every particle) */
export type HandleEdit = { readonly kind: 'instance' } | { readonly kind: 'offset'; readonly targets: string };

/** The particle the handle is on, and what it edits */
export interface ParticleHandleTarget {
  /** The particle list (its state ref) */
  readonly list: string;
  readonly index: number;
  readonly edit: HandleEdit;
}

/** An offset as a matrix in the particle's frame: `T(translation) R(euler)` (X, then Y, then Z) */
export function offsetMatrix(translation: ArrayLike<number>, euler: ArrayLike<number>): Mat4 {
  const pose = {
    position: [translation[0], translation[1], translation[2]] as const,
    euler: [euler[0], euler[1], euler[2]] as const,
  };
  return placementWith({ matrix: Mat4.identity(), center: Vec3() }, pose);
}

/** A particle's frame in a list: `T(position) R(orientation)` */
export function particleFrame(list: ParticleList, index: number): Mat4 {
  const q = list.rotations ? Quat.fromArray(Quat(), list.rotations, index * 4) : Quat.identity();
  const m = Mat4.fromQuat(Mat4(), q);
  m[12] = list.coordinates[index * 3];
  m[13] = list.coordinates[index * 3 + 1];
  m[14] = list.coordinates[index * 3 + 2];
  return m;
}

const key = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join(',');

/** A list's offsets decorator, if any (the last of its decorators) */
function offsetsCell(plugin: PluginContext, list: string): StateObjectCell | undefined {
  const { tree, cells } = plugin.state.data;
  let ref = list;
  for (;;) {
    const next = tree.children
      .get(ref)
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator);
    if (!next) return undefined;
    if (next.transform.transformer === ParticleListOffsets) return next;
    ref = next.transform.ref;
  }
}

/** A particle's offsets, as the handle edits one of them */
interface Stack {
  /** The particles before the offsets (the decorator's input; the list as drawn without one) */
  readonly input: ParticleList;
  readonly offsets: readonly ParticleOffsetProps[];
  readonly instances: readonly ParticleInstanceOffsetProps[];
}

function stackOf(plugin: PluginContext, list: string): Stack | undefined {
  const cell = offsetsCell(plugin, list);
  const parent = cell && plugin.state.data.cells.get(cell.transform.parent);
  const drawn = plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === list);
  const input = (parent?.obj?.data ?? drawn?.representations[0]?.cell.obj?.data.sourceData ?? drawn?.cell.obj?.data) as
    | ParticleList
    | undefined;
  if (!input) return undefined;
  const p = (cell?.transform.params ?? {}) as {
    offsets?: ParticleOffsetProps[];
    instances?: ParticleInstanceOffsetProps[];
  };
  return { input, offsets: p.offsets ?? [], instances: p.instances ?? [] };
}

/**
 * The edited offset for a particle's frame `next`: the particle's base frame, what applies before the edited offset and
 * after it, solved for it (`(base · before)⁻¹ · next · after⁻¹`); with the stack it is set in
 */
export function solveEdit(
  stack: Stack,
  index: number,
  edit: HandleEdit,
  next: Mat4,
): { translation: [number, number, number]; euler: [number, number, number]; stack: Stack } {
  const target = stack.input.targets[index];
  const applies = (o: ParticleOffsetProps) => !o.targets.length || o.targets.includes(target);
  const editKey = edit.kind === 'offset' ? edit.targets : undefined;
  const at = editKey !== undefined ? stack.offsets.findIndex((o) => key(o.targets) === editKey) : -1;
  const before = Mat4.identity();
  const after = Mat4.identity();
  stack.offsets.forEach((o, i) => {
    if (!applies(o)) return;
    const m = offsetMatrix(o.translation, o.euler);
    // the edited one, or (not set yet: added last) every one before it
    if (edit.kind === 'instance' || at < 0 || i < at) Mat4.mul(before, before, m);
    else if (i > at) Mat4.mul(after, after, m);
  });
  const own = stack.instances.find((o) => o.index === index);
  if (edit.kind === 'offset' && own) Mat4.mul(after, after, offsetMatrix(own.translation, own.euler));
  const base = Mat4.mul(Mat4(), particleFrame(stack.input, index), before);
  const edited = Mat4.mul(Mat4(), Mat4.invert(Mat4(), base), next);
  Mat4.mul(edited, edited, Mat4.invert(Mat4(), after));
  const pose = poseOf({ matrix: edited, center: Vec3() });
  const translation = [pose.position[0], pose.position[1], pose.position[2]] as [number, number, number];
  const euler = [pose.euler[0], pose.euler[1], pose.euler[2]] as [number, number, number];
  // the stack with it
  const offsets = stack.offsets.slice();
  const instances = stack.instances.slice();
  if (edit.kind === 'instance') {
    const i = instances.findIndex((o) => o.index === index);
    const o = { index, translation: Vec3.create(...translation), euler: Vec3.create(...euler) };
    if (i >= 0) instances[i] = o;
    else instances.push(o);
  } else {
    const ids = edit.targets ? edit.targets.split(',').map(Number) : [];
    const o = { targets: ids, translation: Vec3.create(...translation), euler: Vec3.create(...euler) };
    if (at >= 0) offsets[at] = o;
    else offsets.push(o);
  }
  return { translation, euler, stack: { ...stack, offsets, instances } };
}

/** How long the camera takes to aim at a particle (ms) */
const AimMs = 250;

/** The smallest a particle's handle is (Å), what it moves however small */
const MinHandleSize = 20;

/** The radius of what is drawn on a particle (its decoration's), 0 for none */
function objectRadius(target: ParticleTarget | undefined): number {
  if (!target) return 0;
  if (target.kind === 'structure') return target.structure.boundary.sphere.radius;
  if (target.kind === 'volume') return Grid.getBoundingSphere(target.volume.grid).radius;
  const sphere = (target.shape.geometry as { boundingSphere?: { radius: number } }).boundingSphere;
  return sphere?.radius ?? 0;
}

/** The local handle on a particle while shown: its list, the particle, what it edits */
export class ParticleHandles {
  readonly #target = observableState<ParticleHandleTarget | undefined>(undefined);
  readonly #handles: GizmoHandles<FrameValue>;

  constructor(
    private readonly plugin: PluginContext,
    private readonly api: ViewerApi,
  ) {
    this.#handles = new GizmoHandles(plugin, {
      ...frameHandles(),
      items: () => this.#items(),
      // the key is the particle's (`list:index`): what a drag starts from is its list (the offsets under it)
      cells: (key) => [key.slice(0, key.lastIndexOf(':'))],
      preview: async (_key, _from, next) => {
        const t = this.#target.value;
        const stack = t && stackOf(this.plugin, t.list);
        if (!t || !stack) return;
        const solved = solveEdit(stack, t.index, t.edit, next.frame);
        await this.#draw(offsetParticles(stack.input, solved.stack.offsets, solved.stack.instances));
      },
      commit: async (_key, _from, next) => {
        const t = this.#target.value;
        const stack = t && stackOf(this.plugin, t.list);
        if (!t || !stack) return false;
        const {
          translation: [x, y, z],
          euler: [ex, ey, ez],
        } = solveEdit(stack, t.index, t.edit, next.frame);
        const r =
          t.edit.kind === 'instance'
            ? await this.api.run('cryoet.instance', { particles: t.list, index: t.index, x, y, z, ex, ey, ez })
            : await this.api.run('cryoet.offset', { particles: t.list, targets: t.edit.targets, x, y, z, ex, ey, ez });
        // drawn as the state has it now (offset, or not)
        if (!r.ok || r.unchanged) await this.#draw(undefined);
        return r.ok;
      },
      cancel: () => void this.#draw(undefined),
    });
  }

  /** The particle the handle is on and what it edits, while shown */
  get target(): ReadonlyState<ParticleHandleTarget | undefined> {
    return this.#target.asReadonly;
  }

  /** The handle on a particle, editing an offset (All on: its target's, or `targets`'), or its own (All off) */
  show(target: ParticleHandleTarget): boolean {
    if (!this.plugin.canvas3d) return false;
    const before = this.#target.value;
    this.#target.set(target);
    // another particle: the camera aimed at it (the same distance and angle), so a zoom goes toward it, not the scene's
    // middle (empty between a list and what else is open)
    if (before?.list !== target.list || before?.index !== target.index) this.#aimAt(target);
    return this.#handles.show();
  }

  /** All on: the offset of the particle's kind (its target); off: the particle alone */
  setAll(all: boolean) {
    const t = this.#target.value;
    if (!t) return;
    const list = this.#particles(t.list);
    const kind = list ? String(list.targets[t.index]) : '';
    this.show({ ...t, edit: all ? { kind: 'offset', targets: kind } : { kind: 'instance' } });
  }

  hide() {
    // a drag in progress put back first (its redraw needs the target)
    this.#handles.hide();
    this.#target.set(undefined);
  }

  /** The list's representations given these particles (the drawing only); none: as the state has them */
  async #draw(particles: ParticleList | undefined) {
    const t = this.#target.value;
    const l = t && this.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === t.list);
    if (!l) return;
    for (const r of l.representations) {
      const repr = (r.cell.obj?.data as { repr?: { createOrUpdate(p: object, d?: ParticleList): any } } | undefined)
        ?.repr;
      const data = particles ?? (r.cell.obj?.data as { sourceData?: ParticleList } | undefined)?.sourceData;
      if (repr && data) await this.plugin.runTask(repr.createOrUpdate({}, data));
    }
    this.plugin.canvas3d?.requestDraw();
  }

  /** The camera's target moved to a particle, its offset kept (one short move) */
  #aimAt(target: ParticleHandleTarget) {
    const camera = this.plugin.canvas3d?.camera;
    const data = this.#particles(target.list);
    if (!camera || !data || target.index >= data.count) return;
    const at = Vec3.fromArray(Vec3(), data.coordinates, target.index * 3);
    const offset = Vec3.sub(Vec3(), camera.state.position, camera.state.target);
    camera.setState({ target: at, position: Vec3.add(Vec3(), at, offset) }, AimMs);
  }

  /** The particles of a list as drawn */
  #particles(list: string): ParticleList | undefined {
    const l = this.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === list);
    return (l?.representations[0]?.cell.obj?.data.sourceData ?? l?.cell.obj?.data) as ParticleList | undefined;
  }

  /** The particle as an item: its frame as drawn, a size of its own (its radius, or that of what decorates it) */
  #items(): GizmoItem<FrameValue>[] {
    const t = this.#target.value;
    const data = t ? this.#particles(t.list) : undefined;
    if (!t || !data || t.index >= data.count) return [];
    // at least as big as what it moves: past the object drawn on the particle (its radius), else the particle's own
    const r = data.radii?.[t.index] ?? 0;
    const size = Math.max(objectRadius(data.targetMapping?.get(data.targets[t.index])) * 1.6, r * 3, MinHandleSize);
    return [
      {
        key: `${t.list}:${t.index}`,
        value: { frame: particleFrame(data, t.index), size },
        label: `Particle ${t.index}`,
      },
    ];
  }
}
