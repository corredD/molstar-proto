/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ColorScale } from '@molstar/core/util/color/scale';
import type { Shape } from '@molstar/model/model/shape';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import type { MeshInfo } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';
import { mrcOf, objOf, sphereMesh, vtpOf } from './mesh-volume-fixtures.js';

// A mesh's Look › Color by › Volume (`cryoet.mesh` with a volume; apps/prism-me/progress/2026-11-14-mesh-volume-color.md)
// on a headless viewer: a sphere of radius 30 Å in a map with a dark shell at that radius (2 Å voxels).

const Center = Vec3.create(48, 48, 48);
const shell = (x: number, y: number, z: number) =>
  -Math.exp(-(((Math.hypot(x - Center[0], y - Center[1], z - Center[2]) - 30) / 4) ** 2));
const Sphere = sphereMesh(30, Center, 12, 24);

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** The map and the meshes: a VTP with cell arrays only, one with a point array, an OBJ */
async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
  });
  viewers.push(v);
  expectOk(
    await v.api.load.files({
      files: [
        new File([mrcOf(48, 2, shell)], 'shell.mrc'),
        new File([vtpOf(Sphere, { cell: true })], 'cells.vtp'),
        new File([vtpOf(Sphere, { point: true })], 'points.vtp'),
        new File([objOf(Sphere)], 'ball.obj'),
      ],
    }),
  );
  const c = v.api.cryoet!;
  const read = async (label: string) => {
    const r = await c.meshes({});
    expectOk(r);
    return (r.value as MeshInfo[]).find((m) => m.label === label)!;
  };
  /** The shape drawn now and its color at each vertex */
  const colors = async (label: string) => {
    const cell = v.plugin.state.data.cells.get((await read(label)).ref)!;
    const loci = (cell.obj as SO.Shape.Representation3D).data.repr.getAllLoci()[0] as { shape: Shape };
    return Array.from({ length: Sphere.vertexCount }, (_, i) => loci.shape.getColor(i, 0));
  };
  /** The values of an array of the mesh as drawn (its provider's file), by key */
  const array = async (label: string, key: string) => {
    const cell = v.plugin.state.data.cells.get((await read(label)).ref)!;
    const provider = v.plugin.state.data.cells.get(cell.transform.parent)!.obj as SO.Shape.Provider;
    const source = (provider.data.data as { source: any }).source;
    const [kind, name] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
    const a = (kind === 'cell' ? source.cellData : source.pointData).get(name);
    return a ? Float32Array.from(a.values.toArray() as ArrayLike<number>) : undefined;
  };
  return { v, c, read, colors, array };
}

const viridis = (value: number, reverse = false) =>
  ColorScale.create({ listOrName: 'viridis', domain: [-2, 2], reverse }).color(value);

