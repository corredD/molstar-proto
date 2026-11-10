/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { AtomNumber, VdwRadiusOfNumber } from '@molstar/model/model/structure/model/properties/atomic/measures';
import { ElementSymbol } from '@molstar/model/model/structure/model/types';
import type { ParticleSites } from '@molstar/model/model/particles/particle-list';

// The units of a fibre's bank (progress/2026-11-08-paint.md, Round 5): a DNA base pair a letter of its first strand,
// an RNA nucleotide a letter. Their atoms from cellPACK's (3DNA v1.6): `dna_AT`, `dna_TA`, `dna_GC`, `dna_CG`
// (cellpackgpu Data/proteins), `RNA_A_Base` … `RNA_U_Base` (mesoscope/cellPACK_data, cellPACK_database_1.1.0/other).
// Every unit forward +z, its helix axis z (the path): a fibre of them by rise 3.38 Å and twist +36° about +z is the
// source's helix. A DNA pair turned 180° about y (its first strand, 5' to 3', along -z in 3DNA's frame: a proper turn,
// the hand kept), on the axis; an RNA nucleotide turned and lowered to its P at +x (8.97 Å off the axis), z 0.

/** The banks of units: DNA (a base pair a letter of the first strand), RNA (a nucleotide a letter) */
export const FiberBanks = ['none', 'dna', 'rna'] as const;
export type FiberBank = (typeof FiberBanks)[number];

/** A bank's helix, its units' own (`FiberSettings`'s defaults for it) */
export const FiberBankHelix = { rise: 3.38, twist: 36 } as const;

/** A bank's letters and their units (`dna:AT` …): DNA's a pair of a letter and its complement */
export const FiberBankLetters: Readonly<Record<Exclude<FiberBank, 'none'>, Readonly<Record<string, string>>>> = {
  dna: { A: 'dna:AT', T: 'dna:TA', G: 'dna:GC', C: 'dna:CG' },
  rna: { A: 'rna:A', U: 'rna:U', G: 'rna:G', C: 'rna:C' },
};

interface UnitData {
  readonly key: string;
  /** an element symbol a site (one letter each: a string) */
  readonly elements: string | readonly string[];
  readonly chains: { readonly offsets: readonly number[]; readonly labels: readonly string[] };
  readonly positions: readonly number[];
}

