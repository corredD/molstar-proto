/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { EmptyLoci } from '@molstar/model/model/loci';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
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
    const r = await s.move({
      target: mesh.transform.ref,
      matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0))),
    } as never);
    expectOk(r);
    expect(r.did).toBe('Moved seg.obj.');
    const m = (v.plugin.state.data.cells.get(shape.transform.ref)!.transform.params as any).transforms[0] as Mat4;
    expect(Mat4.getMaxScaleOnAxis(m)).toBeCloseTo(2);
    expect(m[12]).toBeCloseTo(5);
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
