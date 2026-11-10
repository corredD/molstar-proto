/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { StateSelection } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import {
  type IR,
  type IRLook,
  type MesoLoci,
  type PlacementSet,
  type PlacementType,
  placementSets,
} from '@molstar/meso-spec/ir';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { type Issue, issue } from '@molstar/meso-spec/format';
import {
  type CommitPlan,
  type CommitReport,
  type ExpansionCache,
  flattenInstances,
  planCommit,
  type RendererAdapter,
} from '@molstar/meso-spec/runtime';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
// the `particles` API area's types (the feature is lazy: `extensions.load('particles')` before its first use)
import type {} from '@molstar/prism-viewer/features/particles';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import type { PluginContext } from '@molstar/plugin/context';
import {
  type ParticleLayerProps,
  ParticleRepresentation3DLayers,
} from '@molstar/plugin/state/transforms/particles/layers';
import { ParticlesRepresentation3D } from '@molstar/plugin/state/transforms/particles/representation';
import { streamNode } from '@molstar/meso-spec/runtime';
import { isMissingList, MesoPlacements, MesoTilePlacements, placementStore, toParticleList } from './particle-list.js';

// The Prism adapter (design.md §6.5): the IR into a Prism viewer through its operations, as prism-me's rules ask (one
// representation per list, looks as layers through `particles.look`, never a representation per type). Per commit, by
// key (`planCommit`): new sets become lists with a spacefill representation, gone sets are deleted, kept sets are not
// touched; looks are written when they changed, one `particles.look` per list. Prism's undo journals the
// representation and look calls but not the list create and delete, so an undo can strip a kept list's representation
// (or the list): each commit checks the kept lists and draws again what is missing, and rewrites the looks then.
// Under a document's owner (prism.md §2.3, §7.3) a commit runs inside the operation's step: its API calls go through the
// step's `api` (`bind`), its tree writes are part of the run, it deletes no placements (the owner lets them go), and a
// restore is adopted from the restored tree (`adopt`) with nothing through the API. A re-pack's new list is drawn with
// the representation type and params of the list of the same model it replaces.
// A streamed tile's list (prism.md §9) is the behavior's, not the person's: it is made, drawn, given its looks and
// deleted through the state directly (`MesoTilePlacements`, registered behavior-owned by the owner), never through the
// API, in an edit's step as in a stream step, so tiles are no step and no change outside the API. A commit with no API
// bound (a stream step) touches only tile lists: a document list's repair and looks wait for the next edit's step.

const now = () => performance.now();

/** What the adapter needs of a viewer: its plugin, a lazy feature's load, and its API outside an owner's step. */
export interface AdapterViewer {
  readonly plugin: PrismViewer['plugin'];
  readonly extensions: { load(id: string): Promise<boolean> };
  readonly api?: ViewerApi;
}

interface Placed {
  readonly ref: string;
  readonly label: string;
  /** A streamed tile's list (`MesoTilePlacements`): drawn through the state, never the API. */
  readonly tile?: true;
}

/** The keys of an IR's streamed tile sets: the stream node's `placements` children. */
function tileKeysOf(ir: IR): Set<string> {
  const out = new Set<string>();
  for (const c of streamNode(ir)?.children ?? []) if (c.kind === 'placements') out.add(c.params.set.key);
  return out;
}

/** How a copy and a type are named on hover (the document's owner: an instance by its id, a type's entity and compartment). */
export interface AdapterLabels {
  /** A copy's id: `p.lipids#12`; an instance's: `i.granule-docked`. */
  copy(population: string, ordinal: number): string;
  /** A type's description under the copy's id (its entity, its compartment). */
  describe(type: PlacementType): string | undefined;
}

/** A copy as the document names it: its population (or instance) and its ordinal there. */
export interface CopyName {
  readonly population: string;
  readonly ordinal: number;
}

/**
 * An expanded list (`<instance set>|<type>*<template>`, `runtime/instancing.ts`): the instance set and type it expands,
 * the template it repeats (a set, or another expansion), the template's size, and the instances' copies by rank.
 */
interface Expansion {
  readonly outer: PlacementSet;
  readonly type: number;
  readonly template: string;
  readonly size: number;
  /** The outer set's copies of `type`, in order: the k-th instance is copy `copies[k]`. */
  readonly copies: Int32Array;
  /** Per copy of the outer set: its rank among the copies of `type`, else -1. */
  readonly rank: Int32Array;
}

