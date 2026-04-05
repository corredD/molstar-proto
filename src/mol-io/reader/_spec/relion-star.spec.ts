/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { parseCifText } from '../cif/text/parser';
import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { parseRelionStarParticleList } from '../relion/star';

test('parses RELION particle STAR blocks with pixel coordinates', async () => {
    const data = `data_optics
loop_
_rlnOpticsGroup
_rlnTomoTiltSeriesPixelSize
1 4.5

data_particles
loop_
_rlnCoordinateX
_rlnCoordinateY
_rlnCoordinateZ
_rlnOriginX
_rlnOriginY
_rlnOriginZ
_rlnAngleRot
_rlnAngleTilt
_rlnAnglePsi
_rlnOpticsGroup
10 20 30 1 2 3 90 45 30 1
40 50 60 . . . 0 0 0 1
`;

    const parsed = await parseCifText(data).run();
    if (parsed.isError) throw new Error(parsed.message);

    const particleList = parseRelionStarParticleList(parsed.result);
    expect(particleList.particleBlockHeader).toBe('particles');
    expect(particleList.opticsBlockHeader).toBe('optics');
    expect(particleList.suggestedScale).toBe(4.5);
    expect(particleList.particles).toHaveLength(2);
    expect(particleList.format).toBe('relion-star');
    expect(Array.from(particleList.particles[0].coordinate)).toEqual([10, 20, 30]);
    expect(Array.from(particleList.particles[0].origin)).toEqual([1, 2, 3]);
    expect(particleList.particles[0].coordinateUnit).toBe('pixel');
    expect(particleList.particles[0].metadata).toMatchObject({ particleRot: 90, particleTilt: 45, particlePsi: 30, opticsGroup: '1' });
});

test('keeps RELION 5 centered Angstrom coordinates unscaled by default', async () => {
    const data = `data_particles
loop_
_rlnCenteredCoordinateXAngst
_rlnCenteredCoordinateYAngst
_rlnCenteredCoordinateZAngst
_rlnOriginXAngstrom
_rlnOriginYAngstrom
_rlnOriginZAngstrom
_rlnTomoSubtomogramRot
_rlnTomoSubtomogramTilt
_rlnTomoSubtomogramPsi
100 200 300 4 5 6 10 20 30
`;

    const parsed = await parseCifText(data).run();
    if (parsed.isError) throw new Error(parsed.message);

    const particleList = parseRelionStarParticleList(parsed.result);
    expect(particleList.suggestedScale).toBe(1);
    expect(particleList.particles[0].coordinateUnit).toBe('angstrom');
    expect(particleList.particles[0].originUnit).toBe('angstrom');
    expect(particleList.particles[0].metadata).toMatchObject({ subtomogramRot: 10, subtomogramTilt: 20, subtomogramPsi: 30 });
    expect(particleList.particles[0].originRotation).toBeDefined();
    const rotatedX = Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), particleList.particles[0].originRotation!);
    const expectedRotation = Mat4.mul(
        Mat4(),
        Mat4.fromRotation(Mat4(), 30 * Math.PI / 180, Vec3.unitZ),
        Mat4.mul(
            Mat4(),
            Mat4.fromRotation(Mat4(), 20 * Math.PI / 180, Vec3.unitY),
            Mat4.fromRotation(Mat4(), 10 * Math.PI / 180, Vec3.unitZ)
        )
    );
    const expectedX = Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), expectedRotation);
    expect(rotatedX[0]).toBeCloseTo(expectedX[0], 6);
    expect(rotatedX[1]).toBeCloseTo(expectedX[1], 6);
    expect(rotatedX[2]).toBeCloseTo(expectedX[2], 6);
});
