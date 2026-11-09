/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Resolver } from '@molstar/meso-spec/runtime';
import { MesoBilayerResolver } from './bilayer.js';
import { CellpackGpuResolver } from './cellpack-gpu.js';
import { MesoFiberResolver } from './fiber.js';
import { MesoLatticeResolver } from './lattice.js';
import { MesoPackResolver } from './meso-pack.js';
import { MesoPrecomputedResolver } from './precomputed.js';
import { MesoRelaxResolver } from './relax.js';

/** The prototype's resolvers; a new recipe kind is one more entry (_spec/runtime.md). */
export const DefaultResolvers: readonly Resolver<any>[] = [
  MesoPackResolver,
  MesoLatticeResolver,
  MesoFiberResolver,
  MesoBilayerResolver,
  MesoPrecomputedResolver,
  MesoRelaxResolver,
  CellpackGpuResolver,
];

export {
  type CellpackGpuCompartment,
  type CellpackGpuIngredient,
  type CellpackGpuRecipe,
  type CellpackImport,
  type CellpackImportOptions,
  cellpackRecipeResource,
  importCellpackGpuRecipe,
  parseCellpackGpuRecipe,
} from './cellpack-gpu.js';
export { relionQuat } from './precomputed.js';
