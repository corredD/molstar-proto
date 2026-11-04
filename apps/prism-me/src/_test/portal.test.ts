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
import { PortalUrlParameters, portalLoadOf } from '../url.js';

// The CryoET Data Portal's index the explorer ships (`portal/`, tools/portal-index) and the URL that loads from it.

const read = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`../../portal/${name}.json`, import.meta.url), 'utf8')) as T;

describe('the shipped portal index', () => {
  it('lists each dataset it holds, in the version the viewer reads', () => {
    const catalog = checkPortalIndex(read<PortalCatalog>('index'), 'index.json');
    expect(catalog.datasets.map((d) => d.id)).toEqual([10003, 10453, 10524, 10518]);
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

  it("has each tomogram's method, software, alignment and the portal's default (10518 pt117_ts_001)", () => {
    const run = read<PortalDataset>('10518').runList.find((r) => r.name === 'pt117_ts_001')!;
    const byId = new Map(run.spacings.flatMap((s) => s.tomograms.map((t) => [t.id, t] as const)));
    expect(byId.size).toBe(8);
    expect(byId.get(64007)).toMatchObject({
      method: 'WBP',
      processing: 'filtered',
      reconstructionSoftware: 'AreTomo3 v2.3.0',
      processingSoftware: 'AreTomo3 v2.3.0',
      alignment: 37978,
      default: true,
    });
    expect(byId.get(64010)).toMatchObject({ processing: 'denoised', processingSoftware: 'IsoNet2' });
    expect(byId.get(64008)?.method).toBe('Fourier_Space');
    expect(byId.get(64005)).not.toHaveProperty('default');
  });

  it('has 10003 TS_08 tilt series 17086: 41 images, their angles by z index, levels of 41 images', () => {
    const run = read<PortalDataset>('10003').runList.find((r) => r.name === 'TS_08')!;
    const ts = run.tiltSeries?.find((t) => t.id === 17086);
    expect(ts).toMatchObject({ zarr: '10003/TS_08/TiltSeries/100/TS_08.zarr', pixelSpacing: 1.7005, tiltAxis: -5 });
    expect(ts!.angles).toHaveLength(41);
    expect(ts!.angles[0]).toBeCloseTo(-60.005, 3);
    expect(ts!.angles[20]).toBeCloseTo(0, 1);
    expect(ts!.angles[40]).toBeCloseTo(60, 1);
    expect(ts!.levels.map((l) => l.size)).toEqual([
      [3838, 3710, 41],
      [1919, 1855, 41],
      [960, 928, 41],
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

  it('loads a tomogram by id, of any spacing (its spacing with it), or a spacing', () => {
    expect(portalLoadOf('?portal-dataset=10518&portal-run=pt117_ts_001&portal-tomogram=64010')).toEqual({
      dataset: 10518,
      run: 'pt117_ts_001',
      annotations: '',
      tomogram: 64010,
    });
    expect(portalLoadOf('?portal-dataset=10453&portal-run=tomogram_003&portal-spacing=13.44')).toMatchObject({
      spacing: 13.44,
    });
    expect(PortalUrlParameters).toEqual(expect.arrayContaining(['portal-tomogram', 'portal-spacing']));
    expect(portalLoadOf('?portal-dataset=10518&portal-tomogram=x&portal-spacing=fine')).toEqual({
      dataset: 10518,
      run: '',
      annotations: '',
    });
  });

  it('loads a tilt series by id, at its own level', () => {
    expect(portalLoadOf('?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086')).toEqual({
      dataset: 10003,
      run: 'TS_08',
      annotations: '',
      tiltSeries: 17086,
    });
    // the tomogram's level and the tilt series' apart
    expect(
      portalLoadOf(
        '?portal-dataset=10003&portal-run=TS_08&portal-tiltseries=17086&portal-tiltseries-level=1&portal-level=0',
      ),
    ).toMatchObject({ tiltSeries: 17086, tiltSeriesLevel: 1, level: 0 });
    expect(PortalUrlParameters).toEqual(expect.arrayContaining(['portal-tiltseries', 'portal-tiltseries-level']));
    expect(portalLoadOf('?portal-dataset=10003&portal-tiltseries=TS-17086&portal-tiltseries-level=x')).toEqual({
      dataset: 10003,
      run: '',
      annotations: '',
    });
  });

  it('asks nothing without a dataset, or with a level that is not a number', () => {
    expect(portalLoadOf('?portal-run=TS_08')).toBeUndefined();
    expect(portalLoadOf('?portal-dataset=x')).toBeUndefined();
    expect(portalLoadOf('?portal-dataset=10003&portal-level=fine')).not.toHaveProperty('level');
  });
});
