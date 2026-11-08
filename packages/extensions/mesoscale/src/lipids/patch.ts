/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A flat equilibrated bilayer patch (CHARMM-GUI's: periodic in x and y, the bilayer normal z) split into its two
// leaflets, the source the tile sets are cut from (progress/2026-11-08-lipid-tiles.md, Design).

/** One leaflet of a patch: its lipids, each whole (atoms unwrapped about the headgroup), z from the leaflet's mid-plane */
export interface Leaflet {
  /** the residue names, a lipid's species its index here */
  readonly species: readonly string[];
  readonly lipidSpecies: Uint16Array;
  /** the first atom of each lipid, and the atom count at the end (lipids + 1 entries) */
  readonly lipidAtomStart: Uint32Array;
  /** each lipid's headgroup atom (absolute index) */
  readonly lipidHead: Uint32Array;
  /** xyz per atom */
  readonly positions: Float32Array;
  /** the element of each atom, as its first letter's char code (C, N, O, P, S) */
  readonly elements: Uint8Array;
  /** the periodic box, x and y */
  readonly box: readonly [number, number];
  /** the farthest an atom of a lipid lies from its headgroup in the plane: how far a lipid reaches over a seam */
  readonly reach: number;
  /** the leaflet's area a lipid: box area over its lipids */
  readonly areaPerLipid: number;
  /** the offset of the leaflet's mid-plane from the bilayer's center along the normal (outer > 0, inner < 0) */
  readonly offset: number;
}

export interface LipidPatch {
  /** the leaflet the normal points out of (z above the center) and the other */
  readonly outer: Leaflet;
  readonly inner: Leaflet;
}

const Excluded = new Set([
  'TIP3',
  'TIP4',
  'SOL',
  'SPC',
  'HOH',
  'WAT',
  'SOD',
  'CLA',
  'POT',
  'CAL',
  'MG',
  'NA',
  'CL',
  'K',
]);

/** A residue as read: its name, xyz per atom, the first letter of each atom's element, its headgroup atom */
export interface RawLipid {
  name: string;
  atoms: number[];
  elements: number[];
  head: number;
}

/**
 * The lipids of PDB text (ATOM and HETATM records; water and ions skipped; hydrogens skipped unless `hydrogens`), a
 * residue a lipid (of 5 atoms or more); the headgroup is `P`, else `O3` (cholesterol), else the atom farthest from the bilayer's center
 */
export function parsePatchPdb(text: string, options: { hydrogens?: boolean; box?: [number, number] } = {}): LipidPatch {
  const lipids: RawLipid[] = [];
  let key = '';
  let current: RawLipid | undefined;
  let headName = '';
  let box = options.box;
  for (const line of text.split('\n')) {
    if (!box && line.startsWith('CRYST1')) {
      box = [Number.parseFloat(line.substring(6, 15)), Number.parseFloat(line.substring(15, 24))];
    }
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const name = line.substring(17, 21).trim();
    if (Excluded.has(name)) continue;
    const atom = line.substring(12, 16).trim();
    const element = (line.substring(76, 78).trim() || atom.replace(/^[0-9]+/, '')).charAt(0).toUpperCase();
    if (element === 'H' && !options.hydrogens) continue;
    const k = `${name}|${line.substring(22, 27)}|${line.substring(72, 76)}`;
    if (k !== key) {
      key = k;
      current = { name, atoms: [], elements: [], head: -1 };
      lipids.push(current);
      headName = '';
    }
    const x = Number.parseFloat(line.substring(30, 38));
    const y = Number.parseFloat(line.substring(38, 46));
    const z = Number.parseFloat(line.substring(46, 54));
    const index = current!.atoms.length / 3;
    current!.atoms.push(x, y, z);
    current!.elements.push(element.charCodeAt(0));
    if (atom === 'P' || (atom === 'O3' && headName !== 'P')) {
      current!.head = index;
      headName = atom;
    }
  }
  // water and ions by another name: residues of fewer than 5 atoms are not lipids
  return splitLeaflets(
    lipids.filter((l) => l.atoms.length >= 15),
    box,
  );
}

/** The lipids into leaflets by their headgroup's side of the center; the box from the heads' extent where not given */
export function splitLeaflets(lipids: RawLipid[], box?: [number, number]): LipidPatch {
  let center = 0;
  let atomCount = 0;
  for (const l of lipids) {
    for (let i = 2; i < l.atoms.length; i += 3) center += l.atoms[i];
    atomCount += l.atoms.length / 3;
  }
  center /= Math.max(1, atomCount);
  for (const l of lipids) {
    if (l.head >= 0) continue;
    let best = 0;
    for (let i = 0; i < l.atoms.length / 3; ++i) {
      if (Math.abs(l.atoms[i * 3 + 2] - center) > Math.abs(l.atoms[best * 3 + 2] - center)) best = i;
    }
    l.head = best;
  }
  const upper = lipids.filter((l) => l.atoms[l.head * 3 + 2] >= center);
  const lower = lipids.filter((l) => l.atoms[l.head * 3 + 2] < center);
  if (!box) box = [estimatePeriod(upper, lower, 0), estimatePeriod(upper, lower, 1)];
  return { outer: makeLeaflet(upper, center, box, 1), inner: makeLeaflet(lower, center, box, -1) };
}

/**
 * The period of the patch along `axis` where no box is given (CHARMM-GUI's step4 PDB has none): the smallest past the
 * heads' extent at which heads across the boundary are as far apart as the nearest heads inside (the image's first row
 * where the next row would be); per leaflet, the larger. Too small a box overlaps the images, too large leaves a gap.
 */
function estimatePeriod(upper: RawLipid[], lower: RawLipid[], axis: 0 | 1) {
  let period = 0;
  for (const leaflet of [upper, lower]) {
    if (leaflet.length < 4) continue;
    const xs = leaflet.map((l) => l.atoms[l.head * 3 + axis]);
    const ys = leaflet.map((l) => l.atoms[l.head * 3 + 1 - axis]);
    let min = Infinity;
    let max = -Infinity;
    for (const x of xs) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    const extent = max - min;
    const spacing = Math.sqrt((extent * extent) / leaflet.length);
    // the nearest head inside, its median over the heads: the distance the boundary's pairs should keep
    const near: number[] = [];
    const cell = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / spacing)},${Math.floor(y / spacing)}`;
    xs.forEach((x, i) => {
      const k = key(x, ys[i]);
      const c = cell.get(k);
      if (c) c.push(i);
      else cell.set(k, [i]);
    });
    xs.forEach((x, i) => {
      let best = Infinity;
      for (let a = -1; a <= 1; ++a)
        for (let b = -1; b <= 1; ++b)
          for (const j of cell.get(key(x + a * spacing, ys[i] + b * spacing)) ?? []) {
            if (j !== i) best = Math.min(best, Math.hypot(xs[j] - x, ys[j] - ys[i]));
          }
      if (best < Infinity) near.push(best);
    });
    near.sort((a, b) => a - b);
    const nearest = near[Math.floor(near.length / 2)] ?? spacing;
    const low = xs.map((x, i) => i).filter((i) => xs[i] < min + 2 * spacing);
    const high = xs.map((x, i) => i).filter((i) => xs[i] > max - 2 * spacing);
    let best = extent + 2 * spacing;
    for (let p = extent + 0.25 * nearest; p < extent + 2 * spacing; p += 0.1) {
      let closest = Infinity;
      for (const i of high)
        for (const j of low) closest = Math.min(closest, Math.hypot(xs[j] + p - xs[i], ys[j] - ys[i]));
      if (closest >= 0.9 * nearest) {
        best = p;
        break;
      }
    }
    period = Math.max(period, best);
  }
  return period;
}

function makeLeaflet(lipids: RawLipid[], center: number, box: [number, number], side: 1 | -1): Leaflet {
  const species: string[] = [];
  const speciesIndex = new Map<string, number>();
  let atomCount = 0;
  let headDepth = 0;
  for (const l of lipids) {
    atomCount += l.atoms.length / 3;
    headDepth += Math.abs(l.atoms[l.head * 3 + 2] - center);
  }
  // the mid-plane halfway between the center and the heads
  const offset = side * (lipids.length ? headDepth / lipids.length / 2 : 0);
  const plane = center + offset;
  const positions = new Float32Array(atomCount * 3);
  const elements = new Uint8Array(atomCount);
  const lipidSpecies = new Uint16Array(lipids.length);
  const lipidAtomStart = new Uint32Array(lipids.length + 1);
  const lipidHead = new Uint32Array(lipids.length);
  let a = 0;
  let reach = 0;
  for (let i = 0; i < lipids.length; ++i) {
    const l = lipids[i];
    let s = speciesIndex.get(l.name);
    if (s === undefined) {
      s = species.length;
      speciesIndex.set(l.name, s);
      species.push(l.name);
    }
    lipidSpecies[i] = s;
    lipidAtomStart[i] = a;
    lipidHead[i] = a + l.head;
    // the head wrapped into the box, the atoms unwrapped about it (minimum image)
    const hx = l.atoms[l.head * 3];
    const hy = l.atoms[l.head * 3 + 1];
    const wx = wrap(hx, box[0]);
    const wy = wrap(hy, box[1]);
    for (let j = 0, jl = l.atoms.length / 3; j < jl; ++j, ++a) {
      const dx = minimumImage(l.atoms[j * 3] - hx, box[0]);
      const dy = minimumImage(l.atoms[j * 3 + 1] - hy, box[1]);
      positions[a * 3] = wx + dx;
      positions[a * 3 + 1] = wy + dy;
      positions[a * 3 + 2] = l.atoms[j * 3 + 2] - plane;
      elements[a] = l.elements[j];
      reach = Math.max(reach, Math.hypot(dx, dy));
    }
  }
  lipidAtomStart[lipids.length] = a;
  return {
    species,
    lipidSpecies,
    lipidAtomStart,
    lipidHead,
    positions,
    elements,
    box,
    reach,
    areaPerLipid: lipids.length ? (box[0] * box[1]) / lipids.length : 0,
    offset,
  };
}

const wrap = (x: number, size: number) => x - Math.floor(x / size) * size;
const minimumImage = (d: number, size: number) => d - Math.round(d / size) * size;