/** A representation's type as a list of a model had it: what its re-packed list is drawn with. */
interface Drawn {
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export class PrismMesoAdapter implements RendererAdapter {
  readonly id = 'prism';
  private prev: IR | undefined;
  /** Expanded instance sets by key: kept across commits, so a view edit expands nothing again. */
  private readonly expansions: ExpansionCache = new Map();
  private placed = new Map<string, Placed>();
  /** Bounds of the drawn sets by key: what the camera's radius is taken from. */
  private readonly bounds = new Map<string, SetBounds>();
  /** The API calls go through: the step's while bound (an owner's operation), else the viewer's. */
  private api: ViewerApi | undefined;
  /** The labels drawn for the view's annotations, by annotation id: their state ref and what they say where. */
  private labels = new Map<string, { readonly ref: string; readonly key: string }>();
  /** What the annotations said at the last label pass (`annotationsKey`): an unbound commit saying the same skips it. */
  private annotationsSaid: string | undefined;
  /** The placement sets of this viewer, by key. */
  private get store() {
    return placementStore(this.viewer.plugin);
  }
  /** For tests and stories: the state objects of the lists, by set key. */
  listObject(key: string) {
    const p = this.placed.get(key);
    return p ? this.viewer.plugin.state.data.cells.get(p.ref)?.obj : undefined;
  }
  listRef(key: string) {
    return this.placed.get(key)?.ref;
  }
  /**
   * The keys of the document's sets drawn (the flattened IR's, expanded instances included; no streamed tile): what
   * the owner keeps placed for Undo. A tile's placements are let go by the adapter when its list goes.
   */
  keys(): readonly string[] {
    if (!this.prev) return [];
    return [...placementSetKeys(this.prev)].filter((k) => !this.drawnTiles.has(k));
  }

  /** The keys of the streamed tiles drawn: their placements are the adapter's to let go, not the owner's. */
  tileKeys(): ReadonlySet<string> {
    return this.drawnTiles;
  }
  /** The tile keys of the last IR drawn or adopted (its stream node's sets). */
  private drawnTiles: ReadonlySet<string> = new Set();

  /** Runs `work` with the API calls going through `api` (an operation's `ctx.api`: part of its step). */
  async bound<T>(api: ViewerApi, work: () => Promise<T>): Promise<T> {
    const before = this.api;
    this.api = api;
    try {
      return await work();
    } finally {
      this.api = before;
    }
  }

  constructor(
    readonly viewer: AdapterViewer,
    readonly options: {
      readonly representation?: string;
      readonly sizeFactor?: number;
      readonly labels?: AdapterLabels;
    } = {},
  ) {}

  /**
   * Lets go of the expansions and bounds of sets not drawn; an expansion a drawn one repeats (two levels of
   * superstructures: `W|0*K_out|0*K_in` repeats `K_out|0*K_in`) stays, so its copies are still named and lit.
   */
  private evict(drawn: ReadonlySet<string>) {
    const keep = new Set(drawn);
    for (const k of drawn) {
      for (let r = k; ; ) {
        const bar = r.indexOf('|');
        const star = bar < 0 ? -1 : r.indexOf('*', bar);
        if (star < 0) break;
        r = r.slice(star + 1);
        keep.add(r);
      }
    }
    for (const k of [...this.expansions.keys()]) if (!keep.has(k)) this.expansions.delete(k);
    for (const k of [...this.bounds.keys()]) if (!drawn.has(k)) this.bounds.delete(k);
  }

  /** The sets by key: the source's (templates included) and the expansions drawn. */
  private sets = new Map<string, PlacementSet>();
  private readonly expansionInfo = new Map<string, Expansion | null>();
  /** Bumped when what is drawn changes: a cache of loci by revision (the owner's) is let go. */
  revision = 0;

  /** The source IR and the expansions as drawn now: the index the names and loci read. */
  private index(source: IR) {
    this.sets = new Map(placementSets(source).map((x) => [x.key, x]));
    for (const [k, e] of this.expansions) this.sets.set(k, e);
    this.expansionInfo.clear();
    this.revision++;
  }

  /** An expanded list's instance set, type and template; null when the key is a set's own. */
  private expansion(key: string): Expansion | null {
    const known = this.expansionInfo.get(key);
    if (known !== undefined) return known;
    let out: Expansion | null = null;
    const bar = key.indexOf('|');
    const star = bar < 0 ? -1 : key.indexOf('*', bar);
    if (star > 0) {
      const outer = this.sets.get(key.slice(0, bar));
      const type = Number(key.slice(bar + 1, star));
      const template = key.slice(star + 1);
      const size = this.sets.get(template)?.count;
      if (outer && Number.isInteger(type) && size !== undefined) {
        const rank = new Int32Array(outer.count).fill(-1);
        const copies: number[] = [];
        for (let i = 0; i < outer.count; i++) if (outer.types[i] === type) rank[i] = copies.push(i) - 1;
        out = { outer, type, template, size, copies: Int32Array.from(copies), rank };
      }
    }
    this.expansionInfo.set(key, out);
    return out;
  }

  /**
   * A drawn copy as the document names it (prism.md §4.6): `[p.lipids#12]`; an expanded instance's copy, the instance
   * then the copy in its template (`[p.granules#12, p.Vamp2#305]`). Undefined for a key not drawn.
   */
  locate(key: string, index: number): CopyName[] | undefined {
    const set = this.sets.get(key);
    if (!set || index < 0 || index >= set.count) return undefined;
    const x = this.expansion(key);
    if (!x) {
      const t = set.typeTable[set.types[index]];
      return t && [{ population: t.population, ordinal: set.ordinals[index] }];
    }
    const k = Math.floor(index / x.size);
    const i = x.copies[k];
    const outer = x.outer.typeTable[x.type];
    const inner = this.locate(x.template, index - k * x.size);
    return outer && inner && [{ population: outer.population, ordinal: x.outer.ordinals[i] }, ...inner];
  }

  /**
   * MesoLoci over the source IR as runs of the drawn lists (by state ref): a set's own; a template set's in every
   * instance; an instance set's copies of an expanded type as their whole instances; one instance's (`part`'s virtual
   * `<instance set>@<i>><template>`) as its block of the expansion.
   */
  drawnRuns(loci: MesoLoci): Map<string, number[]> {
    const memo = new Map<string, number[]>();
    const out = new Map<string, number[]>();
    for (const [key, p] of this.placed) {
      const runs = this.runsOn(key, loci, memo);
      if (runs.length) out.set(p.ref, runs);
    }
    return out;
  }

  private runsOn(key: string, loci: MesoLoci, memo: Map<string, number[]>): number[] {
    const known = memo.get(key);
    if (known) return known;
    const x = this.expansion(key);
    if (!x) {
      const own = [...(loci.copies.get(key) ?? [])];
      memo.set(key, own);
      return own;
    }
    const pieces: number[] = [];
    const n = x.size;
    // whole instances picked: the instance set's copies of the type
    const outer = loci.copies.get(x.outer.key);
    if (outer)
      for (let j = 0; j < outer.length; j += 2)
        for (let i = outer[j]; i < outer[j + 1]; i++) {
          const k = x.rank[i];
          if (k >= 0) pieces.push(k * n, (k + 1) * n);
        }
    // the template's copies, in every instance
    const inner = this.runsOn(x.template, loci, memo);
    if (inner.length)
      for (let k = 0; k < x.copies.length; k++) for (let j = 0; j < inner.length; j++) pieces.push(inner[j] + k * n);
    // one instance's copies (a `part`)
    const prefix = `${x.outer.key}@`;
    const suffix = `>${x.template}`;
    for (const [k, runs] of loci.copies) {
      if (!k.startsWith(prefix) || !k.endsWith(suffix)) continue;
      const i = Number(k.slice(prefix.length, k.length - suffix.length));
      const rank = Number.isInteger(i) && i >= 0 && i < x.rank.length ? x.rank[i] : -1;
      if (rank >= 0) for (let j = 0; j < runs.length; j++) pieces.push(runs[j] + rank * n);
    }
    const merged = mergeRuns(pieces);
    memo.set(key, merged);
    return merged;
  }

  /** A list's copy labels and type descriptions, from `options.labels`. */
  private labelsOf(key: string) {
    const labels = this.options.labels;
    if (!labels) return undefined;
    return {
      copy: (i: number) =>
        this.locate(key, i)
          ?.map((c) => labels.copy(c.population, c.ordinal))
          .join('/') ?? '',
      describe: (t: PlacementType) => labels.describe(t),
    };
  }

  /**
   * A commit that threw: what it may have left on screen of its IR, which `prev` (not advanced) does not know. The next
   * commit writes the looks again, and the camera when the failed one had set it (a failed show drawn back, prism.md
   * §4.4).
   */
  private unsure: { readonly camera: boolean } | undefined;
  /** The commit in flight has set the camera. */
  private cameraMoved = false;

  async commit(source: IR): Promise<CommitReport> {
    this.cameraMoved = false;
    try {
      const report = await this.draw(source);
      this.unsure = undefined;
      return report;
    } catch (e) {
      this.unsure = { camera: this.cameraMoved || !!this.unsure?.camera };
      throw e;
    }
  }

  private async draw(source: IR): Promise<CommitReport> {
    const unsure = this.unsure;
    // superstructure instances expanded into world sets: Prism has no nested instancing (renderer-recommendations R7)
    const flat = flattenInstances(source, this.expansions);
    const ir = flat.ir;
    const keys = placementSetKeys(ir);
    this.evict(keys);
    const t0 = now();
    const plan = planCommit(this.prev, ir);
    const v = this.viewer;
    if (plan.add.length) await v.extensions.load('particles');
    const tiles = tileKeysOf(source);
    // a commit with no API to call (an owner's stream step: none bound, the owner's viewer has none) writes only tiles,
    // through the state (prism.md §9)
    const bound = !!(this.api ?? this.viewer.api);
    const store = this.store;

    // the representation of each model's removed list, for the list that replaces it (a re-pack keeps the person's
    // representation settings: prism.md §5.1)
    const drawn = new Map<string, Drawn>();
    if (plan.remove.length) {
      const b = v.plugin.state.data.build();
      const prevSets = new Map(this.prev ? placementSets(this.prev).map((x) => [x.key, x]) : []);
      for (const key of plan.remove) {
        const p = this.placed.get(key);
        if (p) {
          const model = prevSets.get(key)?.model;
          const type = model !== undefined && !p.tile ? this.representationType(p.ref) : undefined;
          if (model !== undefined && type && !drawn.has(model)) drawn.set(model, type);
          b.delete(p.ref);
        }
        // an evicted tile's placements go with its list: the streamer owns residency (streaming.md, "Ownership")
        if (p?.tile) store.delete(key);
        this.placed.delete(key);
      }
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
    }
    // kept lists that something outside the adapter (Prism's undo) stripped: drawn again, their looks rewritten; a
    // document list only inside a step (an unbound commit leaves it for the next edit's)
    const byKey = new Map(placementSets(ir).map((x) => [x.key, x]));
    const relist: PlacementSet[] = [];
    const redraw: PlacementSet[] = [];
    for (const key of plan.keep) {
      if (!bound && !tiles.has(key)) continue;
      const p = this.placed.get(key);
      const set = byKey.get(key)!;
      if (!p || !v.plugin.state.data.cells.get(p.ref)?.obj) {
        this.placed.delete(key);
        if (set.count) relist.push(set);
      } else if (!this.hasRepresentation(p.ref)) redraw.push(set);
    }
    // an empty set (a model whose input is missing) has nothing Prism can draw: no list (spacefill refuses it)
    const newTiles: PlacementSet[] = [];
    for (const set of [...plan.add.filter((x) => x.count > 0), ...relist]) {
      if (tiles.has(set.key)) {
        newTiles.push(set);
        continue;
      }
      const label = listLabel(set);
      if (!store.has(set.key)) store.set(set.key, toParticleList(set, label, this.labelsOf(set.key)));
      const b = v.plugin.state.data.build().toRoot().apply(MesoPlacements, { key: set.key, label });
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
      this.placed.set(set.key, { ref: b.ref, label });
      await this.represent(set, b.ref, label, drawn.get(set.model));
    }
    for (const set of redraw) {
      const p = this.placed.get(set.key)!;
      if (p.tile) newTiles.push(set);
      else await this.represent(set, p.ref, p.label);
    }
    await this.drawTiles(newTiles, plan.looks);
    const repaired = relist.length + redraw.length;
    const t1 = now();

    let looksWritten = 0;
    if (plan.looksChanged || repaired || unsure) {
      looksWritten = await this.writeTileLooks(plan.looks);
      if (bound) looksWritten += await this.writeLooks(plan.looks);
    }
    const t2 = now();

    const canvas = v.plugin.canvas3d;
    const cameraPlan = unsure?.camera ? { ...plan, cameraChanged: true } : plan;
    const cameraSet = canvas
      ? commitCamera(canvas, ir, cameraPlan, () => sceneRadius(placementSets(ir), this.bounds))
      : false;
    this.cameraMoved = cameraSet;
    const t3 = now();
    // representation hints: spheres drawn; structure and surface fall back to spheres here, said once per hint
    const issues: Issue[] = [];
    await this.drawAnnotations(ir, issues);
    if (ir.view.cutaway?.length)
      issues.push(
        issue(
          'view.cutaway',
          'info',
          'render',
          'the view asks to cut away some copies so its focus shows: Prism clips by planes, not by copies (not drawn)',
        ),
      );
    const partial = ir.view.looks.filter((l) => l.runs);
    if (partial.length)
      issues.push(
        issue(
          'look.partial',
          'warning',
          'render',
          `${partial.length} look${partial.length === 1 ? '' : 's'} on part of a population (${partial.reduce((n, l) => n + (l.runs!.length >> 1), 0)} copy runs) not drawn: Prism layers select whole targets only`,
        ),
      );
    for (const hint of ['structure', 'surface'] as const) {
      const n = ir.view.looks.filter((l) => l.representation === hint).length;
      if (n)
        issues.push(
          issue(
            'representation.fallback',
            'info',
            'render',
            `${n} type${n === 1 ? '' : 's'} ask to be drawn as ${hint}; the Prism adapter draws spheres`,
          ),
        );
    }
    if (repaired)
      issues.push(
        issue(
          'adapter.redrawn',
          'info',
          'render',
          `${repaired} list${repaired === 1 ? '' : 's'} drawn again: ${repaired === 1 ? 'its representation was' : 'their representations were'} removed outside the adapter (an undo)`,
        ),
      );
    if (flat.expandedCopies)
      issues.push(
        issue(
          'instances.expanded',
          'info',
          'render',
          `${flat.expandedCopies.toLocaleString('en-US')} copies expanded from superstructure instances (${(flat.expandedBytes / 2 ** 20).toFixed(1)} MB; the IR holds ${(flat.instancedBytes / 2 ** 10).toFixed(0)} kB for them): Prism has no nested instancing`,
        ),
      );
    this.prev = ir;
    this.drawnTiles = tiles;
    this.index(source);
    return {
      added: plan.add.map((s) => s.key),
      removed: plan.remove,
      kept: plan.keep,
      looksWritten,
      cameraSet,
      ...(flat.expandedCopies
        ? { expanded: { copies: flat.expandedCopies, bytes: flat.expandedBytes, instancedBytes: flat.instancedBytes } }
        : {}),
      issues,
      ms: { total: t3 - t0, sets: t1 - t0, looks: t2 - t1, camera: t3 - t2 },
    };
  }

  /**
   * The looks as layers of the drawn lists (all of them, or those of `refs`), one `particles.look`; the layers written.
   * A default color (`colorDefault`, prism.md §5.3) is left out of a list whose color theme the person chose (By zoom
   * on, or a theme other than its representation's default), so the theme shows; a stated color is always written.
   */
  private async writeLooks(looks: readonly IRLook[], refs?: ReadonlySet<string>): Promise<number> {
    const lists = [...this.placed]
      .filter(([, p]) => !p.tile && (!refs || refs.has(p.ref)))
      .map(([key, p]) => {
        const chosen = this.themeChosen(p.ref);
        return {
          particles: p.ref,
          layers: looks
            // a look on part of a type (copy runs) has no Prism layer selector (renderer-recommendations.md R8)
            .filter((l) => l.set === key && !l.runs)
            .map((l) => ({
              selector: { targets: [...l.types] },
              color: l.color !== undefined && !(l.colorDefault && chosen) ? Color(l.color) : null,
              visible: l.visible ?? true,
              transparency: l.transparency ?? null,
              emissive: l.emissive ?? null,
            })),
        };
      });
    if (lists.length) {
      const particles = this.particles();
      const r = await particles.look({ lists } as unknown as Parameters<typeof particles.look>[0]);
      if (!r.ok) throw new Error(`Looks: ${r.message}`);
    }
    return lists.reduce((s, l) => s + l.layers.length, 0);
  }

  /**
   * Streamed tiles' lists drawn through the state (prism.md §9), all in one update: each list (`MesoTilePlacements`),
   * its representation (the adapter's type, its defaults) and its looks' layers. A tile drawn again (its
   * representation stripped) replaces its list.
   */
  private async drawTiles(sets: readonly PlacementSet[], looks: readonly IRLook[]) {
    if (!sets.length) return;
    const { plugin } = this.viewer;
    const state = plugin.state.data;
    const store = this.store;
    const b = state.build();
    for (const set of sets) {
      const was = this.placed.get(set.key);
      if (was && state.cells.has(was.ref)) b.delete(was.ref);
      const label = listLabel(set);
      let list = store.get(set.key);
      if (!list) store.set(set.key, (list = toParticleList(set, label, this.labelsOf(set.key))));
      const cell = b.toRoot().apply(MesoTilePlacements, { key: set.key, label });
      const repr = cell.apply(ParticlesRepresentation3D, tileRepresentationParams(plugin, list, this.tileType()));
      const layers = tileLayers(looks, set.key, false);
      if (layers.length) repr.apply(ParticleRepresentation3DLayers, { layers, cuts: [], hidden: [] } as never);
      this.placed.set(set.key, { ref: cell.ref, label, tile: true });
    }
    await plugin.runTask(state.updateTree(b));
  }

  /** The representation type of a tile's list: the adapter's (spacefill). */
  private tileType() {
    return this.options.representation ?? 'spacefill';
  }

  /** The looks of the tiles' lists as their layers, written through the state where they differ; the layers written. */
  private async writeTileLooks(looks: readonly IRLook[]): Promise<number> {
    const state = this.viewer.plugin.state.data;
    const b = state.build();
    let written = 0;
    let changed = false;
    for (const [key, p] of this.placed) {
      if (!p.tile) continue;
      const layers = tileLayers(looks, key, this.themeChosen(p.ref));
      written += layers.length;
      const repr = state.select(
        StateSelection.Generators.byRef(p.ref).subtree().ofType(SO.Particle.Representation3D),
      )[0];
      if (!repr) continue;
      // the layers cell is the representation's child (`particleLookCell`)
      const looksRef = state.tree.children
        .get(repr.transform.ref)
        .toArray()
        .find((c) => state.tree.transforms.get(c)?.transformer === ParticleRepresentation3DLayers);
      const cell = looksRef !== undefined ? state.cells.get(looksRef) : undefined;
      const old = cell?.transform.params as { layers: readonly ParticleLayerProps[] } | undefined;
      if (old && sameLayers(old.layers, layers)) continue;
      if (!old && !layers.length) continue;
      changed = true;
      if (!cell)
        b.to(repr.transform.ref).apply(ParticleRepresentation3DLayers, { layers, cuts: [], hidden: [] } as never);
      else b.to(cell.transform.ref).update({ ...old, layers } as never);
    }
    if (changed) await this.viewer.plugin.runTask(state.updateTree(b));
    return written;
  }

  /**
   * The view's annotations as Prism labels (prism.md §5.2): one `stage.label` an annotation, through the step's API (so
   * part of its run), marked by its node (`md:#an:<id>`); the labels of annotations gone or changed (another view
   * shown, the view removed, its text edited) deleted. One that cannot be drawn is an issue, never a throw. An unbound
   * commit (a stream step's: tiles arriving, no run) whose annotations are those drawn last touches no label, so it
   * never runs `stage.label` as a top-level run of its own.
   */
  private async drawAnnotations(ir: IR, issues: Issue[]) {
    const state = this.viewer.plugin.state.data;
    const want = new Map<string, NonNullable<IR['view']['annotations']>[number]>();
    for (const a of ir.view.annotations ?? []) {
      if (a.position) want.set(a.id, a);
      else issues.push(issue('annotation.unplaced', 'info', 'render', `${a.id} names no copy here: not drawn`));
    }
    const said = annotationsKey(ir);
    if (!this.api && said === this.annotationsSaid) return;
    this.annotationsSaid = said;
    const b = state.build();
    let gone = false;
    for (const [id, l] of this.labels) {
      const a = want.get(id);
      if (a && annotationKey(a.text, a.position!) === l.key && state.cells.has(l.ref)) continue;
      if (state.cells.has(l.ref)) {
        b.delete(l.ref);
        gone = true;
      }
      this.labels.delete(id);
    }
    if (gone) await this.viewer.plugin.runTask(state.updateTree(b));
    const todo = [...want.values()].filter((a) => !this.labels.has(a.id));
    if (!todo.length) return;
    const api = this.api ?? this.viewer.api;
    // readable at the scene's scale: a 40th of its radius, at least Prism's 4 Å
    const size = Math.round(Math.max(4, sceneRadius(placementSets(ir), this.bounds) / 40));
    for (const a of todo) {
      const [x, y, z] = a.position!;
      const r = await api?.run('stage.label', { text: a.text, x, y, z, size, node: `${AnnotationNode}${a.id}` });
      const ref = r?.ok ? r.changed.nodes?.[0] : undefined;
      if (ref) this.labels.set(a.id, { ref, key: annotationKey(a.text, a.position!) });
      else
        issues.push(
          issue(
            'annotation.label',
            'warning',
            'render',
            `${a.id} is not drawn: ${r && !r.ok ? r.message : 'no labels here'}`,
          ),
        );
    }
  }

  /**
   * Draws the looks of some lists (by state ref) again, through `api` (the run's): their color theme changed, so their
   * default colors are written or left out again (prism.md §5.3).
   */
  async redrawLooks(api: ViewerApi, refs: readonly string[]): Promise<void> {
    if (!this.prev) return;
    const looks = this.prev.view.looks;
    await this.bound(api, () => this.writeLooks(looks, new Set(refs)));
  }

  /**
   * The drawn view's camera set again (a click on the view shown, prism.md §4.4), the person's moves undone; nothing
   * else drawn. False with no canvas or nothing drawn.
   */
  applyCamera(): boolean {
    const canvas = this.viewer.plugin.canvas3d;
    const ir = this.prev;
    if (!canvas || !ir) return false;
    return commitCamera(canvas, ir, { cameraChanged: true, keep: [] }, () =>
      sceneRadius(placementSets(ir), this.bounds),
    );
  }

  /** The set key a drawn list (by state ref) is of; undefined for a list this adapter did not make. */
  keyOf(ref: string): string | undefined {
    for (const [key, p] of this.placed) if (p.ref === ref) return key;
    return undefined;
  }

  /** A drawn set by key (an expansion's too): its types, for the owner's entities. */
  setOf(key: string): PlacementSet | undefined {
    return this.sets.get(key) ?? (this.prev ? placementSets(this.prev).find((s) => s.key === key) : undefined);
  }

  /** Whether the person chose the color theme of a list's representation: By zoom on, or not the type's default. */
  private themeChosen(ref: string): boolean {
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    const params = this.viewer.plugin.state.data.select(q)[0]?.transform.params as
      | {
          type?: { name: string; params?: { structure?: { colorLevels?: { name: string } } } };
          colorTheme?: { name: string };
        }
      | undefined;
    if (!params?.type) return false;
    if (params.type.params?.structure?.colorLevels?.name === 'on') return true;
    const provider = this.viewer.plugin.representation.particles.registry.get(params.type.name) as
      | { defaultColorTheme?: { name: string } }
      | undefined;
    const theme = params.colorTheme?.name;
    return !!theme && !!provider?.defaultColorTheme && theme !== provider.defaultColorTheme.name;
  }

  private async represent(set: PlacementSet, ref: string, label: string, was?: Drawn) {
    const particles = this.particles();
    const type = was?.name ?? this.options.representation ?? 'spacefill';
    const r = await particles.representation({
      type,
      particles: ref,
      // spacefill hides fiber particles by default (a Fibers representation draws them); here a filament's subunits are
      // the copies to draw (renderer-recommendations.md A8)
      params: was?.params ?? (set.fibers && type === 'spacefill' ? { excludeFibers: false } : {}),
    } as Parameters<typeof particles.representation>[0]);
    if (!r.ok) throw new Error(`Could not show ${label}: ${r.message}`);
  }

  /** The type and params of a list's first representation (the one the adapter made, as the person left it). */
  private representationType(ref: string): Drawn | undefined {
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    const params = this.viewer.plugin.state.data.select(q)[0]?.transform.params as
      | { type?: { name: string; params: Record<string, unknown> } }
      | undefined;
    return params?.type ? { name: params.type.name, params: params.type.params } : undefined;
  }

  /**
   * A restore (prism.md §7.3, point 5): the IR the owner compiled for the restored document taken as drawn, with nothing
   * through the API. The lists are found in the restored tree by their key; a key the store lacked (a session on a
   * fresh page) is filled and its list applied again through the state directly, which the history's restore covers.
   * A set with no list in the tree is left for the next commit's repair (inside that edit's step). Returns the keys
   * that were missing.
   */
  async adopt(source: IR): Promise<{ readonly filled: readonly string[] }> {
    const flat = flattenInstances(source, this.expansions);
    const ir = flat.ir;
    const keys = placementSetKeys(ir);
    this.evict(keys);
    const state = this.viewer.plugin.state.data;
    const store = this.store;
    const cells = new Map<string, { ref: string; label: string; list: ParticleList | undefined }>();
    for (const c of state.select(StateSelection.Generators.ofTransformer(MesoPlacements))) {
      const p = c.transform.params as { key: string; label: string };
      cells.set(p.key, { ref: c.transform.ref, label: p.label, list: c.obj?.data as ParticleList | undefined });
    }
    this.placed = new Map();
    const filled: string[] = [];
    const b = state.build();
    for (const set of placementSets(ir)) {
      const cell = cells.get(set.key);
      if (!cell) continue;
      this.placed.set(set.key, { ref: cell.ref, label: cell.label });
      if (store.has(set.key) && !(cell.list && isMissingList(cell.list))) continue;
      if (!store.has(set.key))
        store.set(set.key, toParticleList(set, cell.label || listLabel(set), this.labelsOf(set.key)));
      filled.push(set.key);
      b.to(cell.ref).update((old: { fill?: number }) => ({ ...old, fill: (old.fill ?? 0) + 1 }));
    }
    // the tiles' lists the restore kept (behavior-owned, prism.md §9): those of the IR's stream adopted, the others
    // (another stream key, or no document) deleted with their placements; a tile of the IR without a list is drawn by
    // the next commit's check
    const tiles = tileKeysOf(source);
    let tilesGone = false;
    for (const c of state.select(StateSelection.Generators.ofTransformer(MesoTilePlacements))) {
      const p = c.transform.params as { key: string; label: string };
      if (tiles.has(p.key) && store.has(p.key) && !this.placed.has(p.key)) {
        this.placed.set(p.key, { ref: c.transform.ref, label: p.label, tile: true });
        continue;
      }
      b.delete(c.transform.ref);
      if (!tiles.has(p.key)) store.delete(p.key);
      tilesGone = true;
    }
    if (filled.length || tilesGone) await this.viewer.plugin.runTask(state.updateTree(b));
    this.drawnTiles = tiles;
    // the annotations' labels the restored tree holds (the view noted with it drew them)
    this.labels = new Map();
    for (const c of state.cells.values()) {
      const p = c.transform.params as { node?: unknown; text?: string; position?: ArrayLike<number> } | undefined;
      if (typeof p?.node !== 'string' || !p.node.startsWith(AnnotationNode) || !p.position) continue;
      this.labels.set(p.node.slice(AnnotationNode.length), {
        ref: c.transform.ref,
        key: annotationKey(p.text ?? '', Array.from(p.position)),
      });
    }
    this.annotationsSaid = annotationsKey(ir);
    this.prev = ir;
    this.index(source);
    // a kept tile's looks are what they were before the restore: the restored view's written over them
    await this.writeTileLooks(ir.view.looks);
    // a tile the restore took in (it arrived while the restore waited) has no list yet, and no stream step will add it
    // (its IR already names it): drawn now, through the state (owned cells, as the fills above)
    const undrawn = placementSets(source).filter((s) => tiles.has(s.key) && s.count > 0 && !this.placed.has(s.key));
    if (undrawn.length) {
      await this.viewer.extensions.load('particles');
      await this.drawTiles(undrawn, ir.view.looks);
    }
    return { filled };
  }

  private hasRepresentation(ref: string) {
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    return this.viewer.plugin.state.data.select(q).length > 0;
  }

  private particles() {
    const api = this.api ?? this.viewer.api;
    if (!api) throw new Error('The adapter draws inside a step: no API is bound');
    const particles = api.particles;
    if (!particles) throw new Error('The viewer has no particles feature');
    return particles;
  }

  /**
   * Forgets what it drew (an Undo of an open: the restored state has no lists of its), writing nothing but the tiles'
   * lists, which the restore kept (behavior-owned): deleted through the state, with their placements.
   */
  async forget() {
    const state = this.viewer.plugin.state.data;
    const tiles = state.select(StateSelection.Generators.ofTransformer(MesoTilePlacements));
    if (tiles.length) {
      const b = state.build();
      for (const c of tiles) {
        b.delete(c.transform.ref);
        this.store.delete((c.transform.params as { key: string }).key);
      }
      await this.viewer.plugin.runTask(state.updateTree(b));
    }
    this.drawnTiles = new Set();
    this.unsure = undefined;
    this.annotationsSaid = undefined;
    this.placed.clear();
    this.labels.clear();
    this.prev = undefined;
    this.expansions.clear();
    this.bounds.clear();
    this.sets.clear();
    this.expansionInfo.clear();
    this.revision++;
  }

  /** Removes every list this adapter made (their placements stay: the owner lets them go, so Undo finds them). */
  async clear() {
    const state = this.viewer.plugin.state.data;
    const b = state.build();
    for (const [key, p] of this.placed) {
      b.delete(p.ref);
      // a tile's placements are not kept for an Undo (the tiles follow the camera, not the history)
      if (p.tile) this.store.delete(key);
    }
    for (const [, l] of this.labels) if (state.cells.has(l.ref)) b.delete(l.ref);
    this.drawnTiles = new Set();
    this.unsure = undefined;
    this.annotationsSaid = undefined;
    this.placed.clear();
    this.labels.clear();
    this.prev = undefined;
    this.sets.clear();
    this.expansionInfo.clear();
    this.revision++;
    await this.viewer.plugin.runTask(this.viewer.plugin.state.data.updateTree(b));
  }

  async dispose() {
    await this.clear();
  }
}

/**
 * A tile list's looks as layers of its representation (`ParticleRepresentation3DLayers`), as `particles.look` patches
 * them onto an empty cell: by target (a type), a later look of the same targets in the earlier's place, a look that
 * changes nothing dropped. A default color is left out when the person chose the list's color theme (`chosen`).
 */
function tileLayers(looks: readonly IRLook[], key: string, chosen: boolean): ParticleLayerProps[] {
  const out: (ParticleLayerProps | undefined)[] = [];
  const at = new Map<string, number>();
  for (const l of looks) {
    // a look on part of a type (copy runs) has no Prism layer selector (renderer-recommendations.md R8)
    if (l.set !== key || l.runs) continue;
    const targets = [...new Set(l.types)].sort((a, b) => a - b);
    const layer: ParticleLayerProps = {
      entities: [],
      compartments: [],
      targets,
      visible: l.visible ?? true,
      color: l.color !== undefined && !(l.colorDefault && chosen) ? Color(l.color) : null,
      transparency: l.transparency ?? null,
      emissive: l.emissive ?? null,
      shown: null,
    };
    const noChange = layer.visible && layer.color === null && layer.transparency === null && layer.emissive === null;
    const id = targets.join(',');
    const i = at.get(id);
    if (i !== undefined) out[i] = noChange ? undefined : layer;
    else if (!noChange) at.set(id, out.push(layer) - 1);
  }
  return out.filter((l): l is ParticleLayerProps => !!l);
}

function sameLayers(a: readonly ParticleLayerProps[], b: readonly ParticleLayerProps[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.visible !== y.visible ||
      x.color !== y.color ||
      x.transparency !== y.transparency ||
      x.emissive !== y.emissive ||
      (x.shown ?? null) !== (y.shown ?? null) ||
      x.targets.join(',') !== y.targets.join(',') ||
      x.entities.length ||
      x.compartments.length ||
      y.entities.length ||
      y.compartments.length
    )
      return false;
  }
  return true;
}

