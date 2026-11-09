/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';
import { createMesoDocument } from '../builder/index.js';
import type { ResourceRef } from '../builder/index.js';

// The whole yeast cell of zoidpuff's yeast_cell_viewer (design.md §13), described in MesoViewSpec. Conceptual: every
// fact is cited to the model's own description (MODEL.md, by section) and nothing of its data is copied (the repository
// states no license). It exercises what the exosome does not: a proteome too large to list (a catalog), a geometry
// stitched from two FIB/SEM cells and procedural shapes, frames whose handedness the source does not state, counts with
// conflicting evidence, a precomputed model in a tile format no resolver here reads, filaments that are helical
// lattices.

const MODEL_MD = 'https://github.com/zoidpuff/yeast_cell_viewer/blob/main/MODEL.md';
const DATA = 'https://zoidpuff.github.io/yeast_cell_viewer/data';

export function yeastDoc(): MesoViewSpecDoc {
  const b = createMesoDocument({
    title: 'Whole yeast cell (S. cerevisiae BY4741, YPD log phase), described',
    description:
      "A MesoViewSpec description of the yeast_cell_viewer model: its compartments, a few of its populations, its evidence and processing. Its placements stay in the model's own tile format.",
    organism: { name: 'Saccharomyces cerevisiae', taxon: 4932 },
    keywords: ['yeast', 'whole cell', 'FIB/SEM', 'proteome'],
    units: { length: 'nm' },
  });

  // the source states the units (nm) but not the origin, axes or handedness: left undeclared, reported (§3.4)
  const cell = b.frame({
    id: 'f.cell',
    kind: 'world',
    units: 'nm',
    convention: 'the model frame (origin and axes not stated by the source)',
  });
  const fibsem08 = b.frame({ id: 'f.fibsem08', kind: 'instrument', units: 'nm', convention: 'EMPIAR-11416 cell 08' });
  const fibsem05 = b.frame({ id: 'f.fibsem05', kind: 'instrument', units: 'nm', convention: 'EMPIAR-11416 cell 05' });

  // --- resources
  const modelMd = b.resource({
    id: 'r.model-md',
    kind: 'document',
    format: 'markdown',
    uri: MODEL_MD,
    label: 'Whole yeast cell: model description',
  });
  const empiar = b.resource({
    id: 'r.empiar',
    kind: 'dataset',
    format: 'empiar',
    accession: { db: 'EMPIAR', id: '11416' },
    label: 'cryo-plasma FIB/SEM of log-phase yeast',
    license: 'CC0',
  });
  const seg08 = b.resource({
    id: 'r.seg08',
    kind: 'segmentation',
    format: 'npz',
    uri: 'pipeline/cell_meshes.npz',
    frame: fibsem08,
    label: 'cell 08: outline, vacuoles, lipid droplets',
    select: { cell: '08' },
  });
  const seg05 = b.resource({
    id: 'r.seg05',
    kind: 'segmentation',
    format: 'npz',
    uri: 'pipeline/cell_meshes.npz',
    frame: fibsem05,
    label: 'cell 05: nucleus',
    select: { cell: '05' },
  });
  const geometry = b.resource({
    id: 'r.geometry',
    kind: 'volume',
    format: 'yct-geometry+json',
    uri: `${DATA}/geometry.json`,
    frame: cell,
    label: 'analytic SDF primitives of the procedural compartments',
  });
  const paxdb = b.resource({
    id: 'r.paxdb',
    kind: 'table',
    format: 'paxdb-tsv',
    label: 'PaxDb integrated S. cerevisiae abundances',
    accession: { db: 'PaxDb', id: '4932' },
  });
  const uniprot = b.resource({
    id: 'r.uniprot',
    kind: 'dataset',
    format: 'uniprot-proteome',
    accession: { db: 'UniProt', id: 'UP000002311' },
  });
  const afdb = b.resource({
    id: 'r.afdb',
    kind: 'dataset',
    format: 'alphafold-db',
    uri: 'https://alphafold.ebi.ac.uk',
    label: 'AlphaFold DB, S. cerevisiae',
    license: 'CC-BY-4.0',
  });
  const string = b.resource({
    id: 'r.string',
    kind: 'table',
    format: 'string-links',
    uri: 'https://string-db.org',
    label: 'STRING v12 interactions',
    license: 'CC-BY-4.0',
  });
  const tiles = b.resource({
    id: 'r.tiles',
    kind: 'placements',
    format: 'yct1-tiles',
    uri: `${DATA}/tiles/index.json`,
    frame: cell,
    label: '200 nm tiles of placed instances',
  });
  // a PDB entry by its id: `r.<id lowercased>`
  const pdb = (id: string): ResourceRef =>
    b.resource({
      id: `r.${id.toLowerCase()}`,
      kind: 'structure',
      format: 'pdb-id',
      accession: { db: 'PDB', id },
    });
  const pdb4v88 = pdb('4V88');
  const pdb7n9f = pdb('7N9F');
  const pdb1id3 = pdb('1ID3');
  const pdb7vh5 = pdb('7VH5');
  const pdb6o7v = pdb('6O7V');
  const pdb8qv3 = pdb('8QV3');

  // --- evidence: every claim cites the model description, by section
  const md = (location: string) => ({ resource: modelMd, location });
  const evVolumes = b.evidence({
    id: 'ev.volumes',
    kind: 'literature',
    statement: 'Compartment volumes on the final 4 nm grid: 41.93 µm³ in all, cytosol 26.62 µm³',
    source: md('§3.1–3.2'),
  });
  const evGeometry = b.evidence({
    id: 'ev.geometry',
    kind: 'observation',
    statement: 'Outline, vacuoles and lipid droplets segmented from EMPIAR-11416 cell 08; the nucleus from cell 05',
    source: { ...md('§3.3'), citation: { text: 'Dumoux et al. 2023, eLife 12:e83623' } },
    confidence: 'high',
  });
  const evProcedural = b.evidence({
    id: 'ev.procedural',
    kind: 'assumption',
    statement: 'Mitochondria, ER, Golgi and peroxisomes are procedural shapes, not segmented',
    source: md('§3.3'),
  });
  const evRibosomeCount = b.evidence({
    id: 'ev.ribosome-count',
    kind: 'literature',
    statement: '169,000 80S ribosomes',
    source: md('copy numbers'),
  });
  const evRibosomeGrowthLaw = b.evidence({
    id: 'ev.ribosome-growth-law',
    kind: 'literature',
    statement: 'A growth-law estimate gives about 3 × 10⁵ ribosomes: the model count is probably low',
    source: md('copy numbers'),
    confidence: 'medium',
  });
  const evNpcCount = b.evidence({
    id: 'ev.npc-count',
    kind: 'literature',
    statement: '117 nuclear pore complexes',
    source: { ...md('copy numbers'), citation: { text: 'Winey et al. 1997' } },
  });
  const evChromatin = b.evidence({
    id: 'ev.chromatin',
    kind: 'literature',
    statement: '16 chromosomes as nucleosome walks, 12.5 nm a step; 73,150 nucleosomes',
    source: md('§6'),
  });
  const evMicrotubules = b.evidence({
    id: 'ev.microtubules',
    kind: 'literature',
    statement: '21 microtubules, 11,661 αβ-tubulin dimers, lattice from 8QV3, 8.3 nm axial repeat',
    source: md('§6'),
  });
  const evProteome = b.evidence({
    id: 'ev.proteome',
    kind: 'database',
    statement: 'PaxDb abundances (ppm) scaled to 4.2 × 10⁷ proteins a cell',
    source: { resource: paxdb, citation: { text: 'Ho et al. 2018' }, location: 'MODEL.md §4' },
  });
  const evLocalization = b.evidence({
    id: 'ev.localization',
    kind: 'database',
    statement: 'UniProt subcellular location, GFP-backed tokens first, GO cellular component as a fallback',
    source: md('§4'),
  });
  const evOrientation = b.evidence({
    id: 'ev.orientation',
    kind: 'prediction',
    statement: 'Membrane proteins oriented by fitting their TRANSMEM residues into a ±1.6 nm slab',
    source: md('§5.3'),
  });

  // --- alignments: the segmentation activity (made below) generates them, a cycle, so it is fetched by id
  // 44.2 µm³ scaled to 42 µm³: a linear factor (42 / 44.2)^(1/3); the translation is not stated
  const alCell08 = b.alignment({
    id: 'al.cell08',
    from: fibsem08,
    to: cell,
    transform: { scale: 0.9831 },
    method: 'volume scaled from 44.2 to 42 µm³',
    evidence: [evGeometry],
    activity: b.get('activity', 'act.segment'),
  });
  const alCell05 = b.alignment({
    id: 'al.cell05',
    from: fibsem05,
    to: cell,
    transform: { scale: 1 },
    method: "cell 05's nucleus scaled to 8% of the cell volume (the factor is not stated)",
    evidence: [evGeometry],
    activity: b.get('activity', 'act.segment'),
  });

  // --- entities
  const ribosome = b.entity({
    id: 'e.ribosome',
    label: '80S ribosome',
    kind: 'complex',
    structure: { resource: pdb4v88 },
  });
  const npc = b.entity({
    id: 'e.npc',
    label: 'nuclear pore complex',
    kind: 'complex',
    structure: { resource: pdb7n9f },
  });
  const nucleosome = b.entity({
    id: 'e.nucleosome',
    label: 'nucleosome',
    kind: 'complex',
    structure: { resource: pdb1id3 },
  });
  const pma1 = b.entity({
    id: 'e.pma1',
    label: 'Pma1 (plasma membrane H+-ATPase)',
    kind: 'complex',
    identifiers: { gene: 'PMA1' },
    structure: { resource: pdb7vh5 },
    topology: { type: 'multi-pass' },
  });
  const vatpase = b.entity({
    id: 'e.vatpase',
    label: 'V-ATPase',
    kind: 'complex',
    structure: { resource: pdb6o7v },
    topology: { type: 'multi-pass' },
  });
  const tubulin = b.entity({
    id: 'e.tubulin',
    label: 'αβ-tubulin dimer',
    kind: 'protein',
    structure: { resource: pdb8qv3 },
  });

  // --- compartments (ids generated from the labels where they equal the literal's)
  const cellCompartment = b.compartment({
    label: 'cell',
    kind: 'cell',
    geometry: { kind: 'segmentation', resource: seg08, label: 'outline' },
    membrane: {},
    evidence: [evGeometry, evVolumes],
  });
  const nucleus = b.compartment({
    label: 'nucleus',
    kind: 'organelle',
    parent: cellCompartment,
    geometry: { kind: 'segmentation', resource: seg05, label: 'nucleus' },
    membrane: { thickness: 34 },
    evidence: [evGeometry],
  });
  b.compartment({
    label: 'nucleolus',
    kind: 'region',
    parent: nucleus,
    geometry: { kind: 'implicit', description: 'procedural (MODEL.md §3.3)' },
    evidence: [evVolumes],
  });
  const vacuole = b.compartment({
    id: 'c.vacuole',
    label: 'vacuole (13 parts)',
    kind: 'organelle',
    parent: cellCompartment,
    geometry: { kind: 'segmentation', resource: seg08, label: 'vacuoles' },
    membrane: {},
    evidence: [evGeometry],
  });
  b.compartment({
    id: 'c.mito',
    label: 'mitochondrial reticulum',
    kind: 'organelle',
    parent: cellCompartment,
    geometry: { kind: 'implicit', description: 'one procedural reticulum, tubule radius 150 nm (MODEL.md §3.3)' },
    membrane: {},
    evidence: [evProcedural],
  });
  b.compartment({
    id: 'c.er',
    label: 'cortical ER',
    kind: 'organelle',
    parent: cellCompartment,
    geometry: {
      kind: 'implicit',
      description: 'sheets 27 nm beneath the plasma membrane, 20 nm lumen (MODEL.md §3.3)',
    },
    membrane: {},
    evidence: [evProcedural],
  });
  b.compartment({
    id: 'c.wall',
    label: 'cell wall',
    kind: 'region',
    geometry: {
      kind: 'implicit',
      description: 'a 110 nm shell: β-1,3-glucan inside, mannan outside (MODEL.md §3.1, §7)',
    },
    evidence: [evVolumes],
  });

  // --- populations (an id is generated from the entity where it equals the literal's)
  const ribosomes = b.population({
    id: 'p.ribosomes',
    entity: ribosome,
    compartment: cellCompartment,
    location: 'interior',
    abundance: { count: 169000 },
    range: [169000, 300000],
    evidence: [evRibosomeCount, evRibosomeGrowthLaw],
  });
  const npcs = b.population({
    entity: npc,
    compartment: nucleus,
    location: 'membrane',
    abundance: { count: 117 },
    evidence: [evNpcCount],
  });
  const nucleosomes = b.population({
    id: 'p.nucleosomes',
    entity: nucleosome,
    compartment: nucleus,
    location: 'interior',
    abundance: { count: 73150 },
    arrangement: { kind: 'fiber', rise: 12.5, path: { resource: tiles } },
    evidence: [evChromatin],
  });
  const microtubules = b.population({
    id: 'p.microtubules',
    entity: tubulin,
    compartment: cellCompartment,
    location: 'interior',
    abundance: { count: 11661 },
    // 13 protofilaments: a helical lattice on a tube, which `fiber` (one copy per rise) cannot say (design.md §11)
    arrangement: { kind: 'fiber', rise: 8.3, path: { resource: tiles } },
    evidence: [evMicrotubules],
  });
  const pma1Pop = b.population({
    entity: pma1,
    compartment: cellCompartment,
    location: 'membrane',
    abundance: { count: 0 },
    evidence: [evOrientation, evProteome],
  });
  const vatpasePop = b.population({
    entity: vatpase,
    compartment: vacuole,
    location: 'membrane',
    abundance: { count: 0 },
    evidence: [evOrientation, evProteome],
  });

  b.catalog({
    id: 'cat.proteome',
    resource: paxdb,
    columns: { entity: 'uniprot', compartment: 'localization', abundance: 'ppm' },
    abundanceKind: 'ppm',
    evidence: [evProteome, evLocalization],
  });

  // the packing activity generates this model and the model names the activity, a cycle: fetched by id
  const packing = b.model({
    id: 'm.yeast',
    label: 'yeast_cell_viewer packing',
    kind: 'precomputed',
    method: 'yeast-cell-viewer.tiles',
    populations: [ribosomes, npcs, nucleosomes, microtubules, pma1Pop, vatpasePop],
    inputs: [tiles],
    activity: b.get('activity', 'act.pack'),
  });

  // --- activities
  b.activity({ id: 'act.fibsem', kind: 'acquisition', label: 'cryo-plasma FIB/SEM', generated: [empiar] });
  b.activity({
    id: 'act.segment',
    kind: 'segmentation',
    label: 'segmented, voxelized at 20 nm, smoothed, remeshed',
    used: [empiar],
    generated: [seg08, seg05, alCell08, alCell05],
  });
  b.activity({
    id: 'act.inventory',
    kind: 'curation',
    label: 'proteome inventory and structure choice',
    used: [paxdb, uniprot, afdb],
  });
  b.activity({
    id: 'act.pack',
    kind: 'modeling',
    label: 'tile-parallel random sequential addition with an interaction layer',
    used: [seg08, seg05, geometry, paxdb, afdb, string],
    generated: [tiles, packing],
    software: { name: 'yeast_cell_viewer pipeline (Python, numba)' },
    parameters: { tile_nm: 200 },
  });

  // --- views
  const wholeCell = b.view({
    id: 'v.cell',
    label: 'Whole cell',
    camera: { position: [0, 0, 9000], target: [0, 0, 0] },
  });
  b.view({
    id: 'v.nucleus',
    label: 'Nucleus',
    looks: [
      { select: '(in c.cell)', visible: false },
      { select: '(in c.nucleus)', visible: true },
    ],
  });
  b.session({ view: wholeCell });
  b.custom('meso', {
    source: 'https://github.com/zoidpuff/yeast_cell_viewer',
    license: 'not stated by the source repository',
  });

  return b.build().doc;
}
