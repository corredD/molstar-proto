/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <ludovic.autin@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { OrderedSet } from '@molstar/core/data/int';
import { Mat4, Vec3, type Vec4 } from '@molstar/core/math/linear-algebra';
import { Binding } from '@molstar/core/util/binding';
import { Color } from '@molstar/core/util/color';
import { Shape, ShapeGroup } from '@molstar/model/model/shape';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Canvas3D } from '../../../canvas3d/canvas3d.js';
import type { GraphicsContext } from '../../../gl/context.js';
import type { Representation } from '../../../repr/representation.js';
import { GizmoAppearance, type GizmoBinding, GizmoController, type GizmoItem } from '../controller.js';
import { transformHandles } from '../transform.js';

// The gizmo controller's lifecycle on a fake canvas: hover takes the trackball's drags and gives them back, a drag
// previews and commits once, and every other end (Esc, a change under it, a commit not taken, nothing changed)
// cancels and restores.

type Value = { readonly x: number };

const graphics = { capabilities: { flatInterpolation: true } } as unknown as GraphicsContext;
const drags = {
  dragRotate: Binding([]),
  dragPan: Binding([]),
} as unknown as Canvas3D['attribs']['trackball']['bindings'];

function fakeCanvas() {
  const added: Representation.Any[] = [];
  const onTop = new Set<Representation.Any>();
  const attribs = { trackball: { bindings: drags } };
  const input = {
    pixelRatio: 1,
    drag: new Subject<{ isStart: boolean; x: number; y: number; dx: number; dy: number }>(),
    interactionEnd: new Subject<void>(),
    keyDown: new Subject<{ key: string }>(),
  };
  const canvas = {
    graphics,
    add: vi.fn((r: Representation.Any) => void added.push(r)),
    remove: vi.fn((r: Representation.Any) => {
      added.splice(added.indexOf(r), 1);
      onTop.delete(r);
    }),
    setOnTop: vi.fn((r: Representation.Any, on: boolean) => void (on ? onTop.add(r) : onTop.delete(r))),
    update: vi.fn(),
    requestDraw: vi.fn(),
    attribs,
    setAttribs: vi.fn((a: { trackball: { bindings: typeof drags } }) => {
      attribs.trackball.bindings = a.trackball.bindings;
    }),
    interaction: { hover: new Subject<{ current: Representation.Loci }>() },
    input,
    didDraw: new Subject<number>(),
    camera: {
      state: {
        position: Vec3.create(0, 0, 10),
        target: Vec3.create(0, 0, 0),
        up: Vec3.create(0, 1, 0),
        fov: Math.PI / 4,
        mode: 'perspective',
      },
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      project: (out: Vec4, p: Vec3) => {
        out[0] = 50 + p[0] * 10;
        out[1] = 50 - p[1] * 10;
        return out;
      },
    },
  };
  return { canvas: canvas as unknown as Canvas3D, fake: canvas, added, onTop };
}

function fakeBinding(commitResult = true) {
  const items = new BehaviorSubject<readonly GizmoItem<Value>[]>([{ key: 'a', value: { x: 0 }, label: 'A' }]);
  const invalidated = new Subject<string>();
  const binding = {
    items,
    invalidated,
    layout: () => ({ ...transformHandles(1, { planes: false, rotate: false }), frame: Mat4.identity() }),
    sameGeometry: () => true,
    equal: (a: Value, b: Value) => a.x === b.x,
    apply: (from: Value, _h: unknown, _f: unknown, dx: number) => ({ x: from.x + dx }),
    begin: vi.fn(),
    preview: vi.fn(async () => {}),
    commit: vi.fn(async () => commitResult),
    cancel: vi.fn(),
  } satisfies GizmoBinding<Value>;
  return binding;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The fake canvas' handle representation (the gizmo's only one: no body) and a loci on its group `g` */
function hoverOn(fake: ReturnType<typeof fakeCanvas>, g: number, at = 0) {
  const repr = fake.added[at];
  const shape = (repr.getAllLoci()[0] as Shape.Loci).shape;
  const loci = ShapeGroup.Loci(shape, [{ ids: OrderedSet.ofSingleton(g), instance: 0 }]);
  fake.fake.interaction.hover.next({ current: { repr, loci } });
}

async function drag(fake: ReturnType<typeof fakeCanvas>, steps: number[]) {
  fake.fake.input.drag.next({ isStart: true, x: 50, y: 50, dx: 0, dy: 0 });
  for (const x of steps) fake.fake.input.drag.next({ isStart: false, x: 50 + x, y: 50, dx: 0, dy: 0 });
  await settle();
}

