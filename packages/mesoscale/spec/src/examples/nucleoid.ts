/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { createMesoDocument, q } from '../builder/index.js';
import type { MesoViewSpecDoc } from '../format/doc.js';

// Relations as constraints with addresses (design.md §3.11): a stretch of bacterial nucleoid where HU bends DNA. HU's
// DNA entry and exit sites are the "pointers" the relation attaches by; the fiber resolver places each HU copy with its
// entry on the strand and resumes the strand at its exit, turned by the bend. IHF's sites are given only by residues
// (a schematized address): with no structure loaded they cannot be materialized, and the runtime says so. Every
// coordinate and angle here is illustrative, labelled as an assumption.

export function nucleoidDoc(bend = 120): MesoViewSpecDoc {
  const b = createMesoDocument({
    title: 'Nucleoid stretch: HU bends DNA',
    description:
      'Illustrative: a DNA strand grown in a nucleoid region, HU placed on it by its DNA entry and exit sites.',
    units: { length: 'nm' },
  });
  b.frame({ id: 'f.world', kind: 'world', units: 'nm', handedness: 'right' });

  const huBend = b.evidence({
    id: 'ev.hu-bend',
    kind: 'assumption',
    statement: 'HU bends DNA sharply where it binds; the angle and spacing here are illustrative',
    confidence: 'low',
  });
  const huSites = b.evidence({
    id: 'ev.hu-sites',
    kind: 'assumption',
    statement:
      'Illustrative entry and exit points 3 nm apart; a structure of an HU–DNA complex would give them by residues',
    confidence: 'low',
  });
  const ihfSites = b.evidence({
    id: 'ev.ihf-sites',
    kind: 'assumption',
    statement: 'Illustrative residue range; needs the structure to be materialized',
    confidence: 'low',
  });

  const dna = b.entity({ id: 'e.dna', label: 'DNA (10 bp segment)', kind: 'nucleic-acid', radius: 1 });
  const hu = b.entity({
    id: 'e.hu',
    label: 'HU (dimer)',
    kind: 'protein',
    radius: 2.5,
    sites: [
      { id: 'dna-entry', label: 'DNA enters', position: [0, 0, -15], evidence: [huSites] },
      { id: 'dna-exit', label: 'DNA leaves', position: [0, 0, 15], evidence: [huSites] },
    ],
  });
  // a true cycle: IHF's site address names IHF itself, so its ref is taken by id before the entity exists
  const ihf = b.entity({
    id: 'e.ihf',
    label: 'IHF',
    kind: 'protein',
    radius: 3,
    sites: [
      {
        id: 'dna-entry',
        at: q.residues(b.get('entity', 'e.ihf'), { chain: 'A', range: '60-70' }),
        evidence: [ihfSites],
      },
    ],
  });

  const nucleoid = b.compartment({
    id: 'c.nucleoid',
    label: 'nucleoid region',
    kind: 'region',
    geometry: { kind: 'sphere', radius: 250 },
  });

  const pDna = b.population({
    entity: dna,
    compartment: nucleoid,
    location: 'interior',
    abundance: { count: 440 },
    arrangement: { kind: 'fiber', rise: 3.4, twist: 36, growth: { persistence: 50, length: 1500, count: 1 } },
  });
  const pHu = b.population({ entity: hu, compartment: nucleoid, location: 'interior', abundance: { count: 40 } });
  const pIhf = b.population({ entity: ihf, compartment: nucleoid, location: 'interior', abundance: { count: 5 } });

  b.relation({
    id: 'rel.hu-bends-dna',
    kind: 'bends',
    subjects: [pHu],
    objects: [pDna],
    entry: q.site(hu, 'dna-entry'),
    exit: q.site(hu, 'dna-exit'),
    angle: bend,
    spacing: 30,
    evidence: [huBend],
  });
  b.relation({
    id: 'rel.ihf-bends-dna',
    kind: 'bends',
    subjects: [pIhf],
    objects: [pDna],
    entry: q.site(ihf, 'dna-entry'),
    angle: 160,
    spacing: 100,
  });

  b.view({
    id: 'v.strand',
    camera: { position: [0, 0, 800], target: [0, 0, 0], up: [0, 1, 0] },
    looks: [
      { select: q.population(pDna), color: '#7a9cc6' },
      { select: q.population(pHu), color: '#d0453a' },
    ],
  });

  return b.build().doc;
}
