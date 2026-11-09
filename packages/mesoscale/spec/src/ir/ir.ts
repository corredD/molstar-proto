/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Box, StreamLevel, TileEntry } from '../format/doc.js';
import type { Issue } from '../format/issues.js';
import type { PlacementType } from './placements.js';
import type { PlacementSet } from './placements.js';

// The IR (design.md §4): the scene made concrete enough to evaluate and render, as a tree in the manner of mol-state
// (packages/core/src/state: a node's ref, kind and params; children evaluated after their parent). Every length is in Å,
// every frame a matrix, every abundance a count. Three node families:
// - space: `scene`, `frame`, `compartment`, `membrane` (where things are);
// - construction: `resolve` (a resolver, its version, its normalized input and the key hashed from it);
// - evaluated: `placements` (a placement set; the only leaf an adapter draws copies from).
// Looks and the camera are not in the tree: they are the view's (`IRView`), so a color edit never touches a node.

export type IRShape =
  | { readonly kind: 'sphere'; readonly center: readonly number[]; readonly radius: number }
  | { readonly kind: 'ellipsoid'; readonly center: readonly number[]; readonly radii: readonly number[] }
  | { readonly kind: 'box'; readonly center: readonly number[]; readonly size: readonly number[] }
  | { readonly kind: 'mesh'; readonly resource: string; readonly vertexCount: number; readonly triangleCount: number }
  | { readonly kind: 'implicit'; readonly description?: string };

export type IRNode =
  | IRNodeOf<'scene', { readonly units: 'A'; readonly title: string }>
  | IRNodeOf<'frame', { readonly frame: string; readonly matrix: readonly number[]; readonly via?: string }>
  | IRNodeOf<
      'compartment',
      {
        readonly compartment: string;
        readonly shape: IRShape;
        /** Å³ and Å², when the shape has them (the counts of concentrations and densities came from these). */
        readonly volume?: number;
        readonly area?: number;
      }
    >
  | IRNodeOf<'membrane', { readonly compartment: string; readonly thickness: number }>
  | IRNodeOf<
      'resolve',
      {
        readonly model: string;
        readonly resolver: string;
        readonly version: string;
        readonly key: string;
        /** The normalized input the key is the hash of (design.md §4.3); the construction details live here. */
        readonly input: unknown;
        readonly cached: boolean;
        /** The model it refines (its result replaced by this one's), or the model that refines it. */
        readonly refines?: string;
        readonly refinedBy?: string;
      }
    >
  | IRNodeOf<'placements', { readonly set: PlacementSet }>
  /**
   * A streamed model (design.md §6.8): level 0 (the manifest's tiles, their counts and envelopes) and no placement set
   * at compile time. The session splices the loaded tiles in as `placements` children, one set per tile.
   */
  | IRNodeOf<
      'stream',
      {
        readonly model: string;
        readonly resource: string;
        /** `<model>@<hash>`: tile set keys are `<key>#<tileId>`. */
        readonly key: string;
        readonly levels: readonly StreamLevel[];
        readonly bounds: Box;
        /** One per manifest population, in its order; shared by every tile's set. */
        readonly types: readonly PlacementType[];
        /** Level 0: the manifest's tiles (the same objects), with their counts and envelopes. */
        readonly tiles: readonly TileEntry[];
      }
    >
  /**
   * A superstructure resolved once, in its own frame (design.md §3.9): its compartments, resolve nodes and template
   * placement sets, refs prefixed with its id. Never drawn where it stands: `instances` nodes place it.
   */
  | IRNodeOf<'superstructure', { readonly superstructure: string; readonly radius: number; readonly copies: number }>
  /**
   * Under a placement set: its copies of `type` are instances of a superstructure. `parts`: each copy stands for the
   * template's copies, moved by the copy's pose (never materialized in the IR); `entity`: drawn as one body.
   */
  | IRNodeOf<
      'instances',
      {
        readonly type: number;
        readonly entity: string;
        readonly superstructure: string;
        readonly detail: 'parts' | 'entity';
        readonly instances: number;
        readonly templates: readonly string[];
      }
    >;

