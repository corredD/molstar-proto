/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Resolver } from '../runtime/resolver.js';
import { MesoBilayerResolver } from './bilayer.js';
import { CellpackGpuResolver } from './cellpack-gpu.js';
import { MesoFiberResolver } from './fiber.js';
import { MesoLatticeResolver } from './lattice.js';
import { MesoPackResolver } from './meso-pack.js';
import { MesoPrecomputedResolver } from './precomputed.js';

/** The prototype's resolvers; a new recipe kind is one more entry (design.md §6.4). */
export const DefaultResolvers: readonly Resolver<any>[] = [
  MesoPackResolver,
  MesoLatticeResolver,
  MesoFiberResolver,
  MesoBilayerResolver,
  MesoPrecomputedResolver,
  CellpackGpuResolver,
];
