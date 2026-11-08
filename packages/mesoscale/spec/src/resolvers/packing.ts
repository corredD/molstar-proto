/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Id, Location } from '../format/doc.js';
import type { IRShape } from '../ir/ir.js';
import { PlacementBuilder, type PlacementSet, type PlacementType, quatFromTo } from '../ir/placements.js';
import { createRandom, type Random, subSeed } from '../runtime/random.js';
import type { NormalizedCompartment, ResolveJob, ResolveOutput } from '../runtime/resolver.js';
import { type ShapeSampler, shapeSampler } from './geometry.js';

// Seeded random sequential addition (design.md §4.4, §8): copies tried one at a time, a try kept when its sphere overlaps
// nothing placed. Overlaps are looked up in a uniform hash grid (cell = the largest diameter), so a try costs O(1) and N
// copies O(N · tries), never O(N²). The engine of `meso.pack` and of the cellPACK adapter, which differ only in how they
// fill `PackItem` (orientation axis, membrane offset, order).

export interface PackItem {
  readonly population: Id;
  readonly entity: Id;
  readonly label: string;
  /** Å */
  readonly radius: number;
  readonly requested: number;
  readonly location: Location;
  readonly compartment: Id;
  /** The local axis turned onto the membrane normal (default +z). */
  readonly axis?: readonly [number, number, number];
  /** Å along the normal, from the membrane's middle (membrane location) or from the leaflet (surfaces). */
  readonly offset?: number;
  /** The axis points inward rather than outward. */
  readonly inward?: boolean;
  /** Higher first; ties: larger first (cellPACK's order). */
  readonly priority?: number;
}

export interface PackCompartment {
  readonly shape: IRShape;
  readonly meshKey?: string;
  readonly parent?: Id;
  readonly children: readonly Id[];
  readonly thickness: number;
  readonly label: string;
  readonly freeVolume?: number;
  readonly area?: number;
}

export interface PackInput {
  readonly items: readonly PackItem[];
  readonly compartments: Readonly<Record<Id, PackCompartment>>;
  readonly seed: number;
  /** Tries a copy before it counts as a failure. */
  readonly attempts: number;
  /** Failures in a row before a population stops. */
  readonly giveUp: number;
}

export const DefaultPackParams = { attempts: 30, giveUp: 25 };

/** The compartments a set of items touches: theirs, their parents and children (for exclusion). */
export function packCompartments(job: ResolveJob, ids: Iterable<Id>): Record<Id, PackCompartment> {
  const out: Record<Id, PackCompartment> = {};
  const add = (id: Id | undefined) => {
    if (!id || out[id]) return;
    const c = job.compartments.get(id);
    if (!c) return;
    out[id] = toPack(c);
    for (const k of c.children) {
      const kc = job.compartments.get(k);
      if (kc && !out[k]) out[k] = toPack(kc);
    }
    add(c.parent);
  };
  for (const id of ids) add(id);
  return out;
}

function toPack(c: NormalizedCompartment): PackCompartment {
  return {
    shape: c.shape,
    meshKey: c.meshKey,
    parent: c.parent,
    children: c.children,
    thickness: c.membrane?.thickness ?? 0,
    label: c.label,
    freeVolume: c.freeVolume,
    area: c.area,
  };
}

export class SpatialHash {
  private cells = new Map<number, number[]>();
  private xs: number[] = [];
  private ys: number[] = [];
  private zs: number[] = [];
  private rs: number[] = [];
  maxRadius = 0;

  constructor(readonly cell: number) {}

  private key(ix: number, iy: number, iz: number) {
    return ((ix + 32768) * 65536 + (iy + 32768)) * 65536 + (iz + 32768);
  }

  get size() {
    return this.xs.length;
  }

  insert(x: number, y: number, z: number, r: number) {
    const i = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    this.zs.push(z);
    this.rs.push(r);
    if (r > this.maxRadius) this.maxRadius = r;
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(i);
    else this.cells.set(k, [i]);
  }