/** A tile representation's params: the type's defaults and its default themes, as `particles.representation` makes them. */
function tileRepresentationParams(plugin: PluginContext, data: ParticleList, type: string): never {
  const { registry, themes } = plugin.representation.particles;
  const provider = registry.get(type);
  const dataCtx = { particles: data };
  const color = themes.colorThemeRegistry.get(provider.defaultColorTheme.name);
  const size = themes.sizeThemeRegistry.get(provider.defaultSizeTheme.name);
  return {
    type: { name: provider.name, params: PD.getDefaultValues(provider.getParams(themes, data)) },
    colorTheme: {
      name: color.name,
      params: Object.assign(PD.getDefaultValues(color.getParams(dataCtx)), provider.defaultColorTheme.props),
    },
    sizeTheme: {
      name: size.name,
      params: Object.assign(PD.getDefaultValues(size.getParams(dataCtx)), provider.defaultSizeTheme.props),
    },
  } as never;
}

/** What the camera step needs of Mol*'s Canvas3D. */
export type CameraCanvas = Pick<
  NonNullable<PrismViewer['plugin']['canvas3d']>,
  'camera' | 'commit' | 'requestCameraReset'
>;

/**
 * The IR's camera into the canvas when it changed, or on a new scene (no set kept: a first commit); a view without one
 * then resets the camera. A model edit that adds sets leaves the user's camera alone (Canvas3D raises `radiusMax` when
 * the scene grows). Returns whether the camera was set.
 */
