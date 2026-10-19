/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { rowsOf, stableRows, toggleVisible } from '../rows.js';

// The `explorer` area on a headless viewer: 1CRN (crambin, with its unit cell), a RELION list and an OBJ mesh.

const star = `data_particles

loop_
_rlnCoordinateX
_rlnCoordinateY
_rlnCoordinateZ
10 0 0
20 0 0
30 0 0
`;
const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n';

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
  const crn = new File([readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url))], '1crn.cif');
  for (const f of [crn, new File([star], 'membrane.star'), new File([obj], 'membrane.obj')]) {
    expectOk(await v.api.load.files({ files: [f] }));
  }
  return v;
}

describe('explorer', () => {
  it('lists the scene by category, a model shape (the unit cell) not as a mesh, a list by its file', async () => {
    const v = await viewer();
    // 1CRN's unit cell is a shape of its model: there is one besides the mesh's
    const shapes = Array.from(v.plugin.state.data.cells.values()).filter((c) => c.obj?.type.name === 'Shape 3D');
    expect(shapes).toHaveLength(2);
    const objects = v.api.explorer!.objectsState().value;
    expect(objects.map((o) => [o.category, o.kind, o.label])).toEqual([
      ['structures', 'structure', '1CRN'],
      ['particles', 'list', 'membrane.star'],
      ['meshes', 'mesh', 'membrane.obj'],
    ]);
    expect(objects[0].entities).toEqual([{ id: '1', label: 'CRAMBIN', chains: ['A'] }]);
    expect(objects[1].count).toBe('3 particles');
  });

  it('highlights and focuses a structure entity, a list and a mesh', async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const [crn, list, mesh] = area.objectsState().value;
    for (const node of [
      { ref: crn.ref, entity: '1' },
      { ref: crn.ref, entity: '1', chain: 'A' },
      { ref: list.ref },
      { ref: mesh.ref },
    ]) {
      expect(() => area.highlight(node)).not.toThrow();
      expect(() => area.focus(node)).not.toThrow();
    }
    area.highlight(undefined);
  });

  it("flips each object's eye, and the watched read follows (a visibility change is a cell's state)", async () => {
    const v = await viewer();
    const state = v.api.explorer!.objectsState();
    const seen: boolean[][] = [];
    const sub = state.subscribe((o) => seen.push(o.map((x) => x.visible)));
    const rows = () => rowsOf(state.value, new Map(), new Set(['c:structures', 'c:particles', 'c:meshes']), '');
    for (const kind of ['structure', 'particle list', 'mesh']) {
      const row = rows().find((r) => r.kind === kind)!;
      expect(row.visible).toBe(true);
      const r = await toggleVisible(v.api, row);
      expectOk(r!);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rows().find((x) => x.key === row.key)!.visible).toBe(false);
      expectOk((await toggleVisible(v.api, { ...row, visible: false }))!);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    sub.unsubscribe();
    expect(seen.some((s) => s[0] === false)).toBe(true);
    expect(seen.some((s) => s[1] === false)).toBe(true);
    expect(seen.some((s) => s[2] === false)).toBe(true);
    expect(seen.at(-1)).toEqual([true, true, true]);
  });

  it("paints a structure entity by its label ids, and reads back each node's look", async () => {
    const v = await viewer();
    const cbs = new File(
      [readFileSync(new URL('../../../../../data/examples/1cbs_updated.cif', import.meta.url))],
      '1cbs.cif',
    );
    expectOk(await v.api.load.files({ files: [cbs] }));
    const area = v.api.explorer!;
    const ref = area.objectsState().value.find((o) => o.label === '1CBS')!.ref;
    // the retinoic acid: entity 2, label chain B (its author chain is A, the protein's)
    const rea = { ref, entity: '2' };
    const look = (node: object) => area.structureLookState(node as never).value;
    expectOk(
      await v.api.run('representation.color', { target: { loci: area.loci(rea) }, color: '#ff0000', structure: ref }),
    );
    expectOk(
      await v.api.run('representation.transparency', { target: { loci: area.loci(rea) }, alpha: 0.4, structure: ref }),
    );
    expectOk(
      await v.api.run('representation.emissive', { target: { loci: area.loci(rea) }, strength: 0.7, structure: ref }),
    );
    expect(look(rea)).toEqual({ color: 0xff0000, transparency: 0.4, emissive: 0.7 });
    expect(look({ ref, entity: '2', chain: 'B' })).toEqual({ color: 0xff0000, transparency: 0.4, emissive: 0.7 });
    // the protein is untouched, and the whole structure is not all red
    expect(look({ ref, entity: '1' })).toEqual({ transparency: 0, emissive: 0 });
    expect(look({ ref })).toEqual({ transparency: 0, emissive: 0 });
  });

  it("lists a particle list's representations, gives their form, and shows or hides one", async () => {
    const v = await viewer();
    const area = v.api.explorer!;
    const list = area.objectsState().value.find((o) => o.kind === 'list')!;
    const [r] = area.representationsState(list.ref).value;
    expect(r).toMatchObject({ type: 'spacefill', visible: true });
    const form = area.representationForm(r.ref)!;
    expect(Object.keys(form.params)).toEqual(expect.arrayContaining(['type', 'colorTheme', 'sizeTheme']));
    expect((form.values.type as { name: string }).name).toBe('spacefill');
    expectOk(await v.api.run('explorer.representationVisibility', { node: r.ref, visible: false }));
    expect(area.representationsState(list.ref).value[0].visible).toBe(false);
    expect(await v.api.run('explorer.representationVisibility', { node: r.ref, visible: false })).toMatchObject({
      ok: true,
      unchanged: true,
    });
    expect(await v.api.run('explorer.representationVisibility', { node: 'nope', visible: true })).toMatchObject({
      ok: false,
    });
  });

  it("lists a volume's isosurface and slice as rows of their kind, with their representations", async () => {
    const v = await viewer();
    const n = 10;
    const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
    const data = new Float32Array(n * n * n).map((_, i) => i % 7);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(space, Tensor.Data1(data)),
      stats: { min: 0, max: 6, mean: 3, sigma: 2 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, data)], 'tomo.mrc')] }));
    expectOk(await v.api.run('cryoet.slice', {}));
    const area = v.api.explorer!;
    const volume = area.objectsState().value.find((o) => o.kind === 'volume')!;
    const types = area.representationsState(volume.ref).value.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['isosurface', 'slice']));
    const rows = rowsOf(area.objectsState().value, new Map(), new Set(['c:volumes', `o:${volume.ref}`]), '');
    const reprRows = rows.filter((r) => r.depth === 2);
    expect(reprRows.map((r) => r.kind).sort()).toEqual(['isosurface', 'slice']);
    for (const r of reprRows) expect(area.representationForm(r.representation!)).toBeDefined();
  });

  it('keeps unchanged rows as the same objects', () => {
    const stable = stableRows();
    const a = { key: 'a', depth: 1, label: 'A', kind: 'entity', hasChildren: false, visible: true };
    const b = { key: 'b', depth: 1, label: 'B', kind: 'entity', hasChildren: false, visible: true };
    const [a1, b1] = stable([a, b]);
    const [a2, b2] = stable([{ ...a }, { ...b, visible: false }]);
    expect(a2).toBe(a1);
    expect(b2).not.toBe(b1);
    expect(b2.visible).toBe(false);
  });
});
