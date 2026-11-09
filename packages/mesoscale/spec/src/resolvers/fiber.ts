/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id } from '../format/doc.js';
import { issue, type Issue } from '../format/issues.js';
import { PlacementBuilder, type PlacementType, quatFromTo, rotateVec } from '../ir/placements.js';
import { createRandom, subSeed } from '../runtime/random.js';
import type {
  MaterializedSite,
  NormalizedArrangement,
  NormalizedRelation,
  Resolver,
  ResolveJob,
  ResolveOutput,
} from '../runtime/resolver.js';
import { shapeSampler } from './geometry.js';
import { avoidedHash, type PackCompartment, packCompartments } from './packing.js';

// `meso.fiber` (design.md §4.4, §3.11): filaments as copies `rise` apart along a path, each turned by `twist` about the
// path's tangent. A path is given (traced from a tomogram, or inline) or grown: a persistent random walk inside the
// compartment, its bend per step drawn so the tangent correlation decays over the persistence length, turned back
// toward the middle when a step would leave. The copies of each filament are one CSR row of the set's `fibers`.
//
// It honours `binds` and `bends` relations whose object is a strand it grows: every `spacing` of arc length a subject
// copy is placed with its entry site on the strand and its entry→exit axis along the strand (the attachment-point rule
// of MesoCraft, x = q − R·p, Jia et al. 2026 eq. 1); the strand resumes at the exit site, turned by the relation's
// angle for `bends`. A traced path is an observation: binders are placed on it, but it is not bent (an info issue).
//
// The copies of the models it avoids: a grown filament steps around them (a step that would overlap one turns; a
// filament with no free step ends there); a traced path is kept where it is, its overlaps reported (a warning). The
// binders' poses are not checked against them.

type Fiber = Extract<NormalizedArrangement, { kind: 'fiber' }>;

interface Strand {
  readonly population: Id;
  readonly entity: Id;
  readonly label: string;
  readonly radius: number;
  readonly requested: number;
  readonly compartment: Id;
  readonly arrangement: Fiber;
}

interface Binder {
  readonly population: Id;
  readonly entity: Id;
  readonly label: string;
  readonly radius: number;
  readonly requested: number;
  readonly compartment: Id;
  readonly relation: NormalizedRelation;
  readonly strand: Id;
}

