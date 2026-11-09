/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type TileKinds, triangleAffine } from '../lipids/assign.js';
import { random01 } from '../lipids/assign.js';
import type { Tile } from '../lipids/tiles.js';
import {
  type CutterTable,
  cutterBases,
  cutterCounts,
  cutterReference,
  cutterRegions,
  eachHit,
  emptyCut,
  triangleCut,
} from '../lipids/cutter.js';
import { icosphere } from '../lipids/remesh.js';

/** A PDB ATOM line (columns as the format has them) */
function atomLine(serial: number, name: string, resName: string, resSeq: number, x: number, y: number, z: number) {
  const n = name.length < 4 ? ` ${name}`.padEnd(4) : name;
  return (
    `ATOM  ${String(serial % 100000).padStart(5)} ${n} ${resName.padEnd(4)}${String(resSeq % 10000).padStart(4)}    ` +
    `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00      MEMB`
  );
}

/**
 * A periodic bilayer as CHARMM-GUI writes one (no CRYST1): lipids on a triangular lattice of spacing 8 Å (`columns` ×
 * `rows`), a head `P` (or `O3` for CHL1) and two chains of 1.5 Å steps 3.5 Å apart, wiggling ≤ 0.6 Å; three species by
 * a hash; the outer leaflet's heads at z 20, the inner's at −20, or per species at `heads` (a lipid moved along z whole)
 */
export function syntheticPatchPdb(columns = 12, rows = 14, heads: Readonly<Record<string, number>> = {}) {
  const lines: string[] = [];
  const species = ['POPC', 'POPE', 'CHL1'];
  let serial = 1;
  let res = 1;
  const spacing = 8;
  for (const side of [1, -1]) {
    for (let r = 0; r < rows; ++r) {
      for (let c = 0; c < columns; ++c) {
        const id = res;
        const name = species[Math.floor(random01(7, id) * 3)];
        const x = (c + (r % 2) * 0.5) * spacing + (side < 0 ? 2 : 0);
        const y = r * spacing * 0.866;
        const head = heads[name] ?? 20;
        lines.push(atomLine(serial++, name === 'CHL1' ? 'O3' : 'P', name, id, x, y, head * side));
        for (let chain = 0; chain < 2; ++chain) {
          for (let k = 1; k <= 11; ++k) {
            const w = (random01(id, chain * 16 + k) - 0.5) * 1.2;
            const cx = x + (chain - 0.5) * 3.5 + w;
            lines.push(atomLine(serial++, `C${chain + 2}${k}`, name, id, cx, y + w, (head - k * 1.5) * side));
          }
        }
        res += 1;
      }
    }
  }
  return { text: lines.join('\n'), box: [columns * spacing, rows * spacing * 0.866] as [number, number] };
}

