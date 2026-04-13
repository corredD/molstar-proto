/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '../../../mol-util/param-definition';
import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { ParticlesData } from '../../../mol-model-formats/shape/particles';
import { getParticlesOrientationShape, getParticlesParams, getParticlesPositionShape } from '../particles';

function createParticlesData(): ParticlesData {
    return {
        format: 'test',
        label: 'Test particles',
        particles: [
            {
                index: 0,
                coordinate: Vec3.create(1, 2, 3),
                coordinateUnit: 'pixel',
                origin: Vec3.create(0, 0, 0),
                originUnit: 'pixel',
                rotation: Mat4.identity(),
            },
            {
                index: 1,
                coordinate: Vec3.create(4, 5, 6),
                coordinateUnit: 'pixel',
                origin: Vec3.create(0, 0, 0),
                originUnit: 'pixel',
                rotation: Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitZ),
            },
        ],
        pixelSize: 2,
        suggestedScale: 2,
        warnings: [],
        sourceData: {},
    };
}

describe('particles representation helpers', () => {
    test('creates position and orientation shapes with one instance per particle', () => {
        const data = createParticlesData();
        const props = PD.getDefaultValues(getParticlesParams({} as any, data));

        const positionShape = getParticlesPositionShape({} as any, data, props);
        const orientationShape = getParticlesOrientationShape({} as any, data, props);

        expect(positionShape.geometry.kind).toBe('spheres');
        expect(positionShape.groupCount).toBe(1);
        expect(positionShape.transforms).toHaveLength(2);

        expect(orientationShape.geometry.kind).toBe('lines');
        expect(orientationShape.groupCount).toBe(3);
        expect(orientationShape.transforms).toHaveLength(2);
        expect(orientationShape.getLabel(1, 1)).toContain('Y axis');
        expect(props.positionScale).toBe(2);
    });
});