export function commitCamera(
  canvas: CameraCanvas,
  ir: IR,
  plan: Pick<CommitPlan, 'cameraChanged' | 'keep'>,
  sceneRadius: () => number,
): boolean {
  if (!plan.cameraChanged && plan.keep.length) return false;
  const cam = ir.view.camera;
  if (!cam) {
    canvas.requestCameraReset();
    return true;
  }
  // what was just drawn, committed first: Canvas3D resets the camera on its first representations, and that reset must
  // happen before this camera, not replace it on a later frame
  canvas.commit(true);
  // the scene's radius too, from the IR (the canvas may not have committed it yet): the near and far planes follow it,
  // and a radius left from a smaller scene clips the front of a larger one (renderer-recommendations.md, adapter A2)
  const radius = Math.max(sceneRadius(), 1);
  canvas.camera.setState(
    {
      position: Vec3.create(cam.position[0], cam.position[1], cam.position[2]),
      target: Vec3.create(cam.target[0], cam.target[1], cam.target[2]),
      up: Vec3.create(cam.up[0], cam.up[1], cam.up[2]),
      radius,
      radiusMax: radius,
    },
    cam.transition ?? 0,
  );
  return true;
}

/** A set's box (min, max) and its largest copy radius. */
export type SetBounds = readonly [number, number, number, number, number, number, number];

