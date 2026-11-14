/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec2, Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { OrderedSet } from '@molstar/core/data/int';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import type { Binding } from '@molstar/core/util/binding';
import type { Canvas3D } from '@molstar/graphics/canvas3d/canvas3d';
import type { PickingId } from '@molstar/graphics/geo/geometry/picking';
import {
  getParticleEntityGroups,
  getParticleTargetGroups,
  Particle,
} from '@molstar/model/model/particles/particle-list';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { PluginContext } from '@molstar/plugin/context';
import type { ParticleListRef } from '@molstar/plugin/state/manager/particles/hierarchy-state';
import type { PaintBrushTarget, PaintHost, PaintSettings } from './paint-mode.js';
import {
  brushIdOf,
  brushOf,
  decoratorUnder,
  type FiberSettingsMap,
  fiberSettingsOf,
  parseRange,
  isFiberBrush,
  type PaintStructure,
  ParticleListPainted,
} from './paint.js';
import { meshFrame, sceneMeshes } from './mesh-surface.js';
import { pluginPaintCursor, pluginStructureCursor } from './paint-cursor.js';
import { membraneFrame } from './pick-surface.js';

// Paint mode's host on the viewer (paint-mode.ts): the plugin's canvas, its picks and camera, and the stroke run as
// `mesoscale.paint`.

const _v = Vec2();
const _p4 = Vec4();
const _ray = Ray3D();

type TrackballBindings = Canvas3D['attribs']['trackball']['bindings'];

/** The camera's gestures that get an Alt version while painting (progress/2026-11-08-paint.md, Round 2, Decided 1) */
const AltCameraGestures = [
  'dragRotate',
  'dragRotateZ',
  'dragPan',
  'dragFocus',
  'dragFocusZoom',
  'scrollZoom',
  'scrollFocus',
  'scrollFocusZoom',
] as const;

/**
 * `bindings` with each camera gesture's triggers also taken with Alt held (Alt+left turns, Alt+right pans; Alt+wheel is
 * paint's depth, taken before the canvas: paint-refine): paint takes the plain left press, and a trigger's modifiers
 * match exactly (`Binding.Trigger.match`). A trigger without modifiers already matches any, and one with Alt is kept as
 * it is.
 */
export function withAltCamera(bindings: TrackballBindings): TrackballBindings {
  const out: Record<string, Binding> = { ...bindings };
  for (const k of AltCameraGestures) {
    const b = bindings[k];
    if (!b) continue;
    const alt: Binding.Trigger[] = [];
    for (const t of b.triggers) {
      if (t.modifiers && !t.modifiers.alt) alt.push({ ...t, modifiers: { ...t.modifiers, alt: true } });
    }
    if (alt.length) out[k] = { ...b, triggers: [...b.triggers, ...alt] };
  }
  return out as TrackballBindings;
}

/**
 * The host of a paint mode on `plugin`; `paint` runs the operation, `colorOf` reads an entity's color from its look
 * (the copy under the pointer's), `structureFiberStep` a structure brush's fibers' rise in a list (none: it makes none),
 * `ensureParticles` loads Mol*'s particles (lazy) for a structure brush's copy in a scene without them
 */
