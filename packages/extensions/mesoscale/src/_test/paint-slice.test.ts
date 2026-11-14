// @vitest-environment jsdom

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { PickResult } from '@molstar/graphics/canvas3d/passes/pick';
import { pointer, stubPointerCapture } from '@molstar/prism-ui/testing/gestures';
import type { PluginContext } from '@molstar/plugin/context';
import { pluginPaintHost } from '../paint-host.js';
import { type PaintHost, PaintMode } from '../paint-mode.js';
import { SurfacePoint } from '../pick-surface.js';

// Paint on a slice (density-fit): a fake canvas whose pick is the plane z = 0 and, left of x = 50, a volume's slice,
// the plane z = 20 seen down -z: a click there paints at the slice's point (its normal the plane's) whatever the place
// and the depth, and its copies are fitted to the slice's volume with Fit to Auto (to none with None, to the volume
// chosen elsewhere); the copy under the pointer's fit is in the hint.

beforeAll(stubPointerCapture);
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function setup(pending = 0) {
  let reads = pending;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const root = document.createElement('div');
  const canvas = document.createElement('canvas');
  root.append(canvas);
  document.body.append(root);
  const strokes: { positions: number[]; normals: number[]; fit?: string }[] = [];
  const shown: { at: number[]; fit?: string }[] = [];
  const host: PaintHost = {
    canvas: () => canvas,
    holdCamera: () => () => {},
    identify: (x, y) =>
      ({ id: { objectId: 0, instanceId: 0, groupId: 0 }, position: Vec3.create(x, -y, 0) }) as PickResult,
    eye: (out) => Vec3.set(out, 0, 0, 100),
    ray: (x, y, origin, direction) => {
      Vec3.set(origin, x, -y, 100);
      Vec3.set(direction, 0, 0, -1);
      return true;
    },
    focus: () => 100,
    refine: () => {},
    sliceAt: (x, y, point) => {
      // the canvas's pick not read yet (the copy under the pointer just moved): ask again next frame
      if (reads > 0) {
        reads--;
        return 'pending';
      }
      if (x >= 50) return false;
      Vec3.set(point.position, x, -y, 20);
      Vec3.set(point.normal, 0, 0, 1);
      point.volume = 'tomogram';
      return true;
    },
    upright: () => false,
    project: (out, p) => Vec3.set(out, p[0], -p[1], 0),
    radius: () => 5,
    cursor: () => ({
      move: (p, _n, _s, _seed, _onSurface, fit) => {
        shown.push({ at: [p[0], p[1], p[2]], ...(fit ? { fit } : {}) });
        return fit ? { position: p, rotation: Quat.identity(), score: 2.43, shift: 3.06, angle: 8.2 } : undefined;
      },
      hide: () => {},
      dispose: () => {},
    }),
    fiberStep: () => undefined,
    paint: async (_b, _s, positions, normals, _seed, _fiber, _mesh, _surface, fit) => {
      strokes.push({ positions, normals, ...(fit ? { fit } : {}) });
    },
    has: () => true,
    changed: () => () => {},
  };
  return { mode: new PaintMode(host), canvas, strokes, shown, root };
}

const brush = { particles: 'list', entity: 1, name: 'CD9' };

const click = (canvas: HTMLElement, x: number, y: number) => {
  canvas.dispatchEvent(pointer('pointerdown', { x, y }));
  canvas.dispatchEvent(pointer('pointerup', { x, y }));
};

describe('paint on a slice', () => {
  it("paints at the slice's point, its normal the plane's, at a depth or on a surface", () => {
    for (const place of ['depth', 'surface'] as const) {
      const { mode, canvas, strokes } = setup();
      mode.set({ place });
      mode.start(brush);
      click(canvas, 10, 10);
      expect(strokes[0].positions).toEqual([10, -10, 20]);
      expect(strokes[0].normals).toEqual([0, 0, 1]);
      // off the slice: as before (the plane z = 0 under it, or the depth)
      click(canvas, 70, 10);
      expect(strokes[1].positions[2]).not.toBe(20);
      mode.stop();
    }
  });

  it('waits for a pending pick at the press (the slice and its volume read in a later frame)', async () => {
    const { mode, canvas, strokes } = setup(2);
    mode.start(brush);
    canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    canvas.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
    expect(strokes[0].positions).toEqual([10, -10, 20]);
    expect(strokes[0].fit).toBe('tomogram');
    mode.stop();
  });

  it('paints at the depth when the pick is still pending at the release', () => {
    const { mode, canvas, strokes } = setup(100);
    mode.start(brush);
    click(canvas, 10, 10);
    expect(strokes.length).toBe(1);
    expect(strokes[0].fit).toBeUndefined();
    mode.stop();
  });

  it("fits to the slice's volume with Fit to Auto, to none with None, to the one chosen elsewhere", () => {
    const { mode, canvas, strokes } = setup();
    mode.start(brush);
    click(canvas, 10, 10);
    expect(strokes[0].fit).toBe('tomogram');
    click(canvas, 70, 10);
    expect(strokes[1].fit).toBeUndefined();
    mode.set({ fit: '' });
    click(canvas, 10, 10);
    expect(strokes[2].fit).toBeUndefined();
    mode.set({ fit: 'map' });
    click(canvas, 70, 10);
    expect(strokes[3].fit).toBe('map');
    mode.stop();
  });

  it('fits no fiber: its stroke and the copy under the pointer unfitted (review S10)', async () => {
    const { mode, canvas, strokes, shown } = setup();
    mode.set({ fiber: 'on' });
    mode.start(brush);
    const move = new PointerEvent('pointermove', { bubbles: true });
    Object.defineProperties(move, { offsetX: { value: 10 }, offsetY: { value: 10 } });
    canvas.dispatchEvent(move);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.at(-1)?.fit).toBeUndefined();
    click(canvas, 10, 10);
    expect(strokes[0].fit).toBeUndefined();
    mode.stop();
  });

  it('shows the copy under the pointer fitted, its fit in the hint', async () => {
    const { mode, canvas, shown, root } = setup();
    mode.start(brush);
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    Object.defineProperty(canvas, 'onpointermove', { value: null });
    const move = new PointerEvent('pointermove', { bubbles: true });
    Object.defineProperties(move, { offsetX: { value: 10 }, offsetY: { value: 10 } });
    canvas.dispatchEvent(move);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown.at(-1)).toEqual({ at: [10, -10, 20], fit: 'tomogram' });
    expect(root.querySelector('.msp-paint-layer')!.textContent).toContain('fit 2.4σ, 3.1 Å, 8°');
    mode.stop();
  });
});

describe("the viewer's slice read", () => {
  it('reads no pick when the scene has no volume: a depth drag as before (review S4)', () => {
    let picks = 0;
    const plugin = {
      canvas3d: {
        identify: () => {
          picks++;
          return undefined;
        },
      },
      state: { data: { cells: new Map(), events: { changed: { subscribe: () => ({ unsubscribe() {} }) } } } },
    } as unknown as PluginContext;
    const host = pluginPaintHost(plugin, async () => undefined);
    expect(host.sliceAt!(1, 1, SurfacePoint())).toBe(false);
    expect(picks).toBe(0);
    host.dispose();
  });
});
