/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { coarseLevelOrder, type CutterTable } from './cutter.js';

// A lipid mix per membrane (lipid-procedural round 7 item 3; Ludo, 2026-11-09): the yeast cell's membranes, by the part's
// name (the yeast viewer's `OrganelleMembraneNames`), each leaflet's lipid classes in mol %, from Delphine's tables
// (progress/2026-11-08-lipid-procedural.md, item 3 groundwork, each number's source there). Built from the CHARMM-GUI
// patch's species by stand-ins (no download: the real ERG and TOCL patch later, TODO): a leaflet's table keeps the patch's
// lipid places and turns, each place given a species by the mix (`mixTable`).

/** The lipid classes of the yeast tables: ergosterol, the glycerophospholipids, cardiolipin, the inositol sphingolipids */
export type LipidClass = 'ERG' | 'PC' | 'PE' | 'PI' | 'PS' | 'PA' | 'CL' | 'SL';
export type LeafletMix = { readonly [c in LipidClass]?: number };

/** A membrane's mix: its outer leaflet, its inner (none: a monolayer, the lipid droplet's), where it is the PM's */
export interface MembraneMix {
  readonly outer: LeafletMix;
  readonly inner?: LeafletMix;
  readonly plasma: boolean;
}

/** `mix` with its ergosterol at `erg` mol %, the other classes scaled to fill the rest */
export function withSterol(mix: LeafletMix, erg: number): LeafletMix {
  let rest = 0;
  for (const c in mix) if (c !== 'ERG') rest += mix[c as LipidClass]!;
  const out: { [c in LipidClass]?: number } = { ERG: erg };
  for (const c in mix) if (c !== 'ERG') out[c as LipidClass] = (mix[c as LipidClass]! * (100 - erg)) / rest;
  return out;
}

/**
 * The PM's sterol by the most recent source (Ludo: a conflict takes the most recent source, by the measurement's
 * publication; the others recorded beside it): van 't Klooster 2020, 25–30 % (taken 27.5), over Schneiter 1999's 31.5
 * and Surma 2011's over 44 (as Reinhard 2024 quotes it). 80 % of it in the inner leaflet (Solanko 2018): inner 44.0,
 * outer 11.0 of each leaflet's lipids
 */
const PmSterol = 27.5;
const PmInnerSterol = 0.8 * 2 * PmSterol;

/**
 * The mixes (Delphine's recommended table, mol %; the ER's sterol Reinhard 2024's 9.7 over Schneiter's 15.3, the
 * vacuole's Reinhard 2024's 11.7 over 6.5, the LD's PC Grillitsch 2011's over Leber 1994's: the most recent each)
 */
export const YeastMixes: { readonly [name: string]: MembraneMix } = {
  PM: {
    plasma: true,
    outer: withSterol(
      { ERG: 13.5, PC: 28.9, PE: 4.6, PI: 3.4, PS: 5.2, PA: 0.5, SL: 44.0 },
      2 * PmSterol - PmInnerSterol,
    ),
    inner: withSterol({ ERG: 47.3, PE: 14.2, PI: 10.5, PS: 25.7, PA: 2.3 }, PmInnerSterol),
  },
  MITO_IM: mono({ ERG: 11.4, PC: 43.1, PE: 21.5, PI: 12.2, PS: 3.2, PA: 2.4, CL: 6.2 }, true),
  MITO_OM: mono({ ERG: 3.0, PC: 43.8, PE: 33.8, PI: 13.9, PS: 1.5, PA: 1.5, CL: 2.5 }, true),
  ER: mono({ ERG: 9.7, PC: 47.2, PE: 23.6, PI: 13.4, PS: 3.5, PA: 2.6 }, true),
  VAC: mono({ ERG: 11.7, PC: 47.5, PE: 23.7, PI: 13.5, PS: 3.5 }, true),
  // a monolayer: its one leaflet the outer (facing the cytosol)
  LD: mono({ ERG: 19.4, PC: 46.6, PE: 13.5, PI: 17.4, PS: 1.7, PA: 1.5 }, false),
};

function mono(mix: LeafletMix, bilayer: boolean): MembraneMix {
  return bilayer ? { outer: mix, inner: mix, plasma: false } : { outer: mix, plasma: false };
}

/** Membranes without a table of their own, and the one standing in (the endomembranes': the ER's) */
const MixStandIns: { readonly [name: string]: string } = { NE: 'ER', GOLGI: 'ER', PEROX: 'ER' };

/** The mix of a part named `name` (a yeast membrane), or none (a mesh of another name: the patch as it is) */
export function mixOf(name: string | undefined): MembraneMix | undefined {
  if (!name) return undefined;
  return YeastMixes[name] ?? YeastMixes[MixStandIns[name]];
}

