/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui';
import { flushFrame } from '@molstar/prism-ui/reactive/frame-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ViewerApi } from '@molstar/prism-viewer/api/area';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshControls } from '../controls.js';
import type { CryoetApi, MeshInfo } from '../operations.js';

// A mesh's color in its controls (prism-me's properties): Prism's color row and its ColorPicker, not the system's
// picker (prism-ui styling.md §4: one ColorPicker); a run of picks is one change, the last, made at once if the
// controls go first. Fake timers: the wait is the controls', nothing else.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const Obj: MeshInfo = {
  ref: 'm',
  label: 'membrane.obj',
  visible: true,
  visuals: ['mesh'],
  opacity: 1,
  color: 0xcccccc,
  scale: 1,
};

/** A VTP colored by its cell array */
const Vtp: MeshInfo = {
  ...Obj,
  label: 'seg.vtp',
  color: undefined,
  arrays: [
    { key: 'point:Curvature', label: 'Point: Curvature', range: [0, 1.5] },
    { key: 'cell:Labels', label: 'Cell: Labels', range: [1, 12] },
  ],
  colorBy: { array: 'cell:Labels', colorList: 'viridis', range: 'auto' },
};

/** The controls of one mesh, its picker opened (when it shows); the palette's hues and the area's calls */
function mounted(mesh: MeshInfo = Obj, volumes: readonly { ref: string; label: string }[] = []) {
  const list = observableState<readonly MeshInfo[]>([mesh]);
  const scene = observableState(volumes);
  const area = {
    mesh: vi.fn(async () => ({ ok: true })),
    volumesState: () => scene.asReadonly,
  } as unknown as CryoetApi;
  const host = document.createElement('div');
  document.body.append(host);
  // a group's API is the same: its `cryoet` area is the one the controls are given
  const groups: string[] = [];
  const api = {
    cryoet: area,
    group: async (label: string, work: (g: ViewerApi) => Promise<unknown>) => {
      groups.push(label);
      return { ok: true, did: label, value: await work(api) };
    },
  } as unknown as ViewerApi;
  const dispose = render(() => <MeshControls api={api} area={area} mesh="m" list={list.asReadonly} />, host);
  host.querySelector<HTMLButtonElement>('button[aria-expanded]:not([aria-haspopup])')?.click();
  const hues = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Palette"] [role=option]'));
  /** A choice of a group of choices (Color by, Range), by its text */
  const choice = (group: string, text: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(`[role=group][aria-label="${group}"] button`)).find(
      (b) => b.textContent?.trim() === text,
    );
  /** A select's option picked: its button opened, the option clicked */
  const pick = (select: string, text: string) => {
    host.querySelector<HTMLButtonElement>(`button[aria-haspopup][aria-label="${select}"]`)!.click();
    Array.from(host.querySelectorAll<HTMLElement>('[role=option]'))
      .find((o) => o.textContent?.trim() === text)!
      .click();
  };
  return { host, area, list, groups, dispose, hues, choice, pick };
}

const hexOf = (b: HTMLElement) => {
  const [r, g, bl] = b.style.background.match(/\d+/g)!.map(Number);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
};

describe("a mesh's color", () => {
  it('a run of picks left at once (the controls gone) is still made, once', () => {
    vi.useFakeTimers();
    const { area, dispose, hues } = mounted();
    hues()[0].click();
    hues()[3].click();
    const last = hexOf(hues()[3]);
    dispose();
    expect(area.mesh).toHaveBeenCalledTimes(1);
    expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', color: last });
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenCalledTimes(1);
  });

  it("is Prism's color picker; a run of picks makes one change, the last", () => {
    vi.useFakeTimers();
    const { host, area, dispose, hues } = mounted();
    expect(host.querySelector('input[type=color]')).toBeNull();
    expect(hues().length).toBeGreaterThan(2);
    hues()[0].click();
    hues()[1].click();
    hues()[2].click();
    const last = hexOf(hues()[2]);
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenCalledTimes(1);
    expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', color: last });
    dispose();
  });
});

