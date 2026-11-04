/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A cellPACK mmCIF made here (it loads as `mmcif_particles`, its three entities as structure targets): the Exosome's
// rows (the sentence in `_entity.pdbx_parent_entity_id`, one with a Markdown link) and an MG-like row (its compartment
// there, `details` a function: no description).

export const CellpackCif = `data_cellpack_descriptions
loop_
_entity.id
_entity.pdbx_description
_entity.details
_entity.pdbx_parent_entity_id
1 root.exosome.surface.proteins.ITG ? 'Integrin alpha-5, important for cell adhesion and signaling.'
2 root.exosome.surface.proteins.CD81 ? 'CD81 antigen PDB entry [5TCX](http://www.rcsb.org/pdb/explore.do?structureId=5TCX)'
3 root.mge.interior.proteins.RNA_POLYMERASE transcription root.mge.interior.proteins

loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA ALA A 1 1 0 0 0
ATOM 2 C CA ALA B 2 1 0 0 0
ATOM 3 C CA ALA C 3 1 0 0 0

loop_
_pdbx_struct_assembly_gen.assembly_id
_pdbx_struct_assembly_gen.oper_expression
_pdbx_struct_assembly_gen.asym_id_list
1 '(1)' A,B,C

loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 1 0 0 0 1 0 0 0
`;
