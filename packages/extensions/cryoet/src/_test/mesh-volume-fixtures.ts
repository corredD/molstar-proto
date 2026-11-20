/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Tensor, type Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';

// Meshes and maps of the volume-coloring tests, made in memory.

export interface TestMesh {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** A UV sphere: `rings` rings between its poles, `segments` around, its triangles counter-clockwise from outside */
export function sphereMesh(radius: number, center: Vec3, rings: number, segments: number): TestMesh {
  const vertices: number[] = [center[0], center[1], center[2] + radius];
  for (let r = 1; r < rings; r++) {
    const theta = (Math.PI * r) / rings;
    for (let s = 0; s < segments; s++) {
      const phi = (2 * Math.PI * s) / segments;
      vertices.push(
        center[0] + radius * Math.sin(theta) * Math.cos(phi),
        center[1] + radius * Math.sin(theta) * Math.sin(phi),
        center[2] + radius * Math.cos(theta),
      );
    }
  }
  vertices.push(center[0], center[1], center[2] - radius);
  const south = vertices.length / 3 - 1;
  const at = (r: number, s: number) => 1 + (r - 1) * segments + (s % segments);
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) indices.push(0, at(1, s), at(1, s + 1));
  for (let r = 1; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      indices.push(at(r, s), at(r + 1, s), at(r + 1, s + 1), at(r, s), at(r + 1, s + 1), at(r, s + 1));
    }
  }
  for (let s = 0; s < segments; s++) indices.push(at(rings - 1, s), south, at(rings - 1, s + 1));
  return {
    vertices: Float32Array.from(vertices),
    indices: Uint32Array.from(indices),
    vertexCount: vertices.length / 3,
    triangleCount: indices.length / 3,
  };
}

/** A square of side `size` about (cx, cy) at height z, normal +z, of two triangles */
export function squareMesh(size: number, cx: number, cy: number, z: number): TestMesh {
  const h = size / 2;
  return {
    vertices: Float32Array.of(cx - h, cy - h, z, cx + h, cy - h, z, cx + h, cy + h, z, cx - h, cy + h, z),
    indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
    vertexCount: 4,
    triangleCount: 2,
  };
}

/**
 * A mesh as a VTP (ascii): its point array `Curvature` (the vertex's z) when `point`, its cell array `Labels` (the
 * triangle's index) when `cell`
 */
export function vtpOf(mesh: TestMesh, arrays: { point?: boolean; cell?: boolean }): string {
  const fmt = (a: ArrayLike<number>) => Array.from(a, (x) => +x.toFixed(4)).join(' ');
  const z = Array.from({ length: mesh.vertexCount }, (_, i) => mesh.vertices[3 * i + 2]);
  const labels = Array.from({ length: mesh.triangleCount }, (_, i) => i);
  const offsets = Array.from({ length: mesh.triangleCount }, (_, i) => 3 * (i + 1));
  return `<?xml version="1.0"?>
<VTKFile type="PolyData" version="0.1" byte_order="LittleEndian">
  <PolyData>
    <Piece NumberOfPoints="${mesh.vertexCount}" NumberOfPolys="${mesh.triangleCount}">
      <PointData>${arrays.point ? `<DataArray type="Float32" Name="Curvature" NumberOfComponents="1" format="ascii">${fmt(z)}</DataArray>` : ''}</PointData>
      <CellData>${arrays.cell ? `<DataArray type="Int32" Name="Labels" NumberOfComponents="1" format="ascii">${fmt(labels)}</DataArray>` : ''}</CellData>
      <Points>
        <DataArray type="Float32" Name="Points" NumberOfComponents="3" format="ascii">${fmt(mesh.vertices)}</DataArray>
      </Points>
      <Polys>
        <DataArray type="Int32" Name="connectivity" format="ascii">${fmt(mesh.indices)}</DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">${fmt(offsets)}</DataArray>
      </Polys>
    </Piece>
  </PolyData>
</VTKFile>
`;
}

/** A mesh as an OBJ */
export function objOf(mesh: TestMesh): string {
  const lines: string[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    lines.push(`v ${mesh.vertices[3 * i]} ${mesh.vertices[3 * i + 1]} ${mesh.vertices[3 * i + 2]}`);
  }
  for (let t = 0; t < mesh.triangleCount; t++) {
    lines.push(`f ${mesh.indices[3 * t] + 1} ${mesh.indices[3 * t + 1] + 1} ${mesh.indices[3 * t + 2] + 1}`);
  }
  return `${lines.join('\n')}\n`;
}

/** An MRC of n³ voxels of `voxel` Å from the origin, its values f(x, y, z) at each voxel's place in Å */
export function mrcOf(n: number, voxel: number, f: (x: number, y: number, z: number) => number): ArrayBuffer {
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) values[i + n * (j + n * k)] = f(i * voxel, j * voxel, k * voxel);
    }
  }
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.fromUniformScaling(Mat4(), voxel) },
    cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: 0, max: 0, mean: 0, sigma: 0 },
  };
  return CCP4Writer.writeMrc(grid, values);
}

/** A grid of n³ voxels of `voxel` Å, voxel 0 at `origin`, its values f(x, y, z) at each voxel's place in Å */
export function gridOf(n: number, voxel: number, origin: Vec3, f: (x: number, y: number, z: number) => number): Grid {
  const values = new Float32Array(n * n * n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = f(origin[0] + i * voxel, origin[1] + j * voxel, origin[2] + k * voxel);
        values[i + n * (j + n * k)] = v;
        sum += v;
      }
    }
  }
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  const matrix = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), origin), Mat4.fromUniformScaling(Mat4(), voxel));
  return {
    transform: { kind: 'matrix', matrix },
    cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: {
      min: values.reduce((a, b) => Math.min(a, b)),
      max: values.reduce((a, b) => Math.max(a, b)),
      mean,
      sigma: Math.sqrt(sq / values.length),
    },
  };
}
