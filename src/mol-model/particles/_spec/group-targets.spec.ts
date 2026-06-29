/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParticleList, groupTargetsByType } from '../particle-list';

/** Minimal particle list carrying just the fields `groupTargetsByType` reads/copies. */
function makeParticles(targets: number[], entities?: number[], extra?: Partial<ParticleList>): ParticleList {
    const count = targets.length;
    return {
        count,
        targets: Int32Array.from(targets),
        entities: entities ? Int32Array.from(entities) : undefined,
        ...extra,
    } as unknown as ParticleList;
}

/** Number of distinct values in a typed array. */
function distinct(a: ArrayLike<number>): number {
    const s = new Set<number>();
    for (let i = 0; i < a.length; ++i) s.add(a[i]);
    return s.size;
}

describe('groupTargetsByType', () => {
    it('collapses per-chain targets to one target per entity', () => {
        // 4 chains (targets 0..3) but only 2 entities: {0,1} -> entity 0, {2,3} -> entity 1
        const p = makeParticles([0, 1, 2, 3], [0, 0, 1, 1]);
        const out = groupTargetsByType(p);
        expect(distinct(out.targets)).toBe(2);
        // particles of the same entity share a target id
        expect(out.targets[0]).toBe(out.targets[1]);
        expect(out.targets[2]).toBe(out.targets[3]);
        // different entities get different target ids
        expect(out.targets[0]).not.toBe(out.targets[2]);
    });

    it('rebuilds targetMapping/targetModels from the first-seen old target of each type', () => {
        const p = makeParticles([0, 1, 2, 3], [0, 0, 1, 1], {
            targetMapping: new Map([[0, ['A']], [1, ['B']], [2, ['C']], [3, ['D']]]),
            targetModels: new Map([[0, 10], [1, 11], [2, 12], [3, 13]]),
        });
        const out = groupTargetsByType(p);
        // entity 0's representative is its first old target (0 -> chain 'A'); entity 1's is target 2 ('C')
        expect(out.targetMapping!.get(out.targets[0])).toEqual(['A']);
        expect(out.targetMapping!.get(out.targets[2])).toEqual(['C']);
        expect(out.targetModels!.get(out.targets[0])).toBe(10);
        expect(out.targetModels!.get(out.targets[2])).toBe(12);
        expect(out.targetMapping!.size).toBe(2);
    });

    it('keeps untyped particles (entity < 0, or no entities) grouped by their original target', () => {
        const p = makeParticles([5, 5, 7], [-1, -1, -1]);
        const out = groupTargetsByType(p);
        expect(distinct(out.targets)).toBe(2); // two original targets preserved
        expect(out.targets[0]).toBe(out.targets[1]);
        expect(out.targets[0]).not.toBe(out.targets[2]);

        const noEntities = makeParticles([5, 5, 7]);
        expect(distinct(groupTargetsByType(noEntities).targets)).toBe(2);
    });

    it('is idempotent on already one-type-one-target data', () => {
        const p = makeParticles([0, 0, 1, 1], [0, 0, 1, 1]);
        const once = groupTargetsByType(p);
        const twice = groupTargetsByType(once);
        expect(Array.from(twice.targets)).toEqual(Array.from(once.targets));
        expect(distinct(twice.targets)).toBe(2);
    });
});
