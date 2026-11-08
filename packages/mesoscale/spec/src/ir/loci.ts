/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { MesoViewSpecDoc } from '../format/doc.js';
import { type Issue, issue } from '../format/issues.js';
import type { QExpr } from '../format/mesoql.js';
import { LengthToAngstrom } from '../format/units.js';
import { type IR, placementSets } from './ir.js';
import type { PlacementSet } from './placements.js';

// MesoLocation and MesoLoci (design.md §3.8): what a MesoQL address materializes to, as Mol*'s Location and Loci
// materialize a MolQL selection. A MesoLocation is one copy, `{set, index}` (its stable id `<population>#<ordinal>`).
// MesoLoci are many: per placement set, sorted disjoint runs `[start, end)` of copy indices. Runs, not one entry per
// copy: every resolver writes a population's copies contiguously, so "the copies of p.lipids" is one run however many
// lipids there are (renderer-recommendations.md R1 asks the renderer for the same).

export interface MesoLocation {
  readonly set: string;
  readonly index: number;
}

/** Set key → runs `[s0, e0, s1, e1, …]`, sorted, disjoint, half-open. */
export type MesoLoci = ReadonlyMap<string, readonly number[]>;

export const EmptyLoci: MesoLoci = new Map();

// ---- runs ----

export function unionRuns(a: readonly number[], b: readonly number[]): number[] {
  const all: [number, number][] = [];
  for (let i = 0; i < a.length; i += 2) all.push([a[i], a[i + 1]]);
  for (let i = 0; i < b.length; i += 2) all.push([b[i], b[i + 1]]);
  all.sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (const [s, e] of all) {
    if (out.length && s <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], e);
    else out.push(s, e);
  }
  return out;
}

export function intersectRuns(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i], b[j]);
    const e = Math.min(a[i + 1], b[j + 1]);
    if (s < e) out.push(s, e);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

export function subtractRuns(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < a.length; i += 2) {
    let s = a[i];
    const e = a[i + 1];
    while (j < b.length && b[j + 1] <= s) j += 2;
    let k = j;
    while (k < b.length && b[k] < e) {
      if (b[k] > s) out.push(s, b[k]);
      s = Math.max(s, b[k + 1]);
      k += 2;
    }
    if (s < e) out.push(s, e);
  }
  return out;
}

export const runsSize = (r: readonly number[]) => {
  let n = 0;
  for (let i = 0; i < r.length; i += 2) n += r[i + 1] - r[i];
  return n;
};

export function lociSize(l: MesoLoci): number {
  let n = 0;
  for (const r of l.values()) n += runsSize(r);
  return n;
}

function combine(
  a: MesoLoci,
  b: MesoLoci,
  op: (x: readonly number[], y: readonly number[]) => number[],
  keepA: boolean,
): MesoLoci {
  const out = new Map<string, number[]>();
  const keys = new Set([...a.keys(), ...(keepA ? [] : b.keys())]);
  for (const k of keys) {
    const r = op(a.get(k) ?? [], b.get(k) ?? []);
    if (r.length) out.set(k, r);
  }
  return out;
}

// ---- per-set type runs (cached) ----

const typeRunCache = new WeakMap<PlacementSet, readonly number[][]>();

/** For each type of a set, the runs of its copies (one run when the resolver wrote them contiguously). */
export function typeRuns(set: PlacementSet): readonly number[][] {
  let cached = typeRunCache.get(set);
  if (cached) return cached;
  const runs: number[][] = set.typeTable.map(() => []);
  const t = set.types;
  for (let i = 0; i < set.count; ) {
    const ty = t[i];
    let j = i + 1;
    while (j < set.count && t[j] === ty) j++;
    runs[ty].push(i, j);
    i = j;
  }
  cached = runs;
  typeRunCache.set(set, cached);
  return cached;
}

// ---- evaluation ----

export interface LociContext {
  readonly doc: MesoViewSpecDoc;
  readonly ir: IR;
}

