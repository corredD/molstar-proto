/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Resolver, ResolveJob } from '../runtime/resolver.js';
import { DefaultPackParams, pack, type PackInput, packCompartments } from './packing.js';

// `meso.pack`: the document's own resolver for randomly arranged populations (design.md §6.3). Every number comes from
// the document: the radius from the entity, the count from the abundance, the membrane side from the topology. Its
// construction parameters (`attempts`, `giveUp`) are the model's `params`.

export const MesoPackResolver: Resolver<PackInput> = {
  id: 'meso.pack',
  version: '0.1.0',
  description: 'Seeded random sequential addition of spheres: interiors, membranes, surfaces, the space around',
  arrangements: ['random'],
  locations: ['interior', 'membrane', 'outer-surface', 'inner-surface', 'exterior'],
  project(job: ResolveJob): PackInput {
    const params = job.model.params ?? {};
    return {
      items: job.populations.map((p) => ({
        population: p.id,
        entity: p.entity.id,
        label: p.entity.label,
        radius: p.radius ?? 10,
        requested: p.requested ?? 0,
        location: p.location,
        compartment: p.compartment,
        inward: p.entity.topology?.nTerminus === 'inside',
      })),
      compartments: packCompartments(
        job,
        job.populations.map((p) => p.compartment),
      ),
      seed: job.seed,
      attempts: Number(params.attempts ?? DefaultPackParams.attempts),
      giveUp: Number(params.giveUp ?? DefaultPackParams.giveUp),
    };
  },
  resolve(input, job) {
    return pack(input, job, job.model.id, '');
  },
};