/** A flat triangulated plane of edge `L`, `n` × `n` rhombi (two triangles each), counter-clockwise seen from +z */
export function flatMesh(L: number, n: number) {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; ++j) {
    for (let i = 0; i <= n; ++i) {
      const o = (j * (n + 1) + i) * 3;
      positions[o] = (i + j * 0.5) * L;
      positions[o + 1] = j * L * 0.8660254037844386;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < n; ++j) {
    for (let i = 0; i < n; ++i) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/** Every lipid of a tiled mesh in world space: atoms, each atom's lipid and tile, each lipid's head and species */
export function placeTiles(
  kinds: TileKinds,
  L: number,
  variants: readonly Tile[],
  mesh: { positions: Float32Array; indices: Uint32Array },
  variantOf: (t: number) => number,
) {
  const atoms: number[] = [];
  const atomLipid: number[] = [];
  const atomTile: number[] = [];
  const heads: number[] = [];
  const lipidSpecies: number[] = [];
  const m = new Float32Array(16);
  void kinds;
  for (let t = 0; t < mesh.indices.length / 3; ++t) {
    const i = mesh.indices;
    triangleAffine(L, mesh.positions, i[t * 3], i[t * 3 + 1], i[t * 3 + 2], m, 0);
    const tile = variants[variantOf(t)];
    for (let l = 0; l < tile.lipidSpecies.length; ++l) {
      const lipid = lipidSpecies.length;
      lipidSpecies.push(tile.lipidSpecies[l]);
      for (let a = tile.lipidAtomStart[l]; a < tile.lipidAtomStart[l + 1]; ++a) {
        const x = tile.positions[a * 3];
        const y = tile.positions[a * 3 + 1];
        const z = tile.positions[a * 3 + 2];
        atoms.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
        atomLipid.push(lipid);
        atomTile.push(t);
      }
      heads.push(lipid);
    }
  }
  return { atoms: Float32Array.from(atoms), atomLipid, atomTile, lipidSpecies };
}

/** Pairs of atoms of different lipids closer than `d`: those across tiles and those within one */
export function closePairs(atoms: Float32Array, atomLipid: number[], atomTile: number[], d: number) {
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / d)},${Math.floor(y / d)},${Math.floor(z / d)}`;
  for (let a = 0; a < atoms.length / 3; ++a) {
    const k = key(atoms[a * 3], atoms[a * 3 + 1], atoms[a * 3 + 2]);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(a);
  }
  let across = 0;
  let within = 0;
  let min = Infinity;
  for (let a = 0; a < atoms.length / 3; ++a) {
    const x = atoms[a * 3];
    const y = atoms[a * 3 + 1];
    const z = atoms[a * 3 + 2];
    for (let i = -1; i <= 1; ++i)
      for (let j = -1; j <= 1; ++j)
        for (let k = -1; k <= 1; ++k) {
          for (const b of cells.get(key(x + i * d, y + j * d, z + k * d)) ?? []) {
            if (b <= a || atomLipid[a] === atomLipid[b]) continue;
            const r = Math.hypot(atoms[b * 3] - x, atoms[b * 3 + 1] - y, atoms[b * 3 + 2] - z);
            if (atomTile[a] !== atomTile[b]) min = Math.min(min, r);
            if (r >= d) continue;
            if (atomTile[a] === atomTile[b]) within += 1;
            else across += 1;
          }
        }
  }
  return { across, within, minAcross: min };
}

/**
 * Every lipid the cutter puts on a leaflet's triangles (the CPU reference, `cutter.ts`): atoms in world space, each atom's
 * lipid and its cut's cell (a region's cell, by its turn)
 */
export function placeCut(table: CutterTable, mesh: { positions: Float32Array; indices: Uint32Array }, seed: number) {
  const regions = cutterRegions(mesh.positions, mesh.indices, seed);
  const { totals } = cutterBases(cutterCounts(table, mesh.positions, mesh.indices, regions), table.members.length);
  const atoms: number[] = [];
  const atomLipid: number[] = [];
  const atomCell: number[] = [];
  const cellIds = new Map<string, number>();
  const cut = emptyCut();
  let lipids = 0;
  table.members.forEach((member, m) => {
    const affines = cutterReference(table, mesh.positions, mesh.indices, regions, m, totals[m]);
    // each hit's cell, in the reference's order
    const hitCell: number[] = [];
    for (let t = 0; t < mesh.indices.length / 3; ++t) {
      if (!triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut)) continue;
      eachHit(table, cut, m, () => {
        const key = `${cut.region} ${cut.turnCos.toFixed(6)} ${cut.turnSin.toFixed(6)}`;
        let id = cellIds.get(key);
        if (id === undefined) cellIds.set(key, (id = cellIds.size));
        hitCell.push(id);
      });
    }
    const p = member.positions;
    for (let i = 0; i < totals[m]; ++i) {
      const o = i * 16;
      for (let a = 0; a < p.length; a += 3) {
        atomLipid.push(lipids + i);
        atomCell.push(hitCell[i]);
        for (let k = 0; k < 3; ++k) {
          atoms.push(
            affines[o + k] * p[a] + affines[o + 4 + k] * p[a + 1] + affines[o + 8 + k] * p[a + 2] + affines[o + 12 + k],
          );
        }
      }
    }
    lipids += totals[m];
  });
  return { atoms: Float32Array.from(atoms), atomLipid, atomCell, cells: cellIds.size, lipids };
}

/**
 * The fraction of a mesh's area with an atom within `radius` (`samples` points spread by area, seeded): how much of the
 * surface its lipids cover (a hole lets the mesh show through)
 */
export function coveredFraction(
  mesh: { positions: Float32Array; indices: Uint32Array },
  atoms: Float32Array,
  radius = 10,
  samples = 4000,
) {
  const cells = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) =>
    ((Math.floor(x / radius) + 1024) * 2048 + Math.floor(y / radius) + 1024) * 2048 + Math.floor(z / radius) + 1024;
  for (let a = 0; a < atoms.length / 3; ++a) {
    const k = key(atoms[a * 3], atoms[a * 3 + 1], atoms[a * 3 + 2]);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(a);
  }
  const near = (x: number, y: number, z: number) => {
    for (let i = -1; i <= 1; ++i)
      for (let j = -1; j <= 1; ++j)
        for (let k = -1; k <= 1; ++k)
          for (const b of cells.get(key(x + i * radius, y + j * radius, z + k * radius)) ?? []) {
            if (Math.hypot(atoms[b * 3] - x, atoms[b * 3 + 1] - y, atoms[b * 3 + 2] - z) <= radius) return true;
          }
    return false;
  };
  const p = mesh.positions;
  const ix = mesh.indices;
  const T = ix.length / 3;
  const cumulative = new Float64Array(T + 1);
  for (let t = 0; t < T; ++t) {
    const [a, b, c] = [ix[t * 3] * 3, ix[t * 3 + 1] * 3, ix[t * 3 + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    cumulative[t + 1] =
      cumulative[t] + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  let covered = 0;
  for (let i = 0; i < samples; ++i) {
    const r = random01(11, i * 3) * cumulative[T];
    let lo = 0;
    let hi = T - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid + 1] < r) lo = mid + 1;
      else hi = mid;
    }
    let r1 = random01(11, i * 3 + 1);
    let r2 = random01(11, i * 3 + 2);
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const [a, b, c] = [ix[lo * 3] * 3, ix[lo * 3 + 1] * 3, ix[lo * 3 + 2] * 3];
    const x = p[a] + r1 * (p[b] - p[a]) + r2 * (p[c] - p[a]);
    const y = p[a + 1] + r1 * (p[b + 1] - p[a + 1]) + r2 * (p[c + 1] - p[a + 1]);
    const z = p[a + 2] + r1 * (p[b + 2] - p[a + 2]) + r2 * (p[c + 2] - p[a + 2]);
    if (near(x, y, z)) covered += 1;
  }
  return covered / samples;
}

/**
 * A body with thin limbs, as Ludo's cow ×100 (legs 20–35 Å across under a 42 Å tile edge): a sphere of radius 250
 * (triangles of about 30 Å) with four legs of radius 10 and length 200 grown from it (each a vertex's fan replaced by a
 * tube and a cap: one closed surface, as the cow's)
 */
export function thinLimbedBody() {
  const sphere = icosphere(250, 30);
  const positions = Array.from(sphere.positions);
  const fan = new Set<number>();
  const legs: number[] = [];
  // a vertex below the body in each quadrant, the closest to (±100, −250, ±100)
  for (const [qx, qz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    let best = -1;
    let bestD = Infinity;
    for (let v = 0; v < positions.length / 3; ++v) {
      const d = Math.hypot(positions[v * 3] - qx * 100, positions[v * 3 + 1] + 250, positions[v * 3 + 2] - qz * 100);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    legs.push(best);
  }
  const indices: number[] = [];
  const ix = sphere.indices;
  const rings = new Map<number, Map<number, number>>();
  for (const v of legs) rings.set(v, new Map());
  for (let t = 0; t < ix.length; t += 3) {
    const k = [0, 1, 2].findIndex((j) => rings.has(ix[t + j]));
    if (k < 0) {
      indices.push(ix[t], ix[t + 1], ix[t + 2]);
      continue;
    }
    // the fan of v: (v, x, y) counter-clockwise, its rim edge x → y
    fan.add(t);
    rings.get(ix[t + k])!.set(ix[t + ((k + 1) % 3)], ix[t + ((k + 2) % 3)]);
  }
  for (const [v, next] of rings) {
    const rim: number[] = [];
    let x = next.keys().next().value!;
    do {
      rim.push(x);
      x = next.get(x)!;
    } while (x !== rim[0]);
    const cx = rim.reduce((a, r) => a + positions[r * 3], 0) / rim.length;
    const cz = rim.reduce((a, r) => a + positions[r * 3 + 2], 0) / rim.length;
    const top = positions[v * 3 + 1];
    let ring = rim;
    for (let k = 1; k <= 10; ++k) {
      const below = rim.map((_, i) => {
        const a = Math.atan2(positions[rim[i] * 3 + 2] - cz, positions[rim[i] * 3] - cx);
        positions.push(cx + 10 * Math.cos(a), top - k * 20, cz + 10 * Math.sin(a));
        return positions.length / 3 - 1;
      });
      for (let i = 0; i < ring.length; ++i) {
        const j = (i + 1) % ring.length;
        indices.push(ring[i], ring[j], below[i], ring[j], below[j], below[i]);
      }
      ring = below;
    }
    const center = positions.length / 3;
    positions.push(cx, top - 200, cz);
    for (let i = 0; i < ring.length; ++i) indices.push(center, ring[i], ring[(i + 1) % ring.length]);
  }
  void fan;
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** An RGBA image as a PNG file at `path` (to look at a test's images; no dependency: zlib and a CRC) */
export async function writePng(path: string, width: number, height: number, rgba: ArrayLike<number>) {
  const { deflateSync } = await import('node:zlib');
  const { writeFileSync } = await import('node:fs');
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; ++k) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; ++i) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; ++y) {
    for (let i = 0; i < width * 4; ++i) raw[y * (width * 4 + 1) + 1 + i] = rgba[y * width * 4 + i];
  }
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  writeFileSync(path, Buffer.concat(parts));
}
