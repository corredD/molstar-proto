/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Look, MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { createMesoDocument, q } from '@molstar/meso-spec/builder';
import { importCellpackGpuRecipe, parseCellpackGpuRecipe } from '@molstar/meso-spec/resolvers';
import isgJson from './fixtures/isg.cellpack-gpu.json' with { type: 'json' };

// A slice of a β-cell with insulin secretory granules (_spec/format.md, design.md §10): the granule is a superstructure, imported
// from Ludo's cellPACKgpu insulin granule recipe (root_serialized(68).json, trimmed to four ingredients), and the cell
// holds many copies of it. The granule is resolved once; its copies are poses. The counts at the cell level are
// illustrative (a slice, not a whole cell), labelled as an assumption.

export const BetaCellResources: Readonly<Record<string, () => unknown>> = { 'r.isg-recipe': () => isgJson };

export function betaCellDoc(granules = 120, detail: 'parts' | 'entity' = 'parts'): MesoViewSpecDoc {
  const isg = importCellpackGpuRecipe(parseCellpackGpuRecipe(isgJson), {
    resource: 'r.isg-recipe',
    modelId: 'm.isg',
    seed: 3,
  });
  const b = createMesoDocument({
    title: 'β-cell slice with insulin granules',
    description:
      'Insulin secretory granules (a superstructure from a cellPACKgpu recipe) instanced in a slice of a pancreatic β-cell.',
    organism: { name: 'Mus musculus', taxon: 10090 },
    units: { length: 'nm' },
  });
  b.frame({ id: 'f.cell', kind: 'world', units: 'nm', handedness: 'right' });
  const recipe = b.resource({
    id: 'r.isg-recipe',
    kind: 'recipe',
    format: 'cellpack-gpu-serialized',
    label: 'cellPACKgpu insulin granule recipe (trimmed)',
    uri: 'examples/fixtures/isg.cellpack-gpu.json',
  });

  b.add('evidence', isg.evidence);
  const evRecipe = b.evidence({
    id: 'ev.isg-recipe',
    kind: 'database',
    statement: "The granule's contents: cellPACKgpu insulin granule recipe (trimmed to Vamp2, Rab3a, Chga, Scg2)",
    source: { resource: recipe },
  });
  const evDocked = b.evidence({
    id: 'ev.docked',
    kind: 'assumption',
    statement: 'Illustrative: a granule docked under the plasma membrane, as in the readily releasable pool',
    confidence: 'low',
  });
  const evCount = b.evidence({
    id: 'ev.granule-count',
    kind: 'assumption',
    statement: 'Illustrative granule count for a slice; a whole β-cell holds on the order of 10,000 granules',
    confidence: 'low',
  });

  const ss = b.superstructure({
    id: 's.isg',
    label: 'insulin secretory granule',
    kind: 'vesicle',
    evidence: [evRecipe],
  });
  ss.add('compartments', isg.compartments);
  ss.add('populations', isg.populations);
  ss.add('models', isg.models);

  b.add('entities', isg.entities);
  const granule = b.entity({
    id: 'e.granule',
    label: 'insulin secretory granule',
    kind: 'assembly',
    superstructure: ss.ref,
    evidence: [evRecipe],
  });
  const ribosome = b.entity({ id: 'e.ribosome', label: 'ribosome', kind: 'complex', radius: 13 });

  const cell = b.compartment({
    id: 'c.cell',
    label: 'β-cell (slice)',
    kind: 'cell',
    geometry: { kind: 'sphere', radius: 1500 },
    membrane: { thickness: 4 },
  });
  const granulesPop = b.population({
    id: 'p.granules',
    entity: granule,
    compartment: cell,
    location: 'interior',
    abundance: { count: granules },
    detail,
    evidence: [evCount],
  });
  const ribosomes = b.population({
    id: 'p.ribosomes',
    entity: ribosome,
    compartment: cell,
    location: 'interior',
    abundance: { count: 2000 },
  });

  // two granules stated one by one (_spec/format.md): ids that survive repacking, poses someone measured
  const docked = b.instance({
    id: 'i.granule-docked',
    label: 'a docked granule',
    entity: granule,
    compartment: cell,
    pose: { translation: [0, -1300, 0] },
    evidence: [evDocked],
    detail,
  });
  const deep = b.instance({
    id: 'i.granule-deep',
    label: 'a granule deep in the cytoplasm',
    entity: granule,
    compartment: cell,
    pose: { translation: [450, 300, -250], rotation: [0, 0.3826834, 0, 0.9238795] },
    detail,
  });

  const vamp = ss.get('population', 'p.Vamp2');
  const looks: Look[] = [
    { select: q.population(ribosomes), color: '#7a9cc6', transparency: 0.5 },
    { select: q.population(vamp), color: '#d0453a' },
    { select: q.population(ss.get('population', 'p.Rab3a')), color: '#e0b04c' },
    { select: q.population(ss.get('population', 'p.Chga')), color: '#5aa55a' },
    { select: q.population(ss.get('population', 'p.Scg2')), color: '#9b59b6' },
    { select: q.population(granulesPop), color: '#c8b8e0' },
  ];
  const granule12 = q.part(q.copies(granulesPop, 12), vamp);

  b.view({
    id: 'v.granules',
    label: 'Granules',
    camera: { position: [0, 0, 4200], target: [0, 0, 0], up: [0, 1, 0] },
    looks,
  });
  const cellView = b.view({
    id: 'v.cell',
    label: 'The whole slice',
    camera: { focus: q.all(), framing: 'fit', from: [0, 0, 1], transition: 1200 },
    looks,
  });
  const g12View = b.view({
    id: 'v.granule-12',
    label: 'Granule 12, from outside the cell',
    description: 'Framed on granule 12 by its address; the ribosomes near it would be cut away',
    camera: { focus: granule12, framing: 'context', from: 'outside', transition: 1500 },
    cutaway: q.within(q.population(ribosomes), { of: q.copies(granulesPop, 12), distance: 250 }),
    looks,
    annotations: [{ id: 'an.g12', target: granule12, text: 'Granule 12: its VAMP2' }],
  });
  const dockedView = b.view({
    id: 'v.docked',
    label: 'The docked granule, by its id',
    description: 'Framed on an instance: the same granule whatever the packing does around it',
    camera: { focus: q.instance(docked), framing: 'context', from: 'outside', transition: 1500 },
    cutaway: q.within(q.population(ribosomes), { of: q.instance(docked), distance: 250 }),
    looks: [...looks, { select: q.instance(docked, deep), color: '#f08c3c' }],
    annotations: [{ id: 'an.docked', target: q.instance(docked), text: 'Docked granule' }],
  });

  b.tour({
    id: 't.granule',
    label: 'Into one granule',
    steps: [
      { view: cellView, duration: 3000, caption: 'A slice of a β-cell, 120 granules' },
      { view: g12View, duration: 4000, caption: 'One granule, its membrane proteins and cargo' },
      { view: dockedView, duration: 4000, caption: 'A granule named in the document: docked under the membrane' },
    ],
  });
  return b.build().doc;
}
