/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { StateObjectCell } from '@molstar/core/state';
import type { Representation } from '@molstar/graphics/repr/representation';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import {
  getFiberParticleMask,
  getParticleTargetGroups,
  type ParticleList,
  type ParticleTarget,
} from '@molstar/model/model/particles/particle-list';
import { OrderedSet } from '@molstar/core/data/int';
import { fillSerial } from '@molstar/core/util/array';
import { canSetParticleFrames } from '@molstar/graphics/repr/particles/representation/target/representation';
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
// particles offset as drawn only (the state, and its history, untouched), drawing again only what moves: the target
// representation writes the moved particles' instances (`setParticleFrames`), another representation that draws one of
// them is made again from the offset particles (`drawsAny`); its release is one step (`cryoet.offset` or
// `cryoet.instance`), which draws the list from the state.

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
export interface Stack {
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

/**
 * The particles a handle's edit moves, in the list's order of targets: the particle alone (`instance`), or every particle
 * of the edited targets (all of them for `''`)
 */
export function movedIndices(input: ParticleList, index: number, edit: HandleEdit): Int32Array {
  if (edit.kind === 'instance') return Int32Array.of(index);
  if (!edit.targets) return fillSerial(new Int32Array(input.count));
  const ids = new Set(edit.targets.split(',').map(Number));
  // the targets' particles from the list's grouping (cached on it): no scan of the particles
  const groups = getParticleTargetGroups(input);
  let n = 0;
  for (let g = 0; g < groups.targetIds.length; g++)
    if (ids.has(groups.targetIds[g])) n += OrderedSet.size(groups.sets[g]);
  const out = new Int32Array(n);
  let k = 0;
  for (let g = 0; g < groups.targetIds.length; g++) {
    if (!ids.has(groups.targetIds[g])) continue;
    OrderedSet.forEach(groups.sets[g], (i) => {
      out[k++] = i;
    });
  }
  return out;
}

const _q = Quat();
const _m = Mat4();

/**
 * The frames of `indices` (16 floats each, as `getParticleTransforms`) with a stack's offsets, as `offsetParticles`
 * places them: the particle's frame, its targets' offsets in order, then its own; into `out` (reused across a drag)
 */
export function offsetFrames(stack: Stack, indices: ArrayLike<number>, out?: Float32Array): Float32Array {
  const n = indices.length;
  const frames = out && out.length === n * 16 ? out : new Float32Array(n * 16);
  const { input } = stack;
  // the offsets as matrices once, and the particles' own by index (a few: those edited alone)
  const offsets = stack.offsets.map((o) => ({ targets: o.targets, m: offsetMatrix(o.translation, o.euler) }));
  const own = new Map<number, Mat4>();
  for (const o of stack.instances) own.set(o.index, offsetMatrix(o.translation, o.euler));
  // the targets' offsets, composed once per target (a drag of a kind moves many particles of one target)
  let lastTarget = Number.NaN;
  const byTarget = Mat4.identity();
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    const target = input.targets[i];
    if (target !== lastTarget) {
      lastTarget = target;
      Mat4.setIdentity(byTarget);
      for (const o of offsets) if (!o.targets.length || o.targets.includes(target)) Mat4.mul(byTarget, byTarget, o.m);
    }
    if (input.rotations) Quat.fromArray(_q, input.rotations, i * 4);
    else Quat.setIdentity(_q);
    Mat4.fromQuat(_m, _q);
    _m[12] = input.coordinates[i * 3];
    _m[13] = input.coordinates[i * 3 + 1];
    _m[14] = input.coordinates[i * 3 + 2];
    Mat4.mul(_m, _m, byTarget);
    const alone = own.get(i);
    if (alone) Mat4.mul(_m, _m, alone);
    Mat4.toArray(_m, frames, k * 16);
  }
  return frames;
}

/**
 * Whether a representation of the list (other than the target one) draws one of `indices`: a fibers one draws the fiber
 * particles only, a spacefill one that leaves out the particles with a target (a cellPACK's: `complexVisuals`) those
 * without; any other, every particle. One read a moved particle, of masks cached on the list
 */
export function drawsAny(
  params: unknown,
  repr: { readonly props: unknown },
  list: ParticleList,
  indices: ArrayLike<number>,
): boolean {
  const name = (params as { type?: { name?: string } } | undefined)?.type?.name;
  if (name === 'fibers') {
    const mask = getFiberParticleMask(list);
    if (!mask) return false;
    for (let k = 0; k < indices.length; k++) if (mask[indices[k]]) return true;
    return false;
  }
  if (name === 'spacefill' && (repr.props as { excludeTargets?: boolean } | undefined)?.excludeTargets) {
    const mapping = list.targetMapping;
    if (!mapping) return indices.length > 0;
    for (let k = 0; k < indices.length; k++) if (!mapping.has(list.targets[indices[k]])) return true;
    return false;
  }
  return indices.length > 0;
}

