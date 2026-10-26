/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// ChimeraX's built-in selectors (chimerax/atomic/selectors.py): the words an atom spec takes as terms (`protein`,
// `ligand`, `C`). Their atoms as ChimeraX 1.10 picks them, checked against its counts on 1CBS and 1TUP
// (`model/src/script/_test/chimerax-oracle.test.ts`).

import { MolScriptBuilder as B } from '../../language/builder.js';
import type { Expression } from '../../language/expression.js';

export interface Selector {
  readonly '@desc': string;
  /** Not given: a ChimeraX selector Mol* does not have (its message says so). */
  readonly map?: () => Expression;
}

const entity = (test: Expression) => B.struct.generator.atomGroups({ 'entity-test': test });

const proteinTest = () =>
  B.core.logic.and([
    B.core.rel.eq([B.ammp('entityType'), 'polymer']),
    B.core.str.match([B.re('(polypeptide|cyclic-pseudo-peptide|peptide-like)', 'i'), B.ammp('entitySubtype')]),
  ]);
const nucleicTest = () =>
  B.core.logic.and([
    B.core.rel.eq([B.ammp('entityType'), 'polymer']),
    B.core.str.match([B.re('(nucleotide|peptide nucleic acid)', 'i'), B.ammp('entitySubtype')]),
  ]);

/** Atoms of polymer residues (`protein` or `nucleic`) whose names are, or are not, in a list. */
function namedIn(polymer: () => Expression, names: readonly string[], inList: boolean) {
  const has = B.core.set.has([B.core.type.set(names.map(B.atomName)), B.ammp('label_atom_id')]);
  return B.struct.generator.atomGroups({
    'entity-test': polymer(),
    'atom-test': inList ? has : B.core.logic.not([has]),
  });
}

const ProteinBackbone = ['N', 'CA', 'C', 'O', 'OXT'];
const ProteinMinBackbone = ['N', 'CA', 'C'];
const NucleicBackbone = ['P', 'OP1', 'OP2', 'OP3', "O5'", "C5'", "C4'", "C3'", "O3'", "C2'", "C1'", "O4'", "O2'"];
const NucleicMinBackbone = ['P', "O5'", "C5'", "C4'", "C3'", "O3'"];
/** Nucleic atoms that are not a side chain's: the phosphate and the sugar's C5' and O5' (the rest of the ring is). */
const NucleicNotSidechain = ['P', 'OP1', 'OP2', 'OP3', "O5'", "C5'", "O3'"];
const Ribose = ["C1'", "C2'", "C3'", "C4'", "C5'", "O2'", "O3'", "O4'", "O5'"];

const merge = (...xs: Expression[]) => B.struct.combinator.merge(xs);

const secondary = (flags: string[]) =>
  B.struct.generator.atomGroups({
    'entity-test': proteinTest(),
    'residue-test': B.core.flags.hasAny([
      B.ammp('secondaryStructureFlags'),
      B.struct.type.secondaryStructureFlags(flags),
    ]),
  });

/** The element symbols, as ChimeraX 1.10 names its element selectors (case matters: `C`, `Zn`; `Uut`, not `Nh`). */
export const ElementSymbols = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr ' +
  'Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt ' +
  'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Uut Fl ' +
  'Uup Uuh Uus Uuo D'
).split(' ');

const unsupported = (desc: string): Selector => ({ '@desc': desc });

