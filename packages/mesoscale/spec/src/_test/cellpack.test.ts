/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { importCellpackGpuRecipe, parseCellpackGpuRecipe } from '../resolvers/cellpack-gpu.js';
import { ExosomeRecipe } from '../examples/exosome.js';
import isg from '../examples/fixtures/isg.cellpack-gpu.json' with { type: 'json' };

// The cellPACKgpu adapter (design.md §6.4): the recipe read as cellPACKgpu reads it, its open choices made explicit.

describe('cellPACKgpu recipes', () => {
  it('flattens the tree: compartments with their sphere, ingredients with their side', () => {
    const r = parseCellpackGpuRecipe(ExosomeRecipe);
    expect(r.compartments).toEqual([{ name: 'exosome', path: 'root.exosome', parent: undefined, radius: 500, center: [0, 0, 0], thickness: 7.5, geomType: 'mb' }]);
    const side = Object.fromEntries(r.ingredients.map((i) => [i.name, `${i.compartment}:${i.side}`]));
    expect(side).toMatchObject({ ALB: 'root:exterior', CD63: 'root.exosome:surface', catalase: 'root.exosome:interior' });
    expect(r.ingredients.find((i) => i.name === 'CD63')?.path).toBe('root.exosome.surface.proteins.CD63');
  });

  it('imports its biology: counts, concentrations, densities, each with the assumption it rests on', () => {
    const imp = importCellpackGpuRecipe(parseCellpackGpuRecipe(ExosomeRecipe), { resource: 'r' });
    const pop = (id: string) => imp.populations.find((p) => p.id === id)!;
    expect(pop('p.catalase').abundance).toEqual({ count: 506 });
    expect(pop('p.ALB')).toMatchObject({ compartment: 'medium', location: 'interior', abundance: { concentration: { value: 0.00064, unit: 'M' } } });
    expect(pop('p.CD63')).toMatchObject({ location: 'membrane', evidence: ['cellpack.count-rule', 'cellpack.surface-unit', 'ev.CD63'] });
    expect((pop('p.CD63').abundance as { density: { value: number } }).density.value).toBeCloseTo(1.00662e-4);
    // the DNA fiber has no path or length in a serialized recipe
    expect(imp.populations.find((p) => p.id === 'p.DNA')).toBeUndefined();
    expect(imp.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['cellpack.fiber', 'assumption']));
    expect(imp.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(['cellpack.count-rule', 'cellpack.surface-unit', 'cellpack.medium-box', 'cellpack.thickness']));
  });

  it('nbMol and molarity both set: which wins is a rule the import names, and the two rules disagree', () => {
    const recipe = parseCellpackGpuRecipe(isg);
    const a = importCellpackGpuRecipe(recipe, { resource: 'r', countRule: 'nbMol-first' });
    const b = importCellpackGpuRecipe(recipe, { resource: 'r', countRule: 'molarity-first' });
    const ab = (imp: typeof a, id: string) => imp.populations.find((p) => p.id === id)!.abundance;
    expect(ab(a, 'p.Chga')).toEqual({ count: 454 });
    expect(ab(b, 'p.Chga')).toEqual({ concentration: { value: 4.3945e-5, unit: 'M' } });
    expect(a.issues.filter((i) => i.code === 'cellpack.count-conflict').length).toBe(4);
    // the surface unit is asked only when a surface molarity is used
    expect(a.issues.some((i) => i.code === 'assumption')).toBe(false);
    expect(b.issues.some((i) => i.code === 'assumption')).toBe(true);
  });
});
