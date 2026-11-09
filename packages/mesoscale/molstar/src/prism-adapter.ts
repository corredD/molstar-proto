/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { StateSelection } from '@molstar/core/state';
import { Color } from '@molstar/core/util/color';
import { type IR, type PlacementSet, placementSets } from '@molstar/meso-spec/ir';
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
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
// the `particles` API area's types (the feature is lazy: `extensions.load('particles')` before its first use)
import type {} from '@molstar/prism-viewer/features/particles';
import { MesoPlacements, MesoPlacementStore, toParticleList } from './particle-list.js';

// The Prism adapter (design.md §6.5): the IR into a Prism viewer through its operations, as prism-me's rules ask (one
// representation per list, looks as layers through `particles.look`, never a representation per type). Per commit, by
// key (`planCommit`): new sets become lists with a spacefill representation, gone sets are deleted, kept sets are not
// touched; looks are written when they changed, one `particles.look` per list. Prism's undo journals the
// representation and look calls but not the list create and delete, so an undo can strip a kept list's representation
// (or the list): each commit checks the kept lists and draws again what is missing, and rewrites the looks then.

const now = () => performance.now();

interface Placed {
  readonly ref: string;
  readonly label: string;
}

export class PrismMesoAdapter implements RendererAdapter {
  readonly id = 'prism';
  private prev: IR | undefined;
  /** Expanded instance sets by key: kept across commits, so a view edit expands nothing again. */
  private readonly expansions: ExpansionCache = new Map();
  private placed = new Map<string, Placed>();
  /** Bounds of the drawn sets by key: what the camera's radius is taken from. */
  private readonly bounds = new Map<string, SetBounds>();
  /** For tests and stories: the state objects of the lists, by set key. */
  listObject(key: string) {
    const p = this.placed.get(key);
    return p ? this.viewer.plugin.state.data.cells.get(p.ref)?.obj : undefined;
  }
  listRef(key: string) {
    return this.placed.get(key)?.ref;
  }

  constructor(
    readonly viewer: PrismViewer,
    readonly options: { readonly representation?: string; readonly sizeFactor?: number } = {},
  ) {}

  async commit(source: IR): Promise<CommitReport> {
    // superstructure instances expanded into world sets: Prism has no nested instancing (renderer-recommendations R7)
    const flat = flattenInstances(source, this.expansions);
    const ir = flat.ir;
    const keys = placementSetKeys(ir);
    for (const k of [...this.expansions.keys()]) if (!keys.has(k)) this.expansions.delete(k);
    for (const k of [...this.bounds.keys()]) if (!keys.has(k)) this.bounds.delete(k);
    const t0 = now();
    const plan = planCommit(this.prev, ir);
    const v = this.viewer;
    if (plan.add.length) await v.extensions.load('particles');
    const particles = v.api.particles;
    if (!particles) throw new Error('The viewer has no particles feature');

    if (plan.remove.length) {
      const b = v.plugin.state.data.build();
      for (const key of plan.remove) {
        const p = this.placed.get(key);
        if (p) b.delete(p.ref);
        this.placed.delete(key);
        MesoPlacementStore.delete(key);
      }
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
    }
    // kept lists that something outside the adapter (Prism's undo) stripped: drawn again, their looks rewritten
    const byKey = new Map(placementSets(ir).map((x) => [x.key, x]));
    const relist: PlacementSet[] = [];
    const redraw: PlacementSet[] = [];
    for (const key of plan.keep) {
      const p = this.placed.get(key);
      const set = byKey.get(key)!;
      if (!p || !v.plugin.state.data.cells.get(p.ref)?.obj) {
        this.placed.delete(key);
        relist.push(set);
      } else if (!this.hasRepresentation(p.ref)) redraw.push(set);
    }
    for (const set of [...plan.add, ...relist]) {
      const label = `${set.model} · ${set.count.toLocaleString('en-US')} copies`;
      MesoPlacementStore.set(set.key, toParticleList(set, label));
      const b = v.plugin.state.data.build().toRoot().apply(MesoPlacements, { key: set.key, label });
      await v.plugin.runTask(v.plugin.state.data.updateTree(b));
      this.placed.set(set.key, { ref: b.ref, label });
      await this.represent(set, b.ref, label);
    }
    for (const set of redraw) {
      const p = this.placed.get(set.key)!;
      await this.represent(set, p.ref, p.label);
    }
    const repaired = relist.length + redraw.length;
    const t1 = now();

    let looksWritten = 0;
    if (plan.looksChanged || repaired) {
      const lists = [...this.placed].map(([key, p]) => ({
        particles: p.ref,
        layers: plan.looks
          // a look on part of a type (copy runs) has no Prism layer selector (renderer-recommendations.md R8)
          .filter((l) => l.set === key && !l.runs)
          .map((l) => ({
            selector: { targets: [...l.types] },
            color: l.color !== undefined ? Color(l.color) : null,
            visible: l.visible ?? true,
            transparency: l.transparency ?? null,
            emissive: l.emissive ?? null,
          })),
      }));
      looksWritten = lists.reduce((s, l) => s + l.layers.length, 0);
      if (lists.length) {
        const r = await particles.look({ lists } as unknown as Parameters<typeof particles.look>[0]);
        if (!r.ok) throw new Error(`Looks: ${r.message}`);
      }
    }
    const t2 = now();

    const canvas = v.plugin.canvas3d;
    const cameraSet = canvas
      ? commitCamera(canvas, ir, plan, () => sceneRadius(placementSets(ir), this.bounds))
      : false;
    const t3 = now();
    // representation hints: spheres drawn; structure and surface fall back to spheres here, said once per hint
    const issues: Issue[] = [];
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

  private async represent(set: PlacementSet, ref: string, label: string) {
    const particles = this.viewer.api.particles!;
    const type = this.options.representation ?? 'spacefill';
    const r = await particles.representation({
      type,
      particles: ref,
      // spacefill hides fiber particles by default (a Fibers representation draws them); here a filament's subunits are
      // the copies to draw (renderer-recommendations.md A8)
      params: set.fibers && type === 'spacefill' ? { excludeFibers: false } : {},
    } as Parameters<typeof particles.representation>[0]);
    if (!r.ok) throw new Error(`Could not show ${label}: ${r.message}`);
  }

  private hasRepresentation(ref: string) {
    const q = StateSelection.Generators.byRef(ref).subtree().ofType(SO.Particle.Representation3D);
    return this.viewer.plugin.state.data.select(q).length > 0;
  }

  /** Removes every list this adapter made. */
  async clear() {
    const b = this.viewer.plugin.state.data.build();
    for (const [key, p] of this.placed) {
      b.delete(p.ref);
      MesoPlacementStore.delete(key);
    }
    this.placed.clear();
    this.prev = undefined;
    await this.viewer.plugin.runTask(this.viewer.plugin.state.data.updateTree(b));
  }

  async dispose() {
    await this.clear();
  }
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
type SetBounds = readonly [number, number, number, number, number, number, number];

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

function placementSetKeys(ir: IR): Set<string> {
  const out = new Set<string>();
  const visit = (n: IR['root']) => {
    if (n.kind === 'placements') out.add(n.params.set.key);
    for (const c of n.children ?? []) visit(c);
  };
  visit(ir.root);
  return out;
}
