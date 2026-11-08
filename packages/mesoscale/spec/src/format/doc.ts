/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// MesoViewSpec, the document (design.md §3): what a mesoscale scene represents, in biological terms, and how its parts
// relate; where its evidence comes from and which computations turned evidence into a model; how it is meant to be
// looked at. Never how it is built (construction is the resolvers' and the IR's, design.md §4) nor how a viewer draws it
// (the adapter's, design.md §6). Plain JSON: every node has a document-wide unique `id`, and nodes refer to each other by
// id only.

/** A document id: unique in the document, one namespace for every kind of node (as SeqViewSpec's refs). */
export type Id = string;

export const IdPattern = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

export type LengthUnit = 'A' | 'nm' | 'um';
export type ConcentrationUnit = 'nM' | 'uM' | 'mM' | 'M';
export type DensityUnit = 'per_nm2' | 'per_um2';
export type MassUnit = 'Da' | 'kDa' | 'MDa';

export interface Quantity<U extends string = string> {
  readonly value: number;
  readonly unit: U;
}

/** A length: a bare number is in the document's length unit (`units.length`, nm by default). */
export type Length = number | Quantity<LengthUnit>;
export type Vec3 = readonly [number, number, number];
/** A unit quaternion, x y z w. */
export type Quat = readonly [number, number, number, number];

