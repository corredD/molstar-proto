/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Box, Id, TileEntry, TileManifest } from '../format/doc.js';
import { type Issue, issue } from '../format/issues.js';
import { type IR, type IRNode } from '../ir/ir.js';
import type { PlacementSet, PlacementType } from '../ir/placements.js';

// Streaming (design.md §6.8): the viewer shows every tile coarse (level 0, from the manifest) and loads copies (level 1)
// around the focus within a budget. Outside `compile`: the session splices loaded tiles into the stream node as
// `placements` children, so `planCommit` and the adapters see ordinary sets. Imports nothing of Mol*.

type StreamNode = Extract<IRNode, { kind: 'stream' }>;

export interface TileProvider {
  /** The manifest; the provider memoizes it (compile asks on every model edit). Rejects: `stream.manifest`. */
  manifest(signal?: AbortSignal): Promise<TileManifest>;
  /**
   * A tile's copies at `level` (1 in v0.4). Rejects with an `AbortError` once `signal` aborts; a result that arrives
   * after the abort is ignored anyway. Any other rejection, an `AbortError` of the provider's own included (the
   * signal not aborted), and a throw before it returns a promise: `stream.tile`, and the tile is not asked for again until the stream
   * key changes.
   */
  load(tile: string, level: 1, signal: AbortSignal): Promise<TilePayload>;
}

/** A tile's copies, in the placement set's layout (design.md §4.2), world Å; the streamer adds the rest. */
export interface TilePayload {
  readonly count: number;
  /** x y z per copy. */
  readonly positions: Float32Array;
  /** x y z w per copy. */
  readonly rotations: Float32Array;
  /** Index into the manifest's `populations` (= the stream's type table) per copy. */
  readonly types: Int32Array;
}

