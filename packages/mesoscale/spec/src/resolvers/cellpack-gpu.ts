/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type {
  Abundance,
  Compartment,
  Entity,
  Evidence,
  Id,
  Location,
  Model,
  Population,
  Resource,
} from '../format/doc.js';
import { issue, type Issue } from '../format/issues.js';
import type { Resolver, ResolveJob } from '../runtime/resolver.js';
import { DefaultPackParams, pack, type PackInput, packCompartments } from './packing.js';

// The cellPACKgpu adapter (design.md §6.4): a recipe kind plugged in without touching the language or the IR. Two
// halves, both reading cellPACKgpu's serialized recipe (`CompartmentUtils.cs` `Compartment`/`IngredientGroup`/
// `Ingredient`, loaded by `CellPackLoader.LoadRecipe`):
// - `importCellpackGpuRecipe`: the recipe's biology as MesoViewSpec (entities, compartments, populations), every
//   choice the recipe leaves open made explicitly and recorded as an `assumption` evidence and an issue: which count
//   field wins (`UImanager.cs:9231` vs `PopulateTest.cs:4939`), what unit a surface molarity is in (`PopulateTest.cs:4953`
//   asks the same question);
// - the `cellpack-gpu` resolver: the recipe's construction details (principal vector, membrane offset, packing order)
//   on top of the shared packer. Counts and radii come from the document, so a document edit wins over the recipe.

// ---- the recipe ----

export interface CellpackGpuIngredient {
  readonly name: string;
  readonly path: string;
  /** The compartment's path (`root.exosome`). */
  readonly compartment: string;
  readonly side: 'surface' | 'interior' | 'exterior';
  /** Å */
  readonly radius: number;
  readonly nbMol: number;
  readonly molarity: number;
  readonly principalVector: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly pdb?: string;
  readonly uniprot?: string;
  readonly description?: string;
  readonly ingtype?: string;
  readonly color?: readonly number[];
  readonly comments?: string;
}

export interface CellpackGpuCompartment {
  readonly name: string;
  readonly path: string;
  readonly parent?: string;
  /** Å, from a one-metaball `mb` or `radius`. */
  readonly radius?: number;
  readonly center?: readonly [number, number, number];
  readonly thickness: number;
  readonly geomType?: string;
}

export interface CellpackGpuRecipe {
  readonly compartments: readonly CellpackGpuCompartment[];
  readonly ingredients: readonly CellpackGpuIngredient[];
}

interface RawCompartment {
  name: string;
  geom_type?: string;
  mb?: { positions: number[]; radii: number[] };
  radius?: number;
  thickness?: number;
  Compartments?: RawCompartment[];
  IngredientGroups?: { name: string; Ingredients: RawIngredient[] }[];
}

interface RawIngredient {
  name: string;
  encapsulatingRadius?: number;
  nbMol?: number;
  molarity?: number;
  principalVector?: number[];
  source?: { pdb?: string; uniprot?: string; transform?: { offset?: number[] } };
  uniprot?: string;
  description?: string;
  ingtype?: string;
  color?: number[];
  comments?: string;
}

