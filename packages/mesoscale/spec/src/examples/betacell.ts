/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';
import { importCellpackGpuRecipe, parseCellpackGpuRecipe } from '../resolvers/cellpack-gpu.js';
import isgJson from './fixtures/isg.cellpack-gpu.json' with { type: 'json' };

// A slice of a β-cell with insulin secretory granules (design.md §3.9, §10): the granule is a superstructure, imported
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
  return {
    format: 'meso_view_spec',
    version: '0.2.0',
    metadata: {
      title: 'β-cell slice with insulin granules',
      description:
        'Insulin secretory granules (a superstructure from a cellPACKgpu recipe) instanced in a slice of a pancreatic β-cell.',
      organism: { name: 'Mus musculus', taxon: 10090 },
    },
    units: { length: 'nm' },
    frames: [{ id: 'f.cell', kind: 'world', units: 'nm', handedness: 'right' }],
    resources: [
      {
        id: 'r.isg-recipe',
        kind: 'recipe',
        format: 'cellpack-gpu-serialized',
        label: 'cellPACKgpu insulin granule recipe (trimmed)',
        uri: 'examples/fixtures/isg.cellpack-gpu.json',
      },
    ],
    entities: [
      ...isg.entities,
      {
        id: 'e.granule',
        label: 'insulin secretory granule',
        kind: 'assembly',
        superstructure: 's.isg',
        evidence: ['ev.isg-recipe'],
      },
      { id: 'e.ribosome', label: 'ribosome', kind: 'complex', radius: 13 },
    ],
    superstructures: [
      {
        id: 's.isg',
        label: 'insulin secretory granule',
        kind: 'vesicle',
        compartments: isg.compartments,
        populations: isg.populations,
        models: isg.models,
        evidence: ['ev.isg-recipe'],
      },
    ],
    compartments: [
      {
        id: 'c.cell',
        label: 'β-cell (slice)',
        kind: 'cell',
        geometry: { kind: 'sphere', radius: 1500 },
        membrane: { thickness: 4 },
      },
    ],
    populations: [
      {
        id: 'p.granules',
        entity: 'e.granule',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: granules },
        detail,
        evidence: ['ev.granule-count'],
      },
      {
        id: 'p.ribosomes',
        entity: 'e.ribosome',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 2000 },
      },
    ],
    // two granules stated one by one (design.md §3.14): ids that survive repacking, poses someone measured
    instances: [
      {
        id: 'i.granule-docked',
        label: 'a docked granule',
        entity: 'e.granule',
        compartment: 'c.cell',
        pose: { translation: [0, -1300, 0] },
        evidence: ['ev.docked'],
        detail,
      },
      {
        id: 'i.granule-deep',
        label: 'a granule deep in the cytoplasm',
        entity: 'e.granule',
        compartment: 'c.cell',
        pose: { translation: [450, 300, -250], rotation: [0, 0.3826834, 0, 0.9238795] },
        detail,
      },
    ],
    evidence: [
      ...isg.evidence,
      {
        id: 'ev.isg-recipe',
        kind: 'database',
        statement: "The granule's contents: cellPACKgpu insulin granule recipe (trimmed to Vamp2, Rab3a, Chga, Scg2)",
        source: { resource: 'r.isg-recipe' },
      },
      {
        id: 'ev.docked',
        kind: 'assumption',
        statement: 'Illustrative: a granule docked under the plasma membrane, as in the readily releasable pool',
        confidence: 'low',
      },
      {
        id: 'ev.granule-count',
        kind: 'assumption',
        statement: 'Illustrative granule count for a slice; a whole β-cell holds on the order of 10,000 granules',
        confidence: 'low',
      },
    ],
    views: [
      {
        id: 'v.granules',
        label: 'Granules',
        camera: { position: [0, 0, 4200], target: [0, 0, 0], up: [0, 1, 0] },
        looks: [
          { select: '(population p.ribosomes)', color: '#7a9cc6', transparency: 0.5 },
          { select: '(population p.Vamp2)', color: '#d0453a' },
          { select: '(population p.Rab3a)', color: '#e0b04c' },
          { select: '(population p.Chga)', color: '#5aa55a' },
          { select: '(population p.Scg2)', color: '#9b59b6' },
          { select: '(population p.granules)', color: '#c8b8e0' },
        ],
      },
      {
        id: 'v.cell',
        label: 'The whole slice',
        camera: { focus: '(all)', framing: 'fit', from: [0, 0, 1], transition: 1200 },
        looks: [
          { select: '(population p.ribosomes)', color: '#7a9cc6', transparency: 0.5 },
          { select: '(population p.Vamp2)', color: '#d0453a' },
          { select: '(population p.Rab3a)', color: '#e0b04c' },
          { select: '(population p.Chga)', color: '#5aa55a' },
          { select: '(population p.Scg2)', color: '#9b59b6' },
          { select: '(population p.granules)', color: '#c8b8e0' },
        ],
      },
      {
        id: 'v.granule-12',
        label: 'Granule 12, from outside the cell',
        description: 'Framed on granule 12 by its address; the ribosomes near it would be cut away',
        camera: {
          focus: '(part (copies p.granules 12) p.Vamp2)',
          framing: 'context',
          from: 'outside',
          transition: 1500,
        },
        cutaway: '(within (population p.ribosomes) :of (copies p.granules 12) :distance 250)',
        looks: [
          { select: '(population p.ribosomes)', color: '#7a9cc6', transparency: 0.5 },
          { select: '(population p.Vamp2)', color: '#d0453a' },
          { select: '(population p.Rab3a)', color: '#e0b04c' },
          { select: '(population p.Chga)', color: '#5aa55a' },
          { select: '(population p.Scg2)', color: '#9b59b6' },
          { select: '(population p.granules)', color: '#c8b8e0' },
        ],
        annotations: [{ id: 'an.g12', target: '(part (copies p.granules 12) p.Vamp2)', text: 'Granule 12: its VAMP2' }],
      },
      {
        id: 'v.docked',
        label: 'The docked granule, by its id',
        description: 'Framed on an instance: the same granule whatever the packing does around it',
        camera: { focus: '(instance i.granule-docked)', framing: 'context', from: 'outside', transition: 1500 },
        cutaway: '(within (population p.ribosomes) :of (instance i.granule-docked) :distance 250)',
        looks: [
          { select: '(population p.ribosomes)', color: '#7a9cc6', transparency: 0.5 },
          { select: '(population p.Vamp2)', color: '#d0453a' },
          { select: '(population p.Rab3a)', color: '#e0b04c' },
          { select: '(population p.Chga)', color: '#5aa55a' },
          { select: '(population p.Scg2)', color: '#9b59b6' },
          { select: '(population p.granules)', color: '#c8b8e0' },
          { select: '(instance i.granule-docked i.granule-deep)', color: '#f08c3c' },
        ],
        annotations: [{ id: 'an.docked', target: '(instance i.granule-docked)', text: 'Docked granule' }],
      },
    ],
    tours: [
      {
        id: 't.granule',
        label: 'Into one granule',
        steps: [
          { view: 'v.cell', duration: 3000, caption: 'A slice of a β-cell, 120 granules' },
          { view: 'v.granule-12', duration: 4000, caption: 'One granule, its membrane proteins and cargo' },
          { view: 'v.docked', duration: 4000, caption: 'A granule named in the document: docked under the membrane' },
        ],
      },
    ],
  };
}
