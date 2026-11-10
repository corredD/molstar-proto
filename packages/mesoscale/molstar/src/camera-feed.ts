/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '@molstar/plugin/context';

// The canvas camera fed to a streamed document (prism.md §9: "the owner feeds them the canvas camera"): after each draw
// the camera's target is compared with the last one fed, and once it has rested `RestMs` away from it the new target
// is fed (its `focus` with radius 0: the target alone, as a numeric camera). A move that keeps the target (an orbit, a
// zoom) feeds nothing. Nothing is allocated per frame: the comparison reads the camera's vector in place.

/** How long the target rests before it is fed (ms): a drag feeds once, at its end. */
export const RestMs = 250;
/** How far the target moves before it counts (Å). */
export const MovedA = 1;

/** Feeds `feed` the canvas camera's target of `plugin` while it lives; returns its removal. */
export function feedCanvasCamera(plugin: PluginContext, feed: (x: number, y: number, z: number) => void): () => void {
  const last = [Number.NaN, Number.NaN, Number.NaN];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draws: { unsubscribe(): void } | undefined;
  const fire = () => {
    timer = undefined;
    const t = plugin.canvas3d?.camera.target;
    if (!t) return;
    last[0] = t[0];
    last[1] = t[1];
    last[2] = t[2];
    feed(t[0], t[1], t[2]);
  };
  const drawn = () => {
    const t = plugin.canvas3d?.camera.target;
    if (!t) return;
    const moved = Math.hypot(t[0] - last[0], t[1] - last[1], t[2] - last[2]);
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
