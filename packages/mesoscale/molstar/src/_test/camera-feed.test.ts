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
  return { plugin, target, position, draw, draws };
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
    // the four side planes, no near or far: x ≤ 1, x ≥ -1, y ≥ -1, y ≤ 1 (n·p + c ≥ 0 inside)
    expect(fed[0].view!.planes).toEqual([
      [-1, 0, 0, 1],
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, -1, 0, 1],
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
});
