/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import { Grid, type Volume } from '@molstar/model/model/volume';
import type { PluginContext } from '@molstar/plugin/context';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { type FrameValue, frameHandles, GizmoHandles } from '@molstar/prism-viewer/sources/gizmos';
import { obliqueFrame, obliquePlane, obliquePoseOf, obliquePoseOfPlane, type SlicePlane } from './oblique.js';

// An oblique slice's handle (apps/prism-me/_spec/ui.md, the oblique slice): Prism's handles (`GizmoHandles`, on a
// frame: `frameHandles`) on the slice's point, its Z the plane's normal: moved anywhere, tilted about X and Y (no ring
// about its normal, which a plane cannot hold). A drag shows the slice cut where the handle is (its representation given
// the plane: the state, and its history, untouched), its release is one step (`cryoet.oblique`).

/** The oblique slice the handle is on */
export interface ObliqueHandleTarget {
  /** The volume (its state ref) */
  readonly volume: string;
  /** The slice's representation (its state ref) */
  readonly slice: string;
}

/** The smallest the handle is (Å) */
const MinHandleSize = 20;

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

/** The handle on an oblique slice while shown */
export class ObliqueHandles {
  readonly #target = observableState<ObliqueHandleTarget | undefined>(undefined);
  /** The frame the handle was last released at, by slice: shown while the slice's plane is that frame's */
  readonly #released = new Map<string, Mat4>();
  readonly #handles: GizmoHandles<FrameValue>;

  constructor(
    private readonly plugin: PluginContext,
    private readonly api: ViewerApi,
  ) {
    this.#handles = new GizmoHandles(plugin, {
      ...frameHandles({ rotate: [0, 1] }),
      items: () => this.#items(),
      preview: async (_key, _from, next) => {
        const plane = this.#plane(next.frame);
        if (plane) await this.#draw(plane);
      },
      commit: async (_key, _from, next) => {
        const t = this.#target.value;
        const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
        if (!t || !grid) return false;
        const {
          position: [x, y, z],
          tilt: [ex, ey],
        } = obliquePoseOf(grid, next.frame);
        // a frame released at, its turn about the normal kept for the handle (the plane cannot hold it)
        this.#released.set(t.slice, next.frame);
        const r = await this.api.run('cryoet.oblique', { volume: t.volume, slice: t.slice, x, y, z, ex, ey });
        // drawn as the state has it now (placed, or not)
        if (!r.ok || r.unchanged) await this.#draw(undefined);
        return r.ok;
      },
      cancel: () => void this.#draw(undefined),
    });
  }

  /** The slice the handle is on, while shown */
  get target(): ReadonlyState<ObliqueHandleTarget | undefined> {
    return this.#target.asReadonly;
  }

  show(target: ObliqueHandleTarget): boolean {
    if (!this.plugin.canvas3d) return false;
    this.#target.set(target);
    return this.#handles.show();
  }

  hide() {
    this.#target.set(undefined);
    this.#handles.hide();
  }

  /** The slice cut on this plane (the drawing only); none: as the state has it */
  async #draw(plane: SlicePlane | undefined) {
    const t = this.#target.value;
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
    const t = this.#target.value;
    const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
    return grid && obliquePlane(grid, obliquePoseOf(grid, frame));
  }

  /** The slice as an item: its plane's frame as the state has it, a size of the volume's */
  #items(): GizmoItem<FrameValue>[] {
    const t = this.#target.value;
    const grid = t && sliceVolume(this.plugin, t.slice)?.grid;
    const plane = t && statePlane(this.plugin, t.slice);
    if (!t || !grid || !plane) {
      // its slice or volume removed: no handle
      if (t) this.hide();
      return [];
    }
    const size = Math.max(Grid.getBoundingSphere(grid).radius * 0.5, MinHandleSize);
    // as released (a turn about the normal kept: no spin on release) while the plane is its; else the plane's own
    const released = this.#released.get(t.slice);
    const frame = released && samePlane(planeOfFrame(released), plane) ? released : undefined;
    if (!frame) this.#released.delete(t.slice);
    return [
      {
        key: t.slice,
        value: { frame: frame ?? obliqueFrame(grid, obliquePoseOfPlane(grid, plane)), size },
        label: 'Oblique slice',
      },
    ];
  }
}
