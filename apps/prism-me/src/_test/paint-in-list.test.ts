/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { OrderedSet } from '@molstar/core/data/int';
import { lengthAlongAxis, ParticleListPainted } from '@molstar/mesoscale-extension/paint';
import { Particle, type ParticleList, type ParticleTarget } from '@molstar/model/model/particles/particle-list';
import type { PaintHost } from '@molstar/mesoscale-extension/paint-mode';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../extensions.js';

// Painted copies are their list's particles (lane `paint-layer`, round 2; Ludo, 2026-11-10: "a painted copy can be
// edited, and can edit all of the same type"): moved alone or with their kind, decorated, picked and drawn by every
// representation as the list's own. And a structure of the scene paints into a list (Ludo: "The target of the paint is
// a particle list parent"): into a model as a new entity, or into the Painting list of an empty scene.

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
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  return v;
}

const lists = (v: PrismViewer) => v.plugin.managers.particles.hierarchy.current.lists;
/** A list's particles as its first representation draws them (its decorators', the copies with them) */
const drawn = (v: PrismViewer, k = 0) =>
  (lists(v)[k].representations[0].cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData;
const xyz = (l: ParticleList, i: number) => Array.from(l.coordinates.slice(i * 3, i * 3 + 3)).map((x) => +x.toFixed(3));
const steps = (v: PrismViewer) => v.api.history.steps.value.length;
const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';

async function loadCrn(v: PrismViewer) {
  const crn = readFileSync(new URL('../../../../data/examples/1crn.cif', import.meta.url));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif')] }));
  return v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
}

describe('painted copies as their list’s particles', () => {
  it('moves a copy alone (its own instance) and with its kind (an offset of its target)', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 50, 0, 0, 60, 0], seed: 1 }));
    expect(drawn(v).count).toBe(4);
    // the model's particle 0 moved: the copies stay where they were painted
    expectOk(await v.api.run('cryoet.instance', { particles: ref, index: 0, x: 5 }));
    expect(xyz(drawn(v), 2)).toEqual([0, 50, 0]);
    expect(xyz(drawn(v), 3)).toEqual([0, 60, 0]);
    // a copy moved alone: the others as they were
    expectOk(await v.api.run('cryoet.instance', { particles: ref, index: 2, x: 5 }));
    expect(xyz(drawn(v), 2)).not.toEqual([0, 50, 0]);
    expect(xyz(drawn(v), 3)).toEqual([0, 60, 0]);
    // all of its kind: the copies with the file's particles
    const before = [xyz(drawn(v), 1), xyz(drawn(v), 3)];
    expectOk(await v.api.run('cryoet.offset', { particles: ref, targets: '', z: 7 }));
    expect(xyz(drawn(v), 1)).not.toEqual(before[0]);
    expect(xyz(drawn(v), 3)).not.toEqual(before[1]);
  });

  it('draws the copies in a representation added after the stroke, and picks a copy as its list’s particle', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    expectOk(await v.api.run('mesoscale.paint', { entity: '0', positions: [0, 50, 0], seed: 1 }));
    expectOk(await v.api.particles.representation({ type: 'orientation' }));
    for (const r of lists(v)[0].representations) {
      expect((r.cell.obj!.data as unknown as { sourceData: ParticleList }).sourceData.count).toBe(3);
    }
    const explorer = (v.api as unknown as { explorer: { particleOf(loci: unknown): unknown } }).explorer;
    const loci = Particle.Loci(drawn(v), OrderedSet.ofSingleton(2));
    expect(explorer.particleOf(loci)).toMatchObject({ list: lists(v)[0].cell.transform.ref, index: 2 });
  });
});

describe('a structure painted into a list', () => {
  it('paints into a model as a new entity of its name, one step; undo takes both away', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    const s = steps(v);
    const r = await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 });
    expectOk(r);
    expect(steps(v)).toBe(s + 1);
    const d = drawn(v);
    expect(d.count).toBe(3);
    const target = d.targetMapping?.get(d.targets[2]);
    expect(target?.kind).toBe('structure');
    expect(d.getParticleLabel(2).toLowerCase()).toContain('1crn');
    expectOk(await v.api.run('history.undo', {}));
    expect(drawn(v).count).toBe(2);
    expect(drawn(v).targetMapping?.get(drawn(v).targets[0])?.kind).not.toBe('structure');
  });

  it('paints into the Painting list of a scene without one: made in the stroke’s step; undo leaves nothing', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const s = steps(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0, 30, 0, 0], seed: 1 }));
    expect(steps(v)).toBe(s + 1);
    expect(lists(v).length).toBe(1);
    expect(lists(v)[0].cell.obj!.label).toBe('Painting');
    expect(drawn(v).count).toBe(2);
    // a second stroke: the same list, its entity kept
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 30, 0], seed: 2 }));
    expect(lists(v).length).toBe(1);
    expect(drawn(v).count).toBe(3);
    expect(new Set(Array.from(drawn(v).targets)).size).toBe(1);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(lists(v).length).toBe(0);
  });

  it('keeps a structure brush in a saved session: opened again, its copies are drawn', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    const painted = Array.from(v.plugin.state.data.cells.values()).filter(
      (c) => c.transform.transformer === ParticleListPainted,
    );
    expect(painted.length).toBe(1);
    const snapshot = JSON.parse(JSON.stringify(v.plugin.state.data.getSnapshot()));
    await v.plugin.runTask(v.plugin.state.data.setSnapshot(snapshot));
    expect(drawn(v).count).toBe(1);
    expect(drawn(v).targetMapping?.get(drawn(v).targets[0])?.kind).toBe('structure');
  });
});

