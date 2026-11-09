/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec4 } from '@molstar/core/math/linear-algebra/3d/vec4';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Color } from '@molstar/core/util/color';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { createIdentityTransform } from '@molstar/graphics/geo/geometry/transform-data';
import { LocationIterator } from '@molstar/graphics/geo/util/location-iterator';
import { createRenderObject } from '@molstar/graphics/gl/render-object';
import { Representation } from '@molstar/graphics/repr/representation';
import type { ColorTheme } from '@molstar/graphics/theme/color';
import { UniformSizeTheme } from '@molstar/graphics/theme/size/uniform';
import { HeadlessPluginContext } from '@molstar/plugin-headless/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { WebGPU } from './webgpu-module.js';

// A mesh's patch texture (`MeshSchema.dPatchTexture`, WebGPU; review S6): a square of two triangles in one plane, the
// patch a 4 × 4 texture of four coloured quadrants over a box of 100 Å, one cell over the square whose kind maps the
// patch's point to itself. Drawn, the square shows the four quadrants; each vertex's shift (the table's texels after
// the cells) moves the point read, half a box swapping the quadrants' columns or rows.

const Size = 128;
const Box = 100;
/** the four quadrants' colours, (x, y) = (0, 0), (1, 0), (0, 1), (1, 1) */
const Quadrants = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];
const TableWidth = 1024;

function patchTexel(x: number, y: number) {
  return Quadrants[(y >= 2 ? 2 : 0) + (x >= 2 ? 1 : 0)];
}

/** the table: plane 0 the z = 0 plane, 4,096 cells mapping p to p (a cell of 1,000 Å at (0, 0)), the vertices' shifts */
function table(shift: [number, number]) {
  const texels = 4 + 4096 + 2;
  const array = new Float32Array(TableWidth * Math.ceil(texels / TableWidth) * 4);
  // origin and offset x, e1 and offset y, e2 and cos, normal and sin
  array.set([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0]);
  for (let k = 0; k < 4096; ++k) array.set([5, 5, 1, 0], (4 + k) * 4);
  for (let v = 0; v < 4; ++v) array.set(shift, (4 + 4096) * 4 + v * 2);
  return { array, width: TableWidth, height: Math.ceil(texels / TableWidth) };
}

async function draw(shift: [number, number]) {
  const plugin = await HeadlessPluginContext.create(
    { webgpu: WebGPU.module! },
    DefaultPluginSpec(),
    { width: Size, height: Size },
    { backend: 'webgpu' },
  );
  try {
    await plugin.init();
    const canvas = plugin.canvas3d!;
    const graphics = canvas.graphics;
    const patch = graphics.resources.texture('image-uint8', 'rgba', 'ubyte', 'linear');
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; ++y) for (let x = 0; x < 4; ++x) pixels.set([...patchTexel(x, y), 255], (y * 4 + x) * 4);
    patch.load({ array: pixels, width: 4, height: 4 });
    patch.mipmap();
    const patchTable = graphics.resources.texture('image-float32', 'rgba', 'float', 'nearest');
    patchTable.load(table(shift));
    // the square [0, 100]² in z = 0, its own four vertices, group 0 (plane 0)
    const positions = Float32Array.of(0, 0, 0, Box, 0, 0, Box, Box, 0, 0, Box, 0);
    const normals = Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    const mesh = Mesh.create(positions, Uint32Array.of(0, 1, 2, 0, 2, 3), normals, new Float32Array(4), 4, 2);
    const props = { ...PD.getDefaultValues(Mesh.Params), ignoreLight: true, doubleSided: true };
    const color = {
      granularity: 'uniform',
      color: () => Color(0x808080),
      props: {},
      description: '',
    } as unknown as ColorTheme<any>;
    const values = Mesh.Utils.createValues(
      mesh,
      createIdentityTransform(),
      LocationIterator(1, 1, 1, () => ({}) as never),
      { color, size: UniformSizeTheme({}, { value: 1 }) },
      props,
    );
    ValueCell.update(values.dPatchTexture, true);
    ValueCell.update(values.tPatch, patch);
    ValueCell.update(values.tPatchTable, patchTable);
    // a cell of 1,000 Å, the box, the cells' first texel; the far colour's blend off
    ValueCell.update(values.uPatch, Vec4.create(1000, Box, Box, 4));
    ValueCell.update(values.uPatchLevels, Vec4.create(0, 0, 0, 1));
    const object = createRenderObject('mesh', values, Mesh.Utils.createRenderableState(props), -1);
    canvas.add(Representation.fromRenderObject('patch', object));
    canvas.requestCameraReset({ durationMs: 0 });
    await plugin.getImageRaw({ width: Size, height: Size });
    const image = (await plugin.getImageRaw({ width: Size, height: Size })).data;
    const errors = graphics.takeErrors?.() ?? [];
    // the square's quadrants' centres on screen: its drawn bounds (the background is the corner's)
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
    const at = (fx: number, fy: number) => {
      const x = Math.round(x0 + fx * (x1 - x0));
      const y = Math.round(y0 + fy * (y1 - y0));
      const o = (y * Size + x) * 4;
      return [image[o], image[o + 1], image[o + 2]];
    };
    // the quadrants on screen, by the image's own axes: [left top, right top, left bottom, right bottom]
    const quadrants = [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
    patch.destroy();
    patchTable.destroy();
    return { quadrants, errors, width: x1 - x0 };
  } finally {
    plugin.dispose();
  }
}

/** the quadrant colour a pixel is (each channel on or off), its index in `Quadrants` */
const which = (c: number[]) => Quadrants.findIndex((q) => q.every((v, i) => v > 0 === c[i] > 128));

describe.skipIf(!WebGPU.module)('a mesh’s patch texture (WebGPU)', () => {
  it('maps the patch by its plane and cell, and moves it by each vertex’s shift', async () => {
    const plain = await draw([0, 0]);
    expect(plain.errors).toEqual([]);
    expect(plain.width).toBeGreaterThan(Size / 3);
    const seen = plain.quadrants.map(which);
    // the four quadrants, each once
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    // half a box along x: each row's two quadrants swapped (x on screen is x or −x: either way the columns swap)
    const shiftedX = (await draw([Box / 2, 0])).quadrants.map(which);
    expect(shiftedX).toEqual([seen[1], seen[0], seen[3], seen[2]]);
    // along y: the rows swapped
    const shiftedY = (await draw([0, Box / 2])).quadrants.map(which);
    expect(shiftedY).toEqual([seen[2], seen[3], seen[0], seen[1]]);
  }, 60_000);
});
