/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

export const examples = [
  { name: 'Chain A', value: '/A' },
  { name: 'Residues 12 to 20 of chain A', value: '/A:12-20' },
  { name: 'C-alpha atoms', value: '@CA' },
  { name: 'C-alpha and C-beta atoms of residues 1 to 10', value: ':1-10@CA,CB' },
  { name: 'Retinoic acid residues', value: ':REA' },
  { name: 'Proteins', value: 'protein' },
  { name: 'Ligands', value: 'ligand' },
  { name: 'Residues within 5 Å of a ligand', value: 'ligand :<5' },
  { name: 'Everything but proteins', value: '~protein' },
  { name: 'Helices of chain A', value: '/A & helix' },
  { name: 'Atoms with a B-factor above 40', value: '@@bfactor>40' },
  { name: 'Waters by residue name', value: '::name="HOH"' },
  { name: 'Carbon atoms', value: 'C' },
  { name: 'Model 1, chain A', value: '#1/A' },
  { name: 'Side chains of residues 40 to 60', value: ':40-60 & sideonly' },
];
