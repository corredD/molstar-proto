/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Vec3, type Vec4 } from '@molstar/core/math/linear-algebra';
import { Binding } from '@molstar/core/util/binding';
import type { Representation } from '@molstar/graphics/repr/representation';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import type { PluginContext } from '@molstar/plugin/context';
import { Subject } from 'rxjs';

// A canvas for gizmos in a headless viewer (tests): what the gizmo library's controller and the plugin's representations
// ask of `Canvas3D`, no GL. Put on the plugin as its `canvas3d` (the viewer's own has none), it takes the pointer: over a
// handle, a drag, its release, Esc.

/** A fake canvas on a headless viewer's plugin, driven as a pointer would */
export interface GizmoCanvas {
  /** The frame holds asked for (a commit's) */
  readonly holds: number;
  /**
   * The pointer over group `g` of the handles shown (0: a transform gizmo's move handle), once they are drawn; false:
   * none shown
   */
  hover(g?: number): Promise<boolean>;
  /** A press at the canvas's middle and a move to each x offset (px), not released; then the previews settle */
  drag(steps: readonly number[]): Promise<void>;
  /** The release; then its commit, if any, is done */
  release(): Promise<void>;
  escape(): void;
  /** The canvas off the plugin again */
  remove(): void;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

export function mountGizmoCanvas(plugin: PluginContext): GizmoCanvas {
  const added = new Set<Representation.Any>();
  const attribs = {
    trackball: { bindings: { dragRotate: Binding([]), dragPan: Binding([]) } as Record<string, Binding> },
  };
  const input = {
    pixelRatio: 1,
    drag: new Subject<{ isStart: boolean; x: number; y: number; dx: number; dy: number }>(),
    interactionEnd: new Subject<void>(),
    keyDown: new Subject<{ key: string }>(),
  };
  const hover = new Subject<{ current: Representation.Loci; position?: Vec3 }>();
  let holds = 0;
  let held: Promise<unknown> | undefined;
  const canvas = {
    graphics: { capabilities: { flatInterpolation: true } },
    add: (r: Representation.Any) => void added.add(r),
    remove: (r: Representation.Any) => void added.delete(r),
    update: () => {},
    commit: () => {},
    syncVisibility: () => {},
    mark: () => {},
    requestDraw: () => {},
    holdFrames: (until: Promise<unknown>) => {
      holds++;
      held = until.catch(() => {});
    },
    attribs,
    setAttribs: (a: { trackball: { bindings: Record<string, Binding> } }) => {
      attribs.trackball.bindings = a.trackball.bindings;
    },
    interaction: { hover },
    input,
    didDraw: new Subject<number>(),
    camera: {
      state: {
        position: Vec3.create(0, 0, 100),
        target: Vec3.create(0, 0, 0),
        up: Vec3.create(0, 1, 0),
        fov: Math.PI / 4,
        mode: 'perspective',
      },
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      setState(state: object) {
        Object.assign(canvas.camera.state, state);
      },
      project: (out: Vec4, p: Vec3) => {
        out[0] = 50 + p[0];
        out[1] = 50 - p[1];
        return out;
      },
    },
    dispose: () => {},
  };
  Object.defineProperty(plugin, 'canvas3d', { value: canvas, configurable: true });
  const owned = () => [...added].filter((r) => plugin.managers.interactivity.clickOwners.owns(r));
  return {
    get holds() {
      return holds;
    },
    async hover(g = 0) {
      await settle();
      // the handles' representation (a body, when there is one, takes no hover)
      for (const repr of owned()) {
        const loci = repr.getAllLoci()[0];
        if (!Shape.isLoci(loci)) continue;
        const current = { repr, loci: ShapeGroup.Loci(loci.shape, [{ ids: OrderedSet.ofSingleton(g), instance: 0 }]) };
        hover.next({ current });
        if (attribs.trackball.bindings.dragRotate === Binding.Empty) return true;
      }
      return false;
    },
    async drag(steps) {
      input.drag.next({ isStart: true, x: 50, y: 50, dx: 0, dy: 0 });
      for (const x of steps) input.drag.next({ isStart: false, x: 50 + x, y: 50, dx: 0, dy: 0 });
      await settle();
    },
    async release() {
      held = undefined;
      input.interactionEnd.next();
      await settle();
      await held;
      await settle();
    },
    escape() {
      input.keyDown.next({ key: 'Escape' });
    },
    remove() {
      Object.defineProperty(plugin, 'canvas3d', { value: undefined, configurable: true });
    },
  };
}