export const selectors: { readonly [name: string]: Selector } = {
  all: { '@desc': 'everything', map: () => B.struct.generator.all() },
  protein: { '@desc': 'proteins', map: () => entity(proteinTest()) },
  nucleic: { '@desc': 'nucleic acids', map: () => entity(nucleicTest()) },
  'nucleic-acid': { '@desc': 'nucleic acids', map: () => entity(nucleicTest()) },
  main: {
    '@desc': 'the main structure: polymers',
    map: () => entity(B.core.rel.eq([B.ammp('entityType'), 'polymer'])),
  },
  ligand: {
    '@desc': 'ligands: small molecules other than solvent and ions',
    map: () =>
      entity(
        B.core.logic.or([
          B.core.logic.and([
            B.core.rel.eq([B.ammp('entityType'), 'non-polymer']),
            B.core.logic.not([B.core.rel.eq([B.ammp('entitySubtype'), 'ion'])]),
          ]),
          B.core.rel.eq([B.ammp('entityType'), 'branched']),
        ]),
      ),
  },
  ions: { '@desc': 'ions', map: () => entity(B.core.rel.eq([B.ammp('entitySubtype'), 'ion'])) },
  solvent: { '@desc': 'solvent', map: () => entity(B.core.rel.eq([B.ammp('entityType'), 'water'])) },
  backbone: {
    '@desc': 'backbone atoms',
    map: () => merge(namedIn(proteinTest, ProteinBackbone, true), namedIn(nucleicTest, NucleicBackbone, true)),
  },
  mainchain: {
    '@desc': 'backbone atoms',
    map: () => merge(namedIn(proteinTest, ProteinBackbone, true), namedIn(nucleicTest, NucleicBackbone, true)),
  },
  'min-backbone': {
    '@desc': 'minimal backbone atoms',
    map: () => merge(namedIn(proteinTest, ProteinMinBackbone, true), namedIn(nucleicTest, NucleicMinBackbone, true)),
  },
  sidechain: {
    '@desc': 'side-chain atoms, with the CA (proteins) and the sugar ring (nucleic acids)',
    map: () =>
      merge(namedIn(proteinTest, ['N', 'C', 'O', 'OXT'], false), namedIn(nucleicTest, NucleicNotSidechain, false)),
  },
  sideonly: {
    '@desc': 'side-chain atoms only',
    map: () =>
      merge(namedIn(proteinTest, ProteinBackbone, false), namedIn(nucleicTest, [...NucleicBackbone, ...Ribose], false)),
  },
  ribose: { '@desc': 'ribose', map: () => namedIn(nucleicTest, Ribose, true) },
  helix: { '@desc': 'helices', map: () => secondary(['helix']) },
  strand: { '@desc': 'strands', map: () => secondary(['beta']) },
  coil: {
    '@desc': 'coils',
    map: () =>
      B.struct.generator.atomGroups({
        'entity-test': proteinTest(),
        'residue-test': B.core.logic.not([
          B.core.flags.hasAny([
            B.ammp('secondaryStructureFlags'),
            B.struct.type.secondaryStructureFlags(['helix', 'beta']),
          ]),
        ]),
      }),
  },
  'sel-residues': unsupported('the current selection promoted to full residues'),
  'template-mismatch': unsupported('residues missing heavy atoms'),
  pbonds: unsupported('pseudobonds'),
  hbonds: unsupported('hydrogen bonds'),
  clashes: unsupported('clashes'),
  contacts: unsupported('contacts'),
  missing: unsupported('missing-structure pseudobonds'),
  // Chemical groups (chimerax/chem_group): by bonding pattern, which Mol* does not classify.
  ...Object.fromEntries(
    [
      'aromatic',
      'aliphatic',
      'amide',
      'amine',
      'carbonyl',
      'carboxylate',
      'disulfide',
      'ester',
      'ether',
      'hydroxyl',
      'methyl',
      'nitro',
      'phosphate',
      'sulfonate',
      'thiol',
    ].map((g) => [g, unsupported(`the ${g} chemical group`)]),
  ),
};

/** IDATM atom types ChimeraX takes as selectors (`C3`, `Npl`): by bonding, which Mol* does not assign. */
export const IdatmTypes = new Set(
  (
    'C3 C2 Car Cac C1 C1- C N3+ N3 Npl Ng+ N2 N1+ N1 Ntr Nox Ngu N O3 O2 O1 O1+ O3- O2- Oar Oar+ Ox S3+ S3 S3- S2 ' +
    'Sac Son Sxd S Pac Pox P3+ P HC H D DC'
  ).split(' '),
);

const ElementSet = new Set(ElementSymbols);

/** An element selector's expression, or undefined. Case matters, as in ChimeraX (`C` is carbon, `c` nothing). */
export function elementSelector(name: string): Expression | undefined {
  if (!ElementSet.has(name)) return undefined;
  return B.struct.generator.atomGroups({ 'atom-test': B.core.rel.eq([B.acp('elementSymbol'), B.es(name)]) });
}
