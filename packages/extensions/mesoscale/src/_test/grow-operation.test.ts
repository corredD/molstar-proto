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
import { DefaultGrowSettings, growParams } from '../operations.js';
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

  it('a walk of an entity with fibers takes the rise its fibers are drawn with, not their measured step (round 2)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'walk', steps: 8, seed: 1 }));
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'walk', steps: 20, seed: 2 }));
    // its path's points 10 Å apart (the entity's rise), not the first fiber's step as the drawn list's floats measure it
    const ps = strokes(v)[1].positions;
    for (let i = 1; i < ps.length / 3; ++i) {
      const d = Math.hypot(ps[i * 3] - ps[i * 3 - 3], ps[i * 3 + 1] - ps[i * 3 - 2], ps[i * 3 + 2] - ps[i * 3 - 1]);
      expect(d).toBeCloseTo(10, 12);
    }
    expect(drawn(v).count).toBe(7 + 8 + 20);
  });

  it('refuses a grown fiber of more units than a grow makes (review 9): no step', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // 1000 points 50 Å apart: about 50000 Å of path, 100000 units at 0.5 Å
    const walk = { particles: ref, index: 3, mode: 'walk', steps: 1000, rise: 50, seed: 1 };
    const r = await v.api.run('mesoscale.grow', walk);
    expectOk(r);
    const before = steps(v);
    expect(
      await v.api.run('mesoscale.grown-fiber', { particles: ref, grow: (r.value as { id: number }).id, rise: 0.5 }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(steps(v)).toBe(before);
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

  it('a structure painted: a helix made again by the same settings is the same, bit for bit (round 2)', async () => {
    const v = await viewer();
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure, particles: '', positions: [0, 0, 0] }));
    const painting = v.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.obj?.label === 'Painting')!;
    const particles = painting.cell.transform.ref;
    const helix = { particles, index: 0, mode: 'helix', pitch: 60, turns: 3, helixRadius: 30 };
    const r = await v.api.run('mesoscale.grow', helix);
    expectOk(r);
    const path = () =>
      (
        Array.from(v.plugin.state.data.cells.values()).find((c) => c.transform.transformer === ParticleListPainted)!
          .transform.params as { strokes: PaintStroke[] }
      ).strokes.at(-1)!.positions;
    const first = Array.from(path());
    expect(first.length).toBeGreaterThan(0);
    expectOk(await v.api.run('mesoscale.grow', { ...helix, replace: (r.value as { id: number }).id }));
    // its rise the structure's as drawn, not its fiber's step measured on the drawn list: the same path
    expect(Array.from(path())).toEqual(first);
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
function sphereObj(radius: number, center: Vec3, inward = false) {
  const { vertices, indices } = Sphere(3);
  const lines: string[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(
      `v ${center[0] + radius * vertices[i]} ${center[1] + radius * vertices[i + 1]} ${center[2] + radius * vertices[i + 2]}`,
    );
  }
  for (let i = 0; i < indices.length; i += 3)
    lines.push(
      inward
        ? `f ${indices[i] + 1} ${indices[i + 2] + 1} ${indices[i + 1] + 1}`
        : `f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`,
    );
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

  it("a walk on a mesh (paint-refine round 2): its units' up (their offset) along the normal, turned by the twist", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.load.files({ files: [new File([sphereObj(100, Vec3.create(-80, 0, 0))], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const centre = Vec3.create(-80, 0, 0);
    // each unit 5 Å off the path along its up
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'CA', offset: 5 }));
    const walk = { particles: ref, index: 2, mesh: repr, mode: 'walk', steps: 8, seed: 1 };
    // no twist: every unit 5 Å off the surface, on one side
    expectOk(await v.api.run('mesoscale.grow', { ...walk, twist: 0 }));
    const off = (i: number) => Vec3.distance(xyz(drawn(v), i), centre) - 100;
    const side = Math.sign(off(7));
    for (let i = 7; i < 15; ++i) expect(off(i) * side).toBeCloseTo(5, 0);
    expectOk(await v.api.run('history.undo', {}));
    // half a turn a unit: the sides alternate
    expectOk(await v.api.run('mesoscale.grow', { ...walk, twist: 180 }));
    for (let i = 7; i < 15; ++i) expect(off(i) * side * (i % 2 ? 1 : -1)).toBeCloseTo(5, 0);
  });

  it("a walk on a mesh: its units' up on the source's side (its +z), whatever the mesh's winding (review S7)", async () => {
    for (const inward of [false, true]) {
      const v = await viewer();
      const ref = entry(v).cell.transform.ref;
      // CA #2 at (20, 0, 0), unturned (+z up), at the top of a vesicle of 100 Å about (20, 0, -100)
      const centre = Vec3.create(20, 0, -100);
      const obj = sphereObj(100, centre, inward);
      expectOk(await v.api.load.files({ files: [new File([obj], 'vesicle.obj')] }));
      const { repr } = meshCells(v);
      expectOk(await v.api.run('mesoscale.fiber', { entity: 'CA', offset: 5 }));
      const walk = { particles: ref, index: 2, mesh: repr, mode: 'walk', steps: 6, seed: 1, twist: 0 };
      expectOk(await v.api.run('mesoscale.grow', walk));
      for (let i = 7; i < 13; ++i) expect(Vec3.distance(xyz(drawn(v), i), centre) - 100, `${inward}`).toBeCloseTo(5, 0);
      await v.dispose();
      viewers.splice(viewers.indexOf(v), 1);
    }
  });

  it('a copy painted on a tilted mesh and the Tiling and Sphere grown from it share its axis along the normal (round 3)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // a plane through (0, 50, 0), its normal (1, 0, 1)/√2: 400 Å a side, two triangles wound toward the normal
    const n = Vec3.normalize(Vec3(), Vec3.create(1, 0, 1));
    const u = Vec3.create(0, 1, 0);
    const w = Vec3.cross(Vec3(), u, n);
    const c = Vec3.create(0, 50, 0);
    const corner = (a: number, b: number) =>
      Vec3.scaleAndAdd(Vec3(), Vec3.scaleAndAdd(Vec3(), c, w, a * 200), u, b * 200);
    const vs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const obj = `${vs.map((x) => `v ${x[0]} ${x[1]} ${x[2]}`).join('\n')}\nf 1 2 3\nf 1 3 4\n`;
    expectOk(await v.api.load.files({ files: [new File([obj], 'plane.obj')] }));
    const { repr } = meshCells(v);
    // loose (1CRN, not a membrane protein: its principal axis ~47° off +z) painted on it: +z along the normal
    expectOk(
      await v.api.run('mesoscale.paint', { entity: 'loose', positions: [...c], normals: [...n], surface: true }),
    );
    const zAt = (i: number) => Vec3.transformQuat(Vec3(), Vec3.create(0, 0, 1), quat(drawn(v), i));
    expect(Vec3.dot(zAt(7), n)).toBeCloseTo(1, 5);
    for (const params of [
      { mode: 'tiling', spacing: 40, count: 7 },
      { mode: 'sphere', count: 6, radius: 80, seed: 2 },
    ]) {
      expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 7, mesh: repr, ...params }));
      const list = drawn(v);
      expect(list.count, params.mode).toBeGreaterThan(8);
      for (let i = 8; i < list.count; ++i) expect(Vec3.dot(zAt(i), n), `${params.mode} ${i}`).toBeCloseTo(1, 4);
      expectOk(await v.api.run('history.undo', {}));
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

// Grow › Helix (apps/prism-me/progress/2026-11-13-grow-helix.md, Tests): a fiber stroke as the walk's, its path a helix.

describe('mesoscale.grow helix', () => {
  /** The distance from `p` to the line through `at` along z */
  const offZ = (p: Vec3, at: Vec3) => Math.hypot(p[0] - at[0], p[1] - at[1]);

  it("winds a fiber in space about the source's Fiber Axis, Radius away, Pitch a turn; one step, undo and redo", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // NC (#3) at (30, 0, 0), unturned, its Fiber Axis z: the helix about the line along z through (45, 0, 0)
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'z' }));
    const before = steps(v);
    const helix = { particles: ref, index: 3, mode: 'helix', pitch: 40, turns: 3, helixRadius: 15, rise: 5, seed: 1 };
    const r = await v.api.run('mesoscale.grow', helix);
    expectOk(r);
    expect(steps(v)).toBe(before + 1);
    // its count the units drawn, not its path's points (review S2)
    expect((r.value as { count: number }).count).toBe(drawn(v).count - 7);
    const [stroke] = strokes(v);
    expect(stroke).toMatchObject({
      fiber: true,
      grow: { mode: 'helix', params: { pitch: 40, turns: 3, hand: 'right' } },
    });
    // the path: a point of its 5° grid and the one a turn later (72 points) Pitch apart along z (its first, a rise from
    // the source, off the grid)
    const ps = stroke.positions;
    for (let i = 1; i + 72 < ps.length / 3; ++i) {
      expect(ps[(i + 72) * 3 + 2] - ps[i * 3 + 2]).toBeCloseTo(40, 6);
      expect(ps[(i + 72) * 3] - ps[i * 3]).toBeCloseTo(0, 6);
    }
    const list = drawn(v);
    expect(list.count).toBeGreaterThan(7 + 40);
    for (let i = 7; i < list.count; ++i) {
      expect(offZ(xyz(list, i), Vec3.create(45, 0, 0))).toBeCloseTo(15, 1);
      if (i > 7) expect(Vec3.distance(xyz(list, i), xyz(list, i - 1))).toBeCloseTo(5, 1);
    }
    // the first unit a rise along the helix from the source, not on it
    expect(Vec3.distance(xyz(list, 7), Vec3.create(30, 0, 0))).toBeCloseTo(5, 0);
    const count = list.count;
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(7);
    expectOk(await v.api.run('history.redo', {}));
    expect(drawn(v).count).toBe(count);
    // Hand left: the other way about the axis
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('mesoscale.grow', { ...helix, hand: 'left' }));
    expect(xyz(drawn(v), 9)[1] * xyz(list, 9)[1]).toBeLessThan(0);
  });

  it("winds in the scene's Å on a list moved and scaled: Radius and Pitch as drawn (review S4)", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const m = Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0));
    await v.plugin.build().to(ref).insert(ParticleListTransform, { transform: m, scale: 2 }).commit();
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'z' }));
    // NC (#3) drawn at (160, 0, 0); its rise 10 list units, 20 Å drawn
    expect(Vec3.distance(xyz(drawn(v), 3), Vec3.create(160, 0, 0))).toBeLessThan(1e-3);
    const helix = { particles: ref, index: 3, mode: 'helix', pitch: 40, turns: 2, helixRadius: 15 };
    expectOk(await v.api.run('mesoscale.grow', helix));
    const list = drawn(v);
    // the first unit 20 Å along the helix (a chord of 19)
    expect(Vec3.distance(xyz(list, 7), Vec3.create(160, 0, 0))).toBeCloseTo(19, 0);
    for (let i = 7; i < list.count; ++i) {
      expect(offZ(xyz(list, i), Vec3.create(175, 0, 0))).toBeCloseTo(15, 1);
      expect(xyz(list, i)[2]).toBeGreaterThan(0);
      expect(xyz(list, i)[2]).toBeLessThanOrEqual(80 + 1e-3);
    }
    expect(xyz(list, list.count - 1)[2]).toBeGreaterThan(80 - 20);
  });

  it("its params (growParams): Axis on a mesh, Radius in space, the walk's none (review S4)", () => {
    const src = { particles: 'L', index: 1 };
    const s = {
      ...DefaultGrowSettings,
      mode: 'helix' as const,
      pitch: 50,
      helixRadius: 9,
      axis: 'x' as const,
      steps: 7,
    };
    const space = growParams(src, s);
    expect(space).toMatchObject({ mode: 'helix', pitch: 50, turns: 5, hand: 'right', direction: 'up', helixRadius: 9 });
    expect(space).not.toHaveProperty('axis');
    expect(space).not.toHaveProperty('steps');
    const onMesh = growParams(src, { ...s, mesh: 'M' });
    expect(onMesh).toMatchObject({ mesh: 'M', axis: 'x', pitch: 50 });
    expect(onMesh).not.toHaveProperty('helixRadius');
    expect(growParams(src, { ...s, mode: 'walk', mesh: 'M' })).not.toHaveProperty('axis');
  });

  it("a helix's own Rise live (paint-refine's grown fiber): the same path, its units r apart, one step", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.fiber', { entity: 'NC', axis: 'z' }));
    const r = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 3,
      mode: 'helix',
      pitch: 40,
      turns: 2,
      helixRadius: 15,
      rise: 5,
    });
    expectOk(r);
    const id = (r.value as { id: number }).id;
    const path = [...strokes(v)[0].positions];
    const count = drawn(v).count;
    const before = steps(v);
    expectOk(await v.api.run('mesoscale.grown-fiber', { particles: ref, grow: id, rise: 2.5 }));
    expect(steps(v)).toBe(before + 1);
    expect(strokes(v)[0].positions).toEqual(path);
    const list = drawn(v);
    expect(list.count - 7).toBeCloseTo(2 * (count - 7), -1);
    for (let i = 7; i < list.count; ++i) expect(offZ(xyz(list, i), Vec3.create(45, 0, 0))).toBeCloseTo(15, 1);
  });

  it('spirals over a vesicle about its axis (Z) to its pole, each unit on it, its normals kept', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    // CA (#2) at (20, 0, 0) on a vesicle of 100 Å about (-80, 0, 0): on its equator about z
    expectOk(await v.api.load.files({ files: [new File([sphereObj(100, Vec3.create(-80, 0, 0))], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const centre = Vec3.create(-80, 0, 0);
    const grow = (p: object) =>
      v.api.run('mesoscale.grow', { particles: ref, index: 2, mesh: repr, mode: 'helix', rise: 10, ...p });
    expectOk(await grow({ pitch: 30, turns: 10, axis: 'z' }));
    const [stroke] = strokes(v);
    expect(stroke.normals?.length).toBe(stroke.positions.length);
    expect(stroke.grow).toMatchObject({ mode: 'helix', params: { axis: 'z' }, mesh: { ref: repr } });
    const list = drawn(v);
    // on its faces (an icosphere of detail 3: within 0.3 Å of the sphere) or their chords of 5°
    for (let i = 7; i < list.count; ++i) {
      expect(Vec3.distance(xyz(list, i), centre)).toBeGreaterThan(99.4);
      expect(Vec3.distance(xyz(list, i), centre)).toBeLessThan(100.001);
    }
    // up to the north pole, not past it: some 3⅓ turns of the 10
    expect(xyz(list, list.count - 1)[2]).toBeGreaterThan(90);
    // undo and redo on a mesh (review S4): the same units again
    const units = Array.from(list.coordinates);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(7);
    expectOk(await v.api.run('history.redo', {}));
    expect(Array.from(drawn(v).coordinates)).toEqual(units);
    // the source on the axis (X through the vesicle's center): refused, no step
    const s = steps(v);
    expect(await grow({ pitch: 30, turns: 2, axis: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(steps(v)).toBe(s);
  });

  it('refuses more than 200 turns, and a helix on a mesh of more units than a grow makes, before it is all made (review M1)', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.load.files({ files: [new File([sphereObj(100, Vec3.create(-80, 0, 0))], 'vesicle.obj')] }));
    const { repr } = meshCells(v);
    const grow = (p: object) =>
      v.api.run('mesoscale.grow', { particles: ref, index: 2, mesh: repr, mode: 'helix', axis: 'z', ...p });
    const s = steps(v);
    expect(await grow({ turns: 201 })).toMatchObject({ ok: false, code: 'invalid' });
    // a spiral of 1 Å a turn over the vesicle's half (some 31000 Å) at 0.1 Å a unit
    const t0 = Date.now();
    const r = await grow({ turns: 200, pitch: 1, rise: 0.1 });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(r.ok ? '' : r.message).toContain('a grow makes 20000 at most');
    expect(steps(v)).toBe(s);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('refuses a pitch, turns or radius of no helix, and more units than a grow makes: no step', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'helix', ...p });
    const s = steps(v);
    expect(await grow({ pitch: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ turns: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ helixRadius: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grow({ turns: 200, helixRadius: 1000, rise: 0.5 })).toMatchObject({ ok: false, code: 'invalid' });
    // a helix of one unit or none, shorter than two rises (review New 1): its rise named
    for (const rise of [20, 30]) {
      const r = await grow({ turns: 0.25, pitch: 40, helixRadius: 15, rise });
      expect(r).toMatchObject({ ok: false, code: 'invalid' });
      expect(r.ok ? '' : r.message).toContain('rise');
    }
    expect(steps(v)).toBe(s);
    expect(painted(v).length).toBe(0);
  });
});

// The last grow live (grow-helix round 2, Ludo 2026-11-13: "all the parameters … update the latest grow"): a grow given
// `replace` (a grow's id) makes that grow's stroke again by its params, in place, one step; its seed kept unless given.

describe('mesoscale.grow replace', () => {
  const poses = (l: ParticleList, from: number, to: number) => ({
    positions: Array.from(l.coordinates.slice(from * 3, to * 3)),
    rotations: Array.from(l.rotations!.slice(from * 4, to * 4)),
  });

  it('makes a sphere again with more copies (the first ones where they were), then fewer, one step each', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 10, radius: 30 });
    expectOk(r);
    const id = (r.value as { id: number }).id;
    const first = poses(drawn(v), 7, 17);
    const before = steps(v);
    const more = await v.api.run('mesoscale.grow', {
      particles: ref,
      index: 2,
      mode: 'sphere',
      count: 25,
      radius: 30,
      replace: id,
    });
    expectOk(more);
    expect((more.value as { id: number }).id).toBe(id);
    expect(steps(v)).toBe(before + 1);
    expect(strokes(v).length).toBe(1);
    expect(drawn(v).count).toBe(7 + 25);
    // its seed kept: the first ten bit for bit
    expect(poses(drawn(v), 7, 17)).toEqual(first);
    expectOk(
      await v.api.run('mesoscale.grow', {
        particles: ref,
        index: 2,
        mode: 'sphere',
        count: 4,
        radius: 30,
        replace: id,
      }),
    );
    expect(drawn(v).count).toBe(7 + 4);
    expect(poses(drawn(v), 7, 11)).toEqual({
      positions: first.positions.slice(0, 12),
      rotations: first.rotations.slice(0, 16),
    });
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(7 + 25);
  });

  it('continues a walk with more steps (its units where they were, the last one turned to the next) and changes its mode in place', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const walk = { particles: ref, index: 3, mode: 'walk', steps: 8, persistence: 30, twist: 15 };
    const r = await v.api.run('mesoscale.grow', walk);
    expectOk(r);
    const id = (r.value as { id: number }).id;
    const first = poses(drawn(v), 7, 15);
    expectOk(await v.api.run('mesoscale.grow', { ...walk, steps: 20, replace: id }));
    expect(drawn(v).count).toBe(7 + 20);
    const now = poses(drawn(v), 7, 15);
    expect(now.positions).toEqual(first.positions);
    expect(now.rotations.slice(0, -4)).toEqual(first.rotations.slice(0, -4));
    // another mode: the same grow, now a sphere
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'sphere', count: 5, replace: id }));
    expect(strokes(v).length).toBe(1);
    expect(strokes(v)[0].grow).toMatchObject({ mode: 'sphere', id });
    expect(drawn(v).count).toBe(7 + 5);
  });

  it('refuses a grow that is not there or is of another source: no step', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const r = await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 3 });
    expectOk(r);
    const id = (r.value as { id: number }).id;
    const s = steps(v);
    expect(
      await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 4, replace: id + 1 }),
    ).toMatchObject({ ok: false, code: 'not-found' });
    expect(
      await v.api.run('mesoscale.grow', { particles: ref, index: 3, mode: 'sphere', count: 4, replace: id }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(steps(v)).toBe(s);
  });
});