/** An HIV-like model with entities (CA, NC), made in memory */
const TestModel = PluginStateTransform.BuiltIn({
  name: 'prism-me-test-paint-in-list-model',
  display: { name: 'Test Paint In List Model' },
  from: SO.Root,
  to: SO.Particle.List,
  params: {},
})({
  apply() {
    const data: ParticleList = {
      label: 'HIV',
      count: 2,
      keys: Int32Array.of(0, 1),
      targets: Int32Array.of(0, 1),
      entities: Int32Array.of(0, 1),
      targetInfo: new Map([
        [0, { entity: 0 }],
        [1, { entity: 1 }],
      ]),
      entityInfo: new Map([
        [0, { name: 'CA' }],
        [1, { name: 'NC' }],
      ]),
      coordinates: Float32Array.of(0, 0, 0, 10, 0, 0),
      getParticleLabel: (i) => `${i}`,
      sourceData: { kind: 'test', name: 'test', data: {} },
      customProperties: new CustomProperties(),
      _propertyData: Object.create(null),
    };
    return new SO.Particle.List(data, { label: 'HIV' });
  },
});

// the gate's findings (round 2): ids kept across a decoration, the structure removable, the Painting list moved, a
// structure's entity painted with, its copies drawn once
describe('a structure painted into a list, after the gate', () => {
  it('adds an entity of its id to a model, painted with again as an entity; ids kept by a decoration above', async () => {
    const v = await viewer();
    await v.plugin.build().toRoot().apply(TestModel).commit();
    expectOk(await v.api.particles.representation({ type: 'spacefill' }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 }));
    const d = drawn(v);
    const entity = d.entities![2];
    expect(d.entityInfo?.get(entity)?.name).toBe('1CRN');
    // painted again with that entity (its particles are copies only: review S1); the same structure again: one entity
    expectOk(await v.api.run('mesoscale.paint', { entity: '1CRN', particles: ref, positions: [0, 60, 0], seed: 2 }));
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 70, 0], seed: 3 }));
    expect(new Set(Array.from(drawn(v).entities!.slice(2)))).toEqual(new Set([entity]));
    expect([...drawn(v).entityInfo!.values()].filter((e) => e.name === '1CRN').length).toBe(1);
  });

  it('keeps a structure copy on its target when the list is decorated above it (review M1)', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 }));
    const target = drawn(v).targets[2];
    expectOk(await v.api.run('cryoet.decorate', { with: 'object', object: crn, targets: '', particles: ref }));
    const d = drawn(v);
    expect(d.targets[2]).toBe(target);
    expect(d.targetInfo.get(target)?.name).toBe('1CRN');
  });

  it('draws a structure copy once on a list of spheres: the spheres leave its target out (review S2)', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 }));
    const target = drawn(v).targets[2];
    const tree = v.plugin.state.data.tree;
    const types = lists(v)[0].representations.map(
      (r) => (r.cell.transform.params as { type: { name: string } }).type.name,
    );
    expect(types).toContain('target');
    for (const r of lists(v)[0].representations) {
      if ((r.cell.transform.params as { type: { name: string } }).type.name === 'target') continue;
      const layers = tree.children
        .get(r.cell.transform.ref)
        .toArray()
        .map((c) => tree.transforms.get(c)!.params as { hidden?: number[] });
      expect(layers.some((p) => p.hidden?.includes(target))).toBe(true);
    }
  });

  it('takes the target representation a structure stroke added away with its undo', async () => {
    const v = await viewer();
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    const before = lists(v)[0].representations.length;
    const s = steps(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 }));
    expect(steps(v)).toBe(s + 1);
    expect(lists(v)[0].representations.length).toBe(before + 1);
    expectOk(await v.api.run('history.undo', {}));
    expect(lists(v)[0].representations.length).toBe(before);
    expect(drawn(v).count).toBe(2);
  });

  it('keeps the copies when the structure is removed from the scene (review M2)', async () => {
    const v = await viewer();
    await v.plugin.build().toRoot().apply(TestModel).commit();
    expectOk(await v.api.particles.representation({ type: 'spacefill' }));
    const crn = await loadCrn(v);
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, particles: ref, positions: [0, 50, 0], seed: 1 }));
    await v.plugin.build().delete(crn).commit();
    expect(lists(v)[0].representations.length).toBeGreaterThan(0);
    const d = drawn(v);
    expect(d.count).toBe(3);
    expect(d.targetMapping?.get(d.targets[2])?.kind).toBe('structure');
  });

  it('moves the Painting list with its copies; a later stroke lands where it is painted (review M3)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [10, 20, 30], seed: 1 }));
    const ref = lists(v)[0].cell.transform.ref;
    expectOk(
      await v.api.run('stage.move', {
        target: ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, 0))),
      }),
    );
    expect(xyz(drawn(v), 0)).toEqual([110, 20, 30]);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [10, 20, 30], seed: 2 }));
    expect(xyz(drawn(v), 1)).toEqual([10, 20, 30]);
  });
});

