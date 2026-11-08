/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import { PlacementBuilder, type PlacementType, quatFromTo } from '../ir/placements.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type { NormalizedArrangement, Resolver, ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { shapeSampler } from './geometry.js';
import { type PackCompartment, packCompartments } from './packing.js';

// `meso.fiber` (design.md §4.4): filaments as copies `rise` apart along a path, each turned by `twist` about the path's
// tangent. A path is given (traced from a tomogram, or inline) or grown: a persistent random walk inside the
// compartment, its bend per step drawn so the tangent correlation decays over the persistence length, turned back
// toward the middle when a step would leave. The copies of each filament are one CSR row of the set's `fibers`.

interface FiberInput {
  readonly items: readonly {
    readonly population: Id;
    readonly entity: Id;
    readonly label: string;
    readonly radius: number;
    readonly requested: number;
    readonly compartment: Id;
    readonly arrangement: Extract<NormalizedArrangement, { kind: 'fiber' }>;
  }[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly seed: number;
}

export const MesoFiberResolver: Resolver<FiberInput> = {
  id: 'meso.fiber',
  version: '0.1.0',
  description: 'Filaments along a given path or grown as a persistent random walk',
  arrangements: ['fiber'],
  locations: ['interior'],
  project(job: ResolveJob): FiberInput {
    return {
      items: job.populations.map((p) => {
        const a = p.arrangement as Extract<NormalizedArrangement, { kind: 'fiber' }>;
        return {
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? a.rise / 2,
          requested: p.requested ?? 0,
          compartment: p.compartment,
          arrangement: a,
        };
      }),
      compartments: packCompartments(job, job.populations.map((p) => p.compartment)),
      seed: job.seed,
    };
  },
  resolve(input, job): ResolveOutput {
    const typeTable: PlacementType[] = input.items.map((it, index) => ({ index, population: it.population, entity: it.entity, label: it.label, compartment: it.compartment, radius: it.radius }));
    const b = new PlacementBuilder(input.items.reduce((s, i) => s + i.requested, 0));
    const offsets: number[] = [0];
    const achieved: Record<Id, number> = {};
    const shortfall: Record<Id, string> = {};
    const q = [0, 0, 0, 1];
    input.items.forEach((it, t) => {
      const a = it.arrangement;
      const twist = (a.twist * Math.PI) / 180;
      const start = b.count;
      if (a.path) {
        // along the path, one copy every `rise` of arc length
        let k = 0;
        let carry = 0;
        for (let s = 0; s + 1 < a.path.length && b.count - start < it.requested; s++) {
          const [x0, y0, z0] = a.path[s];
          const [x1, y1, z1] = a.path[s + 1];
          const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
          if (len === 0) continue;
          const tx = (x1 - x0) / len, ty = (y1 - y0) / len, tz = (z1 - z0) / len;
          for (let u = carry; u <= len && b.count - start < it.requested; u += a.rise) {
            quatFromTo(q, 0, 0, 1, tx, ty, tz, twist * k++);
            b.push(t, x0 + tx * u, y0 + ty * u, z0 + tz * u, q);
            carry = u + a.rise - len;
          }
        }
        offsets.push(b.count);
      } else if (a.growth) {
        const c = input.compartments[it.compartment];
        const s = c && shapeSampler(c.shape, job.compartments.get(it.compartment)?.mesh);
        if (!s) {
          achieved[it.population] = 0;
          shortfall[it.population] = `${it.compartment} has no shape to grow filaments in`;
          return;
        }
        const perFiber = Math.max(1, Math.round(a.growth.length / a.rise));
        const fibers = a.growth.count ?? Math.ceil(it.requested / perFiber);
        const rand = createRandom(subSeed(input.seed, it.population));
        // tangent correlation exp(-s/P): per step a bend of variance 2·rise/P (worm-like chain)
        const sigma = Math.sqrt((2 * a.rise) / a.growth.persistence);
        const dir = [0, 0, 1];
        const tmp = [0, 0, 0];
        for (let f = 0; f < fibers && b.count - start < it.requested; f++) {
          let x = 0, y = 0, z = 0;
          for (let tries = 0; tries < 100; tries++) {
            x = rand.range(s.min[0], s.max[0]);
            y = rand.range(s.min[1], s.max[1]);
            z = rand.range(s.min[2], s.max[2]);
            if (s.contains(x, y, z, it.radius + c.thickness / 2)) break;
          }
          rand.onSphere(dir);
          for (let k = 0; k < perFiber && b.count - start < it.requested; k++) {
            quatFromTo(q, 0, 0, 1, dir[0], dir[1], dir[2], twist * k);
            b.push(t, x, y, z, q);
            // bend, then step; a step leaving the compartment turns toward its middle
            rand.onSphere(tmp);
            for (let j = 0; j < 3; j++) dir[j] += sigma * tmp[j];
            let l = Math.hypot(dir[0], dir[1], dir[2]);
            for (let j = 0; j < 3; j++) dir[j] /= l;
            let nx = x + dir[0] * a.rise, ny = y + dir[1] * a.rise, nz = z + dir[2] * a.rise;
            if (!s.contains(nx, ny, nz, it.radius + c.thickness / 2)) {
              const mx = (s.min[0] + s.max[0]) / 2 - x, my = (s.min[1] + s.max[1]) / 2 - y, mz = (s.min[2] + s.max[2]) / 2 - z;
              l = Math.hypot(mx, my, mz) || 1;
              dir[0] = mx / l;
              dir[1] = my / l;
              dir[2] = mz / l;
              nx = x + dir[0] * a.rise;
              ny = y + dir[1] * a.rise;
              nz = z + dir[2] * a.rise;
            }
            x = nx;
            y = ny;
            z = nz;
          }
          offsets.push(b.count);
        }
      }
      const placed = b.count - start;
      achieved[it.population] = placed;
      if (placed < it.requested)
        shortfall[it.population] = a.path
          ? `the path is ${pathLength(a.path).toFixed(0)} Å long: ${placed} copies ${a.rise} Å apart; ${it.requested} asked`
          : `${a.growth?.count ?? '?'} filaments of ${a.growth?.length} Å hold ${placed}; ${it.requested} asked`;
    });
    const fibers = { count: offsets.length - 1, offsets: Int32Array.from(offsets), indices: Int32Array.from({ length: b.count }, (_, i) => i) };
    return { sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable }, fibers)], achieved, shortfall };
  },
};

function pathLength(p: readonly (readonly number[])[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
  return s;
}
