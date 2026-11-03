/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { CryoEtDataPortalNdjsonFile } from '@molstar/io/reader/cryoet/ndjson';
import { createParticleListFromCryoEtDataPortalNdjson } from '../ndjson.js';

describe('CryoET Data Portal ndjson particles', () => {
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