export interface IRNodeOf<K extends string, P> {
  /** Stable: derived from document ids (`model:pack/placements`), never from content. */
  readonly ref: string;
  readonly kind: K;
  readonly params: P;
  readonly children?: readonly IRNode[];
  /** The document ids this node came from. */
  readonly origin?: readonly string[];
}

export type IRKind = IRNode['kind'];

/** A look made concrete: which types of which set, and how. */
export interface IRLook {
  readonly set: string;
  readonly types: readonly number[];
  readonly color?: number;
  readonly visible?: boolean;
  readonly transparency?: number;
  /**
   * Only these copies of the type (runs of copy indices), when the look's address picks part of a type (a few copies, a
   * `within`): applied after the whole-type looks.
   */
  readonly runs?: readonly number[];
  /** The view's hint (design.md §5); absent: spheres. */
  readonly representation?: 'spheres' | 'structure' | 'surface';
}

export interface IRView {
  /** What the view's addresses could not materialize (MesoQL issues, phase `resolve`). */
  readonly issues?: readonly Issue[];
  readonly id: string;
  /** Å, world frame. */
  readonly camera?: {
    readonly position: readonly number[];
    readonly target: readonly number[];
    readonly up: readonly number[];
    readonly fov?: number;
    /** Milliseconds to move there. */
    readonly transition?: number;
    /** For a semantic camera: the radius of the sphere it frames (Å). */
    readonly focus?: { readonly radius: number };
  };
  /** The copies to cut away so the focus shows (a renderer that cannot clip by copies reports it). */
  readonly cutaway?: readonly { readonly set: string; readonly runs: readonly number[] }[];
  /** One per (set, type), every type of every set, then the partial looks (`runs`): what an adapter writes. */
  readonly looks: readonly IRLook[];
  /** The view's selection, materialized: runs of copy indices per set. */
  readonly selection?: readonly { readonly set: string; readonly runs: readonly number[] }[];
  readonly annotations?: readonly {
    readonly id: string;
    readonly text: string;
    readonly position?: readonly number[];
  }[];
}

export interface IR {
  readonly root: IRNode;
  readonly view: IRView;
}

export function* walk(n: IRNode, depth = 0): Generator<[IRNode, number]> {
  yield [n, depth];
  for (const c of n.children ?? []) yield* walk(c, depth + 1);
}

/** Every placement set, templates of superstructures included (in their own frame): what addresses materialize over. */
export function placementSets(ir: IR): PlacementSet[] {
  const out: PlacementSet[] = [];
  for (const [n] of walk(ir.root)) if (n.kind === 'placements') out.push(n.params.set);
  return out;
}

/** The IR as JSON for display and golden files: placement buffers summarized (count, bytes, first copies). */
export function irToJson(ir: IR, issues?: readonly Issue[]): unknown {
  const node = (n: IRNode): unknown => {
    const params =
      n.kind === 'placements'
        ? (() => {
            const s = n.params.set;
            return {
              set: {
                key: s.key,
                model: s.model,
                frame: s.frame,
                count: s.count,
                bytes: s.positions.byteLength + s.rotations.byteLength + s.types.byteLength + s.ordinals.byteLength,
                types: s.typeTable.map((t) => ({ ...t, radius: round(t.radius) })),
                fibers: s.fibers ? { count: s.fibers.count } : undefined,
                first: Array.from(s.positions.subarray(0, 6), round),
              },
            };
          })()
        : n.kind === 'stream'
          ? (() => {
              const { model, key, levels, bounds, tiles, types } = n.params;
              const copies: Record<string, number> = {};
              for (const t of tiles)
                for (const p of types)
                  copies[p.population] = (copies[p.population] ?? 0) + (t.counts[p.population] ?? 0);
              return { model, key, levels, bounds, tiles: tiles.length, copies };
            })()
          : n.params;
    return {
      ref: n.ref,
      kind: n.kind,
      ...(n.origin ? { origin: n.origin } : {}),
      params,
      ...(n.children?.length ? { children: n.children.map(node) } : {}),
    };
  };
  return { root: node(ir.root), view: ir.view, ...(issues ? { issues } : {}) };
}

function round(x: number) {
  return Math.round(x * 100) / 100;
}