/** How long the camera takes to aim at a particle (ms) */
const AimMs = 250;

/** The smallest a particle's handle is (Å), what it moves however small */
const MinHandleSize = 20;

/** How far what is drawn on a particle (its decoration) reaches from the particle's origin, 0 for none */
function objectReach(target: ParticleTarget | undefined): number {
  if (!target) return 0;
  // a decoration is placed at the particle by its own coordinates: a cellPACK protein's sit off its origin
  const reach = (s: { center: Vec3; radius: number } | undefined) => (s ? Vec3.magnitude(s.center) + s.radius : 0);
  if (target.kind === 'structure') return reach(target.structure.boundary.sphere);
  if (target.kind === 'volume') return reach(Grid.getBoundingSphere(target.volume.grid));
  return reach((target.shape.geometry as { boundingSphere?: { center: Vec3; radius: number } }).boundingSphere);
}

/** How far past what it moves a particle's handle reaches */
const HandleMargin = 1.25;

/**
 * The size of a particle's handle (how far it reaches from the particle's origin): a quarter past what it moves, the
 * decoration's far side, else the particle's own sphere (`particleRadius`, the list's for the particle). Not the
 * particle's radius with a decoration: a cellPACK file's is about the decoration's, which sits off the origin
 */
export function handleSize(target: ParticleTarget | undefined, particleRadius: number): number {
  const reach = objectReach(target) || particleRadius;
  return Math.max(reach * HandleMargin, MinHandleSize);
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
        await this.#draw(t, solved.stack);
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
        if (!r.ok || r.unchanged) await this.#draw(t);
        else this.#settled();
        return r.ok;
      },
      cancel: () => void this.#draw(this.#target.value),
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

  /** A commit drew the list from the state again: nothing previewed is left to put back */
  #settled() {
    this.#moved = undefined;
    this.#rebuilt.clear();
  }

  /** The particles a drag moves and their frames' buffer, for one particle and edit (kept across the drag's previews) */
  #moved: { key: string; input: ParticleList; indices: Int32Array; frames: Float32Array } | undefined;
  /** The representations a preview drew made again from other particles (put back by `#draw(undefined)`) */
  readonly #rebuilt = new Set<Representation<ParticleList>>();

  /**
   * The list's representations drawn with the particles `stack` places (the drawing only); none: as the state has them.
   * Only what moves is drawn again (David's "snappy" rule, a drag at pointer rate): the target representation (a
   * cellPACK's proteins) writes the moved particles' instances alone (`setParticleFrames`); another one that draws a
   * moved particle is made again from the offset particles
   */
  async #draw(t: ParticleHandleTarget | undefined, stack?: Stack) {
    const l = t && this.plugin.managers.particles.hierarchy.current.lists.find((x) => x.cell.transform.ref === t.list);
    if (!l) return;
    const canvas = this.plugin.canvas3d;
    let moved: { indices: Int32Array; frames: Float32Array } | undefined;
    if (stack) {
      const key = `${t.list}:${t.index}:${t.edit.kind === 'offset' ? t.edit.targets : '#'}`;
      if (this.#moved?.key !== key || this.#moved.input !== stack.input) {
        const indices = movedIndices(stack.input, t.index, t.edit);
        this.#moved = { key, input: stack.input, indices, frames: new Float32Array(indices.length * 16) };
      }
      offsetFrames(stack, this.#moved.indices, this.#moved.frames);
      moved = this.#moved;
    } else {
      this.#moved = undefined;
    }
    let offset: ParticleList | undefined;
    for (const r of l.representations) {
      const repr = (r.cell.obj?.data as { repr?: Representation<ParticleList> } | undefined)?.repr;
      const source = (r.cell.obj?.data as { sourceData?: ParticleList } | undefined)?.sourceData;
      if (!repr || !source) continue;
      if (canSetParticleFrames(repr)) {
        if (repr.setParticleFrames(moved)) canvas?.update(repr);
        continue;
      }
      if (!stack) {
        if (!this.#rebuilt.delete(repr)) continue;
        await this.plugin.runTask(repr.createOrUpdate({}, source));
      } else {
        if (!drawsAny(r.cell.transform.params, repr, source, moved!.indices)) continue;
        offset ??= offsetParticles(stack.input, stack.offsets, stack.instances);
        this.#rebuilt.add(repr);
        await this.plugin.runTask(repr.createOrUpdate({}, offset));
      }
      // the new values given to the canvas, as the state's update would (its renderables upload them there): a redraw
      // request alone draws the particles where they were, until the release's commit
      canvas?.update(repr);
    }
    canvas?.requestDraw();
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
    const size = handleSize(data.targetMapping?.get(data.targets[t.index]), data.radii?.[t.index] ?? 0);
    return [
      {
        key: `${t.list}:${t.index}`,
        value: { frame: particleFrame(data, t.index), size },
        label: `Particle ${t.index}`,
      },
    ];
  }
}
