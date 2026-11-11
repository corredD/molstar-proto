/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import type { StreamFocus } from '@molstar/meso-spec/runtime';
import type { PluginContext } from '@molstar/plugin/context';

// The canvas camera fed to a streamed document (prism.md §9: "the owner feeds them the canvas camera"): after each draw
// the camera's target and view (the frustum's four side planes and the plane through the eye facing the target) are
// compared with the last ones fed, and once they have rested `RestMs` away from them the camera is fed: its target as a
// `focus` of radius 0, with its view, so the tiles in view load first (streaming.md "Order"). A pan, an orbit, a zoom, a
// resize or a fov change moves the view; a draw that keeps the camera feeds nothing. Nothing is allocated per frame.
// The planes are the mono camera's in world Å: an XR camera's `scale` is not read (XR is out of scope).

/** How long the camera rests before it is fed (ms): a drag feeds once, at its end. */
export const RestMs = 250;
/** How far the target or a plane moves before it counts (Å). */
export const MovedA = 1;
/** How far a plane's unit normal turns before it counts (about 0.06°). */
export const TurnedN = 1e-3;

const Planes = 5;

/** Feeds `feed` the canvas camera of `plugin` while it lives; returns its removal. */
export function feedCanvasCamera(plugin: PluginContext, feed: (focus: StreamFocus) => void): () => void {
  const frustum = Frustum3D();
  // the target, then each plane's [nx, ny, nz, c]: now and as last fed (NaN: nothing fed yet, counts as moved)
  const now = new Float64Array(3 + 4 * Planes);
  const last = new Float64Array(3 + 4 * Planes).fill(Number.NaN);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draws: { unsubscribe(): void } | undefined;
  /** Reads the camera into `now`; false without a canvas. */
  const read = (): boolean => {
    const camera = plugin.canvas3d?.camera;
    if (!camera) return false;
    const t = camera.target;
    const e = camera.position;
    now[0] = t[0];
    now[1] = t[1];
    now[2] = t[2];
    // right, left, bottom, top: near and far are fitted to what is drawn, so a tile not loaded yet would lie beyond
    Frustum3D.fromProjectionMatrix(frustum, camera.projectionView);
    for (let i = 0 as 0 | 1 | 2 | 3; i < 4; i++) {
      const { normal: n, constant: c } = frustum[i];
      const o = 3 + 4 * i;
      now[o] = n[0];
      now[o + 1] = n[1];
      now[o + 2] = n[2];
      now[o + 3] = c;
    }
    // through the eye, facing the target: the side planes all pass through the eye, so without it a box behind the eye
    // wider than its distance would pass each of them on a different corner (gate M1); an orthographic camera's side
    // planes are a prism with no end at all
    const fx = t[0] - e[0];
    const fy = t[1] - e[1];
    const fz = t[2] - e[2];
    const l = Math.hypot(fx, fy, fz);
    const o = 3 + 4 * 4;
    now[o] = fx / l;
    now[o + 1] = fy / l;
    now[o + 2] = fz / l;
    now[o + 3] = -(now[o] * e[0] + now[o + 1] * e[1] + now[o + 2] * e[2]);
    return true;
  };
  // NaN on both sides (a degenerate plane then and now) is the same; on one side (nothing fed yet) it moved
  const same = (i: number, tolerance: number) =>
    Number.isNaN(now[i]) ? Number.isNaN(last[i]) : Math.abs(now[i] - last[i]) <= tolerance;
  const moved = (): boolean => {
    if (!(same(0, 0) || Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]) <= MovedA)) return true;
    for (let i = 0; i < Planes; i++) {
      const o = 3 + 4 * i;
      if (!same(o, TurnedN) || !same(o + 1, TurnedN) || !same(o + 2, TurnedN) || !same(o + 3, MovedA)) return true;
    }
    return false;
  };
  const fire = () => {
    timer = undefined;
    const camera = plugin.canvas3d?.camera;
    if (!camera || !read()) return;
    last.set(now);
    const planes: [number, number, number, number][] = [];
    for (let i = 0; i < Planes; i++) {
      const plane: [number, number, number, number] = [now[3 + 4 * i], now[4 + 4 * i], now[5 + 4 * i], now[6 + 4 * i]];
      // a degenerate projection, or the eye on the target (a normal of length 0), gives no plane rather than numbers
      // that are not finite
      if (plane.every(Number.isFinite)) planes.push(plane);
    }
    const e = camera.position;
    feed({ center: [now[0], now[1], now[2]], radius: 0, view: { eye: [e[0], e[1], e[2]], planes } });
  };
  const drawn = () => {
    if (!read() || !moved()) return;
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
