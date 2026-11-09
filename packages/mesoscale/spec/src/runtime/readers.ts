/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Resource } from '../format/doc.js';
import type { MeshData, ResourceReader } from './resolver.js';

// Readers (_spec/format.md): a resource's raw content made usable, by its native format. Pluggable like resolvers; the
// prototype has the few its fixtures need. A viewer with its own readers (Mol*'s STAR, OBJ, mmCIF) can hand resources
// over instead (_spec/runtime.md).

export interface StarTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** STAR (RELION): `data_` blocks of `loop_` tables; the tables, by block name. */
export function readStar(text: string): Map<string, StarTable> {
  const out = new Map<string, StarTable>();
  let block = '';
  let columns: string[] | undefined;
  let rows: string[][] = [];
  const flush = () => {
    if (columns) out.set(block, { columns, rows });
    columns = undefined;
    rows = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('data_')) {
      flush();
      block = line.slice(5);
    } else if (line === 'loop_') {
      flush();
      columns = [];
    } else if (line.startsWith('_') && columns && rows.length === 0) {
      columns.push(line.split(/\s+/)[0].slice(1));
    } else if (columns) {
      rows.push(line.split(/\s+/));
    }
  }
  flush();
  return out;
}

/** Wavefront OBJ: `v` and triangle or polygon `f` lines (fan-triangulated), 1-based or negative indices. */
export function readObj(text: string): MeshData {
  const v: number[] = [];
  const f: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === 'v') v.push(+parts[1], +parts[2], +parts[3]);
    else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((p) => {
        const i = parseInt(p.split('/')[0], 10);
        return i < 0 ? v.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < idx.length; k++) f.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  return { positions: Float32Array.from(v), indices: Uint32Array.from(f) };
}

const json = (raw: unknown) => (typeof raw === 'string' ? JSON.parse(raw) : raw);

export const DefaultReaders: readonly ResourceReader[] = [
  { format: 'relion-star', read: (raw) => readStar(String(raw)) },
  { format: 'obj', read: (raw) => readObj(String(raw)) },
  { format: 'cellpack-gpu-serialized', read: json },
  { format: 'meso-placements+json', read: json },
  { format: 'meso-path+json', read: json },
];

export function readerFor(readers: readonly ResourceReader[], r: Resource) {
  return readers.find((x) => x.format === r.format);
}

export function meshArea(mesh: MeshData): { area: number; volume: number; cumulative: Float64Array } {
  const { positions: P, indices: I } = mesh;
  const t = I.length / 3;
  const cumulative = new Float64Array(t);
  let area = 0;
  let volume = 0;
  for (let i = 0; i < t; i++) {
    const a = 3 * I[3 * i],
      b = 3 * I[3 * i + 1],
      c = 3 * I[3 * i + 2];
    const ux = P[b] - P[a],
      uy = P[b + 1] - P[a + 1],
      uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a],
      vy = P[c + 1] - P[a + 1],
      vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    cumulative[i] = area;
    // signed volume of the tetrahedron with the origin
    volume +=
      (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
        P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
        P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
      6;
  }
  return { area, volume: Math.abs(volume), cumulative };
}
