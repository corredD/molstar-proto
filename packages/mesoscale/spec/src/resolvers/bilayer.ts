/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import { PlacementBuilder, type PlacementType, quatFromTo } from '../ir/placements.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type { Resolver, ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { shapeSampler } from './geometry.js';
import { type PackCompartment, packCompartments } from './packing.js';

// `meso.bilayer` (design.md §4.4): both leaflets of a curved membrane, each at the abundance's density (per leaflet), a
// quarter of the thickness from the middle, heads outward. Spheres get Fibonacci sites (even, O(N)); ellipsoids and
// meshes area-weighted random sites. No overlap test: lipids are drawn as the membrane, not packed against proteins
// (the proteins' footprint is not taken out; design.md §9).

interface BilayerInput {
  readonly items: readonly {
    readonly population: Id;
    readonly entity: Id;
    readonly label: string;
    readonly radius: number;
    /** per Å², per leaflet */
    readonly density: number;
    readonly requested: number;
    readonly compartment: Id;
  }[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly seed: number;
}

export const MesoBilayerResolver: Resolver<BilayerInput> = {
  id: 'meso.bilayer',
  version: '0.1.0',
  description: 'Lipid bilayers on curved membranes: both leaflets at a density, heads outward',
  arrangements: ['bilayer'],
  locations: ['membrane'],
  project(job: ResolveJob): BilayerInput {
    return {
      items: job.populations.map((p) => {
        const area = job.compartments.get(p.compartment)?.area ?? 0;
        // the runtime asks for both leaflets (2 × density × area)
        const perLeaflet = (p.requested ?? 0) / 2;
        return {
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? 4.5,
          density: area ? perLeaflet / area : 0,
          requested: 2 * perLeaflet,
          compartment: p.compartment,
        };
      }),
      compartments: packCompartments(job, job.populations.map((p) => p.compartment)),
      seed: job.seed,
    };
  },
  resolve(input, job): ResolveOutput {
    const typeTable: PlacementType[] = input.items.map((it, index) => ({ index, population: it.population, entity: it.entity, label: it.label, compartment: it.compartment, radius: it.radius }));
    const b = new PlacementBuilder(input.items.reduce((s, i) => s + i.requested + 16, 0));
    const achieved: Record<Id, number> = {};
    const shortfall: Record<Id, string> = {};
    const q = [0, 0, 0, 1];
    const p = [0, 0, 0], n = [0, 0, 0];
    input.items.forEach((it, t) => {
      const c = input.compartments[it.compartment];
      const start = b.count;
      for (const side of [1, -1]) {
        const d = (side * c.thickness) / 4;
        if (c.shape.kind === 'sphere') {
          const R = c.shape.radius + d;
          const count = Math.round(it.density * 4 * Math.PI * R * R);
          const golden = Math.PI * (3 - Math.sqrt(5));
          const [cx, cy, cz] = c.shape.center;
          for (let i = 0; i < count; i++) {
            const z = 1 - (2 * (i + 0.5)) / count;
            const r = Math.sqrt(1 - z * z);
            const nx = r * Math.cos(i * golden), ny = r * Math.sin(i * golden);
            quatFromTo(q, 0, 0, 1, side * nx, side * ny, side * z, i);
            b.push(t, cx + R * nx, cy + R * ny, cz + R * z, q);
          }
        } else {
          const s = shapeSampler(c.shape, job.compartments.get(it.compartment)?.mesh);
          if (!s?.area) continue;
          const rand = createRandom(subSeed(input.seed, `${it.population}:${side}`));
          const count = Math.round(it.density * s.area);
          for (let i = 0; i < count; i++) {
            s.sampleSurface(rand, p, n);
            quatFromTo(q, 0, 0, 1, side * n[0], side * n[1], side * n[2], rand.next() * 6.283);
            b.push(t, p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d, q);
          }
        }
      }
      achieved[it.population] = b.count - start;
      if (b.count === start) shortfall[it.population] = `${c?.label ?? it.compartment} has no surface area known`;
    });
    return { sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable })], achieved, shortfall };
  },
};
