/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Issue } from '../format/issues.js';
import { validate } from '../format/validate.js';
import type { Id, Metadata, MesoViewSpecDoc, Superstructure } from '../format/doc.js';
import { IdRegistry, tail } from './ids.js';
import type {
  ActivityInput,
  ActivityRef,
  AlignmentInput,
  AlignmentRef,
  CatalogInput,
  CatalogRef,
  CompartmentInput,
  EntityInput,
  EntityRef,
  EvidenceInput,
  EvidenceRef,
  FrameInput,
  FrameRef,
  InstanceInput,
  InstanceRef,
  ModelInput,
  NodeKind,
  PopulationInput,
  RelationInput,
  Ref,
  ResourceInput,
  ResourceRef,
  Scope,
  SuperstructureInput,
  SuperstructureRef,
  TourInput,
  TourRef,
  ViewInput,
  ViewRef,
} from './refs.js';
import type * as D from '../format/doc.js';

// The builder (design.md §3.15): a MesoViewSpec document written in TypeScript. A node-making call returns the node's
// ref, which later calls take; ids nobody gave are generated (`ids.ts`); `build()` returns the document and what
// `validate` says of it. The document is the same as the literal's: nothing is added, empty optional sections are left
// out, sections come in the order of `MesoViewSpecDoc`, the nodes of a section in the order they were made.

/** The sections a scope holds, by the kind of node in each. */
interface SectionNodes {
  frames: [D.Frame, 'frame'];
  alignments: [D.Alignment, 'alignment'];
  resources: [D.Resource, 'resource'];
  entities: [D.Entity, 'entity'];
  compartments: [D.Compartment, 'compartment'];
  populations: [D.Population, 'population'];
  instances: [D.Instance, 'instance'];
  catalogs: [D.Catalog, 'catalog'];
  relations: [D.Relation, 'relation'];
  models: [D.Model, 'model'];
  evidence: [D.Evidence, 'evidence'];
  activities: [D.Activity, 'activity'];
}
type Section = keyof SectionNodes;
type InnerSection = 'entities' | 'compartments' | 'populations' | 'models' | 'relations';
type SectionOf<S extends Scope> = S extends 'inner' ? InnerSection : Section;

/** Both builders: the nodes that live in a document and in a superstructure alike. */
export interface ScopeBuilder<S extends Scope> {
  entity<const N extends string = never>(p: EntityInput<N>): EntityRef<S, N>;
  compartment(p: CompartmentInput<S>): Ref<'compartment', S>;
  population(p: PopulationInput<S>): Ref<'population', S>;
  model(p: ModelInput<S>): Ref<'model', S>;
  relation(p: RelationInput<S>): Ref<'relation', S>;
  /** Nodes made elsewhere (an importer's), copied as they are; their ids are registered. Returns their refs. */
  add<X extends SectionOf<S>>(section: X, nodes: readonly SectionNodes[X][0][]): Ref<SectionNodes[X][1], S>[];
  /** The ref of an id given as a string: a node added or made later (a cycle), an imported one. `validate` checks it. */
  get<K extends NodeKind>(kind: K, id: Id): Ref<K, S>;
}

export interface SuperstructureBuilder extends ScopeBuilder<'inner'> {
  readonly ref: SuperstructureRef;
}

export interface MesoBuilder extends ScopeBuilder<'doc'> {
  frame(p: FrameInput): FrameRef;
  alignment(p: AlignmentInput): AlignmentRef;
  resource(p: ResourceInput): ResourceRef;
  superstructure(p: SuperstructureInput): SuperstructureBuilder;
  instance(p: InstanceInput): InstanceRef;
  catalog(p: CatalogInput): CatalogRef;
  evidence(p: EvidenceInput): EvidenceRef;
  activity(p: ActivityInput): ActivityRef;
  view(p: ViewInput): ViewRef;
  tour(p: TourInput): TourRef;
  /** The view and tour a session restores; the last call wins. */
  session(s: { view?: ViewRef; tour?: TourRef }): void;
  /** An extension namespace (`custom('cellpack', {…})`), kept in call order. */
  custom(namespace: string, value: unknown): void;
  /** The document and its validation issues (never thrown): pure, callable again after more calls. */
  build(): { doc: MesoViewSpecDoc; issues: Issue[] };
}

export type MesoDocumentOptions = Metadata & { version?: string; revision?: string; units?: MesoViewSpecDoc['units'] };

const SectionOrder: readonly Section[] = [
  'frames',
  'alignments',
  'resources',
  'entities',
  // superstructures are emitted here
  'compartments',
  'populations',
  'instances',
  'catalogs',
  'relations',
  'models',
  'evidence',
  'activities',
];

type Obj = Record<string, unknown>;
const strip = (o: object): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const tails = (ids: readonly Id[] | undefined) => (ids ?? []).map(tail).join('-');

class Scoped {
  readonly sections: Record<string, Obj[]> = {};
  constructor(protected readonly ids: IdRegistry) {}

