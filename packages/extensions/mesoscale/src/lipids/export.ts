/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { emptyCut, eachHit, hitAffine, triangleCut } from './cutter.js';
import type { MembraneData } from './membrane.js';

// A membrane's full build, only at export (Ludo, 2026-11-08: "only do the full build at export time"): every triangle
// cut by the TypeScript reference (`cutter.ts`, the kernel's equal), streamed as a RELION STAR particle list a chunk of
// triangles at a time, never the whole build in memory. A lipid a row: its position (Å), its orientation as RELION's
// angles (the rotation Mol*'s STAR reader makes of them is the conformer's: `relionEulerToRotation`), its species,
// conformer, leaflet, triangle and index among the triangle's hits of its conformer.

const Header = `# A lipid membrane's full build (Mol* Mesoscale Explorer): coordinates in Å (pixel size 1)

data_particles

loop_
_rlnCoordinateX #1
_rlnCoordinateY #2
_rlnCoordinateZ #3
_rlnAngleRot #4
_rlnAngleTilt #5
_rlnAnglePsi #6
_rlnClassNumber #7
_mesoSpecies #8
_mesoConformer #9
_mesoLeaflet #10
_mesoTriangle #11
_mesoLipid #12
`;

const deg = 180 / Math.PI;

/**
 * RELION's angles of rotation `m` (column-major 4×4, its upper 3×3): Mol*'s reader makes (Rz(rot) Ry(tilt) Rz(psi))ᵀ of
 * them, so they are the ZYZ angles of mᵀ
 */
export function relionAngles(m: ArrayLike<number>, o: number, out: { rot: number; tilt: number; psi: number }) {
  // B = mᵀ: B[i][j] = m[j][i] = m[o + i * 4 + j] (column-major m[r][c] at c * 4 + r)
  const b = (i: number, j: number) => m[o + i * 4 + j];
  const c = Math.max(-1, Math.min(1, b(2, 2)));
  const tilt = Math.acos(c);
  if (Math.abs(Math.sin(tilt)) > 1e-6) {
    out.rot = Math.atan2(b(1, 2), b(0, 2)) * deg;
    out.psi = Math.atan2(b(2, 1), -b(2, 0)) * deg;
  } else {
    out.rot = Math.atan2(b(1, 0), b(0, 0)) * deg;
    out.psi = 0;
  }
  out.tilt = tilt * deg;
  return out;
}

/** The STAR file of `data`'s cut leaflets, a chunk of `chunk` triangles a string; species in `hidden` left out */
export function* membraneStar(data: MembraneData, hidden: ReadonlySet<string> = new Set(), chunk = 256) {
  yield Header;
  const cut = emptyCut();
  const affine = new Float32Array(16);
  const angles = { rot: 0, tilt: 0, psi: 0 };
  const lines: string[] = [];
  const f = (x: number) => x.toFixed(2);
  for (const leaflet of data.cut) {
    const { table, mesh, regions } = leaflet;
    const T = mesh.indices.length / 3;
    for (let t0 = 0; t0 < T; t0 += chunk) {
      lines.length = 0;
      for (let t = t0; t < Math.min(T, t0 + chunk); ++t) {
        if (!triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut)) continue;
        for (let m = 0; m < table.members.length; ++m) {
          const species = table.species[table.members[m].species];
          if (hidden.has(species)) continue;
          let index = 0;
          eachHit(table, cut, m, (l, x, y) => {
            hitAffine(table, cut, l, x, y, affine, 0);
            relionAngles(affine, 0, angles);
            lines.push(
              `${f(affine[12])} ${f(affine[13])} ${f(affine[14])} ${f(angles.rot)} ${f(angles.tilt)} ${f(angles.psi)} ${table.members[m].species + 1} ${species} ${m} ${leaflet.name} ${t} ${index++}`,
            );
          });
        }
      }
      if (lines.length) yield `${lines.join('\n')}\n`;
    }
  }
}
