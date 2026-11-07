/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { offsetParticles, ParticleListWithTargets } from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import type { MergedGraphicsRenderObject } from '@molstar/graphics/gl/render-object';
import type { Representation } from '@molstar/graphics/repr/representation';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import {
  drawsAny,
  handleSize,
  movedIndices,
  offsetFrames,
  offsetMatrix,
  particleFrame,
  solveEdit,
} from '../particle-handle.js';
import { StageToolsExtension } from '../prism-viewer.js';

// A particle's local handle: the offset that puts the particle's frame where the handle took it, whichever offset it
// edits, the others of the stack kept around it.

/** Two particles of targets 0 and 1, the second turned a quarter about z */
const list = {
  count: 2,
  coordinates: Float32Array.of(0, 0, 0, 10, 0, 0),
  rotations: Float32Array.from([...Quat.identity(), ...Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 2)]),
  targets: Int32Array.of(0, 1),
  targetInfo: new Map([
    [0, {}],
    [1, {}],
  ]),
} as unknown as ParticleList;

const close = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 4);
};

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

describe('the particle handle', () => {
  it('solves the offset that puts a particle where the handle took it, the stack around it kept', () => {
    const stack = {
      input: list,
      // every particle up 1 along its own z, first
      offsets: [{ targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3() }],
      instances: [],
    };
    // the second particle as drawn now, then taken 2 along its own y and a quarter more about its own z
    const drawn = offsetParticles(list, stack.offsets, []);
    const moved = Mat4.mul(Mat4(), particleFrame(drawn, 1), offsetMatrix([0, 2, 0], [0, 0, 90]));
    // All off: the instance's own offset is that local move
    const own = solveEdit(stack, 1, { kind: 'instance' }, moved);
    close(own.translation, [0, 2, 0]);
    close(own.euler, [0, 0, 90]);
    // and drawn with it, the particle is where the handle took it
    const after = offsetParticles(list, own.stack.offsets, own.stack.instances);
    close(particleFrame(after, 1), moved);
    // All on, its kind (target 1): a new offset after the every-particle one
    const kind = solveEdit(stack, 1, { kind: 'offset', targets: '1' }, moved);
    close(kind.translation, [0, 2, 0]);
    close(particleFrame(offsetParticles(list, kind.stack.offsets, kind.stack.instances), 1), moved);
    // the list's own (every particle): the every-particle offset edited in place, the up 1 folded in
    const all = solveEdit(stack, 1, { kind: 'offset', targets: '' }, moved);
    close(all.translation, [0, 2, 1]);
    expect(all.stack.offsets).toHaveLength(1);
    close(particleFrame(offsetParticles(list, all.stack.offsets, all.stack.instances), 1), moved);
  });

  it("reaches just past what is drawn on the particle, from the particle's origin", () => {
    // a cellPACK protein: its structure off the particle's origin by 11 Å, 15 Å in radius, the particle's own radius
    // (the file's) 13 Å: the far side 26 Å out, the handle a quarter past it, not three particle radii (39 Å)
    const structure = { boundary: { sphere: { center: Vec3.create(11, 0, 0), radius: 15 } } };
    const target = { kind: 'structure', structure } as unknown as Parameters<typeof handleSize>[0];
    expect(handleSize(target, 13)).toBeCloseTo(1.25 * 26, 6);
    // nothing drawn on it: the particle's sphere, a quarter past it; never under 20 Å
    expect(handleSize(undefined, 40)).toBeCloseTo(50, 6);
    expect(handleSize(undefined, 2)).toBe(20);
  });

  it("draws the particle moved while it is dragged: the canvas given the list's representations", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
    });
    viewers.push(v);
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    const r = await v.api.load.files({ files: [new File([star], 'p.star')] });
    expect(r.ok, (r as ApiResult<unknown> & { message?: string }).message).toBe(true);
    const drawn = v.plugin.managers.particles.hierarchy.current.lists[0];
    const reprs = drawn.representations.map((x) => (x.cell.obj?.data as { repr: Representation.Any }).repr);
    expect(reprs.length).toBeGreaterThan(0);
    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.stage!.useParticleHandles(v.api);
    expect(handles.show({ list: drawn.cell.transform.ref, index: 0, edit: { kind: 'instance' } })).toBe(true);
    expect(await canvas.hover()).toBe(true);
    const update = vi.spyOn(v.plugin.canvas3d!, 'update');
    await canvas.drag([2, 4, 6]);
    // previewed, before the release: each representation's new values given to the canvas (its renderables upload
    // them there; a redraw request alone draws the particles where they were)
    for (const repr of reprs) expect(update.mock.calls.some(([u]) => u === repr)).toBe(true);
    await canvas.release();
    canvas.remove();
  });

  it('places the moved particles as `offsetParticles` does, computing their frames alone', () => {
    // three particles: 0 and 2 of target 0, 1 of target 1; every particle up 1, target 0 turned, particle 2 alone moved
    const three = {
      count: 3,
      coordinates: Float32Array.of(0, 0, 0, 10, 0, 0, 20, 0, 0),
      rotations: Float32Array.from([
        ...Quat.identity(),
        ...Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 2),
        ...Quat.setAxisAngle(Quat(), Vec3.create(1, 0, 0), Math.PI / 4),
      ]),
      targets: Int32Array.of(0, 1, 0),
      targetInfo: new Map([
        [0, {}],
        [1, {}],
      ]),
    } as unknown as ParticleList;
    const stack = {
      input: three,
      offsets: [
        { targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3() },
        { targets: [0], translation: Vec3.create(2, 0, 0), euler: Vec3.create(0, 30, 0) },
      ],
      instances: [{ index: 2, translation: Vec3.create(0, 3, 0), euler: Vec3.create(10, 0, 0) }],
    };
    const all = offsetParticles(three, stack.offsets, stack.instances);
    const indices = Int32Array.of(2, 0, 1);
    const frames = offsetFrames(stack, indices);
    for (let k = 0; k < indices.length; k++)
      close(frames.subarray(k * 16, k * 16 + 16), particleFrame(all, indices[k]));
    // into the buffer given (a drag's, reused)
    expect(offsetFrames(stack, indices, frames)).toBe(frames);
  });

  it('moves the particle alone, or every particle of the edited targets', () => {
    const three = {
      count: 3,
      targets: Int32Array.of(0, 1, 0),
      customProperties: { add() {} },
      _propertyData: Object.create(null),
    } as never;
    expect(Array.from(movedIndices(three, 1, { kind: 'instance' }))).toEqual([1]);
    expect(Array.from(movedIndices(three, 0, { kind: 'offset', targets: '0' })).sort()).toEqual([0, 2]);
    expect(Array.from(movedIndices(three, 0, { kind: 'offset', targets: '1,0' })).sort()).toEqual([0, 1, 2]);
    expect(Array.from(movedIndices(three, 0, { kind: 'offset', targets: '' }))).toEqual([0, 1, 2]);
  });

  it("knows which of a list's other representations draw a moved particle", () => {
    // particles 0 and 1 of target 0 (drawn by the target representation), 2 of none, 3 in a fiber
    const four = {
      count: 4,
      targets: Int32Array.of(0, 0, 1, 1),
      targetMapping: new Map([[0, {}]]),
      fibers: { count: 1, offsets: Int32Array.of(0, 1), indices: Int32Array.of(3) },
      customProperties: { add() {} },
      _propertyData: Object.create(null),
    } as unknown as ParticleList;
    const spacefill = { type: { name: 'spacefill' } };
    const fibers = { type: { name: 'fibers' } };
    // a cellPACK's spacefill leaves the targeted particles out: moving them does not draw it again
    expect(drawsAny(spacefill, { props: { excludeTargets: true } }, four, [0, 1])).toBe(false);
    expect(drawsAny(spacefill, { props: { excludeTargets: true } }, four, [1, 2])).toBe(true);
    // a spacefill of every particle draws them all
    expect(drawsAny(spacefill, { props: { excludeTargets: false } }, four, [0])).toBe(true);
    expect(drawsAny(fibers, { props: {} }, four, [0, 1, 2])).toBe(false);
    expect(drawsAny(fibers, { props: {} }, four, [3])).toBe(true);
  });

  it("previews a decorated particle's drag without making its target representation again, as its release draws it", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
    });
    viewers.push(v);
    const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
    expect((await v.api.load.files({ files: [crn] })).ok).toBe(true);
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n80 0 0\n';
    expect((await v.api.load.files({ files: [new File([star], 'p.star')] })).ok).toBe(true);
    const crnRef = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const listRef = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    // decorated with 1CRN: a target representation, beside the spacefill of every particle the load made
    await v.plugin
      .build()
      .to(listRef)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crnRef } } }] })
      .apply(ParticlesRepresentation3D, {
        type: { name: 'target', params: {} },
        colorTheme: { name: 'uniform', params: {} },
        sizeTheme: { name: 'uniform', params: {} },
      } as never)
      .commit();
    const reprs = () =>
      v.plugin.managers.particles.hierarchy.current.lists[0].representations.map((r) => ({
        name: (r.cell.transform.params as { type: { name: string } }).type.name,
        repr: (r.cell.obj!.data as { repr: Representation.Any }).repr,
      }));
    const target = reprs().find((r) => r.name === 'target')!.repr;
    const spacefill = reprs().find((r) => r.name === 'spacefill')!.repr;
    /** The target representation's transforms as drawn (the state's, after a commit) */
    const drawn = () =>
      reprs()
        .find((r) => r.name === 'target')!
        .repr.renderObjects.flatMap((ro) => {
          (ro as Partial<MergedGraphicsRenderObject>).merged?.sync();
          return Array.from(ro.values.aTransform.ref.value.subarray(0, ro.values.instanceCount.ref.value * 16));
        });
    const before = drawn();

    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.stage!.useParticleHandles(v.api);
    expect(handles.show({ list: listRef, index: 0, edit: { kind: 'instance' } })).toBe(true);
    expect(await canvas.hover()).toBe(true);
    const made = vi.spyOn(target, 'createOrUpdate');
    const spacefillMade = vi.spyOn(spacefill, 'createOrUpdate');
    const update = vi.spyOn(v.plugin.canvas3d!, 'update');
    await canvas.drag([2, 4, 6]);
    // previewed: the target representation's instances written, not made again; the canvas given them
    expect(made).not.toHaveBeenCalled();
    expect(update.mock.calls.some(([u]) => u === target)).toBe(true);
    const previewed = drawn();
    expect(previewed.some((x, i) => Math.abs(x - before[i]) > 1e-3)).toBe(true);
    // the spacefill draws every particle: made again from the moved list
    expect(spacefillMade).toHaveBeenCalled();
    // released: its commit (`cryoet.instance`) is not here (stage tools alone), so it fails and the particle is put back
    // where the state has it, the spacefill made again from it; the commit drawn as previewed is the app's test
    // (apps/prism-me/src/_test/particle-handle.test.ts)
    await canvas.release();
    expect(made).not.toHaveBeenCalled();
    const back = drawn();
    expect(back.length).toBe(before.length);
    for (let i = 0; i < back.length; i++) expect(back[i]).toBeCloseTo(before[i], 4);
    const spacefillCell = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as { type: { name: string } }).type.name === 'spacefill',
    )!.cell;
    expect(spacefillMade.mock.calls.at(-1)?.[1]).toBe((spacefillCell.obj!.data as { sourceData: unknown }).sourceData);
    made.mockRestore();
    spacefillMade.mockRestore();
    canvas.remove();
  });
});