describe('GizmoController', () => {
  it('takes the trackball drags over a handle and gives them back whole', async () => {
    const fake = fakeCanvas();
    const c = new GizmoController(fake.canvas, fakeBinding());
    await settle();
    expect(fake.added).toHaveLength(1);
    hoverOn(fake, 1);
    expect(fake.fake.attribs.trackball.bindings.dragRotate).toBe(Binding.Empty);
    fake.fake.interaction.hover.next({ current: { repr: undefined, loci: { kind: 'empty-loci' } } as never });
    expect(fake.fake.attribs.trackball.bindings).toEqual(drags);
    c.dispose();
    expect(fake.added).toHaveLength(0);
  });

  it('previews a drag and commits it once, as the last move left it', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    hoverOn(fake, 1);
    await drag(fake, [5, 10, 20]);
    expect(binding.begin).toHaveBeenCalledWith('a', { x: 0 });
    expect(binding.preview).toHaveBeenLastCalledWith('a', { x: 0 }, { x: 20 });
    fake.fake.input.interactionEnd.next();
    await settle();
    expect(binding.commit).toHaveBeenCalledTimes(1);
    expect(binding.commit).toHaveBeenCalledWith('a', { x: 0 }, { x: 20 });
    expect(binding.cancel).not.toHaveBeenCalled();
    expect(c.dragging.value).toBeUndefined();
    c.dispose();
  });

  it('cancels on Esc, on a change under the drag, on a commit not taken, and when nothing changed', async () => {
    for (const end of ['esc', 'invalidated', 'refused', 'unchanged'] as const) {
      const fake = fakeCanvas();
      const binding = fakeBinding(end !== 'refused');
      const c = new GizmoController(fake.canvas, binding);
      await settle();
      hoverOn(fake, 1);
      await drag(fake, end === 'unchanged' ? [0] : [10]);
      if (end === 'esc') fake.fake.input.keyDown.next({ key: 'Escape' });
      if (end === 'invalidated') binding.invalidated.next('a');
      fake.fake.input.interactionEnd.next();
      await settle();
      expect(binding.cancel, end).toHaveBeenCalledWith('a', { x: 0 });
      if (end !== 'refused') expect(binding.commit, end).not.toHaveBeenCalled();
      expect(c.dragging.value, end).toBeUndefined();
      // the hover left: the bindings back whole
      fake.fake.interaction.hover.next({ current: { repr: undefined, loci: { kind: 'empty-loci' } } as never });
      expect(fake.fake.attribs.trackball.bindings, end).toEqual(drags);
      c.dispose();
    }
  });

  it('follows its items: a new one drawn, a gone one removed', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    binding.items.next([...binding.items.value, { key: 'b', value: { x: 1 }, label: 'B' }]);
    await settle();
    expect(fake.added).toHaveLength(2);
    binding.items.next([]);
    await settle();
    expect(fake.added).toHaveLength(0);
    expect(c.owns(undefined)).toBe(false);
    c.dispose();
  });

  it('shares the trackball drags with another controller on the canvas: back whole when the last lets go', async () => {
    const fake = fakeCanvas();
    const a = new GizmoController(fake.canvas, fakeBinding());
    const b = new GizmoController(fake.canvas, fakeBinding());
    await settle();
    expect(fake.added).toHaveLength(2);
    // straight from b's handle to a's (one hover each), then off both
    hoverOn(fake, 1, 1);
    hoverOn(fake, 1, 0);
    expect(fake.fake.attribs.trackball.bindings.dragRotate).toBe(Binding.Empty);
    fake.fake.interaction.hover.next({ current: { repr: undefined, loci: { kind: 'empty-loci' } } as never });
    expect(fake.fake.attribs.trackball.bindings).toEqual(drags);
    a.dispose();
    b.dispose();
  });

  it('cancels a commit that fails, and starts no drag while a commit is in flight', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    let fail: (e: Error) => void = () => {};
    binding.commit.mockImplementationOnce(() => new Promise<boolean>((_, reject) => (fail = reject)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    hoverOn(fake, 1);
    await drag(fake, [10]);
    fake.fake.input.interactionEnd.next();
    await settle();
    // pressed again while the commit runs: no drag
    await drag(fake, [5]);
    expect(binding.begin).toHaveBeenCalledTimes(1);
    fail(new Error('no'));
    await settle();
    expect(binding.cancel).toHaveBeenCalledWith('a', { x: 0 });
    expect(warn).toHaveBeenCalled();
    c.dispose();
  });

  it('cancels the drag of an item that goes away', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    hoverOn(fake, 1);
    await drag(fake, [10]);
    binding.items.next([]);
    await settle();
    expect(binding.cancel).toHaveBeenCalledWith('a', { x: 0 });
    expect(c.dragging.value).toBeUndefined();
    fake.fake.input.interactionEnd.next();
    await settle();
    expect(binding.commit).not.toHaveBeenCalled();
    c.dispose();
  });

  it("draws the handles at the canvas's scale, the body as it is, and follows a change of it", async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    // a body: the cut's own volume (never scaled)
    const layout = binding.layout();
    binding.layout = () => ({ ...layout, body: layout.handles });
    GizmoAppearance.set(fake.canvas, { scale: 2 });
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    // the body is not picked (what is behind it is), the handles are
    const body = fake.added.find((r) => !r.state.pickable)!;
    const handles = fake.added.find((r) => r.state.pickable)!;
    const scaleOf = (r: Representation.Any) => Mat4.getMaxScaleOnAxis(r.state.transform);
    expect(scaleOf(handles)).toBeCloseTo(2);
    expect(scaleOf(body)).toBeCloseTo(1);
    GizmoAppearance.set(fake.canvas, { scale: 0.5 });
    expect(scaleOf(handles)).toBeCloseTo(0.5);
    expect(scaleOf(body)).toBeCloseTo(1);
    expect(GizmoAppearance.of(fake.canvas)).toMatchObject({ scale: 0.5, onTop: false });
    c.dispose();
  });

  it("draws every part of the gizmos on top while the canvas's look says so, moved there, not made again", async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    const layout = binding.layout();
    binding.layout = () => ({ ...layout, body: layout.handles });
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    const parts = [...fake.added];
    expect(parts).toHaveLength(2);
    expect(fake.onTop.size).toBe(0);

    GizmoAppearance.set(fake.canvas, { onTop: true });
    // the handles and the body (Ludo: a handle one cannot see cannot be grabbed)
    expect([...fake.onTop]).toEqual(expect.arrayContaining(parts));
    expect(fake.added).toEqual(parts);

    // a gizmo made while on top (its item changed geometry) goes there as it is added
    binding.sameGeometry = () => false;
    binding.items.next([{ key: 'a', value: { x: 3 }, label: 'A' }]);
    await settle();
    expect(fake.added).toHaveLength(2);
    expect(fake.added.every((r) => fake.onTop.has(r))).toBe(true);
    expect(fake.added.some((r) => parts.includes(r))).toBe(false);

    GizmoAppearance.set(fake.canvas, { onTop: false });
    expect(fake.onTop.size).toBe(0);
    c.dispose();
    GizmoAppearance.set(fake.canvas, GizmoAppearance.Default);
  });

  it('lights the hovered handle in a strong color, that one only, in place, and puts it back', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    const handles = fake.added[0];
    const [ro] = handles.renderObjects;
    const tColor = (ro.values as { tColor: { ref: { value: { array: Uint8Array }; version: number } } }).tColor;
    const colors = () => Array.from({ length: 4 }, (_, g) => Color.fromArray(tColor.ref.value.array, g * 4));
    // changed in place and told (its version: what the GPU upload follows)
    let version = tColor.ref.version;
    const bumped = () => {
      const was = version;
      version = tColor.ref.version;
      return version > was;
    };
    const before = colors();
    const lit = Color(0xffff00);
    expect(before).not.toContain(lit);

    hoverOn(fake, 1);
    expect(colors()).toEqual([before[0], lit, before[2], before[3]]);
    expect(bumped()).toBe(true);
    expect(fake.fake.update).toHaveBeenLastCalledWith(handles, true);
    hoverOn(fake, 2);
    expect(colors()).toEqual([before[0], before[1], lit, before[3]]);
    fake.fake.interaction.hover.next({ current: { repr: undefined, loci: { kind: 'empty-loci' } } as never });
    expect(colors()).toEqual(before);
    expect(bumped()).toBe(true);

    // during a drag it stays on the dragged handle; the drag's end puts it back
    hoverOn(fake, 1);
    await drag(fake, [5, 10]);
    hoverOn(fake, 2);
    expect(colors()[1]).toBe(lit);
    fake.fake.input.interactionEnd.next();
    await settle();
    expect(colors()[1]).toBe(before[1]);
    // nothing made for it
    expect(handles.renderObjects).toEqual([ro]);

    // Esc during a drag, and dispose, put it back too
    hoverOn(fake, 1);
    await drag(fake, [5]);
    fake.fake.input.keyDown.next({ key: 'Escape' });
    expect(colors()[1]).toBe(before[1]);
    hoverOn(fake, 3);
    expect(colors()[3]).toBe(lit);
    c.dispose();
    expect(colors()[3]).toBe(before[3]);
  });

  it('keeps the dragged handle lit when the drag remakes its gizmo (a new size)', async () => {
    const fake = fakeCanvas();
    const binding = fakeBinding();
    binding.sameGeometry = () => false;
    const c = new GizmoController(fake.canvas, binding);
    await settle();
    const first = fake.added[0];
    hoverOn(fake, 1);
    await drag(fake, [5, 10]);
    await settle();
    const [remade] = fake.added;
    expect(remade).not.toBe(first);
    const values = remade.renderObjects[0].values as { tColor: { ref: { value: { array: Uint8Array } } } };
    expect(Color.fromArray(values.tColor.ref.value.array, 4)).toBe(Color(0xffff00));
    c.dispose();
  });
});