describe("a mesh's opacity", () => {
  it('follows the slider during a drag, one group, the release applying the last', async () => {
    const { host, area, groups, dispose } = mounted();
    const range = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Opacity"]')!;
    range.value = '0.5';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    flushFrame();
    await vi.waitFor(() => expect(area.mesh).toHaveBeenCalledWith({ mesh: 'm', opacity: 0.5 }));
    range.value = '0.3';
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', opacity: 0.3 }));
    expect(groups).toEqual(['Mesh opacity']);
    dispose();
  });
});

describe("a mesh's Color by", () => {
  it('shows a VTP on its array: the array, its colors, its range; no color picker', () => {
    const { host, choice, dispose } = mounted(Vtp);
    expect(choice('Color by', 'Array')!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('Color by', 'Uniform')!.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('button[aria-haspopup][aria-label="Array"]')!.textContent).toContain('Cell: Labels');
    expect(host.querySelector('button[aria-haspopup][aria-label="Colors"]')!.textContent).toContain('Viridis');
    expect(choice('Range', 'Auto')!.getAttribute('aria-pressed')).toBe('true');
    // the picker's swatch: not shown
    expect(host.querySelector('button[aria-expanded]:not([aria-haspopup])')).toBeNull();
    dispose();
  });

  it('writes an array, a scale, a range picked; Uniform writes the color shown', () => {
    vi.useFakeTimers();
    const { area, choice, pick, list, dispose } = mounted(Vtp);
    pick('Array', 'Point: Curvature');
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', array: 'point:Curvature' });
    pick('Colors', 'Plasma');
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', colorList: 'plasma' });
    // Custom starts at the array's range
    choice('Range', 'Custom')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', range: [1, 12] });
    list.set([{ ...Vtp, colorBy: { ...Vtp.colorBy!, range: [1, 12] } }]);
    choice('Range', 'Auto')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', range: 'auto' });
    choice('Color by', 'Uniform')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', color: '#cccccc' });
    dispose();
  });

  it('shows the picker under Uniform; Array colors by a cell array first (as a VTP opens)', () => {
    vi.useFakeTimers();
    const { host, area, choice, dispose } = mounted({ ...Vtp, colorBy: undefined, color: 0xff0000 });
    expect(choice('Color by', 'Uniform')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('button[aria-haspopup][aria-label="Array"]')).toBeNull();
    choice('Color by', 'Array')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', array: 'cell:Labels' });
    dispose();
  });

  it('is not offered for a mesh without arrays (an OBJ)', () => {
    const { host, choice, dispose } = mounted(Obj);
    expect(choice('Color by', 'Array')).toBeUndefined();
    expect(host.querySelector('[aria-label="Palette"]')).not.toBeNull();
    dispose();
  });

  it('Custom on an array of one value spans it, a range cryoet.mesh takes (review S3)', () => {
    vi.useFakeTimers();
    const one = { ...Vtp, arrays: [{ key: 'cell:Labels', label: 'Cell: Labels', range: [3, 3] as const }] };
    const { area, choice, dispose } = mounted(one);
    choice('Range', 'Custom')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', range: [2.5, 3.5] });
    dispose();
  });

  it("Uniform after Array writes the mesh's own color again, not the picker's default (review S4)", () => {
    vi.useFakeTimers();
    const { area, choice, list, dispose } = mounted({ ...Vtp, colorBy: undefined, color: 0xff0000 });
    choice('Color by', 'Array')!.click();
    vi.advanceTimersByTime(500);
    list.set([{ ...Vtp, color: undefined }]);
    choice('Color by', 'Uniform')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', color: '#ff0000' });
    dispose();
  });

  it('a color picked over a pending array change replaces it, and the other way (review S5)', () => {
    vi.useFakeTimers();
    const { area, choice, pick, dispose } = mounted(Vtp);
    pick('Colors', 'Plasma');
    choice('Color by', 'Uniform')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', color: '#cccccc' });
    dispose();
  });
});

/** A VTP colored by a volume: Projected Min ±40 Å, inverted */
const ByVolume: MeshInfo = {
  ...Vtp,
  arrays: [...Vtp.arrays!, { key: 'cell:density_tomo', label: 'Cell: density_tomo', range: [-3, 2] }],
  colorBy: undefined,
  volumeColor: {
    volume: 'v1',
    label: 'tomo.mrc',
    sample: 'min',
    depth: 40,
    detail: 'vertex',
    colorList: 'viridis',
    range: 'auto',
    invert: true,
    array: 'cell:density_tomo',
  },
};
const Tomo = [{ ref: 'v1', label: 'tomo.mrc' }];

