/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Lines } from '../lines/lines.js';
import { Mesh } from '../mesh/mesh.js';
import { MeshBuilder } from '../mesh/mesh-builder.js';
import { ChunkedArray } from '@molstar/core/data/util';

/** A mesh of `triangles`, with `vertices` given as flat xyz and one group id per vertex. */
function meshOf(vertices: number[], groups: number[], triangles: number[]): Mesh {
  const state = MeshBuilder.createState(vertices.length / 3, triangles.length / 3);
  for (let i = 0; i < vertices.length; i += 3) {
    ChunkedArray.add3(state.vertices, vertices[i], vertices[i + 1], vertices[i + 2]);
    ChunkedArray.add(state.groups, groups[i / 3]);
  }
  for (let i = 0; i < triangles.length; i += 3) {
    ChunkedArray.add3(state.indices, triangles[i], triangles[i + 1], triangles[i + 2]);
  }
  return MeshBuilder.getMesh(state);
}

/** The set of `${min}-${max}` vertex-index pairs of the lines, matched by position. */
function edgeKeys(lines: Lines, vertices: number[]) {
  const starts = lines.startBuffer.ref.value;
  const ends = lines.endBuffer.ref.value;
  const indexOf = (x: number, y: number, z: number) => {
    for (let i = 0; i < vertices.length; i += 3) {
      if (vertices[i] === x && vertices[i + 1] === y && vertices[i + 2] === z) return i / 3;
    }
    return -1;
  };
  const keys: string[] = [];
  // Each line is expanded into 4 mapped vertices, all sharing the same start/end.
  for (let i = 0, il = lines.lineCount; i < il; ++i) {
    const o = i * 4 * 3;
    const a = indexOf(starts[o], starts[o + 1], starts[o + 2]);
    const b = indexOf(ends[o], ends[o + 1], ends[o + 2]);
    keys.push(`${Math.min(a, b)}-${Math.max(a, b)}`);
  }
  return keys;
}

describe('Lines.fromMesh', () => {
  // Two triangles sharing the edge 1-2: 5 distinct edges, not 6.
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
  const groups = [0, 1, 2, 3];
  const triangles = [0, 1, 2, 1, 3, 2];

  it('emits each edge once, including the shared one', () => {
    const lines = Lines.fromMesh(meshOf(vertices, groups, triangles));
    const keys = edgeKeys(lines, vertices);
    expect(lines.lineCount).toBe(5);
    expect(new Set(keys).size).toBe(5);
    expect(keys).toEqual(expect.arrayContaining(['0-1', '0-2', '1-2', '1-3', '2-3']));
  });

  it('keeps the mesh group ids so coloring and picking carry over', () => {
    const lines = Lines.fromMesh(meshOf(vertices, groups, triangles));
    const gb = lines.groupBuffer.ref.value;
    const seen = new Set<number>();
    for (let i = 0, il = lines.lineCount * 4; i < il; ++i) seen.add(gb[i]);
    // Each edge takes the group of the endpoint it was added from -- 0, 0, 1 for the first
    // triangle and 1, 3 for the second, so vertex 2's group never appears.
    expect([...seen].sort()).toEqual([0, 1, 3]);
  });

  it('emits each edge once around a vertex shared by many triangles', () => {
    // a closed fan of 8 triangles around vertex 0: 8 spokes and 8 rim edges
    const fan = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, -1, 1, 0, -1, 0, 0, -1, -1, 0, 0, -1, 0, 1, -1, 0];
    const fanGroups = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const fanTriangles: number[] = [];
    for (let i = 0; i < 8; i++) fanTriangles.push(0, i + 1, ((i + 1) % 8) + 1);
    const lines = Lines.fromMesh(meshOf(fan, fanGroups, fanTriangles));
    expect(lines.lineCount).toBe(16);
    expect(new Set(edgeKeys(lines, fan)).size).toBe(16);
  });

  it('reuses the buffers of a given `Lines`', () => {
    const first = Lines.fromMesh(meshOf(vertices, groups, triangles));
    const second = Lines.fromMesh(meshOf(vertices, groups, triangles), first);
    expect(second).toBe(first);
    expect(second.lineCount).toBe(5);
  });
});