// Clear (grow-helix round 2, Ludo 2026-11-13: "a clear button, that will clear all growth from that instance").

describe('mesoscale.clear-grown', () => {
  it('removes every grow from the source (any mode), one step; the source and the other grows stay; redo clears again', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, ...p });
    expectOk(await grow({ index: 2, mode: 'sphere', count: 4 }));
    expectOk(await grow({ index: 3, mode: 'sphere', count: 3 }));
    expectOk(await grow({ index: 2, mode: 'walk', steps: 5 }));
    expectOk(await grow({ index: 2, mode: 'crystal', na: 2, nb: 1, nc: 1 }));
    const m = v.api.mesoscale!;
    const count = m.grownFromState(observableState({ particles: ref, index: 2 }).asReadonly);
    const sub = count.subscribe(() => undefined);
    expect(count.value).toBe(3);
    const all = drawn(v).count;
    const before = steps(v);
    const r = await v.api.run('mesoscale.clear-grown', { particles: ref, index: 2 });
    expectOk(r);
    expect(steps(v)).toBe(before + 1);
    expect(drawn(v).count).toBe(7 + 3);
    expect(strokes(v).map((s) => s.grow?.source.index)).toEqual([3]);
    expect(Array.from(xyz(drawn(v), 2))).toEqual([20, 0, 0]);
    expect(count.value).toBe(0);
    // nothing more to clear: refused, no step
    expect(await v.api.run('mesoscale.clear-grown', { particles: ref, index: 2 })).toMatchObject({ ok: false });
    expect(steps(v)).toBe(before + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(all);
    expect(count.value).toBe(3);
    expectOk(await v.api.run('history.redo', {}));
    expect(drawn(v).count).toBe(7 + 3);
    sub.unsubscribe();
  });

  it('keeps a painted source: the grows from it go, the copy it is stays', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 2, mode: 'sphere', count: 2, seed: 1 }));
    // copy #7 (grown) the next source
    expectOk(await v.api.run('mesoscale.grow', { particles: ref, index: 7, mode: 'sphere', count: 5 }));
    const seven = Array.from(xyz(drawn(v), 7));
    expectOk(await v.api.run('mesoscale.clear-grown', { particles: ref, index: 7 }));
    expect(drawn(v).count).toBe(7 + 2);
    expect(Array.from(xyz(drawn(v), 7))).toEqual(seven);
  });
});