/** A sphere in world Å: the camera's target and its focus radius (0 for a numeric camera). */
export interface StreamFocus {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface StreamState {
  /** Resident tiles and their copies. */
  readonly loaded: ReadonlyMap<string, number>;
  /** Tiles being loaded. */
  readonly pending: ReadonlySet<string>;
  /** Tiles that failed or were rejected: never planned again for this stream key. */
  readonly failed: ReadonlySet<string>;
}

export interface StreamBudget {
  /** Hard cap on resident level-1 copies plus copies in flight. */
  readonly copies: number;
  /** Å subtracted from a resident tile's distance (floored at 0), so a tile at the edge does not thrash. Default 0. */
  readonly hysteresis?: number;
}

export interface StreamPlan {
  /** The tiles wanted at level 1, nearest first: resident, pending and new. Their copies total at most the budget. */
  readonly want: readonly string[];
  /** To start loading, nearest first (want minus loaded, pending and failed). */
  readonly request: readonly string[];
  /** Resident tiles to drop now, farthest first. */
  readonly evict: readonly string[];
  /** Pending loads to abort. */
  readonly cancel: readonly string[];
  /** The tiles the focus sphere touches (distance ≤ radius). */
  readonly focus: readonly string[];
  /** Tiles shown at level 0 only once the plan is done: every tile not in `want`, in id order. */
  readonly level0: readonly string[];
  /** Copies of `want`: resident once the requests arrive. */
  readonly copies: number;
  /** A tile that alone exceeds the budget, when one stopped the walk (reported as `stream.budget`). */
  readonly overBudget?: string;
}

const copiesOf = (t: TileEntry) => Object.values(t.counts).reduce((a, b) => a + b, 0);
// ids compare by UTF-16 code units, never by locale
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The distance from a point to a box (0 inside or on it). */
function boxDistance(p: readonly number[], b: Box): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(b.min[k] - p[k], 0, p[k] - b.max[k]);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * The tiles to hold at level 1: nearest to the focus first, as many as the budget allows, never skipping ahead to a
 * smaller tile once one does not fit (the loaded region stays one shell). Pure: the output depends on the arguments,
 * never on the order of `manifest.tiles`.
 */
export function planStream(
  manifest: TileManifest,
  focus: StreamFocus,
  state: StreamState,
  budget: StreamBudget,
): StreamPlan {
  const hysteresis = budget.hysteresis ?? 0;
  const tiles = new Map<string, { t: TileEntry; d: number; dr: number }>();
  for (const t of manifest.tiles) {
    const d = boxDistance(focus.center, t.box);
    tiles.set(t.id, { t, d, dr: state.loaded.has(t.id) ? Math.max(0, d - hysteresis) : d });
  }
  // the tiles the focus touches come first, so hysteresis never lets a resident tile push one out
  const touched = (x: { d: number }) => (x.d <= focus.radius ? 0 : 1);
  const order = [...tiles.values()]
    .filter((x) => !state.failed.has(x.t.id))
    .sort((a, b) => touched(a) - touched(b) || a.dr - b.dr || byId(a.t.id, b.t.id));
  const want: string[] = [];
  let copies = 0;
  let overBudget: string | undefined;
  for (const { t } of order) {
    const c = copiesOf(t);
    if (copies + c > budget.copies) {
      // a budget of 0 is a deliberate level-0-only scene, not an oversized tile
      if (c > budget.copies && budget.copies > 0) overBudget = t.id;
      break;
    }
    copies += c;
    want.push(t.id);
  }
  const wanted = new Set(want);
  const far = (a: string, b: string) => tiles.get(b)!.d - tiles.get(a)!.d || byId(b, a);
  return {
    want,
    // an empty tile has nothing to load
    request: want.filter((id) => !state.loaded.has(id) && !state.pending.has(id) && copiesOf(tiles.get(id)!.t) > 0),
    evict: [...state.loaded.keys()].filter((id) => !wanted.has(id) && tiles.has(id)).sort(far),
    cancel: [...state.pending].filter((id) => !wanted.has(id) && tiles.has(id)).sort(far),
    focus: [...tiles.values()]
      .filter((x) => x.d <= focus.radius)
      .sort((a, b) => a.d - b.d || byId(a.t.id, b.t.id))
      .map((x) => x.t.id),
    level0: [...tiles.keys()].filter((id) => !wanted.has(id)).sort(byId),
    copies,
    ...(overBudget ? { overBudget } : {}),
  };
}

/** The stream node of an IR (v0.4: at most one). */
export function streamNode(ir: IR): StreamNode | undefined {
  const find = (n: IRNode): StreamNode | undefined => {
    if (n.kind === 'stream') return n;
    for (const c of n.children ?? []) {
      const f = find(c);
      if (f) return f;
    }
    return undefined;
  };
  return find(ir.root);
}

/** The IR with the nodes `f` rewrites replaced; every other node keeps its object, the view is unchanged. */
function rewrite(ir: IR, f: (n: StreamNode) => IRNode): IR {
  const go = (n: IRNode): IRNode => {
    if (n.kind === 'stream') return f(n);
    const kids = n.children?.map(go);
    return kids?.some((k, i) => k !== n.children![i]) ? ({ ...n, children: kids } as IRNode) : n;
  };
  const root = go(ir.root);
  return root === ir.root ? ir : { root, view: ir.view };
}

/**
 * The IR with `sets` (by tile id) as the stream node's `placements` children (refs `<model>/stream/<tileId>`), in
 * manifest order. Every other node keeps its object; the view is unchanged (call `updateView` after).
 */
export function withTiles(ir: IR, sets: ReadonlyMap<string, PlacementSet>): IR {
  return rewrite(ir, (n) => ({
    ...n,
    children: n.params.tiles.flatMap((t): IRNode[] => {
      const set = sets.get(t.id);
      return set
        ? [
            {
              ref: `${n.params.model}/stream/${t.id}`,
              kind: 'placements',
              params: { set },
              origin: n.params.types.map((x) => x.population),
            },
          ]
        : [];
    }),
  }));
}

// a tile's first global ordinal per type: the counts of the tiles before it in manifest order
const baseCache = new WeakMap<StreamNode, ReadonlyMap<string, readonly number[]>>();
function ordinalBases(node: StreamNode) {
  let b = baseCache.get(node);
  if (!b) {
    const run = node.params.types.map(() => 0);
    const m = new Map<string, readonly number[]>();
    for (const t of node.params.tiles) {
      m.set(t.id, [...run]);
      node.params.types.forEach((ty, i) => {
        run[i] += t.counts[ty.population] ?? 0;
      });
    }
    baseCache.set(node, (b = m));
  }
  return b;
}

/** The tile's placement set from a checked payload: global ordinals, the stream's types, the key `<key>#<tile>`. */
export function tileSet(node: StreamNode, tile: TileEntry, p: TilePayload): PlacementSet {
  const next = [...(ordinalBases(node).get(tile.id) ?? node.params.types.map(() => 0))];
  const ordinals = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) ordinals[i] = next[p.types[i]]++;
  return {
    key: `${node.params.key}#${tile.id}`,
    model: node.params.model,
    frame: 'world',
    count: p.count,
    positions: p.positions,
    rotations: p.rotations,
    types: p.types,
    ordinals,
    typeTable: node.params.types,
  };
}