export function pluginPaintHost(
  plugin: PluginContext,
  paint: (params: Record<string, unknown>) => Promise<unknown>,
  colorOf?: (list: ParticleListRef, entity: number) => number | undefined,
  structureFiberStep?: (structure: string, into: string) => number | undefined,
  ensureParticles?: () => Promise<void>,
): PaintHost & { dispose(): void } {
  const listOf = (ref: string) =>
    plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === ref);
  /** A structure brush's structure (paint-layer round 2), if it is still in the scene */
  const structureOf = (brush: PaintBrushTarget) => {
    const obj = brush.structure ? plugin.state.data.cells.get(brush.structure)?.obj : undefined;
    return obj && SO.Molecule.Structure.is(obj) ? obj.data : undefined;
  };
  // where the pointer last was in the page (paint-refine): a mode started under a still pointer shows its copy there
  let pointerX = Number.NaN;
  let pointerY = Number.NaN;
  const track = (e: PointerEvent) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  };
  globalThis.document?.addEventListener('pointermove', track, { capture: true, passive: true });
  return {
    dispose: () => globalThis.document?.removeEventListener('pointermove', track, { capture: true }),
    canvas: () => plugin.canvas3dContext?.canvas ?? undefined,
    pointer() {
      const canvas = plugin.canvas3dContext?.canvas;
      if (!canvas || Number.isNaN(pointerX)) return undefined;
      // what is there now: a menu over the canvas that just closed leaves its :hover stale (review 11)
      const root = canvas.getRootNode() as Document | ShadowRoot;
      if (root.elementFromPoint?.(pointerX, pointerY) !== canvas) return undefined;
      const rect = canvas.getBoundingClientRect();
      return [pointerX - rect.left, pointerY - rect.top];
    },
    holdCamera() {
      const canvas = plugin.canvas3d;
      if (!canvas) return () => {};
      // the canvas's bindings as they are now (an app's, not the defaults), put back whole
      const saved = canvas.attribs.trackball.bindings;
      canvas.setAttribs({ trackball: { bindings: withAltCamera(saved) } });
      return () => canvas.setAttribs({ trackball: { bindings: saved } });
    },
    identify: (x, y) => plugin.canvas3d?.identify(Vec2.set(_v, x, y)),
    eye: (out) => Vec3.copy(out, plugin.canvas3d?.camera.state.position ?? Vec3.create(0, 0, 1)),
    ray(x, y, origin, direction) {
      const canvas = plugin.canvas3d;
      if (!canvas) return false;
      const ratio = canvas.graphics.pixelRatio || 1;
      // the camera's views are in its scaled units (`Camera.scale`): the origin back in the scene's
      const { camera } = canvas;
      camera.getRay(_ray, x * ratio, y * ratio);
      Vec3.scale(origin, _ray.origin, 1 / camera.scale);
      Vec3.copy(direction, _ray.direction);
      return true;
    },
    focus() {
      const state = plugin.canvas3d?.camera.state;
      return state ? Vec3.distance(state.position, state.target) : 100;
    },
    depthRange() {
      // the camera's planes in its scaled units (`Camera.scale`), as its rays' (`ray`)
      const camera = plugin.canvas3d?.camera;
      if (!camera || !(camera.far > camera.near)) return undefined;
      return [camera.near / camera.scale, camera.far / camera.scale];
    },
    refine(point, upright) {
      const canvas = plugin.canvas3d;
      const loci = canvas?.getLoci(point.id as PickingId).loci;
      if (!canvas || !loci) return;
      // a file mesh (grow-mesh): its triangle within a hundredth of the view's distance (a few pixels) of the pick
      const reach = Math.max(1, 0.01 * Vec3.distance(canvas.camera.state.position, point.position));
      const shape = meshFrame(loci, point, reach);
      if (shape) {
        point.mesh = sceneMeshes(plugin.state.data).find(
          (m) => m.shape === shape || m.shape.geometry === shape.geometry,
        )?.ref;
        return;
      }
      if (!upright || !Particle.isLoci(loci) || OrderedSet.size(loci.indices) !== 1) return;
      membraneFrame(loci.particles, OrderedSet.start(loci.indices), point);
    },
    upright(brush) {
      if (brush.structure) return false;
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
      if (brush.structure) return structureOf(brush)?.boundary.sphere.radius || 10;
      const data = listOf(brush.particles)?.cell.obj?.data;
      if (!data) return 1;
      // its first particle's (a list without entities: its targets are its entities)
      const groups = data.entityInfo?.size ? undefined : getParticleTargetGroups(data);
      const set = groups
        ? groups.sets[groups.groupOfTarget.get(brush.entity) ?? -1]
        : getParticleEntityGroups(data).get(brush.entity);
      return (set && OrderedSet.size(set) && data.radii?.[OrderedSet.start(set)]) || 10;
    },
    cursor(brush) {
      if (brush.structure) {
        const structure = structureOf(brush);
        return structure
          ? pluginStructureCursor(plugin, structure, plugin.canvas3d, ensureParticles)
          : { move() {}, hide() {}, dispose() {} };
      }
      const list = listOf(brush.particles);
      const data = list?.cell.obj?.data;
      const color = list ? colorOf?.(list, brush.entity) : undefined;
      return pluginPaintCursor(plugin, list, brush, color, !!data && !!brushOf(data, brush.entity)?.surface);
    },
    fiberStep(brush, into) {
      // the entity's rise (Round 3): its own settings, else its file's fibers'; none when it makes no fibers (a
      // structure brush: its entity's in the list it paints into, its list gone: the Painting list's)
      if (brush.structure) return structureFiberStep?.(brush.structure, into && listOf(into) ? into : '');
      const list = listOf(brush.particles);
      const data = list?.cell.obj?.data;
      const b = data && brushOf(data, brush.entity);
      if (!list || !data || !b) return undefined;
      const id = brushIdOf(data, b);
      const painted = decoratorUnder(plugin.state.data, list.cell.transform.ref, ParticleListPainted);
      const p = painted?.transform.params as { fibers?: FiberSettingsMap; structures?: PaintStructure[] } | undefined;
      const own = p?.fibers;
      if (!own?.[id] && !isFiberBrush(data, id)) return undefined;
      return fiberSettingsOf(data, id, b.target, own, p?.structures).rise;
    },
    async paint(brush: PaintBrushTarget, s: PaintSettings, positions, normals, seed, fiber, mesh) {
      const r = (await paint({
        ...(brush.structure
          ? // its list gone since it was chosen: the Painting list (review S3)
            { structure: brush.structure, particles: s.into && listOf(s.into) ? s.into : '' }
          : { particles: brush.particles, entity: String(brush.entity) }),
        positions,
        normals,
        seed,
        ...(fiber ? { fiber: true } : {}),
        ...(fiber && s.sequence?.trim()
          ? {
              sequence: s.sequence.trim(),
              ...parseRange(s.range ?? ''),
            }
          : {}),
        side: s.side,
        ...(mesh ? { mesh } : {}),
        ...(s.orient !== 'auto' ? { orient: s.orient } : {}),
        ...(s.spin !== undefined ? { spin: s.spin } : {}),
      })) as { ok?: boolean; message?: string } | undefined;
      // a stroke refused is said, not dropped (review N1)
      if (r && r.ok === false) plugin.log.warn(`Not painted: ${r.message ?? 'the stroke was refused.'}`);
      return r;
    },
    has: (brush) => (brush.structure ? !!structureOf(brush) : !!listOf(brush.particles)),
    changed(fn) {
      const sub = plugin.state.data.events.changed.subscribe(fn);
      return () => sub.unsubscribe();
    },
  };
}
