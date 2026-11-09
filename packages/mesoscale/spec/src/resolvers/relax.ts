/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id, Location } from '../format/doc.js';
import { PlacementBuilder, type PlacementSet, type PlacementType } from '../ir/placements.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type { Resolver, ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { type SdfGrid, type ShapeSampler, sdfGrid, shapeSampler } from './geometry.js';
import { type PackCompartment, packCompartments, randomQuat } from './packing.js';

// `meso.relax` (design.md §6.7): a refine stage. It takes the result of the model it refines (a rigid-body placement
// that stopped short, as random sequential addition does near jamming), inserts the copies still missing where they
// overlap, and relaxes overlaps by pushing pairs apart, keeping copies in their compartments with signed distance grids.
// Membrane and surface copies and the copies of avoided models stay fixed. It reconciles the same constraints as the
// stage before it: the runtime checks the populations' placed fraction on its result. Overlaps are found in a hash
// grid: O(N) an iteration. mesobuild's engine/relax.py relaxes rigid sphere bodies the same way.

interface RelaxInput {
  readonly upstream: readonly string[];
  readonly obstacles: readonly string[];
  readonly populations: readonly {
    readonly id: Id;
    readonly requested: number;
    readonly location: Location;
    readonly compartment: Id;
  }[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly iterations: number;
  readonly tolerance: number;
  readonly insert: boolean;
  readonly seed: number;
}

export const MesoRelaxResolver: Resolver<RelaxInput> = {
  id: 'meso.relax',
  version: '0.1.1',
  description:
    "Refines another model's placement: inserts missing copies, relaxes overlaps, keeps copies in their compartments",
  arrangements: ['random'],
  locations: ['interior', 'membrane', 'outer-surface', 'inner-surface', 'exterior'],
  project(job: ResolveJob): RelaxInput {
    const params = job.model.params ?? {};
    return {
      upstream: (job.upstream?.sets ?? []).map((s) => s.key),
      obstacles: job.obstacles.map((s) => s.key),
      populations: job.populations.map((p) => ({
        id: p.id,
        requested: p.requested ?? 0,
        location: p.location,
        compartment: p.compartment,
      })),
      compartments: packCompartments(
        job,
        job.populations.map((p) => p.compartment),
      ),
      iterations: Number(params.iterations ?? 300),
      tolerance: Number(params.tolerance ?? 1),
      insert: params.insert !== false,
      seed: job.seed,
    };
  },
  resolve(input, job): ResolveOutput {
    const up = job.upstream;
    if (!up) return { sets: [], achieved: {}, shortfall: {} };
    const pops = new Map(input.populations.map((p) => [p.id, p]));
    const rand = createRandom(subSeed(input.seed, job.model.id));

    // signed distance grids of the compartments copies live in (and of their children, to stay out of them)
    const grids = new Map<Id, SdfGrid>();
    const grid = (id: Id) => {
      let g = grids.get(id);
      if (g) return g;
      const c = input.compartments[id];
      const s = c && shapeSampler(c.shape, job.compartments.get(id)?.mesh);
      if (!s) return undefined;
      g = sdfGrid(s, createRandom(subSeed(input.seed, `sdf:${id}`)));
      grids.set(id, g);
      return g;
    };

    // the bodies: every upstream copy (movable when it lives in a volume), the obstacles (fixed)
    interface Body {
      x: number;
      y: number;
      z: number;
      r: number;
      fixed: boolean;
      set: number;
      type: number;
      q: number[];
      inserted: boolean;
      owner?: Id;
      outside: Id[];
      margin: number;
    }
    const bodies: Body[] = [];
    const sets = up.sets;
    const volumeOwner = (p: { location: Location; compartment: Id } | undefined) =>
      !p
        ? undefined
        : p.location === 'interior'
          ? p.compartment
          : p.location === 'exterior'
            ? job.compartments.get(p.compartment)?.parent
            : undefined;
    const bodyFor = (
      set: number,
      type: number,
      x: number,
      y: number,
      z: number,
      q: number[],
      inserted: boolean,
    ): Body => {
      const t = sets[set].typeTable[type];
      const p = pops.get(t.population);
      const owner = volumeOwner(p);
      const oc = owner ? input.compartments[owner] : undefined;
      return {
        x,
        y,
        z,
        r: t.radius,
        fixed: !owner,
        set,
        type,
        q,
        inserted,
        owner,
        outside: [...(oc?.children ?? [])],
        margin: t.radius + (oc?.thickness ?? 0) / 2,
      };
    };
    sets.forEach((s, si) => {
      for (let i = 0; i < s.count; i++)
        bodies.push(
          bodyFor(
            si,
            s.types[i],
            s.positions[3 * i],
            s.positions[3 * i + 1],
            s.positions[3 * i + 2],
            Array.from(s.rotations.subarray(4 * i, 4 * i + 4)),
            false,
          ),
        );
    });
    const firstMovable = bodies.length;
    for (const o of job.obstacles)
      for (let i = 0; i < o.count; i++)
        bodies.push({
          x: o.positions[3 * i],
          y: o.positions[3 * i + 1],
          z: o.positions[3 * i + 2],
          r: o.typeTable[o.types[i]].radius,
          fixed: true,
          set: -1,
          type: -1,
          q: [],
          inserted: false,
          outside: [],
          margin: 0,
        });

    // insert what is missing, anywhere in its volume (overlaps allowed: the relaxation removes them)
    let inserted = 0;
    if (input.insert)
      for (const p of input.populations) {
        const owner = volumeOwner(p);
        if (!owner) continue;
        const have = sets.reduce(
          (n, s) => n + s.typeTable.filter((t) => t.population === p.id).reduce((m, t) => m + countType(s, t.index), 0),
          0,
        );
        const si = sets.findIndex((s) => s.typeTable.some((t) => t.population === p.id));
        const g = grid(owner);
        if (si < 0 || !g) continue;
        const type = sets[si].typeTable.find((t) => t.population === p.id)!.index;
        const c = input.compartments[owner];
        const ss = shapeSampler(c.shape, job.compartments.get(owner)?.mesh)!;
        for (let k = have; k < p.requested; k++) {
          let x = 0,
            y = 0,
            z = 0;
          for (let tries = 0; tries < 200; tries++) {
            x = rand.range(ss.min[0], ss.max[0]);
            y = rand.range(ss.min[1], ss.max[1]);
            z = rand.range(ss.min[2], ss.max[2]);
            if (g.distance(x, y, z) < -sets[si].typeTable[type].radius) break;
          }
          bodies.push(bodyFor(si, type, x, y, z, randomQuat(rand, [0, 0, 0, 1]), true));
          inserted++;
        }
      }
    // obstacles were pushed before the inserted copies: keep them where `fixed` says, wherever they sit in the list
    void firstMovable;

    // relax: pairs pushed apart (a fixed body does not move), then each movable body kept in its volume
    // a loop, not Math.max(...bodies): an argument spread overflows the stack past ~100 000 bodies
    let maxR = 1;
    for (const b of bodies) if (b.r > maxR) maxR = b.r;
    const cell = 2 * maxR;
    const key = (i: number, j: number, k: number) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
    let largest = 0;
    let it = 0;
    const gr = [0, 0, 0];
    for (; it < input.iterations; it++) {
      const cells = new Map<number, number[]>();
      bodies.forEach((b, i) => {
        const k = key(Math.floor(b.x / cell), Math.floor(b.y / cell), Math.floor(b.z / cell));
        const l = cells.get(k);
        if (l) l.push(i);
        else cells.set(k, [i]);
      });
      largest = 0;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        const ci = Math.floor(a.x / cell),
          cj = Math.floor(a.y / cell),
          ck = Math.floor(a.z / cell);
        for (let u = -1; u <= 1; u++)
          for (let v = -1; v <= 1; v++)
            for (let w = -1; w <= 1; w++) {
              const l = cells.get(key(ci + u, cj + v, ck + w));
              if (!l) continue;
              for (const j of l) {
                if (j <= i) continue;
                const b = bodies[j];
                if (a.fixed && b.fixed) continue;
                const dx = b.x - a.x,
                  dy = b.y - a.y,
                  dz = b.z - a.z;
                const d = Math.hypot(dx, dy, dz);
                const overlap = a.r + b.r - d;
                if (overlap <= 0) continue;
                if (overlap > largest) largest = overlap;
                const nx = d > 1e-6 ? dx / d : 1,
                  ny = d > 1e-6 ? dy / d : 0,
                  nz = d > 1e-6 ? dz / d : 0;
                const sa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
                const sb = 1 - sa;
                // a little past contact, so neighbours settle instead of chattering
                const push = overlap * 1.02;
                a.x -= nx * push * sa;
                a.y -= ny * push * sa;
                a.z -= nz * push * sa;
                b.x += nx * push * sb;
                b.y += ny * push * sb;
                b.z += nz * push * sb;
              }
            }
      }
      for (const b of bodies) {
        if (b.fixed || !b.owner) continue;
        const g = grid(b.owner);
        if (g) {
          const d = g.distance(b.x, b.y, b.z);
          if (d > -b.margin) {
            g.gradient(gr, b.x, b.y, b.z);
            const m = d + b.margin;
            b.x -= gr[0] * m;
            b.y -= gr[1] * m;
            b.z -= gr[2] * m;
          }
        }
        for (const k of b.outside) {
          const gk = grid(k);
          if (!gk) continue;
          const half = (input.compartments[k]?.thickness ?? 0) / 2;
          const d = gk.distance(b.x, b.y, b.z);
          if (d < b.r + half) {
            gk.gradient(gr, b.x, b.y, b.z);
            const m = b.r + half - d;
            b.x += gr[0] * m;
            b.y += gr[1] * m;
            b.z += gr[2] * m;
          }
        }
      }
      if (largest <= input.tolerance) break;
    }

    // the grids are approximate (cells of tens of Å): a last phase checks each copy with its compartment's exact inside
    // test (with its margin), steps a copy that is out back in along the grid's gradient, and resolves the overlaps that
    // creates, until both hold; then the largest overlap is measured after the last step, not during it
    const exactShapes = new Map<Id, ShapeSampler | undefined>();
    const exact = (id: Id) => {
      if (!exactShapes.has(id))
        exactShapes.set(id, shapeSampler(input.compartments[id].shape, job.compartments.get(id)?.mesh));
      return exactShapes.get(id);
    };
    const outOfOwner = (b: Body) => !!b.owner && exact(b.owner)?.contains(b.x, b.y, b.z, b.margin) === false;
    /** The child compartment a copy is in, or nearer than its radius and half the child's membrane (exact). */
    const inChild = (b: Body) => {
      for (const k of b.outside) {
        const need = b.r + (input.compartments[k]?.thickness ?? 0) / 2;
        // the grid first: the exact test (O(triangles) for a mesh) only near the child
        const g = grid(k);
        if (g && g.distance(b.x, b.y, b.z) > need + 2 * g.cell) continue;
        if (exact(k)?.contains(b.x, b.y, b.z, -need)) return k;
      }
      return undefined;
    };
    const isOut = (b: Body) => outOfOwner(b) || inChild(b) !== undefined;
    const pairPass = (push: boolean) => {
      const cells = new Map<number, number[]>();
      bodies.forEach((b, i) => {
        const k = key(Math.floor(b.x / cell), Math.floor(b.y / cell), Math.floor(b.z / cell));
        const l = cells.get(k);
        if (l) l.push(i);
        else cells.set(k, [i]);
      });
      let worst = 0;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        const ci = Math.floor(a.x / cell),
          cj = Math.floor(a.y / cell),
          ck = Math.floor(a.z / cell);
        for (let u = -1; u <= 1; u++)
          for (let v = -1; v <= 1; v++)
            for (let w = -1; w <= 1; w++)
              for (const j of cells.get(key(ci + u, cj + v, ck + w)) ?? []) {
                if (j <= i) continue;
                const b = bodies[j];
                if (a.fixed && b.fixed) continue;
                const dx = b.x - a.x,
                  dy = b.y - a.y,
                  dz = b.z - a.z;
                const d = Math.hypot(dx, dy, dz);
                const overlap = a.r + b.r - d;
                if (overlap <= 0) continue;
                worst = Math.max(worst, overlap);
                if (!push) continue;
                const nx = d > 1e-6 ? dx / d : 1,
                  ny = d > 1e-6 ? dy / d : 0,
                  nz = d > 1e-6 ? dz / d : 0;
                // a copy that is in only by its margin is not pushed further out: its partner moves
                const sa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
                const p = overlap * 1.02;
                a.x -= nx * p * sa;
                a.y -= ny * p * sa;
                a.z -= nz * p * sa;
                b.x += nx * p * (1 - sa);
                b.y += ny * p * (1 - sa);
                b.z += nz * p * (1 - sa);
              }
      }
      return worst;
    };
    let outsideCount = 0;
    for (let round = 0; round < 80; round++) {
      outsideCount = 0;
      for (const b of bodies) {
        if (b.fixed || !b.owner || !isOut(b)) continue;
        outsideCount++;
        // out of its compartment: a step in, down the compartment's gradient; in a child: a step out, up the child's
        for (let k = 0; k < 30; k++) {
          const out = outOfOwner(b);
          const child = out ? undefined : inChild(b);
          if (!out && child === undefined) break;
          const g = grid(out ? b.owner : child!);
          if (!g) break;
          g.gradient(gr, b.x, b.y, b.z);
          const sign = out ? -2 : 2;
          b.x += gr[0] * sign;
          b.y += gr[1] * sign;
          b.z += gr[2] * sign;
        }
      }
      largest = pairPass(true);
      if (!outsideCount && largest <= input.tolerance) break;
    }
    largest = pairPass(false);
    outsideCount = bodies.filter((b) => !b.fixed && isOut(b)).length;

