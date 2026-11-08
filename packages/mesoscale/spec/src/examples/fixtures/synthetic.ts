/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createRandom } from '../../runtime/random.js';

// Synthetic cryo-ET fixtures (labelled as such in every document that uses them): a segmented vesicle membrane as an
// OBJ mesh and template-matching picks as a RELION STAR file, both in a tomogram's voxel coordinates (1 nm voxels, the
// vesicle centred at voxel 200, 200, 100). Deterministic: the same text on every run. They stand in for real data so
// the quick lane never reaches the network; nothing here is a measurement.

export const SyntheticTomogram = { voxelNm: 1, center: [200, 200, 100] as const, radiusNm: 50 };

/** An icosphere (subdivided `level` times), radius 50 nm, gently deformed (a low-order wobble), voxel coordinates. */
export function syntheticVesicleObj(level = 2): string {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(norm);
  let f = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(k)) {
        v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
        mid.set(k, v.length - 1);
      }
      return mid.get(k)!;
    };
    f = f.flatMap(([a, b, c]) => {
      const ab = m(a, b),
        bc = m(b, c),
        ca = m(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  }
  const [cx, cy, cz] = SyntheticTomogram.center;
  const R = SyntheticTomogram.radiusNm / SyntheticTomogram.voxelNm;
  v = v.map(([x, y, z]) => {
    const wobble = 1 + 0.08 * x * y + 0.05 * (z * z - 0.33);
    return [cx + R * wobble * x, cy + R * wobble * y, cz + R * 0.9 * wobble * z];
  });
  const lines = [
    '# synthetic fixture: a deformed icosphere standing in for a segmented vesicle membrane (voxels, 1 nm)',
  ];
  for (const p of v) lines.push(`v ${p.map((x) => x.toFixed(3)).join(' ')}`);
  for (const [a, b, c] of f) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return `${lines.join('\n')}\n`;
}

function norm(p: number[]) {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** `n` picks inside the vesicle (within 30 nm of its centre, 9 nm apart), random ZYZ angles, RELION 3.1 STAR. */
export function syntheticPicksStar(n = 24, seed = 7): string {
  const r = createRandom(seed);
  const [cx, cy, cz] = SyntheticTomogram.center;
  const picks: number[][] = [];
  while (picks.length < n) {
    const p = [r.range(-30, 30), r.range(-30, 30), r.range(-25, 25)];
    if (Math.hypot(p[0], p[1], p[2]) > 30) continue;
    if (picks.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 9)) continue;
    picks.push(p);
  }
  const rows = picks.map(
    (p) =>
      `tomo_01 ${(cx + p[0]).toFixed(2)} ${(cy + p[1]).toFixed(2)} ${(cz + p[2]).toFixed(2)} ${r.range(-180, 180).toFixed(1)} ${r.range(0, 180).toFixed(1)} ${r.range(-180, 180).toFixed(1)} 1`,
  );
  return [
    '# synthetic fixture: template-matching picks standing in for real ones (voxels, 1 nm)',
    '',
    'data_particles',
    '',
    'loop_',
    '_rlnTomoName #1',
    '_rlnCoordinateX #2',
    '_rlnCoordinateY #3',
    '_rlnCoordinateZ #4',
    '_rlnAngleRot #5',
    '_rlnAngleTilt #6',
    '_rlnAnglePsi #7',
    '_rlnClassNumber #8',
    ...rows,
    '',
  ].join('\n');
}