/** The radius of the sphere around every copy of the sets (Å): their boxes merged, plus the largest copy radius. */
export function sceneRadius(sets: readonly PlacementSet[], cache = new Map<string, SetBounds>()): number {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0];
  for (const set of sets) {
    let s = cache.get(set.key);
    if (!s) {
      const x = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0];
      const p = set.positions;
      for (let i = 0; i < set.count; i++)
        for (let k = 0; k < 3; k++) {
          const v = p[3 * i + k];
          if (v < x[k]) x[k] = v;
          if (v > x[3 + k]) x[3 + k] = v;
        }
      for (const t of set.typeTable) x[6] = Math.max(x[6], t.radius);
      cache.set(set.key, (s = x as unknown as SetBounds));
    }
    if (!set.count) continue;
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], s[k]);
      b[3 + k] = Math.max(b[3 + k], s[3 + k]);
    }
    b[6] = Math.max(b[6], s[6]);
  }
  if (!(b[3] >= b[0])) return 0;
  return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + b[6];
}

/** Runs `[s, e, …]` in any order, sorted and merged (touching runs joined). */
function mergeRuns(pieces: number[]): number[] {
  if (pieces.length <= 2) return pieces;
  const order: number[] = [];
  for (let i = 0; i < pieces.length; i += 2) order.push(i);
  let sorted = true;
  for (let i = 2; i < pieces.length && sorted; i += 2) if (pieces[i] < pieces[i - 2]) sorted = false;
  if (!sorted) order.sort((a, b) => pieces[a] - pieces[b]);
  const out: number[] = [];
  for (const i of order) {
    const s = pieces[i];
    const e = pieces[i + 1];
    if (out.length && s <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], e);
    else out.push(s, e);
  }
  return out;
}

/** The node an annotation's label is made at: `md:#an:<id>` (its mark: a restore finds it by it). */
const AnnotationNode = 'md:#an:';

/** What a label says where: a changed annotation is drawn again. */
const annotationKey = (text: string, position: readonly number[]) => `${text}@${position.join(',')}`;

/** What a view's annotations say where, all of them (unplaced ones too): an unbound commit compares it. */
const annotationsKey = (ir: IR) =>
  JSON.stringify((ir.view.annotations ?? []).map((a) => [a.id, a.text, a.position ?? null]));

const listLabel = (set: PlacementSet) => `${set.model} · ${set.count.toLocaleString('en-US')} copies`;

function placementSetKeys(ir: IR): Set<string> {
  const out = new Set<string>();
  const visit = (n: IR['root']) => {
    if (n.kind === 'placements') out.add(n.params.set.key);
    for (const c of n.children ?? []) visit(c);
  };
  visit(ir.root);
  return out;
}
