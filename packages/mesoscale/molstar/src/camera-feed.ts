/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { StreamFocus } from '@molstar/meso-spec/runtime';
import type { PluginContext } from '@molstar/plugin/context';

// The canvas camera fed to a streamed document (prism.md §9: "the owner feeds them the canvas camera"): after each draw
// the camera's target and eye are compared with the last ones fed, and once they have rested `RestMs` away from them
// the camera is fed: its target as a `focus` of radius 0, with its view (the eye and the frustum's four side planes),
// so the tiles in view load first (streaming.md "Order"). A pan, an orbit and a zoom move the eye; a draw that keeps
// the camera feeds nothing. Nothing is allocated per frame: the comparison reads the camera's vectors in place.

/** How long the camera rests before it is fed (ms): a drag feeds once, at its end. */
export const RestMs = 250;
/** How far the target or the eye moves before it counts (Å). */
export const MovedA = 1;

/** Feeds `feed` the canvas camera of `plugin` while it lives; returns its removal. */
export function feedCanvasCamera(plugin: PluginContext, feed: (focus: StreamFocus) => void): () => void {
  const last = [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN];
  const frustum = Frustum3D();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draws: { unsubscribe(): void } | undefined;
  const fire = () => {
    timer = undefined;
    const camera = plugin.canvas3d?.camera;
    if (!camera) return;
    const t = camera.target;
    const e = camera.position;
    last.splice(0, 6, t[0], t[1], t[2], e[0], e[1], e[2]);
    // right, left, bottom, top: near and far are fitted to what is drawn, so a tile not loaded yet would lie beyond
    Frustum3D.fromProjectionMatrix(frustum, camera.projectionView);
    const planes: [number, number, number, number][] = [];
    for (const i of [0, 1, 2, 3] as const) {
      const { normal: n, constant: c } = frustum[i];
      const plane: [number, number, number, number] = [n[0], n[1], n[2], c];
      // a degenerate projection (a normal of length 0) gives no plane rather than numbers that are not finite
      if (plane.every(Number.isFinite)) planes.push(plane);
    }
    feed({ center: [t[0], t[1], t[2]], radius: 0, view: { eye: [e[0], e[1], e[2]], planes } });
  };
  const drawn = () => {
    const camera = plugin.canvas3d?.camera;
    if (!camera) return;
    const t = camera.target;
    const e = camera.position;
    const moved = Math.max(
      Math.hypot(t[0] - last[0], t[1] - last[1], t[2] - last[2]),
      Math.hypot(e[0] - last[3], e[1] - last[4], e[2] - last[5]),
    );
    // NaN (nothing fed yet) counts as moved
    if (moved <= MovedA) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(fire, RestMs);
  };
  let stopped = false;
  const attach = () => {
    if (stopped || draws || !plugin.canvas3d) return;
    draws = plugin.canvas3d.didDraw.subscribe(drawn);
  };
  // a canvas made after the document's owner (or never, headless: the promise does not settle)
  plugin.canvas3dInitialized.then(attach, () => {});
  attach();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    draws?.unsubscribe();
    draws = undefined;
  };
}
