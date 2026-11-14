/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import {
  ParticleListOffsets,
  ParticleListTargetsFromAttribute,
  ParticleListTransform,
} from '@molstar/plugin/state/transforms/particles/ops';
import { ParticleListPainted, type PaintStroke } from '../paint.js';
import { MesoscaleExtension } from '../prism-viewer.js';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { Sphere } from '@molstar/graphics/geo/primitive/sphere';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { OrderedSet } from '@molstar/core/data/int';
import { ShapeGroup } from '@molstar/model/model/shape';
import type { PluginContext } from '@molstar/plugin/context';
import { sceneMeshes } from '../mesh-surface.js';
import { pluginPaintHost } from '../paint-host.js';
import { DefaultPaintSettings } from '../paint-mode.js';
import { SurfacePoint } from '../pick-surface.js';
import { setTestTargetStructure, TestTargetList } from './fixtures.js';

// `mesoscale.grow` (progress/2026-11-11-grow.md, Tests: the operation) on the cellPACK-like list of paint's tests (four
// 1CRN targets, drawn as targets; particle 2 is CA at (20, 0, 0), its compartment a surface): one step a grow, the
// copies the source's list's painted copies, of its target, entity and compartment.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), MesoscaleExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  setTestTargetStructure(v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data);
  await v.plugin.build().toRoot().apply(TestTargetList).commit();
  expectOk(await v.api.particles.representation({ type: 'target' }));
  return v;
}