// Ludo, 2026-11-10: "I loaded 2PLV assembly, but it only paint the ASU, it should paint the assembly": a structure
// paints as the scene built it from its model (its assembly, its symmetry), not as the model's asymmetric unit
describe('a structure painted as the scene built it', () => {
  it('paints the structure’s assembly or symmetry, not its asymmetric unit; the model of the same file apart', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const cell = () => v.plugin.state.data.cells.get(crn)!;
    const units = (t: ParticleTarget | undefined) => (t?.kind === 'structure' ? t.structure.units.length : -1);
    await v.plugin
      .build()
      .to(crn)
      .update({
        ...(cell().transform.params as object),
        type: { name: 'symmetry', params: { ijkMin: Vec3.create(-1, -1, -1), ijkMax: Vec3.create(0, 0, 0) } },
      })
      .commit();
    const sceneUnits = (cell().obj!.data as { units: unknown[] }).units.length;
    expect(sceneUnits).toBeGreaterThan(1);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    const d = drawn(v);
    expect(units(d.targetMapping?.get(d.targets[0]))).toBe(sceneUnits);
    // built again as its model: painted with, a structure of its own (its asymmetric unit), the first kept
    await v.plugin
      .build()
      .to(crn)
      .update({ ...(cell().transform.params as object), type: { name: 'model', params: {} } })
      .commit();
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [30, 0, 0], seed: 2 }));
    const e = drawn(v);
    expect(e.targets[1]).not.toBe(e.targets[0]);
    expect(units(e.targetMapping?.get(e.targets[0]))).toBe(sceneUnits);
    expect(units(e.targetMapping?.get(e.targets[1]))).toBe(1);
  });
});

// Ludo, 2026-11-10: "also form a pdb structure I want the Fiber option as well in painitng": a structure brush paints a
// fiber, its units touching along their principal axis, its rise and twist set on its entity of the list it is in
describe('a fiber of a structure', () => {
  const gap = (l: ParticleList, i: number) => Math.hypot(...xyz(l, i + 1).map((x, k) => x - xyz(l, i)[k]));
  it('paints a fiber of touching units; its rise and twist set on its entity, found from the structure', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const radius = (v.plugin.state.data.cells.get(crn)!.obj!.data as { boundary: { sphere: { radius: number } } })
      .boundary.sphere.radius;
    expectOk(
      await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0, 200, 0, 0], fiber: true, seed: 1 }),
    );
    const d = drawn(v);
    // not 10 Å (a structure has no radius): its length along its principal axis (review N4: the rule itself)
    const target = d.targetMapping!.get(d.targets[0])!;
    expect(gap(d, 0)).toBeCloseTo(lengthAlongAxis(target), 1);
    expect(gap(d, 0)).toBeLessThanOrEqual(2 * radius);
    // the brush's entity in the list it paints into (the Painting list here)
    const brush = v.api.mesoscale!.structureBrushState(crn, '').value;
    expect(brush).toEqual({ particles: lists(v)[0].cell.transform.ref, entity: d.entities![0] });
    expect(v.api.mesoscale!.fiberState(brush!.particles, brush!.entity).value?.fibers).toBe(true);
    expectOk(
      await v.api.run('mesoscale.fiber', { particles: brush!.particles, entity: String(brush!.entity), rise: 50 }),
    );
    expect(gap(drawn(v), 0)).toBeCloseTo(50, 1);
  });
});

