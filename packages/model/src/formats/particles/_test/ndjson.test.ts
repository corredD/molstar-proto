/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { CryoEtDataPortalNdjsonFile } from '@molstar/io/reader/cryoet/ndjson';
import { getParticleTransforms } from '@molstar/model/model/particles/particle-list';
import { createParticleListFromCryoEtDataPortalNdjson } from '../ndjson.js';

describe('CryoET Data Portal ndjson particles', () => {
  // The convention, measured (tools/portal-index/rotation_check.py, dataset 10003 TS_08, 378 ribosomes against
  // EMD-13412): a target x is drawn at p + M (x - c), M the record's xyz_rotation_matrix as given (its rows the
  // rows), not its transpose. The first ribosome of TS_08, M ≠ Mᵀ.
  it('draws a target turned by xyz_rotation_matrix as given, at the location in Å', () => {
    const M = [
      [-0.9902028356581416, -0.06003911724001469, -0.12607001489495856],
      [-0.014149708739980598, -0.8550543832421911, 0.5183452396240269],
      [-0.1389177094439331, 0.515050780117219, 0.8458277389063893],
    ] as [[number, number, number], [number, number, number], [number, number, number]];
    const data: CryoEtDataPortalNdjsonFile = {
      records: [{ type: 'orientedPoint', location: { x: 362, y: 510, z: 178 }, xyz_rotation_matrix: M }],
    };
    const t = getParticleTransforms(createParticleListFromCryoEtDataPortalNdjson(data, { pixelSize: 6.802 }));
    // column-major: row i, column j at 4 j + i
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(t[4 * j + i]).toBeCloseTo(M[i][j], 5);
    expect(t[12]).toBeCloseTo(362 * 6.802, 2);
    expect(t[13]).toBeCloseTo(510 * 6.802, 2);
    expect(t[14]).toBeCloseTo(178 * 6.802, 2);
  });

  it('keeps the instance_id of instancePoint records as an attribute', () => {
    const data: CryoEtDataPortalNdjsonFile = {
      records: [
        { type: 'instancePoint', location: { x: 1, y: 2, z: 3 }, instance_id: 7 },
        { type: 'point', location: { x: 0, y: 0, z: 0 } },
        { type: 'instancePoint', location: { x: 4, y: 5, z: 6 }, instance_id: 9 },
      ],
    };
    const list = createParticleListFromCryoEtDataPortalNdjson(data, { pixelSize: 2 });
    expect(list.count).toBe(3);
    expect(Array.from(list.coordinates.slice(6, 9))).toEqual([8, 10, 12]);
    expect(list.rotations).toBeUndefined();
    const instance = list.attributes?.get('instance_id');
    expect(instance).toBeDefined();
    expect([instance!.column.value(0), instance!.column.value(2)]).toEqual([7, 9]);
    expect(instance!.column.valueKind(1)).not.toBe(0);
    expect([instance!.min, instance!.max]).toEqual([7, 9]);
    expect(list.getParticleLabel(2)).toBe('Particle 3 · instancePoint · instance 9');
  });

  it('keeps only the records of the type asked for', () => {
    const data: CryoEtDataPortalNdjsonFile = {
      records: [
        { type: 'point', location: { x: 0, y: 0, z: 0 } },
        { type: 'instancePoint', location: { x: 4, y: 5, z: 6 }, instance_id: 9 },
      ],
    };
    const list = createParticleListFromCryoEtDataPortalNdjson(data, { pixelSize: 1, type: 'instancePoint' });
    expect(list.count).toBe(1);
    expect(list.attributes?.get('instance_id')?.column.value(0)).toBe(9);
  });

  it('has no instance attribute without instancePoint records', () => {
    const data: CryoEtDataPortalNdjsonFile = { records: [{ type: 'point', location: { x: 0, y: 0, z: 0 } }] };
    expect(createParticleListFromCryoEtDataPortalNdjson(data, { pixelSize: 1 }).attributes).toBeUndefined();
  });
});