/** The recipe tree flattened, paths rebuilt as `PostProcessSceneGraph` does (`root.exosome.surface.proteins.CD63`). */
export function parseCellpackGpuRecipe(json: unknown): CellpackGpuRecipe {
  const compartments: CellpackGpuCompartment[] = [];
  const ingredients: CellpackGpuIngredient[] = [];
  const visit = (c: RawCompartment, path: string, owner: string | undefined, side: CellpackGpuIngredient['side']) => {
    for (const g of c.IngredientGroups ?? [])
      for (const i of g.Ingredients ?? []) {
        const pv = i.principalVector ?? [0, 0, 1];
        const off = i.source?.transform?.offset ?? [0, 0, 0];
        ingredients.push({
          name: i.name,
          path: `${path}.${g.name}.${i.name}`,
          compartment: owner ?? 'root',
          side,
          radius: i.encapsulatingRadius ?? 25,
          nbMol: i.nbMol ?? 0,
          molarity: i.molarity ?? 0,
          principalVector: [pv[0], pv[1], pv[2]],
          offset: [off[0], off[1], off[2]],
          pdb: i.source?.pdb || undefined,
          uniprot: i.source?.uniprot || i.uniprot || undefined,
          description: i.description || undefined,
          ingtype: i.ingtype,
          color: i.color,
          comments: i.comments || undefined,
        });
      }
    for (const k of c.Compartments ?? []) {
      // `surface` and `interior` are child compartments by name: the side, not a compartment (CellPackLoader.cs)
      if (k.name === 'surface' || k.name === 'interior') {
        visit(k, `${path}.${k.name}`, owner, k.name);
        continue;
      }
      const kpath = `${path}.${k.name}`;
      const mbR = k.geom_type === 'mb' && k.mb?.radii?.length === 1 ? k.mb.radii[0] : undefined;
      const mbC = k.geom_type === 'mb' && k.mb?.positions?.length === 3 ? k.mb.positions : undefined;
      compartments.push({
        name: k.name,
        path: kpath,
        parent: owner,
        radius: mbR ?? k.radius,
        center: mbC ? [mbC[0], mbC[1], mbC[2]] : undefined,
        thickness: k.thickness ?? 7.5,
        geomType: k.geom_type,
      });
      visit(k, kpath, kpath, 'exterior');
    }
  };
  const root = json as RawCompartment;
  visit(root, root.name ?? 'root', undefined, 'exterior');
  return { compartments, ingredients };
}

// ---- import: the recipe's biology as MesoViewSpec ----

export interface CellpackImportOptions {
  /** The document's id of the recipe resource. */
  readonly resource: Id;
  /** `nbMol-first`: a nonzero `nbMol` wins (`UImanager.cs:9231`); `molarity-first`: 0 < molarity < 1 wins (`PopulateTest.cs:4939`). */
  readonly countRule?: 'nbMol-first' | 'molarity-first';
  /** What a surface ingredient's `molarity` is per (the code's own comment asks, `PopulateTest.cs:4953`). */
  readonly surfaceMolarityUnit?: 'per_A2' | 'per_nm2';
  /** The medium around the top compartment: a cube this many times its diameter (the serialized recipe has none). */
  readonly mediumScale?: number;
  readonly modelId?: Id;
  readonly seed?: number;
}

