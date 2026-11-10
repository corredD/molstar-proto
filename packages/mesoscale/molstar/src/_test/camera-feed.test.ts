/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '@molstar/plugin/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedCanvasCamera, RestMs } from '../camera-feed.js';

// The canvas camera fed to a streamed document (prism.md §9), over a fake canvas: its target after each draw, fed once
// it rests; a draw that keeps the target feeds nothing; nothing after the feed's removal.

afterEach(() => {
  vi.useRealTimers();
});

function fakeCanvas() {
  const draws = new Set<() => void>();
  const target = [0, 0, 0];
  const plugin = {
    canvas3d: {
      camera: { target },
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
  return { plugin, target, draw, draws };
}

describe('feedCanvasCamera', () => {
  it('feeds the target once it rests, again only when it moves', () => {
    vi.useFakeTimers();
    const c = fakeCanvas();
    const fed: number[][] = [];
    const stop = feedCanvasCamera(c.plugin, (x, y, z) => fed.push([x, y, z]));
    c.draw();
    expect(fed).toEqual([]);
    vi.advanceTimersByTime(RestMs);
    expect(fed).toEqual([[0, 0, 0]]);
    // a drag: many draws, one feed at its end
    for (let i = 1; i <= 10; i++) {
      c.target[0] = 100 * i;
      c.draw();
      vi.advanceTimersByTime(RestMs / 5);
    }
    expect(fed.length).toBe(1);
    vi.advanceTimersByTime(RestMs);
    expect(fed).toEqual([
      [0, 0, 0],
      [1000, 0, 0],
    ]);
    // an orbit or a zoom keeps the target: nothing fed
    c.draw();
    vi.advanceTimersByTime(2 * RestMs);
    expect(fed.length).toBe(2);
    // removed: nothing more, and the canvas no longer calls it
    c.target[1] = 500;
    c.draw();
    stop();
    vi.advanceTimersByTime(2 * RestMs);
    expect(fed.length).toBe(2);
    expect(c.draws.size).toBe(0);
  });
});