    // what still overlaps by more than the tolerance after the last iteration: inserted copies dropped, greedily
    const dropped = new Set<number>();
    if (largest > input.tolerance) {
      const cells = new Map<number, number[]>();
      bodies.forEach((b, i) => {
        const k = key(Math.floor(b.x / cell), Math.floor(b.y / cell), Math.floor(b.z / cell));
        cells.set(k, [...(cells.get(k) ?? []), i]);
      });
      bodies.forEach((a, i) => {
        if (!a.inserted || dropped.has(i)) return;
        const ci = Math.floor(a.x / cell),
          cj = Math.floor(a.y / cell),
          ck = Math.floor(a.z / cell);
        for (let u = -1; u <= 1; u++)
          for (let v = -1; v <= 1; v++)
            for (let w = -1; w <= 1; w++)
              for (const j of cells.get(key(ci + u, cj + v, ck + w)) ?? []) {
                if (j === i || dropped.has(j)) continue;
                const b = bodies[j];
                if (a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > input.tolerance) dropped.add(i);
              }
      });
    }

    // the result: each upstream set rebuilt type by type (every population one run), inserted copies after the others
    const achieved: Record<Id, number> = {};
    const out: PlacementSet[] = sets.map((s, si) => {
      const b = new PlacementBuilder(s.count + inserted);
      for (let t = 0; t < s.typeTable.length; t++)
        bodies.forEach((body, i) => {
          if (body.set !== si || body.type !== t || dropped.has(i)) return;
          b.push(t, body.x, body.y, body.z, body.q);
        });
      for (const t of s.typeTable as PlacementType[])
        achieved[t.population] = (achieved[t.population] ?? 0) + b.countOf(t.index);
      return b.finish({ key: '', model: job.model.id, frame: s.frame, typeTable: s.typeTable }, s.fibers);
    });
    const shortfall: Record<Id, string> = {};
    for (const p of input.populations)
      if ((achieved[p.id] ?? 0) < p.requested)
        shortfall[p.id] =
          `relaxation stopped after ${it} iterations with a largest overlap of ${largest.toFixed(1)} Å (tolerance ${input.tolerance} Å); ${dropped.size} inserted copies still overlapping were dropped`;
    return {
      sets: out,
      achieved,
      shortfall,
      report: {
        iterations: it,
        largestOverlap: Math.round(largest * 100) / 100,
        outsideExact: outsideCount,
        inserted,
        dropped: dropped.size,
        tolerance: input.tolerance,
      },
    };
  },
};

function countType(s: PlacementSet, type: number) {
  let n = 0;
  for (let i = 0; i < s.count; i++) if (s.types[i] === type) n++;
  return n;
}