// A grow from a painted copy (round 2 review M1, New 1): a copy's key is its place among the painted copies, so when a
// stroke before it changes its count or goes, the grows from later copies follow their copy (their record's key and
// index); when their copy goes, they go with it.

describe('grows from painted copies when the strokes before them change', () => {
  const sources = (v: PrismViewer) => strokes(v).map((s) => s.grow?.source.index);

  it("Clear: the grows from the cleared grows' copies go too; a grow from a later copy follows it", async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, mode: 'sphere', ...p });
    // G1: #7..#10 from #2; G2: #11..#13 from #3; G3 from #9 (G1's); G4 from #12 (G2's)
    expectOk(await grow({ index: 2, count: 4 }));
    expectOk(await grow({ index: 3, count: 3 }));
    expectOk(await grow({ index: 9, count: 2 }));
    expectOk(await grow({ index: 12, count: 2 }));
    const g4 = Array.from(drawn(v).coordinates.slice(-6));
    expectOk(await v.api.run('mesoscale.clear-grown', { particles: ref, index: 2 }));
    // G1 and G3 gone; G2 now #7..#9, G4 from #8, its copies as they were
    expect(sources(v)).toEqual([3, 8]);
    expect(drawn(v).count).toBe(7 + 3 + 2);
    expect(Array.from(drawn(v).coordinates.slice(-6))).toEqual(g4);
    const m = v.api.mesoscale!;
    expect(m.grownFromState(observableState({ particles: ref, index: 8 }).asReadonly).value).toBe(1);
    expect(m.grownFromState(observableState({ particles: ref, index: 10 }).asReadonly).value).toBe(0);
    expect(await v.api.run('mesoscale.clear-grown', { particles: ref, index: 10 })).toMatchObject({ ok: false });
    expectOk(await v.api.run('mesoscale.clear-grown', { particles: ref, index: 8 }));
    expect(sources(v)).toEqual([3]);
  });

  it('replace: fewer copies take the grows from the cut ones with them; more keep a later grow on its copy', async () => {
    const v = await viewer();
    const ref = entry(v).cell.transform.ref;
    const grow = (p: object) => v.api.run('mesoscale.grow', { particles: ref, mode: 'sphere', ...p });
    const r = await grow({ index: 2, count: 4, seed: 1 });
    expectOk(r);
    const g1 = (r.value as { id: number }).id;
    // G2 from #8 (G1's second), G3 from #11 (G2's first)
    expectOk(await grow({ index: 8, count: 3 }));
    expectOk(await grow({ index: 11, count: 2 }));
    const g3 = Array.from(drawn(v).coordinates.slice(-6));
    // G1 with 6: G2 still from #8; G3's source now #13, its copies as they were
    expectOk(await grow({ index: 2, count: 6, seed: 1, replace: g1 }));
    expect(sources(v)).toEqual([2, 8, 13]);
    expect(Array.from(drawn(v).coordinates.slice(-6))).toEqual(g3);
    expectOk(await grow({ index: 13, count: 3, replace: strokes(v)[2].grow!.id }));
    // G1 with 1: its second copy (G2's source) cut, so G2 and G3 go
    expectOk(await grow({ index: 2, count: 1, seed: 1, replace: g1 }));
    expect(sources(v)).toEqual([2]);
    expect(drawn(v).count).toBe(7 + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(sources(v)).toEqual([2, 8, 13]);
  });
});
