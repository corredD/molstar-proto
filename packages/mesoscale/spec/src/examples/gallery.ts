/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createMesoDocument, q } from '../builder/index.js';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';

// The gallery (design.md §10): the cases the exosome slice leaves out, each small, in one made-up cell: nested
// compartments (ribosomes kept out of the nucleus, the vesicle and the mitochondrion), a membrane lattice that fits
// (nuclear pores, a patch) and one that does not (ATP synthase on a too-small mitochondrion), filaments grown and
// traced, a curved bilayer. No model is declared: the runtime dispatches each population to the default resolver of
// its arrangement. The numbers are illustrative, not measurements.

export function galleryDoc(): MesoViewSpecDoc {
  const b = createMesoDocument({
    title: 'Gallery: nesting, lattices, fibers, bilayers',
    description: 'An illustrative cell for the IR and resolver cases; the numbers are not measurements.',
    units: { length: 'nm' },
  });
  b.frame({ kind: 'world', units: 'nm', handedness: 'right' });

  // Ids the labels would not make (`e.pore` for "nuclear pore (coarse)") are given; the rest are generated.
  const ribosome = b.entity({ label: 'ribosome', kind: 'complex', radius: 13 });
  const proteasome = b.entity({ id: 'e.proteasome', label: 'proteasome', kind: 'complex', radius: 8 });
  const pore = b.entity({ id: 'e.pore', label: 'nuclear pore (coarse)', kind: 'complex', radius: 6 });
  const atpSynthase = b.entity({
    id: 'e.atpsynthase',
    label: 'ATP synthase',
    kind: 'complex',
    radius: 6,
    topology: { type: 'multi-pass', nTerminus: 'inside' },
  });
  const actin = b.entity({ id: 'e.actin', label: 'actin subunit', kind: 'protein', radius: 2.7 });
  const tubulin = b.entity({ id: 'e.tubulin', label: 'tubulin dimer', kind: 'protein', radius: 4 });
  const lipid = b.entity({ id: 'e.lipid', label: 'phospholipid', kind: 'lipid', radius: { value: 4.5, unit: 'A' } });
  const arp23 = b.entity({ id: 'e.arp23', label: 'Arp2/3 complex', kind: 'complex', radius: 6 });

  const cell = b.compartment({
    label: 'cell',
    kind: 'cell',
    geometry: { kind: 'sphere', radius: 150 },
    membrane: { thickness: 4 },
  });
  const nucleus = b.compartment({
    label: 'nucleus',
    kind: 'organelle',
    parent: cell,
    geometry: { kind: 'sphere', radius: 55, center: [40, 0, 0] },
    membrane: { thickness: 4 },
  });
  const vesicle = b.compartment({
    label: 'vesicle',
    kind: 'vesicle',
    parent: cell,
    geometry: { kind: 'sphere', radius: 25, center: [-80, 50, 0] },
    membrane: { thickness: 4 },
  });
  const mito = b.compartment({
    id: 'c.mito',
    label: 'mitochondrion',
    kind: 'organelle',
    parent: cell,
    geometry: { kind: 'ellipsoid', radii: [45, 20, 20], center: [-50, -70, 0] },
    membrane: { thickness: 4 },
  });

  b.population({
    id: 'p.ribosomes',
    entity: ribosome,
    compartment: cell,
    location: 'interior',
    abundance: { count: 300 },
  });
  b.population({
    id: 'p.proteasomes',
    entity: proteasome,
    compartment: cell,
    location: 'interior',
    abundance: { concentration: { value: 0.5, unit: 'uM' } },
  });
  b.population({
    id: 'p.pores',
    entity: pore,
    compartment: nucleus,
    location: 'membrane',
    abundance: { count: 60 },
    arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: 22 },
  });
  b.population({
    id: 'p.atpsynthase',
    entity: atpSynthase,
    compartment: mito,
    location: 'membrane',
    abundance: { count: 400 },
    arrangement: { kind: 'lattice', lattice: 'hexagonal', spacing: 12 },
    constraints: [{ kind: 'placed-fraction', min: 0.5 }],
  });
  const actinFilaments = b.population({
    id: 'p.actin',
    entity: actin,
    compartment: cell,
    location: 'interior',
    abundance: { count: 480 },
    arrangement: { kind: 'fiber', rise: 2.75, twist: -166.6, growth: { persistence: 1000, length: 220, count: 6 } },
  });
  b.population({
    id: 'p.microtubule',
    entity: tubulin,
    compartment: cell,
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
  });
  b.population({
    id: 'p.vesicle-lipids',
    entity: lipid,
    compartment: vesicle,
    location: 'membrane',
    abundance: { density: { value: 1.5, unit: 'per_nm2' } },
    arrangement: { kind: 'bilayer' },
  });
  const arp23Complexes = b.population({
    entity: arp23,
    compartment: cell,
    location: 'interior',
    abundance: { count: 6 },
  });

  // The evidence is made first so that the relation can cite it; the sections keep document order whatever the calls.
  const angle = b.evidence({
    id: 'ev.arp23-angle',
    kind: 'literature',
    statement: 'Arp2/3 branches start at 73° to the mother filament (as the yeast whole-cell model builds them)',
    source: { citation: { text: 'zoidpuff/yeast_cell_viewer MODEL.md, actin patches' } },
  });
  b.relation({
    kind: 'branches',
    subjects: [arp23Complexes],
    objects: [actinFilaments],
    angle: 73,
    note: 'a daughter filament from the side of a mother filament; no resolver here grows branches yet',
    evidence: [angle],
  });

  const looks = [
    { select: q.entity(ribosome), color: '#7a9cc6' },
    { select: q.entity(pore), color: '#e0b04c' },
    { select: q.entity(atpSynthase), color: '#c0504d' },
    { select: q.entity(actin), color: '#5aa55a' },
    { select: q.entity(tubulin), color: '#9b59b6' },
    { select: q.entity(lipid), color: '#e8d8b0' },
  ];
  b.view({ id: 'v.all', camera: { position: [0, 0, 450], target: [0, 0, 0], up: [0, 1, 0] }, looks });

  return b.build().doc;
}

/** The gallery cut down to some populations (the resolver mocks), with only the relations among them: still valid. */
export function gallerySubset(ids: readonly string[]): MesoViewSpecDoc {
  const d = galleryDoc();
  const relations = (d.relations ?? []).filter((r) =>
    [...r.subjects, ...(r.objects ?? [])].every((x) => ids.includes(x)),
  );
  return { ...d, populations: d.populations.filter((p) => ids.includes(p.id)), relations };
}
