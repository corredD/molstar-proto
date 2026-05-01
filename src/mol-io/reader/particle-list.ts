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

export interface ParticleListSetEntry {
    readonly key: string
    readonly label: string
    readonly particleList: ParticleList
}

export interface ParticleListSet {
    readonly format: string
    readonly entries: ReadonlyArray<ParticleListSetEntry>
}

export function getParticleTomogramKey(particle: ParticleListParticle) {
    const value = particle.metadata?.tomogram ?? particle.metadata?.tomoName ?? particle.metadata?.micrographName ?? particle.metadata?.micrograph ?? particle.metadata?.tomo;
    if (value === void 0 || value === null || value === '') return;
    return `${value}`;
}

export function partitionParticleListByTomogram(data: ParticleList): ParticleListSet {
    const groups = new Map<string, ParticleListParticle[]>();
    const order: string[] = [];

    for (const particle of data.particles) {
        const key = getParticleTomogramKey(particle);
        if (!key) {
            return {
                format: data.format,
                entries: [{ key: '', label: '', particleList: data }]
            };
        }

        let particles = groups.get(key);
        if (!particles) {
            particles = [];
            groups.set(key, particles);
            order.push(key);
        }
        particles.push(particle);
    }

    if (order.length <= 1) {
        const key = order[0] ?? '';
        return {
            format: data.format,
            entries: [{ key, label: key, particleList: data }]
        };
    }

    return {
        format: data.format,
        entries: order.map(key => ({
            key,
            label: key,
            particleList: {
                ...data,
                particles: groups.get(key)!,
            }
        }))
    };
}
