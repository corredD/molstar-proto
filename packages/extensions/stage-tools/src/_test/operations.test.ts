/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Grid } from '@molstar/model/model/volume';
import { EmptyLoci } from '@molstar/model/model/loci';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ParticleListWithTargets } from '@molstar/plugin/state/transforms/particles/ops';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import type { ParticleTargetRepresentationProps } from '@molstar/graphics/repr/particles/representation/target/common';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { menuItems } from '../menu.js';
import { StageToolsExtension } from '../prism-viewer.js';

// The `stage` area on a headless viewer with 1CRN (crambin), from the repository's example data.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** A decorator of a shape that draws it as it is (as a mesh's color by a volume sits between its shape and its drawing) */
const PassThroughShape = PluginStateTransform.BuiltIn({
  name: 'stage-tools-test-pass-through-shape',
  display: { name: 'Pass through (test)' },
  from: SO.Shape.Provider,
  to: SO.Shape.Provider,
  isDecorator: true,
  params: {},
})({
  apply({ a }) {
    return new SO.Shape.Provider(a.data, { label: a.label });
  },
});

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  expectOk(await v.api.load.files({ files: [crn] }));
  return v;
}

/** A viewer with an MRC of 8³ voxels of 10 Å, voxel 0 at (100, 50, 20) Å; the volume's ref */
async function mapViewer() {
  const v = await viewer();
  const n = 8;
  const values = new Float32Array(n * n * n).map((_, i) => (i % 7) + 1);
  const matrix = Mat4.mul(
    Mat4(),
    Mat4.fromTranslation(Mat4(), Vec3.create(100, 50, 20)),
    Mat4.fromUniformScaling(Mat4(), 10),
  );
  const grid: Grid = {
    transform: { kind: 'matrix', matrix },
    cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: 0, max: 0, mean: 0, sigma: 0 },
  };
  expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, values)], 'map.mrc')] }));
  const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
  /** Voxel (1, 0, 0) where it is drawn (the last decorator's grid) */
  const voxel = () => {
    const vol = v.plugin.managers.volume.hierarchy.current.volumes[0];
    const rep = vol.representations[0].cell.transform.parent;
    const data = v.plugin.state.data.cells.get(rep)!.obj!.data as { grid: Grid };
    return Array.from(Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), Grid.getGridToCartesianTransform(data.grid))).map(
      (x) => Math.round(x * 1e3) / 1e3,
    );
  };
  return { v, ref, voxel };
}

describe('a volume scaled (its pixel size)', () => {
  it('scales about the origin, then a move on top; reset to 1; undo and redo', async () => {
    const { v, ref, voxel } = await mapViewer();
    const s = v.api.stage!;
    expect(voxel()).toEqual([110, 50, 20]);
    expectOk(await s.scale({ target: ref, scale: 2 } as never));
    expect(voxel()).toEqual([220, 100, 40]);
    expect(s.scaleOf(ref)).toBe(2);
    expect(await s.scale({ target: ref, scale: 2 } as never)).toMatchObject({ unchanged: true });
    // the move is in Å of the scene, after the scale
    const up = Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 100)));
    expectOk(await s.move({ target: ref, matrix: up } as never));
    expect(voxel()).toEqual([220, 100, 140]);
    expect(s.scaleOf(ref)).toBe(2);
    // the handles: the placement is move × scale, its radius scaled
    const p = s.placementOf(ref)!;
    expect(Array.from(Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), p.matrix))).toEqual([2, 0, 100]);
    // another move after it, composed on the move only
    expectOk(await s.move({ target: ref, matrix: up } as never));
    expect(voxel()).toEqual([220, 100, 240]);
    expect(s.scaleOf(ref)).toBe(2);
    expectOk(await s.scale({ target: ref, scale: 1 } as never));
    expect(voxel()).toEqual([110, 50, 220]);
    expectOk(await v.api.run('history.undo', {}));
    expect(voxel()).toEqual([220, 100, 240]);
    expectOk(await v.api.run('history.redo', {}));
    expect(voxel()).toEqual([110, 50, 220]);
  });

  it("scales a volume's labels with it, in the same step", async () => {
    const { v, ref } = await mapViewer();
    const s = v.api.stage!;
    expectOk(await v.api.run('stage.label', { text: 'one', target: ref, x: 100, y: 50, z: 20 }));
    const steps = v.api.history.steps.value.length;
    expectOk(await s.scale({ target: ref, scale: 2 } as never));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expect(s.labelsState().value[0].position.map((x) => Math.round(x))).toEqual([200, 100, 40]);
  });
});

