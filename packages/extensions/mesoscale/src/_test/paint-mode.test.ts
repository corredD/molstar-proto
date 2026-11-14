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
  options: {
    upright?: boolean;
    changeOnPaint?: boolean;
    fiberStep?: number;
    depthRange?: [number, number];
    /** The mesh every surface read is on (grow-mesh): its state ref */
    mesh?: string;
    /** The z of what is under (x, y) (paint-refine): undefined, nothing; default the plane z = 0 everywhere */
    pick?: (x: number, y: number) => number | undefined;
  } = {},
) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const root = document.createElement('div');
  const canvas = document.createElement('canvas');
  root.append(canvas);
  document.body.append(root);
  const strokes: { positions: number[]; normals: number[]; mesh?: string }[] = [];
  /** the list each fiber step was read for (`into`) */
  const intos: (string | undefined)[] = [];
  const listeners = new Set<() => void>();
  let lists = true;
  let reads = pending;
  const refined: number[] = [];
  /** Whether each refine was for an upright brush */
  const uprights: boolean[] = [];
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
      const z = options.pick ? options.pick(x, y) : 0;
      if (z === undefined) return undefined;
      return { id: { objectId: 0, instanceId: 0, groupId: 0 }, position: Vec3.create(x, -y, z) } as PickResult;
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
    refine: (p, upright) => {
      refined.push(p.position[0]);
      uprights.push(upright);
      if (options.mesh) p.mesh = options.mesh;
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
    fiberStep: (_b, into) => (intos.push(into), options.fiberStep),
    paint: async (_b, _s, positions, normals, seed, fiber, mesh) => {
      strokes.push({ positions, normals, ...(mesh ? { mesh } : {}) });
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
    canvas,
    strokes,
    change,
    listeners,
    refined,
    uprights,
    camera,
    copy,
    seeds,
    fibers,
    intos,
    removeList: () => (lists = false),
  };
}

const brush = { particles: 'list', entity: 1, name: 'CD9' };