const level0Cache = new WeakMap<IRNode, IRNode>();

/**
 * The IR as the camera reads it: each stream node's tiles replaced by one proxy set (key `<key>#level0`) with one copy
 * per (population, tile) with a count > 0, population-major, at the envelope's centre, identity rotation, and its own type whose radius
 * is the envelope's half-diagonal (population, entity and compartment as the stream's type).
 */
export function level0IR(ir: IR): IR {
  let root = level0Cache.get(ir.root);
  if (!root) {
    root = rewrite(ir, (n) => {
      const typeTable: PlacementType[] = [];
      const pos: number[] = [];
      // population by population, so a selection of a population is one run (`byTypes` unions run after run)
      for (const ty of n.params.types)
        for (const t of n.params.tiles) {
          if (!(t.counts[ty.population] > 0)) continue;
          const e = t.envelopes?.[ty.population] ?? t.box;
          for (let k = 0; k < 3; k++) pos.push((e.min[k] + e.max[k]) / 2);
          typeTable.push({
            ...ty,
            index: typeTable.length,
            radius: Math.hypot(e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]) / 2,
          });
        }
      const count = typeTable.length;
      const set: PlacementSet = {
        key: `${n.params.key}#level0`,
        model: n.params.model,
        frame: 'world',
        count,
        positions: new Float32Array(pos),
        rotations: Float32Array.from({ length: 4 * count }, (_, i) => (i % 4 === 3 ? 1 : 0)),
        types: Int32Array.from({ length: count }, (_, i) => i),
        ordinals: Int32Array.from({ length: count }, (_, i) => i),
        typeTable,
      };
      return {
        ...n,
        children: [{ ref: `${n.params.model}/stream/level0`, kind: 'placements', params: { set } }],
      };
    }).root;
    level0Cache.set(ir.root, root);
  }
  return root === ir.root ? ir : { root, view: ir.view };
}

export interface StreamOptions {
  readonly budget: StreamBudget;
  /** Default 4. */
  readonly maxInFlight?: number;
}

export interface StreamStats {
  readonly tiles: number;
  /** Resident now. */
  readonly resident: number;
  readonly inFlight: number;
  /** Cumulative since the stream key last changed; `requested` counts loads started (not plan entries). */
  readonly requested: number;
  readonly loaded: number;
  readonly evicted: number;
  readonly cancelled: number;
  readonly failed: number;
  /** Resident level-1 copies, the budget, and the copies level 0 stands for. */
  readonly copies: number;
  readonly budget: number;
  readonly level0Copies: number;
}

const isAbort = (e: unknown) => (e as { name?: string } | undefined)?.name === 'AbortError';

/** Why a payload does not match its tile, or undefined when it does. */
function payloadProblem(node: StreamNode, tile: TileEntry, p: TilePayload): string | undefined {
  const n = p?.count;
  if (!Number.isInteger(n) || n < 0) return `count ${n} is not a count`;
  if (p.positions?.length !== 3 * n || p.rotations?.length !== 4 * n || p.types?.length !== n)
    return `buffers do not match its ${n} copies`;
  const per = node.params.types.map(() => 0);
  for (let i = 0; i < n; i++) {
    if (!(p.types[i] >= 0 && p.types[i] < per.length)) return `copy ${i} has type ${p.types[i]}, out of range`;
    per[p.types[i]]++;
  }
  const off = node.params.types.findIndex((ty, i) => per[i] !== (tile.counts[ty.population] ?? 0));
  return off < 0
    ? undefined
    : `${per[off]} copies of ${node.params.types[off].population}, its manifest says ${tile.counts[node.params.types[off].population] ?? 0}`;
}

/**
 * Holds the stream's state between steps and calls the provider: residency (a tile is loaded exactly when its set is
 * in the IR), loads in flight, failures, counters. The session calls `step` on every edit and every settled load.
 */
