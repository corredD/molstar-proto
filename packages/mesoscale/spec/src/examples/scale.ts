/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';

// Scenes of a given size for the performance lane and story (design.md §8): `pack`, N proteins of 3 kinds packed in a
// sphere sized for a 15% volume fraction (random sequential addition, far from jamming); `bilayer`, N lipids on a
// sphere's two leaflets (O(N), no overlap test). The compartment grows with N, so the work per copy stays the same.

export type ScaleKind = 'pack' | 'bilayer';

export function scaleDoc(kind: ScaleKind, n: number): MesoViewSpecDoc {
  const radii = [3, 4, 5]; // nm
  let R: number;
  if (kind === 'pack') {
    const meanVolume = radii.reduce((s, r) => s + (4 / 3) * Math.PI * r ** 3, 0) / radii.length;
    R = Math.cbrt((n * meanVolume) / 0.15 / ((4 / 3) * Math.PI)) + 6;
  } else {
    // n = 2 leaflets × 1.5 / nm² × 4πR²
    R = Math.sqrt(n / (2 * 1.5 * 4 * Math.PI));
  }
  const per = Math.floor(n / 3);
  return {
    format: 'meso_view_spec',
    version: '0.1.0',
    metadata: { title: `${kind}, ${n.toLocaleString('en-US')} copies` },
    units: { length: 'nm' },
    entities: [
      ...radii.map((r, i) => ({ id: `e.p${i}`, label: `protein ${i}`, kind: 'protein' as const, radius: r })),
      { id: 'e.lipid', label: 'lipid', kind: 'lipid', radius: 0.45 },
    ],
    compartments: [{ id: 'c.cell', label: 'cell', kind: 'cell', geometry: { kind: 'sphere', radius: R }, membrane: { thickness: 4 } }],
    populations:
      kind === 'pack'
        ? radii.map((_, i) => ({ id: `p.p${i}`, entity: `e.p${i}`, compartment: 'c.cell', location: 'interior' as const, abundance: { count: i === 2 ? n - 2 * per : per } }))
        : [{ id: 'p.lipids', entity: 'e.lipid', compartment: 'c.cell', location: 'membrane', abundance: { density: { value: 1.5, unit: 'per_nm2' } }, arrangement: { kind: 'bilayer' } }],
    views: [{ id: 'v', camera: { position: [0, 0, 3.2 * R], target: [0, 0, 0] } }],
  };
}
