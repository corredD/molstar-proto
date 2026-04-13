/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { Mat4, Vec3 } from '../../../mol-math/linear-algebra';
import { parseCifText } from '../../../mol-io/reader/cif/text/parser';
import { parseCryoEtDataPortalNdjson } from '../../../mol-io/reader/cryoet/ndjson';
import { parseDynamoTbl } from '../../../mol-io/reader/dynamo/tbl';
import { parseRelionStar } from '../../../mol-io/reader/relion/star';
import { createParticlesFromCryoEtDataPortalNdjson, createParticlesFromDynamoTbl, createParticlesFromRelionStar, getParticleTransform, getRelionStarTomogramNames } from '../particles';

describe('particles data conversion', () => {
    test('creates shared particles from RELION STAR and supports tomogram filtering', async () => {
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
_rlnTomoName
10 20 30 1 2 3 90 45 30 tomo-a
40 50 60 0 0 0 0 0 0 tomo-b
`;

        const parsed = await parseCifText(data).run();
        if (parsed.isError) throw new Error(parsed.message);

        const relion = parseRelionStar(parsed.result);
        if (relion.isError) throw new Error(relion.message);

        expect(getRelionStarTomogramNames(relion.result)).toEqual(['tomo-a', 'tomo-b']);

        const particles = createParticlesFromRelionStar(relion.result, { tomogram: 'tomo-a' });
        expect(particles.particles).toHaveLength(1);
        expect(particles.pixelSize).toBe(4.5);

        const transform = getParticleTransform(Mat4(), particles.particles[0], particles.pixelSize ?? 1);
        expect(transform[12]).toBeCloseTo((10 - 1) * 4.5, 6);
        expect(transform[13]).toBeCloseTo((20 - 2) * 4.5, 6);
        expect(transform[14]).toBeCloseTo((30 - 3) * 4.5, 6);
    });

    test('creates shared particles from Dynamo TBL', async () => {
        const parsed = await parseDynamoTbl('1 0 0 10 20 30 90 0 0 0 0 0 0 0 0 0 0 0 0 7 8 9 10 100 200 300 0 0 0 0 0 0 0 0 0 6.5').run();
        if (parsed.isError) throw new Error(parsed.message);

        const particles = createParticlesFromDynamoTbl(parsed.result, { tomo: 7 });
        expect(particles.particles).toHaveLength(1);
        expect(particles.pixelSize).toBe(6.5);
        expect(Array.from(particles.particles[0].coordinate)).toEqual([110, 220, 330]);

        const z = Vec3.transformMat4(Vec3(), Vec3.create(0, 0, 1), particles.particles[0].rotation);
        expect(z[0]).toBeCloseTo(0, 6);
        expect(z[1]).toBeCloseTo(0, 6);
        expect(z[2]).toBeCloseTo(1, 6);
    });

    test('creates shared particles from CryoET Data Portal ndjson', async () => {
        const parsed = await parseCryoEtDataPortalNdjson(JSON.stringify({
            type: 'orientedPoint',
            location: { x: 4, y: 5, z: 6 },
            xyz_rotation_matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
            instance_id: 7,
        })).run();
        if (parsed.isError) throw new Error(parsed.message);

        const particles = createParticlesFromCryoEtDataPortalNdjson(parsed.result);
        expect(particles.particles).toHaveLength(1);
        expect(particles.pixelSize).toBeUndefined();
        expect(particles.warnings).toHaveLength(1);

        const y = Vec3.transformMat4(Vec3(), Vec3.create(0, 1, 0), particles.particles[0].rotation);
        expect(y[0]).toBeCloseTo(0, 6);
        expect(y[1]).toBeCloseTo(0, 6);
        expect(y[2]).toBeCloseTo(1, 6);
    });
});
