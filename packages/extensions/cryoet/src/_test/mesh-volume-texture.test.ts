/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Grid } from '@molstar/model/model/volume';
import { type ColorBand, colorBand, meshSamplePoints, sampleVolume } from '../mesh-volume.js';
import { gridOf, sphereMesh, squareMesh } from './mesh-volume-fixtures.js';

// Color by › Volume, Detail Texture (apps/prism-me/progress/2026-11-14-mesh-volume-texture.md): a color grid at the
// volume's voxels in the mesh's own frame, its cells near the surface (the band, the only ones a pixel reads) sampled
// as the vertices are: at the cell, or along the nearest surface point's normal within ±Depth.

const sigmaOf = (g: Grid, v: number) => (v - g.stats.mean) / g.stats.sigma;
/** A linear field: trilinear interpolation reads it exactly */
const linear = (x: number, y: number, z: number) => x + 2 * y + 3 * z;

/** The center of band cell `n` in the mesh's frame, from the grid's transform */
function cellCenter(band: ColorBand, n: number) {
  const [xn, yn] = band.dimension;
  const c = band.cells[n];
  const ijk = [c % xn, Math.floor(c / xn) % yn, Math.floor(c / (xn * yn))];
  return Vec3.create(
    band.transform[0] + ijk[0] / band.transform[3],
    band.transform[1] + ijk[1] / band.transform[3],
    band.transform[2] + ijk[2] / band.transform[3],
  );
}

