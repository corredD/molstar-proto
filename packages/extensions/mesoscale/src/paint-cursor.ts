/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { RuntimeContext } from '@molstar/core/task';
import { CustomProperties } from '@molstar/model/model/custom-property';
import {
  getParticleEntityGroups,
  getParticleTargetGroups,
  type ParticleList,
} from '@molstar/model/model/particles/particle-list';
import type { Representation } from '@molstar/graphics/repr/representation';
import { VisualSet, type VisualSetCanvas } from '@molstar/graphics/util/visual-set';
import type { PluginContext } from '@molstar/plugin/context';
import type { ParticleListRef } from '@molstar/plugin/state/manager/particles/hierarchy-state';
import type { PaintBrushTarget, PaintCursor } from './paint-mode.js';
import { type PaintOrient, paintRotation, principalAxisOf } from './paint.js';

// The copy under the pointer (progress/2026-11-08-paint.md, Round 2): one copy of the brush drawn before it is painted,
// where a click would put it and turned as it would be (the stroke's seed). A representation outside the state (a
// `VisualSet`) of a one-particle list of the brush's target, with the list's own representation and its entity's color;
// in the scene layer (Round 4: depth-tested against the scene, where a copy at a depth goes is seen among the others),
// never picked (the surface under it is read through it). Moved by its transform, not rebuilt.

const _m = Mat4();
const _q = Quat();
const _dir = Vec3();
/** The states the copy is set to, made once: nothing allocated a frame (review N3) */
const Shown = { transform: _m, visible: true };
const Hidden = { visible: false };

/** One particle of `list`'s particle `i`: its target, entity and compartment at the origin, unturned */
export function oneCopyOf(list: ParticleList, i: number): ParticleList {
  const target = list.targets[i];
  const object = list.targetMapping?.get(target);
  return {
    ...list,
    // its own one-target map: the target visual caches its signatures by this map (the whole list's would be computed
    // again at its next commit; review N1); no move of its own
    targetMapping: object ? new Map([[target, object]]) : undefined,
    movedFrom: undefined,
    count: 1,
    keys: Int32Array.of(0),
    targets: Int32Array.of(list.targets[i]),
    coordinates: Float32Array.of(0, 0, 0),
    rotations: Float32Array.of(0, 0, 0, 1),
    ...(list.entities ? { entities: Int32Array.of(list.entities[i]) } : {}),
    ...(list.compartments ? { compartments: Int32Array.of(list.compartments[i]) } : {}),
    ...(list.radii ? { radii: Float32Array.of(list.radii[i]) } : {}),
    attributes: undefined,
    fibers: undefined,
    getParticleLabel: () => 'Paint brush',
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}

/** The first particle of a brush in `list` (an entity, or a target on a list without entities), if any */
export function firstOfBrush(list: ParticleList, id: number): number | undefined {
  const set = list.entityInfo?.size
    ? getParticleEntityGroups(list).get(id)
    : getParticleTargetGroups(list).sets[getParticleTargetGroups(list).groupOfTarget.get(id) ?? -1];
  return set && OrderedSet.size(set) ? OrderedSet.start(set) : undefined;
}

/**
 * The copy under the pointer of `brush` in `plugin`'s canvas, drawn as `list`'s first representation draws it, in the
 * entity's color `color` when its look sets one; nothing (a cursor that does nothing) without a canvas or a particle
 */
export function pluginPaintCursor(
  plugin: PluginContext,
  list: ParticleListRef | undefined,
  brush: PaintBrushTarget,
  color: number | undefined,
  surface: boolean,
  canvas: VisualSetCanvas | undefined = plugin.canvas3d,
): PaintCursor {
  const r = list?.representations[0];
  const data = r?.cell.obj?.data.sourceData as ParticleList | undefined;
  const i = data ? firstOfBrush(data, brush.entity) : undefined;
  const params = r?.cell.params?.values;
  if (!canvas || !data || i === undefined || !params) return NoCursor;

  const set = new VisualSet(canvas);
  const provider = plugin.representation.particles.registry.get(params.type.name);
  const one = oneCopyOf(data, i);
  const axis = principalAxisOf(data.targetMapping?.get(data.targets[i]));
  let repr: Representation<any, any, any> | undefined;
  let shown = false;
  /** The copy's turn options, set in place each move */
  const turn: { axis?: Vec3; spin?: number } = {};
  let gone = false;
  void set
    .fromProvider(provider, one, {
      themes: plugin.representation.particles.themes,
      themeData: { particles: one },
      properties: { runtime: RuntimeContext.Synchronous, assetManager: plugin.managers.asset },
      props: params.type.params,
      colorTheme: color !== undefined ? { name: 'uniform', params: { value: color } } : params.colorTheme,
      sizeTheme: params.sizeTheme,
      state: { pickable: false, layer: 'scene', visible: false },
    })
    .then((built) => {
      if (gone) return;
      repr = built;
      // where the pointer was while it was built
      if (shown) set.setState(repr, Shown);
    })
    .catch((e) => plugin.log.warn(`The paint brush's copy could not be drawn: ${e}`));

  return {
    move(position, normal, settings, seed) {
      const how: PaintOrient = settings.orient !== 'auto' ? settings.orient : surface ? 'normal' : 'random';
      // the operation's directions (`mesoscale.paint`): toward the viewer for `view`, the normal else; `in` turns it
      Vec3.copy(_dir, normal);
      const camera = plugin.canvas3d?.camera.state;
      if (how === 'view' && camera) Vec3.normalize(_dir, Vec3.sub(_dir, camera.position, camera.target));
      if (settings.side === 'in') Vec3.negate(_dir, _dir);
      turn.axis = how === 'axis' ? axis : undefined;
      turn.spin = settings.spin;
      paintRotation(_q, _dir, how, seed, 0, turn);
      Mat4.fromQuat(_m, _q);
      Mat4.setTranslation(_m, position);
      shown = true;
      if (repr) set.setState(repr, Shown);
    },
    hide() {
      if (!shown) return;
      shown = false;
      if (repr) set.setState(repr, Hidden);
    },
    dispose() {
      gone = true;
      set.dispose();
    },
  };
}

const NoCursor: PaintCursor = { move() {}, hide() {}, dispose() {} };