  /** `{ id, ...input }`: the given id or a generated one, undefined-valued keys left out, the caller's key order kept. */
  protected make(kind: NodeKind, section: string, input: object & { id?: Id; label?: string }, fallback?: string) {
    const id = input.id !== undefined ? this.ids.reserve(input.id) : this.ids.make(kind, input.label ?? fallback);
    const node = { id, ...strip(input) };
    (this.sections[section] ??= []).push(node);
    return id;
  }
  entity(p: EntityInput) {
    return this.make('entity', 'entities', p);
  }
  compartment(p: CompartmentInput<Scope>) {
    return this.make('compartment', 'compartments', p, p.kind);
  }
  population(p: PopulationInput<Scope>) {
    return this.make('population', 'populations', p, tail(p.entity));
  }
  model(p: ModelInput<Scope>) {
    return this.make('model', 'models', p, p.method);
  }
  relation(p: RelationInput<Scope>) {
    return this.make('relation', 'relations', p, `${tails(p.subjects)}-${p.kind}-${tails(p.objects)}`);
  }
  add(section: string, nodes: readonly { id: Id }[]) {
    for (const n of nodes) {
      this.ids.reserve(n.id);
      (this.sections[section] ??= []).push(n as Obj);
    }
    return nodes.map((n) => n.id);
  }
  get(_kind: NodeKind, id: Id) {
    return this.ids.reserve(id);
  }
}

class SuperstructureScope extends Scoped {
  constructor(
    ids: IdRegistry,
    readonly head: Obj,
  ) {
    super(ids);
  }
  get ref() {
    return this.head.id as string;
  }
  /** In the order of `Superstructure`; keys the caller gave beyond its own come last. */
  emit(): Superstructure {
    const { id, label, kind, evidence, ...rest } = this.head;
    const own = (s: string) => (this.sections[s]?.length ? { [s]: this.sections[s] } : {});
    return {
      id,
      label,
      ...(kind === undefined ? {} : { kind }),
      compartments: this.sections.compartments ?? [],
      populations: this.sections.populations ?? [],
      ...own('models'),
      ...own('relations'),
      ...own('entities'),
      ...(evidence === undefined ? {} : { evidence }),
      ...rest,
    } as unknown as Superstructure;
  }
}

class DocScope extends Scoped {
  private readonly superstructures: SuperstructureScope[] = [];
  private sessionState: { view?: Id; tour?: Id } | undefined;
  private readonly extensions: Record<string, unknown> = {};
  constructor(
    ids: IdRegistry,
    private readonly options: MesoDocumentOptions,
  ) {
    super(ids);
  }
  frame(p: FrameInput) {
    return this.make('frame', 'frames', p, p.kind);
  }
  alignment(p: AlignmentInput) {
    return this.make('alignment', 'alignments', p, `${tail(p.from)}-${tail(p.to)}`);
  }
  resource(p: ResourceInput) {
    return this.make('resource', 'resources', p, p.accession ? p.accession.id : p.format);
  }
  instance(p: InstanceInput) {
    return this.make('instance', 'instances', p, tail(p.entity));
  }
  catalog(p: CatalogInput) {
    return this.make('catalog', 'catalogs', p, tail(p.resource));
  }
  evidence(p: EvidenceInput) {
    return this.make('evidence', 'evidence', p);
  }
  activity(p: ActivityInput) {
    return this.make('activity', 'activities', p);
  }
  view(p: ViewInput) {
    const id = this.make('view', 'views', p);
    const node = this.sections.views.at(-1) as Obj;
    for (const l of p.looks ?? []) if (l.id !== undefined) this.ids.reserve(l.id);
    if (p.annotations)
      node.annotations = p.annotations.map((a) => {
        const aid = a.id !== undefined ? this.ids.reserve(a.id) : this.ids.make('annotation', tail(id));
        return { id: aid, ...strip(a) };
      });
    return id;
  }
  tour(p: TourInput) {
    return this.make('tour', 'tours', p);
  }
  superstructure(p: SuperstructureInput) {
    const id = p.id !== undefined ? this.ids.reserve(p.id) : this.ids.make('superstructure', p.label);
    const s = new SuperstructureScope(this.ids, { ...strip(p), id });
    this.superstructures.push(s);
    return s;
  }
  session(s: { view?: Id; tour?: Id }) {
    this.sessionState = strip(s);
  }
  custom(namespace: string, value: unknown) {
    if (value !== undefined) this.extensions[namespace] = value;
  }
  build() {
    const { version, revision, units, ...metadata } = this.options;
    const out: Obj = { format: 'meso_view_spec', version: version ?? '0.2.0' };
    if (revision !== undefined) out.revision = revision;
    out.metadata = strip(metadata);
    if (units) out.units = units;
    const required = new Set(['entities', 'compartments', 'populations']);
    for (const s of SectionOrder) {
      if (s === 'compartments' && this.superstructures.length)
        out.superstructures = this.superstructures.map((x) => x.emit());
      if (this.sections[s]?.length || required.has(s)) out[s] = this.sections[s] ?? [];
    }
    if (this.sections.views?.length) out.views = this.sections.views;
    if (this.sessionState && Object.keys(this.sessionState).length) out.session = this.sessionState;
    if (this.sections.tours?.length) out.tours = this.sections.tours;
    if (Object.keys(this.extensions).length) out.custom = this.extensions;
    // a copy: the document and the builder share nothing, so neither changes the other
    const doc = structuredClone(out) as unknown as MesoViewSpecDoc;
    return { doc, issues: validate(doc) };
  }
}

/** A new document: `title` and the rest of `Metadata`, `units`, and `version` (default `0.2.0`). */
export function createMesoDocument(options: MesoDocumentOptions): MesoBuilder {
  return new DocScope(new IdRegistry(), options) as unknown as MesoBuilder;
}
