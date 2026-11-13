/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { MeshInfo } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// A segmentation mesh's Color by (`cryoet.mesh`): a VTP's own color theme (packages/graphics/src/formats/shape/vtp.ts),
// uniform or one of its point and cell arrays with a color scale and a range; an OBJ's one color.

/** A square of two triangles: a point array (Curvature) and a cell array (Labels) */
const Vtp = `<?xml version="1.0"?>
<VTKFile type="PolyData" version="0.1" byte_order="LittleEndian">
  <PolyData>
    <Piece NumberOfPoints="4" NumberOfPolys="2">
      <PointData>
        <DataArray type="Float32" Name="Curvature" NumberOfComponents="1" format="ascii">0 0.5 1 1.5</DataArray>
      </PointData>
      <CellData>
        <DataArray type="Int32" Name="Labels" NumberOfComponents="1" format="ascii">1 2</DataArray>
      </CellData>
      <Points>
        <DataArray type="Float32" Name="Points" NumberOfComponents="3" format="ascii">0 0 0 10 0 0 10 10 0 0 10 0</DataArray>
      </Points>
      <Polys>
        <DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 0 2 3</DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">3 6</DataArray>
      </Polys>
    </Piece>
  </PolyData>
</VTKFile>
`;
const Obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';

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
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
  });
  viewers.push(v);
  expectOk(await v.api.load.files({ files: [new File([Vtp], 'seg.vtp'), new File([Obj], 'membrane.obj')] }));
  const c = v.api.cryoet!;
  const read = async (label: string) => {
    const r = await c.meshes({});
    expectOk(r);
    return (r.value as MeshInfo[]).find((m) => m.label === label)!;
  };
  const theme = async () =>
    (v.plugin.state.data.cells.get((await read('seg.vtp')).ref)!.transform.params as any).colorTheme;
  return { v, c, read, theme };
}

describe("a segmentation mesh's Color by", () => {
  it("lists a VTP's arrays and opens on its first, as the shape does; an OBJ has none", async () => {
    const { read } = await viewer();
    const vtp = await read('seg.vtp');
    // each its range: where Custom starts
    expect(vtp.arrays).toEqual([
      { key: 'point:Curvature', label: 'Point: Curvature', range: [0, 1.5] },
      { key: 'cell:Labels', label: 'Cell: Labels', range: [1, 2] },
    ]);
    expect(vtp.colorBy).toEqual({ array: 'cell:Labels', colorList: 'viridis', range: 'auto' });
    expect(vtp).not.toHaveProperty('color');
    const obj = await read('membrane.obj');
    expect(obj).not.toHaveProperty('arrays');
    expect(obj).not.toHaveProperty('colorBy');
  });

  it('writes the array, its colors and its range in the theme of the VTP', async () => {
    const { c, read, theme } = await viewer();
    expectOk(await c.mesh({ mesh: 'seg.vtp', array: 'point:Curvature', colorList: 'plasma', range: [0, 2] } as never));
    expect(await theme()).toEqual({
      name: 'attribute',
      params: { name: 'point:Curvature', colors: 'plasma', domain: { name: 'custom', params: [0, 2] } },
    });
    expect((await read('seg.vtp')).colorBy).toEqual({ array: 'point:Curvature', colorList: 'plasma', range: [0, 2] });
    // an array by its name alone; the range back to auto, the colors kept
    expectOk(await c.mesh({ mesh: 'seg.vtp', array: 'Labels', range: 'auto' } as never));
    expect((await read('seg.vtp')).colorBy).toEqual({ array: 'cell:Labels', colorList: 'plasma', range: 'auto' });
    expect(await c.mesh({ mesh: 'seg.vtp', array: 'cell:Labels' } as never)).toMatchObject({ unchanged: true });
  });

  it("a color makes it uniform; opacity, visuals and scale leave an array's theme as it is", async () => {
    const { c, read, theme } = await viewer();
    const before = await theme();
    expectOk(await c.mesh({ mesh: 'seg.vtp', opacity: 0.5, visuals: 'both', scale: 2 } as never));
    expect(await theme()).toEqual(before);
    // every mesh's opacity: the VTP's array kept
    expectOk(await c.mesh({ opacity: 0.8 } as never));
    expect(await theme()).toEqual(before);
    expectOk(await c.mesh({ mesh: 'seg.vtp', color: 'tomato' } as never));
    expect(await theme()).toEqual({ name: 'uniform', params: { color: 0xff6347 } });
    const vtp = await read('seg.vtp');
    expect(vtp.color).toBe(0xff6347);
    expect(vtp).not.toHaveProperty('colorBy');
    // back to an array: its colors and range as they open
    expectOk(await c.mesh({ mesh: 'seg.vtp', array: 'cell:Labels' } as never));
    expect((await read('seg.vtp')).colorBy).toEqual({ array: 'cell:Labels', colorList: 'viridis', range: 'auto' });
  });

  it('refuses an array of an OBJ, an array the VTP lacks, colors that are none, a color with an array', async () => {
    const { c, theme } = await viewer();
    const before = await theme();
    expect(await c.mesh({ mesh: 'membrane.obj', array: 'cell:Labels' } as never)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await c.mesh({ mesh: 'seg.vtp', array: 'Thickness' } as never)).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    expect(await c.mesh({ mesh: 'seg.vtp', colorList: 'rainbowish' } as never)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await c.mesh({ mesh: 'seg.vtp', range: [2, 1] } as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await c.mesh({ mesh: 'seg.vtp', array: 'cell:Labels', color: 'red' } as never)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await theme()).toEqual(before);
  });
});
