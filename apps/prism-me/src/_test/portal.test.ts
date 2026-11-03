/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkPortalIndex,
  type PortalCatalog,
  type PortalDataset,
  PortalFiles,
} from '@molstar/cryoet-extension/portal-index';
import { portalLoadOf } from '../url.js';

// The CryoET Data Portal's index the explorer ships (`portal/`, tools/portal-index) and the URL that loads from it.

const read = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`../../portal/${name}.json`, import.meta.url), 'utf8')) as T;

describe('the shipped portal index', () => {
  it('lists each dataset it holds, in the version the viewer reads', () => {
    const catalog = checkPortalIndex(read<PortalCatalog>('index'), 'index.json');
    expect(catalog.datasets.map((d) => d.id)).toEqual([10003, 10453, 10524]);
    for (const d of catalog.datasets)
      expect(checkPortalIndex(read<PortalDataset>(String(d.id)), `${d.id}`).id).toBe(d.id);
  });

  it('has 10003 TS_08: its ribosomes (annotation 1212) at 6.802 Å, decorated with 7PHB, and its tomogram levels', () => {
    const ds = read<PortalDataset>('10003');
    expect(ds.dois).toContain('10.1038/s41586-022-05255-2');
    const run = ds.runList.find((r) => r.name === 'TS_08')!;
    expect(run.id).toBe(368);
    const s = run.spacings[0];
    expect(s.spacing).toBe(6.802);
    const ribosomes = s.annotations.find((a) => a.id === 1212)!;
    expect(PortalFiles + ribosomes.path).toBe(
      'https://files.cryoetdataportal.cziscience.com/10003/TS_08/Reconstructions/VoxelSpacing6.802/Annotations/100/chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson',
    );
    expect(ribosomes).toMatchObject({ shape: 'OrientedPoint', count: 378, default: true });
    expect(ds.decorations?.[ribosomes.object]).toMatchObject({ pdb: '7PHB', emdb: 'EMD-13412' });
    expect(s.tomograms[0].levels.map((l) => l.size)).toEqual([
      [928, 928, 450],
      [464, 464, 225],
      [232, 232, 113],
    ]);
  });

  it('has a dataset with GLB meshes (10524)', () => {
    const ds = read<PortalDataset>('10524');
    const formats = new Set(ds.runList.flatMap((r) => r.spacings.flatMap((s) => s.annotations.map((a) => a.format))));
    expect(formats.has('glb')).toBe(true);
  });
});

describe('the portal URL', () => {
  it('loads a run, its annotations and level when given', () => {
    expect(portalLoadOf('?portal-dataset=10003&portal-run=TS_08')).toEqual({
      dataset: 10003,
      run: 'TS_08',
      annotations: '',
    });
    expect(portalLoadOf('?portal-dataset=10003&portal-run=TS_08&portal-annotations=1212,2321&portal-level=1')).toEqual({
      dataset: 10003,
      run: 'TS_08',
      annotations: '1212,2321',
      level: 1,
    });
  });

  it('asks nothing without a dataset, or with a level that is not a number', () => {
    expect(portalLoadOf('?portal-run=TS_08')).toBeUndefined();
    expect(portalLoadOf('?portal-dataset=x')).toBeUndefined();
    expect(portalLoadOf('?portal-dataset=10003&portal-level=fine')).not.toHaveProperty('level');
  });
});