describe("a mesh's Color by › Volume", () => {
  it('colors by the density at the surface, in σ, Range Auto ±2σ: the dark shell at the low end', async () => {
    const { c, read, colors } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const m = await read('points.vtp');
    expect(m.volumeColor).toMatchObject({
      label: 'shell.mrc',
      sample: 'surface',
      colorList: 'viridis',
      range: 'auto',
      invert: false,
      array: 'point:density_shell',
    });
    // the default depth: 2 voxels
    expect(m.volumeColor!.depth).toBe(4);
    expect(m).not.toHaveProperty('colorBy');
    for (const col of await colors('points.vtp')) expect(col).toBe(viridis(-2));
  });

  it("adds the values as an array of the mesh, per vertex or per cell as its arrays are, the file's untouched", async () => {
    const { v, c, read, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'min', depth: 8 } as never));
    expectOk(await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc', sample: 'min', depth: 8 } as never));
    const points = await read('points.vtp');
    expect(points.arrays!.map((a) => a.key)).toEqual(['point:Curvature', 'point:density_shell']);
    expect((await array('points.vtp', 'point:density_shell'))!.length).toBe(Sphere.vertexCount);
    const cells = await read('cells.vtp');
    expect(cells.volumeColor!.array).toBe('cell:density_shell');
    expect(cells.arrays!.map((a) => a.key)).toEqual(['cell:Labels', 'cell:density_shell']);
    const values = (await array('cells.vtp', 'cell:density_shell'))!;
    expect(values.length).toBe(Sphere.triangleCount);
    // each well under the mean: the shell, found within ±8 Å of each cell's center
    for (const x of values) expect(x).toBeLessThan(-2);
    // the parsed file's own arrays: unchanged
    for (const cell of v.plugin.state.data.cells.values()) {
      if (!SO.Format.Vtp.is(cell.obj)) continue;
      expect(cell.obj.data.pointData.has('density_shell')).toBe(false);
      expect(cell.obj.data.cellData.has('density_shell')).toBe(false);
    }
  });

  it('Array coloring by the added array equals the Volume coloring', async () => {
    const { c, colors } = await viewer();
    // a range the values span, so the colors differ along it
    expectOk(
      await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc', sample: 'mean', depth: 8, range: [-4, 0] } as never),
    );
    const byVolume = await colors('cells.vtp');
    expect(new Set(byVolume).size).toBeGreaterThan(1);
    expectOk(await c.mesh({ mesh: 'cells.vtp', array: 'cell:density_shell', range: [-4, 0] } as never));
    expect(await colors('cells.vtp')).toEqual(byVolume);
  });

  it('Invert flips the scale', async () => {
    const { c, colors } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface', invert: true } as never));
    for (const col of await colors('points.vtp')) expect(col).toBe(viridis(-2, true));
    expect(viridis(-2, true)).toBe(viridis(2));
  });

  it('colors an OBJ by vertex, its array kept beside it', async () => {
    const { c, read, colors } = await viewer();
    expectOk(await c.mesh({ mesh: 'ball.obj', volume: 'shell.mrc', sample: 'min', depth: 8 } as never));
    const m = await read('ball.obj');
    expect(m.volumeColor!.array).toBe('point:density_shell');
    for (const col of await colors('ball.obj')) expect(col).toBe(viridis(-2));
  });

  it('refuses an unknown volume, a volume with a color or an array, a depth under 0, a sample that is none', async () => {
    const { c, read } = await viewer();
    const before = await read('points.vtp');
    for (const [params, code] of [
      [{ volume: 'nothing.mrc' }, 'not-found'],
      [{ volume: 'shell.mrc', color: 'red' }, 'invalid'],
      [{ volume: 'shell.mrc', array: 'point:Curvature' }, 'invalid'],
      [{ volume: 'shell.mrc', depth: -1 }, 'invalid'],
      [{ volume: 'shell.mrc', sample: 'median' }, 'invalid'],
      [{ depth: 8 }, 'invalid'],
    ] as const) {
      expect(await c.mesh({ mesh: 'points.vtp', ...params } as never)).toMatchObject({ ok: false, code });
    }
    expect(await read('points.vtp')).toEqual(before);
  });

  it('a change is one undo step and recolors; a color or an array leaves Volume, the array kept', async () => {
    const { v, c, read, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const surface = (await array('cells.vtp', 'cell:density_shell'))!;
    expectOk(await c.mesh({ mesh: 'cells.vtp', sample: 'max', depth: 10 } as never));
    expect((await read('cells.vtp')).volumeColor).toMatchObject({ sample: 'max', depth: 10 });
    const max = (await array('cells.vtp', 'cell:density_shell'))!;
    expect(max).not.toEqual(surface);
    for (let i = 0; i < max.length; i++) expect(max[i]).toBeGreaterThanOrEqual(surface[i] - 1e-4);
    expectOk(await v.api.run('history.undo', {}));
    expect((await read('cells.vtp')).volumeColor).toMatchObject({ sample: 'surface', depth: 4 });
    expect(await array('cells.vtp', 'cell:density_shell')).toEqual(surface);
    // a uniform color: Volume off, its array still there (Array can read it)
    expectOk(await c.mesh({ mesh: 'cells.vtp', color: 'tomato' } as never));
    const m = await read('cells.vtp');
    expect(m.color).toBe(0xff6347);
    expect(m).not.toHaveProperty('volumeColor');
    expect(m.arrays!.map((a) => a.key)).toContain('cell:density_shell');
    // and back to Volume: its last sample and depth
    expectOk(await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc' } as never));
    expect((await read('cells.vtp')).volumeColor).toMatchObject({ sample: 'surface', depth: 4 });
  });

  it("recolors when the volume's level changes, in the binned grid's σ", async () => {
    const { v, c, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const at1 = (await array('points.vtp', 'point:density_shell'))!;
    const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
    expectOk(await c.level({ volume: ref, level: '2' } as never));
    const at2 = (await array('points.vtp', 'point:density_shell'))!;
    expect(at2).not.toEqual(at1);
    // still the shell, read in the binned grid
    for (const x of at2) expect(x).toBeLessThan(-1);
  });

  it('follows the mesh as drawn: a scale moves it off the shell', async () => {
    const { c, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const before = (await array('points.vtp', 'point:density_shell'))!;
    // ×1.2 about the origin: the sphere off the shell (its center moved 17 Å, its radius 36 Å)
    expectOk(await c.mesh({ mesh: 'points.vtp', scale: 1.2 } as never));
    const after = (await array('points.vtp', 'point:density_shell'))!;
    const mean = (x: Float32Array) => x.reduce((a, b) => a + b, 0) / x.length;
    expect(mean(after)).toBeGreaterThan(mean(before) + 2);
  });

  it('a session keeps the parameters, not the values, and recomputes them', async () => {
    const { v, c, read, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc', sample: 'min', depth: 8, invert: true } as never));
    const values = (await array('cells.vtp', 'cell:density_shell'))!;
    const snapshot = v.plugin.state.getSnapshot({ camera: false });
    expect(JSON.stringify(snapshot)).not.toContain(String(values[0]));
    expectOk(await c.mesh({ mesh: 'cells.vtp', sample: 'surface' } as never));
    await v.plugin.state.setSnapshot(snapshot);
    expect((await read('cells.vtp')).volumeColor).toMatchObject({ sample: 'min', depth: 8, invert: true });
    expect(await array('cells.vtp', 'cell:density_shell')).toEqual(values);
  });
});

describe("a mesh's Color by › Volume, its volume", () => {
  it('removed: the mesh stays drawn and listed, gray, its volume missing; an undo recolors it', async () => {
    const { v, c, read, colors } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
    expectOk(await v.api.run('volume.remove', { volume: ref } as never));
    const m = await read('points.vtp');
    expect(m).toBeDefined();
    expect(m.volumeColor).toMatchObject({ missing: true });
    for (const col of await colors('points.vtp')) expect(col).toBe(0x808080);
    expectOk(await v.api.run('history.undo', {}));
    expect((await read('points.vtp')).volumeColor).toMatchObject({ label: 'shell.mrc' });
    expect((await read('points.vtp')).volumeColor).not.toHaveProperty('missing');
    for (const col of await colors('points.vtp')) expect(col).toBe(viridis(-2));
  });

  it('moved for the first time: read where it is drawn now', async () => {
    const { v, c, array } = await viewer();
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'shell.mrc', sample: 'surface' } as never));
    const before = (await array('points.vtp', 'point:density_shell'))!;
    const volume = v.plugin.managers.volume.hierarchy.current.volumes[0].cell;
    const matrix = Mat4.fromTranslation(Mat4(), Vec3.create(12, 0, 0));
    await v.plugin
      .build()
      .to(volume)
      .insert(VolumeTransform, { transform: { name: 'matrix', params: { data: matrix, transpose: false } } })
      .commit();
    const after = (await array('points.vtp', 'point:density_shell'))!;
    const mean = (x: Float32Array) => x.reduce((a, b) => a + b, 0) / x.length;
    expect(mean(after)).toBeGreaterThan(mean(before) + 1);
  });

  it('loaded after the mesh: a session made so recomputes the values in order', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
    });
    viewers.push(v);
    expectOk(await v.api.load.files({ files: [new File([vtpOf(Sphere, { point: true })], 'points.vtp')] }));
    expectOk(await v.api.load.files({ files: [new File([mrcOf(48, 2, shell)], 'shell.mrc')] }));
    expectOk(await v.api.cryoet!.mesh({ mesh: 'points.vtp', volume: 'shell.mrc' } as never));
    const read = async () => {
      const r = await v.api.cryoet!.meshes({});
      expectOk(r);
      const m = (r.value as MeshInfo[])[0];
      const parent = v.plugin.state.data.cells.get(v.plugin.state.data.cells.get(m.ref)!.transform.parent)!;
      return (parent.obj as SO.Shape.Provider).data.data.source.pointData.get('density_shell').values.toArray();
    };
    const values = Float32Array.from(await read());
    expect(values.every((x) => x < -2)).toBe(true);
    const snapshot = v.plugin.state.getSnapshot({ camera: false });
    await v.plugin.state.setSnapshot(snapshot);
    expect(Float32Array.from(await read())).toEqual(values);
  });
});