/** Materializes a selection. Never throws; what cannot be materialized here is an issue. */
export function evaluateMesoQL(e: QExpr, ctx: LociContext): { loci: MesoLoci; issues: Issue[] } {
  const issues: Issue[] = [];
  const sets = placementSets(ctx.ir);
  const unit = LengthToAngstrom[ctx.doc.units?.length ?? 'nm'];
  const pops = new Map(ctx.doc.populations.map((p) => [p.id, p]));
  const children = new Map<string, string[]>();
  for (const c of ctx.doc.compartments) if (c.parent) children.set(c.parent, [...(children.get(c.parent) ?? []), c.id]);
  const byTypes = (test: (t: PlacementSet['typeTable'][number]) => boolean): MesoLoci => {
    const out = new Map<string, number[]>();
    for (const s of sets) {
      const tr = typeRuns(s);
      let r: number[] = [];
      for (const t of s.typeTable) if (test(t)) r = unionRuns(r, tr[t.index]);
      if (r.length) out.set(s.key, r);
    }
    return out;
  };
  const ev = (x: QExpr): MesoLoci => {
    const ids = x.args.filter((a): a is string => typeof a === 'string');
    switch (x.symbol.name) {
      case 'all':
        return new Map(sets.filter((s) => s.count).map((s) => [s.key, [0, s.count]]));
      case 'population':
        return byTypes((t) => ids.includes(t.population));
      case 'entity':
        return byTypes((t) => ids.includes(t.entity));
      case 'in': {
        const nested = x.keywords.nested !== false;
        const within = new Set<string>();
        const add = (id: string) => {
          within.add(id);
          if (nested) for (const k of children.get(id) ?? []) add(k);
        };
        ids.forEach(add);
        const loc = x.keywords.location as string | undefined;
        return byTypes((t) => within.has(t.compartment) && (!loc || pops.get(t.population)?.location === loc));
      }
      case 'model':
        return new Map(sets.filter((s) => ids.includes(s.model) && s.count).map((s) => [s.key, [0, s.count]]));
      case 'copies': {
        const [pop, start, count] = x.args as [string, number, number?];
        const lo = start;
        const hi = start + (count ?? 1);
        const out = new Map<string, number[]>();
        for (const s of sets) {
          const ty = s.typeTable.find((t) => t.population === pop);
          if (!ty) continue;
          const tr = typeRuns(s)[ty.index];
          const r: number[] = [];
          for (let k = 0; k < tr.length; k += 2)
            for (let i = tr[k]; i < tr[k + 1]; i++) {
              const o = s.ordinals[i];
              if (o >= lo && o < hi) {
                if (r.length && r[r.length - 1] === i) r[r.length - 1] = i + 1;
                else r.push(i, i + 1);
              }
            }
          if (r.length) out.set(s.key, r);
        }
        if (!out.size)
          issues.push(
            issue('mesoql.empty', 'warning', 'resolve', `(copies ${pop} ${start}) selects nothing in this resolution`),
          );
        return out;
      }
      case 'and':
        return (x.args as QExpr[]).map(ev).reduce((a, b) => combine(a, b, intersectRuns, true));
      case 'or':
        return (x.args as QExpr[]).map(ev).reduce((a, b) => combine(a, b, unionRuns, false));
      case 'not': {
        const universe = x.keywords.in
          ? ev(x.keywords.in as QExpr)
          : ev({ symbol: { name: 'all' } as QExpr['symbol'], args: [], keywords: {} });
        return combine(universe, ev(x.args[0] as QExpr), subtractRuns, true);
      }
      case 'within': {
        const of = x.keywords.of ? ev(x.keywords.of as QExpr) : EmptyLoci;
        const d = Number(x.keywords.distance ?? 0) * unit;
        return within(sets, ev(x.args[0] as QExpr), of, d);
      }
      case 'part':
        issues.push(
          issue('mesoql.unsupported', 'warning', 'resolve', '(part …) needs superstructure instances in the IR'),
        );
        return EmptyLoci;
      default:
        issues.push(issue('mesoql.type', 'error', 'resolve', `(${x.symbol.name} …) is not a selection`));
        return EmptyLoci;
    }
  };
  return { loci: ev(e), issues };
}