export interface CellpackImport {
  readonly entities: Entity[];
  readonly compartments: Compartment[];
  readonly populations: Population[];
  readonly models: Model[];
  readonly evidence: Evidence[];
  readonly issues: Issue[];
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

export function importCellpackGpuRecipe(recipe: CellpackGpuRecipe, o: CellpackImportOptions): CellpackImport {
  const issues: Issue[] = [];
  const evidence: Evidence[] = [];
  const countRule = o.countRule ?? 'nbMol-first';
  const compId = (path: string) => (path === 'root' ? 'medium' : `c.${slug(path.split('.').pop()!)}`);
  const compartments: Compartment[] = [];
  const tops = recipe.compartments.filter((c) => !c.parent);
  const hasExterior = recipe.ingredients.some((i) => i.side === 'exterior' && i.compartment === 'root');
  if (hasExterior) {
    const size = (o.mediumScale ?? 1.5) * 2 * Math.max(...tops.map((c) => c.radius ?? 0), 100);
    compartments.push({
      id: 'medium',
      label: 'medium',
      kind: 'medium',
      geometry: { kind: 'box', size: [{ value: size, unit: 'A' }, { value: size, unit: 'A' }, { value: size, unit: 'A' }] },
      evidence: ['cellpack.medium-box'],
    });
    evidence.push({
      id: 'cellpack.medium-box',
      kind: 'assumption',
      statement: `The serialized recipe has no bounding box: the medium is a cube ${(o.mediumScale ?? 1.5).toFixed(1)}× the top compartment's diameter`,
      source: { resource: o.resource },
    });
  }
  for (const c of recipe.compartments) {
    if (c.radius === undefined) {
      issues.push(issue('cellpack.geometry', 'warning', 'load', `${c.path} is ${c.geomType}: only one-metaball and sphere compartments import as spheres`, { ids: [compId(c.path)] }));
    }
    compartments.push({
      id: compId(c.path),
      label: c.name,
      kind: 'vesicle',
      parent: c.parent ? compId(c.parent) : hasExterior ? 'medium' : undefined,
      geometry:
        c.radius !== undefined
          ? { kind: 'sphere', radius: { value: c.radius, unit: 'A' }, center: c.center }
          : { kind: 'implicit', description: `cellPACK geom_type ${c.geomType}` },
      membrane: { thickness: { value: 2 * c.thickness, unit: 'A' } },
      evidence: ['cellpack.thickness'],
    });
  }
  if (recipe.compartments.length)
    evidence.push({
      id: 'cellpack.thickness',
      kind: 'assumption',
      statement: "The recipe's compartment thickness (7.5) is read as half the membrane's thickness in Å; the recipe states no unit",
      source: { resource: o.resource },
      confidence: 'low',
    });
  // the count rules and the surface unit, each an assumption the document carries
  evidence.push({
    id: 'cellpack.count-rule',
    kind: 'assumption',
    statement:
      countRule === 'nbMol-first'
        ? 'Counts: a nonzero nbMol wins over molarity (cellPACKgpu UImanager.cs:9231)'
        : 'Counts: a molarity in (0, 1) wins over nbMol (cellPACKgpu PopulateTest.cs:4939)',
    source: { resource: o.resource },
  });
  const surfaceUsesMolarity = recipe.ingredients.some((i) => i.side === 'surface' && i.molarity > 0 && !(countRule === 'nbMol-first' && i.nbMol > 0));
  if (surfaceUsesMolarity) {
    const unit = o.surfaceMolarityUnit ?? 'per_A2';
    evidence.push({
      id: 'cellpack.surface-unit',
      kind: 'assumption',
      statement: `A surface ingredient's molarity is copies ${unit === 'per_A2' ? 'per Å²' : 'per nm²'} of membrane (the recipe does not say; PopulateTest.cs:4953)`,
      source: { resource: o.resource },
      confidence: 'low',
    });
    if (!o.surfaceMolarityUnit)
      issues.push(issue('assumption', 'warning', 'load', 'Surface molarities read as copies per Å² (the recipe does not say its unit)', { ids: ['cellpack.surface-unit'] }));
  }

  const entities: Entity[] = [];
  const populations: Population[] = [];
  const params: Record<Id, { path: string }> = {};
  for (const ing of recipe.ingredients) {
    if (ing.ingtype === 'fiber') {
      issues.push(issue('cellpack.fiber', 'info', 'load', `${ing.path} is a cellPACK fiber with no length or path in the serialized recipe: not imported`, {}));
      continue;
    }
    const eid = `e.${slug(ing.name)}`;
    const pid = `p.${slug(ing.name)}`;
    const compartment = ing.compartment === 'root' ? 'medium' : compId(ing.compartment);
    const location: Location = ing.side === 'surface' ? 'membrane' : ing.side === 'interior' ? 'interior' : 'exterior';
    const ownerPath = ing.compartment;
    const top = ing.side === 'exterior' && ing.compartment === 'root';
    entities.push({
      id: eid,
      label: ing.description ? `${ing.name} (${ing.description})` : ing.name,
      kind: 'protein',
      identifiers: { ...(ing.uniprot ? { uniprot: ing.uniprot } : {}), ...(ing.pdb && /^[0-9][A-Za-z0-9]{3}$/.test(ing.pdb) ? { pdb: ing.pdb.toUpperCase() } : {}) },
      radius: { value: ing.radius, unit: 'A' },
    });
    let abundance: Abundance;
    const useCount = countRule === 'nbMol-first' ? ing.nbMol > 0 : !(ing.molarity > 0 && ing.molarity < 1) && ing.nbMol > 0;
    if (ing.nbMol > 0 && ing.molarity > 0)
      issues.push(
        issue('cellpack.count-conflict', 'warning', 'load', `${ing.name}: nbMol ${ing.nbMol} and molarity ${ing.molarity} both set; ${useCount ? 'nbMol' : 'molarity'} wins (${countRule})`, { ids: [pid] }),
      );
    if (useCount) abundance = { count: ing.nbMol };
    else if (ing.side === 'surface') {
      const perA2 = (o.surfaceMolarityUnit ?? 'per_A2') === 'per_A2';
      abundance = { density: { value: perA2 ? ing.molarity * 1e2 : ing.molarity, unit: 'per_nm2' } };
    } else abundance = { concentration: { value: ing.molarity, unit: 'M' } };
    populations.push({
      id: pid,
      entity: eid,
      compartment: top ? 'medium' : compartment,
      location: top ? 'interior' : location,
      abundance,
      evidence: [
        'cellpack.count-rule',
        ...(ing.side === 'surface' && !useCount ? ['cellpack.surface-unit'] : []),
        ...(ing.comments ? [`ev.${slug(ing.name)}`] : []),
      ],
    });
    if (ing.comments)
      evidence.push({ id: `ev.${slug(ing.name)}`, kind: 'literature', statement: ing.comments, source: { resource: o.resource, location: ing.path } });
    params[pid] = { path: ing.path };
    void ownerPath;
  }
  const models: Model[] = [
    {
      id: o.modelId ?? 'm.cellpack',
      label: 'cellPACKgpu recipe, packed',
      kind: 'procedural',
      method: 'cellpack-gpu',
      populations: populations.map((p) => p.id),
      inputs: [o.resource],
      seed: o.seed ?? 1,
      params: { ingredients: params },
    },
  ];
  return { entities, compartments, populations, models, evidence, issues };
}

// ---- the resolver ----

export const CellpackGpuResolver: Resolver<PackInput & { readonly recipe: string }> = {
  id: 'cellpack-gpu',
  version: '0.1.0',
  description: "cellPACKgpu serialized recipes: the recipe's principal vectors and membrane offsets on the shared packer",
  arrangements: ['random'],
  locations: ['interior', 'membrane', 'outer-surface', 'inner-surface', 'exterior'],
  formats: ['cellpack-gpu-serialized'],
  project(job: ResolveJob) {
    const inputId = (job.model.inputs ?? []).find((id) => job.inputs.get(id)?.resource.format === 'cellpack-gpu-serialized');
    const loaded = inputId ? job.inputs.get(inputId) : undefined;
    const recipe = loaded ? parseCellpackGpuRecipe(loaded.content) : { compartments: [], ingredients: [] };
    const byPath = new Map(recipe.ingredients.map((i) => [i.path, i]));
    const map = (job.model.params?.ingredients ?? {}) as Record<Id, { path: string }>;
    const params = job.model.params ?? {};
    return {
      recipe: loaded?.contentKey ?? '',
      items: job.populations.map((p) => {
        const ing = byPath.get(map[p.id]?.path ?? '');
        const pv = ing?.principalVector ?? [0, 0, 1];
        const l = Math.hypot(...pv) || 1;
        // the membrane offset: the recipe's offset along the principal vector (CellPackLoader.cs:850–877 mirrors x
        // and negates it for non-surface ingredients; not reproduced, design.md §6.4)
        const along = ing ? (ing.offset[0] * pv[0] + ing.offset[1] * pv[1] + ing.offset[2] * pv[2]) / l : 0;
        return {
          population: p.id,
          entity: p.entity.id,
          label: p.entity.label,
          radius: p.radius ?? ing?.radius ?? 25,
          requested: p.requested ?? 0,
          location: p.location,
          compartment: p.compartment,
          axis: [pv[0] / l, pv[1] / l, pv[2] / l] as [number, number, number],
          offset: p.location === 'membrane' ? along : 0,
        };
      }),
      compartments: packCompartments(job, job.populations.map((p) => p.compartment)),
      seed: job.seed,
      attempts: Number(params.attempts ?? DefaultPackParams.attempts),
      giveUp: Number(params.giveUp ?? DefaultPackParams.giveUp),
    };
  },
  resolve(input, job) {
    const issues: Issue[] = [];
    const map = (job.model.params?.ingredients ?? {}) as Record<Id, { path: string }>;
    for (const p of job.populations)
      if (!map[p.id])
        issues.push(issue('resolver.unsupported', 'info', 'resolve', `${p.id} names no recipe ingredient: placed with the document's numbers only`, { ids: [p.id] }));
    const out = pack(input, job, job.model.id, '');
    return { ...out, issues };
  },
};

/** A recipe resource as a document would declare it. */
export function cellpackRecipeResource(id: Id, uri: string, label?: string): Resource {
  return { id, kind: 'recipe', format: 'cellpack-gpu-serialized', uri, label };
}
