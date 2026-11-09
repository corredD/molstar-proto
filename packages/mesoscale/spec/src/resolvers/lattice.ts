/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import { PlacementBuilder, type PlacementType, quatFromTo } from '../ir/placements.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type { NormalizedArrangement, Resolver, ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { type PackCompartment, packCompartments, SpatialHash } from './packing.js';

// `meso.lattice` (design.md §4.4): a 2D lattice on a closed membrane. Sites follow a Fibonacci spiral, locally close to
// hexagonal, at the density the spacing gives; a population asking fewer copies than there are sites fills a contiguous
// patch around a seeded direction (S-layer patches, ATP synthase rows), one asking more is short and says how many
// sites the membrane holds. Spheres and ellipsoids only: a mesh lattice needs a surface parametrization (design.md §9).
// Each population's patch is around its own pole (seeded by the model and the population), and skips the sites the
// populations before it and the copies of the models it avoids took.

interface LatticeInput {
  readonly items: readonly {
    readonly population: Id;
    readonly entity: Id;
    readonly label: string;
    readonly radius: number;
    readonly requested: number;
    readonly compartment: Id;
    readonly location: string;
    readonly spacing: number;
    readonly lattice: string;
    readonly vacancy: number;
  }[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly seed: number;
  /** The model's id: two lattice models with the same seed put their patches apart. */
  readonly model: Id;
}

export const MesoLatticeResolver: Resolver<LatticeInput> = {
  id: 'meso.lattice',
  version: '0.2.1',
  description:
    'Lattices on spherical and ellipsoidal membranes: Fibonacci sites at the lattice density, patches by count',
  arrangements: ['lattice'],
  locations: ['membrane', 'outer-surface', 'inner-surface'],
  project(job: ResolveJob): LatticeInput {
    return {
      items: job.populations.map((p) => {
        const a = p.arrangement as Extract<NormalizedArrangement, { kind: 'lattice' }>;
        return {
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? a.spacing / 2,
          requested: p.requested ?? 0,
          compartment: p.compartment,
          location: p.location,
          spacing: a.spacing,
          lattice: a.lattice,
          vacancy: a.vacancy,
        };
      }),
      compartments: packCompartments(
        job,
        job.populations.map((p) => p.compartment),
      ),
      seed: job.seed,
      model: job.model.id,
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
    const b = new PlacementBuilder(input.items.reduce((s, i) => s + i.requested, 0));
    const achieved: Record<Id, number> = {};
    const shortfall: Record<Id, string> = {};
    const q = [0, 0, 0, 1];
    // the sites taken: the copies of the models it avoids, and the populations' placed before this one (its own
    // copies go in after it: Fibonacci neighbours sit a little under the spacing apart, by design)
    let maxR = 1;
    for (const it of input.items) maxR = Math.max(maxR, it.radius);
    const taken = new SpatialHash(2 * maxR);
    for (const o of job.obstacles)
      for (let i = 0; i < o.count; i++)
        taken.insert(
          o.positions[3 * i],
          o.positions[3 * i + 1],
          o.positions[3 * i + 2],
          o.typeTable[o.types[i]].radius,
        );
    input.items.forEach((it, t) => {
      const c = input.compartments[it.compartment];
      const shape = c?.shape;
      if (!shape || (shape.kind !== 'sphere' && shape.kind !== 'ellipsoid')) {
        achieved[it.population] = 0;
        shortfall[it.population] =
          `a lattice needs a sphere or an ellipsoid; ${it.compartment} is ${shape?.kind ?? 'unknown'}`;
        return;
      }
      const center = shape.center;
      const radii = shape.kind === 'sphere' ? [shape.radius, shape.radius, shape.radius] : shape.radii;
      const d =
        it.location === 'membrane' ? 0 : (it.location === 'outer-surface' ? 1 : -1) * (c.thickness / 2 + it.radius);
      const R = radii.map((r) => r + d);
      const mean = Math.cbrt(R[0] * R[1] * R[2]);
      const cellArea = it.lattice === 'hexagonal' ? (Math.sqrt(3) / 2) * it.spacing ** 2 : it.spacing ** 2;
      const sites = Math.floor((4 * Math.PI * mean * mean) / cellArea);
      // with vacancies, a patch of `requested` copies spreads over more sites (seeded, the same holes every time)
      const holes = createRandom(subSeed(input.seed, `${it.population}:vacancy`));
      let n = 0;
      let skipped = 0;
      // the patch: the n sites nearest a seeded pole, so the spiral index runs from that pole; the pole is the
      // population's own (in this model), so two patches do not start at the same place
      const golden = Math.PI * (3 - Math.sqrt(5));
      const poleDir = createRandom(subSeed(input.seed, `${input.model}:${it.population}:pole`)).onSphere([0, 0, 0]);
      // rotation taking +z to the pole direction
      const rot = quatFromTo([0, 0, 0, 1], 0, 0, 1, poleDir[0], poleDir[1], poleDir[2]);
      const mine: number[] = [];
      const v = [0, 0, 0];
      for (let i = 0; i < sites && n < it.requested; i++) {
        if (it.vacancy > 0 && holes.next() < it.vacancy) continue;
        const z = 1 - (2 * (i + 0.5)) / sites;
        const r = Math.sqrt(1 - z * z);
        const phi = i * golden;
        rotate(v, rot, r * Math.cos(phi), r * Math.sin(phi), z);
        const x = center[0] + R[0] * v[0],
          y = center[1] + R[1] * v[1],
          zz = center[2] + R[2] * v[2];
        if (taken.overlaps(x, y, zz, it.radius)) {
          skipped++;
          continue;
        }
        n++;
        mine.push(x, y, zz);
        // the ellipsoid normal
        const nx = v[0] / R[0],
          ny = v[1] / R[1],
          nz = v[2] / R[2];
        const nl = Math.hypot(nx, ny, nz);
        // in-plane orientation follows the spiral's direction so neighbours share a heading
        quatFromTo(q, 0, 0, 1, nx / nl, ny / nl, nz / nl, phi);
        b.push(t, x, y, zz, q);
      }
      for (let i = 0; i < mine.length; i += 3) taken.insert(mine[i], mine[i + 1], mine[i + 2], it.radius);
      achieved[it.population] = n;
      if (n < it.requested)
        shortfall[it.population] =
          `the ${it.location} of ${c.label} holds ${sites} ${it.lattice} sites ${it.spacing.toFixed(0)} Å apart${it.vacancy ? `, ${Math.round(it.vacancy * 100)}% vacant` : ''}${skipped ? `, ${skipped} taken` : ''}; ${it.requested} asked`;
    });
    return { sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable })], achieved, shortfall };
  },
};

function rotate(out: number[], q: number[], x: number, y: number, z: number) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
}
