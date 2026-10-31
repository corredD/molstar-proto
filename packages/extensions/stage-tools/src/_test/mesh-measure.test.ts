/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { radToDeg } from '@molstar/core/math/misc';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { Loci } from '@molstar/model/model/loci';
import { Shape, type ShapeGroup } from '@molstar/model/model/shape';
import { StructureElement, StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { isStageDistanceData, StageDistance } from '../distance.js';
import { StageToolsExtension } from '../prism-viewer.js';

// Measurements from a mesh's triangle (apps/prism-me/_spec/ui.md §7; .v6/plans/gl/triangle-picking.md): the point is the
// one picked on the triangle, kept as the triangle and its barycentric weights, so it follows the mesh's moves and
// scales. Between triangles, atoms and particles: distances, angles, dihedrals. On a headless viewer, 1CRN from the
// repository's example data and an OBJ made here.

beforeAll(() => {
  const context = {
    measureText: () => ({ width: 8 }),
    clearRect() {},
    fillText() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  setCanvasModule({ createCanvas: () => ({ getContext: () => context }) });
});
afterAll(() => {
  setCanvasModule(undefined);
  clearFontAtlasCache();
});

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** A 10 Å square at z = 50, two triangles: 0 (0,0) (10,0) (10,10) and 1 (0,0) (10,10) (0,10) */
const square = ['v 0 0 50', 'v 10 0 50', 'v 10 10 50', 'v 0 10 50', 'f 1 2 3', 'f 1 3 4'].join('\n');

async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
  });
  viewers.push(v);
  const crn = readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif'), new File([square], 'square.obj')] }));
  return v;
}

/** The OBJ's representation (its ref) and its shape as drawn now (not 1CRN's unit cell, a shape too) */
function mesh(v: PrismViewer) {
  for (const c of v.plugin.state.data.cells.values()) {
    if (!SO.Shape.Representation3D.is(c.obj) || isStageDistanceData(c.obj.data.sourceData)) continue;
    const l = c.obj.data.repr.getAllLoci().find((x: Loci) => Shape.isLoci(x) && !!x.shape.getTriangleLoci);
    if (l) return { ref: c.transform.ref, shape: (l as Shape.Loci).shape as Shape<Mesh> };
  }
  throw new Error('no mesh');
}

/** A triangle pick on the mesh as drawn now: what the canvas gives */
const triangle = (v: PrismViewer, index: number, uv: [number, number]) =>
  ShapeUtils.triangleLoci(mesh(v).shape, { instance: 0, index, uv }) as ShapeGroup.Loci;

/** The point a triangle pick stands for, where the mesh is now */
const pointOf = (v: PrismViewer, index: number, uv: [number, number]) =>
  Vec3.clone(Loci.getBoundingSphere(triangle(v, index, uv))!.center);

function atom(v: PrismViewer, seq: number) {
  const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const selection = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), seq]),
        'atom-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_atom_id(), 'CA']),
      }),
    structure,
  );
  const loci = StructureSelection.toLociWithSourceUnits(selection);
  return { loci, at: Vec3.clone(StructureElement.Loci.getBoundingSphere(loci).center) };
}

const measured = (v: PrismViewer) => {
  const cell = [...v.plugin.state.data.cells.values()].find((c) => c.transform.transformer === StageDistance)!;
  return { ref: cell.transform.ref, data: cell.obj!.data.sourceData as { value: number }, label: cell.obj!.label };
};