const entry = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists[0];
const drawn = (v: PrismViewer) =>
  (entry(v).representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const painted = (v: PrismViewer) =>
  Array.from(v.plugin.state.data.cells.values()).filter((c) => c.transform.transformer === ParticleListPainted);
const strokes = (v: PrismViewer) => (painted(v)[0].transform.params as { strokes: PaintStroke[] }).strokes;
const xyz = (l: ParticleList, i: number) => Vec3.fromArray(Vec3(), l.coordinates, i * 3);
const quat = (l: ParticleList, i: number) => Quat.fromArray(Quat(), l.rotations!, i * 4);

describe('mesoscale.grow', () => {
  it("grows a crystal as one step: the source's target, entity and compartment; undo removes it, redo brings it back", async () => {
    const v = await viewer();
    const before = { count: drawn(v).count, steps: steps(v) };
    const ref = entry(v).cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 2,
      mode: 'crystal',
      a: 30,
      b: 30,
      c: 30,
      na: 3,
      nb: 1,
      nc: 1,
    });
    expectOk(r);
    expect(r.value).toMatchObject({ count: 2, mode: 'crystal' });
    expect(steps(v)).toBe(before.steps + 1);
    const list = drawn(v);
    expect(list.count).toBe(before.count + 2);
    expect(Array.from(list.targets.slice(7))).toEqual([1, 1]);
    expect(Array.from(list.entities!.slice(7))).toEqual([1, 1]);
    expect(Array.from(list.compartments!.slice(7))).toEqual([1, 1]);
    expect(Array.from(xyz(list, 7)).map((x) => +x.toFixed(3))).toEqual([-10, 0, 0]);
    expect(Array.from(xyz(list, 8)).map((x) => +x.toFixed(3))).toEqual([50, 0, 0]);
    expect(strokes(v)[0].grow).toMatchObject({ mode: 'crystal', source: { index: 2, key: 2 } });

    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(before.count);
    expectOk(await v.api.run('history.redo', {}));
    expect(drawn(v).count).toBe(before.count + 2);
  });

  it('puts the copies by the source as drawn in a list moved, scaled and offset: a lattice of a in Å, the source a point of it', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0)), Mat4.rotY90);
    await v.plugin.build().to(ref).insert(ParticleListTransform, { transform: m, scale: 2 }).commit();
    const move = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => c.transform.transformer === ParticleListTransform,
    )!;
    // all of CA's kind 5 Å along their own z, after the move (Offset all like it)
    await v.plugin
      .build()
      .to(move.transform.ref)
      .insert(ParticleListOffsets, {
        offsets: [{ targets: [1], translation: Vec3.create(0, 0, 5), euler: Vec3() }],
        instances: [],
      })
      .commit();
    const src = xyz(drawn(v), 2);
    const turn = quat(drawn(v), 2);
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'crystal',
        a: 30,
        b: 30,
        c: 30,
        na: 3,
        nb: 1,
        nc: 1,
      }),
    );
    const list = drawn(v);
    expect(list.count).toBe(9);
    // the drawn copies at the drawn source ∓ a along its own x (Å, not list units), turned as it
    const ax = Vec3.transformQuat(Vec3(), Vec3.create(30, 0, 0), turn);
    expect(Vec3.distance(xyz(list, 7), Vec3.sub(Vec3(), src, ax))).toBeLessThan(1e-3);
    expect(Vec3.distance(xyz(list, 8), Vec3.add(Vec3(), src, ax))).toBeLessThan(1e-3);
    expect(Quat.dot(quat(list, 7), turn)).toBeCloseTo(1, 5);
    // a source not at the origin: the move's turn and scale both count
    expect(Vec3.distance(xyz(list, 7), xyz(list, 8))).toBeCloseTo(60, 3);
  });

  it('tiles, fills a sphere (seeded) and walks a fiber of Steps points from the source', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'tiling',
        pattern: 'hex',
        spacing: 20,
        rings: 2,
      }),
    );
    expect(drawn(v).count).toBe(7 + 18);
    expectOk(await v.api.run('history.undo', {}));

    const sphere = { particles: ref, index: 6, mode: 'sphere', count: 12, radius: 40, seed: 4 };
    expectOk(await v.api.run('mesoscale.grow', sphere));
    const a = Array.from(drawn(v).coordinates.slice(21));
    expect(a.length).toBe(36);
    for (let i = 7; i < 19; ++i) expect(Vec3.distance(xyz(drawn(v), i), Vec3.create(60, 0, 0))).toBeLessThan(40.001);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.grow', sphere));
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(a);
    expectOk(await v.api.run('history.undo', {}));

    const fibers = drawn(v).fibers?.count ?? 0;
    // NC without fibers or settings (no radii): 10 Å a point
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 3,
      mode: 'walk',
      steps: 12,
      persistence: 20,
      seed: 2,
    });
    expectOk(r);
    const list = drawn(v);
    expect(list.count).toBe(7 + 12);
    expect(list.fibers!.count).toBe(fibers + 1);
    expect(Vec3.distance(xyz(list, 7), xyz(list, 3))).toBeCloseTo(10, 3);
    for (let i = 8; i < 19; ++i) expect(Vec3.distance(xyz(list, i), xyz(list, i - 1))).toBeCloseTo(10, 3);
    expect(Array.from(list.entities!.slice(7))).toEqual(new Array(12).fill(2));
  });

  it("a walk's own Rise and Twist (paint-refine): its units r apart, each turned t; Rise changed after: the same path, one step, the entity's other fibers as they were", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // a fiber of NC grown first, by the entity's settings (10 Å, no twist): it stays as it is
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'walk', steps: 5, seed: 1 }));
    const other = Array.from(drawn(v).coordinates.slice(21, 36));
    const walk = { particles: ref, index: 3, mode: 'walk', steps: 6, persistence: 0, seed: 2 };
    const r = await v.api.run('mesoscale.grow', { ...walk, rise: 6, twist: 30 });
    expectOk(r);
    const id = (r.value as { id: number }).id;
    let list = drawn(v);
    expect(list.count).toBe(7 + 5 + 6);
    const angle = (a: Quat, b: Quat) => (2 * Math.acos(Math.min(1, Math.abs(Quat.dot(a, b)))) * 180) / Math.PI;
    for (let i = 13; i < 18; ++i) {
      expect(Vec3.distance(xyz(list, i), xyz(list, i - 1))).toBeCloseTo(6, 3);
      expect(angle(quat(list, i), quat(list, i - 1))).toBeCloseTo(30, 3);
    }
    const start = xyz(list, 12);
    const along = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), xyz(list, 17), start));
    const before = steps(v);
    // Rise changed: the same path, its units 4 Å apart, the twist kept; one step
    expectOk(await v.api.run('mesoscale.grown-fiber', { particles: ref, grow: id, rise: 4 }));
    expect(steps(v)).toBe(before + 1);
    list = drawn(v);
    expect(Array.from(list.coordinates.slice(21, 36))).toEqual(other);
    expect(list.count).toBeGreaterThan(7 + 5 + 6);
    expect(Vec3.distance(xyz(list, 12), start)).toBeCloseTo(0, 3);
    for (let i = 13; i < list.count; ++i) {
      const d = Vec3.sub(Vec3(), xyz(list, i), xyz(list, i - 1));
      expect(Vec3.magnitude(d)).toBeCloseTo(4, 3);
      expect(Vec3.dot(Vec3.normalize(d, d), along)).toBeCloseTo(1, 4);
      expect(angle(quat(list, i), quat(list, i - 1))).toBeCloseTo(30, 3);
    }
    // undone: 6 Å again; the grow undone: the fiber gone, nothing to change, no step
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(7 + 5 + 6);
    expectOk(await v.api.run('history.undo', {}));
    const after = steps(v);
    expect(await v.api.run('mesoscale.grown-fiber', { particles: ref, grow: id, twist: 10 })).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    expect(steps(v)).toBe(after);
    expect(Array.from(drawn(v).coordinates.slice(21, 36))).toEqual(other);
  });

  it("reads a grown fiber's rise in effect as its source's (a structure painted: its length along its axis)", async () => {
    const v = await viewer();
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure, particles: '', positions: [0, 0, 0] }));
    const painting = v.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.obj?.label === 'Painting')!;
    const particles = painting.cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', { particles, index: 0, mode: 'walk', steps: 3, seed: 1 });
    expectOk(r);
    const m = v.api.mesoscale!;
    m.growSource.set({ particles, index: 0 });
    const source = m.growSourceState().value!;
    const at = observableState({ particles, grow: (r.value as { id: number }).id });
    const grown = m.grownFiberState(at.asReadonly).value!;
    expect(source.rise).not.toBe(10);
    expect(grown.rise).toBeCloseTo(source.rise, 6);
  });

  it('grows from the source where it is drawn after Move this instance (review S1)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    await v.plugin
      .build()
      .to(ref)
      .insert(ParticleListOffsets, {
        offsets: [],
        instances: [{ index: 2, translation: Vec3.create(0, 50, 0), euler: Vec3() }],
      })
      .commit();
    expect(Array.from(xyz(drawn(v), 2)).map((x) => +x.toFixed(3))).toEqual([20, 50, 0]);
    expectOk(
      await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'crystal', a: 30, na: 3, nb: 1, nc: 1 }),
    );
    expect(Array.from(xyz(drawn(v), 7)).map((x) => +x.toFixed(3))).toEqual([-10, 50, 0]);
    expect(Array.from(xyz(drawn(v), 8)).map((x) => +x.toFixed(3))).toEqual([50, 50, 0]);
  });

  it('refuses a grow of no copy: no step (review S2), and a walk of one point (review N1)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const s = steps(v);
    const one = { particles: ref, index: 2, mode: 'crystal', na: 1, nb: 1, nc: 1 };
    expect(await v.api.run('mesoscale.grow', one)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'tiling', rings: 0 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'walk', steps: 1 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(steps(v)).toBe(s);
    expect(painted(v).length).toBe(0);
  });

  it("walks along the entity's Fiber axis when it is set (review S6)", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'x' }));
    expectOk(
      await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'walk', steps: 3, persistence: 0, seed: 1 }),
    );
    // the source unturned (no rotations): its x along the scene's
    const d = Vec3.sub(Vec3(), xyz(drawn(v), 8), xyz(drawn(v), 7));
    expect(Vec3.dot(Vec3.normalize(d, d), Vec3.create(1, 0, 0))).toBeCloseTo(1, 5);
  });

  it("refuses a bank's unit as a source; a bank fiber painted keeps the source before it (review S3)", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', bank: 'dna' }));
    expectOk(
      await v.api.run('mesoscale.paint', { entity: 'NC', positions: [0, 0, 0, 20, 0, 0], fiber: true, seed: 1 }),
    );
    const unit = drawn(v).count - 1;
    expect(await v.api.run('mesoscale.grow', { particles: ref, index: unit, mode: 'sphere' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    const m = v.api.mesoscale!;
    m.growSource.set({ particles: ref, index: 2 });
    (m as unknown as { growFromLast(list: string): void }).growFromLast(ref);
    expect(m.growSource.value).toEqual({ particles: ref, index: 2 });
  });

  it('keeps a grow in a saved state: opened again, the copies are there', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 5, seed: 1 }));
    const grown = Array.from(drawn(v).coordinates.slice(21));
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(entry(v).cell.transform.ref).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(drawn(v).count).toBe(12);
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(grown);
  });

  it('refuses a particle that is not there, sizes of no copy, too many copies, and a list whose targets come from a class', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'crystal', ...p });
    expect(await grow({ index: 7 })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await grow({ index: -1 })).toMatchObject({ ok: false });
    expect(await grow({ a: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ alpha: 10, beta: 10, gamma: 170 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ na: 100, nb: 100, nc: 100 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ mode: 'tiling', spacing: -1 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ mode: 'sphere', radius: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(painted(v).length).toBe(0);
    await v.plugin.build().to(entry(v).cell).apply(ParticleListTargetsFromAttribute, { attribute: 'class' }).commit();
    expect(await grow({})).toMatchObject({ ok: false, code: 'invalid' });
    expect(painted(v).length).toBe(0);
  });
});

