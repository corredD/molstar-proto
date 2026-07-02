/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Declarative counterpart to `ParticleDynamicsDemo`'s imperative `bodies` array
 * (`addBody`/`addBodies`/`buildBodiesList` in `index.ts`): a `ParticleRecipe` is a list of particle
 * *types* - the cellPACK/Mesoscope concept of a compartment holding one or more ingredients - that
 * `applyRecipe` resolves into the same rigid-body `ParticleList` those methods already build. This is
 * the data model the schematic + table UI (`RecipeSchematic`/`RecipeTable`/`RecipePanel`) edits; it
 * does not introduce a new simulation pipeline.
 */

import { Particle } from '../../mol-model/particles/particle-list';

/** One particle type/ingredient in a recipe. */
export interface ParticleRecipeEntry {
    readonly id: string
    /** Type name. Also the key the surface binding is applied under: `surfaceMode`/`surfaceMeshRef` are
     * per-entry, so each named type is confined independently (see `applyRecipe`). Keep names distinct if
     * types need distinct surface behaviour. */
    readonly name: string
    /** Display grouping only (the cellPACK "compartment" concept): entries sharing a `compartment` are
     * drawn together in `RecipeSchematic`. It does NOT drive the surface binding - that is per-entry (by
     * `name`) - so several types can share a compartment box yet each keep its own confinement. */
    readonly compartment: string
    /** Source id in the same format as `ParticleDynamicsDemo.getSources()`/`computeOffsets`, e.g.
     * `builtin:cube`, `builtin:tube`, `builtin:particle`, `structure:<ref>`, `volume:<ref>`, `shape:<ref>`. */
    readonly source: string
    /** Number of copies of this type to place. */
    readonly count: number
    /** Optional mesh-surface confinement for the type's compartment; `undefined` = unconstrained (free). */
    readonly surfaceMode?: Particle.SurfaceMode
    /** State-tree ref of the loaded mesh (`SO.Shape.Provider`) `surfaceMode` confines this type's
     * compartment to; required together with `surfaceMode` for a binding to actually apply. */
    readonly surfaceMeshRef?: string
}

export interface ParticleRecipe {
    readonly entries: ParticleRecipeEntry[]
}

export function emptyRecipeEntry(id: string): ParticleRecipeEntry {
    return { id, name: `Type ${id}`, compartment: 'default', source: 'builtin:cube', count: 100 };
}