const Units: readonly UnitData[] = [
  {
    key: 'dna:AT',
    elements: 'POOOCCOCOCCNCNCCNNCNCPOOOCCOCOCCNCONCOCCC',
    chains: { offsets: [0, 21, 41], labels: ['A', 'B'] },
    positions: [
      0.356, 9.218, -1.848, 0.311, 10.489, -2.605, 1.334, 9.156, -0.74, -1.105, 8.869, -1.295, -2.021, 8.156, -2.146,
      -2.726, 7.072, -1.355, -1.986, 5.817, -1.352, -2.952, 7.37, 0.127, -4.21, 6.832, 0.518, -1.848, 6.598, 0.85,
      -1.913, 5.344, -0.016, -0.711, 4.472, 0.101, 0.589, 4.841, 0.292, 1.415, 3.843, 0.354, 0.604, 2.728, 0.192, 0.881,
      1.351, 0.162, 2.113, 0.841, 0.301, -0.158, 0.514, -0.016, -1.38, 1.027, -0.154, -1.758, 2.286, -0.143, -0.7,
      3.103, 0.037, 0.356, -9.218, 1.848, 0.311, -10.489, 2.605, 1.334, -9.156, 0.74, -1.105, -8.869, 1.295, -2.021,
      -8.156, 2.146, -2.726, -7.072, 1.355, -1.986, -5.817, 1.352, -2.952, -7.37, -0.127, -4.21, -6.832, -0.518, -1.848,
      -6.598, -0.85, -1.913, -5.344, 0.016, -0.711, -4.472, -0.101, -0.911, -3.116, -0.009, -2.01, -2.617, 0.161, 0.226,
      -2.339, -0.123, 1.513, -2.797, -0.316, 2.454, -2.004, -0.403, 1.622, -4.234, -0.4, 2.989, -4.816, -0.61, 0.533,
      -5.013, -0.293,
    ],
  },
  {
    key: 'dna:TA',
    elements: 'POOOCCOCOCCNCONCOCCCPOOOCCOCOCCNCNCCNNCNC',
    chains: { offsets: [0, 20, 41], labels: ['A', 'B'] },
    positions: [
      0.356, 9.218, -1.848, 0.311, 10.489, -2.605, 1.334, 9.156, -0.74, -1.105, 8.869, -1.295, -2.021, 8.156, -2.146,
      -2.726, 7.072, -1.355, -1.986, 5.817, -1.352, -2.952, 7.37, 0.127, -4.21, 6.832, 0.518, -1.848, 6.598, 0.85,
      -1.913, 5.344, -0.016, -0.711, 4.472, 0.101, -0.911, 3.116, 0.009, -2.01, 2.617, -0.161, 0.226, 2.339, 0.123,
      1.513, 2.797, 0.316, 2.454, 2.004, 0.403, 1.622, 4.234, 0.4, 2.989, 4.816, 0.61, 0.533, 5.013, 0.293, 0.356,
      -9.218, 1.848, 0.311, -10.489, 2.605, 1.334, -9.156, 0.74, -1.105, -8.869, 1.295, -2.021, -8.156, 2.146, -2.726,
      -7.072, 1.355, -1.986, -5.817, 1.352, -2.952, -7.37, -0.127, -4.21, -6.832, -0.518, -1.848, -6.598, -0.85, -1.913,
      -5.344, 0.016, -0.711, -4.472, -0.101, 0.589, -4.841, -0.292, 1.415, -3.843, -0.354, 0.604, -2.728, -0.192, 0.881,
      -1.351, -0.162, 2.113, -0.841, -0.301, -0.158, -0.514, 0.016, -1.38, -1.027, 0.154, -1.758, -2.286, 0.143, -0.7,
      -3.103, -0.037,
    ],
  },
  {
    key: 'dna:GC',
    elements: 'POOOCCOCOCCNCNCCONCNNCPOOOCCOCOCCNCONCNCC',
    chains: { offsets: [0, 22, 41], labels: ['A', 'B'] },
    positions: [
      0.356, 9.218, -1.848, 0.311, 10.489, -2.605, 1.334, 9.156, -0.74, -1.105, 8.869, -1.295, -2.021, 8.156, -2.146,
      -2.726, 7.072, -1.355, -1.986, 5.817, -1.352, -2.952, 7.37, 0.127, -4.21, 6.832, 0.518, -1.848, 6.598, 0.85,
      -1.913, 5.344, -0.016, -0.711, 4.472, 0.101, 0.606, 4.826, 0.294, 1.43, 3.807, 0.354, 0.599, 2.7, 0.19, 0.914,
      1.317, 0.165, 2.01, 0.775, 0.284, -0.233, 0.533, -0.025, -1.516, 1.023, -0.172, -2.476, 0.111, -0.344, -1.811,
      2.321, -0.149, -0.709, 3.095, 0.035, 0.356, -9.218, 1.848, 0.311, -10.489, 2.605, 1.334, -9.156, 0.74, -1.105,
      -8.869, 1.295, -2.021, -8.156, 2.146, -2.726, -7.072, 1.355, -1.986, -5.817, 1.352, -2.952, -7.37, -0.127, -4.21,
      -6.832, -0.518, -1.848, -6.598, -0.85, -1.913, -5.344, 0.016, -0.711, -4.472, -0.101, -0.897, -3.095, -0.01,
      -2.04, -2.657, 0.163, 0.186, -2.282, -0.115, 1.409, -2.796, -0.302, 2.433, -1.963, -0.398, 1.621, -4.21, -0.399,
      0.526, -5.004, -0.292,
    ],
  },
  {
    key: 'dna:CG',
    elements: 'POOOCCOCOCCNCONCNCCPOOOCCOCOCCNCNCCONCNNC',
    chains: { offsets: [0, 19, 41], labels: ['A', 'B'] },
    positions: [
      0.356, 9.218, -1.848, 0.311, 10.489, -2.605, 1.334, 9.156, -0.74, -1.105, 8.869, -1.295, -2.021, 8.156, -2.146,
      -2.726, 7.072, -1.355, -1.986, 5.817, -1.352, -2.952, 7.37, 0.127, -4.21, 6.832, 0.518, -1.848, 6.598, 0.85,
      -1.913, 5.344, -0.016, -0.711, 4.472, 0.101, -0.897, 3.095, 0.01, -2.04, 2.657, -0.163, 0.186, 2.282, 0.115,
      1.409, 2.796, 0.302, 2.433, 1.963, 0.398, 1.621, 4.21, 0.399, 0.526, 5.004, 0.292, 0.356, -9.218, 1.848, 0.311,
      -10.489, 2.605, 1.334, -9.156, 0.74, -1.105, -8.869, 1.295, -2.021, -8.156, 2.146, -2.726, -7.072, 1.355, -1.986,
      -5.817, 1.352, -2.952, -7.37, -0.127, -4.21, -6.832, -0.518, -1.848, -6.598, -0.85, -1.913, -5.344, 0.016, -0.711,
      -4.472, -0.101, 0.606, -4.826, -0.294, 1.43, -3.807, -0.354, 0.599, -2.7, -0.19, 0.914, -1.317, -0.165, 2.01,
      -0.775, -0.284, -0.233, -0.533, 0.025, -1.516, -1.023, 0.172, -2.476, -0.111, 0.344, -1.811, -2.321, 0.149,
      -0.709, -3.095, -0.035,
    ],
  },
  {
    key: 'rna:U',
    elements: 'POOCOCOCOCOCNCONCOCCHHHHHHHHHH',
    chains: { offsets: [0, 30], labels: ['A'] },
    positions: [
      8.973, 0.0, 0.0, 10.268, 0.704, 0.141, 8.831, -1.249, 0.782, 7.384, 1.99, -0.615, 7.774, 0.999, 0.353, 6.803,
      3.202, 0.088, 5.433, 2.883, 0.318, 7.37, 3.5, 1.476, 7.208, 4.865, 1.834, 6.504, 2.632, 2.388, 5.901, 3.451,
      3.394, 5.15, 2.693, 1.689, 4.376, 1.423, 1.771, 3.009, 1.528, 1.876, 2.428, 2.6, 1.904, 2.325, 0.33, 1.95, 2.882,
      -0.933, 1.927, 2.165, -1.933, 2.0, 4.321, -0.941, 1.814, 5.01, 0.209, 1.741, 5.386, 2.869, 3.958, 1.24, 0.389,
      2.036, 4.847, -1.895, 1.788, 6.089, 0.167, 1.701, 4.454, 3.431, 2.09, 7.124, 1.871, 2.863, 8.415, 3.212, 1.587,
      6.774, 4.081, -0.555, 6.645, 1.592, -1.311, 8.277, 2.288, -1.164,
    ],
  },
  {
    key: 'rna:A',
    elements: 'POOCOCOCOCOCNCNCCCNNCNHHHHHHHHHHH',
    chains: { offsets: [0, 33], labels: ['A'] },
    positions: [
      8.973, -0.0, 0.0, 10.268, 0.703, 0.141, 8.831, -1.249, 0.782, 7.384, 1.989, -0.615, 7.774, 0.998, 0.353, 6.804,
      3.202, 0.088, 5.434, 2.882, 0.318, 7.37, 3.499, 1.476, 7.208, 4.865, 1.834, 6.504, 2.631, 2.388, 5.901, 3.45,
      3.394, 5.15, 2.692, 1.689, 0.473, 0.612, 2.09, 0.899, 1.872, 2.036, 2.127, 2.33, 1.932, 3.014, 1.315, 1.879, 2.73,
      -0.02, 1.924, 1.378, -0.383, 2.036, 0.956, -1.654, 2.09, 3.896, -0.767, 1.845, 4.834, 0.125, 1.756, 4.376, 1.423,
      1.771, 5.387, 2.868, 3.958, 0.188, 2.685, 2.079, -0.03, -1.855, 2.171, 1.624, -2.41, 2.05, 5.896, -0.072, 1.724,
      4.461, 3.426, 2.106, 7.123, 1.871, 2.863, 8.416, 3.21, 1.586, 6.775, 4.081, -0.555, 6.645, 1.592, -1.311, 8.278,
      2.287, -1.164,
    ],
  },
  {
    key: 'rna:C',
    elements: 'POOCOCOCOCOCNCONCNCCHHHHHHHHHHH',
    chains: { offsets: [0, 31], labels: ['A'] },
    positions: [
      8.973, -0.0, 0.0, 10.268, 0.704, 0.141, 8.831, -1.248, 0.782, 7.384, 1.989, -0.615, 7.775, 0.999, 0.353, 6.803,
      3.202, 0.088, 5.433, 2.883, 0.318, 7.37, 3.5, 1.476, 7.207, 4.865, 1.834, 6.503, 2.632, 2.388, 5.9, 3.45, 3.394,
      5.15, 2.693, 1.689, 4.376, 1.423, 1.771, 2.99, 1.513, 1.878, 2.465, 2.632, 1.9, 2.267, 0.366, 1.954, 2.874,
      -0.827, 1.926, 2.122, -1.915, 2.003, 4.298, -0.941, 1.816, 5.002, 0.216, 1.742, 5.385, 2.868, 3.958, 1.123,
      -1.792, 2.079, 2.548, -2.83, 1.985, 4.818, -1.899, 1.791, 6.078, 0.17, 1.659, 4.445, 3.446, 2.039, 7.123, 1.871,
      2.863, 8.416, 3.213, 1.587, 6.775, 4.081, -0.556, 6.645, 1.591, -1.31, 8.276, 2.287, -1.165,
    ],
  },
  {
    key: 'rna:G',
    elements: 'POOCOCOCOCOCNCNNCCCONCNHHHHHHHHHHH',
    chains: { offsets: [0, 34], labels: ['A'] },
    positions: [
      8.974, 0.0, 0.0, 10.268, 0.704, 0.141, 8.831, -1.249, 0.782, 7.384, 1.99, -0.615, 7.774, 0.998, 0.353, 6.804,
      3.202, 0.088, 5.434, 2.883, 0.318, 7.37, 3.5, 1.476, 7.207, 4.865, 1.834, 6.504, 2.631, 2.388, 5.9, 3.45, 3.394,
      5.15, 2.692, 1.689, 0.492, 0.666, 2.088, 0.879, 1.99, 2.035, -0.103, 2.891, 2.098, 2.149, 2.378, 1.929, 3.005,
      1.324, 1.88, 2.714, -0.019, 1.925, 1.361, -0.434, 2.038, 0.907, -1.573, 2.094, 3.881, -0.777, 1.846, 4.831, 0.122,
      1.757, 4.376, 1.422, 1.771, 5.385, 2.867, 3.957, -0.486, 0.476, 2.17, -1.094, 2.706, 2.168, 0.171, 3.861, 2.051,
      5.889, -0.078, 1.676, 4.446, 3.446, 2.041, 7.124, 1.871, 2.863, 8.415, 3.212, 1.587, 6.775, 4.081, -0.556, 6.645,
      1.592, -1.311, 8.277, 2.287, -1.164,
    ],
  },
];

