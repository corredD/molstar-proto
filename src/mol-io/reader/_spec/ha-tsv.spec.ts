/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '../../../mol-math/linear-algebra';
import { partitionParticleListByTomogram } from '../particle-list';
import { isHaTsvParticleList, parseHaTsvParticleList } from '../ha/tsv';

test('recognizes HA TSV particle headers', () => {
    expect(isHaTsvParticleList('x\ty\tz\teuler_x\teuler_y\teuler_z\tscore\tdetail\n')).toBe(true);
    expect(isHaTsvParticleList('x\ty\tz\n')).toBe(false);
});

test('parses HA TSV particle rows', () => {
    const data = [
        'x\ty\tz\teuler_x\teuler_y\teuler_z\tscore\tdetail',
        '10\t20\t30\t0\t0\t0\t1.5\t2',
        '40\t50\t60\t0\t90\t0\t3\t4',
    ].join('\n');

    const particleList = parseHaTsvParticleList(data);
    expect(particleList.format).toBe('ha-tsv');
    expect(particleList.particles).toHaveLength(2);
    expect(Array.from(particleList.particles[0].coordinate)).toEqual([10, 20, 30]);
    expect(particleList.particles[0].metadata).toMatchObject({ eulerX: 0, eulerY: 0, eulerZ: 0, score: 1.5, detail: 2 });

    const z = Vec3.transformMat4(Vec3(), Vec3.create(0, 0, 1), particleList.particles[1].rotation);
    expect(z[0]).toBeCloseTo(1, 6);
    expect(z[1]).toBeCloseTo(0, 6);
    expect(z[2]).toBeCloseTo(0, 6);
});

test('partitions HA TSV rows by optional tomogram column', () => {
    const data = [
        'x\ty\tz\teuler_x\teuler_y\teuler_z\ttomogram',
        '10\t20\t30\t0\t0\t0\tTS_01',
        '40\t50\t60\t0\t0\t0\tTS_02',
        '70\t80\t90\t0\t0\t0\tTS_01',
    ].join('\n');

    const set = partitionParticleListByTomogram(parseHaTsvParticleList(data));
    expect(set.entries).toHaveLength(2);
    expect(set.entries.map(entry => entry.label)).toEqual(['TS_01', 'TS_02']);
    expect(set.entries.map(entry => entry.particleList.particles.length)).toEqual([2, 1]);
});