describe('measurements from a mesh triangle', () => {
  it('measures a triangle to an atom from the point picked on it, named by its mesh and triangle', async () => {
    const v = await viewer();
    const ca = atom(v, 10);
    // triangle 0 at u 0.5, v 0.2: (0,0) + 0.5 (10,0) + 0.2 (10,10) = (7, 2, 50)
    const r = await v.api.run('stage.distance', { a: { loci: triangle(v, 0, [0.5, 0.2]) }, b: { loci: ca.loci } });
    expectOk(r);
    const expected = Vec3.distance(Vec3.create(7, 2, 50), ca.at);
    expect((r.value as { distance: number }).distance).toBeCloseTo(expected, 3);
    expect(r.did).toMatch(/square\.obj triangle 0/);
  });

  it('measures two triangles of one mesh, and says the same pair again is measured already', async () => {
    const v = await viewer();
    const a = { loci: triangle(v, 0, [0.5, 0.2]) };
    const b = { loci: triangle(v, 1, [0.1, 0.8]) };
    const r = await v.api.run('stage.distance', { a, b });
    expectOk(r);
    // triangle 1 at u 0.1, v 0.8: (0,0) + 0.1 (10,10) + 0.8 (0,10) = (1, 9, 50)
    expect((r.value as { distance: number }).distance).toBeCloseTo(
      Vec3.distance(Vec3.create(7, 2, 50), Vec3.create(1, 9, 50)),
      4,
    );
    const again = await v.api.run('stage.distance', { a: b, b: a });
    expect(again.ok && again.unchanged).toBe(true);
  });

  it('follows the mesh when it is moved and when it is scaled', async () => {
    const v = await viewer();
    const ca = atom(v, 10);
    expectOk(await v.api.run('stage.distance', { a: { loci: triangle(v, 0, [0.5, 0.2]) }, b: { loci: ca.loci } }));
    const { ref } = mesh(v);
    expectOk(
      await v.api.run('stage.move', {
        target: ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 30))),
      }),
    );
    expect(measured(v).data.value).toBeCloseTo(Vec3.distance(Vec3.create(7, 2, 80), ca.at), 3);
    // scaled 2× about the origin (as cryoet.mesh's scale), on top of the move
    const shapeCell = v.plugin.state.data.cells.get(v.plugin.state.data.cells.get(ref)!.transform.parent)!;
    await v.plugin.state.data
      .build()
      .to(shapeCell)
      .update((p: any) => ({
        ...p,
        transforms: [Mat4.mul(Mat4(), Mat4.fromUniformScaling(Mat4(), 2), p.transforms[0])],
      }))
      .commit();
    expect(measured(v).data.value).toBeCloseTo(Vec3.distance(Vec3.create(14, 4, 160), ca.at), 3);
    expect(pointOf(v, 0, [0.5, 0.2])[2]).toBeCloseTo(160);
  });

  it('keeps measuring from a mesh shown as a wireframe only, and follows its moves then', async () => {
    const v = await viewer();
    const ca = atom(v, 10);
    expectOk(await v.api.run('stage.distance', { a: { loci: triangle(v, 0, [0.5, 0.2]) }, b: { loci: ca.loci } }));
    const { ref } = mesh(v);
    await v.plugin.state.data
      .build()
      .to(ref)
      .update((p: any) => ({ ...p, visuals: ['wireframe'] }))
      .commit();
    expectOk(
      await v.api.run('stage.move', {
        target: ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 30))),
      }),
    );
    const cell = v.plugin.state.data.cells.get(measured(v).ref)!;
    expect(cell.status).toBe('ok');
    expect(measured(v).data.value).toBeCloseTo(Vec3.distance(Vec3.create(7, 2, 80), ca.at), 3);
  });

  it('measures an angle and a dihedral between triangles and atoms, in degrees, as Mol* draws them', async () => {
    const v = await viewer();
    const ca = atom(v, 10);
    const t0 = { loci: triangle(v, 0, [0.5, 0.2]) };
    const t1 = { loci: triangle(v, 1, [0.1, 0.8]) };
    const p0 = Vec3.create(7, 2, 50);
    const p1 = Vec3.create(1, 9, 50);
    const angle = await v.api.run('stage.angle', { a: t0, b: { loci: ca.loci }, c: t1 });
    expectOk(angle);
    const expectedAngle = radToDeg(Vec3.angle(Vec3.sub(Vec3(), p0, ca.at), Vec3.sub(Vec3(), p1, ca.at)));
    expect((angle.value as { angle: number }).angle).toBeCloseTo(expectedAngle, 2);
    expect(measured(v).label).toBe(`${expectedAngle.toFixed(2)}°`);

    const ca2 = atom(v, 20);
    const dihedral = await v.api.run('stage.dihedral', { a: t0, b: { loci: ca.loci }, c: { loci: ca2.loci }, d: t1 });
    expectOk(dihedral);
    const expectedDihedral = radToDeg(Vec3.dihedralAngle(p0, ca.at, ca2.at, p1));
    expect((dihedral.value as { angle: number }).angle).toBeCloseTo(expectedDihedral, 2);
  });

  it('measures a triangle to a particle', async () => {
    const v = await viewer();
    const star = (rows: string) =>
      `data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n${rows}`;
    expectOk(await v.api.load.files({ files: [new File([star('7 2 20\n0 0 0\n')], 'p.star')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const r = await v.api.run('stage.distance', { a: { loci: triangle(v, 0, [0.5, 0.2]) }, b: `${list}#0` });
    expectOk(r);
    // (7, 2, 50) to (7, 2, 20)
    expect((r.value as { distance: number }).distance).toBeCloseTo(30, 4);
  });

  it("opens a session's distance made before angles (its params only a and b): a distance, the same one again", async () => {
    const v = await viewer();
    const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell;
    const ref = structure.transform.ref;
    const a = { ref, label: 'A', key: `o:${ref}`, bundle: StructureElement.Bundle.fromLoci(atom(v, 10).loci) };
    const b = { ref, label: 'B', key: `o:${ref}`, bundle: StructureElement.Bundle.fromLoci(atom(v, 20).loci) };
    // as a pre-lane session holds it: no `c`, no `d`
    await v.plugin.state.data
      .build()
      .toRoot()
      .apply(StageDistance, { a, b, node: `o:${ref}` } as never, { dependsOn: [ref] })
      .commit();
    const [d] = v.api.stage!.distancesState().value;
    expect(d.measure).toBe('distance');
    expect(d.label).toBe(`${Vec3.distance(atom(v, 10).at, atom(v, 20).at).toFixed(2)} Å`);
    const again = await v.api.run('stage.distance', { a: { loci: atom(v, 10).loci }, b: { loci: atom(v, 20).loci } });
    expect(again.ok && again.unchanged).toBe(true);
  });

  it('refuses a mesh point that is not a triangle (the whole mesh)', async () => {
    const v = await viewer();
    const r = await v.api.run('stage.distance', {
      a: { loci: Shape.Loci(mesh(v).shape) },
      b: { loci: atom(v, 10).loci },
    });
    expect(r.ok).toBe(false);
  });
});
