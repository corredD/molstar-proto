/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import { sceneVolumes } from '@molstar/mesoscale-extension/fit';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Grid } from '@molstar/model/model/volume';
import type { Shape } from '@molstar/model/model/shape';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';

// A volume's pixel size (`cryoet.volume`, in the Data section): the volume scaled about the origin as if the header
// said it, one step; what reads the volume where it is drawn follows (the density fit, a mesh's Color by Volume); a
// session keeps it. An MRC of 16³ voxels of 4 Å, its value the x of the voxel (Å), and a triangle of an OBJ at x = 30.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

function mapFile(voxel = 4) {
  const n = 16;
  const values = new Float32Array(n * n * n).map((_, i) => (i % n) * voxel);
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.fromUniformScaling(Mat4(), voxel) },
    cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: 0, max: 0, mean: 0, sigma: 0 },
  };
  return new File([CCP4Writer.writeMrc(grid, values)], 'map.mrc');
}

const triangle = new File(['v 30 20 20\nv 32 20 20\nv 30 22 20\nf 1 2 3\n'], 'tri.obj');

async function viewer(...files: File[]) {
  return viewerOf(mapFile(), ...files);
}

async function viewerOf(map: File, ...files: File[]) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension, StageToolsExtension] },
  });
  viewers.push(v);
  expectOk(await v.api.load.files({ files: [map, ...files] }));
  const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
  /** Voxel (1, 0, 0) where it is drawn */
  const voxel = () => {
    const drawn = sceneVolumes(v.plugin.state.data)[0].volume;
    return Array.from(Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), Grid.getGridToCartesianTransform(drawn.grid)));
  };
  return { v, ref, voxel, c: v.api.cryoet! };
}

describe('cryoet.volume', () => {
  it("takes the file's own value typed in (a float32 header: 13.36 is 13.3599996) as the file's, not a change", async () => {
    const { v, ref, c } = await viewerOf(mapFile(13.36));
    const n = v.api.history.steps.value.length;
    expect(await c.volume({ volume: ref, pixelSize: 13.36 } as never)).toMatchObject({ unchanged: true });
    expect(v.api.history.steps.value.length).toBe(n);
    // after another value, back by typing it: exactly the file's, no Reset shown
    expectOk(await c.volume({ volume: ref, pixelSize: 6.68 } as never));
    expectOk(await c.volume({ volume: ref, pixelSize: 13.36 } as never));
    const info = c.dataState(ref).value!;
    expect(info.pixelSize).toBe(info.filePixelSize);
    expect(info.voxel).not.toContain('file');
  });

  it('rescales about the origin as if the header said it; Reset gives the file’s back exactly; one step each', async () => {
    const { v, ref, voxel, c } = await viewer();
    const steps = () => v.api.history.steps.value.length;
    expect(voxel()).toEqual([4, 0, 0]);
    const n = steps();
    expectOk(await c.volume({ volume: ref, pixelSize: 8 } as never));
    expect(voxel()).toEqual([8, 0, 0]);
    expect(steps()).toBe(n + 1);
    expect(c.dataState(ref).value).toMatchObject({ voxel: '8 Å (file: 4 Å)', pixelSize: 8, filePixelSize: 4 });
    expect(await c.volume({ volume: ref, pixelSize: 8 } as never)).toMatchObject({ unchanged: true });
    expectOk(await c.volume({ volume: ref, pixelSize: null } as never));
    expect(voxel()).toEqual([4, 0, 0]);
    expect(c.dataState(ref).value).toMatchObject({ voxel: '4 Å', pixelSize: 4 });
    expect(steps()).toBe(n + 2);
    expectOk(await v.api.run('history.undo', {}));
    expect(voxel()).toEqual([8, 0, 0]);
    expectOk(await v.api.run('history.redo', {}));
    expect(voxel()).toEqual([4, 0, 0]);
    expect((await c.volume({ volume: ref, pixelSize: 0 } as never)).ok).toBe(false);
  });

  it('is applied before a move: a voxel is at move(scale(p)), and the move’s handles keep working', async () => {
    const { v, ref, voxel, c } = await viewer();
    expectOk(await c.volume({ volume: ref, pixelSize: 8 } as never));
    expectOk(
      await v.api.stage!.move({
        target: ref,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 50))),
      } as never),
    );
    expect(voxel()).toEqual([8, 0, 50]);
    // a pixel size set again after the move: the move stays in Å of the scene
    expectOk(await c.volume({ volume: ref, pixelSize: 12 } as never));
    expect(voxel()).toEqual([12, 0, 50]);
    expect(v.api.stage!.placementOf(ref)!.radius).toBeGreaterThan(0);
  });

  it('is kept by a level change (a map binned), its labels scaled from the finest', async () => {
    const { ref, c } = await viewer();
    expectOk(await c.volume({ volume: ref, pixelSize: 8 } as never));
    expectOk(await c.level({ volume: ref, level: '2' } as never));
    expect(c.dataState(ref).value).toMatchObject({ pixelSize: 8, filePixelSize: 4, voxel: '16 Å (file: 8 Å)' });
    expectOk(await c.level({ volume: ref, level: '1' } as never));
    expect(c.dataState(ref).value).toMatchObject({ pixelSize: 8, voxel: '8 Å (file: 4 Å)' });
  });

  it('is kept by a session; a session from before reads the file’s', async () => {
    const { v, ref, voxel, c } = await viewer();
    const before = v.plugin.state.getSnapshot({ camera: false });
    expectOk(await c.volume({ volume: ref, pixelSize: 8 } as never));
    const snapshot = v.plugin.state.getSnapshot({ camera: false });
    expectOk(await c.volume({ volume: ref, pixelSize: null } as never));
    await v.plugin.state.setSnapshot(snapshot);
    expect(voxel()).toEqual([8, 0, 0]);
    // a session made before the decorator carried a scale: its params without it
    expectOk(await c.volume({ volume: ref, pixelSize: null } as never));
    const old = JSON.parse(JSON.stringify(snapshot).replace(/"scale":2,?/g, '').replace(/,}/g, '}'));
    await v.plugin.state.setSnapshot(old);
    expect(voxel()).toEqual([4, 0, 0]);
    await v.plugin.state.setSnapshot(before);
    expect(voxel()).toEqual([4, 0, 0]);
  });

  it('is read where it is drawn by the density fit (the scene’s volumes) and by a mesh’s Color by Volume', async () => {
    const { v, ref, c } = await viewer(triangle);
    // the color of the triangle's first vertex as drawn
    const color = async () => {
      const r = await c.meshes({});
      expectOk(r);
      const mesh = (r.value as { ref: string; label: string }[]).find((m) => m.label === 'tri.obj')!;
      const cell = v.plugin.state.data.cells.get(mesh.ref)!;
      const loci = (cell.obj as SO.Shape.Representation3D).data.repr.getAllLoci()[0] as { shape: Shape };
      return loci.shape.getColor(0, 0);
    };
    expectOk(await c.mesh({ mesh: 'tri.obj', volume: 'map.mrc', sample: 'surface' } as never));
    const flat = await color();
    expectOk(await c.volume({ volume: ref, pixelSize: 8 } as never));
    // the density fit reads the drawn grid
    const drawn = sceneVolumes(v.plugin.state.data)[0].volume.grid;
    expect(Grid.getGridToCartesianTransform(drawn)[0]).toBeCloseTo(8, 6);
    // the triangle at x = 30 now reads the file's x = 15: another density, another color
    expect(await color()).not.toBe(flat);
  });
});