/**
 * The CHARMM-GUI patch's species standing in for each class (Ludo, 2026-11-09): ergosterol CHL1, the sphingolipids SSM,
 * cardiolipin two DOPA (then renormalized), PC POPC in the PM and DOPC elsewhere, PE POPE in the PM and PLPE elsewhere
 */
export function standIns(mix: LeafletMix, plasma: boolean): { readonly [species: string]: number } {
  const species: { [c in LipidClass]: string } = {
    ERG: 'CHL1',
    PC: plasma ? 'POPC' : 'DOPC',
    PE: plasma ? 'POPE' : 'PLPE',
    PI: 'POPI',
    PS: 'POPS',
    PA: 'DOPA',
    CL: 'DOPA',
    SL: 'SSM',
  };
  const out: { [s: string]: number } = {};
  let total = 0;
  for (const c in mix) {
    const v = mix[c as LipidClass]! * (c === 'CL' ? 2 : 1);
    if (v <= 0) continue;
    const s = species[c as LipidClass];
    out[s] = (out[s] ?? 0) + v;
    total += v;
  }
  for (const s in out) out[s] /= total;
  return out;
}

/** exact counts of `n` by `fractions` (largest remainder), in the order of `names` */
function exactCounts(n: number, names: readonly string[], fractions: { readonly [s: string]: number }) {
  const counts = names.map((s) => Math.floor(n * fractions[s]));
  let left = n - counts.reduce((a, b) => a + b, 0);
  const order = names
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = n * fractions[names[a]] - counts[a];
      const rb = n * fractions[names[b]] - counts[b];
      return rb - ra || a - b;
    });
  for (let i = 0; left > 0; i = (i + 1) % order.length, --left) counts[order[i]] += 1;
  return counts;
}

function hash(x0: number) {
  let x = x0 >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * The leaflet's table `own` with its lipids given species by `fractions` (`standIns`), their counts exact: each place of
 * the patch (its headgroup and turn) kept, its species drawn by a shuffle seeded by `seed`, its member one of that
 * species' conformers. A species the leaflet lacks takes the other leaflet's (`other`) conformers, mirrored through the
 * bilayer's center (z negated). Deterministic; O(lipids of the patch)
 */
export function mixTable(
  own: CutterTable,
  other: CutterTable | undefined,
  fractions: { readonly [species: string]: number },
  seed: number,
): CutterTable {
  const names = Object.keys(fractions).filter((s) => fractions[s] > 0);
  const members: { species: number; positions: Float32Array; elements: Uint8Array }[] = [];
  const membersOf: number[][] = [];
  for (let k = 0; k < names.length; ++k) {
    const list: number[] = [];
    const fromOwn = own.species.indexOf(names[k]);
    const source = fromOwn >= 0 ? own : other;
    const s = fromOwn >= 0 ? fromOwn : (other?.species.indexOf(names[k]) ?? -1);
    if (s < 0 || !source) throw new Error(`No ${names[k]} in the lipid patch: a mix needs it`);
    const mirrored: { positions: Float32Array; elements: Uint8Array }[] = [];
    for (const m of source.members) {
      if (m.species !== s) continue;
      let positions = m.positions;
      if (source !== own) {
        positions = positions.slice();
        for (let i = 2; i < positions.length; i += 3) positions[i] = -positions[i];
      }
      const member = { species: k, positions, elements: m.elements };
      if (source !== own) mirrored.push(member);
      list.push(members.length);
      members.push(member);
    }
    // the mirrored conformers' atoms in the levels' order of their new side
    if (mirrored.length) coarseLevelOrder(mirrored);
    membersOf.push(list);
  }
  const n = own.memberStart[own.members.length];
  const counts = exactCounts(n, names, fractions);
  // the places shuffled (Fisher–Yates by the hash), then dealt to the species in order
  const place = new Uint32Array(n);
  for (let i = 0; i < n; ++i) place[i] = i;
  for (let i = n - 1; i > 0; --i) {
    const j = hash(seed ^ hash(i)) % (i + 1);
    const t = place[i];
    place[i] = place[j];
    place[j] = t;
  }
  const memberOf = new Uint32Array(n);
  for (let k = 0, i = 0; k < names.length; ++k) {
    const list = membersOf[k];
    for (let c = 0; c < counts[k]; ++c, ++i) memberOf[place[i]] = list[c % list.length];
  }
  const memberStart = new Uint32Array(members.length + 1);
  for (let l = 0; l < n; ++l) memberStart[memberOf[l] + 1] += 1;
  for (let m = 0; m < members.length; ++m) memberStart[m + 1] += memberStart[m];
  const fill = memberStart.slice(0, members.length);
  const lipids = new Float32Array(n * 4);
  for (let l = 0; l < n; ++l) lipids.set(own.lipids.subarray(l * 4, l * 4 + 4), fill[memberOf[l]]++ * 4);
  return { species: names, members, memberStart, lipids, box: own.box };
}
