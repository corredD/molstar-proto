/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import type { LipidSelection, PartVisibility, SelectionParams } from './procedural.js';

/** A view of the culler's hooks (`GpuInstanceView`): its planes and its size on screen */
export interface SelectionView {
  readonly cameraPlane: Plane3D;
  readonly frustum: Frustum3D;
  readonly lod: { readonly depthScale: number; readonly pixelSize: number };
}

/** What a membrane does around its selections' views (the representation's surfaces and params) */
export interface MembraneViewHost {
  /** every far surface faded for the size on screen */
  fade: (depthScale: number, pixelSize: number) => void;
  /** the parts' surfaces shown as the cell's visibility says */
  showParts: () => void;
  /** the cell's visibility's version (`PartVisibility.version`; none: undefined) */
  partsVersion: () => number | undefined;
  /** the selections' params for the next view (written in place) */
  params: (size: number) => SelectionParams;
  /**
   * the shell bands selected for a view (round 10, shells): once a distinct view, from the first selection's hook that
   * sees it (none: no bands)
   */
  bands?: (view: SelectionView) => void;
}

/**
 * A membrane's selections' views (lipid-procedural round 7): each selection selected once a view (its members' hooks
 * share it), the far surfaces faded and the parts' surfaces shown around them
 */
export function createMembraneViews(host: MembraneViewHost) {
  /** the view each selection selected for last: its planes and scales (32 numbers) */
  // weak: a new look's build makes new selections, the old ones let go with their writers (review M2)
  let keys = new WeakMap<LipidSelection, Float64Array>();
  /** each selection's last view's CPU time, ms (`pool`) */
  const times = new WeakMap<LipidSelection, number>();
  const stats = { selects: 0 };
  /** the size on screen the surfaces were last faded for, and the parts' version last shown (review S1: once a view) */
  const fadedFor = new Float64Array(2).fill(Number.NaN);
  let shownVersion: number | undefined;
  /** the view the shell bands were selected for last: its planes and scales (30 numbers) */
  const bandsFor = new Float64Array(30).fill(Number.NaN);

  /** the shell bands for `view`, once a view (round 10) */
  function bandsOnce(view: SelectionView) {
    let same = bandsFor[28] === view.lod.depthScale && bandsFor[29] === view.lod.pixelSize;
    for (let i = 0; i < 7; ++i) {
      const { normal, constant } = i < 6 ? view.frustum[i as 0] : view.cameraPlane;
      const o = i * 4;
      if (
        bandsFor[o] !== normal[0] ||
        bandsFor[o + 1] !== normal[1] ||
        bandsFor[o + 2] !== normal[2] ||
        bandsFor[o + 3] !== constant
      ) {
        same = false;
        bandsFor[o] = normal[0];
        bandsFor[o + 1] = normal[1];
        bandsFor[o + 2] = normal[2];
        bandsFor[o + 3] = constant;
      }
    }
    if (same) return;
    bandsFor[28] = view.lod.depthScale;
    bandsFor[29] = view.lod.pixelSize;
    host.bands!(view);
  }

  /** `selection` for `view`, once a view */
  function selectFor(selection: LipidSelection, view: SelectionView, size: number) {
    if (host.bands) bandsOnce(view);
    let key = keys.get(selection);
    if (!key) {
      key = new Float64Array(32).fill(Number.NaN);
      keys.set(selection, key);
    }
    const { depthScale, pixelSize } = view.lod;
    let same = key[28] === depthScale && key[29] === pixelSize;
    // the surfaces' fade follows the size on screen only (a resize, a camera's projection), not every move, once for
    // all the selections (review S1)
    if (fadedFor[0] !== depthScale || fadedFor[1] !== pixelSize) {
      fadedFor[0] = depthScale;
      fadedFor[1] = pixelSize;
      host.fade(depthScale, pixelSize);
    }
    for (let i = 0; i < 7; ++i) {
      const { normal, constant } = i < 6 ? view.frustum[i as 0] : view.cameraPlane;
      const o = i * 4;
      if (key[o] !== normal[0] || key[o + 1] !== normal[1] || key[o + 2] !== normal[2] || key[o + 3] !== constant) {
        same = false;
        key[o] = normal[0];
        key[o + 1] = normal[1];
        key[o + 2] = normal[2];
        key[o + 3] = constant;
      }
    }
    if (same) return;
    key[28] = depthScale;
    key[29] = pixelSize;
    stats.selects += 1;
    const params = host.params(size);
    const t0 = performance.now();
    selection.select(view.cameraPlane, view.frustum, depthScale, pixelSize, params);
    // the selection decided the cell's visibility for this view (the first of its selections): shown once (review S1)
    const version = host.partsVersion();
    if (version !== shownVersion) {
      shownVersion = version;
      host.showParts();
    }
    // timed here, not in the selection: its view step allocates nothing (review S3)
    times.set(selection, performance.now() - t0);
  }

  return {
    selectFor,
    times,
    stats,
    /** every selection selects anew at the next view (a clip came or went: review M4) */
    reset() {
      keys = new WeakMap();
      bandsFor.fill(Number.NaN);
    },
  };
}

/** A part's surface: its render object's state, shown while its part is */
export interface PartSurface {
  readonly object: { readonly state: { visible: boolean } };
  readonly part: number;
}

/** Each part surface visible where the membrane is and its part is shown (round 6) */
export function showPartSurfaces(
  surfaces: readonly PartSurface[],
  visible: boolean,
  visibility: PartVisibility | undefined,
) {
  for (const { object, part } of surfaces) {
    const v = visible && (!visibility || visibility.shown[part] === 1);
    if (object.state.visible !== v) Object.assign(object.state, { visible: v });
  }
}
