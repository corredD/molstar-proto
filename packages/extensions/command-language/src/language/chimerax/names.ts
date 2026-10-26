/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// ChimeraX's command names, as a stock ChimeraX 1.10 registers them (read from its registry, without the add-on
// bundles of the machine it was read on): a typed word that is no command's whole name is the first command, in this
// order, that starts with it (ChimeraX's own rule: `sh` is `shape`, `s` is `smoothlines`), so an abbreviation means
// here what it means there. A subcommand's word resolves the same way among its command's subcommands.

/** Every top-level command, in registration order. */
export const ChimeraxCommandOrder: readonly string[] = (
  'toolshed devel pip debug info remotecontrol preset smoothlines foldseek similarstructures sequence boltz ' +
  'segmentation mcopy movie device shape struts ~struts ui mousemode lookingglass webcam vr xr segger ' +
  'modeller measure 2dlabels scalebar label ~label rna viewdockx name mutationscores log combine pbond ' +
  '~pbond alias ~alias align altlocs angle camera cartoon ~cartoon cd clip ~clip close cofr ~cofr color ' +
  'colour colordef ~colordef colourdef ~colourdef coordset crossfade defattr delete dssp exit quit fly ' +
  'getcrd graphics hide ~show ~display lighting material move palette perframe ~perframe pwd rainbow rename ' +
  'ribbon ~ribbon rmsd rock roll runscript select ~select set ~set setattr show display size split stop ' +
  'style sym tile ~tile time transparency turn undo redo usage version view wait windowsize wobble worm ' +
  '~worm zoom vseries addcharge alphafold build bond ~bond esmfold resfit hkcage torsion help clashes ' +
  'contacts ~clashes ~contacts zone key ~key tug registration cage swapaa swapna open echo blastprotein ' +
  'blastpdb morph bumps cbumps mseries surface ~surface sop volume topography unitcell ks snapshot meeting ' +
  'vop renumber buttonpanel hbonds ~hbonds functionkey nucleotides ~nucleotides segmentations taskman addh ' +
  'define marker dockprep fitmap matchmaker mmaker distance ~distance mlp changechains crosslinks tool save ' +
  'coulombic kvfinder interfaces crystalcontacts molmap modelcif aniso ~aniso'
).split(' ');

/** The subcommands of the commands the table has, in registration order. */
export const ChimeraxSubcommandOrder: Readonly<Record<string, readonly string[]>> = {
  color: [
    'delete',
    'list',
    'name',
    'show',
    'electrostatic',
    'sample',
    'gradient',
    'radial',
    'cylindrical',
    'height',
    'image',
    'modify',
    'sequential',
    'byattribute',
    'bfactor',
    'zone',
    'single',
  ],
  cartoon: ['tether', 'style', 'hide', 'byattribute'],
  select: ['zone', 'add', 'subtract', 'intersect', 'up', 'down', 'clear'],
  label: ['missing', 'orient', 'delete', 'listfonts'],
  distance: ['delete', 'style', 'save'],
  name: ['frozen', 'delete', 'list'],
  view: ['list', 'delete', 'name', 'initial', 'matrix', 'position'],
  surface: [
    'showPatches',
    'hidePatches',
    'close',
    'style',
    'squaremesh',
    'showall',
    'cap',
    'dust',
    'undust',
    'hidefarblobs',
    'invertShown',
    'transform',
    'zone',
    'unzone',
    'check',
    'splitbycolor',
    'smooth',
  ],
  info: [
    'bounds',
    'models',
    'chains',
    'polymers',
    'residues',
    'atoms',
    'selection',
    'atomattr',
    'atomcolor',
    'bondattr',
    'resattr',
    'rescolor',
    'distmat',
    'notify',
    'path',
  ],
  measure: [
    'blob',
    'buriedarea',
    'center',
    'convexity',
    'correlation',
    'inertia',
    'length',
    'rotation',
    'symmetry',
    'weight',
    'motion',
    'sasa',
    'volume',
    'area',
    'contactArea',
    'mapstats',
    'mapvalues',
  ],
  graphics: ['rate', 'quality', 'silhouettes', 'selection', 'restart', 'triangles', 'driver', 'shader'],
  lighting: ['model'],
  close: ['session'],
  save: ['formats'],
  open: ['formats'],
  size: ['byattribute'],
  move: ['cofr'],
  undo: ['list', 'clear', 'depth'],
};

/** The command a typed word names: its whole name, else the first that starts with it; undefined: none. */
export function resolveWord(word: string, order: readonly string[]): string | undefined {
  if (order.includes(word)) return word;
  return order.find((c) => c.startsWith(word));
}