export class TileStreamer {
  private key: string | undefined;
  private gen = 0;
  private tileCount = 0;
  private level0 = 0;
  private readonly resident = new Map<string, PlacementSet>();
  /** Loaded and checked, not yet taken into the IR by a step. */
  private readonly arrived = new Map<string, PlacementSet>();
  private readonly pending = new Map<string, AbortController>();
  private readonly failed = new Set<string>();
  private readonly told = new Set<string>();
  /** Raised since the last step, to report once. */
  private fresh: Issue[] = [];
  /** Standing for this stream key: the failed tiles' warnings, and the over-budget tile's while there is one. */
  private failures: Issue[] = [];
  private overBudget: Issue | undefined;
  private count = { requested: 0, loaded: 0, evicted: 0, cancelled: 0, failed: 0 };
  private budget: StreamBudget;
  private disposed = false;

  constructor(
    private readonly tiles: (resource: Id) => TileProvider | undefined,
    private readonly options: StreamOptions,
    /** Called when a load settles; the session queues one stream step (coalesced). */
    private readonly onSettled: () => void,
  ) {
    this.budget = options.budget;
  }

  /** The copy budget of the next steps (a viewer's slider); resident tiles beyond it leave on the next step. */
  setBudget(copies: number) {
    this.budget = { ...this.budget, copies };
  }

  /**
   * One step over a freshly compiled or view-updated IR. It takes in the arrivals still wanted, plans from
   * `ir.view.camera` (center = target, radius = focus radius or 0; no camera: the bounds' centre, radius 0), aborts
   * `cancel`, drops `evict`, starts `request` up to `maxInFlight`, and returns the IR with the resident tiles spliced
   * in (`withTiles`), the plan and issues (`stream.tile`, `stream.budget`; phase `load`). A changed stream key (or no
   * stream node) aborts everything and drops every resident tile first.
   */
  step(ir: IR): { readonly ir: IR; readonly plan?: StreamPlan; readonly issues: readonly Issue[] } {
    const node = streamNode(ir);
    if (node?.params.key !== this.key) this.reset(node?.params.key);
    const issues = this.fresh.splice(0);
    if (!node || this.disposed) return { ir, issues };
    const { bounds, tiles } = node.params;
    this.tileCount = tiles.length;
    this.level0 = tiles.reduce((a, t) => a + copiesOf(t), 0);
    const manifest: TileManifest = {
      format: 'meso-tiles',
      levels: node.params.levels,
      bounds,
      populations: node.params.types.map((t) => t.population),
      tiles,
    };
    const cam = ir.view.camera;
    const focus: StreamFocus = cam
      ? { center: cam.target as [number, number, number], radius: cam.focus?.radius ?? 0 }
      : { center: bounds.min.map((x, k) => (x + bounds.max[k]) / 2) as [number, number, number], radius: 0 };
    const sizes = (m: ReadonlyMap<string, PlacementSet>) => new Map([...m].map(([id, s]) => [id, s.count]));
    const plan = planStream(
      manifest,
      focus,
      {
        loaded: sizes(new Map([...this.resident, ...this.arrived])),
        pending: new Set(this.pending.keys()),
        failed: this.failed,
      },
      this.budget,
    );
    for (const id of plan.cancel) {
      this.pending.get(id)?.abort();
      this.pending.delete(id);
      this.count.cancelled++;
    }
    for (const id of plan.evict) {
      if (this.resident.delete(id)) this.count.evicted++;
      else if (this.arrived.delete(id)) this.count.cancelled++;
    }
    for (const [id, s] of this.arrived) {
      this.resident.set(id, s);
      this.count.loaded++;
    }
    this.arrived.clear();
    const over = plan.overBudget
      ? issue(
          'stream.budget',
          'warning',
          'load',
          `${node.params.model}: tile ${plan.overBudget} alone has more copies than the budget (${this.budget.copies}); it stays at level 0`,
          { ids: [node.params.model] },
        )
      : undefined;
    this.overBudget = over;
    if (over && !this.told.has(plan.overBudget!)) {
      this.told.add(plan.overBudget!);
      issues.push(over);
    }
    const provider = this.tiles(node.params.resource);
    const byTile = new Map(tiles.map((t) => [t.id, t]));
    for (const id of plan.request) {
      if (!provider || this.pending.size >= (this.options.maxInFlight ?? 4)) break;
      this.load(node, byTile.get(id)!, provider);
    }
    return { ir: withTiles(ir, this.resident), plan, issues };
  }