const sites = new Map<string, ParticleSites>();

/** A unit's sites (`dna:AT`, `rna:A` …), made once: the same object every time (the targets' caches key on it) */
export function fiberUnitSites(key: string): ParticleSites | undefined {
  const kept = sites.get(key);
  if (kept) return kept;
  const u = Units.find((x) => x.key === key);
  if (!u) return undefined;
  const count = u.positions.length / 3;
  const symbols: string[] = [];
  const index = new Uint8Array(count);
  const radii = new Float32Array(count);
  for (let i = 0; i < count; ++i) {
    const symbol = u.elements[i];
    let k = symbols.indexOf(symbol);
    if (k < 0) k = symbols.push(symbol) - 1;
    index[i] = k;
    radii[i] = VdwRadiusOfNumber(AtomNumber(ElementSymbol(symbol)));
  }
  const s: ParticleSites = {
    count,
    positions: Float32Array.from(u.positions),
    radii,
    label: key,
    chains: { offsets: Int32Array.from(u.chains.offsets), labels: u.chains.labels },
    elements: { symbols, index },
  };
  sites.set(key, s);
  return s;
}

/** The units' keys, in a fixed order (a unit's target id after a list's is of its place here: stable) */
export const FiberUnitKeys: readonly string[] = Units.map((u) => u.key);
