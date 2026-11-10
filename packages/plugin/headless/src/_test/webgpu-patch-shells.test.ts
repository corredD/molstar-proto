/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec2 } from '@molstar/core/math/linear-algebra/3d/vec2';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Color } from '@molstar/core/util/color';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import { LocationIterator } from '@molstar/graphics/geo/util/location-iterator';
import { createRenderObject } from '@molstar/graphics/gl/render-object';
import { Representation } from '@molstar/graphics/repr/representation';
import type { ColorTheme } from '@molstar/graphics/theme/color';
import { UniformSizeTheme } from '@molstar/graphics/theme/size/uniform';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

// A patch mesh drawn as shells (`MeshSchema.uPatchShells`, lipid-procedural round 8 §2): a square of two triangles, an
// 8 × 8 patch whose alpha (the heads' height) steps by column, four instances the four shells. Shell k sits at
// lo + k (hi − lo) / 3 along the normal (from the surface at the mean) and is kept where the height reaches it, so seen
// from above each texel shows its highest passing shell: in colour (each instance its own), in the pick pass (its
// instance) and in depth (the pick's position), the passes discarding the same pixels.

const Size = 128;
const Box = 100;
const N = 4;
/** the heights: lo 0, hi 12, the surface at 6 (shell k at z = 4k − 6) */
const Lo = 0;
const Hi = 12;
const Mean = 6;
/** alpha by column: each level's midway between two shells' cuts (a texel's filtering never crosses one) */
const Alpha = [0, 85, 170, 255, 0, 255, 170, 85];
/** the top shell a column shows: the last k with A ≥ 255 (k − ½) / (N − 1), the base (0) always */
const topShell = (a: number) => {
  let top = 0;
  for (let k = 1; k < N; ++k) if (a >= (255 * (k - 0.5)) / (N - 1)) top = k;
  return top;
};
const InstanceColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
const TableWidth = 1024;

/** the table: plane 0 the z = 0 plane, 4,096 cells mapping p to p (a cell of 1,000 Å at (0, 0)), no shifts */
function table() {
  const texels = 4 + 4096 + 2;
  const array = new Float32Array(TableWidth * Math.ceil(texels / TableWidth) * 4);
  array.set([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0]);
  for (let k = 0; k < 4096; ++k) array.set([5, 5, 1, 0], (4 + k) * 4);
  return { array, width: TableWidth, height: Math.ceil(texels / TableWidth) };
}