// the follow-up's gate (the assembly, a structure's fibers): the structure's rise wherever it is read, no bank, one
// entity per build of a structure (named apart), its brush where its strokes go
describe('a structure painted with, after the follow-up gate', () => {
  const gap = (l: ParticleList, i: number) => Math.hypot(...xyz(l, i + 1).map((x, k) => x - xyz(l, i)[k]));
  const structureOf = (v: PrismViewer, crn: string) =>
    ({ kind: 'structure', structure: v.plugin.state.data.cells.get(crn)!.obj!.data }) as ParticleTarget;
  const retype = async (v: PrismViewer, crn: string, type: object) => {
    const cell = v.plugin.state.data.cells.get(crn)!;
    await v.plugin
      .build()
      .to(crn)
      .update({ ...(cell.transform.params as object), type })
      .commit();
  };

  it('keeps its touching rise when its fiber settings change before its first fiber (review M1)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const length = lengthAlongAxis(structureOf(v, crn));
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    const brush = v.api.mesoscale!.structureBrushState(crn, '').value!;
    expect(v.api.mesoscale!.fiberState(brush.particles, brush.entity).value?.rise).toBeCloseTo(length, 3);
    expectOk(
      await v.api.run('mesoscale.fiber', { particles: brush.particles, entity: String(brush.entity), twist: 20 }),
    );
    expectOk(
      await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 50, 0, 200, 50, 0], fiber: true, seed: 2 }),
    );
    expect(gap(drawn(v), 1)).toBeCloseTo(length, 1);
  });

  it('offers and takes no bank of units for a structure (review S3)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    expectOk(
      await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0, 200, 0, 0], fiber: true, seed: 1 }),
    );
    const brush = v.api.mesoscale!.structureBrushState(crn, '').value!;
    expect(v.api.mesoscale!.fiberState(brush.particles, brush.entity).value?.banks).toBe(false);
    const r = await v.api.run('mesoscale.fiber', {
      particles: brush.particles,
      entity: String(brush.entity),
      bank: 'dna',
    });
    expect(r.ok).toBe(false);
  });

  it('is one entity for one build however its params are written; another build named apart (S1, S2, S5)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    await retype(v, crn, { name: 'model', params: {} });
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    await retype(v, crn, { name: 'model', params: { dynamicBonds: false, mergeBySymmetry: false } });
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [30, 0, 0], seed: 2 }));
    await retype(v, crn, {
      name: 'symmetry',
      params: { ijkMin: Vec3.create(-1, -1, -1), ijkMax: Vec3.create(0, 0, 0) },
    });
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [60, 0, 0], seed: 3 }));
    const d = drawn(v);
    expect(d.entities![1]).toBe(d.entities![0]);
    expect(d.entities![2]).not.toBe(d.entities![0]);
    const names = [...d.entityInfo!.values()].map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(d.entityInfo!.get(d.entities![0])?.name).toBe('1CRN');
  });

  it('matches an entry saved without its build as the model (S1)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    await retype(v, crn, { name: 'model', params: {} });
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    const painted = [...v.plugin.state.data.cells.values()].find(
      (c) => c.transform.transformer === ParticleListPainted,
    )!;
    const p = painted.transform.params as { structures: { definition?: unknown }[] };
    await v.plugin
      .build()
      .to(painted.transform.ref)
      .update({ ...p, structures: p.structures.map(({ definition: _, ...x }) => x) })
      .commit();
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [30, 0, 0], seed: 2 }));
    const d = drawn(v);
    expect(d.entities![1]).toBe(d.entities![0]);
  });

  it('makes fibers on Auto once it has one where it paints: the host reads its rise there (S4)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    const host = (v.api.mesoscale!.paintMode as unknown as { host: PaintHost }).host;
    const brush = { particles: '', entity: -1, name: '1CRN', structure: crn };
    expect(host.fiberStep(brush, '')).toBeUndefined();
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    // copies only: no fiber on Auto
    expect(host.fiberStep(brush, '')).toBeUndefined();
    expectOk(
      await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 50, 0, 200, 50, 0], fiber: true, seed: 2 }),
    );
    expect(host.fiberStep(brush, '')).toBeCloseTo(lengthAlongAxis(structureOf(v, crn)), 3);
    // a list it has not painted into: none there
    await v.plugin.build().toRoot().apply(TestModel).commit();
    expect(
      host.fiberStep(brush, lists(v).find((l) => l.cell.transform.transformer === TestModel)!.cell.transform.ref),
    ).toBeUndefined();
  });

  it('reads its brush where its strokes go: a list gone, the Painting list (new N1)', async () => {
    const v = await viewer();
    const crn = await loadCrn(v);
    expectOk(await v.api.run('mesoscale.paint', { structure: crn, positions: [0, 0, 0], seed: 1 }));
    expect(v.api.mesoscale!.structureBrushState(crn, 'gone').value).toEqual(
      v.api.mesoscale!.structureBrushState(crn, '').value,
    );
  });
});
