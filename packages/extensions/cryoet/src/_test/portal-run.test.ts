/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { PortalDataset, PortalTomogram } from '../portal-index.js';
import { describePortalRun, type PortalFailure, type PortalRunInfo } from '../portal-run.js';

// A run's tomograms across its spacings (_spec/portal.md §2, §4): 10518 pt117_ts_001 as the portal has it (Ludo,
// 2026-11-03), two tomograms flagged as the portal's default (64011 at 5.003 Å, 64007 at 10.403 Å): the portal's run
// page shows the lowest id, 64007.

const tomogram = (id: number, spacing: number, more: Partial<PortalTomogram>): PortalTomogram => ({
  id,
  name: 'pt117_ts_001',
  size: spacing < 6 ? [1842, 1310, 512] : [886, 630, 246],
  zarr: `10518/pt117_ts_001/${id}.zarr`,
  levels: [{ path: '0', size: [886, 630, 246], spacing, bytes: 1 }],
  ...more,
});

const aretomo = (v: string) => ({ reconstructionSoftware: `AreTomo3 v${v}`, processingSoftware: `AreTomo3 v${v}` });

const ds: PortalDataset = {
  version: 1,
  built: '2026-11-03',
  id: 10518,
  title: 'PP7 virus-like particles',
  runs: 1,
  dois: [],
  runList: [
    {
      id: 17000,
      name: 'pt117_ts_001',
      spacings: [
        {
          spacing: 5.003,
          tomograms: [
            tomogram(64011, 5.003, { method: 'WBP', processing: 'filtered', ...aretomo('2.3.1'), default: true }),
          ],
          annotations: [
            {
              id: 183804,
              object: 'virus-like capsid',
              shape: 'OrientedPoint',
              format: 'ndjson',
              path: 'c',
              default: true,
            },
          ],
        },
        {
          spacing: 10.403,
          tomograms: [
            tomogram(64004, 10.403, { method: 'WBP', processing: 'raw', ...aretomo('2.3.1'), alignment: 37977 }),
            tomogram(64005, 10.403, { method: 'SART', processing: 'raw', ...aretomo('2.3.1') }),
            tomogram(64006, 10.403, { method: 'WBP', processing: 'raw', ...aretomo('2.3.0'), alignment: 37978 }),
            tomogram(64007, 10.403, { method: 'WBP', processing: 'filtered', ...aretomo('2.3.0'), default: true }),
            tomogram(64008, 10.403, {
              method: 'Fourier_Space',
              processing: 'filtered',
              reconstructionSoftware: 'Warp 2.0.0',
              processingSoftware: 'Warp 2.0.0',
            }),
            tomogram(64010, 10.403, {
              method: 'WBP',
              processing: 'denoised',
              reconstructionSoftware: 'AreTomo3 v2.3.0',
              processingSoftware: 'IsoNet2',
            }),
          ],
          annotations: [
            {
              id: 183803,
              object: 'membrane',
              shape: 'SegmentationMask',
              format: 'zarr',
              path: 'm',
              default: true,
            },
          ],
        },
      ],
    },
  ],
};

const describeRun = (spacing?: number, t?: number) => describePortalRun(() => true, ds, 'pt117_ts_001', spacing, t);
const ok = (r: PortalRunInfo | PortalFailure) => {
  if ('ok' in r) throw new Error(r.message);
  return r;
};

describe('describePortalRun', () => {
  it("takes the portal's default tomogram when none is named: the lowest id flagged in the run, and its spacing", () => {
    const info = ok(describeRun());
    expect(info.tomogram?.id).toBe(64007);
    expect(info.spacing.spacing).toBe(10.403);
    expect(info.defaults).toEqual(['183803']);
  });

  it("takes a tomogram by id from any spacing of the run: that spacing's annotations come with it", () => {
    const fine = ok(describeRun(undefined, 64011));
    expect(fine.spacing.spacing).toBe(5.003);
    expect(fine.entries.map((e) => e.object)).toEqual(['virus-like capsid']);
    const denoised = ok(describeRun(undefined, 64010));
    expect(denoised.spacing.spacing).toBe(10.403);
    expect(denoised.tomogram?.processingSoftware).toBe('IsoNet2');
    expect(denoised.defaults).toEqual(['183803']);
  });

  it("takes a spacing's flagged tomogram when only the spacing is named, its first without one", () => {
    expect(ok(describeRun(5.003)).tomogram?.id).toBe(64011);
    const unflagged: PortalDataset = {
      ...ds,
      runList: [
        {
          ...ds.runList[0],
          spacings: ds.runList[0].spacings.map((s) => ({
            ...s,
            tomograms: s.tomograms.map(({ default: _, ...t }) => t),
          })),
        },
      ],
    };
    const first = describePortalRun(() => true, unflagged, 'pt117_ts_001', 10.403);
    expect(ok(first).tomogram?.id).toBe(64004);
    // no flag in the run: its first spacing's first tomogram, as before the flag was read
    expect(ok(describePortalRun(() => true, unflagged, 'pt117_ts_001')).tomogram?.id).toBe(64011);
  });

  it('names the tomograms it has when asked for one it has not, or one of another spacing', () => {
    expect(describeRun(undefined, 99)).toMatchObject({
      ok: false,
      message: 'pt117_ts_001 has no tomogram 99.',
      hint: 'It has 64004, 64005, 64006, 64007, 64008, 64010, 64011.',
    });
    expect(describeRun(10.403, 64011)).toMatchObject({
      ok: false,
      message: 'pt117_ts_001 has no tomogram 64011 at 10.403 Å.',
    });
  });
});