  /**
   * Every issue standing for the current stream key: a failed tile's `stream.tile` (until the key changes) and the
   * `stream.budget` of a tile that is over the budget now. `step` returns only the new ones; a session that replaces
   * its issues on each step reads these.
   */
  issues(): readonly Issue[] {
    return this.overBudget ? [...this.failures, this.overBudget] : [...this.failures];
  }

  /**
   * The viewer did not take the last step's IR: `drawn` is the IR it still shows (none: nothing). The resident tiles
   * become the ones `drawn` holds; a tile the step took in that is not drawn waits as an arrival, taken in again by
   * the next step (so `stats().resident` never counts a tile the viewer does not show). The counters keep what the
   * steps did.
   */
  restore(drawn: IR | undefined) {
    const node = drawn && streamNode(drawn);
    if (node?.params.key !== this.key) this.reset(node?.params.key);
    if (!node) return;
    const prefix = `${node.params.model}/stream/`;
    const shown = new Map<string, PlacementSet>();
    for (const c of node.children ?? [])
      if (c.kind === 'placements' && c.ref.startsWith(prefix)) shown.set(c.ref.slice(prefix.length), c.params.set);
    for (const [id, set] of this.resident) if (!shown.has(id)) this.arrived.set(id, set);
    this.resident.clear();
    for (const [id, set] of shown) this.resident.set(id, set);
  }

  stats(): StreamStats {
    let copies = 0;
    for (const s of this.resident.values()) copies += s.count;
    return {
      tiles: this.tileCount,
      resident: this.resident.size,
      inFlight: this.pending.size,
      ...this.count,
      copies,
      budget: this.budget.copies,
      level0Copies: this.level0,
    };
  }

  dispose() {
    this.disposed = true;
    this.reset(undefined);
  }

  /** A changed stream key: everything in flight aborted, every tile dropped, the issues and counters from zero. */
  private reset(key: string | undefined) {
    for (const c of this.pending.values()) c.abort();
    this.pending.clear();
    this.resident.clear();
    this.arrived.clear();
    this.failed.clear();
    this.told.clear();
    this.fresh.length = 0;
    this.failures.length = 0;
    this.overBudget = undefined;
    this.count = { requested: 0, loaded: 0, evicted: 0, cancelled: 0, failed: 0 };
    this.key = key;
    this.gen++;
  }

  private load(node: StreamNode, tile: TileEntry, provider: TileProvider) {
    const ctl = new AbortController();
    const [key, gen] = [this.key, this.gen];
    this.pending.set(tile.id, ctl);
    this.count.requested++;
    const stale = () => key !== this.key || gen !== this.gen || this.pending.get(tile.id) !== ctl;
    const fail = (why: string) => {
      this.failed.add(tile.id);
      this.count.failed++;
      const i = issue('stream.tile', 'warning', 'load', `${node.params.model}: tile ${tile.id}: ${why}`, {
        ids: [node.params.model],
      });
      this.fresh.push(i);
      this.failures.push(i);
    };
    // a provider that throws before it returns a promise fails the tile like one that rejects
    let loading: Promise<TilePayload>;
    try {
      loading = Promise.resolve(provider.load(tile.id, 1, ctl.signal));
    } catch (e) {
      loading = Promise.reject(e);
    }
    // a result of another key or generation, or of a load the plan cancelled, is dropped and tells no one
    loading
      .then(
        (p) => {
          if (stale()) return false;
          this.pending.delete(tile.id);
          const bad = payloadProblem(node, tile, p);
          if (bad) fail(`rejected (${bad})`);
          else this.arrived.set(tile.id, tileSet(node, tile, p));
          return true;
        },
        (e) => {
          // an abort is the streamer's own only when it aborted this load; any other rejection is the tile's failure
          if (stale() || (isAbort(e) && ctl.signal.aborted)) return false;
          this.pending.delete(tile.id);
          fail(`failed to load (${(e as Error)?.message ?? e})`);
          return true;
        },
      )
      .then((settled) => {
        if (settled && !this.disposed) this.onSettled();
      });
  }
}
