/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';

// The gallery (design.md §10): the cases the exosome slice leaves out, each small, in one made-up cell: nested
// compartments (ribosomes kept out of the nucleus, the vesicle and the mitochondrion), a membrane lattice that fits
// (nuclear pores, a patch) and one that does not (ATP synthase on a too-small mitochondrion), filaments grown and
// traced, a curved bilayer. No model is declared: the runtime dispatches each population to the default resolver of
// its arrangement. The numbers are illustrative, not measurements.

export function galleryDoc(): MesoViewSpecDoc {
  return {
    format: 'meso_view_spec',
    version: '0.1.0',
    metadata: {
      title: 'Gallery: nesting, lattices, fibers, bilayers',
      description: 'An illustrative cell for the IR and resolver cases; the numbers are not measurements.',
    },
    units: { length: 'nm' },
    frames: [{ id: 'f.world', kind: 'world', units: 'nm', handedness: 'right' }],
    entities: [
      { id: 'e.ribosome', label: 'ribosome', kind: 'complex', radius: 13 },
      { id: 'e.proteasome', label: 'proteasome', kind: 'complex', radius: 8 },
      { id: 'e.pore', label: 'nuclear pore (coarse)', kind: 'complex', radius: 6 },
      {
        id: 'e.atpsynthase',
        label: 'ATP synthase',
        kind: 'complex',
        radius: 6,
        topology: { type: 'multi-pass', nTerminus: 'inside' },
      },
      { id: 'e.actin', label: 'actin subunit', kind: 'protein', radius: 2.7 },
      { id: 'e.tubulin', label: 'tubulin dimer', kind: 'protein', radius: 4 },
      { id: 'e.lipid', label: 'phospholipid', kind: 'lipid', radius: { value: 4.5, unit: 'A' } },
      { id: 'e.arp23', label: 'Arp2/3 complex', kind: 'complex', radius: 6 },
    ],
    compartments: [
      {
        id: 'c.cell',
        label: 'cell',
        kind: 'cell',
        geometry: { kind: 'sphere', radius: 150 },
        membrane: { thickness: 4 },
      },
      {
        id: 'c.nucleus',
        label: 'nucleus',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: { kind: 'sphere', radius: 55, center: [40, 0, 0] },
        membrane: { thickness: 4 },
      },
      {
        id: 'c.vesicle',
        label: 'vesicle',
        kind: 'vesicle',
        parent: 'c.cell',
        geometry: { kind: 'sphere', radius: 25, center: [-80, 50, 0] },
        membrane: { thickness: 4 },
      },
      {
        id: 'c.mito',
        label: 'mitochondrion',
        kind: 'organelle',
        parent: 'c.cell',
        geometry: { kind: 'ellipsoid', radii: [45, 20, 20], center: [-50, -70, 0] },
        membrane: { thickness: 4 },
      },
    ],
    populations: [
      {
        id: 'p.ribosomes',
        entity: 'e.ribosome',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 300 },
      },
      {
        id: 'p.proteasomes',
        entity: 'e.proteasome',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { concentration: { value: 0.5, unit: 'uM' } },
      },
      {
        id: 'p.pores',
        entity: 'e.pore',
        compartment: 'c.nucleus',
        location: 'membrane',
        abundance: { count: 60 },
        arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: 22 },
      },
      {
        id: 'p.atpsynthase',
        entity: 'e.atpsynthase',
        compartment: 'c.mito',
        location: 'membrane',
        abundance: { count: 400 },
        arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: 12 },
        constraints: [{ kind: 'placed-fraction', min: 0.5 }],
      },
      {
        id: 'p.actin',
        entity: 'e.actin',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 480 },
        arrangement: { kind: 'fiber', rise: 2.75, twist: -166.6, growth: { persistence: 1000, length: 220, count: 6 } },
      },
      {
        id: 'p.microtubule',
        entity: 'e.tubulin',
        compartment: 'c.cell',
        location: 'interior',
        abundance: { count: 30 },
        arrangement: {
          kind: 'fiber',
          rise: 8,
          path: {
            points: [
              [-130, 0, 40],
              [-60, 20, 60],
              [0, 0, 80],
              [70, -30, 60],
              [120, -20, 30],
            ],
          },
        },
      },
      {
        id: 'p.vesicle-lipids',
        entity: 'e.lipid',
        compartment: 'c.vesicle',
        location: 'membrane',
        abundance: { density: { value: 1.5, unit: 'per_nm2' } },
        arrangement: { kind: 'bilayer' },
      },
      { id: 'p.arp23', entity: 'e.arp23', compartment: 'c.cell', location: 'interior', abundance: { count: 6 } },
    ],
    relations: [
      {
        id: 'rel.arp23-branches-actin',
        kind: 'branches',
        subjects: ['p.arp23'],
        objects: ['p.actin'],
        angle: 73,
        note: 'a daughter filament from the side of a mother filament; no resolver here grows branches yet',
        evidence: ['ev.arp23-angle'],
      },
    ],
    evidence: [
      {
        id: 'ev.arp23-angle',
        kind: 'literature',
        statement: 'Arp2/3 branches start at 73° to the mother filament (as the yeast whole-cell model builds them)',
        source: { citation: { text: 'zoidpuff/yeast_cell_viewer MODEL.md, actin patches' } },
      },
    ],
    views: [
      {
        id: 'v.all',
        camera: { position: [0, 0, 450], target: [0, 0, 0], up: [0, 1, 0] },
        looks: [
          { select: '(entity e.ribosome)', color: '#7a9cc6' },
          { select: '(entity e.pore)', color: '#e0b04c' },
          { select: '(entity e.atpsynthase)', color: '#c0504d' },
          { select: '(entity e.actin)', color: '#5aa55a' },
          { select: '(entity e.tubulin)', color: '#9b59b6' },
          { select: '(entity e.lipid)', color: '#e8d8b0' },
        ],
      },
    ],
  };
}