async function draw(middle: 'shells' | 'beneath' | 'parallax' = 'shells') {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
  try {
    await plugin.init();
    const canvas = plugin.canvas3d!;
    canvas.setProps({ camera: { mode: 'orthographic' }, cameraFog: { name: 'off', params: {} } } as never);
    const graphics = canvas.graphics;
    const patch = graphics.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; ++y) for (let x = 0; x < 8; ++x) pixels.set([128, 128, 128, Alpha[x]], (y * 8 + x) * 4);
    patch.load({ array: pixels, width: 8, height: 8 });
    patch.mipmap();
    const patchTable = graphics.resources.texture('image-float32', 'rgba', 'float', 'nearest');
    patchTable.load(table());
    const positions = Float32Array.of(0, 0, 0, Box, 0, 0, Box, Box, 0, 0, Box, 0);
    const normals = Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    const mesh = Mesh.create(positions, Uint32Array.of(0, 1, 2, 0, 2, 3), normals, new Float32Array(4), 4, 2);
    const props = { ...PD.getDefaultValues(Mesh.Params), ignoreLight: true, doubleSided: true };
    // each shell (instance) its own colour: the patch's colour off (the levels' far colour, the theme's, everywhere)
    const color = {
      granularity: 'instance',
      color: (location: { instance: number }) => Color(InstanceColors[location.instance]),
      props: {},
      description: '',
    } as unknown as ColorTheme<any>;
    const instances = middle === 'shells' ? N : 1;
    const transforms = new Float32Array(16 * instances);
    for (let k = 0; k < instances; ++k) Mat4.toArray(Mat4.identity(), transforms, k * 16);
    const values = Mesh.Utils.createValues(
      mesh,
      createTransform(transforms, instances, undefined, 0, -1),
      LocationIterator(1, instances, 1, (_g, instance) => ({ instance }) as never),
      { color, size: UniformSizeTheme({}, { value: 1 }) },
      props,
    );
    ValueCell.update(values.dPatchTexture, true);
    ValueCell.update(values.tPatch, patch);
    ValueCell.update(values.tPatchTable, patchTable);
    ValueCell.update(values.uPatch, Vec4.create(1000, Box, Box, 4));
    ValueCell.update(values.uPatchLevels, Vec4.create(1, 1e6, 2e6, 1));
    ValueCell.update(values.uPatchShells, Vec4.create(N, Lo, Hi, Mean));
    // the middle look on at every px (shells: the band's own range, [0, ∞))
    ValueCell.update(values.dPatchMiddle, middle);
    ValueCell.update(values.uPatchMiddle, Vec4.create(0, 1e9, 0, 0));
    const object = createRenderObject('mesh', values, Mesh.Utils.createRenderableState(props), -1);
    canvas.add(Representation.fromRenderObject('shells', object));
    canvas.camera.setState(
      { position: Vec3.create(Box / 2, Box / 2, 500), target: Vec3.create(Box / 2, Box / 2, 0), up: Vec3.unitY },
      0,
    );
    await plugin.getImageRaw({ width: Size, height: Size });
    const image = (await plugin.getImageRaw({ width: Size, height: Size })).data;
    const errors = graphics.takeErrors?.() ?? [];
    // the square's bounds on screen
    const bg = Array.from(image.subarray(0, 3)).join();
    let x0 = Size;
    let y0 = Size;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < Size; ++y) {
      for (let x = 0; x < Size; ++x) {
        const o = (y * Size + x) * 4;
        if (Array.from(image.subarray(o, o + 3)).join() === bg) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    // per column, at its texels' centres along the square's middle row: the colour's shell, the pick's
    const columns: { color: number; pick: number; z: number }[] = [];
    let time = 0;
    for (let i = 0; i < 8; ++i) {
      const x = Math.round(x0 + ((i + 0.5) / 8) * (x1 - x0));
      const y = Math.round((y0 + y1) / 2);
      const o = (y * Size + x) * 4;
      const c = [image[o], image[o + 1], image[o + 2]];
      const shell = InstanceColors.findIndex(
        (q) =>
          ((q >> 16) & 255) > 0 === c[0] > 128 && ((q >> 8) & 255) > 0 === c[1] > 128 && (q & 255) > 0 === c[2] > 128,
      );
      let pick: { id: { instanceId: number }; position: Vec3 } | undefined;
      for (let tries = 0; tries < 20 && !pick; ++tries) {
        canvas.commit(true);
        canvas.requestDraw();
        canvas.tick((time += 1000) as never, { isSynchronous: true });
        await canvas.graphics.resources.pending.whenReady();
        pick = await canvas.asyncIdentify(Vec2.create(x, y))?.wait();
      }
      columns.push({ color: shell, pick: pick ? pick.id.instanceId : -1, z: pick ? pick.position[2] : NaN });
    }
    patch.destroy();
    patchTable.destroy();
    return { columns, errors, width: x1 - x0 };
  } finally {
    plugin.dispose();
  }
}

describe.skipIf(!WebGPU.module)('a patch mesh’s shells (WebGPU)', () => {
  it('keeps each shell where the height reaches it, in colour, pick and depth alike', async () => {
    const { columns, errors, width } = await draw();
    expect(errors).toEqual([]);
    expect(width).toBeGreaterThan(Size / 3);
    const want = Alpha.map(topShell);
    // the screen's x is the square's x or −x (the camera's handedness): either order of the columns
    const seen = columns.map((c) => c.color);
    const ordered = seen[0] === want[0] && seen[1] === want[1] ? want : [...want].reverse();
    expect(seen).toEqual(ordered);
    expect(columns.map((c) => c.pick)).toEqual(ordered);
    // depth: each column's pick at its shell's height, 4k − 6 Å
    for (let i = 0; i < 8; ++i)
      expect(columns[i].z, `column ${i}`).toBeCloseTo(Lo - Mean + (ordered[i] * (Hi - Lo)) / (N - 1), 0);
  }, 60_000);

  it('draws parallax and a surface beneath the shells with no error (beneath: nothing where the middle look draws)', async () => {
    const parallax = await draw('parallax');
    expect(parallax.errors).toEqual([]);
    expect(parallax.width).toBeGreaterThan(Size / 3);
    const beneath = await draw('beneath');
    expect(beneath.errors).toEqual([]);
    expect(beneath.width).toBeLessThan(0);
  }, 60_000);
});