  overlaps(x: number, y: number, z: number, r: number): boolean {
    const reach = Math.ceil((r + this.maxRadius) / this.cell);
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), cz = Math.floor(z / this.cell);
    for (let i = cx - reach; i <= cx + reach; i++)
      for (let j = cy - reach; j <= cy + reach; j++)
        for (let k = cz - reach; k <= cz + reach; k++) {
          const list = this.cells.get(this.key(i, j, k));
          if (!list) continue;
          for (const q of list) {
            const dx = this.xs[q] - x, dy = this.ys[q] - y, dz = this.zs[q] - z;
            const d = this.rs[q] + r;
            if (dx * dx + dy * dy + dz * dz < d * d) return true;
          }
        }
    return false;
  }
}

/** A uniformly random rotation (Shoemake). */
export function randomQuat(r: Random, out: number[]): number[] {
  const u1 = r.next(), u2 = r.next() * 2 * Math.PI, u3 = r.next() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  out[0] = a * Math.sin(u2);
  out[1] = a * Math.cos(u2);
  out[2] = b * Math.sin(u3);
  out[3] = b * Math.cos(u3);
  return out;
}

export function pack(input: PackInput, job: ResolveJob, model: string, key: string): ResolveOutput {
  const samplers = new Map<Id, ShapeSampler>();
  for (const [id, c] of Object.entries(input.compartments)) {
    const s = shapeSampler(c.shape, job.compartments.get(id)?.mesh);
    if (s) samplers.set(id, s);
  }
  const typeTable: PlacementType[] = input.items.map((it, index) => ({
    index,
    population: it.population,
    entity: it.entity,
    label: it.label,
    compartment: it.compartment,
    radius: it.radius,
  }));
  const maxR = Math.max(1, ...input.items.map((i) => i.radius), ...job.obstacles.flatMap((o) => o.typeTable.map((t) => t.radius)));
  const grid = new SpatialHash(2 * maxR);
  for (const o of job.obstacles)
    for (let i = 0; i < o.count; i++)
      grid.insert(o.positions[3 * i], o.positions[3 * i + 1], o.positions[3 * i + 2], o.typeTable[o.types[i]].radius);

  const total = input.items.reduce((s, i) => s + i.requested, 0);
  const b = new PlacementBuilder(Math.max(16, total));
  const achieved: Record<Id, number> = {};
  const shortfall: Record<Id, string> = {};
  const order = input.items
    .map((it, i) => i)
    .sort((i, j) => {
      const a = input.items[i], c = input.items[j];
      const sa = a.location === 'interior' || a.location === 'exterior' ? 1 : 0;
      const sc = c.location === 'interior' || c.location === 'exterior' ? 1 : 0;
      return sa - sc || (c.priority ?? 0) - (a.priority ?? 0) || c.radius - a.radius || i - j;
    });
  const p = [0, 0, 0], n = [0, 0, 0], q = [0, 0, 0, 1];

  for (const t of order) {
    const it = input.items[t];
    const comp = input.compartments[it.compartment];
    const s = samplers.get(it.compartment);
    const rand = createRandom(subSeed(input.seed, it.population));
    let placed = 0;
    let failures = 0;
    const reason = (why: string) => (shortfall[it.population] = why);
    if (!s || !comp) {
      reason(`${it.compartment} has no shape a packer can sample (${comp?.shape.kind ?? 'none'})`);
      achieved[it.population] = 0;
      continue;
    }
    const half = comp.thickness / 2;
    const parent = comp.parent ? samplers.get(comp.parent) : undefined;
    const outsideChildren = (owner: PackCompartment, x: number, y: number, z: number) => {
      for (const k of owner.children) {
        const ks = samplers.get(k);
        const kc = input.compartments[k];
        if (ks && kc && ks.contains(x, y, z, -(it.radius + kc.thickness / 2))) return false;
      }
      return true;
    };
    const tryOnce = (): boolean => {
      switch (it.location) {
        case 'interior': {
          const x = rand.range(s.min[0], s.max[0]), y = rand.range(s.min[1], s.max[1]), z = rand.range(s.min[2], s.max[2]);
          if (!s.contains(x, y, z, it.radius + half) || !outsideChildren(comp, x, y, z)) return false;
          [p[0], p[1], p[2]] = [x, y, z];
          randomQuat(rand, q);
          return true;
        }
        case 'exterior': {
          const ps = parent;
          const pc = comp.parent ? input.compartments[comp.parent] : undefined;
          if (!ps || !pc) return false;
          const x = rand.range(ps.min[0], ps.max[0]), y = rand.range(ps.min[1], ps.max[1]), z = rand.range(ps.min[2], ps.max[2]);
          if (!ps.contains(x, y, z, it.radius + pc.thickness / 2) || !outsideChildren(pc, x, y, z)) return false;
          [p[0], p[1], p[2]] = [x, y, z];
          randomQuat(rand, q);
          return true;
        }
        default: {
          s.sampleSurface(rand, p, n);
          const d =
            it.location === 'membrane'
              ? (it.offset ?? 0)
              : it.location === 'outer-surface'
                ? half + it.radius + (it.offset ?? 0)
                : -(half + it.radius + (it.offset ?? 0));
          p[0] += n[0] * d;
          p[1] += n[1] * d;
          p[2] += n[2] * d;
          const sgn = it.inward ? -1 : 1;
          const [ax, ay, az] = it.axis ?? [0, 0, 1];
          const al = Math.hypot(ax, ay, az) || 1;
          quatFromTo(q, ax / al, ay / al, az / al, sgn * n[0], sgn * n[1], sgn * n[2], rand.next() * 2 * Math.PI);
          return true;
        }
      }
    };
    while (placed < it.requested && failures < input.giveUp) {
      let ok = false;
      for (let a = 0; a < input.attempts && !ok; a++) {
        if (!tryOnce()) continue;
        if (grid.overlaps(p[0], p[1], p[2], it.radius)) continue;
        ok = true;
      }
      if (!ok) {
        failures++;
        continue;
      }
      failures = 0;
      grid.insert(p[0], p[1], p[2], it.radius);
      b.push(t, p[0], p[1], p[2], q);
      placed++;
    }
    achieved[it.population] = placed;
    if (placed < it.requested) {
      const volume = it.location === 'interior' || it.location === 'exterior';
      const owner = it.location === 'exterior' ? comp.parent! : it.compartment;
      const room = volume ? input.compartments[owner]?.freeVolume : comp.area;
      const where = volume
        ? it.location === 'exterior' ? `the space around ${comp.label}` : `the inside of ${comp.label}`
        : `the ${it.location} of ${comp.label}`;
      const fill = room ? fillOf(b, typeTable, input.items, job, owner, volume, room) : undefined;
      reason(
        `${placed} of ${it.requested} fit in ${where}` +
          (fill !== undefined ? `, now ${Math.round(100 * fill)}% filled by the spheres of every copy in it` : '') +
          `; the packer stopped after ${input.giveUp} copies in a row found no free spot in ${input.attempts} tries each` +
          (volume ? ' (random sequential addition of equal spheres jams near 38%; more tries may place a few more)' : ''),
      );
    }
  }
  const set: PlacementSet = b.finish({ key, model, frame: 'world', typeTable });
  return { sets: [set], achieved, shortfall, report: { tries: input.attempts, giveUp: input.giveUp } };
}

/** The share of a compartment's room (volume or area) taken by the spheres placed in it so far, obstacles included. */
function fillOf(
  b: PlacementBuilder,
  typeTable: readonly PlacementType[],
  items: readonly PackItem[],
  job: ResolveJob,
  owner: Id,
  volume: boolean,
  room: number,
): number {
  const size = (r: number) => (volume ? (4 / 3) * Math.PI * r ** 3 : Math.PI * r * r);
  let used = 0;
  items.forEach((it, t) => {
    const inIt = volume
      ? (it.location === 'interior' && it.compartment === owner) || (it.location === 'exterior' && job.compartments.get(it.compartment)?.parent === owner)
      : it.compartment === owner && it.location !== 'interior' && it.location !== 'exterior';
    if (inIt) used += b.countOf(t) * size(typeTable[t].radius);
  });
  if (volume)
    for (const o of job.obstacles)
      for (let i = 0; i < o.count; i++) {
        const t = o.typeTable[o.types[i]];
        if (t.compartment === owner) used += size(t.radius);
      }
  return used / room;
}
