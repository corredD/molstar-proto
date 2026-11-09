/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The yeast cell viewer's organelle meshes made in memory (lipid-procedural round 6)

/** a buffer of meshes in the viewer's format: per mesh (membrane id, positions nm, indices) */
export function organelleBuffer(meshes: { membrane: number; positions: number[]; indices: number[] }[]) {
  let size = 4 + meshes.length * 12;
  for (const m of meshes) size += m.positions.length * 4 + m.indices.length * 4;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint32(0, meshes.length, true);
  let at = 4 + meshes.length * 12;
  meshes.forEach((m, i) => {
    view.setUint32(4 + i * 12, m.membrane, true);
    view.setUint32(8 + i * 12, m.positions.length / 3, true);
    view.setUint32(12 + i * 12, m.indices.length / 3, true);
    for (const p of m.positions) {
      view.setFloat32(at, p, true);
      at += 4;
    }
    for (const v of m.indices) {
      view.setUint32(at, v, true);
      at += 4;
    }
  });
  return new Uint8Array(view.buffer);
}

/** a tetrahedron of side about `s` nm at `c` (closed, outward) */
export function tetra(c: [number, number, number], s: number) {
  const [x, y, z] = c;
  return {
    positions: [x + s, y + s, z + s, x + s, y - s, z - s, x - s, y + s, z - s, x - s, y - s, z + s],
    indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2],
  };
}
