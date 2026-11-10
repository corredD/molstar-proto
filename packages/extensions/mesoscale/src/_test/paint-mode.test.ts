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

function setup(
  pending = 0,
  options: { upright?: boolean; changeOnPaint?: boolean; fiberStep?: number; depthRange?: [number, number] } = {},
) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const root = document.createElement('div');
  const canvas = document.createElement('canvas');
  root.append(canvas);
  document.body.append(root);
  const strokes: { positions: number[]; normals: number[] }[] = [];
  const listeners = new Set<() => void>();
  let lists = true;
  let reads = pending;
  const refined: number[] = [];
  const camera = { held: 0, released: 0 };
  /** The copy under the pointer: where it was last shown (undefined: hidden), its seed, disposed */
  const copy = { at: undefined as number[] | undefined, seed: -1, disposed: false };
  const seeds: number[] = [];
  const fibers: boolean[] = [];
  const host: PaintHost = {
    canvas: () => canvas,
    holdCamera: () => {
      camera.held++;
      return () => camera.released++;
    },
    identify: (x, y) => {
      if (reads > 0) {
        reads--;
        return 'pending';
      }
      return { id: { objectId: 0, instanceId: 0, groupId: 0 }, position: Vec3.create(x, -y, 0) } as PickResult;
    },
    eye: (out) => Vec3.set(out, 0, 0, 100),
    // an orthographic view down -z from z = 100, 1 Å a pixel: the ray at (x, y) from (x, -y, 100)
    ray: (x, y, origin, direction) => {
      Vec3.set(origin, x, -y, 100);
      Vec3.set(direction, 0, 0, -1);
      return true;
    },
    focus: () => 100,
    ...(options.depthRange ? { depthRange: () => options.depthRange! } : {}),
    refine: (p) => {
      refined.push(p.position[0]);
    },
    upright: () => options.upright ?? true,
    project: (out, p) => Vec3.set(out, p[0], -p[1], 0),
    radius: () => 5,
    cursor: () => ({
      move: (p, _n, _s, seed) => {
        copy.at = [p[0], p[1], p[2]];
        copy.seed = seed;
      },
      hide: () => {
        copy.at = undefined;
      },
      dispose: () => {
        copy.disposed = true;
      },
    }),
    fiberStep: () => options.fiberStep,
    paint: async (_b, _s, positions, normals, seed, fiber) => {
      strokes.push({ positions, normals });
      seeds.push(seed);
      fibers.push(fiber);
      // the commit's own change of the state, a moment later (a large list's rebuild)
      if (options.changeOnPaint) {
        await Promise.resolve();
        for (const fn of listeners) fn();
      }
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
  return {
    mode,
    layer,
    strokes,
    change,
    listeners,
    refined,
    camera,
    copy,
    seeds,
    fibers,
    removeList: () => (lists = false),
  };
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
      reset: () => {
        // the lost releases painted nothing
        expect(strokes.length).toBe(0);
      },
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

  it("snaps to a membrane's mid-plane only for an upright brush (a membrane protein)", () => {
    for (const upright of [true, false]) {
      const { mode, layer, strokes, refined } = setup(0, { upright });
      mode.start(brush);
      const el = layer();
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
      expect(strokes.length).toBe(1);
      expect(refined.length).toBe(upright ? 1 : 0);
      mode.stop();
    }
  });

  it("the previous stroke's commit does not cancel the stroke drawn after it", async () => {
    const { mode, layer, strokes } = setup(0, { changeOnPaint: true });
    mode.start(brush);
    const el = layer();
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerdown', { x: 40, y: 10 }));
    // the first stroke's commit lands
    await Promise.resolve();
    await Promise.resolve();
    el.dispatchEvent(pointer('pointerup', { x: 40, y: 10 }));
    expect(strokes.length).toBe(2);
    mode.stop();
  });

  it("its hint is drawn in Prism's tokens (light and dark), no literal color or size", () => {
    const { mode, layer } = setup();
    mode.start(brush);
    const hint = layer().querySelector<HTMLElement>('div')!;
    const css = hint.getAttribute('style') ?? '';
    for (const token of ['--msp-color-raised', '--msp-color-text', '--msp-font-size-sm', '--msp-radius-md'])
      expect(css).toContain(token);
    expect(css).not.toContain('--msp-color-surface');
    expect(css).not.toMatch(/#[0-9a-f]{3}|\d+px/i);
    mode.stop();
  });

  it('Alt held lets the pointer through to the camera, never in a stroke; an Alt press paints nothing', () => {
    const { mode, layer, strokes } = setup();
    mode.start(brush);
    const el = layer();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(el.style.pointerEvents).toBe('none');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(el.style.pointerEvents).toBe('');
    // Alt pressed outside the page: read from the pointer
    window.dispatchEvent(new PointerEvent('pointermove', { altKey: true }));
    expect(el.style.pointerEvents).toBe('none');
    window.dispatchEvent(new Event('blur'));
    expect(el.style.pointerEvents).toBe('');
    // in a stroke the layer keeps the pointer
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(el.style.pointerEvents).toBe('');
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(strokes.length).toBe(1);
    // a press with Alt is the camera's
    const init = { bubbles: true, cancelable: true, clientX: 20, clientY: 10, button: 0, buttons: 1, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, altKey: true }));
    el.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(strokes.length).toBe(1);
    mode.stop();
  });

  it("the camera's Alt gestures are held while the mode is on and released on every way out", () => {
    for (const end of ['stop', 'escape', 'other brush', 'list removed'] as const) {
      const { mode, camera, change, removeList } = setup();
      mode.start(brush);
      expect(camera).toEqual({ held: 1, released: 0 });
      if (end === 'stop') mode.stop();
      else if (end === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (end === 'other brush') mode.start({ ...brush, entity: 2, name: 'CD63' });
      else {
        removeList();
        change();
      }
      expect(camera.released, end).toBe(1);
      mode.stop();
      document.body.innerHTML = '';
    }
  });

  it('a soluble brush paints at the depth along the ray, from the focus; the wheel moves it, not with Alt', () => {
    const { mode, layer, strokes } = setup(0, { upright: false });
    mode.start(brush);
    const el = layer();
    expect(el.textContent).toContain('depth 100 Å');
    // a click: one copy, at the focus (100 Å from z = 100), facing the viewer, no pick read
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(strokes[0].positions).toEqual([10, -10, 0]);
    expect(strokes[0].normals).toEqual([-0, -0, 1]);
    // a notch farther: a copy's diameter (10 Å)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    // with Alt: the camera's zoom, the depth unchanged
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, altKey: true, bubbles: true, cancelable: true }));
    el.dispatchEvent(pointer('pointerdown', { x: 20, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(strokes[1].positions).toEqual([20, -10, -10]);
    // never nearer than a copy's radius
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, bubbles: true, cancelable: true }));
    el.dispatchEvent(pointer('pointerdown', { x: 20, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(strokes[2].positions[2]).toBe(95);
    mode.stop();
  });

  it("keeps the depth in the camera's drawn range (Round 4): the copy never past its near or far plane", () => {
    // the camera draws 60 to 130 Å from the eye; a copy's radius 5
    const { mode, layer, strokes } = setup(0, { upright: false, depthRange: [60, 130] });
    mode.start(brush);
    const el = layer();
    const at = (x: number) => {
      el.dispatchEvent(pointer('pointerdown', { x, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x, y: 10 }));
      return strokes[strokes.length - 1].positions[2];
    };
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, bubbles: true, cancelable: true }));
    // 65 Å from the eye at z = 100
    expect(at(10)).toBe(35);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000, bubbles: true, cancelable: true }));
    expect(at(20)).toBe(-25);
    mode.stop();
  });

  it('Place: a membrane protein on the surface by default, at the depth when asked; anything else the other way', () => {
    for (const [upright, place, z] of [
      [true, 'auto', 0],
      [true, 'depth', 0],
      [false, 'surface', 0],
    ] as const) {
      const { mode, layer, strokes, refined } = setup(0, { upright });
      mode.set({ place });
      mode.start(brush);
      const el = layer();
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
      expect(strokes[0].positions[2]).toBe(z);
      // a surface read refines a membrane protein; a depth reads no pick
      expect(refined.length, `${upright} ${place}`).toBe(upright && place === 'auto' ? 1 : 0);
      mode.stop();
    }
  });

  it('a copy follows the pointer where a click puts it; the click paints it with its seed; hidden off the canvas', async () => {
    const { mode, layer, strokes, copy, seeds } = setup(0, { upright: false });
    mode.start(brush);
    const el = layer();
    const frame = () => new Promise((resolve) => setTimeout(resolve, 40));
    const over = (x: number, y: number) =>
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    // jsdom has no layout: the pointer's place over the layer is its offset
    vi.spyOn(MouseEvent.prototype, 'offsetX', 'get').mockImplementation(function (this: MouseEvent) {
      return this.clientX;
    });
    vi.spyOn(MouseEvent.prototype, 'offsetY', 'get').mockImplementation(function (this: MouseEvent) {
      return this.clientY;
    });
    over(30, 20);
    await frame();
    // at the depth (the focus, 100 Å from z = 100) under the pointer
    expect(copy.at).toEqual([30, -20, 0]);
    const shown = copy.seed;
    el.dispatchEvent(pointer('pointerdown', { x: 30, y: 20 }));
    el.dispatchEvent(pointer('pointerup', { x: 30, y: 20 }));
    // the copy painted is the one shown: same place, same seed
    expect(strokes[0].positions).toEqual([30, -20, 0]);
    expect(seeds[0]).toBe(shown);
    await frame();
    // the next copy shown is the next stroke's
    expect(copy.seed).not.toBe(shown);
    // Alt: the camera's, no copy
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    await frame();
    expect(copy.at).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    over(40, 20);
    await frame();
    expect(copy.at).toEqual([40, -20, 0]);
    el.dispatchEvent(new PointerEvent('pointerleave'));
    await frame();
    expect(copy.at).toBeUndefined();
    mode.stop();
    expect(copy.disposed).toBe(true);
  });

  it("a brush with fibres paints a fibre by default, its points its fibres' step apart; Fibre overrides it", () => {
    for (const [fiberStep, setting, painted, points] of [
      [3, 'auto', true, 11],
      [undefined, 'auto', false, 3],
      [3, 'off', false, 3],
      [undefined, 'on', true, 4],
    ] as const) {
      const { mode, layer, fibers, strokes } = setup(0, { upright: true, fiberStep });
      mode.set({ fiber: setting });
      mode.start(brush);
      const el = layer();
      expect(el.textContent?.includes('a fibre of'), `${fiberStep} ${setting}`).toBe(painted);
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointermove', { x: 40, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 40, y: 10 }));
      expect(fibers[0]).toBe(painted);
      // 30 Å: a fibre's points exactly its fibres' step apart (3 Å), whatever the reads' (review S1); copies every
      // 10 Å (a copy's diameter) else
      const ps = strokes[0].positions;
      expect(ps.length / 3, `${fiberStep} ${setting}`).toBe(points);
      if (fiberStep && painted) for (let i = 3; i < ps.length; i += 3) expect(ps[i] - ps[i - 3]).toBeCloseTo(3, 5);
      mode.stop();
      document.body.innerHTML = '';
    }
  });

  it('the copy under the pointer stays still during a stroke on a surface: no redraw of the pick a frame (review S2)', async () => {
    const { mode, layer, copy } = setup(0, { upright: true });
    mode.start(brush);
    const el = layer();
    vi.spyOn(MouseEvent.prototype, 'offsetX', 'get').mockImplementation(function (this: MouseEvent) {
      return this.clientX;
    });
    vi.spyOn(MouseEvent.prototype, 'offsetY', 'get').mockImplementation(function (this: MouseEvent) {
      return this.clientY;
    });
    const frame = () => new Promise((resolve) => setTimeout(resolve, 40));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }));
    await frame();
    expect(copy.at).toEqual([10, -10, 0]);
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointermove', { x: 40, y: 10 }));
    await frame();
    expect(copy.at).toEqual([10, -10, 0]);
    el.dispatchEvent(pointer('pointerup', { x: 40, y: 10 }));
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
