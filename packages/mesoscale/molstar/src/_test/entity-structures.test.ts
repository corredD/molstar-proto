/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { exosomeDoc } from '@molstar/meso-spec/examples';
import type { MesoViewSpecDoc } from '@molstar/meso-spec/format';
import { describe, expect, it } from 'vitest';
import { entityStructureOf } from '../entity-structures.js';

// What an entity is drawn from (lane `mvs-lod-bands`, bands.md "In prism-me"): its `structure` resource as a source
// Mol*'s particle targets load, with the assembly it asks for; none where the viewer cannot read it.

const withResource = (resource: Record<string, unknown>): MesoViewSpecDoc => ({
  ...exosomeDoc(),
  resources: exosomeDoc().resources.map((r) => (r.id === 'r.8cat' ? ({ ...r, ...resource } as typeof r) : r)),
});

describe('an entity structure', () => {
  it('a PDB accession: the RCSB BinaryCIF, its assembly kept', () => {
    const s = entityStructureOf(exosomeDoc(), 'e.catalase');
    expect(s).toMatchObject({
      name: 'catalase',
      assembly: '1',
      source: { kind: 'url', url: 'https://models.rcsb.org/8CAT.bcif', isBinary: true },
    });
    expect(s?.key).toBe('https://models.rcsb.org/8CAT.bcif#1');
  });

  it('an absolute URI in a format Mol* reads: that URI', () => {
    const s = entityStructureOf(
      withResource({ format: 'bcif', accession: undefined, uri: 'https://example.org/x/cat.bcif' }),
      'e.catalase',
    );
    expect(s?.source).toEqual({ kind: 'url', url: 'https://example.org/x/cat.bcif', isBinary: true });
    const cif = entityStructureOf(
      withResource({ format: 'mmcif', accession: undefined, uri: 'https://example.org/x/cat.cif' }),
      'e.catalase',
    );
    expect(cif?.source).toEqual({ kind: 'url', url: 'https://example.org/x/cat.cif', isBinary: false });
  });

  it('none: no structure, an unknown entity, an accession of another database, a format it cannot read', () => {
    expect(entityStructureOf(exosomeDoc(), 'e.lipid')).toBeUndefined();
    expect(entityStructureOf(exosomeDoc(), 'e.nothing')).toBeUndefined();
    expect(entityStructureOf(withResource({ accession: { db: 'EMDB', id: '1234' } }), 'e.catalase')).toBeUndefined();
    expect(
      entityStructureOf(
        withResource({ format: 'obj', accession: undefined, uri: 'https://e.org/a.obj' }),
        'e.catalase',
      ),
    ).toBeUndefined();
  });
});
