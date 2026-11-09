/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The builder's types (design.md §3.15): a ref stands only in a slot of its kind and scope. Compile-time checks, run by
// `npx tsc -p packages/mesoscale/spec/tsconfig.test.json` (tsconfig.json excludes _test): a `@ts-expect-error` that
// stops erroring is an error. The function is never called; the one test keeps vitest from reporting an empty file.

import { expect, it } from 'vitest';
import { createMesoDocument, q } from '../builder/index.js';

function types() {
  const b = createMesoDocument({ title: 't' });
  const e = b.entity({ label: 'catalase', kind: 'complex' });
  const hu = b.entity({
    label: 'HU',
    kind: 'protein',
    sites: [{ id: 'dna-entry' }, { id: 'dna-exit' }],
  });
  const c = b.compartment({ label: 'cell', kind: 'cell', geometry: { kind: 'sphere', radius: 10 } });
  const p = b.population({ entity: e, compartment: c, location: 'interior', abundance: { count: 1 } });
  const m = b.model({ kind: 'procedural', method: 'meso.pack', populations: [p] });
  const ss = b.superstructure({ label: 'granule' });
  const inner = ss.compartment({ label: 'envelope', kind: 'vesicle', geometry: { kind: 'sphere', radius: 5 } });
  const ip = ss.population({ entity: e, compartment: inner, location: 'interior', abundance: { count: 1 } });

  // a ref of the kind the slot takes
  b.population({ entity: e, compartment: c, location: 'interior', abundance: { count: 1 } });
  b.compartment({ label: 'organelle', kind: 'organelle', parent: c, geometry: { kind: 'sphere', radius: 1 } });
  b.model({ kind: 'procedural', method: 'x', populations: [p], avoid: [m] });
  ss.population({ entity: e, compartment: inner, location: 'interior', abundance: { count: 1 } });

  // @ts-expect-error a population is no compartment
  b.population({ entity: e, compartment: p, location: 'interior', abundance: { count: 1 } });
  // @ts-expect-error a compartment is no entity
  b.population({ entity: c, compartment: c, location: 'interior', abundance: { count: 1 } });
  // @ts-expect-error a plain string is no ref
  b.population({ entity: e, compartment: 'c.cell', location: 'interior', abundance: { count: 1 } });
  // @ts-expect-error a model is no population
  b.model({ kind: 'procedural', method: 'x', populations: [m] });
  // @ts-expect-error an inner compartment is not visible from the document
  b.population({ entity: e, compartment: inner, location: 'interior', abundance: { count: 1 } });
  // @ts-expect-error a document compartment is not visible inside a superstructure
  ss.population({ entity: e, compartment: c, location: 'interior', abundance: { count: 1 } });
  // @ts-expect-error evidence is a ref too
  b.entity({ label: 'x', kind: 'protein', evidence: ['ev.x'] });
  // @ts-expect-error a superstructure takes no instance
  ss.instance({});

  // @ts-expect-error a fiber's path resource is a resource ref, not a string
  b.population({
    entity: e,
    compartment: c,
    location: 'interior',
    abundance: { count: 1 },
    arrangement: { kind: 'fiber', rise: 1, path: { resource: 'r.x' } },
  });
  b.population({
    entity: e,
    compartment: c,
    location: 'interior',
    abundance: { count: 1 },
    arrangement: { kind: 'fiber', rise: 1, path: { resource: b.resource({ kind: 'mesh', format: 'obj' }) } },
  });

  // an inner membrane takes an inner lipid (and a document one); a document membrane takes no inner entity
  const lipid = ss.entity({ label: 'lipid', kind: 'lipid' });
  ss.compartment({
    label: 'bilayer',
    kind: 'vesicle',
    geometry: { kind: 'sphere', radius: 5 },
    membrane: { leaflets: { outer: lipid } },
  });
  ss.compartment({
    label: 'bilayer2',
    kind: 'vesicle',
    geometry: { kind: 'sphere', radius: 5 },
    membrane: { composition: { lipids: [{ entity: e, fraction: 1 }] } },
  });
  // @ts-expect-error an inner entity is not visible from a document membrane
  b.compartment({
    label: 'm',
    kind: 'cell',
    geometry: { kind: 'sphere', radius: 5 },
    membrane: { leaflets: { outer: lipid } },
  });

  // addresses take refs of the kind of the symbol
  q.population(p, ip);
  q.copies(p, 12);
  q.in(c);
  q.part(q.copies(p, 1), ip);
  q.site(hu, 'dna-entry');
  // @ts-expect-error a compartment is no population
  q.population(c);
  // @ts-expect-error a document population is not an inner one
  q.part(q.all(), p);
  // @ts-expect-error HU has no site of this name
  q.site(hu, 'nope');
  // @ts-expect-error catalase declares no sites
  q.site(e, 'dna-entry');
  // @ts-expect-error a selection is not a site address
  q.not(q.site(hu, 'dna-entry'));
}

it('type checks live in `tsc -p tsconfig.test.json`', () => {
  expect(types).toBeTypeOf('function');
});
