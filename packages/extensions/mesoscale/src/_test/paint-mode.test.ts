// @vitest-environment jsdom

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { PickResult } from '@molstar/graphics/canvas3d/passes/pick';
import { countListeners, lostReleases, pointer, stubPointerCapture } from '@molstar/prism-ui/testing/gestures';
import { type PaintHost, PaintMode } from '../paint-mode.js';

// Paint mode's gesture (progress/2026-11-08-paint.md, Tests: gesture; prism AGENTS.md, gestures attach once): a stroke
// on a fake canvas whose pick is the plane z = 0 (1 Å a pixel): lost releases leave no listener and paint nothing, a
// whole stroke paints once, Esc leaves the mode, a change of the state while drawing cancels the stroke.

beforeAll(stubPointerCapture);
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function setup(pending = 0) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const root = document.createElement('div');
  const canvas = document.createElement('canvas');
  root.append(canvas);
  document.body.append(root);
  const strokes: { positions: number[]; normals: number[] }[] = [];
  const listeners = new Set<() => void>();
  let lists = true;
  let reads = pending;
  const host: PaintHost = {
    canvas: () => canvas,
    identify: (x, y) => {
      if (reads > 0) {
        reads--;
        return 'pending';
      }
      return { id: { objectId: 0, instanceId: 0, groupId: 0 }, position: Vec3.create(x, -y, 0) } as PickResult;
    },
    eye: (out) => Vec3.set(out, 0, 0, 100),
    refine: () => {},
    project: (out, p) => Vec3.set(out, p[0], -p[1], 0),
    radius: () => 5,
    paint: async (_b, _s, positions, normals) => {
      strokes.push({ positions, normals });
    },
    has: () => lists,
    changed: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const mode = new PaintMode(host);
  const layer = () => root.querySelector<HTMLElement>('.msp-paint-layer')!;
  const change = () => {
    for (const fn of listeners) fn();
  };
  return { mode, layer, strokes, change, listeners, removeList: () => (lists = false) };
}

const brush = { particles: 'list', entity: 1, name: 'CD9' };

describe('paint mode', () => {
  it('a stroke: lost releases leave no listener and paint nothing; a whole stroke paints once, a copy a spacing', () => {
    const { mode, layer, strokes } = setup();
    expect(mode.start(brush)).toBe(true);
    const r = lostReleases({
      target: layer,
      from: { x: 10, y: 10 },
      to: { x: 60, y: 10 },
      reset: () => (strokes.length = 0),
      worked: () => strokes.length === 1,
    });
    expect(r.grown).toBe(0);
    expect(r.worked).toBe(true);
    // 50 Å at 1 Å a pixel read every few pixels, a copy every 10 Å (two radii) at least: the press's and four more
    const { positions, normals } = strokes[0];
    expect(positions.length / 3).toBe(5);
    expect(positions.slice(0, 3)).toEqual([10, -10, 0]);
    for (let i = 3; i < positions.length; i += 3) {
      expect(positions[i] - positions[i - 3]).toBeGreaterThanOrEqual(10);
      expect(positions[i] - positions[i - 3]).toBeLessThan(15);
    }
    // the plane's normal, toward the viewer
    for (let i = 0; i < normals.length; i += 3) expect(normals[i + 2]).toBeCloseTo(1, 6);
    mode.stop();
  });

  it('reads a pending pick in a later frame, and paints at the release what it read', async () => {
    const { mode, layer, strokes } = setup(3);
    mode.start(brush);
    const el = layer();
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointermove', { x: 30, y: 10 }));
    // a few frames: the pick read
    await new Promise((resolve) => setTimeout(resolve, 100));
    el.dispatchEvent(pointer('pointerup', { x: 30, y: 10 }));
    expect(strokes.length).toBe(1);
    expect(strokes[0].positions.length).toBeGreaterThan(0);
    mode.stop();
  });

  it('Esc leaves the mode: its layer, its listeners and its brush gone', () => {
    const counter = countListeners();
    try {
      const { mode, layer, listeners } = setup();
      const before = counter.count;
      mode.start(brush);
      expect(layer()).toBeTruthy();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(layer()).toBeNull();
      expect(mode.brush.value).toBeUndefined();
      expect(counter.count).toBe(before);
      expect(listeners.size).toBe(0);
    } finally {
      counter.stop();
    }
  });

  it('a change of the state while drawing cancels the stroke; the list removed ends the mode', () => {
    const { mode, layer, strokes, change, removeList } = setup();
    mode.start(brush);
    const el = layer();
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointermove', { x: 40, y: 10 }));
    change();
    el.dispatchEvent(pointer('pointerup', { x: 40, y: 10 }));
    expect(strokes.length).toBe(0);
    removeList();
    change();
    expect(mode.brush.value).toBeUndefined();
    expect(layer()).toBeNull();
  });

  it('another brush replaces the first; nothing to paint over without a canvas', () => {
    const { mode, layer } = setup();
    mode.start(brush);
    mode.start({ ...brush, entity: 2, name: 'CD63' });
    expect(document.querySelectorAll('.msp-paint-layer').length).toBe(1);
    expect(layer().getAttribute('aria-label')).toBe('Painting with CD63');
    mode.stop();
    const none = new PaintMode({ canvas: () => undefined } as unknown as PaintHost);
    expect(none.start(brush)).toBe(false);
    expect(none.brush.value).toBeUndefined();
  });
});
