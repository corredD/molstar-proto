/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Arrangement, Entity, Id, Location, Model, Relation, Resource } from '../format/doc.js';
import type { Issue } from '../format/issues.js';
import type { IRShape } from '../ir/ir.js';
import type { PlacementSet } from '../ir/placements.js';

// The resolver contract (design.md §6.2). A resolver realizes a model's populations as placement sets. It is two pure
// functions: `project` picks out of the job the inputs its result depends on (normalized, Å, counts), and `resolve`
// turns that projection into placements. The runtime keys the result by the hash of (resolver id, version, projection,
// the keys of the sets it avoids): a document edit that leaves the projection equal does no work. So what a resolver
// leaves out of its projection must not change its result, and what changes its result must be in it.

/** A population with every length in Å and its abundance as a count. */
export interface NormalizedPopulation {
  readonly id: Id;
  readonly entity: Entity;
  readonly compartment: Id;
  readonly location: Location;
  /** Copies asked for; undefined when the abundance cannot become a count here (`countWhy` says why). */
  readonly requested?: number;
  readonly countWhy?: string;
  /** The placed-fraction the constraints ask for (1 by default). */
  readonly minFraction: number;
  readonly radius?: number;
  readonly arrangement: NormalizedArrangement;
  readonly minDistances: readonly { readonly to: Id; readonly distance: number }[];
}

export type NormalizedArrangement =
  | { readonly kind: 'random' }
  | {
      readonly kind: 'lattice';
      readonly lattice: 'hexagonal' | 'square';
      readonly spacing: number;
      readonly vacancy: number;
    }
  | {
      readonly kind: 'fiber';
      readonly rise: number;
      readonly twist: number;
      readonly path?: readonly (readonly [number, number, number])[];
      readonly growth?: { readonly persistence: number; readonly length: number; readonly count?: number };
    }
  | { readonly kind: 'bilayer' };

export interface MeshData {
  /** Å, world frame. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface NormalizedCompartment {
  readonly id: Id;
  readonly label: string;
  readonly parent?: Id;
  readonly children: readonly Id[];
  readonly shape: IRShape;
  readonly mesh?: MeshData;
  /** The content hash of the mesh: what a projection keys a mesh by. */
  readonly meshKey?: string;
  /** Å³ inside it, its children's volumes taken out; Å² of its boundary. */
  readonly freeVolume?: number;
  readonly volume?: number;
  readonly area?: number;
  readonly membrane?: { readonly thickness: number };
}

export interface LoadedResource {
  readonly resource: Resource;
  /** What the format's reader made of it. */
  readonly content: unknown;
  readonly contentKey: string;
  /** Resource frame (in its units, or voxels) to world Å. */
  readonly toWorld?: readonly number[];
}

export interface ResolveJob {
  readonly model: Model;
  readonly populations: readonly NormalizedPopulation[];
  readonly compartments: ReadonlyMap<Id, NormalizedCompartment>;
  readonly inputs: ReadonlyMap<Id, LoadedResource>;
  /** The placement sets of the models it avoids, world frame. */
  readonly obstacles: readonly PlacementSet[];
  readonly seed: number;
  /** For a refining model: the result it refines (its sets, copies and achieved counts). */
  readonly upstream?: ResolveOutput;
  /** The relations among its populations, their sites materialized (Å, the subject entity's frame). */
  readonly relations: readonly NormalizedRelation[];
}

export interface MaterializedSite {
  /** Å, in the entity's frame. */
  readonly position: readonly [number, number, number];
  readonly axis?: readonly [number, number, number];
}

export interface NormalizedRelation {
  readonly id: Id;
  readonly kind: Relation['kind'];
  readonly subjects: readonly Id[];
  readonly objects: readonly Id[];
  readonly entry?: MaterializedSite;
  readonly exit?: MaterializedSite;
  /** Radians. */
  readonly angle?: number;
  /** Å. */
  readonly spacing?: number;
  /** Why a site could not be materialized (a residue address with no structure loaded). */
  readonly unresolved?: string;
}

export interface ResolveOutput {
  readonly sets: readonly PlacementSet[];
  /** Copies placed, by population. */
  readonly achieved: Readonly<Record<Id, number>>;
  /** Why a population fell short, in words (the runtime turns it into a `constraint.unmet` issue). */
  readonly shortfall?: Readonly<Record<Id, string>>;
  readonly issues?: readonly Issue[];
  readonly report?: Readonly<Record<string, unknown>>;
}

export interface Resolver<I = unknown> {
  readonly id: string;
  /** Bumped when the same input gives a different result: old cached results stop matching. */
  readonly version: string;
  readonly description: string;
  readonly arrangements: readonly Arrangement['kind'][];
  readonly locations: readonly Location[];
  /** The relations it honours (the others are the document's statements only). */
  readonly honours?: readonly Relation['kind'][];
  /** Input formats it reads (`cellpack-gpu-serialized`, `relion-star`). */
  readonly formats?: readonly string[];
  project(job: ResolveJob): I;
  resolve(input: I, job: ResolveJob): ResolveOutput | Promise<ResolveOutput>;
}

/** A reader turns a resource's raw content (text, JSON, bytes) into what resolvers use, by format. */
export interface ResourceReader {
  readonly format: string;
  read(raw: unknown, resource: Resource): unknown;
}
