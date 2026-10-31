/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { radToDeg } from '@molstar/core/math/misc';
import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { Loci } from '@molstar/model/model/loci';
import { Shape } from '@molstar/model/model/shape';
import { StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { distancePicker } from '../measure.js';
import type { PickedNode } from '../operations.js';

// Measuring from a mesh's triangles in the explorer (_spec/ui.md §7): ⌘/Ctrl+clicks in selection mode take a
// triangle as a point (the point picked on it), a distance at the second; an angle and a dihedral from the latest
// three and four points (the canvas's right-click). On a headless viewer: 1CRN and an OBJ square made here.

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
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'));
  expectOk(await v.api.load.files({ files: [new File([crn], '1crn.cif'), new File([square], 'square.obj')] }));
  v.plugin.selectionMode = true;
  return v;
}

/** The OBJ's representation and its shape (not 1CRN's unit cell, a shape too) */
function mesh(v: PrismViewer) {
  for (const c of v.plugin.state.data.cells.values()) {
    if (!SO.Shape.Representation3D.is(c.obj)) continue;
    const l = c.obj.data.repr.getAllLoci().find((x: Loci) => Shape.isLoci(x) && !!x.shape.getTriangleLoci);
    if (l) return { ref: c.transform.ref, shape: (l as Shape.Loci).shape as Shape<Mesh> };
  }
  throw new Error('no mesh');
}

/** A click's pick of a triangle, at a point on it */
const triangle = (v: PrismViewer, index: number, uv: [number, number]) =>
  ShapeUtils.triangleLoci(mesh(v).shape, { instance: 0, index, uv });

function residue(v: PrismViewer, seq: number) {
  const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const selection = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), seq]),
      }),
    structure,
  );
  return StructureSelection.toLociWithSourceUnits(selection);
}

function picker(v: PrismViewer) {
  const posted: string[] = [];
  const revealed: PickedNode[] = [];
  const p = distancePicker(v.api, v.api.explorer!, {
    post: (t) => posted.push(t),
    reveal: (n) => revealed.push(n),
    mac: false,
  });
  return { p, posted, revealed };
}

const center = (l: Loci) => Vec3.clone(Loci.getBoundingSphere(l)!.center);
const measurements = (v: PrismViewer) => v.api.stage!.distancesState().value;

describe('measuring from mesh triangles in the explorer', () => {
  it('two Ctrl+clicks on triangles make a distance between the points picked, under the mesh row', async () => {
    const v = await viewer();
    const { p, revealed } = picker(v);
    expect(await p.click({ loci: triangle(v, 0, [0.5, 0.2]), measure: true })).toBe(true);
    expect(p.pending.value?.picked.key).toBe(`o:${mesh(v).ref}`);
    expect(await p.click({ loci: triangle(v, 1, [0.1, 0.8]), measure: true })).toBe(true);
    const [d] = measurements(v);
    expect(d.measure).toBe('distance');
    expect(d.distance).toBeCloseTo(Vec3.distance(Vec3.create(7, 2, 50), Vec3.create(1, 9, 50)), 4);
    expect(d.node).toBe(`o:${mesh(v).ref}`);
    expect(d.a.label).toBe('square.obj triangle 0');
    expect(revealed.at(-1)?.key).toBe(`d:${d.ref}`);
  });

  it('an angle and a dihedral from the latest three and four points (right-click), between triangles and residues', async () => {
    const v = await viewer();
    const { p } = picker(v);
    const t0 = triangle(v, 0, [0.5, 0.2]);
    const r10 = residue(v, 10);
    const t1 = triangle(v, 1, [0.1, 0.8]);
    for (const loci of [t0, r10, t1]) await p.click({ loci, measure: true });
    // a distance (t0, r10), and t1 waiting for its second point
    expect(measurements(v)).toHaveLength(1);
    expect(p.menuItems().map((i) => i.id)).toEqual(['measure-angle']);
    await p.measureLatest('angle');
    const angle = measurements(v).find((m) => m.measure === 'angle')!;
    const expected = radToDeg(
      Vec3.angle(Vec3.sub(Vec3(), center(t0), center(r10)), Vec3.sub(Vec3(), center(t1), center(r10))),
    );
    expect(angle.distance).toBeCloseTo(expected, 2);
    expect(angle.label).toBe(`${expected.toFixed(2)}°`);
    expect([angle.a.label, angle.c?.label]).toEqual(['square.obj triangle 0', 'square.obj triangle 1']);
    // the first point's row, and each point's own row (the properties button reveals it)
    expect(angle.node).toBe(`o:${mesh(v).ref}`);
    expect([angle.a.key, angle.b.key, angle.c?.key]).toEqual([
      `o:${mesh(v).ref}`,
      p.recent.value[1].picked.key,
      `o:${mesh(v).ref}`,
    ]);

    // a fourth point: the latest four make a dihedral
    const r20 = residue(v, 20);
    await p.click({ loci: r20, measure: true });
    expect(p.menuItems().map((i) => i.id)).toEqual(['measure-angle', 'measure-dihedral']);
    await p.measureLatest('dihedral');
    const dihedral = measurements(v).find((m) => m.measure === 'dihedral')!;
    expect(dihedral.distance).toBeCloseTo(
      radToDeg(Vec3.dihedralAngle(center(t0), center(r10), center(t1), center(r20))),
      2,
    );
    expect([dihedral.a.key, dihedral.b.key, dihedral.c?.key, dihedral.d?.key]).toEqual(
      p.recent.value.map((point) => point.picked.key),
    );
  });

  it('keeps the unpaired point when an angle is measured, so the next click pairs with it', async () => {
    const v = await viewer();
    const { p } = picker(v);
    for (const loci of [triangle(v, 0, [0.5, 0.2]), residue(v, 10), triangle(v, 1, [0.1, 0.8])]) {
      await p.click({ loci, measure: true });
    }
    const waiting = p.pending.value;
    expect(waiting).toBeTruthy();
    expect(measurements(v).filter((m) => m.measure === 'distance')).toHaveLength(1);
    await p.measureLatest('angle');
    expect(p.pending.value).toBe(waiting);
    await p.click({ loci: residue(v, 20), measure: true });
    expect(measurements(v).filter((m) => m.measure === 'distance')).toHaveLength(2);
    expect(p.pending.value).toBeUndefined();
  });

  it("says a latest point's object was removed, and measures nothing", async () => {
    const v = await viewer();
    const { p, posted } = picker(v);
    for (const loci of [triangle(v, 0, [0.5, 0.2]), residue(v, 10), triangle(v, 1, [0.1, 0.8])]) {
      await p.click({ loci, measure: true });
    }
    // the mesh's file removed (its root data)
    const { tree } = v.plugin.state.data;
    let root = mesh(v).ref;
    while (tree.transforms.get(root)!.parent !== '-=root=-') root = tree.transforms.get(root)!.parent;
    await v.plugin.state.data.build().delete(root).commit();
    const before = measurements(v).length;
    await p.measureLatest('angle');
    expect(posted.at(-1)).toMatch(/object was removed/);
    expect(measurements(v)).toHaveLength(before);
  });

  it('lets the latest points go with the first one (Esc, a plain click): no angle offered then', async () => {
    const v = await viewer();
    const { p, posted } = picker(v);
    for (const loci of [triangle(v, 0, [0.5, 0.2]), residue(v, 10), triangle(v, 1, [0.1, 0.8])]) {
      await p.click({ loci, measure: true });
    }
    p.cancel();
    expect(p.menuItems()).toEqual([]);
    await p.measureLatest('angle');
    expect(posted.at(-1)).toMatch(/An angle needs 3 points/);
  });
});