export interface MesoViewSpecDoc {
  readonly format: 'meso_view_spec';
  /** Semver; a minor version only adds. */
  readonly version: string;
  readonly metadata: Metadata;
  readonly units?: { readonly length?: LengthUnit };
  /** Coordinate frames: the model's world frame and each resource's own (an instrument's, a file's). */
  readonly frames?: readonly Frame[];
  /** How frames relate: one transform per pair, with the evidence and the activity that produced it. */
  readonly alignments?: readonly Alignment[];
  /** Third-party data, referenced in its native format, never copied into the document. */
  readonly resources?: readonly Resource[];
  readonly entities: readonly Entity[];
  /**
   * Reusable, nested structures (design.md §3.9): an insulin granule, a nuclear pore, a virion. Each is a fragment of a
   * document (compartments, populations, models, relations) in its own frame, centred on its envelope. An entity that
   * names one is instanced like any entity; a population picks whether its copies are resolved into parts or drawn as
   * one body (`detail`). Superstructures nest: a virus is superstructures of superstructures of molecules.
   */
  readonly superstructures?: readonly Superstructure[];
  readonly compartments: readonly Compartment[];
  readonly populations: readonly Population[];
  /** Tables of populations (a proteome's abundances): too many to list, each row a population (design.md §3.6). */
  readonly catalogs?: readonly Catalog[];
  readonly relations?: readonly Relation[];
  /** The computations that realize populations: procedural (a resolver builds them) or precomputed (a file has them). */
  readonly models?: readonly Model[];
  readonly evidence?: readonly Evidence[];
  /** The processing steps that turned data into data (acquisition, reconstruction, segmentation, picking, packing). */
  readonly activities?: readonly Activity[];
  /** Persistent view state: what a session restores. */
  readonly views?: readonly View[];
  readonly session?: { readonly view?: Id };
  /** Extensions, by namespace (`{ "cellpack": {…} }`): a reader that does not know a namespace keeps and ignores it. */
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface Metadata {
  readonly title: string;
  readonly description?: string;
  readonly authors?: readonly string[];
  readonly license?: string;
  readonly created?: string;
  readonly organism?: { readonly name: string; readonly taxon?: number };
  readonly keywords?: readonly string[];
}

// ---- frames and alignment (design.md §3.4) ----

export interface Frame {
  readonly id: Id;
  readonly label?: string;
  /** `world`: the model's frame (exactly one); `instrument`: a microscope's or a reconstruction's; `resource`: a file's. */
  readonly kind: 'world' | 'instrument' | 'resource';
  readonly units: LengthUnit;
  /** Undeclared handedness is reported, never guessed. */
  readonly handedness?: 'right' | 'left';
  /** Where the origin is and which way the axes point, in words (a tomogram's first voxel corner, a cell's center). */
  readonly convention?: string;
  /** For instrument frames: the voxel size, so voxel coordinates convert to lengths. */
  readonly voxelSize?: Length;
}

/** A rigid (or similarity) transform; `matrix` is column-major 4×4 and wins over the parts. */
export interface Transform {
  readonly matrix?: readonly number[];
  readonly rotation?: Quat;
  readonly translation?: Vec3;
  readonly scale?: number;
}

export interface Alignment {
  readonly id: Id;
  /** Points in `from` map into `to` by `transform`; the lengths of `translation` are in `to`'s unit. */
  readonly from: Id;
  readonly to: Id;
  readonly transform: Transform;
  readonly method?: string;
  readonly residual?: Length;
  readonly evidence?: readonly Id[];
  readonly activity?: Id;
}

// ---- resources ----

export type ResourceKind =
  | 'tilt-series'
  | 'tomogram'
  | 'segmentation'
  | 'mesh'
  | 'structure'
  | 'sequence'
  | 'recipe'
  | 'placements'
  | 'volume'
  | 'table'
  | 'image'
  | 'document'
  | 'dataset';

export interface Resource {
  readonly id: Id;
  readonly kind: ResourceKind;
  /** The native format, as its community names it: `mrc`, `star`, `obj`, `bcif`, `pdb-id`, `cellpack-gpu-serialized`, … */
  readonly format: string;
  readonly label?: string;
  readonly uri?: string;
  readonly accession?: { readonly db: string; readonly id: string };
  /** The frame its coordinates are in (spatial resources). */
  readonly frame?: Id;
  readonly checksum?: string;
  readonly license?: string;
  readonly description?: string;
  /** Format-specific selection inside the resource (a segmentation's label, a STAR file's table, an mmCIF assembly). */
  readonly select?: Readonly<Record<string, string | number>>;
  readonly custom?: Readonly<Record<string, unknown>>;
}

// ---- biology ----

export type EntityKind = 'protein' | 'complex' | 'nucleic-acid' | 'lipid' | 'glycan' | 'small-molecule' | 'assembly';

export interface Entity {
  readonly id: Id;
  readonly label: string;
  readonly kind: EntityKind;
  /** Database identifiers by database name: `uniprot`, `pdb`, `emdb`, `complex_portal`, `gene`, `chebi`, … */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Its structure: a resource and what of it (an assembly, a selection). */
  readonly structure?: { readonly resource: Id; readonly assembly?: string; readonly selection?: string };
  /** The radius of a sphere enclosing it: what a coarse packer and a sphere drawing use. */
  readonly radius?: Length;
  readonly mass?: Quantity<MassUnit>;
  /** Membrane topology: how it sits in a membrane, in biological terms. */
  readonly topology?: MembraneTopology;
  /**
   * Named sites: the "pointers" relations attach to (DNA entry and exit of a polymerase or of HU, an Arp2/3 branch
   * point). A site is schematized by residues (resolved once the structure is loaded) and/or materialized by a point
   * and an axis in the entity's own frame (Å) (design.md §3.9).
   */
  readonly sites?: readonly Site[];
  /**
   * Its parts, by value: a superstructure of this document (an insulin granule's membrane proteins and cargo). The
   * entity is then a placeable body whose radius defaults to the superstructure's envelope.
   */
  readonly superstructure?: Id;
  /** Conformational states, by value or by reference (design.md §3.10); one is the default. */
  readonly states?: readonly EntityState[];
  readonly evidence?: readonly Id[];
}

export interface Superstructure {
  readonly id: Id;
  readonly label: string;
  readonly kind?: 'organelle' | 'vesicle' | 'virion' | 'complex' | 'assembly';
  /** Its envelope first (no parent); everything in its own frame, centred on the envelope. */
  readonly compartments: readonly Compartment[];
  readonly populations: readonly Population[];
  readonly models?: readonly Model[];
  readonly relations?: readonly Relation[];
  /** Entities only it uses; the document's are visible inside it too. */
  readonly entities?: readonly Entity[];
  readonly evidence?: readonly Id[];
}

export interface Site {
  readonly id: Id;
  readonly label?: string;
  /** A MesoQL residue address, `(residues e.hu :chain A :range 53-63)`. */
  readonly at?: MesoQL;
  /** Å, in the entity's frame (its structure's coordinates). */
  readonly position?: Vec3;
  /** A unit direction in the entity's frame (the strand's direction through an entry site). */
  readonly axis?: Vec3;
  readonly evidence?: readonly Id[];
}

export interface EntityState {
  readonly id: Id;
  readonly label?: string;
  /** By reference: another structure. */
  readonly structure?: { readonly resource: Id; readonly assembly?: string };
  /** The share of copies in this state (0–1). */
  readonly fraction?: number;
  readonly evidence?: readonly Id[];
}

export interface MembraneTopology {
  readonly type: 'single-pass' | 'multi-pass' | 'peripheral' | 'beta-barrel' | 'lipid-anchored';
  /** The side its N terminus faces: `cytoplasmic` (the compartment's inside for a plasma membrane), or the other. */
  readonly nTerminus?: 'inside' | 'outside';
}

export type CompartmentKind = 'cell' | 'organelle' | 'vesicle' | 'virion' | 'medium' | 'lumen' | 'region';

export interface Compartment {
  readonly id: Id;
  readonly label: string;
  readonly kind: CompartmentKind;
  /** The compartment it is inside (none: the scene's top). Nesting is containment, not a coordinate transform. */
  readonly parent?: Id;
  readonly geometry: Geometry;
  /** Its boundary is a membrane: what it is made of (a lipid entity, by leaflet) and how thick. */
  readonly membrane?: Membrane;
  readonly evidence?: readonly Id[];
}

export type Geometry =
  | { readonly kind: 'sphere'; readonly radius: Length; readonly center?: Vec3 }
  | { readonly kind: 'ellipsoid'; readonly radii: readonly [Length, Length, Length]; readonly center?: Vec3 }
  | { readonly kind: 'box'; readonly size: readonly [Length, Length, Length]; readonly center?: Vec3 }
  /** A surface mesh resource (OBJ, PLY, a segmentation's surface), in the resource's frame. */
  | { readonly kind: 'mesh'; readonly resource: Id }
  /** A label of a segmentation volume; the surface is extracted by the resolver. */
  | { readonly kind: 'segmentation'; readonly resource: Id; readonly label?: number | string }
  /** Not given: the space the parent leaves (a medium), or a procedural shape a model owns (a mitochondrial reticulum). */
  | { readonly kind: 'implicit'; readonly description?: string };

export interface Membrane {
  readonly thickness?: Length;
  readonly leaflets?: { readonly inner?: Id; readonly outer?: Id };
}

/** Where in a compartment a population is (design.md §3.2). */
export type Location = 'interior' | 'membrane' | 'outer-surface' | 'inner-surface' | 'exterior';

export type Abundance =
  | { readonly count: number }
  | { readonly concentration: Quantity<ConcentrationUnit> }
  /** Per membrane area (per leaflet for lipids). */
  | { readonly density: Quantity<DensityUnit> }
  /** The fraction of the compartment's volume it fills. */
  | { readonly volumeFraction: number };

export interface Population {
  readonly id: Id;
  readonly entity: Id;
  readonly compartment: Id;
  readonly location: Location;
  readonly abundance: Abundance;
  /** The range the evidence allows, in the abundance's own terms (count, value). */
  readonly range?: readonly [number, number];
  readonly arrangement?: Arrangement;
  readonly constraints?: readonly Constraint[];
  /**
   * For an entity with a superstructure: `parts` (default) resolves each copy into the superstructure's contents,
   * `entity` draws each copy as one body. One description, both levels (design.md §3.9).
   */
  readonly detail?: 'parts' | 'entity';
  readonly evidence?: readonly Id[];
}

/** How the copies are arranged, in biological terms; the numbers a builder needs beyond these are its own (IR). */
export type Arrangement =
  | { readonly kind: 'random' }
  /** A 2D lattice in a membrane or on a surface (S-layers, capsid-like arrays, ATP synthase rows). */
  | { readonly kind: 'lattice'; readonly lattice: 'hexagonal' | 'square'; readonly spacing: Length }
  /** A filament: copies along a path, `rise` apart, turning by `twist` degrees per copy. */
  | {
      readonly kind: 'fiber';
      readonly rise: Length;
      readonly twist?: number;
      /** A path resource (a traced filament from a tomogram) or inline points (document length unit). */
      readonly path?: { readonly resource?: Id; readonly points?: readonly Vec3[] };
      /** Or grown: how stiff and how long, the number of filaments. */
      readonly growth?: { readonly persistence: Length; readonly length: Length; readonly count?: number };
    }
  /** Both leaflets of a membrane, filled at the abundance's density. */
  | { readonly kind: 'bilayer' };

export type Constraint =
  /** At least this share of the requested copies placed; default 1 (all). */
  | { readonly kind: 'placed-fraction'; readonly min: number }
  /** No copy closer than `distance` to another population's copies or a compartment's boundary. */
  | { readonly kind: 'min-distance'; readonly to: Id; readonly distance: Length };

export interface Catalog {
  readonly id: Id;
  /** A table resource; each row a population. */
  readonly resource: Id;
  /** Which columns mean what: entity identifier, compartment, location, abundance. */
  readonly columns: Readonly<Record<'entity' | 'compartment' | 'abundance', string>> &
    Readonly<Partial<Record<'location' | 'structure', string>>>;
  readonly abundanceKind: 'count' | 'concentration' | 'ppm';
  readonly evidence?: readonly Id[];
}

export interface Relation {
  readonly id: Id;
  readonly kind: 'binds' | 'part-of' | 'colocalizes' | 'anchored-to' | 'excludes';
  readonly subjects: readonly Id[];
  readonly objects?: readonly Id[];
  readonly note?: string;
  readonly evidence?: readonly Id[];
}

// ---- computation, evidence and provenance (design.md §3.5) ----

export interface Model {
  readonly id: Id;
  readonly label?: string;
  readonly kind: 'procedural' | 'precomputed';
  /** The resolver that realizes it (`meso.pack`, `cellpack-gpu`, `meso.precomputed`, …). */
  readonly method: string;
  /** The populations it realizes; a population is realized by one model. */
  readonly populations: readonly Id[];
  readonly inputs?: readonly Id[];
  /** Models whose copies this one must avoid (precomputed picks before the packing around them). */
  readonly avoid?: readonly Id[];
  readonly seed?: number;
  /** The resolver's own construction parameters (design.md §4.3): opaque to the language. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly activity?: Id;
  readonly evidence?: readonly Id[];
}

export type EvidenceKind = 'observation' | 'measurement' | 'literature' | 'database' | 'prediction' | 'assumption';

export interface Evidence {
  readonly id: Id;
  readonly kind: EvidenceKind;
  readonly statement: string;
  readonly source?: {
    readonly resource?: Id;
    readonly citation?: { readonly doi?: string; readonly pmid?: string; readonly text?: string };
    /** Where in the source (a section, a table, a figure). */
    readonly location?: string;
  };
  readonly confidence?: 'high' | 'medium' | 'low';
}

