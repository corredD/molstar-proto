/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';

// The whole yeast cell of zoidpuff's yeast_cell_viewer (design.md §13), described in MesoViewSpec. Conceptual: every
// fact is cited to the model's own description (MODEL.md, by section) and nothing of its data is copied (the repository
// states no license). It exercises what the exosome does not: a proteome too large to list (a catalog), a geometry
// stitched from two FIB/SEM cells and procedural shapes, frames whose handedness the source does not state, counts with
// conflicting evidence, a precomputed model in a tile format no resolver here reads, filaments that are helical
// lattices.

const MODEL_MD = 'https://github.com/zoidpuff/yeast_cell_viewer/blob/main/MODEL.md';
const DATA = 'https://zoidpuff.github.io/yeast_cell_viewer/data';
const md = (location: string) => ({ resource: 'r.model-md', location });
const pdb = (id: string) => ({
  id: `r.${id.toLowerCase()}`,
  kind: 'structure' as const,
  format: 'pdb-id',
  accession: { db: 'PDB', id },
});

export function yeastDoc(): MesoViewSpecDoc {
  return {
    format: 'meso_view_spec',
    version: '0.2.0',
    metadata: {
      title: 'Whole yeast cell (S. cerevisiae BY4741, YPD log phase), described',
      description:
        "A MesoViewSpec description of the yeast_cell_viewer model: its compartments, a few of its populations, its evidence and processing. Its placements stay in the model's own tile format.",
      organism: { name: 'Saccharomyces cerevisiae', taxon: 4932 },
      keywords: ['yeast', 'whole cell', 'FIB/SEM', 'proteome'],
    },
    units: { length: 'nm' },
    // the source states the units (nm) but not the origin, axes or handedness: left undeclared, reported (§3.4)
    frames: [
      {
        id: 'f.cell',
        kind: 'world',
        units: 'nm',
        convention: 'the model frame (origin and axes not stated by the source)',
      },
      { id: 'f.fibsem08', kind: 'instrument', units: 'nm', convention: 'EMPIAR-11416 cell 08' },
      { id: 'f.fibsem05', kind: 'instrument', units: 'nm', convention: 'EMPIAR-11416 cell 05' },
    ],
    alignments: [
      // 44.2 µm³ scaled to 42 µm³: a linear factor (42 / 44.2)^(1/3); the translation is not stated
      {
        id: 'al.cell08',
        from: 'f.fibsem08',
        to: 'f.cell',
        transform: { scale: 0.9831 },
        method: 'volume scaled from 44.2 to 42 µm³',
        evidence: ['ev.geometry'],
        activity: 'act.segment',
      },
      {
        id: 'al.cell05',
        from: 'f.fibsem05',
        to: 'f.cell',
        transform: { scale: 1 },
        method: "cell 05's nucleus scaled to 8% of the cell volume (the factor is not stated)",
        evidence: ['ev.geometry'],
        activity: 'act.segment',
      },
    ],
    resources: [
      {
        id: 'r.model-md',
        kind: 'document',
        format: 'markdown',
        uri: MODEL_MD,
        label: 'Whole yeast cell: model description',
      },
      {
        id: 'r.empiar',
        kind: 'dataset',
        format: 'empiar',
        accession: { db: 'EMPIAR', id: '11416' },
        label: 'cryo-plasma FIB/SEM of log-phase yeast',
        license: 'CC0',
      },
      {
        id: 'r.seg08',
        kind: 'segmentation',
        format: 'npz',
        uri: 'pipeline/cell_meshes.npz',
        frame: 'f.fibsem08',
        label: 'cell 08: outline, vacuoles, lipid droplets',
        select: { cell: '08' },
      },
      {
        id: 'r.seg05',
        kind: 'segmentation',
        format: 'npz',
        uri: 'pipeline/cell_meshes.npz',
        frame: 'f.fibsem05',
        label: 'cell 05: nucleus',
        select: { cell: '05' },
      },
      {
        id: 'r.geometry',
        kind: 'volume',
        format: 'yct-geometry+json',
        uri: `${DATA}/geometry.json`,
        frame: 'f.cell',
        label: 'analytic SDF primitives of the procedural compartments',
      },
      {
        id: 'r.paxdb',
        kind: 'table',
        format: 'paxdb-tsv',
        label: 'PaxDb integrated S. cerevisiae abundances',
        accession: { db: 'PaxDb', id: '4932' },
      },
      { id: 'r.uniprot', kind: 'dataset', format: 'uniprot-proteome', accession: { db: 'UniProt', id: 'UP000002311' } },
      {
        id: 'r.afdb',
        kind: 'dataset',
        format: 'alphafold-db',
        uri: 'https://alphafold.ebi.ac.uk',
        label: 'AlphaFold DB, S. cerevisiae',
        license: 'CC-BY-4.0',
      },
      {
        id: 'r.string',
        kind: 'table',
        format: 'string-links',
        uri: 'https://string-db.org',
        label: 'STRING v12 interactions',
        license: 'CC-BY-4.0',
      },
      {
        id: 'r.tiles',
        kind: 'placements',
        format: 'yct1-tiles',
        uri: `${DATA}/tiles/index.json`,
        frame: 'f.cell',
        label: '200 nm tiles of placed instances',
      },
      pdb('4V88'),
      pdb('7N9F'),
      pdb('1ID3'),
      pdb('7VH5'),
      pdb('6O7V'),
      pdb('8QV3'),
    ],
    entities: [
      { id: 'e.ribosome', label: '80S ribosome', kind: 'complex', structure: { resource: 'r.4v88' } },
      { id: 'e.npc', label: 'nuclear pore complex', kind: 'complex', structure: { resource: 'r.7n9f' } },
      { id: 'e.nucleosome', label: 'nucleosome', kind: 'complex', structure: { resource: 'r.1id3' } },
      {
        id: 'e.pma1',
        label: 'Pma1 (plasma membrane H+-ATPase)',
        kind: 'complex',
        identifiers: { gene: 'PMA1' },
        structure: { resource: 'r.7vh5' },
        topology: { type: 'multi-pass' },
      },
      {
        id: 'e.vatpase',
        label: 'V-ATPase',
        kind: 'complex',
        structure: { resource: 'r.6o7v' },
        topology: { type: 'multi-pass' },
      },
      { id: 'e.tubulin', label: 'αβ-tubulin dimer', kind: 'protein', structure: { resource: 'r.8qv3' } },
    ],
    compartments: [
      {
        id: 'c.cell',
        label: 'cell',
        kind: 'cell',
        geometry: { kind: 'segmentation', resource: 'r.seg08', label: 'outline' },
        membrane: {},
        evidence: ['ev.geometry', 'ev.volumes'],
      },
      {
        id: 'c.nucleus',
        label: 'nucleus',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: { kind: 'segmentation', resource: 'r.seg05', label: 'nucleus' },
        membrane: { thickness: 34 },
        evidence: ['ev.geometry'],
      },
      {
        id: 'c.nucleolus',
        label: 'nucleolus',
        kind: 'region',
        parent: 'c.nucleus',
        geometry: { kind: 'implicit', description: 'procedural (MODEL.md §3.3)' },
        evidence: ['ev.volumes'],
      },
      {
        id: 'c.vacuole',
        label: 'vacuole (13 parts)',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: { kind: 'segmentation', resource: 'r.seg08', label: 'vacuoles' },
        membrane: {},
        evidence: ['ev.geometry'],
      },
      {
        id: 'c.mito',
        label: 'mitochondrial reticulum',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: { kind: 'implicit', description: 'one procedural reticulum, tubule radius 150 nm (MODEL.md §3.3)' },
        membrane: {},
        evidence: ['ev.procedural'],
      },
      {
        id: 'c.er',
        label: 'cortical ER',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: {
          kind: 'implicit',
          description: 'sheets 27 nm beneath the plasma membrane, 20 nm lumen (MODEL.md §3.3)',
        },
        membrane: {},
        evidence: ['ev.procedural'],
      },
      {
        id: 'c.wall',
        label: 'cell wall',
        kind: 'region',
        geometry: {
          kind: 'implicit',
          description: 'a 110 nm shell: β-1,3-glucan inside, mannan outside (MODEL.md §3.1, §7)',
        },
        evidence: ['ev.volumes'],
      },
    ],
    populations: [
      {
        id: 'p.ribosomes',
        entity: 'e.ribosome',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 169000 },
        range: [169000, 300000],
        evidence: ['ev.ribosome-count', 'ev.ribosome-growth-law'],
      },
      {
        id: 'p.npc',
        entity: 'e.npc',
        compartment: 'c.nucleus',
        location: 'membrane',
        abundance: { count: 117 },
        evidence: ['ev.npc-count'],
      },
      {
        id: 'p.nucleosomes',
        entity: 'e.nucleosome',
        compartment: 'c.nucleus',
        location: 'interior',
        abundance: { count: 73150 },
        arrangement: { kind: 'fiber', rise: 12.5, path: { resource: 'r.tiles' } },
        evidence: ['ev.chromatin'],
      },
      {
        id: 'p.microtubules',
        entity: 'e.tubulin',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 11661 },
        // 13 protofilaments: a helical lattice on a tube, which `fiber` (one copy per rise) cannot say (design.md §11)
        arrangement: { kind: 'fiber', rise: 8.3, path: { resource: 'r.tiles' } },
        evidence: ['ev.microtubules'],
      },
      {
        id: 'p.pma1',
        entity: 'e.pma1',
        compartment: 'c.cell',
        location: 'membrane',
        abundance: { count: 0 },
        evidence: ['ev.orientation', 'ev.proteome'],
      },
      {
        id: 'p.vatpase',
        entity: 'e.vatpase',
        compartment: 'c.vacuole',
        location: 'membrane',
        abundance: { count: 0 },
        evidence: ['ev.orientation', 'ev.proteome'],
      },
    ],
    catalogs: [
      {
        id: 'cat.proteome',
        resource: 'r.paxdb',
        columns: { entity: 'uniprot', compartment: 'localization', abundance: 'ppm' },
        abundanceKind: 'ppm',
        evidence: ['ev.proteome', 'ev.localization'],
      },
    ],
    models: [
      {
        id: 'm.yeast',
        label: 'yeast_cell_viewer packing',
        kind: 'precomputed',
        method: 'yeast-cell-viewer.tiles',
        populations: ['p.ribosomes', 'p.npc', 'p.nucleosomes', 'p.microtubules', 'p.pma1', 'p.vatpase'],
        inputs: ['r.tiles'],
        activity: 'act.pack',
      },
    ],
    evidence: [
      {
        id: 'ev.volumes',
        kind: 'literature',
        statement: 'Compartment volumes on the final 4 nm grid: 41.93 µm³ in all, cytosol 26.62 µm³',
        source: md('§3.1–3.2'),
      },
      {
        id: 'ev.geometry',
        kind: 'observation',
        statement: 'Outline, vacuoles and lipid droplets segmented from EMPIAR-11416 cell 08; the nucleus from cell 05',
        source: { ...md('§3.3'), citation: { text: 'Dumoux et al. 2023, eLife 12:e83623' } },
        confidence: 'high',
      },
      {
        id: 'ev.procedural',
        kind: 'assumption',
        statement: 'Mitochondria, ER, Golgi and peroxisomes are procedural shapes, not segmented',
        source: md('§3.3'),
      },
      { id: 'ev.ribosome-count', kind: 'literature', statement: '169,000 80S ribosomes', source: md('copy numbers') },
      {
        id: 'ev.ribosome-growth-law',
        kind: 'literature',
        statement: 'A growth-law estimate gives about 3 × 10⁵ ribosomes: the model count is probably low',
        source: md('copy numbers'),
        confidence: 'medium',
      },
      {
        id: 'ev.npc-count',
        kind: 'literature',
        statement: '117 nuclear pore complexes',
        source: { ...md('copy numbers'), citation: { text: 'Winey et al. 1997' } },
      },
      {
        id: 'ev.chromatin',
        kind: 'literature',
        statement: '16 chromosomes as nucleosome walks, 12.5 nm a step; 73,150 nucleosomes',
        source: md('§6'),
      },
      {
        id: 'ev.microtubules',
        kind: 'literature',
        statement: '21 microtubules, 11,661 αβ-tubulin dimers, lattice from 8QV3, 8.3 nm axial repeat',
        source: md('§6'),
      },
      {
        id: 'ev.proteome',
        kind: 'database',
        statement: 'PaxDb abundances (ppm) scaled to 4.2 × 10⁷ proteins a cell',
        source: { resource: 'r.paxdb', citation: { text: 'Ho et al. 2018' }, location: 'MODEL.md §4' },
      },
      {
        id: 'ev.localization',
        kind: 'database',
        statement: 'UniProt subcellular location, GFP-backed tokens first, GO cellular component as a fallback',
        source: md('§4'),
      },
      {
        id: 'ev.orientation',
        kind: 'prediction',
        statement: 'Membrane proteins oriented by fitting their TRANSMEM residues into a ±1.6 nm slab',
        source: md('§5.3'),
      },
    ],
    activities: [
      { id: 'act.fibsem', kind: 'acquisition', label: 'cryo-plasma FIB/SEM', generated: ['r.empiar'] },
      {
        id: 'act.segment',
        kind: 'segmentation',
        label: 'segmented, voxelized at 20 nm, smoothed, remeshed',
        used: ['r.empiar'],
        generated: ['r.seg08', 'r.seg05', 'al.cell08', 'al.cell05'],
      },
      {
        id: 'act.inventory',
        kind: 'curation',
        label: 'proteome inventory and structure choice',
        used: ['r.paxdb', 'r.uniprot', 'r.afdb'],
      },
      {
        id: 'act.pack',
        kind: 'modeling',
        label: 'tile-parallel random sequential addition with an interaction layer',
        used: ['r.seg08', 'r.seg05', 'r.geometry', 'r.paxdb', 'r.afdb', 'r.string'],
        generated: ['r.tiles', 'm.yeast'],
        software: { name: 'yeast_cell_viewer pipeline (Python, numba)' },
        parameters: { tile_nm: 200 },
      },
    ],
    views: [
      { id: 'v.cell', label: 'Whole cell', camera: { position: [0, 0, 9000], target: [0, 0, 0] } },
      {
        id: 'v.nucleus',
        label: 'Nucleus',
        looks: [
          { select: '(in c.cell)', visible: false },
          { select: '(in c.nucleus)', visible: true },
        ],
      },
    ],
    session: { view: 'v.cell' },
    custom: {
      meso: { source: 'https://github.com/zoidpuff/yeast_cell_viewer', license: 'not stated by the source repository' },
    },
  };
}
