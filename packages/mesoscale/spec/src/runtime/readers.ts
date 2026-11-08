/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Resource } from '../format/doc.js';
import type { MeshData, ResourceReader } from './resolver.js';

// Readers (design.md §6.2): a resource's raw content made usable, by its native format. Pluggable like resolvers; the
// prototype has the few its fixtures need. A viewer with its own readers (Mol*'s STAR, OBJ, mmCIF) can hand resources
// over instead (design.md §6.5).

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
