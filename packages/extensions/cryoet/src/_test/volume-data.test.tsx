/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolumeData } from '../controls.js';
import type { CryoetApi, VolumeDataInfo, VolumeLevelView } from '../operations.js';

// A volume's Data section (prism-me's properties, ui.md §4): its description; an OME-Zarr of several levels, a slider
// over them, coarsest to finest, at the level read; a level is read at the release (`cryoet.level`), one over the
// guard asked first (Read it / Cancel), a failure said, the slider back on the level read. On a fake area.

afterEach(() => {
  document.body.innerHTML = '';
});

const level = (path: string, binning: number, mb: number, large = false): VolumeLevelView => ({
  path,
  binning,
  spacing: 6.802 * binning,
  size: [928 / binning, 928 / binning, Math.round(450 / binning)] as [number, number, number],
  bytes: mb * 1e6,
  large,
  label: `${binning}× · ${+(6.802 * binning).toFixed(1)} Å · ${mb} MB`,
});

const TS08: VolumeDataInfo = {
  source: 'OME-ZARR',
  grid: '232 × 232 × 113',
  voxel: '27.2 Å',
  bytes: 24.3e6,
  levels: [level('2', 4, 24), level('1', 2, 194), level('0', 1, 1550, true)],
  level: '2',
};

function mounted(info: VolumeDataInfo, result: (values: { level: string; large?: boolean }) => ApiResult) {
  const data = observableState<VolumeDataInfo | undefined>(info);
  const area = {
    dataState: () => data.asReadonly,
    level: vi.fn(async (values: { level: string; large?: boolean }) => result(values)),
  } as unknown as CryoetApi;
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <VolumeData area={area} volume="v" />, host);
  const range = () => host.querySelector<HTMLInputElement>('input[type=range]');
  const box = () => host.querySelector<HTMLInputElement>('input[aria-label="Level"]:not([type=range])');
  /** The slider released at a step */
  const release = (i: number) => {
    const r = range()!;
    r.value = String(i);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const button = (text: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
  return { host, area, data, range, box, release, button };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("a volume's Data section", () => {
  it('describes the data; its levels coarsest to finest, at the level read', () => {
    const { host, range } = mounted(TS08, () => ApiResult.ok(''));
    const text = host.textContent ?? '';
    for (const t of ['OME-ZARR', '232 × 232 × 113', '27.2 Å', '24 MB', '4× · 27.2 Å · 24 MB'])
      expect(text).toContain(t);
    expect(range()).not.toBeNull();
    expect([range()!.min, range()!.max, range()!.value]).toEqual(['0', '2', '0']);
  });

  it('shows no slider for a map of one resolution', () => {
    const { host, range } = mounted({ ...TS08, source: 'CCP4', levels: [], level: undefined }, () => ApiResult.ok(''));
    expect(range()).toBeNull();
    expect(host.textContent).toContain('CCP4');
  });

  it('reads a level at the release, through cryoet.level', async () => {
    const { area, release, data, range } = mounted(TS08, () => ApiResult.ok(''));
    release(1);
    expect(area.level).toHaveBeenCalledWith({ volume: 'v', level: '1', large: false });
    await tick();
    data.set({ ...TS08, level: '1' });
    await tick();
    expect(range()!.value).toBe('1');
  });

  it('asks before a level over the guard: Read it reads it with large, Cancel goes back to the level read', async () => {
    const { host, area, release, button, range } = mounted(TS08, ({ large }) =>
      large ? ApiResult.ok('') : ApiResult.fail('confirm', '1× needs 1552 MB decoded, over the 512 MB guard.'),
    );
    release(2);
    await tick();
    expect(host.querySelector('[aria-label="Read a large level?"]')?.textContent).toContain('1552 MB');
    button('Cancel')!.click();
    expect(host.querySelector('[aria-label="Read a large level?"]')).toBeNull();
    expect(range()!.value).toBe('0');
    release(2);
    await tick();
    button('Read it')!.click();
    expect(area.level).toHaveBeenLastCalledWith({ volume: 'v', level: '0', large: true });
  });

  it('says why a level could not be read, the slider back on the level read', async () => {
    const { host, release, range } = mounted(TS08, () => ApiResult.fail('failed', 'Download failed with status 500'));
    release(1);
    await tick();
    expect(host.querySelector('[role=status]')?.textContent).toContain('Download failed');
    expect(range()!.value).toBe('0');
  });
});