describe("a mesh's Color by › Volume", () => {
  it('is offered for any mesh when the scene has a volume (an OBJ too), and writes the first volume', () => {
    vi.useFakeTimers();
    const { area, choice, dispose } = mounted(Obj, Tomo);
    expect(choice('Color by', 'Array')).toBeUndefined();
    choice('Color by', 'Volume')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', volume: 'v1' });
    dispose();
  });

  it('is not offered without a volume in the scene', () => {
    const { choice, dispose } = mounted(Vtp);
    expect(choice('Color by', 'Volume')).toBeUndefined();
    dispose();
  });

  it('shows the volume, Projected Min, its depth, its scale inverted; no picker', () => {
    const { host, choice, dispose } = mounted(ByVolume, Tomo);
    expect(choice('Color by', 'Volume')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('button[aria-haspopup][aria-label="Volume"]')!.textContent).toContain('tomo.mrc');
    expect(choice('Sample', 'Projected')!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('Along the normal', 'Min')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('input[type=range][aria-label="Depth"]')!.value).toBe('40');
    expect(choice('Color order', 'Inverted')!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('Range', 'Auto ±2σ')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('button[aria-haspopup][aria-label="Array"]')).toBeNull();
    expect(host.querySelector('button[aria-expanded]:not([aria-haspopup])')).toBeNull();
    dispose();
  });

  it('writes the sample, the depth on release, the scale, a custom range in σ; Uniform writes the color', () => {
    vi.useFakeTimers();
    const { host, area, choice, dispose } = mounted({ ...ByVolume, color: 0x00ff00 }, Tomo);
    choice('Along the normal', 'Max')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', sample: 'max' });
    choice('Sample', 'At surface')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', sample: 'surface' });
    const depth = host.querySelector<HTMLInputElement>('input[type=range][aria-label="Depth"]')!;
    depth.value = '20';
    depth.dispatchEvent(new Event('change', { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', depth: 20 });
    choice('Color order', 'As is')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', invert: false });
    choice('Range', 'Custom')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', range: [-2, 2] });
    choice('Color by', 'Uniform')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', color: '#00ff00' });
    dispose();
  });

  it('Volume again is the volume it kept, not the first of the scene (review S4)', () => {
    vi.useFakeTimers();
    const two = [...Tomo, { ref: 'v2', label: 'ramp.mrc' }];
    const { area, choice, dispose } = mounted({ ...Vtp, volumeKept: { volume: 'v2', label: 'ramp.mrc' } }, two);
    choice('Color by', 'Volume')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', volume: 'v2' });
    dispose();
  });

  it('Detail: Vertex, then Texture written; Texture shows its cells, coarser when capped', () => {
    vi.useFakeTimers();
    const { host, area, choice, dispose } = mounted(ByVolume, Tomo);
    expect(choice('Detail', 'Vertex')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).not.toContain('Cells of');
    choice('Detail', 'Texture')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', detail: 'texture' });
    dispose();
    const texture = mounted(
      { ...ByVolume, volumeColor: { ...ByVolume.volumeColor!, detail: 'texture', cell: 13.36 } },
      Tomo,
    );
    expect(texture.choice('Detail', 'Texture')!.getAttribute('aria-pressed')).toBe('true');
    expect(texture.host.textContent).toContain("Cells of 13.36 Å, the volume's voxels");
    texture.dispose();
    const capped = mounted(
      { ...ByVolume, volumeColor: { ...ByVolume.volumeColor!, detail: 'texture', cell: 26.72, capped: true } },
      Tomo,
    );
    expect(capped.host.textContent).toContain("Cells of 26.72 Å: coarser than the volume's voxels");
    capped.dispose();
  });

  it('Array from Volume colors by the array it keeps the values in', () => {
    vi.useFakeTimers();
    const { area, choice, dispose } = mounted(ByVolume, Tomo);
    choice('Color by', 'Array')!.click();
    vi.advanceTimersByTime(500);
    expect(area.mesh).toHaveBeenLastCalledWith({ mesh: 'm', array: 'cell:density_tomo' });
    dispose();
  });
});
