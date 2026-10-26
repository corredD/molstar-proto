/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The attributes an atom spec tests (`@@bfactor>40`, `::name="HOH"`, `//chain_id=A`): ChimeraX's names for the
// atom, residue and chain properties Mol* has. Others (`idatm_type`, `display`, `color`, `selected`) are its state or
// its chemistry, which Mol* does not have: their tests fail, saying so.

import { MolScriptBuilder as B } from '../../language/builder.js';
import type { Expression } from '../../language/expression.js';

export type AttrLevel = 'atom' | 'residue' | 'chain' | 'model';

export interface Attribute {
  readonly '@desc': string;
  readonly kind: 'number' | 'string' | 'bool';
  readonly property: () => Expression;
}

export const attributes: { readonly [L in AttrLevel]: { readonly [name: string]: Attribute } } = {
  atom: {
    bfactor: { '@desc': 'B-factor', kind: 'number', property: () => B.ammp('B_iso_or_equiv') },
    occupancy: { '@desc': 'occupancy', kind: 'number', property: () => B.ammp('occupancy') },
    name: { '@desc': 'atom name', kind: 'string', property: () => B.ammp('auth_atom_id') },
    element: { '@desc': 'element symbol', kind: 'string', property: () => B.acp('elementSymbol') },
    serial_number: { '@desc': 'serial number in the file', kind: 'number', property: () => B.ammp('id') },
    alt_loc: { '@desc': 'alternate location', kind: 'string', property: () => B.ammp('label_alt_id') },
  },
  residue: {
    name: { '@desc': 'residue name', kind: 'string', property: () => B.ammp('auth_comp_id') },
    number: { '@desc': 'residue number', kind: 'number', property: () => B.ammp('auth_seq_id') },
    insertion_code: { '@desc': 'insertion code', kind: 'string', property: () => B.ammp('pdbx_PDB_ins_code') },
    chain_id: { '@desc': 'chain identifier', kind: 'string', property: () => B.ammp('auth_asym_id') },
    is_helix: {
      '@desc': 'in a helix',
      kind: 'bool',
      property: () =>
        B.core.flags.hasAny([B.ammp('secondaryStructureFlags'), B.struct.type.secondaryStructureFlags(['helix'])]),
    },
    is_strand: {
      '@desc': 'in a strand',
      kind: 'bool',
      property: () =>
        B.core.flags.hasAny([B.ammp('secondaryStructureFlags'), B.struct.type.secondaryStructureFlags(['beta'])]),
    },
  },
  chain: {
    chain_id: { '@desc': 'chain identifier', kind: 'string', property: () => B.ammp('auth_asym_id') },
  },
  model: {},
};