interface FiberInput {
  readonly strands: readonly Strand[];
  readonly binders: readonly Binder[];
  readonly stray: readonly Id[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly seed: number;
}

const OnStrand = ['binds', 'bends'] as const;

export const MesoFiberResolver: Resolver<FiberInput> = {
  id: 'meso.fiber',
  version: '0.3.2',
  description:
    'Filaments along a given path or grown as a persistent random walk; binders and benders placed on them by their sites',
  arrangements: ['fiber', 'random'],
  locations: ['interior'],
  honours: ['binds', 'bends'],
  project(job: ResolveJob): FiberInput {
    const strands: Strand[] = [];
    const binders: Binder[] = [];
    const stray: Id[] = [];
    for (const p of job.populations) {
      if (p.arrangement.kind === 'fiber') {
        strands.push({
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? p.arrangement.rise / 2,
          requested: p.requested ?? 0,
          compartment: p.compartment,
          arrangement: p.arrangement,
        });
        continue;
      }
      const rel = job.relations.find(
        (r) => (OnStrand as readonly string[]).includes(r.kind) && r.subjects.includes(p.id),
      );
      const strand = rel?.objects.find((o) =>
        job.populations.some((q) => q.id === o && q.arrangement.kind === 'fiber'),
      );
      if (rel && strand)
        binders.push({
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? 20,
          requested: p.requested ?? 0,
          compartment: p.compartment,
          relation: rel,
          strand,
        });
      else stray.push(p.id);
    }
    return {
      strands,
      binders,
      stray,
      compartments: packCompartments(
        job,
        job.populations.map((p) => p.compartment),
      ),
      seed: job.seed,
    };
  },
  resolve(input, job): ResolveOutput {
    const items = [...input.strands, ...input.binders];
    const typeTable: PlacementType[] = items.map((it, index) => ({
      index,
      population: it.population,
      entity: it.entity,
      label: it.label,
      compartment: it.compartment,
      radius: it.radius,
    }));
    const b = new PlacementBuilder(items.reduce((s, i) => s + i.requested, 0));
    const offsets: number[] = [0];
    const strandIdx: number[] = [];
    const achieved: Record<Id, number> = {};
    const shortfall: Record<Id, string> = {};
    const issues: Issue[] = [];
    const q = [0, 0, 0, 1];
    const tmp = [0, 0, 0];
    // the copies of the models it avoids
    let maxR = 1;
    for (const it of items) maxR = Math.max(maxR, it.radius);
    const avoided = avoidedHash(job, maxR);
    for (const id of input.stray) {
      achieved[id] = 0;
      shortfall[id] = 'meso.fiber places strands and what binds or bends them; this population is neither';
    }

    input.strands.forEach((it, t) => {
      const a = it.arrangement;
      const blocked = (x: number, y: number, z: number) => avoided.size > 0 && avoided.overlaps(x, y, z, it.radius);
      const twist = (a.twist * Math.PI) / 180;
      // the binders on this strand, with what is left of their counts
      const on = input.binders
        .map((bd, k) => ({ bd, type: input.strands.length + k, left: bd.requested, poses: [] as number[][] }))
        .filter((x) => x.bd.strand === it.population);
      for (const x of on)
        if (x.bd.relation.unresolved) {
          shortfall[x.bd.population] = `relation ${x.bd.relation.id} is not reconciled: ${x.bd.relation.unresolved}`;
          x.left = 0;
        }
      const active = on.filter((x) => x.left > 0 && x.bd.relation.entry);
      const spacingOf = (x: (typeof on)[number]) => x.bd.relation.spacing ?? a.rise * 10;
      let sinceBinder = 0;
      let next = 0;
      /** At `cur` heading `dir`: maybe a binder; returns the point and heading the strand resumes from. */
      const maybeBind = (cur: number[], dir: number[], rand: () => number, bendable: boolean): boolean => {
        const open = active.filter((y) => y.left > 0);
        if (!open.length) return false;
        const x = open[next % open.length];
        if (sinceBinder < spacingOf(x)) return false;
        const rel = x.bd.relation;
        const en = rel.entry as MaterializedSite;
        const ex = rel.exit ?? en;
        // the subject's entry→exit axis along the strand, its entry site on the strand: x = q − R·p
        let ux = ex.position[0] - en.position[0],
          uy = ex.position[1] - en.position[1],
          uz = ex.position[2] - en.position[2];
        let ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-6) [ux, uy, uz, ul] = [...(en.axis ?? [0, 0, 1]), 1] as [number, number, number, number];
        quatFromTo(q, ux / ul, uy / ul, uz / ul, dir[0], dir[1], dir[2], rand() * 2 * Math.PI);
        const rp = rotateVec(tmp, q, en.position[0], en.position[1], en.position[2]);
        const px = cur[0] - rp[0],
          py = cur[1] - rp[1],
          pz = cur[2] - rp[2];
        x.poses.push([px, py, pz, q[0], q[1], q[2], q[3]]);
        x.left--;
        next++;
        sinceBinder = 0;
        // the strand resumes at the exit site, turned by the bend
        const re = rotateVec([0, 0, 0], q, ex.position[0], ex.position[1], ex.position[2]);
        cur[0] = px + re[0];
        cur[1] = py + re[1];
        cur[2] = pz + re[2];
        if (rel.kind === 'bends' && rel.angle && bendable) {
          // the turn is about an axis across the strand, fixed in the binder's frame (its local x)
          const ax = rotateVec([0, 0, 0], q, 1, 0, 0);
          const d0 = ax[0] * dir[0] + ax[1] * dir[1] + ax[2] * dir[2];
          let kx = ax[0] - d0 * dir[0],
            ky = ax[1] - d0 * dir[1],
            kz = ax[2] - d0 * dir[2];
          const kl = Math.hypot(kx, ky, kz) || 1;
          kx /= kl;
          ky /= kl;
          kz /= kl;
          const c = Math.cos(rel.angle),
            s = Math.sin(rel.angle);
          const [dx, dy, dz] = dir;
          // Rodrigues: dir·cos + (k × dir)·sin (k ⟂ dir)
          dir[0] = dx * c + (ky * dz - kz * dy) * s;
          dir[1] = dy * c + (kz * dx - kx * dz) * s;
          dir[2] = dz * c + (kx * dy - ky * dx) * s;
        }
        return true;
      };
      const start = b.count;
      if (a.path) {
        let k = 0;
        let carry = 0;
        let bendWarned = false;
        let overlapping = 0;
        const rand = createRandom(subSeed(input.seed, it.population));
        for (let s = 0; s + 1 < a.path.length && b.count - start < it.requested; s++) {
          const [x0, y0, z0] = a.path[s];
          const [x1, y1, z1] = a.path[s + 1];
          const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
          if (len === 0) continue;
          const tx = (x1 - x0) / len,
            ty = (y1 - y0) / len,
            tz = (z1 - z0) / len;
          // the carry is what is left of the rise past the last copy: a segment shorter than it places none and
          // passes the rest on (dense traced points, a few Å apart)
          let u = carry;
          for (; u <= len + 1e-6 && b.count - start < it.requested; u += a.rise) {
            const cur = [x0 + tx * u, y0 + ty * u, z0 + tz * u];
            const dir = [tx, ty, tz];
            sinceBinder += a.rise;
            if (
              maybeBind(cur, dir, rand.next, false) &&
              !bendWarned &&
              active.some((x) => x.bd.relation.kind === 'bends')
            ) {
              bendWarned = true;
              issues.push(
                issue(
                  'relation.path',
                  'info',
                  'resolve',
                  `${it.population} follows a traced path: binders are placed on it, bends are not applied (the path is the observation)`,
                  { ids: [it.population] },
                ),
              );
            }
            quatFromTo(q, 0, 0, 1, tx, ty, tz, twist * k++);
            strandIdx.push(b.push(t, x0 + tx * u, y0 + ty * u, z0 + tz * u, q));
            if (blocked(x0 + tx * u, y0 + ty * u, z0 + tz * u)) overlapping++;
          }
          carry = u - len;
        }
        offsets.push(strandIdx.length);
        if (overlapping)
          issues.push(
            issue(
              'resolver.unsupported',
              'warning',
              'resolve',
              `${it.population} follows a traced path: ${overlapping} copies overlap the copies of the models ${job.model.id} avoids (kept: the path is the observation)`,
              { ids: [it.population] },
            ),
          );
      } else if (a.growth) {
        const c = input.compartments[it.compartment];
        const s = c && shapeSampler(c.shape, job.compartments.get(it.compartment)?.mesh);
        if (!s) {
          achieved[it.population] = 0;
          shortfall[it.population] = `${it.compartment} has no shape to grow filaments in`;
          for (const x of on) {
            achieved[x.bd.population] ??= 0;
            shortfall[x.bd.population] ??= `the strand ${it.population} was not grown: ${shortfall[it.population]}`;
          }
          return;
        }
        const perFiber = Math.max(1, Math.round(a.growth.length / a.rise));
        const fibers = a.growth.count ?? Math.ceil(it.requested / perFiber);
        const rand = createRandom(subSeed(input.seed, it.population));
        // tangent correlation exp(-s/P): per step a bend of variance 2·rise/P across the tangent (worm-like chain); a
        // kick along a unit-sphere direction puts 2/3 of its variance across, so σ² = 3·rise/P (2·rise/P gave 1.5·P)
        const sigma = Math.sqrt((3 * a.rise) / a.growth.persistence);
        const dir = [0, 0, 1];
        const margin = it.radius + c.thickness / 2;
        let afterBinder = false;
        for (let f = 0; f < fibers && b.count - start < it.requested; f++) {
          const cur = [0, 0, 0];
          for (let tries = 0; tries < 100; tries++) {
            cur[0] = rand.range(s.min[0], s.max[0]);
            cur[1] = rand.range(s.min[1], s.max[1]);
            cur[2] = rand.range(s.min[2], s.max[2]);
            if (s.contains(cur[0], cur[1], cur[2], margin) && !blocked(cur[0], cur[1], cur[2])) break;
          }
          rand.onSphere(dir);
          const first = strandIdx.length;
          for (let k = 0; k < perFiber && b.count - start < it.requested; k++) {
            // no free start, or a binder's exit site on an avoided copy: the filament ends here
            if (blocked(cur[0], cur[1], cur[2])) break;
            quatFromTo(q, 0, 0, 1, dir[0], dir[1], dir[2], twist * k);
            strandIdx.push(b.push(t, cur[0], cur[1], cur[2], q));
            sinceBinder += a.rise;
            // a binder here: the next copy is at its exit site, heading the bent way; else the worm-like step
            if (maybeBind(cur, dir, rand.next, true)) {
              afterBinder = true;
              continue;
            }
            // the step out of a binder keeps the direction the binder set (its exit tangent); others bend at random
            if (!afterBinder) {
              rand.onSphere(tmp);
              for (let j = 0; j < 3; j++) dir[j] += sigma * tmp[j];
            }
            afterBinder = false;
            let l = Math.hypot(dir[0], dir[1], dir[2]);
            for (let j = 0; j < 3; j++) dir[j] /= l;
            let nx = cur[0] + dir[0] * a.rise,
              ny = cur[1] + dir[1] * a.rise,
              nz = cur[2] + dir[2] * a.rise;
            if (!s.contains(nx, ny, nz, margin)) {
              const mx = (s.min[0] + s.max[0]) / 2 - cur[0],
                my = (s.min[1] + s.max[1]) / 2 - cur[1],
                mz = (s.min[2] + s.max[2]) / 2 - cur[2];
              l = Math.hypot(mx, my, mz) || 1;
              dir[0] = mx / l;
              dir[1] = my / l;
              dir[2] = mz / l;
              nx = cur[0] + dir[0] * a.rise;
              ny = cur[1] + dir[1] * a.rise;
              nz = cur[2] + dir[2] * a.rise;
            }
            // onto an avoided copy: a few other headings; none free, the filament ends
            if (blocked(nx, ny, nz)) {
              let free = false;
              for (let turn = 0; turn < 12 && !free; turn++) {
                rand.onSphere(dir);
                nx = cur[0] + dir[0] * a.rise;
                ny = cur[1] + dir[1] * a.rise;
                nz = cur[2] + dir[2] * a.rise;
                free = s.contains(nx, ny, nz, margin) && !blocked(nx, ny, nz);
              }
              if (!free) break;
            }
            cur[0] = nx;
            cur[1] = ny;
            cur[2] = nz;
          }
          if (strandIdx.length > first) offsets.push(strandIdx.length);
        }
      }
      const placed = b.count - start;
      achieved[it.population] = placed;
      if (placed < it.requested)
        shortfall[it.population] = a.path
          ? `the path is ${pathLength(a.path).toFixed(0)} Å long: ${placed} copies ${a.rise} Å apart; ${it.requested} asked`
          : `${a.growth?.count ?? '?'} filaments of ${a.growth?.length} Å hold ${placed}; ${it.requested} asked`;
      // the binders, after the strand: each population one contiguous run
      for (const x of on) {
        for (const p of x.poses) b.push(x.type, p[0], p[1], p[2], [p[3], p[4], p[5], p[6]]);
        achieved[x.bd.population] = (achieved[x.bd.population] ?? 0) + x.poses.length;
        if (x.poses.length < x.bd.requested && !shortfall[x.bd.population])
          shortfall[x.bd.population] =
            `the strand ${it.population} is ${(a.path ? pathLength(a.path) : placed * a.rise).toFixed(0)} Å long: ${x.poses.length} copies ${spacingOf(x).toFixed(0)} Å apart on it; ${x.bd.requested} asked`;
      }
    });
    const fibers = {
      count: offsets.length - 1,
      offsets: Int32Array.from(offsets),
      indices: Int32Array.from(strandIdx),
    };
    return {
      sets: [b.finish({ key: '', model: job.model.id, frame: 'world', typeTable }, fibers)],
      achieved,
      shortfall,
      issues,
    };
  },
};

function pathLength(p: readonly (readonly number[])[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++)
    s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
  return s;
}
