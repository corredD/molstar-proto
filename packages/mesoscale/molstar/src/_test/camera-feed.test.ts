/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { StreamFocus } from '@molstar/meso-spec/runtime';
import type { PluginContext } from '@molstar/plugin/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedCanvasCamera, RestMs } from '../camera-feed.js';

// The canvas camera fed to a streamed document (prism.md §9), over a fake canvas: its target and view after each draw,
// fed once it rests; a pan, an orbit and a zoom feed (the eye moved); a draw that keeps the camera feeds nothing;
// nothing after the feed's removal.

afterEach(() => {
  vi.useRealTimers();
});

function fakeCanvas() {
  const draws = new Set<() => void>();
  const target = [0, 0, 0];
  const position = [0, 0, 100];
  // identity: the frustum of the clip cube, |x|, |y|, |z| ≤ 1
  const projectionView = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const plugin = {
    canvas3d: {
      camera: { target, position, projectionView },
      didDraw: {
        subscribe(f: () => void) {
          draws.add(f);
          return { unsubscribe: () => draws.delete(f) };
        },
      },
    },
    canvas3dInitialized: new Promise<void>(() => {}),
  } as unknown as PluginContext;
  const draw = () => {
    for (const f of draws) f();
  };
  return { plugin, target, position, projectionView, draw, draws };
}

describe('feedCanvasCamera', () => {
  it('feeds the target and the view once the camera rests, again when it moves', () => {
    vi.useFakeTimers();
    const c = fakeCanvas();
    const fed: StreamFocus[] = [];
    const stop = feedCanvasCamera(c.plugin, (f) => fed.push(f));
    c.draw();
    expect(fed).toEqual([]);
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(1);
    expect(fed[0]).toMatchObject({ center: [0, 0, 0], radius: 0, view: { eye: [0, 0, 100] } });
    // the four side planes, no near or far: x ≤ 1, x ≥ -1, y ≥ -1, y ≤ 1 (n·p + c ≥ 0 inside); then, gate M1, the
    // plane through the eye facing the target (z ≤ 100), so nothing behind the eye is in view
    expect(fed[0].view!.planes).toEqual([
      [-1, 0, 0, 1],
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, -1, 0, 1],
      [0, 0, -1, 100],
    ]);
    // a drag: many draws, one feed at its end
    for (let i = 1; i <= 10; i++) {
      c.target[0] = 100 * i;
      c.position[0] = 100 * i;
      c.draw();
      vi.advanceTimersByTime(RestMs / 5);
    }
    expect(fed.length).toBe(1);
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(2);
    expect(fed[1]).toMatchObject({ center: [1000, 0, 0], view: { eye: [1000, 0, 100] } });
    // an orbit or a zoom keeps the target but moves the eye: fed
    c.position[2] = 50;
    c.draw();
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(3);
    expect(fed[2]).toMatchObject({ center: [1000, 0, 0], view: { eye: [1000, 0, 50] } });
    // a draw that keeps the camera: nothing
    c.draw();
    vi.advanceTimersByTime(2 * RestMs);
    expect(fed.length).toBe(3);
    // removed: nothing more, and the canvas no longer calls it
    c.target[1] = 500;
    c.draw();
    stop();
    vi.advanceTimersByTime(2 * RestMs);
    expect(fed.length).toBe(3);
    expect(c.draws.size).toBe(0);
  });

  // gate S2: a view that turns or narrows with the target and the eye kept (a small orbit close up, a resize, a fov)
  it('feeds a view that changes with the target and the eye kept, or turns by less than 1 Å', () => {
    vi.useFakeTimers();
    const c = fakeCanvas();
    c.position[2] = 10;
    const fed: StreamFocus[] = [];
    const stop = feedCanvasCamera(c.plugin, (f) => fed.push(f));
    c.draw();
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(1);
    // an orbit 10 Å from the target: the eye moves 0.8 Å, the view turns 4.6°
    c.position[0] = 0.8;
    c.draw();
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(2);
    // a resize: the projection alone changes
    c.projectionView[0] = 0.5;
    c.draw();
    vi.advanceTimersByTime(RestMs);
    expect(fed.length).toBe(3);
    expect(fed[2].view!.planes[0]).toEqual([-1, 0, 0, 2]);
    stop();
  });
});
