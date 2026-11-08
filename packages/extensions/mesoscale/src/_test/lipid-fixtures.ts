/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type TileKinds, triangleAffine } from '../lipids/assign.js';
import { random01 } from '../lipids/assign.js';
import type { Tile } from '../lipids/tiles.js';

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
 * a hash; the outer leaflet's heads at z 20, the inner's at −20
 */
export function syntheticPatchPdb(columns = 12, rows = 14) {
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
        lines.push(atomLine(serial++, name === 'CHL1' ? 'O3' : 'P', name, id, x, y, 20 * side));
        for (let chain = 0; chain < 2; ++chain) {
          for (let k = 1; k <= 11; ++k) {
            const w = (random01(id, chain * 16 + k) - 0.5) * 1.2;
            const cx = x + (chain - 0.5) * 3.5 + w;
            lines.push(atomLine(serial++, `C${chain + 2}${k}`, name, id, cx, y + w, (20 - k * 1.5) * side));
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