// On a mesh (progress/2026-11-13-grow-mesh.md, Tests: the operation): a file mesh loaded beside the list, the source on
// it.

/** An OBJ of a sphere of `radius` about `center` (an icosphere, detail 3) */
function sphereObj(radius: number, center: Vec3) {
  const { vertices, indices } = Sphere(3);
  const lines: string[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(
      `v ${center[0] + radius * vertices[i]} ${center[1] + radius * vertices[i + 1]} ${center[2] + radius * vertices[i + 2]}`,
    );
  }
  for (let i = 0; i < indices.length; i += 3)
    lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
  return lines.join('\n');
}

/** The mesh's representation (its state ref) and its shape provider */
function meshCells(v: PrismViewer) {
  const cells = Array.from(v.plugin.state.data.cells.values());
  const shape = cells.find((c) => SO.Shape.Provider.is(c.obj))!;
  const repr = cells.find((c) => c.transform.parent === shape.transform.ref)!;
  return { repr: repr.transform.ref, shape };
}

describe('mesoscale.grow on a mesh', () => {
  it('tiles a sphere mesh in the scene: a list moved and scaled, a mesh scaled (in pixels); Count points', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const m = Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0));
    await v.plugin.build().to(ref).insert(ParticleListTransform, { transform: m, scale: 2 }).commit();
    // CA (#2) drawn at (140, 0, 0): on a sphere of 20 Å about (120, 0, 0), a mesh of 5 units scaled by 4
    expectOk(await v.api.load.files({ files: [new File([sphereObj(5, Vec3.create(30, 0, 0))], 'vesicle.obj')] }));
    const { repr, shape } = meshCells(v);
    await v.plugin
      .build()
      .to(shape)
      .update((p: any) => ({ ...p, transforms: [Mat4.fromScaling(Mat4(), Vec3.create(4, 4, 4))] }))
      .commit();
    const before = steps(v);
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 2,
      mode: 'tiling',
      spacing: 6,
      count: 20,
      mesh: 'vesicle.obj',
    });
    expectOk(r);
    expect(r.value).toMatchObject({ count: 19, mode: 'tiling' });
    expect(steps(v)).toBe(before + 1);
    const list = drawn(v);
    expect(list.count).toBe(7 + 19);
    const centre = Vec3.create(120, 0, 0);
    for (let i = 7; i < 26; ++i) {
      expect(Vec3.distance(xyz(list, i), centre)).toBeGreaterThan(20 * 0.99);
      expect(Vec3.distance(xyz(list, i), centre)).toBeLessThan(20.001);
    }
    expect(strokes(v)[0].grow).toMatchObject({ mode: 'tiling', mesh: { ref: repr, label: 'vesicle.obj' } });
  });

  it('walks a fiber and fills a sphere on a mesh (by its state ref), each point on it', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // CA (#2) at (20, 0, 0) on a vesicle of 100 Å about (-80, 0, 0); its rise 10 Å
    expectOk(await v.api.load.files({ files: [new File([sphereObj(100, Vec3.create(-80, 0, 0))], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const centre = Vec3.create(-80, 0, 0);
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, index: 2, mesh: repr, ...p });
    expectOk(await grow({ mode: 'walk', steps: 8, seed: 1 }));
    expect(drawn(v).count).toBe(7 + 8);
    for (let i = 7; i < 15; ++i) expect(Vec3.distance(xyz(drawn(v), i), centre)).toBeCloseTo(100, 0);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await grow({ mode: 'sphere', count: 12, radius: 15, seed: 3 }));
    expect(drawn(v).count).toBe(7 + 12);
    for (let i = 7; i < 19; ++i) {
      expect(Vec3.distance(xyz(drawn(v), i), centre)).toBeCloseTo(100, 0);
      expect(Vec3.distance(xyz(drawn(v), i), Vec3.create(20, 0, 0))).toBeLessThanOrEqual(15.001);
    }
  });

  it('refuses Crystal on a mesh, a mesh not in the scene, and a source off the mesh: no step', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.load.files({ files: [new File([sphereObj(20, Vec3())], 'vesicle.obj')] }));
    const before = steps(v);
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, index: 2, mesh: 'vesicle.obj', ...p });
    const crystal = await grow({ mode: 'crystal' });
    expect(crystal).toMatchObject({ ok: false, code: 'invalid' });
    expect((crystal as { message: string }).message).toMatch(/crystal/i);
    expect(await grow({ mode: 'tiling', mesh: 'nothing.obj' })).toMatchObject({ ok: false, code: 'not-found' });
    // NC (#6) at (60, 0, 0): 40 Å off the sphere
    expect(await grow({ mode: 'tiling', index: 6 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(steps(v)).toBe(before);
    expect(painted(v).length).toBe(0);
  });

  it('keeps the copies without the mesh: the mesh deleted, a saved state opened again', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.load.files({ files: [new File([sphereObj(20, Vec3())], 'vesicle.obj')] }));
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'sphere',
        count: 5,
        seed: 1,
        mesh: 'vesicle.obj',
      }),
    );
    const grown = Array.from(drawn(v).coordinates.slice(21));
    const { shape } = meshCells(v);
    let root = shape.transform.ref;
    for (;;) {
      const parent = v.plugin.state.data.tree.transforms.get(root)!.parent;
      if (parent === v.plugin.state.data.tree.root.ref) break;
      root = parent;
    }
    await v.plugin.build().delete(root).commit();
    expect(Array.from(v.plugin.state.data.cells.values()).some((c) => SO.Shape.Provider.is(c.obj))).toBe(false);
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(grown);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.build().delete(entry(v).cell.transform.ref).commit();
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(Array.from(drawn(v).coordinates.slice(21))).toEqual(grown);
  });

  it('a source set by its right-click grows on the mesh under it, else in space (review S7)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.load.files({ files: [new File([sphereObj(20, Vec3())], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const m = v.api.mesoscale!;
    // CA #2 at (20, 0, 0) on the vesicle; NC #6 at (60, 0, 0) 40 Å off it
    m.setGrowSource({ particles: ref, index: 2 });
    expect(m.growSettings.value.mesh).toBe(repr);
    m.setGrowSource({ particles: ref, index: 6 });
    expect(m.growSettings.value.mesh).toBe(undefined);
  });

  it('paints over a mesh: the pick refined onto it (its mesh named), the copy on it along its normal, one step (review S6)', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([sphereObj(50, Vec3())], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const mesh = sceneMeshes(v.plugin.state.data)[0];
    // the canvas's pick of the mesh (headless: no canvas), the camera on +x
    const plugin = Object.create(v.plugin) as PluginContext;
    Object.defineProperty(plugin, 'canvas3d', {
      value: {
        getLoci: () => ({ loci: ShapeGroup.Loci(mesh.shape, [{ ids: OrderedSet.ofSingleton(0), instance: 0 }]) }),
        camera: { state: { position: Vec3.create(300, 0, 0) } },
      },
    });
    // the mesh is the area's (its grow source's), not the operation's: as `MesoscaleApi.paintMode` does
    const host = pluginPaintHost(plugin, ({ mesh: _mesh, ...params }) => v.api.run('mesoscale.paint', params));
    const point = SurfacePoint();
    Vec3.set(point.position, 50.4, 3, -2);
    Vec3.normalize(point.normal, Vec3.create(1, 0.2, 0));
    host.refine(point, false);
    expect(point.mesh).toBe(repr);
    expect(Vec3.magnitude(point.position)).toBeCloseTo(50, 0);
    const radial = Vec3.normalize(Vec3(), point.position);
    expect(Vec3.dot(point.normal, radial)).toBeGreaterThan(0.999);
    const before = steps(v);
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const r = (await host.paint(
      { particles: '', entity: -1, name: '1CRN', structure },
      { ...DefaultPaintSettings, orient: 'normal', spin: 0 },
      [...point.position],
      [...point.normal],
      1,
      false,
      point.mesh,
    )) as ApiResult<unknown>;
    expectOk(r);
    expect(steps(v)).toBe(before + 1);
    const painted = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => c.transform.transformer === ParticleListPainted && c.transform.parent !== entry(v).cell.transform.ref,
    )!;
    const copy = painted.obj!.data as ParticleList;
    expect(Vec3.magnitude(xyz(copy, copy.count - 1))).toBeCloseTo(50, 0);
    const up = Vec3.transformQuat(Vec3(), Vec3.create(0, 0, 1), quat(copy, copy.count - 1));
    expect(Vec3.dot(up, radial)).toBeGreaterThan(0.999);
  });
});