describe('paint mode', () => {
  it('reads the fiber step for the list the brush paints into, at its start and at each stroke (follow-up review S4)', () => {
    const { mode, layer, canvas, intos } = setup();
    mode.set({ into: 'hiv' });
    expect(mode.start(brush)).toBe(true);
    expect(intos).toEqual(['hiv']);
    mode.set({ into: 'model' });
    const el = canvas;
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(intos.at(-1)).toBe('model');
    mode.stop();
  });

  it('a stroke: lost releases leave no listener and paint nothing; a whole stroke paints once, a copy a spacing', () => {
    const { mode, layer, canvas, strokes } = setup();
    expect(mode.start(brush)).toBe(true);
    const r = lostReleases({
      target: () => canvas,
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
    const { mode, layer, canvas, strokes } = setup(3);
    mode.start(brush);
    const el = canvas;
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointermove', { x: 30, y: 10 }));
    // a few frames: the pick read
    await new Promise((resolve) => setTimeout(resolve, 100));
    el.dispatchEvent(pointer('pointerup', { x: 30, y: 10 }));
    expect(strokes.length).toBe(1);
    expect(strokes[0].positions.length).toBeGreaterThan(0);
    mode.stop();
  });

  it("refines every surface read (a mesh's for any brush), a membrane's mid-plane only for an upright brush", () => {
    for (const upright of [true, false]) {
      const { mode, layer, canvas, strokes, refined, uprights } = setup(0, { upright });
      mode.set({ place: 'surface' });
      mode.start(brush);
      const el = canvas;
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
      expect(strokes.length).toBe(1);
      expect(refined.length).toBe(1);
      expect(uprights).toEqual([upright]);
      mode.stop();
    }
  });

  it('paints a stroke on a mesh with the mesh it was read on (grow-mesh), a stroke at a depth with none', () => {
    for (const place of ['surface', 'depth'] as const) {
      const { mode, layer, canvas, strokes } = setup(0, { upright: false, mesh: 'vesicle-ref' });
      mode.set({ place });
      mode.start(brush);
      const el = canvas;
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
      expect(strokes[0].mesh).toBe(place === 'surface' ? 'vesicle-ref' : undefined);
      mode.stop();
    }
  });

  it("the previous stroke's commit does not cancel the stroke drawn after it", async () => {
    const { mode, layer, canvas, strokes } = setup(0, { changeOnPaint: true });
    mode.start(brush);
    const el = canvas;
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
    const { mode, layer, canvas } = setup();
    mode.start(brush);
    const hint = layer().querySelector<HTMLElement>('div')!;
    const css = hint.getAttribute('style') ?? '';
    for (const token of ['--msp-color-raised', '--msp-color-text', '--msp-font-size-sm', '--msp-radius-md'])
      expect(css).toContain(token);
    expect(css).not.toContain('--msp-color-surface');
    expect(css).not.toMatch(/#[0-9a-f]{3}|\d+px/i);
    mode.stop();
  });

  it('input (paint-refine): a plain left press paints; any other button, a modifier or the plain wheel is the camera', async () => {
    const { mode, layer, canvas, strokes } = setup(0, { upright: false });
    mode.start(brush);
    // the layer over the canvas lets the pointer through
    expect(layer().style.pointerEvents).toBe('none');
    // a left click paints, its default prevented (no mouse events after it: the canvas's camera does not see it)
    const down = pointer('pointerdown', { x: 10, y: 10 });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(down.defaultPrevented).toBe(true);
    expect(strokes.length).toBe(1);
    // a right press, a middle press, a left press with a modifier: not taken, nothing painted
    const init = { bubbles: true, cancelable: true, clientX: 20, clientY: 10, pointerId: 1 };
    for (const press of [
      { button: 2, buttons: 2 },
      { button: 1, buttons: 4 },
      { button: 0, buttons: 1, altKey: true },
      { button: 0, buttons: 1, ctrlKey: true },
      { button: 0, buttons: 1, shiftKey: true },
      { button: 0, buttons: 1, metaKey: true },
    ]) {
      const e = new PointerEvent('pointerdown', { ...init, ...press });
      canvas.dispatchEvent(e);
      canvas.dispatchEvent(new PointerEvent('pointermove', { ...init, ...press, clientX: 40 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, ...press, clientX: 40, buttons: 0 }));
      expect(e.defaultPrevented, JSON.stringify(press)).toBe(false);
    }
    expect(strokes.length).toBe(1);
    // the plain wheel zooms (not taken); Alt+wheel is the depth (taken, kept from the canvas)
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    const reached = vi.fn();
    canvas.addEventListener('wheel', reached);
    const alt = new WheelEvent('wheel', { deltaY: 100, altKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(layer().textContent).toContain('Alt+wheel: depth 110 Å');
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

  it('a soluble brush paints at the depth along the ray, from the focus; Alt+wheel moves it, not the plain wheel', () => {
    // nothing under the pointer: the depth is the focus's, then where Alt+wheel put it
    const { mode, layer, canvas, strokes } = setup(0, { upright: false, pick: () => undefined });
    mode.start(brush);
    const el = canvas;
    expect(layer().textContent).toContain('Alt+wheel: depth 100 Å');
    // a click: one copy, at the focus (100 Å from z = 100), facing the viewer
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(strokes[0].positions).toEqual([10, -10, 0]);
    expect(strokes[0].normals).toEqual([-0, -0, 1]);
    // with Alt, a notch farther: a copy's diameter (10 Å)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, altKey: true, bubbles: true, cancelable: true }));
    // without: the camera's zoom, the depth unchanged
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    el.dispatchEvent(pointer('pointerdown', { x: 20, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(strokes[1].positions).toEqual([20, -10, -10]);
    // never nearer than a copy's radius
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, altKey: true, bubbles: true, cancelable: true }));
    el.dispatchEvent(pointer('pointerdown', { x: 20, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(strokes[2].positions[2]).toBe(95);
    mode.stop();
  });

  it('the depth (paint-refine): what is under the press, else where it was; Alt+wheel holds it for the next stroke', () => {
    // a particle at z = -30 under x < 50, nothing elsewhere; the eye at z = 100, the focus 100 Å away
    const { mode, canvas, strokes } = setup(0, { upright: false, pick: (x) => (x < 50 ? -30 : undefined) });
    mode.start(brush);
    const click = (x: number) => {
      canvas.dispatchEvent(pointer('pointerdown', { x, y: 10 }));
      canvas.dispatchEvent(pointer('pointerup', { x, y: 10 }));
      return strokes[strokes.length - 1].positions[2];
    };
    // over nothing: the focus
    expect(click(80)).toBe(0);
    // on the particle: its depth
    expect(click(10)).toBe(-30);
    // over nothing again: where it was last
    expect(click(80)).toBe(-30);
    // Alt+wheel a notch nearer (10 Å): kept for the next stroke, even on the particle
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, altKey: true, bubbles: true, cancelable: true }));
    expect(click(10)).toBe(-20);
    // then what is under the press again
    expect(click(20)).toBe(-30);
    // a drag keeps the depth of its first point
    canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    canvas.dispatchEvent(pointer('pointermove', { x: 90, y: 10 }));
    canvas.dispatchEvent(pointer('pointerup', { x: 90, y: 10 }));
    const ps = strokes[strokes.length - 1].positions;
    for (let i = 2; i < ps.length; i += 3) expect(ps[i]).toBe(-30);
    expect(ps.length / 3).toBeGreaterThan(1);
    mode.stop();
  });

  it("keeps the depth in the camera's drawn range (Round 4): the copy never past its near or far plane", () => {
    // the camera draws 60 to 130 Å from the eye; a copy's radius 5
    const { mode, layer, canvas, strokes } = setup(0, { upright: false, depthRange: [60, 130] });
    mode.start(brush);
    const el = canvas;
    const at = (x: number) => {
      el.dispatchEvent(pointer('pointerdown', { x, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x, y: 10 }));
      return strokes[strokes.length - 1].positions[2];
    };
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, altKey: true, bubbles: true, cancelable: true }));
    // 65 Å from the eye at z = 100
    expect(at(10)).toBe(35);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000, altKey: true, bubbles: true, cancelable: true }));
    expect(at(20)).toBe(-25);
    mode.stop();
  });

  it("N2: starts the depth inside the camera's drawn range too", () => {
    // the focus 100 Å away, the camera drawing 10 to 50 Å: a copy's radius (5) inside the far plane
    const { mode, layer, canvas, strokes } = setup(0, { upright: false, depthRange: [10, 50] });
    mode.start(brush);
    const el = canvas;
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(strokes[0].positions[2]).toBe(55);
    mode.stop();
  });

  it('Place: a membrane protein on the surface by default, at the depth when asked; anything else the other way', () => {
    for (const [upright, place, z] of [
      [true, 'auto', 0],
      [true, 'depth', 0],
      [false, 'surface', 0],
    ] as const) {
      const { mode, layer, canvas, strokes, refined } = setup(0, { upright });
      mode.set({ place });
      mode.start(brush);
      const el = canvas;
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
      expect(strokes[0].positions[2]).toBe(z);
      // a surface read is refined; a depth reads no pick
      expect(refined.length, `${upright} ${place}`).toBe(place === 'depth' ? 0 : 1);
      mode.stop();
    }
  });

  it('a copy follows the pointer where a click puts it; the click paints it with its seed; hidden off the canvas', async () => {
    const { mode, layer, canvas, strokes, copy, seeds } = setup(0, { upright: false });
    mode.start(brush);
    const el = canvas;
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
    over(40, 20);
    await frame();
    expect(copy.at).toEqual([40, -20, 0]);
    el.dispatchEvent(new PointerEvent('pointerleave'));
    await frame();
    expect(copy.at).toBeUndefined();
    mode.stop();
    expect(copy.disposed).toBe(true);
  });

  it("a brush with fibers paints a fiber by default, its points its fibers' step apart; Fiber overrides it", () => {
    for (const [fiberStep, setting, painted, points] of [
      [3, 'auto', true, 11],
      [undefined, 'auto', false, 3],
      [3, 'off', false, 3],
      [undefined, 'on', true, 4],
    ] as const) {
      const { mode, layer, canvas, fibers, strokes } = setup(0, { upright: true, fiberStep });
      mode.set({ fiber: setting });
      mode.start(brush);
      const el = canvas;
      expect(layer().textContent?.includes('a fiber of'), `${fiberStep} ${setting}`).toBe(painted);
      el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
      el.dispatchEvent(pointer('pointermove', { x: 40, y: 10 }));
      el.dispatchEvent(pointer('pointerup', { x: 40, y: 10 }));
      expect(fibers[0]).toBe(painted);
      // 30 Å: a fiber's points exactly its fibers' step apart (3 Å), whatever the reads' (review S1); copies every
      // 10 Å (a copy's diameter) else
      const ps = strokes[0].positions;
      expect(ps.length / 3, `${fiberStep} ${setting}`).toBe(points);
      if (fiberStep && painted) for (let i = 3; i < ps.length; i += 3) expect(ps[i] - ps[i - 3]).toBeCloseTo(3, 5);
      mode.stop();
      document.body.innerHTML = '';
    }
  });

  it('the copy under the pointer stays still during a stroke on a surface: no redraw of the pick a frame (review S2)', async () => {
    const { mode, layer, canvas, copy } = setup(0, { upright: true });
    mode.start(brush);
    const el = canvas;
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
      const { mode, layer, canvas, listeners } = setup();
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
    const { mode, layer, canvas, strokes, change, removeList } = setup();
    mode.start(brush);
    const el = canvas;
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
    const { mode, layer, canvas } = setup();
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
