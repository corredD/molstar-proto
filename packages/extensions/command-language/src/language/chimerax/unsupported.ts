/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Unsupported } from '../table.js';

// ChimeraX's commands that Mol* does not do (chimerax.md §5), with what to do instead; every other command of
// ChimeraX's (`ChimeraxCommandOrder`) that the table lacks fails too, saying it is ChimeraX's. Never a silent no-op.

const editing = 'Mol* shows structures as they are loaded; it does not edit them.';
const python = 'Scripts here are ChimeraX commands; Python is not run.';
const volumes = 'Maps and volumes are not supported yet.';
const movies = 'Use the snapshots and animation panels.';
const interactions = 'Mol* shows interactions from the Structure panel (the Interactions component).';

export const ChimeraxUnsupported: readonly Unsupported[] = [
  { name: 'volume', why: 'Maps and volumes are not supported yet.', hint: volumes },
  { name: 'vop', why: 'Map operations are not supported.', hint: volumes },
  { name: 'molmap', why: 'Maps from atoms are not supported.', hint: volumes },
  { name: 'fitmap', why: 'Fitting into maps is not supported.', hint: volumes },
  { name: 'segger', why: 'Map segmentation is not supported.', hint: volumes },
  { name: 'segmentation', why: 'Segmentations are not supported.', hint: volumes },
  { name: 'segmentations', why: 'Segmentations are not supported.', hint: volumes },
  { name: 'measure', why: 'Of the measure commands only `measure center` is supported.' },
  { name: 'delete', why: 'Deleting atoms is not supported.', hint: `${editing} Hide them: hide …` },
  { name: 'addh', why: 'Adding hydrogens is not supported.', hint: editing },
  { name: 'addcharge', why: 'Adding charges is not supported.', hint: editing },
  { name: 'swapaa', why: 'Mutating residues is not supported.', hint: editing },
  { name: 'swapna', why: 'Mutating residues is not supported.', hint: editing },
  { name: 'build', why: 'Building is not supported.', hint: editing },
  { name: 'bond', why: 'Adding bonds is not supported.', hint: editing },
  { name: 'altlocs', why: 'Changing alternate locations is not supported.', hint: editing },
  { name: 'changechains', why: 'Renaming chains is not supported.', hint: editing },
  { name: 'renumber', why: 'Renumbering residues is not supported.', hint: editing },
  { name: 'setattr', why: 'Setting attributes is not supported.', hint: editing },
  { name: 'defattr', why: 'Setting attributes is not supported.', hint: editing },
  { name: 'hbonds', why: 'Hydrogen bonds are not drawn.', hint: interactions },
  { name: 'contacts', why: 'Contacts are not drawn.', hint: interactions },
  { name: 'clashes', why: 'Clashes are not drawn.', hint: interactions },
  { name: 'interfaces', why: 'Interface diagrams are not drawn.', hint: interactions },
  {
    name: 'sym',
    why: 'Symmetry copies by command are not supported.',
    hint: 'Mol*’s Assembly in the Structure panel shows assemblies.',
  },
  { name: 'morph', why: 'Morphs are not supported.', hint: movies },
  { name: 'movie', why: 'Movies are not recorded here.', hint: movies },
  { name: 'roll', why: 'Turning without end is not supported.', hint: 'turn y 90 turns once; the Spin control spins.' },
  { name: 'rock', why: 'Rocking is not supported.', hint: 'turn y 30 turns once.' },
  { name: 'wobble', why: 'Wobbling is not supported.', hint: 'turn y 30 turns once.' },
  { name: '2dlabels', why: 'Labels on the screen are not supported.', hint: 'label puts labels on atoms or residues.' },
  { name: 'shape', why: 'Shapes are not drawn.' },
  { name: 'marker', why: 'Markers are not placed.' },
  { name: 'clip', why: 'Clipping by command is not supported.', hint: 'The Canvas panel clips the view.' },
  { name: 'cofr', why: 'The center of rotation is not set by command.', hint: 'Mol* turns about the view’s center.' },
  { name: 'nucleotides', why: 'Nucleotide shapes are not drawn.', hint: 'cartoon shows nucleic acids.' },
  { name: 'sequence', why: 'The sequence viewer is not driven by command.' },
  { name: 'tile', why: 'Arranging models is not supported.' },
  { name: 'split', why: 'Splitting models is not supported.' },
  { name: 'combine', why: 'Combining models is not supported.' },
  { name: 'rename', why: 'Renaming models is not supported.' },
  { name: 'palette', why: 'Palettes by command are not supported.', hint: 'color bfactor and rainbow take palette.' },
  { name: 'key', why: 'Color keys are not drawn.' },
  { name: 'scalebar', why: 'Scale bars are not drawn.' },
  { name: 'perframe', why: 'Commands per frame are not run.', hint: movies },
  { name: 'alias', why: 'Aliases are not defined.' },
  { name: 'runscript', why: 'Python scripts are not run.', hint: python },
  { name: 'pwd', why: 'There is no folder: files come with the script.' },
  { name: 'cd', why: 'There is no folder: files come with the script.' },
  { name: 'log', why: 'The console is the log.' },
  {
    name: 'windowsize',
    why: 'The window is the page’s.',
    hint: 'save image.png width 1200 height 900 sets the image’s size.',
  },
  { name: 'material', why: 'Materials are Mol*’s.', hint: 'lighting soft, lighting full.' },
  { name: 'dssp', why: 'Secondary structure is Mol*’s (the file’s, else computed).' },
  { name: 'coulombic', why: 'Electrostatic coloring is not supported.' },
  { name: 'mlp', why: 'Lipophilicity coloring is not supported.' },
  {
    name: 'alphafold',
    why: 'Of AlphaFold’s commands, fetching is open alphafold:UniProtId.',
    hint: 'open alphafold:P69905',
  },
  { name: 'esmfold', why: 'Predicting structures is not supported.' },
  { name: 'boltz', why: 'Predicting structures is not supported.' },
  { name: 'blastprotein', why: 'Sequence searches are not supported.' },
  { name: 'blastpdb', why: 'Sequence searches are not supported.' },
  { name: 'foldseek', why: 'Structure searches are not supported.' },
  { name: 'similarstructures', why: 'Structure searches are not supported.' },
  { name: 'modeller', why: 'Modelling is not supported.' },
  { name: 'rmsd', why: 'RMSD without superposing is not supported.', hint: 'matchmaker and align say the RMSD.' },
  { name: 'exit', why: 'There is nothing to quit.' },
  { name: 'quit', why: 'There is nothing to quit.' },
  { name: 'toolshed', why: 'Bundles are not installed here.' },
  { name: 'ui', why: 'ChimeraX’s windows are not here.' },
  { name: 'tool', why: 'ChimeraX’s tools are not here.' },
  { name: 'mousemode', why: 'Mouse modes are Mol*’s.' },
  { name: 'vr', why: 'VR by command is not supported.', hint: 'The Canvas panel enters the headset view.' },
  { name: 'xr', why: 'XR by command is not supported.', hint: 'The Canvas panel enters the headset view.' },
];

export const ChimeraxUnsupportedByName: ReadonlyMap<string, Unsupported> = new Map(
  ChimeraxUnsupported.map((u) => [u.name, u] as const),
);