describe('a color grid at the voxels of a volume (Detail Texture)', () => {
  it("at surface: the band's cells hold the volume at their centers, where the mesh is drawn (scaled, moved)", () => {
    const g = gridOf(48, 2, Vec3(), linear);
    const square = squareMesh(20, 24, 24, 24);
    // the square in nm, drawn ×10 Å and moved
    const move = Vec3.create(3, -2, 5);
    const nm = { ...square, vertices: square.vertices.map((v, i) => (v - move[i % 3]) / 10) };
    const drawn = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), move), Mat4.fromUniformScaling(Mat4(), 10));
    const band = colorBand(nm, drawn, g);
    // a cell of a voxel where drawn: 2 Å, a fifth of a nm
    expect(band.spacing).toBeCloseTo(2, 6);
    expect(band.transform[3]).toBeCloseTo(5, 4);
    expect(band.cells.length).toBe(band.points.count);
    expect(band.cells.length).toBeGreaterThan(100);
    const values = sampleVolume(band.points, drawn, g, 'surface', 0);
    const p = Vec3();
    for (let n = 0; n < band.cells.length; n++) {
      Vec3.transformMat4(p, cellCenter(band, n), drawn);
      // the band's points are the cells' centers
      expect(band.points.positions[3 * n]).toBeCloseTo(cellCenter(band, n)[0], 4);
      expect(values[n]).toBeCloseTo(sigmaOf(g, linear(p[0], p[1], p[2])), 3);
    }
  });

  it('holds the cells every pixel of the mesh reads: those about each point of its triangles', () => {
    const square = squareMesh(10, 20, 20, 20);
    const band = colorBand(square, Mat4.identity(), gridOf(48, 1, Vec3(), linear));
    const cells = new Set(band.cells);
    const [xn, yn] = band.dimension;
    const w = band.transform[3];
    for (let k = 0; k < 400; k++) {
      // a point of the square (z = 20) and the 8 cells it is interpolated between
      const x = 15 + (10 * ((k * 37) % 400)) / 400;
      const y = 15 + (10 * ((k * 91) % 400)) / 400;
      const g = [(x - band.transform[0]) * w, (y - band.transform[1]) * w, (20 - band.transform[2]) * w];
      for (let c = 0; c < 8; c++) {
        const i = Math.floor(g[0]) + (c & 1);
        const j = Math.floor(g[1]) + ((c >> 1) & 1);
        const l = Math.floor(g[2]) + ((c >> 2) & 1);
        expect(cells.has(i + xn * (j + yn * l))).toBe(true);
      }
    }
    // and only those: within 2 cells of the square's plane
    for (let n = 0; n < band.cells.length; n++) expect(Math.abs(cellCenter(band, n)[2] - 20)).toBeLessThanOrEqual(2);
  });

  it('a striped volume under two triangles: the grid holds the stripes, the vertices only the corners', () => {
    // stripes along x every 4 Å, under a square 40 Å wide at 1 Å voxels
    const stripes = (x: number) => (Math.floor(x / 4) % 2 ? 1 : -1);
    const g = gridOf(64, 1, Vec3(), stripes);
    const square = squareMesh(40, 32, 32, 32);
    const corners = sampleVolume(meshSamplePoints(square), Mat4.identity(), g, 'surface', 0);
    expect(corners.length).toBe(4);
    const band = colorBand(square, Mat4.identity(), g);
    const values = sampleVolume(band.points, Mat4.identity(), g, 'surface', 0);
    // the cells on the volume's voxels: each holds a voxel's value
    for (const v of values) expect([sigmaOf(g, -1), sigmaOf(g, 1)].some((x) => Math.abs(v - x) < 1e-4)).toBe(true);
    // along y = 32 in the square's plane: the band's values change sign at each stripe
    const row = new Map<number, number>();
    for (let n = 0; n < band.cells.length; n++) {
      const c = cellCenter(band, n);
      if (c[1] === 32 && c[2] === 32 && c[0] >= 12 && c[0] <= 52) row.set(c[0], values[n]);
    }
    const xs = [...row.keys()].sort((a, b) => a - b);
    let changes = 0;
    for (let i = 1; i < xs.length; i++) if (Math.sign(row.get(xs[i])!) !== Math.sign(row.get(xs[i - 1])!)) changes++;
    expect(changes).toBeGreaterThanOrEqual(9);
  });

  it('projected: a band cell next to a vertex reads what the vertex reads, within 0.3σ', () => {
    // a dark shell of radius 30 Å, the sphere 4 Å off it: Min ±8 Å finds it from the vertices and from the band
    const center = Vec3.create(40, 40, 40);
    const g = gridOf(80, 1, Vec3(), (x, y, z) => -Math.exp(-(((Math.hypot(x - 40, y - 40, z - 40) - 30) / 3) ** 2)));
    const sphere = sphereMesh(34, center, 24, 48);
    const points = meshSamplePoints(sphere);
    const atVertices = sampleVolume(points, Mat4.identity(), g, 'min', 8);
    const band = colorBand(sphere, Mat4.identity(), g);
    const values = sampleVolume(band.points, Mat4.identity(), g, 'min', 8);
    const byCell = new Map<number, number>();
    for (let n = 0; n < band.cells.length; n++) byCell.set(band.cells[n], values[n]);
    const [xn, yn] = band.dimension;
    const w = band.transform[3];
    let checked = 0;
    for (let i = 0; i < points.count; i++) {
      // the cell nearest the vertex
      const ijk = [0, 1, 2].map((d) => Math.round((points.positions[3 * i + d] - band.transform[d]) * w));
      const v = byCell.get(ijk[0] + xn * (ijk[1] + yn * ijk[2]));
      expect(v).toBeDefined();
      expect(Math.abs(v! - atVertices[i])).toBeLessThan(0.3);
      checked++;
    }
    expect(checked).toBe(points.count);
  });

  it('a grid over its cap is coarser: its cells fewer than the cap, their side stated', () => {
    const sphere = sphereMesh(30, Vec3.create(40, 40, 40), 12, 24);
    const g = gridOf(80, 1, Vec3(), linear);
    const full = colorBand(sphere, Mat4.identity(), g);
    expect(full.spacing).toBe(1);
    const capped = colorBand(sphere, Mat4.identity(), g, 32 ** 3);
    expect(capped.dimension[0] * capped.dimension[1] * capped.dimension[2]).toBeLessThanOrEqual(32 ** 3);
    expect(capped.spacing).toBeGreaterThan(1);
    expect(capped.transform[3]).toBeCloseTo(1 / capped.spacing, 6);
  });
});