export type ActivityKind =
  | 'acquisition'
  | 'reconstruction'
  | 'segmentation'
  | 'subtomogram-averaging'
  | 'particle-picking'
  | 'alignment'
  | 'fitting'
  | 'modeling'
  | 'curation';

/** A processing step, after W3C PROV's activity: it used some resources and generated others. */
export interface Activity {
  readonly id: Id;
  readonly kind: ActivityKind;
  readonly label?: string;
  readonly used?: readonly Id[];
  readonly generated?: readonly Id[];
  readonly software?: { readonly name: string; readonly version?: string };
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly agent?: string;
  readonly date?: string;
}

// ---- persistent view state (design.md §5) ----

/**
 * A MesoQL address (design.md §3.8), in its S-expression spelling: `(entity e.catalase)`,
 * `(and (in c.exosome) (not (population p.lipids)))`, `(copies p.catalase 12)`. Checked by `validate`, materialized by
 * the runtime into MesoLoci (ir/loci.ts).
 */
export type MesoQL = string;

export interface Look {
  readonly select: MesoQL;
  /** `#rrggbb` */
  readonly color?: string;
  readonly visible?: boolean;
  readonly transparency?: number;
  /**
   * How to draw it: a hint, never a requirement ("what, not how"). An adapter that cannot draw it falls back to spheres
   * and says so (a `render` issue).
   */
  readonly representation?: RepresentationHint;
}

export type RepresentationHint = 'spheres' | 'structure' | 'surface';

export interface Camera {
  /** In the view's frame (the world frame by default), the document's length unit. */
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up?: Vec3;
  readonly fov?: number;
}

export interface Annotation {
  readonly id: Id;
  /** A MesoQL selection (anchored at its copies' centroid) or a point in the view's frame. */
  readonly target: MesoQL | { readonly position: Vec3 };
  readonly text: string;
  readonly evidence?: readonly Id[];
}

export interface View {
  readonly id: Id;
  readonly label?: string;
  readonly frame?: Id;
  readonly camera?: Camera;
  /** Later looks win where selectors overlap. */
  readonly looks?: readonly Look[];
  readonly selection?: MesoQL;
  readonly annotations?: readonly Annotation[];
  readonly description?: string;
}