describe("a mesh's Color by › Volume, with Prism's shapes (review)", () => {
  /** The shape a mesh's representation draws from (its file's), by the mesh's label */
  const shapeOf = async (v: PrismViewer, label: string) => {
    const r = await v.api.cryoet!.meshes({});
    expectOk(r);
    const m = (r.value as MeshInfo[]).find((x) => x.label === label)!;
    const { cells } = v.plugin.state.data;
    let cell = cells.get(cells.get(m.ref)!.transform.parent)!;
    while (cell.transform.transformer.definition.isDecorator) cell = cells.get(cell.transform.parent)!;
    return { mesh: m, shape: cell.transform.ref };
  };
  const drawnAt = (v: PrismViewer, ref: string) => {
    const loci = (v.plugin.state.data.cells.get(ref)!.obj as SO.Shape.Representation3D).data.repr.getAllLoci()[0] as {
      shape: Shape;
    };
    return loci.shape.transforms[0][12];
  };

  it('M1: a VTP moved by shape.transform stays where it is drawn when colored, and after', async () => {
    const { v, c } = await viewer();
    const { mesh, shape } = await shapeOf(v, 'points.vtp');
    expectOk(await v.api.run('shape.transform', { node: shape, translation: [12, 0, 0] } as never));
    expect(drawnAt(v, mesh.ref)).toBeCloseTo(12);
    expectOk(await c.mesh({ mesh: mesh.ref, volume: 'shell.mrc' } as never));
    expect(drawnAt(v, mesh.ref)).toBeCloseTo(12);
    expectOk(await v.api.run('shape.transform', { node: shape, translation: [20, 0, 0] } as never));
    expect(drawnAt(v, mesh.ref)).toBeCloseTo(20);
  });

  it("M2: shape.list and shape.focus find a colored mesh's representation", async () => {
    const { v, c } = await viewer();
    const { mesh, shape } = await shapeOf(v, 'points.vtp');
    expectOk(await c.mesh({ mesh: mesh.ref, volume: 'shell.mrc' } as never));
    const list = await v.api.run('shape.list', {});
    expectOk(list);
    const entry = (list.value as { ref: string; representations: { ref: string }[] }[]).find((e) => e.ref === shape)!;
    expect(entry.representations.map((r) => r.ref)).toEqual([mesh.ref]);
    expectOk(await v.api.run('shape.focus', { node: shape } as never));
  });

  it('NEW-1: the Look scale after a shape.transform scales the mesh (its file shape, past the move)', async () => {
    const { v, c, read } = await viewer();
    const { shape } = await shapeOf(v, 'ball.obj');
    expectOk(await v.api.run('shape.transform', { node: shape, translation: [5, 0, 0] } as never));
    expectOk(await c.mesh({ mesh: 'ball.obj', scale: 2 } as never));
    expect((await read('ball.obj')).scale).toBeCloseTo(2);
  });

  it('S3: a change of colors only does not sample or build the mesh again', async () => {
    const { v, c } = await viewer();
    expectOk(await c.mesh({ mesh: 'cells.vtp', volume: 'shell.mrc', sample: 'min', depth: 8 } as never));
    const { mesh } = await shapeOf(v, 'cells.vtp');
    const node = () => v.plugin.state.data.cells.get(v.plugin.state.data.cells.get(mesh.ref)!.transform.parent)!;
    const base = () => (node().obj as SO.Shape.Provider).data.data.volumeColor.base;
    const before = base();
    expectOk(await c.mesh({ mesh: mesh.ref, invert: true, colorList: 'plasma' } as never));
    expect(base()).toBe(before);
  });

  it('S4: Volume again after Uniform is the volume it was colored by, not the first', async () => {
    const { v, c, read } = await viewer();
    expectOk(await v.api.load.files({ files: [new File([mrcOf(48, 2, (x) => x)], 'ramp.mrc')] }));
    expectOk(await c.mesh({ mesh: 'points.vtp', volume: 'ramp.mrc' } as never));
    expectOk(await c.mesh({ mesh: 'points.vtp', color: 'tomato' } as never));
    const m = await read('points.vtp');
    expect(m.volumeKept).toMatchObject({ label: 'ramp.mrc' });
  });
});
