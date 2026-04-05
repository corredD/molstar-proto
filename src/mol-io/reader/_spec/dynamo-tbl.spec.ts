/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { parseDynamoTblParticleList } from '../dynamo/tbl';

test('parses Dynamo TBL particle rows and applies shifts to positions', () => {
    const data = [
        '1 0 0 10 20 30 90 0 0 0 0 0 0 0 0 0 0 0 0 7 8 9 10 100 200 300 0 0 0 0 0 0 0 0 0 6.5',
        '2 0 0 1 2 3 0 90 0 0 0 0 0 0 0 0 0 0 0 7 8 9 10 40 50 60 0 0 0 0 0 0 0 0 0 6.5',
    ].join('\n');

    const particleList = parseDynamoTblParticleList(data);
    expect(particleList.format).toBe('dynamo-tbl');
    expect(particleList.suggestedScale).toBe(6.5);
    expect(particleList.particles).toHaveLength(2);
    expect(Array.from(particleList.particles[0].coordinate)).toEqual([110, 220, 330]);
    expect(Array.from(particleList.particles[0].origin)).toEqual([0, 0, 0]);
    expect(particleList.particles[0].metadata).toMatchObject({ tomo: 7, class: 9, tdrot: 90, tilt: 0, narot: 0 });

    const z = Vec3.transformMat4(Vec3(), Vec3.create(0, 0, 1), particleList.particles[1].rotation);
    expect(z[0]).toBeCloseTo(0, 6);
    expect(z[1]).toBeCloseTo(-1, 6);
    expect(z[2]).toBeCloseTo(0, 6);
});

test('matches the RELION-equivalent pose for paired Dynamo angles', () => {
    const particleList = parseDynamoTblParticleList('0 0 0 0 0 0 4.5 139.8699951171875 149.83499908447266 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2192.5 152.5 186.5 0 0 0 0 0 0 0 0 0 0 0 0 0');
    const relionEquivalent = Mat4.mul(
        Mat4(),
        Mat4.fromRotation(Mat4(), (270 - 149.83499908447266) * Math.PI / 180, Vec3.unitZ),
        Mat4.mul(
            Mat4(),
            Mat4.fromRotation(Mat4(), 139.8699951171875 * Math.PI / 180, Vec3.unitY),
            Mat4.fromRotation(Mat4(), (90 - 4.500000000000006) * Math.PI / 180, Vec3.unitZ)
        )
    );
    const dynamoRotation = particleList.particles[0].rotation;

    for (let i = 0; i < 16; i++) {
        expect(dynamoRotation[i]).toBeCloseTo(relionEquivalent[i], 5);
    }
});
