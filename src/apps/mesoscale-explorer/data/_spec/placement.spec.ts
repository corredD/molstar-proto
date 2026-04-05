/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { RelionStarParticleList } from '../../../../mol-io/reader/relion/star';
import { Mat4, Vec3 } from '../../../../mol-math/linear-algebra';
import { getMesoscalePlacementProps, getMesoscaleRepresentationPlacement, getParticleListTransforms } from '../placement';

describe('mesoscale placement helpers', () => {
    it('creates default placement props with original mode', () => {
        const props = getMesoscalePlacementProps('pixel', ['structure-element-sphere']);
        expect(props.placementMode).toBe('original');
        expect(props.positionScale).toBe(1);
        expect(props.originalClipVariant).toBe('pixel');
        expect(props.originalVisuals).toEqual(['structure-element-sphere']);
    });

    it('switches merged visuals to instanced visuals for particle lists', () => {
        const placement = getMesoscaleRepresentationPlacement('particle-list', 'pixel', ['structure-element-sphere']);
        expect(placement.clipVariant).toBe('instance');
        expect(placement.visuals).toEqual(['element-sphere']);
    });

    it('resolves particle-list transforms from loaded state cells', () => {
        const particleList: RelionStarParticleList = {
            format: 'relion-star',
            particleBlockHeader: 'particles',
            particles: [{
                index: 0,
                coordinate: [10, 20, 30],
                coordinateUnit: 'pixel',
                origin: [1, 2, 3],
                originUnit: 'pixel',
                rotation: Mat4.identity(),
            }],
            suggestedScale: 2,
            warnings: [],
        };

        const plugin = {
            state: {
                data: {
                    cells: new Map([
                        ['particles', { obj: { data: particleList } }],
                    ]),
                },
            },
        } as any;

        const transforms = getParticleListTransforms(plugin, 'particles', 2)!;
        expect(transforms).toHaveLength(1);
        expect(Array.from(Mat4.getTranslation(Vec3(), transforms[0]))).toEqual([18, 36, 54]);
    });
});
