/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec3, Vec4 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { Shape } from '@molstar/model/model/shape';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import type { GraphicsContext } from '@molstar/graphics/gl/context';
import type { TextureImage } from '@molstar/graphics/gl/renderable/util';
import type { Texture } from '@molstar/graphics/gl/texture';
import { ShapeRepresentation } from '../representation.js';

// A shape's color grid (`Shape.colorGrid`): its mesh colored by the grid, read per fragment where the representation
// has a graphics context (the grid uploaded in the 2d layout of the grid color types), at its vertices without one.

/** A grid of `dim` cells 1 Å apart from the origin, the red of cell (i, j, k) ten times its index (x fastest) */
function getGrid(dim: [number, number, number]): Shape.ColorGrid {
  const [xn, yn, zn] = dim;
  const colors = new Uint8Array(4 * xn * yn * zn);
  for (let c = 0; c < xn * yn * zn; c++) {
    colors[4 * c] = 10 * c;
    colors[4 * c + 3] = 255;
  }
  return { colors, dimension: Vec3.create(xn, yn, zn), transform: Vec4.create(0, 0, 0, 1) };
}

function getShape(colorGrid?: Shape.ColorGrid): Shape<Mesh> {
  const state = MeshBuilder.createState(16, 16);
  MeshBuilder.addTriangle(state, Vec3.create(0, 0, 0), Vec3.create(0.5, 0, 0), Vec3.create(1, 1, 3));
  const shape = Shape.create(
    'triangle',
    {},
    MeshBuilder.getMesh(state),
    () => Color(0x00ff00),
    () => 1,
    () => '',
    1,
  );
  return colorGrid ? { ...shape, colorGrid } : shape;
}

/** A graphics context making stub textures, which keep what they are loaded with */
function getGraphics() {
  const textures: (Texture & { image?: TextureImage<Uint8Array>; destroyed: boolean })[] = [];
  const graphics = {
    capabilities: { flatInterpolation: true },
    resources: {
      limits: { maxTextureSize: 4096 },
      ownsTexture: (t: Texture) => textures.includes(t as never),
      texture: () => {
        const t = {
          image: undefined as TextureImage<Uint8Array> | undefined,
          destroyed: false,
          getWidth: () => t.image?.width ?? 0,
          getHeight: () => t.image?.height ?? 0,
          load: (image: TextureImage<Uint8Array>) => {
            t.image = image;
          },
          destroy: () => {
            t.destroyed = true;
          },
        };
        textures.push(t as never);
        return t;
      },
    },
  } as unknown as GraphicsContext;
  return { graphics, textures };
}

describe('shape representation, color grid', () => {
  it('reads the grid per fragment, uploaded in the 2d layout of the grid color types', async () => {
    const { graphics, textures } = getGraphics();
    const repr = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils, { graphics });
    await repr.createOrUpdate({}, getShape(getGrid([2, 2, 4]))).run();
    const values = repr.renderObjects[0].values;
    expect(values.colorType.ref.value).toBe('volume');
    expect(values.dColorType.ref.value).toBe('grid');
    expect(values.dColorGridFragment.ref.value).toBe(true);
    expect(Array.from(values.uColorGridDim.ref.value)).toEqual([2, 2, 4]);
    expect(Array.from(values.uColorGridTransform.ref.value)).toEqual([0, 0, 0, 1]);
    expect(textures.length).toBe(1);
    expect(values.tColorGrid.ref.value).toBe(textures[0]);
    // 2 × 2 slices in a 4 × 4 image: slice k in column k % 2, row ⌊k / 2⌋
    const image = textures[0].image!;
    expect([image.width, image.height]).toEqual([4, 4]);
    expect(Array.from(values.uColorGridTexDim.ref.value)).toEqual([4, 4]);
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const texel = Math.floor(k / 2) * 8 + (k % 2) * 2 + j * 4 + i;
          expect(image.array[4 * texel]).toBe(10 * (i + 2 * (j + 2 * k)));
        }
      }
    }
  });

  it('reuses its texture for a new grid, colors by the shape again without one, destroys it with itself', async () => {
    const { graphics, textures } = getGraphics();
    const repr = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils, { graphics });
    await repr.createOrUpdate({}, getShape(getGrid([2, 2, 4]))).run();
    await repr.createOrUpdate({}, getShape(getGrid([3, 2, 4]))).run();
    const values = repr.renderObjects[0].values;
    expect(textures.length).toBe(1);
    expect(Array.from(values.uColorGridDim.ref.value)).toEqual([3, 2, 4]);

    await repr.createOrUpdate({}, getShape()).run();
    expect(values.dColorGridFragment.ref.value).toBe(false);
    expect(values.dColorType.ref.value).not.toBe('grid');

    repr.destroy();
    expect(textures[0].destroyed).toBe(true);
  });

  it('colors the vertices by the grid (trilinear) without a graphics context', async () => {
    const repr = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils);
    await repr.createOrUpdate({}, getShape(getGrid([2, 2, 4]))).run();
    const values = repr.renderObjects[0].values;
    expect(values.colorType.ref.value).toBe('vertex');
    expect(values.dColorGridFragment.ref.value).toBe(false);
    const colors = values.tColor.ref.value.array;
    // cell (0, 0, 0); halfway to cell (1, 0, 0); cell (1, 1, 3)
    expect(colors[0]).toBe(0);
    expect(colors[4]).toBe(5);
    expect(colors[8]).toBe(10 * (1 + 2 * (1 + 2 * 3)));
  });

  it('colors the vertices too when the grid does not fit a texture', async () => {
    const { graphics, textures } = getGraphics();
    (graphics.resources.limits as { maxTextureSize: number }).maxTextureSize = 2;
    const repr = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils, { graphics });
    await repr.createOrUpdate({}, getShape(getGrid([2, 2, 4]))).run();
    expect(repr.renderObjects[0].values.colorType.ref.value).toBe('vertex');
    expect(textures.length).toBe(0);
  });

  // review M1: a grid longer in x than its other sides together (a filament along x) laid out as one column of slices
  it('draws a grid long in x, by a texture and at the vertices', async () => {
    const grid = getGrid([305, 7, 7]);
    const { graphics, textures } = getGraphics();
    const repr = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils, { graphics });
    await repr.createOrUpdate({}, getShape(grid)).run();
    const image = textures[0].image!;
    expect([image.width, image.height]).toEqual([305, 49]);
    // cell (2, 1, 3): slice 3 in row 3
    expect(image.array[4 * (3 * 7 * 305 + 305 + 2)]).toBe(grid.colors[4 * (2 + 305 * (1 + 7 * 3))]);
    const cpu = ShapeRepresentation((_, s: Shape<Mesh>) => s, Mesh.Utils);
    await cpu.createOrUpdate({}, getShape(grid)).run();
    expect(cpu.renderObjects[0].values.tColor.ref.value.array[8]).toBe(grid.colors[4 * (1 + 305 * (1 + 7 * 3))]);
  });
});