/** Copies of `a` whose centre is within `d` Å of a copy of `b`: a hash grid over `b`, O(|a| + |b|). */
function within(sets: readonly PlacementSet[], a: MesoLoci, b: MesoLoci, d: number): MesoLoci {
  const byKey = new Map(sets.map((s) => [s.key, s]));
  const cell = Math.max(d, 1);
  const grid = new Map<string, number[]>();
  for (const [k, r] of b) {
    const s = byKey.get(k)!;
    for (let j = 0; j < r.length; j += 2)
      for (let i = r[j]; i < r[j + 1]; i++) {
        const x = s.positions[3 * i],
          y = s.positions[3 * i + 1],
          z = s.positions[3 * i + 2];
        const g = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
        const l = grid.get(g);
        if (l) l.push(x, y, z);
        else grid.set(g, [x, y, z]);
      }
  }
  const out = new Map<string, number[]>();
  for (const [k, r] of a) {
    const s = byKey.get(k)!;
    const res: number[] = [];
    for (let j = 0; j < r.length; j += 2)
      for (let i = r[j]; i < r[j + 1]; i++) {
        const x = s.positions[3 * i],
          y = s.positions[3 * i + 1],
          z = s.positions[3 * i + 2];
        const cx = Math.floor(x / cell),
          cy = Math.floor(y / cell),
          cz = Math.floor(z / cell);
        let hit = false;
        for (let u = -1; u <= 1 && !hit; u++)
          for (let v = -1; v <= 1 && !hit; v++)
            for (let w = -1; w <= 1 && !hit; w++) {
              const l = grid.get(`${cx + u},${cy + v},${cz + w}`);
              if (!l) continue;
              for (let q = 0; q < l.length; q += 3)
                if ((l[q] - x) ** 2 + (l[q + 1] - y) ** 2 + (l[q + 2] - z) ** 2 <= d * d) {
                  hit = true;
                  break;
                }
            }
        if (hit) {
          if (res.length && res[res.length - 1] === i) res[res.length - 1] = i + 1;
          else res.push(i, i + 1);
        }
      }
    if (res.length) out.set(k, res);
  }
  return out;
}

/** Stable ids of the copies (`<population>#<ordinal>`), the first `limit`. */
export function lociToIds(l: MesoLoci, ir: IR, limit = 50): string[] {
  const byKey = new Map(placementSets(ir).map((s) => [s.key, s]));
  const out: string[] = [];
  for (const [k, r] of l) {
    const s = byKey.get(k);
    if (!s) continue;
    for (let j = 0; j < r.length && out.length < limit; j += 2)
      for (let i = r[j]; i < r[j + 1] && out.length < limit; i++)
        out.push(`${s.typeTable[s.types[i]].population}#${s.ordinals[i]}`);
  }
  return out;
}

/** The centroid of the selected copies (Å), for an annotation anchored on a selection. */
export function lociCentroid(l: MesoLoci, ir: IR): [number, number, number] | undefined {
  const byKey = new Map(placementSets(ir).map((s) => [s.key, s]));
  let n = 0;
  const c = [0, 0, 0];
  for (const [k, r] of l) {
    const s = byKey.get(k);
    if (!s) continue;
    for (let j = 0; j < r.length; j += 2)
      for (let i = r[j]; i < r[j + 1]; i++) {
        c[0] += s.positions[3 * i];
        c[1] += s.positions[3 * i + 1];
        c[2] += s.positions[3 * i + 2];
        n++;
      }
  }
  return n ? [c[0] / n, c[1] / n, c[2] / n] : undefined;
}
