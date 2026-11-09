/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type {
  Abundance,
  Activity,
  Alignment,
  Annotation,
  Arrangement,
  Catalog,
  Compartment,
  Entity,
  EntityState,
  Evidence,
  Frame,
  Geometry,
  Id,
  Instance,
  Membrane,
  Model,
  Population,
  Relation,
  Resource,
  Site,
  Superstructure,
  Tour,
  View,
} from '../format/doc.js';

// Refs of the builder (design.md §3.15): a ref is the id itself, branded by the kind of node it names and by the scope
// it is visible in. A slot that takes a population takes `PopulationRef`, never a plain string or another kind: a wrong
// reference is a TypeScript error. The brand is a phantom, so a ref is a string at run time (it prints, compares and
// serializes as one).

declare const RefBrand: unique symbol;
declare const SitesBrand: unique symbol;

/** The kinds of node that have a document id (`validate`'s `Kind`). */
export type NodeKind =
  | 'frame'
  | 'alignment'
  | 'resource'
  | 'entity'
  | 'superstructure'
  | 'compartment'
  | 'population'
  | 'instance'
  | 'catalog'
  | 'relation'
  | 'model'
  | 'evidence'
  | 'activity'
  | 'view'
  | 'annotation'
  | 'tour';

/**
 * `doc`: a node of the document's own sections; `inner`: a node inside a superstructure. A structural reference sees
 * only its own scope (an inner population's compartment is an inner compartment), except entities, which an inner node
 * also takes from the document (`validate`'s two indexes, design.md §3.9).
 */
export type Scope = 'doc' | 'inner';

export type Ref<K extends NodeKind, S extends Scope = 'doc'> = Id & {
  readonly [RefBrand]: { readonly kind: K; readonly scope: S };
};
/** `Sites`: the names of the sites the entity declares, so that `q.site(e, 'name')` checks them. */
export type EntityRef<S extends Scope = 'doc', Sites extends string = string> = Ref<'entity', S> & {
  readonly [SitesBrand]?: Sites;
};
export type FrameRef = Ref<'frame'>;
export type AlignmentRef = Ref<'alignment'>;
export type ResourceRef = Ref<'resource'>;
export type SuperstructureRef = Ref<'superstructure'>;
export type CompartmentRef<S extends Scope = 'doc'> = Ref<'compartment', S>;
export type PopulationRef<S extends Scope = 'doc'> = Ref<'population', S>;
export type InstanceRef = Ref<'instance'>;
export type CatalogRef = Ref<'catalog'>;
export type RelationRef<S extends Scope = 'doc'> = Ref<'relation', S>;
export type ModelRef<S extends Scope = 'doc'> = Ref<'model', S>;
export type EvidenceRef = Ref<'evidence'>;
export type ActivityRef = Ref<'activity'>;
export type ViewRef = Ref<'view'>;
export type AnnotationRef = Ref<'annotation'>;
export type TourRef = Ref<'tour'>;

/** The scope a ref of this scope's slot accepts for an entity. */
type EntityOf<S extends Scope> = EntityRef<S | 'doc'>;
type Ev = { readonly evidence?: readonly EvidenceRef[] };
/** A node's input: its fields as doc.ts has them, ids optional (generated from the label), id-holding fields as refs. */
type In<T, R> = Omit<T, 'id' | keyof R> & { readonly id?: Id } & R;

export type FrameInput = In<Frame, {}>;
export type AlignmentInput = In<Alignment, { from: FrameRef; to: FrameRef; activity?: ActivityRef } & Ev>;
export type ResourceInput = In<Resource, { frame?: FrameRef }>;
export type EntityInput<Names extends string = string> = In<
  Entity,
  Ev & {
    structure?: { readonly resource: ResourceRef; readonly assembly?: string; readonly selection?: string };
    superstructure?: SuperstructureRef;
    states?: readonly In<
      EntityState,
      Ev & { structure?: { readonly resource: ResourceRef; readonly assembly?: string } }
    >[];
    sites?: readonly (Omit<Site, 'id' | 'evidence'> & { readonly id: Names } & Ev)[];
  }
>;
type MembraneInput = Omit<Membrane, 'leaflets' | 'composition'> & {
  readonly leaflets?: { readonly inner?: EntityRef; readonly outer?: EntityRef };
  readonly composition?:
    | {
        readonly lipids: readonly {
          readonly entity: EntityRef;
          readonly fraction: number;
          readonly leaflet?: 'inner' | 'outer' | 'both';
        }[];
      }
    | { readonly resource: ResourceRef };
};
type GeometryInput =
  | Exclude<Geometry, { readonly kind: 'mesh' | 'segmentation' }>
  | { readonly kind: 'mesh'; readonly resource: ResourceRef }
  | { readonly kind: 'segmentation'; readonly resource: ResourceRef; readonly label?: number | string };
export type CompartmentInput<S extends Scope = 'doc'> = In<
  Compartment,
  Ev & { parent?: CompartmentRef<S>; geometry: GeometryInput; membrane?: MembraneInput }
>;
type ConstraintInput<S extends Scope> =
  | { readonly kind: 'placed-fraction'; readonly min: number }
  | {
      readonly kind: 'min-distance';
      readonly to: PopulationRef<S> | CompartmentRef<S>;
      readonly distance: number | { readonly value: number; readonly unit: 'A' | 'nm' | 'um' };
    };
export type PopulationInput<S extends Scope = 'doc'> = In<
  Population,
  Ev & {
    entity: EntityOf<S>;
    compartment: CompartmentRef<S>;
    abundance: Abundance;
    arrangement?: Arrangement;
    constraints?: readonly ConstraintInput<S>[];
  }
>;
export type InstanceInput = In<Instance, Ev & { entity: EntityRef; compartment: CompartmentRef; frame?: FrameRef }>;
type Subject<S extends Scope> = PopulationRef<S> | Ref<'instance', S> | CompartmentRef<S> | EntityOf<S>;
export type RelationInput<S extends Scope = 'doc'> = In<
  Relation,
  Ev & { subjects: readonly Subject<S>[]; objects?: readonly Subject<S>[] }
>;
export type ModelInput<S extends Scope = 'doc'> = In<
  Model,
  Ev & {
    populations: readonly PopulationRef<S>[];
    inputs?: readonly ResourceRef[];
    avoid?: readonly ModelRef<S>[];
    refines?: ModelRef<S>;
    activity?: ActivityRef;
    stream?: { readonly resource: ResourceRef };
  }
>;
export type EvidenceInput = In<
  Evidence,
  { source?: Omit<NonNullable<Evidence['source']>, 'resource'> & { readonly resource?: ResourceRef } }
>;
export type ActivityInput = In<
  Activity,
  { used?: readonly ResourceRef[]; generated?: readonly (ResourceRef | ModelRef | AlignmentRef)[] }
>;
export type CatalogInput = In<Catalog, Ev & { resource: ResourceRef }>;
export type ViewInput = In<View, { frame?: FrameRef; annotations?: readonly In<Annotation, Ev>[] }>;
export type TourInput = In<
  Tour,
  { steps: readonly (Omit<Tour['steps'][number], 'view'> & { readonly view: ViewRef })[] }
>;
export type SuperstructureInput = In<
  Omit<Superstructure, 'compartments' | 'populations' | 'models' | 'relations' | 'entities'>,
  Ev
>;
