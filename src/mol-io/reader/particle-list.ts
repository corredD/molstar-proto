/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../mol-math/linear-algebra';

export type ParticleDistanceUnit = 'pixel' | 'angstrom';

export interface ParticleListParticle {
    readonly index: number
    readonly coordinate: Vec3
    readonly coordinateUnit: ParticleDistanceUnit
    readonly origin: Vec3
    readonly originUnit: ParticleDistanceUnit
    readonly originRotation?: Mat4
    readonly rotation: Mat4
    readonly metadata?: Readonly<Record<string, string | number | undefined>>
}

export interface ParticleList {
    readonly format: string
    readonly particleBlockHeader: string
    readonly opticsBlockHeader?: string
    readonly particles: ReadonlyArray<ParticleListParticle>
    readonly suggestedScale: number
    readonly warnings: ReadonlyArray<string>
}
