/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Id, issue, type Issue } from '@molstar/meso-spec/format';
import { PlacementBuilder, type PlacementType, quatFromTo } from '@molstar/meso-spec/ir';
import { createRandom, type ResolveJob, type ResolveOutput, type Resolver, subSeed } from '@molstar/meso-spec/runtime';
import { shapeSampler } from './geometry.js';
import { type PackCompartment, packCompartments } from './packing.js';

// `meso.bilayer` (_spec/runtime.md): both leaflets of a curved membrane, each at the abundance's density (per leaflet), a
// quarter of the thickness from the middle, heads outward. Spheres get Fibonacci sites (even, O(N)); ellipsoids and
// meshes area-weighted random sites. No overlap test: lipids are drawn as the membrane, not packed against proteins
// (the proteins' footprint is not taken out; design.md §11).

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
  version: '0.1.1',
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
      compartments: packCompartments(
        job,
        job.populations.map((p) => p.compartment),
      ),
      seed: job.seed,
    };
  },
  resolve(input, job): ResolveOutput {
    const typeTable: PlacementType[] = input.items.map((it, index) => ({
      index,
      population: it.population,
      entity: it.entity,
      label: it.label,
      compartment: it.compartment,
      radius: it.radius,
    }));
    // each leaflet's count first (its own area, a quarter thickness off the middle), so the buffers are allocated once,
    // exactly (design.md §8: no growth, no trim)
    const plans = input.items.map((it) => {
      const c = input.compartments[it.compartment];
      const sampler =
        c.shape.kind === 'sphere' ? undefined : shapeSampler(c.shape, job.compartments.get(it.compartment)?.mesh);
      const leaflets = [1, -1].map((side) => {
        const d = (side * c.thickness) / 4;
        const area = c.shape.kind === 'sphere' ? 4 * Math.PI * (c.shape.radius + d) ** 2 : (sampler?.area ?? 0);
        return { side, d, count: Math.round(it.density * area) };
      });
      return { it, c, sampler, leaflets };
    });
    const b = new PlacementBuilder(plans.reduce((s, p) => s + p.leaflets[0].count + p.leaflets[1].count, 0));
    const achieved: Record<Id, number> = {};
    const shortfall: Record<Id, string> = {};
    const issues: Issue[] = [];
    const q = [0, 0, 0, 1];
    const p = [0, 0, 0],
      n = [0, 0, 0];
    plans.forEach(({ it, c, sampler, leaflets }, t) => {
      const start = b.count;
      for (const { side, d, count } of leaflets) {
        if (c.shape.kind === 'sphere') {
          const R = c.shape.radius + d;
          const golden = Math.PI * (3 - Math.sqrt(5));
          const [cx, cy, cz] = c.shape.center;
          for (let i = 0; i < count; i++) {
            const z = 1 - (2 * (i + 0.5)) / count;
            const r = Math.sqrt(1 - z * z);
            const nx = r * Math.cos(i * golden),
              ny = r * Math.sin(i * golden);
            quatFromTo(q, 0, 0, 1, side * nx, side * ny, side * z, i);
            b.push(t, cx + R * nx, cy + R * ny, cz + R * z, q);
          }
        } else if (sampler) {
          const rand = createRandom(subSeed(input.seed, `${it.population}:${side}`));
          for (let i = 0; i < count; i++) {
            sampler.sampleSurface(rand, p, n);
            quatFromTo(q, 0, 0, 1, side * n[0], side * n[1], side * n[2], rand.next() * 6.283);
            b.push(t, p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d, q);
          }
        }
      }
      achieved[it.population] = b.count - start;
      if (b.count - start > it.requested)
        issues.push(
          issue(
            'constraint.unmet',
            'info',
            'resolve',
            `${it.population}: ${b.count - start} lipids for ${it.requested} asked: each leaflet is filled at the density over its own area (${leaflets.map((l) => l.count).join(' and ')})`,
            { ids: [it.population] },
          ),
        );
      if (b.count === start) shortfall[it.population] = `${c?.label ?? it.compartment} has no surface area known`;
    });
    return {
      sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable })],
      achieved,
      shortfall,
      issues,
    };
  },
};