describe('stage', () => {
  it("offers what fits the pick in its menu; a cut (Prism's) adds nothing to it", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const target = {
      ref: v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref,
      label: '1CRN',
      kind: 'structure' as const,
    };
    const ids = async (pick: Parameters<typeof menuItems>[2]['pick']) =>
      (await menuItems(v.api, s, { x: 0, y: 0, pick, loci: EmptyLoci, focus: () => {} })).map((i) => i.id);
    expect(await ids({ kind: 'nothing' })).toEqual(['reset-camera']);
    expect(await ids({ kind: 'target', target })).toEqual(['focus']);
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: `#${target.ref}` }));
    expect(v.api.clipping.cuts.value).toHaveLength(1);
    expect(await ids({ kind: 'nothing' })).toEqual(['reset-camera']);
    expect(await ids({ kind: 'target', target })).toEqual(['focus']);
  });

  it('adds a label in front of an object, changes, hides and removes it (a state transform: saved, undone)', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await s.label({ text: 'crambin', target: ref, node: `o:${ref}` } as never));
    const read = () => s.labelsState().value;
    expect(read()).toMatchObject([{ text: 'crambin', target: ref, node: `o:${ref}`, visible: true }]);
    const label = read()[0].ref;
    // drawn by a shape representation under it (its text is drawn in a page: headless has no canvas for the font)
    const reprs = v.plugin.state.data.tree.children.get(label).toArray();
    expect(reprs.map((r) => v.plugin.state.data.cells.get(r)!.transform.transformer.id)).toEqual([
      ShapeRepresentation3D.id,
    ]);
    expectOk(await s.editLabel({ label, text: 'plant seed protein', size: 8 } as never));
    expect(read()[0]).toMatchObject({ text: 'plant seed protein', size: 8 });
    expectOk(await s.editLabel({ label, visible: false } as never));
    expect(read()[0].visible).toBe(false);
    expect(await s.editLabel({ label, visible: false } as never)).toMatchObject({ unchanged: true });
    expectOk(await v.api.run('history.undo', {}));
    expect(read()[0].visible).toBe(true);
    expectOk(await s.editLabel({ label, remove: true } as never));
    expect(read()).toEqual([]);
    expect(await s.label({ text: 'nowhere' } as never)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('moves a structure and a particle list, their clips and labels with them, in one step each', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0];
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const up = Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 100)));
    // the structure: its atoms 100 Å up
    const z0 = structure.cell.obj!.data.boundary.sphere.center[2];
    expectOk(await s.move({ target: structure.cell.transform.ref, matrix: up } as never));
    // (its transform: a decorator on it, whose structure is the moved one)
    const moved = v.plugin.managers.structure.hierarchy.current.structures[0].transform!.cell.obj!.data;
    expect(moved.boundary.sphere.center[2]).toBeCloseTo(z0 + 100, 3);
    // the list, with a cut of it and a label of it
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: `#${list}` }));
    expectOk(await s.label({ text: 'here', target: list, x: 15, y: 0, z: 0 } as never));
    const cutZ = () => v.api.clipping.cuts.value[0].object.position[2];
    const before = cutZ();
    expectOk(await s.move({ target: list, matrix: up } as never));
    const data = v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData;
    expect(Array.from(data.coordinates.slice(0, 3))).toEqual([10, 0, 100]);
    expect(cutZ()).toBeCloseTo(before + 100, 3);
    expect(s.labelsState().value[0].position).toEqual([15, 0, 100]);
    // one step: undone at once (the list, its cut and its label back)
    expectOk(await v.api.run('history.undo', {}));
    expect(s.labelsState().value[0].position).toEqual([15, 0, 0]);
    expect(cutZ()).toBeCloseTo(before, 3);
    // a second move composes with the first
    expectOk(await s.move({ target: list, matrix: up } as never));
    expectOk(await s.move({ target: list, matrix: up } as never));
    const twice = v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData;
    expect(twice.coordinates[2]).toBe(200);
    // where its handles take it: the transform so far, its center as loaded
    const placed = s.placementOf(list)!;
    expect(placed.matrix[14]).toBeCloseTo(200);
    // (its bounds' center: about the middle of its two particles)
    expect(placed.center[0]).toBeGreaterThan(10);
    expect(placed.center[0]).toBeLessThan(20);
    expect(placed.center[2]).toBeCloseTo(0, 3);
  });

  it('draws a decorated list moved while dragged (the target representation takes the transform), then back', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n80 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const listRef = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    // decorated with 1CRN: a target representation
    await v.plugin
      .build()
      .to(listRef)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crn } } }] })
      .apply(ParticlesRepresentation3D, {
        type: { name: 'target', params: {} },
        colorTheme: { name: 'uniform', params: {} },
        sizeTheme: { name: 'uniform', params: {} },
      } as never)
      .commit();
    const target = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as any).type.name === 'target',
    )!;
    const ros = () => target.cell.obj!.data.repr.renderObjects;
    expect(ros().length).toBeGreaterThan(0);
    const m = Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 50));
    s.previewMove(listRef, m);
    for (const ro of ros()) expect(Mat4.areEqual(ro.values.matrix.ref.value, m, 1e-6)).toBe(true);
    s.previewMove(listRef, Mat4.identity());
    for (const ro of ros()) expect(Mat4.isIdentity(ro.values.matrix.ref.value)).toBe(true);
  });

  it("clips a decorated list's objects whole, or its elements (atoms) whole, in one step", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n80 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    // nothing to set before it is decorated (no objects drawn)
    expect(s.clipWholeState(list).value).toBeUndefined();
    expect(await v.api.run('stage.clipWhole', { particles: list, whole: 'instance' })).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    await v.plugin
      .build()
      .to(list)
      .apply(ParticleListWithTargets, { targets: [{ targetId: 0, source: { name: 'ref', params: { ref: crn } } }] })
      .apply(ParticlesRepresentation3D, {
        type: { name: 'target', params: {} },
        colorTheme: { name: 'uniform', params: {} },
        sizeTheme: { name: 'uniform', params: {} },
      } as never)
      .commit();
    const params = () =>
      (
        v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
          (r) => (r.cell.transform.params as { type: { name: string } }).type.name === 'target',
        )!.cell.transform.params as { type: { params: ParticleTargetRepresentationProps } }
      ).type.params;
    // as made: cut through (neither the objects nor the atoms whole)
    expect(s.clipWholeState(list).value).toBe('pixel');
    expectOk(await v.api.run('stage.clipWhole', { particles: list, whole: 'instance' }));
    expect(params().clip.variant).toBe('instance');
    expect(s.clipWholeState(list).value).toBe('instance');
    expect(await v.api.run('stage.clipWhole', { particles: list, whole: 'instance' })).toMatchObject({
      unchanged: true,
    });
    expectOk(await v.api.run('stage.clipWhole', { particles: list, whole: 'element' }));
    expect(params().clip.variant).toBe('pixel');
    expect(params().structure.clipPrimitive).toBe(true);
    expect(s.clipWholeState(list).value).toBe('element');
    // one step each
    expectOk(await v.api.run('history.undo', {}));
    expect(params().clip.variant).toBe('instance');
    // Atoms, then a graded way sets the variant to instance (clipping.settings, on the cut ones): the list reads Proteins with
    // clipPrimitive hidden, and the next Proteins is not refused as already (A6)
    expectOk(await v.api.run('stage.clipWhole', { particles: list, whole: 'element' }));
    const rep = v.plugin.managers.particles.hierarchy.current.lists[0].representations.find(
      (r) => (r.cell.transform.params as { type: { name: string } }).type.name === 'target',
    )!.cell;
    const rp = rep.transform.params as { type: { params: ParticleTargetRepresentationProps } };
    await v.plugin
      .build()
      .to(rep)
      .update({
        ...rp,
        type: { ...rp.type, params: { ...rp.type.params, clip: { ...rp.type.params.clip, variant: 'instance' } } },
      } as never)
      .commit();
    expect(params().structure.clipPrimitive).toBe(true);
    expect(s.clipWholeState(list).value).toBe('instance');
    expectOk(await v.api.run('stage.clipWhole', { particles: list, whole: 'instance' }));
    expect(params().structure.clipPrimitive).toBe(false);
    expect(s.clipWholeState(list).value).toBe('instance');
  });

  it('moves a mesh (its shape, its scale kept), named by its file', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';
    expectOk(await v.api.load.files({ files: [new File([obj], 'seg.obj')] }));
    // the mesh's shape representation, the one from seg.obj (1CRN's unit cell is a shape too)
    const { cells, tree } = v.plugin.state.data;
    const fileOf = (ref: string): string => {
      let r = ref;
      while (
        tree.transforms.get(r)?.parent &&
        tree.transforms.get(r)!.parent !== r &&
        cells.get(tree.transforms.get(r)!.parent)?.obj?.type.name !== 'Root'
      ) {
        r = tree.transforms.get(r)!.parent;
      }
      return cells.get(r)?.obj?.label ?? '';
    };
    const mesh = Array.from(cells.values()).find(
      (c) => SO.Shape.Representation3D.is(c.obj) && fileOf(c.transform.ref) === 'seg.obj',
    )!;
    const shape = v.plugin.state.data.cells.get(mesh.transform.parent)!;
    // a scale first (a mesh in pixels), then a move: composed
    await v.plugin
      .build()
      .to(shape)
      .update((p: any) => ({ ...p, transforms: [Mat4.fromScaling(Mat4(), Vec3.create(2, 2, 2))] }))
      .commit();
    // a clip on it (a shape keeps its clip at `clip`, not under `type.params`): moved with it
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: `#${mesh.transform.ref}` }));
    const cut = () => Array.from(v.api.clipping.cuts.value[0].object.position);
    const cut0 = cut();
    const r = await s.move({
      target: mesh.transform.ref,
      matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0))),
    } as never);
    expectOk(r);
    expect(r.did).toBe('Moved seg.obj.');
    const m = (v.plugin.state.data.cells.get(shape.transform.ref)!.transform.params as any).transforms[0] as Mat4;
    expect(Mat4.getMaxScaleOnAxis(m)).toBeCloseTo(2);
    expect(m[12]).toBeCloseTo(5);
    cut().forEach((x, i) => expect(x).toBeCloseTo(cut0[i] + (i === 0 ? 5 : 0), 4));
  });

  it("moves a mesh drawn through a decorator of its shape (a mesh colored by a volume): its shape's transform", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    expectOk(await v.api.load.files({ files: [new File(['v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n'], 'seg.obj')] }));
    const mesh = Array.from(v.plugin.state.data.cells.values()).find(
      (c) => SO.Shape.Representation3D.is(c.obj) && c.obj.label !== 'Unit Cell' && !c.state.isGhost,
    )!;
    const shape = mesh.transform.parent;
    await v.plugin.build().to(shape).insert(PassThroughShape, {}).commit();
    const decorator = v.plugin.state.data.cells.get(mesh.transform.ref)!.transform.parent;
    expect(decorator).not.toBe(shape);
    expect(s.placementOf(mesh.transform.ref)).toBeDefined();
    expectOk(
      await s.move({
        target: mesh.transform.ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0))),
      } as never),
    );
    const m = (v.plugin.state.data.cells.get(shape)!.transform.params as any).transforms[0] as Mat4;
    expect(m[12]).toBeCloseTo(5);
    expect(v.plugin.state.data.cells.get(decorator)!.transform.params).toEqual({});
    expect(s.placementOf(mesh.transform.ref)!.matrix[12]).toBeCloseTo(5);
  });

  it("runs from ⌘K: 'label A:10' labels the residue; an object's label needs no selection", async () => {
    const v = await viewer();
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const open = (tail?: string) => {
      const opened = v.managers.commands.open('stage.label', tail);
      if (opened.kind !== 'form') throw new Error(opened.kind);
      return opened.invocation;
    };
    const residue = open('A:10');
    expect(residue.state.value.missing).toEqual([]);
    await residue.confirm();
    expect(v.api.stage!.labelsState().value.map((l) => l.text)).toEqual(['ARG 10 (A)']);
    const object = open();
    object.set('target', ref);
    object.set('text', 'crambin');
    expect(object.state.value.missing).toEqual([]);
    await object.confirm();
    expect(v.api.stage!.labelsState().value.map((l) => l.text)).toEqual(['ARG 10 (A)', 'crambin']);
  });

  it('sizes a label to the part it names (its radius) and to its object, in half-Å steps', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    const object = s.objectBounds(ref)!.radius;
    const at = { text: 'x', target: ref, node: `o:${ref}`, x: 1, y: 2, z: 3 };
    const added = async (values: Record<string, unknown>) => {
      const r = await v.api.run('stage.label', { ...at, ...values });
      expectOk(r);
      return s.labelsState().value.find((l) => l.ref === r.changed.nodes![0])!;
    };
    // a part about 17.6 Å across: about half of it; at a point clicked on it, in front of it by its height
    expect(await added({ radius: 17.6 })).toMatchObject({ size: 9, depth: 9 });
    // a small part of a big object: at least a 15th of the object's, at least 2 Å
    expect((await added({ radius: 1 })).size).toBe(Math.round(Math.max(2, object / 15) * 2) / 2);
    // its place given: kept
    expect(await added({ radius: 17.6, depth: 17.6 })).toMatchObject({ size: 9, depth: 17.6 });
    // no part: as before (a 12th of its object, at the point)
    expect(await added({})).toMatchObject({ size: Math.max(2, object / 12), depth: 0 });
    // a small part of a list 1000 Å across: a 15th of the list, over the part's half and the 2 Å floor
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n0 0 0\n1000 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'wide.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const wide = s.objectBounds(list)!.radius;
    expect(wide / 15).toBeGreaterThan(10);
    const onList = { text: 'y', target: list, node: `o:${list}`, x: 0, y: 0, z: 0 };
    const big = await v.api.run('stage.label', { ...onList, radius: 10 });
    expectOk(big);
    const sized = (ref: string) => s.labelsState().value.find((l) => l.ref === ref)!;
    expect(sized(big.changed.nodes![0]).size).toBe(Math.round((wide / 15) * 2) / 2);
    const plain = await v.api.run('stage.label', onList);
    expectOk(plain);
    expect(sized(plain.changed.nodes![0]).size).toBeCloseTo(wide / 12, 6);
  });

  it("sets a label's plate and tether, on its representation too (a text's plate is drawn by its props)", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const ref = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await s.label({ text: 'crambin', target: ref } as never));
    const label = s.labelsState().value[0].ref;
    expect(s.labelsState().value[0]).toMatchObject({ background: true, tether: false });
    expectOk(
      await s.editLabel({
        label,
        background: true,
        backgroundColor: '#336699',
        backgroundOpacity: 0.3,
        tether: true,
        tetherLength: 2,
      } as never),
    );
    expect(s.labelsState().value[0]).toMatchObject({
      backgroundColor: 0x336699,
      backgroundOpacity: 0.3,
      tether: true,
      tetherLength: 2,
    });
    const repr = v.plugin.state.data.tree.children.get(label).toArray()[0];
    const props = v.plugin.state.data.cells.get(repr)!.transform.params as any;
    expect(props).toMatchObject({ backgroundColor: 0x336699, backgroundOpacity: 0.3, tether: true, tetherLength: 2 });
    expect(props.attachment).toBe('bottom-left');
    expectOk(await s.editLabel({ label, background: false } as never));
    expect((v.plugin.state.data.cells.get(repr)!.transform.params as any).background).toBe(false);
  });

  it("scales a particle list's positions (Å per unit), kept by a move, one step each", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const first = () =>
      Array.from(
        v.plugin.managers.particles.hierarchy.current.lists[0].representations[0].cell.obj!.data.sourceData.coordinates.slice(
          0,
          3,
        ),
      ).map((x) => Math.round(x * 1e3) / 1e3);
    expectOk(await s.scale({ target: list, scale: 4 } as never));
    expect(first()).toEqual([40, 0, 0]);
    expect(s.scaleOf(list)).toBe(4);
    expect(await s.scale({ target: list, scale: 4 } as never)).toMatchObject({ unchanged: true });
    // a move after it keeps it
    const up = Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 100)));
    expectOk(await s.move({ target: list, matrix: up } as never));
    expect(first()).toEqual([40, 0, 100]);
    expect(s.scaleOf(list)).toBe(4);
    // the move undone, then the scale
    expectOk(await v.api.run('history.undo', {}));
    expect(first()).toEqual([40, 0, 0]);
    expectOk(await v.api.run('history.undo', {}));
    expect(first()).toEqual([10, 0, 0]);
    // not a list: refused
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expect(await s.scale({ target: crn, scale: 2 } as never)).toMatchObject({ ok: false });
  });

  it("scales a list's labels and clips with its positions, in the same step", async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    expectOk(await v.api.run('stage.label', { text: 'one', target: list, x: 10, y: 0, z: 0 }));
    expectOk(await v.api.run('clipping.add', { shape: 'plane', node: `#${list}` }));
    const label = () => s.labelsState().value[0].position.map((x) => Math.round(x * 1e3) / 1e3);
    const cut = () => Array.from(v.api.clipping.cuts.value[0].object.position);
    const cut0 = cut();
    const steps = v.api.history.steps.value.length;
    expectOk(await s.scale({ target: list, scale: 4 } as never));
    expect(v.api.history.steps.value.length).toBe(steps + 1);
    expect(label()).toEqual([40, 0, 0]);
    cut().forEach((x, i) => expect(x).toBeCloseTo(cut0[i] * 4, 4));
    // then 2 (from 4): halved
    expectOk(await s.scale({ target: list, scale: 2 } as never));
    expect(label()).toEqual([20, 0, 0]);
    expectOk(await v.api.run('history.undo', {}));
    expectOk(await v.api.run('history.undo', {}));
    expect(label()).toEqual([10, 0, 0]);
    cut().forEach((x, i) => expect(x).toBeCloseTo(cut0[i], 4));
  });

  it('places a structure and a scaled particle list at a pose (center, Euler turn), read back, one step each', async () => {
    const v = await viewer();
    const s = v.api.stage!;
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const crn = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
    expectOk(await s.scale({ target: list, scale: 2 } as never));
    for (const target of [crn, list]) {
      expectOk(await s.pose({ target, x: 1, y: 2, z: 3, ex: 30, ey: -45, ez: 120 } as never));
      const pose = s.poseState(target).value!;
      pose.position.forEach((x, i) => expect(x).toBeCloseTo([1, 2, 3][i], 3));
      pose.euler.forEach((x, i) => expect(x).toBeCloseTo([30, -45, 120][i], 3));
    }
    // the list's scale kept; its pose undone at once
    expect(s.scaleOf(list)).toBe(2);
    expectOk(await v.api.run('history.undo', {}));
    s.poseState(list).value!.euler.forEach((x) => expect(x).toBeCloseTo(0, 3));
  });
});
