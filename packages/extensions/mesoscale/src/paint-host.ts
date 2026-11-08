/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec2, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { OrderedSet } from '@molstar/core/data/int';
import type { PickingId } from '@molstar/graphics/geo/geometry/picking';
import {
  getParticleEntityGroups,
  getParticleTargetGroups,
  Particle,
} from '@molstar/model/model/particles/particle-list';
import type { PluginContext } from '@molstar/plugin/context';
import type { PaintBrushTarget, PaintHost, PaintSettings } from './paint-mode.js';
import { brushOf } from './paint.js';
import { membraneFrame } from './pick-surface.js';

// Paint mode's host on the viewer (paint-mode.ts): the plugin's canvas, its picks and camera, and the stroke run as
// `mesoscale.paint`.

const _v = Vec2();
const _p4 = Vec4();

/** The host of a paint mode on `plugin`; `paint` runs the operation */
export function pluginPaintHost(
  plugin: PluginContext,
  paint: (params: Record<string, unknown>) => Promise<unknown>,
): PaintHost {
  const listOf = (ref: string) =>
    plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === ref);
  return {
    canvas: () => plugin.canvas3dContext?.canvas ?? undefined,
    identify: (x, y) => plugin.canvas3d?.identify(Vec2.set(_v, x, y)),
    eye: (out) => Vec3.copy(out, plugin.canvas3d?.camera.state.position ?? Vec3.create(0, 0, 1)),
    refine(point) {
      const loci = plugin.canvas3d?.getLoci(point.id as PickingId).loci;
      if (!loci || !Particle.isLoci(loci) || OrderedSet.size(loci.indices) !== 1) return;
      membraneFrame(loci.particles, OrderedSet.start(loci.indices), point);
    },
    upright(brush) {
      const data = listOf(brush.particles)?.cell.obj?.data;
      return !!data && !!brushOf(data, brush.entity)?.surface;
    },
    project(out, p) {
      const canvas = plugin.canvas3d;
      if (!canvas) return Vec3.set(out, 0, 0, 0);
      canvas.camera.project(_p4, p);
      const ratio = canvas.graphics.pixelRatio || 1;
      return Vec3.set(out, _p4[0] / ratio, _p4[1] / ratio, _p4[2]);
    },
    radius(brush) {
      const data = listOf(brush.particles)?.cell.obj?.data;
      if (!data) return 1;
      // its first particle's (a list without entities: its targets are its entities)
      const groups = data.entityInfo?.size ? undefined : getParticleTargetGroups(data);
      const set = groups
        ? groups.sets[groups.groupOfTarget.get(brush.entity) ?? -1]
        : getParticleEntityGroups(data).get(brush.entity);
      return (set && OrderedSet.size(set) && data.radii?.[OrderedSet.start(set)]) || 10;
    },
    paint(brush: PaintBrushTarget, s: PaintSettings, positions, normals) {
      return paint({
        particles: brush.particles,
        entity: String(brush.entity),
        positions,
        normals,
        side: s.side,
        ...(s.orient !== 'auto' ? { orient: s.orient } : {}),
        ...(s.spin !== undefined ? { spin: s.spin } : {}),
      });
    },
    has: (brush) => !!listOf(brush.particles),
    changed(fn) {
      const sub = plugin.state.data.events.changed.subscribe(fn);
      return () => sub.unsubscribe();
    },
  };
}
